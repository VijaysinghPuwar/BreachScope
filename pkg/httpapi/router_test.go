package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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
