package stream

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/pkg/store"
)

// fakeSource is an in-memory, append-only event log.
type fakeSource struct {
	mu  sync.Mutex
	evs []store.Event
}

func (f *fakeSource) add(n int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for range n {
		seq := int64(len(f.evs) + 1)
		f.evs = append(f.evs, store.Event{Seq: seq, UID: fmt.Sprintf("uid-%d", seq)})
	}
}

func (f *fakeSource) EventsAfter(_ context.Context, flt store.Filter) ([]store.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []store.Event
	for _, e := range f.evs {
		if e.Seq > flt.After {
			out = append(out, e)
			if len(out) == flt.Limit {
				break
			}
		}
	}
	return out, nil
}

func (f *fakeSource) LatestSeq(context.Context) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return int64(len(f.evs)), nil
}

func testConfig() Config {
	return Config{
		PollInterval: 10 * time.Millisecond,
		MaxDuration:  300 * time.Millisecond,
		Heartbeat:    50 * time.Millisecond,
		BatchLimit:   7,
		RetryMillis:  10,
	}
}

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestCursor(t *testing.T) {
	cases := []struct {
		name, header, query string
		want                int64
		ok, wantErr         bool
	}{
		{name: "none"},
		{name: "query", query: "after=41", want: 41, ok: true},
		{name: "header wins", header: "99", query: "after=41", want: 99, ok: true},
		{name: "negative", query: "after=-1", wantErr: true},
		{name: "junk", header: "abc", wantErr: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/stream?"+c.query, nil)
			if c.header != "" {
				r.Header.Set("Last-Event-ID", c.header)
			}
			got, ok, err := Cursor(r)
			if (err != nil) != c.wantErr || got != c.want || ok != c.ok {
				t.Fatalf("Cursor() = %d, %v, %v; want %d, %v, err=%v", got, ok, err, c.want, c.ok, c.wantErr)
			}
		})
	}
}

func TestStreamSendsBatchesWithIDsAndClosesAtDeadline(t *testing.T) {
	src := &fakeSource{}
	src.add(20)
	srv := httptest.NewServer(New(src, testConfig(), quietLog()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "?after=0")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q", ct)
	}

	var got []int64
	var closed bool
	err = ReadMessages(resp.Body, func(m Message) bool {
		switch m.Event {
		case "events":
			var evs []store.Event
			if err := json.Unmarshal([]byte(m.Data), &evs); err != nil {
				t.Fatal(err)
			}
			if len(evs) > testConfig().BatchLimit {
				t.Errorf("batch of %d exceeds limit", len(evs))
			}
			if m.ID != fmt.Sprint(evs[len(evs)-1].Seq) {
				t.Errorf("id %s does not match last seq %d", m.ID, evs[len(evs)-1].Seq)
			}
			for _, e := range evs {
				got = append(got, e.Seq)
			}
		case "close":
			closed = true
		}
		return true
	})
	if err != nil {
		t.Fatal(err)
	}
	if !closed {
		t.Error("stream ended without a close event")
	}
	if len(got) != 20 {
		t.Fatalf("got %d events, want 20", len(got))
	}
	for i, s := range got {
		if s != int64(i+1) {
			t.Fatalf("event %d has seq %d, want %d", i, s, i+1)
		}
	}
}

func TestStreamWithoutCursorStartsAtLatest(t *testing.T) {
	src := &fakeSource{}
	src.add(5)
	srv := httptest.NewServer(New(src, testConfig(), quietLog()))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	go func() {
		time.Sleep(50 * time.Millisecond)
		src.add(2)
	}()

	var seqs []int64
	_ = ReadMessages(resp.Body, func(m Message) bool {
		if m.Event == "events" {
			var evs []store.Event
			_ = json.Unmarshal([]byte(m.Data), &evs)
			for _, e := range evs {
				seqs = append(seqs, e.Seq)
			}
		}
		return true
	})
	if fmt.Sprint(seqs) != "[6 7]" {
		t.Fatalf("got %v, want only the new events [6 7]", seqs)
	}
}

func TestStreamRejectsBadCursor(t *testing.T) {
	rec := httptest.NewRecorder()
	New(&fakeSource{}, testConfig(), quietLog()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/?after=x", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", rec.Code)
	}
}

func TestReadMessagesSkipsComments(t *testing.T) {
	body := "retry: 10\n\n: ping\n\nid: 3\nevent: events\ndata: [1]\n\n"
	var msgs []Message
	if err := ReadMessages(strings.NewReader(body), func(m Message) bool { msgs = append(msgs, m); return true }); err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 || msgs[0] != (Message{ID: "3", Event: "events", Data: "[1]"}) {
		t.Fatalf("got %+v", msgs)
	}
}
