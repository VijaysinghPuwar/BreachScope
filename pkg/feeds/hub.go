// Package feeds pulls public threat-intelligence feeds, places every IP with
// DB-IP, and keeps the latest snapshot in memory for GET /api/live.
//
// Being polite to the feeds is part of the design: each source has a minimum
// interval between fetches, requests carry a User-Agent with contact details,
// conditional requests avoid re-downloading unchanged files, and the HTTP
// response is cacheable by the CDN so traffic to our site never turns into
// traffic to theirs.
package feeds

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/pkg/geoip"
	"github.com/VijaysinghPuwar/BreachScope/pkg/store"
)

// UserAgent identifies us to feed operators. DShield asks for contact details.
const UserAgent = "BreachScope/0.1 (+https://github.com/VijaysinghPuwar/BreachScope; vpuwar199@gmail.com)"

// MaxEvents caps the snapshot so the JSON stays small enough for a phone.
const MaxEvents = 3000

// Source describes one feed.
type Source struct {
	Name        string
	DataClass   string
	Licence     string
	URL         string // human-facing home page
	FeedURL     string // what we fetch
	MinInterval time.Duration
	// Parse turns the response body into events. now is the fetch time.
	Parse func(body []byte, geo *geoip.DB, now time.Time) ([]store.Event, error)
}

// SourceStatus is reported to the client so it can show freshness.
type SourceStatus struct {
	Name               string     `json:"name"`
	DataClass          string     `json:"data_class"`
	Licence            string     `json:"licence"`
	URL                string     `json:"url"`
	LastSuccess        *time.Time `json:"last_success,omitempty"`
	LastError          string     `json:"last_error"`
	Records            int        `json:"records"`
	MinIntervalSeconds int        `json:"min_interval_seconds"`
}

type Snapshot struct {
	GeneratedAt time.Time      `json:"generated_at"`
	Sources     []SourceStatus `json:"sources"`
	Events      []store.Event  `json:"events"`
}

type sourceState struct {
	events       []store.Event
	lastAttempt  time.Time
	lastSuccess  time.Time
	lastError    string
	lastModified string
	etag         string
}

type Hub struct {
	sources []Source
	client  *http.Client
	geo     *geoip.DB
	log     *slog.Logger
	now     func() time.Time

	mu      sync.Mutex
	state   map[string]*sourceState
	refresh chan struct{} // non-nil while a refresh is running

	// The encoded snapshot is cached and rebuilt only when a refresh changes
	// something. Encoding 2,000+ events per request was the bottleneck under
	// load (about 60 requests a second); serving cached bytes is not.
	version        uint64 // bumped whenever any source's data or status changes
	encoded        *Encoded
	encodedVersion uint64
}

func NewHub(sources []Source, client *http.Client, geo *geoip.DB, log *slog.Logger) *Hub {
	h := &Hub{
		sources: sources,
		client:  client,
		geo:     geo,
		log:     log,
		now:     time.Now,
		state:   map[string]*sourceState{},
	}
	for _, s := range sources {
		h.state[s.Name] = &sourceState{}
	}
	return h
}

// Snapshot refreshes any source past its interval and returns the merged
// events, newest first. Only one refresh runs at a time; concurrent callers
// wait for it. If ctx ends first they get whatever is already in memory.
func (h *Hub) Snapshot(ctx context.Context) Snapshot {
	h.mu.Lock()
	done := h.refresh
	if done == nil && h.anyDue() {
		done = make(chan struct{})
		h.refresh = done
		go h.runRefresh(done)
	}
	h.mu.Unlock()

	if done != nil {
		select {
		case <-done:
		case <-ctx.Done():
		}
	}
	return h.build()
}

func (h *Hub) anyDue() bool {
	now := h.now()
	for _, s := range h.sources {
		if now.Sub(h.state[s.Name].lastAttempt) >= s.MinInterval {
			return true
		}
	}
	return false
}

