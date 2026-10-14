package stream_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/internal/store"
	"github.com/VijaysinghPuwar/BreachScope/internal/stream"
	"github.com/VijaysinghPuwar/BreachScope/internal/testpg"
)

// TestForcedReconnectLosesNothing writes events from several concurrent
// writers while a client keeps dropping its connection at random points and
// reconnecting with Last-Event-ID. Afterwards the set of event_uid values the
// client saw must equal the set in the database: nothing missing, nothing
// twice. seq is compared only as a cursor, never as a count, because
// ON CONFLICT and rollbacks leave holes in it.
func TestForcedReconnectLosesNothing(t *testing.T) {
	pool := testpg.Start(t)
	s := store.New(pool)
	ctx := context.Background()

	srcID, err := s.UpsertSource(ctx, "reconnect-test", "simulated", "Synthetic", 0, false)
	if err != nil {
		t.Fatal(err)
	}

	cfg := stream.Config{
		PollInterval: 5 * time.Millisecond,
		MaxDuration:  250 * time.Millisecond, // many planned closes, like the 280 s cap in production
		Heartbeat:    time.Second,
		BatchLimit:   37,
		RetryMillis:  1,
	}
	srv := httptest.NewServer(stream.New(s, cfg, slog.New(slog.NewTextHandler(io.Discard, nil))))
	defer srv.Close()

	const writers, perWriter = 4, 300
	var wg sync.WaitGroup
	for w := range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rng := rand.New(rand.NewPCG(uint64(w), 7))
			for i := 0; i < perWriter; {
				n := min(1+rng.IntN(15), perWriter-i)
				batch := make([]store.NewEvent, 0, n)
				for j := range n {
					k := w*perWriter + i + j
					batch = append(batch, store.NewEvent{
						UID:             fmt.Sprintf("00000000-0000-4000-8000-%012d", k),
						SourceID:        srcID,
						Category:        1,
						ConfidenceBasis: "simulated",
						GeoMethod:       "none",
					})
				}
				// Re-send half the batches to prove duplicates never reach the stream.
				if _, err := s.InsertEvents(ctx, batch); err != nil {
					t.Error(err)
					return
				}
				if rng.IntN(2) == 0 {
					if _, err := s.InsertEvents(ctx, batch); err != nil {
						t.Error(err)
						return
					}
				}
				i += n
				time.Sleep(time.Duration(rng.IntN(3)) * time.Millisecond)
			}
		}()
	}
	writersDone := make(chan struct{})
	go func() { wg.Wait(); close(writersDone) }()

	seen := map[string]int{}
	var cursor int64
	rng := rand.New(rand.NewPCG(42, 42))
	connections, forcedDrops := 0, 0
	deadline := time.Now().Add(60 * time.Second)

	for {
		if time.Now().After(deadline) {
			t.Fatal("client did not catch up within 60 s")
		}
		select {
		case <-writersDone:
			latest, err := s.LatestSeq(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if cursor == latest {
				goto compare
			}
		default:
		}

		connections++
		dropAfter := rng.IntN(6) // 0 means "don't drop, wait for the planned close"
		reqCtx, cancel := context.WithCancel(ctx)
		req, _ := http.NewRequestWithContext(reqCtx, http.MethodGet, srv.URL, nil)
		req.Header.Set("Last-Event-ID", strconv.FormatInt(cursor, 10))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		msgs := 0
		_ = stream.ReadMessages(resp.Body, func(m stream.Message) bool {
			if m.Event != "events" {
				return true
			}
			var evs []store.Event
			if err := json.Unmarshal([]byte(m.Data), &evs); err != nil {
				t.Error(err)
				return false
			}
			for _, e := range evs {
				seen[e.UID]++
			}
			// Advance the cursor only from the id line, exactly as EventSource does.
			if cursor, err = strconv.ParseInt(m.ID, 10, 64); err != nil {
				t.Error(err)
				return false
			}
			msgs++
			if dropAfter > 0 && msgs == dropAfter {
				forcedDrops++
				return false
			}
			return true
		})
		cancel()
		resp.Body.Close()
	}

compare:
	rows, err := pool.Query(ctx, `SELECT event_uid::text FROM event`)
	if err != nil {
		t.Fatal(err)
	}
	inDB := map[string]bool{}
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			t.Fatal(err)
		}
		inDB[uid] = true
	}
	if len(inDB) != writers*perWriter {
		t.Fatalf("database has %d events, want %d", len(inDB), writers*perWriter)
	}
	var missing, dupes int
	for uid := range inDB {
		switch seen[uid] {
		case 0:
			missing++
		case 1:
		default:
			dupes++
		}
	}
	for uid := range seen {
		if !inDB[uid] {
			t.Errorf("client saw %s which is not in the database", uid)
		}
	}
	t.Logf("%d events, %d connections, %d forced drops, %d missing, %d duplicates",
		len(inDB), connections, forcedDrops, missing, dupes)
	if missing != 0 || dupes != 0 {
		t.Fatalf("%d missing, %d duplicated", missing, dupes)
	}
	if forcedDrops < 5 {
		t.Fatalf("only %d forced drops; the test did not exercise reconnects", forcedDrops)
	}
}
