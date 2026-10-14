package store_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/pkg/store"
	"github.com/VijaysinghPuwar/BreachScope/pkg/testpg"
)

func ptr[T any](v T) *T { return &v }

func telEvent(i int, srcID int16) store.NewEvent {
	now := time.Now().UTC()
	return store.NewEvent{
		UID:             fmt.Sprintf("00000000-0000-4000-8000-%012d", i),
		SourceID:        srcID,
		SourceRecordID:  ptr(fmt.Sprintf("cowrie-%d", i)),
		Category:        1,
		Severity:        int16(i % 5),
		Confidence:      ptr[int16](100),
		ConfidenceBasis: "Direct observation on owned sensor",
		ObservedAt:      &now,
		SrcIP:           ptr("198.51.100.23"),
		SrcASN:          ptr[int32](64500),
		SrcCountry:      ptr("NL"),
		SrcLat:          ptr[float32](52.37),
		SrcLon:          ptr[float32](4.89),
		DstSensor:       ptr("sensor-eus1"),
		DstLat:          ptr[float32](37.3719),
		DstLon:          ptr[float32](-79.8164),
		GeoMethod:       "geolite2_city",
		GeoAccuracyKm:   ptr[int32](50),
	}
}

func TestInsertIsIdempotentAndFiltersWork(t *testing.T) {
	pool := testpg.Start(t)
	s := store.New(pool)
	ctx := context.Background()

	srcID, err := s.UpsertSource(ctx, "Cowrie (test)", "telemetry", "Own data", 6*time.Hour, true)
	if err != nil {
		t.Fatal(err)
	}
	var interval string
	if err := pool.QueryRow(ctx, `SELECT min_interval::text FROM source WHERE id = $1`, srcID).Scan(&interval); err != nil || interval != "06:00:00" {
		t.Fatalf("min_interval stored as %q, err %v; want 06:00:00", interval, err)
	}
	batch := []store.NewEvent{telEvent(1, srcID), telEvent(2, srcID), telEvent(3, srcID)}
	ioc := telEvent(4, srcID)
	ioc.SrcIP = ptr("2001:db8:5::/48")
	ioc.SrcCountry = ptr("DE")
	ioc.DstSensor, ioc.DstLat, ioc.DstLon = nil, nil, nil
	batch = append(batch, ioc)

	n, err := s.InsertEvents(ctx, batch)
	if err != nil || n != 4 {
		t.Fatalf("first insert: %d rows, err %v", n, err)
	}
	n, err = s.InsertEvents(ctx, batch)
	if err != nil || n != 0 {
		t.Fatalf("re-insert added %d rows, err %v; want 0", n, err)
	}

	all, err := s.EventsAfter(ctx, store.Filter{})
	if err != nil || len(all) != 4 {
		t.Fatalf("all: %d, err %v", len(all), err)
	}
	if all[0].DataClass != "telemetry" || all[0].Licence != "Own data" || all[0].CategoryLabel != "SSH brute force" {
		t.Errorf("join fields wrong: %+v", all[0])
	}
	if *all[0].SrcIP != "198.51.100.23" {
		t.Errorf("host inet rendered as %q, want no /32 suffix", *all[0].SrcIP)
	}
	if *all[3].SrcIP != "2001:db8:5::/48" {
		t.Errorf("netblock rendered as %q", *all[3].SrcIP)
	}

	de, _ := s.EventsAfter(ctx, store.Filter{Country: "de"})
	if len(de) != 1 {
		t.Errorf("country filter: %d rows, want 1", len(de))
	}
	page, _ := s.EventsAfter(ctx, store.Filter{After: all[1].Seq, Limit: 1})
	if len(page) != 1 || page[0].Seq != all[2].Seq {
		t.Errorf("cursor paging returned %+v", page)
	}
	hi, _ := s.EventsAfter(ctx, store.Filter{MinSeverity: 3})
	for _, e := range hi {
		if e.Severity < 3 {
			t.Errorf("min_severity leaked severity %d", e.Severity)
		}
	}
	latest, err := s.LatestSeq(ctx)
	if err != nil || latest != all[3].Seq {
		t.Errorf("LatestSeq = %d, err %v", latest, err)
	}
}

func TestEventRejectsHalfACoordinate(t *testing.T) {
	pool := testpg.Start(t)
	s := store.New(pool)
	ctx := context.Background()
	srcID, _ := s.UpsertSource(ctx, "x", "telemetry", "Own data", 0, true)
	e := telEvent(1, srcID)
	e.DstLon = nil
	if _, err := s.InsertEvents(ctx, []store.NewEvent{e}); err == nil {
		t.Fatal("insert with dst_lat but no dst_lon succeeded")
	}
}
