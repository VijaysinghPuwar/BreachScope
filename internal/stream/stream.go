// Package stream serves events as server-sent events (SSE) with a seq cursor.
//
// Each connection lives at most MaxDuration (280 s by default, under Vercel's
// 300 s cap). Every batch is sent with "id: <last seq in batch>", so when the
// connection ends the browser's EventSource reconnects with a Last-Event-ID
// header and the server resumes exactly after that seq.
package stream

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/internal/store"
)

// Source is the part of the store the stream needs. Tests pass a fake.
type Source interface {
	EventsAfter(ctx context.Context, f store.Filter) ([]store.Event, error)
	LatestSeq(ctx context.Context) (int64, error)
}

type Config struct {
	PollInterval time.Duration // how often to ask Postgres for new rows
	MaxDuration  time.Duration // close the connection after this long
	Heartbeat    time.Duration // comment line sent when idle, keeps proxies from timing out
	BatchLimit   int           // rows per SSE message
	RetryMillis  int           // reconnect delay the browser should use
}

func DefaultConfig() Config {
	return Config{
		PollInterval: time.Second,
		MaxDuration:  280 * time.Second,
		Heartbeat:    15 * time.Second,
		BatchLimit:   500,
		RetryMillis:  1000,
	}
}

type Handler struct {
	src Source
	cfg Config
	log *slog.Logger
}

func New(src Source, cfg Config, log *slog.Logger) *Handler {
	return &Handler{src: src, cfg: cfg, log: log}
}

// Cursor picks the starting seq. Last-Event-ID wins over ?after= because it is
// what the browser sends on an automatic reconnect. ok is false when the
// client gave no cursor at all.
func Cursor(r *http.Request) (seq int64, ok bool, err error) {
	raw := r.Header.Get("Last-Event-ID")
	if raw == "" {
		raw = r.URL.Query().Get("after")
	}
	if raw == "" {
		return 0, false, nil
	}
	seq, err = strconv.ParseInt(raw, 10, 64)
	if err != nil || seq < 0 {
		return 0, false, fmt.Errorf("cursor must be a non-negative integer")
	}
	return seq, true, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	after, haveCursor, err := Cursor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	filter := store.Filter{Limit: h.cfg.BatchLimit}
	if err := filter.Validate(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.cfg.MaxDuration)
	defer cancel()

	if !haveCursor {
		// A client with no cursor wants new events only. It loads history
		// from /api/events first and passes ?after= from that page.
		if after, err = h.src.LatestSeq(ctx); err != nil {
			h.log.Error("stream latest seq", "err", err)
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
	}

	hdr := w.Header()
	hdr.Set("Content-Type", "text/event-stream")
	hdr.Set("Cache-Control", "no-cache, no-transform")
	hdr.Set("Connection", "keep-alive")
	hdr.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	fmt.Fprintf(w, "retry: %d\n\n", h.cfg.RetryMillis)
	flusher.Flush()

	poll := time.NewTicker(h.cfg.PollInterval)
	defer poll.Stop()
	lastWrite := time.Now()

	for {
		// Drain: keep reading while full batches come back, so a client that
		// reconnects far behind catches up without waiting a tick per batch.
		for {
			f := filter
			f.After = after
			evs, err := h.src.EventsAfter(ctx, f)
			if err != nil {
				if ctx.Err() != nil {
					break
				}
				h.log.Error("stream poll", "err", err, "after", after)
				writeEvent(w, "error", "", map[string]string{"message": "database unavailable"})
				flusher.Flush()
				return
			}
			if len(evs) == 0 {
				break
			}
			after = evs[len(evs)-1].Seq
			writeEvent(w, "events", strconv.FormatInt(after, 10), evs)
			flusher.Flush()
			lastWrite = time.Now()
			if len(evs) < f.Limit {
				break
			}
		}

		select {
		case <-ctx.Done():
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				// Planned close. The browser reconnects with Last-Event-ID.
				writeEvent(w, "close", "", map[string]string{"reason": "max_duration"})
				flusher.Flush()
			}
			return
		case <-poll.C:
			if time.Since(lastWrite) >= h.cfg.Heartbeat {
				fmt.Fprint(w, ": ping\n\n")
				flusher.Flush()
				lastWrite = time.Now()
			}
		}
	}
}

// writeEvent writes one SSE message. data is JSON-encoded on a single line,
// which is valid SSE because encoding/json never emits a raw newline.
func writeEvent(w http.ResponseWriter, event, id string, data any) {
	b, err := json.Marshal(data)
	if err != nil {
		b = []byte(`{"message":"encode failed"}`)
		event = "error"
	}
	if id != "" {
		fmt.Fprintf(w, "id: %s\n", id)
	}
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b)
}