func (h *Hub) runRefresh(done chan struct{}) {
	// Detached from the request: a slow feed should finish and be cached even
	// if the visitor who triggered it has gone.
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	now := h.now()
	for _, s := range h.sources {
		h.mu.Lock()
		st := h.state[s.Name]
		due := now.Sub(st.lastAttempt) >= s.MinInterval
		if due {
			st.lastAttempt = now
		}
		lm, etag := st.lastModified, st.etag
		h.mu.Unlock()
		if !due {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			evs, newLM, newETag, notModified, err := h.fetch(ctx, s, lm, etag, now)
			h.mu.Lock()
			defer h.mu.Unlock()
			switch {
			case err != nil:
				st.lastError = err.Error()
				h.log.Warn("feed fetch failed", "source", s.Name, "err", err)
			case notModified:
				st.lastSuccess, st.lastError = now, ""
			default:
				st.events, st.lastSuccess, st.lastError = evs, now, ""
				st.lastModified, st.etag = newLM, newETag
			}
		}()
	}
	wg.Wait()

	h.mu.Lock()
	h.version++
	h.refresh = nil
	h.mu.Unlock()
	close(done)
}

func (h *Hub) build() Snapshot {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.buildLocked()
}

func (h *Hub) buildLocked() Snapshot {
	snap := Snapshot{GeneratedAt: h.lastRefresh().UTC(), Events: []store.Event{}}
	for _, s := range h.sources {
		st := h.state[s.Name]
		ss := SourceStatus{
			Name: s.Name, DataClass: s.DataClass, Licence: s.Licence, URL: s.URL,
			LastError: st.lastError, Records: len(st.events),
			MinIntervalSeconds: int(s.MinInterval.Seconds()),
		}
		if !st.lastSuccess.IsZero() {
			t := st.lastSuccess.UTC()
			ss.LastSuccess = &t
		}
		snap.Sources = append(snap.Sources, ss)
		snap.Events = append(snap.Events, st.events...)
	}
	sort.SliceStable(snap.Events, func(i, j int) bool {
		return eventTime(snap.Events[i]).After(eventTime(snap.Events[j]))
	})
	if len(snap.Events) > MaxEvents {
		snap.Events = snap.Events[:MaxEvents]
	}
	return snap
}

func eventTime(e store.Event) time.Time {
	switch {
	case e.ObservedAt != nil:
		return *e.ObservedAt
	case e.ReportedAt != nil:
		return *e.ReportedAt
	default:
		return e.IngestedAt
	}
}

// uid derives a stable UUID-shaped id from (source, upstream id), so the same
// record always gets the same event_uid and clients can dedupe across polls.
func uid(source, id string) string {
	sum := sha256.Sum256([]byte(source + "|" + id))
	sum[6] = (sum[6] & 0x0f) | 0x50 // version 5 style, name-based
	sum[8] = (sum[8] & 0x3f) | 0x80 // RFC 4122 variant
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[0:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}

// lastRefresh is the newest successful fetch time, so generated_at describes
// the data rather than the moment a response happened to be built.
func (h *Hub) lastRefresh() time.Time {
	var t time.Time
	for _, st := range h.state {
		if st.lastSuccess.After(t) {
			t = st.lastSuccess
		}
	}
	if t.IsZero() {
		t = h.now()
	}
	return t
}

// Encoded is a snapshot ready to send: JSON, its gzip form and an ETag.
type Encoded struct {
	JSON []byte
	Gzip []byte
	ETag string
}

// EncodedSnapshot is Snapshot, encoded once per data change and cached.
func (h *Hub) EncodedSnapshot(ctx context.Context) (*Encoded, error) {
	h.Snapshot(ctx) // triggers a refresh when a source is due
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.encoded != nil && h.encodedVersion == h.version {
		return h.encoded, nil
	}
	body, err := json.Marshal(h.buildLocked())
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
	if _, err := zw.Write(body); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	sum := sha256.Sum256(body)
	h.encoded = &Encoded{JSON: body, Gzip: buf.Bytes(), ETag: fmt.Sprintf(`"%x"`, sum[:12])}
	h.encodedVersion = h.version
	return h.encoded, nil
}
