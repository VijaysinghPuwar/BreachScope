package feeds

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/pkg/geoip"
	"github.com/VijaysinghPuwar/BreachScope/pkg/store"
)

var testNow = time.Date(2026, 10, 14, 19, 30, 0, 0, time.UTC)

func testGeo(t *testing.T) *geoip.DB {
	t.Helper()
	db, err := geoip.Open("../../geo")
	if err != nil {
		t.Skipf("DB-IP databases not present: %v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func byID(evs []store.Event) map[string]store.Event {
	m := map[string]store.Event{}
	for _, e := range evs {
		m[*e.SourceRecordID] = e
	}
	return m
}

func TestParseThreatFox(t *testing.T) {
	evs, err := parseThreatFox(fixture(t, "threatfox.json"), testGeo(t), testNow)
	if err != nil {
		t.Fatal(err)
	}
	m := byID(evs)
	if _, ok := m["1000000"]; ok {
		t.Error("record older than 48 h was kept")
	}
	c2 := m["1965861"]
	if c2.Category != "c2_server" || c2.Severity != 3 || *c2.Confidence != 100 {
		t.Errorf("c2 fields: %+v", c2)
	}
	if c2.SrcIP == nil || *c2.SrcIP != "8.8.8.8" || c2.Attrs["port"] != 80 {
		t.Errorf("ip:port not split: ip=%v attrs=%v", c2.SrcIP, c2.Attrs)
	}
	if c2.GeoMethod == geoip.MethodNone || c2.SrcCountry == nil {
		t.Errorf("c2 not located: %s", c2.GeoMethod)
	}
	url := m["1965862"]
	if url.GeoMethod != geoip.MethodNone || url.SrcLat != nil {
		t.Error("a URL indicator with a hostname must not be placed on the map")
	}
	if got := url.Attrs["url"]; got != "hxxp://bad[.]example[.]com/a.sh" {
		t.Errorf("url not defanged: %v", got)
	}
	if evs[0].ReportedAt.Before(*evs[1].ReportedAt) {
		t.Error("events not newest first")
	}
}

func TestParseURLhaus(t *testing.T) {
	m := byID(must(parseURLhaus(fixture(t, "urlhaus.json"), testGeo(t), testNow)))
	online := m["3950205"]
	if online.Severity != 2 || online.SrcIP == nil || *online.SrcIP != "8.8.4.4" {
		t.Errorf("online IP url: %+v", online)
	}
	if want := time.Date(2026, 10, 14, 18, 47, 6, 0, time.UTC); !online.ReportedAt.Equal(want) {
		t.Errorf("reported_at %v want %v", online.ReportedAt, want)
	}
	if off := m["3950206"]; off.Severity != 1 || off.SrcIP != nil {
		t.Errorf("offline hostname url: %+v", off)
	}
}

func TestParseDShieldSkipsPrivateAndFixesPadding(t *testing.T) {
	evs := must(parseDShield(fixture(t, "dshield.json"), testGeo(t), testNow))
	if len(evs) != 2 {
		t.Fatalf("got %d events", len(evs))
	}
	if *evs[0].SrcIP != "8.8.8.8" || evs[0].Severity != 2 || evs[0].DataClass != "aggregate_telemetry" {
		t.Errorf("first: ip=%s sev=%d", *evs[0].SrcIP, evs[0].Severity)
	}
	if evs[1].GeoMethod != geoip.MethodNone {
		t.Errorf("private address was located: %s", evs[1].GeoMethod)
	}
	if !strings.Contains(evs[0].ConfidenceBasis, "410604 reports against 500 targets") {
		t.Errorf("basis %q", evs[0].ConfidenceBasis)
	}
}

func TestParseKEVKeepsLast30Days(t *testing.T) {
	evs := must(parseKEV(fixture(t, "kev.json"), nil, testNow))
	if len(evs) != 1 || evs[0].Attrs["cve"] != "CVE-2026-0001" || evs[0].Severity != 4 {
		t.Fatalf("got %+v", evs)
	}
	if evs[0].SrcLat != nil || evs[0].GeoMethod != geoip.MethodNone {
		t.Error("a vulnerability must not have a location")
	}
}

func TestParseFeodo(t *testing.T) {
	evs := must(parseFeodo(fixture(t, "feodo.json"), testGeo(t), testNow))
	if len(evs) != 1 || evs[0].Severity != 3 || evs[0].Attrs["malware"] != "QakBot" {
		t.Fatalf("got %+v", evs)
	}
}

func TestUIDIsStableAndDistinct(t *testing.T) {
	a, b := uid("URLhaus", "1"), uid("URLhaus", "1")
	if a != b || a == uid("ThreatFox", "1") || len(a) != 36 || a[14] != '5' {
		t.Fatalf("uid %s %s", a, b)
	}
}

func TestDefang(t *testing.T) {
	cases := map[string]string{
		"http://1.2.3.4:80/i":       "hxxp://1[.]2[.]3[.]4:80/i",
		"https://a.example/b?c=d.e": "hxxps://a[.]example/b?c=d.e",
		"not a url http://x":        "not a url hxxp://x",
	}
	for in, want := range cases {
		if got := defang(in); got != want {
			t.Errorf("defang(%q) = %q, want %q", in, got, want)
		}
	}
}

func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}

// TestHubIsPoliteToFeeds checks the rules that keep us from being blocked:
// no refetch inside MinInterval, conditional requests, one fetch for many
// concurrent viewers, and a 429 that keeps the previous data.
func TestHubIsPoliteToFeeds(t *testing.T) {
	var hits atomic.Int32
	var status atomic.Int32
	status.Store(http.StatusOK)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if !strings.Contains(r.UserAgent(), "BreachScope") || !strings.Contains(r.UserAgent(), "@") {
			t.Errorf("user agent without contact: %q", r.UserAgent())
		}
		if r.Header.Get("If-None-Match") == `"v1"` && status.Load() == http.StatusOK {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		if s := int(status.Load()); s != http.StatusOK {
			w.WriteHeader(s)
			return
		}
		w.Header().Set("ETag", `"v1"`)
		_, _ = w.Write(fixture(t, "feodo.json"))
	}))
	defer srv.Close()

	src := Source{Name: "Feodo Tracker", DataClass: "indicator", Licence: "CC0", FeedURL: srv.URL,
		MinInterval: time.Minute, Parse: parseFeodo}
	h := NewHub([]Source{src}, srv.Client(), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	clock := testNow
	h.now = func() time.Time { return clock }

	// Twenty viewers at once cause one upstream request.
	done := make(chan Snapshot, 20)
	for range 20 {
		go func() { done <- h.Snapshot(context.Background()) }()
	}
	for range 20 {
		if s := <-done; len(s.Events) != 1 {
			t.Fatalf("snapshot has %d events", len(s.Events))
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("%d upstream hits for 20 concurrent viewers, want 1", hits.Load())
	}

	// Inside the interval: no request at all.
	clock = clock.Add(30 * time.Second)
	h.Snapshot(context.Background())
	if hits.Load() != 1 {
		t.Fatalf("refetched inside MinInterval")
	}

	// After the interval: a conditional request, answered 304, data kept.
	clock = clock.Add(time.Minute)
	s := h.Snapshot(context.Background())
	if hits.Load() != 2 || len(s.Events) != 1 || s.Sources[0].LastError != "" {
		t.Fatalf("after 304: hits=%d events=%d err=%q", hits.Load(), len(s.Events), s.Sources[0].LastError)
	}

	// Rate limited: the error is reported and the last good data stays.
	status.Store(http.StatusTooManyRequests)
	clock = clock.Add(2 * time.Minute)
	s = h.Snapshot(context.Background())
	if len(s.Events) != 1 || !strings.Contains(s.Sources[0].LastError, "429") {
		t.Fatalf("after 429: events=%d err=%q", len(s.Events), s.Sources[0].LastError)
	}
}
