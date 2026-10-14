package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/pkg/feeds"
	"github.com/VijaysinghPuwar/BreachScope/pkg/store"
	"github.com/VijaysinghPuwar/BreachScope/pkg/stream"
)

type stubEvents struct {
	evs     []store.Event
	pingErr error
	gotF    store.Filter
}

func (s *stubEvents) EventsAfter(_ context.Context, f store.Filter) ([]store.Event, error) {
	s.gotF = f
	return s.evs, nil
}
func (s *stubEvents) LatestSeq(context.Context) (int64, error) { return 0, nil }
func (s *stubEvents) Ping(context.Context) error               { return s.pingErr }

func newTestRouter(ev Events) http.Handler {
	cfg := stream.DefaultConfig()
	cfg.MaxDuration = 1500 * time.Millisecond
	d := Deps{Stream: cfg, Version: "test", Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if ev != nil {
		d.Events = ev
	}
	return NewRouter(d)
}

func do(t *testing.T, h http.Handler, path string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec, body
}

func TestHealthz(t *testing.T) {
	cases := []struct {
		name string
		ev   Events
		db   string
	}{
		{"no database", nil, "unconfigured"},
		{"database up", &stubEvents{}, "ok"},
		{"database down", &stubEvents{pingErr: errors.New("boom")}, "down"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec, body := do(t, newTestRouter(c.ev), "/api/healthz")
			if rec.Code != 200 || body["db"] != c.db {
				t.Fatalf("status %d body %v, want db=%s", rec.Code, body, c.db)
			}
		})
	}
}

func TestEventsWithoutDatabaseIs503WithRequestID(t *testing.T) {
	rec, body := do(t, newTestRouter(nil), "/api/events")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", rec.Code)
	}
	if body["request_id"] == "" || rec.Header().Get("X-Request-ID") == "" {
		t.Fatal("missing request id")
	}
}

func TestEventsFilterParsing(t *testing.T) {
	ev := &stubEvents{evs: []store.Event{{Seq: 10}, {Seq: 12}}}
	rec, body := do(t, newTestRouter(ev), "/api/events?after=5&limit=2&class=telemetry,indicator&min_severity=2&country=nl&asn=AS64500")
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if body["next_after"] != float64(12) {
		t.Errorf("next_after = %v, want 12", body["next_after"])
	}
	f := ev.gotF
	if f.After != 5 || f.Limit != 2 || len(f.Classes) != 2 || f.MinSeverity != 2 || f.Country != "NL" || f.ASN != 64500 {
		t.Errorf("filter = %+v", f)
	}
}

func TestEventsRejectsBadInput(t *testing.T) {
	for _, q := range []string{
		"after=abc", "after=-1", "limit=0", "limit=5000", "class=attack",
		"min_severity=9", "country=NLD", "country=1A", "asn=x",
	} {
		rec, _ := do(t, newTestRouter(&stubEvents{}), "/api/events?"+q)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", q, rec.Code)
		}
	}
}

func TestEmptyPageIsArrayNotNull(t *testing.T) {
	rec, _ := do(t, newTestRouter(&stubEvents{}), "/api/events?after=7")
	want := `{"events":[],"next_after":7}` + "\n"
	if rec.Body.String() != want {
		t.Fatalf("got %q want %q", rec.Body.String(), want)
	}
}

func TestUnknownRouteIsJSON404(t *testing.T) {
	rec, body := do(t, newTestRouter(nil), "/api/nope")
	if rec.Code != 404 || body["error"] != "not found" {
		t.Fatalf("status %d body %v", rec.Code, body)
	}
}

func TestSSETestTicksAndCloses(t *testing.T) {
	srv := httptest.NewServer(newTestRouter(nil))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/api/sse-test")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var ticks int
	var closed bool
	_ = stream.ReadMessages(resp.Body, func(m stream.Message) bool {
		switch m.Event {
		case "tick":
			ticks++
		case "close":
			closed = true
		}
		return true
	})
	if ticks < 1 || !closed {
		t.Fatalf("ticks=%d closed=%v", ticks, closed)
	}
}

func TestLiveServesCachedGzipWithETag(t *testing.T) {
	body, err := os.ReadFile("../feeds/testdata/feodo.json")
	if err != nil {
		t.Fatal(err)
	}
	var upstream int
	feed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstream++
		_, _ = w.Write(body)
	}))
	defer feed.Close()

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := feeds.NewHub([]feeds.Source{{
		Name: "Feodo Tracker", DataClass: "indicator", Licence: "CC0", FeedURL: feed.URL,
		MinInterval: time.Hour, Parse: feeds.ParseFeodo,
	}}, feed.Client(), nil, log)
	h := NewRouter(Deps{Live: hub, Stream: stream.DefaultConfig(), Log: log})

	get := func(header, value string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/live", nil)
		if header != "" {
			req.Header.Set(header, value)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	plain := get("", "")
	var snap feeds.Snapshot
	if plain.Code != 200 || json.Unmarshal(plain.Body.Bytes(), &snap) != nil || len(snap.Events) != 1 {
		t.Fatalf("plain response: %d %s", plain.Code, plain.Body.String())
	}
	etag := plain.Header().Get("ETag")

	zipped := get("Accept-Encoding", "gzip, br")
	if zipped.Header().Get("Content-Encoding") != "gzip" || zipped.Body.Len() >= plain.Body.Len() {
		t.Fatalf("expected a smaller gzip body, got %q %d bytes", zipped.Header().Get("Content-Encoding"), zipped.Body.Len())
	}
	if again := get("If-None-Match", etag); again.Code != http.StatusNotModified || again.Body.Len() != 0 {
		t.Fatalf("matching ETag: %d with %d bytes", again.Code, again.Body.Len())
	}
	if upstream != 1 {
		t.Fatalf("%d upstream fetches for 3 requests, want 1", upstream)
	}
}
