// Package httpapi wires the HTTP routes. The same router runs in the Vercel
// function (api/index.go) and in the standalone server (cmd/api).
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/VijaysinghPuwar/BreachScope/pkg/feeds"
	"github.com/VijaysinghPuwar/BreachScope/pkg/store"
	"github.com/VijaysinghPuwar/BreachScope/pkg/stream"
)

// Events is what the handlers need from the store.
type Events interface {
	stream.Source
	Ping(ctx context.Context) error
}

type Deps struct {
	Events    Events     // nil when DATABASE_URL is not set
	Live      *feeds.Hub // public feeds, no database needed
	GeoStatus string     // "ok", or why the DB-IP files could not be opened
	Stream    stream.Config
	Version   string
	Log       *slog.Logger
}

func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(requestIDHeader)
	r.Use(middleware.Recoverer)

	r.Route("/api", func(r chi.Router) {
		r.Get("/healthz", d.healthz)
		r.Get("/events", d.needDB(d.events))
		r.Get("/stream", d.needDB(func(w http.ResponseWriter, r *http.Request) {
			stream.New(d.Events, d.Stream, d.Log).ServeHTTP(w, r)
		}))
		r.Get("/sse-test", d.sseTest)
		r.Get("/live", d.live)
	})
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, http.StatusNotFound, "not found")
	})
	return r
}

// requestIDHeader returns chi's request id to the client, so an error message
// in the UI can quote it and the same id can be found in the logs.
func requestIDHeader(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id := middleware.GetReqID(r.Context()); id != "" {
			w.Header().Set("X-Request-ID", id)
		}
		next.ServeHTTP(w, r)
	})
}

func (d Deps) needDB(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if d.Events == nil {
			writeError(w, r, http.StatusServiceUnavailable, "database not configured")
			return
		}
		h(w, r)
	}
}

func (d Deps) healthz(w http.ResponseWriter, r *http.Request) {
	status := "unconfigured"
	if d.Events != nil {
		// Long enough for Neon to wake from autosuspend.
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		status = "ok"
		if err := d.Events.Ping(ctx); err != nil {
			d.Log.Warn("healthz ping", "err", err)
			status = "down"
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok", "db": status, "geo": d.GeoStatus, "version": d.Version,
	})
}

type eventsPage struct {
	Events    []store.Event `json:"events"`
	NextAfter int64         `json:"next_after"`
}

func (d Deps) events(w http.ResponseWriter, r *http.Request) {
	f, err := parseFilter(r)
	if err == nil {
		err = f.Validate()
	}
	if err != nil {
		writeError(w, r, http.StatusBadRequest, err.Error())
		return
	}
	evs, err := d.Events.EventsAfter(r.Context(), f)
	if err != nil {
		d.Log.Error("events query", "err", err, "request_id", middleware.GetReqID(r.Context()))
		writeError(w, r, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	page := eventsPage{Events: evs, NextAfter: f.After}
	if len(evs) > 0 {
		page.NextAfter = evs[len(evs)-1].Seq
	}
	if page.Events == nil {
		page.Events = []store.Event{}
	}
	writeJSON(w, http.StatusOK, page)
}

func parseFilter(r *http.Request) (store.Filter, error) {
	q := r.URL.Query()
	var f store.Filter
	var err error
	if v := q.Get("after"); v != "" {
		if f.After, err = strconv.ParseInt(v, 10, 64); err != nil {
			return f, fmt.Errorf("after must be an integer")
		}
	}
	if v := q.Get("limit"); v != "" {
		// An explicit 0 is a client bug, not a request for the default.
		if f.Limit, err = strconv.Atoi(v); err != nil || f.Limit < 1 {
			return f, fmt.Errorf("limit must be an integer from 1 to %d", store.MaxLimit)
		}
	}
	if v := q.Get("class"); v != "" {
		f.Classes = strings.Split(v, ",")
	}
	if v := q.Get("min_severity"); v != "" {
		n, err := strconv.ParseInt(v, 10, 16)
		if err != nil {
			return f, fmt.Errorf("min_severity must be an integer")
		}
		f.MinSeverity = int16(n)
	}
	f.Country = q.Get("country")
	if v := q.Get("asn"); v != "" {
		n, err := strconv.ParseInt(strings.TrimPrefix(strings.ToUpper(v), "AS"), 10, 32)
		if err != nil {
			return f, fmt.Errorf("asn must be a number like 64500 or AS64500")
		}
		f.ASN = int32(n)
	}
	return f, nil
}

// sseTest streams one tick per second with no database. It exists to prove on
// a Vercel preview that a Go function can hold an SSE connection for the full
// stream lifetime and close cleanly.
func (d Deps) sseTest(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, r, http.StatusInternalServerError, "streaming not supported")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), d.Stream.MaxDuration)
	defer cancel()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	start := time.Now()
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for n := 1; ; n++ {
		select {
		case <-ctx.Done():
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				fmt.Fprintf(w, "event: close\ndata: {\"held_seconds\":%d}\n\n", int(time.Since(start).Seconds()))
				flusher.Flush()
			}
			return
		case now := <-tick.C:
			fmt.Fprintf(w, "id: %d\nevent: tick\ndata: {\"n\":%d,\"t\":%q}\n\n", n, n, now.UTC().Format(time.RFC3339))
			flusher.Flush()
		}
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, r *http.Request, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg, "request_id": middleware.GetReqID(r.Context())})
}

// live serves the merged public-feed snapshot. The CDN may cache it for two
// minutes and serve a stale copy for ten more while it refreshes, so the feed
// operators see at most one fetch per source interval, however many people
// are watching.
func (d Deps) live(w http.ResponseWriter, r *http.Request) {
	if d.Live == nil {
		writeError(w, r, http.StatusServiceUnavailable, "live feeds not configured")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	enc, err := d.Live.EncodedSnapshot(ctx)
	if err != nil {
		d.Log.Error("encode live snapshot", "err", err)
		writeError(w, r, http.StatusInternalServerError, "could not build snapshot")
		return
	}
	h := w.Header()
	h.Set("Cache-Control", "public, max-age=30, s-maxage=120, stale-while-revalidate=600")
	h.Set("ETag", enc.ETag)
	h.Set("Vary", "Accept-Encoding")
	if r.Header.Get("If-None-Match") == enc.ETag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", "application/json")
	body := enc.JSON
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		h.Set("Content-Encoding", "gzip")
		body = enc.Gzip
	}
	h.Set("Content-Length", strconv.Itoa(len(body)))
	_, _ = w.Write(body)
}
