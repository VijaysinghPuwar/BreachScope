// Package store holds the hand-written SQL for reading and writing events.
package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Event is one row of the event table joined with its source and category.
// Pointer fields are nullable columns; they are omitted from JSON when NULL so
// the client never mistakes "unknown" for zero.
type Event struct {
	Seq              int64          `json:"seq"`
	UID              string         `json:"event_uid"`
	Source           string         `json:"source"`
	DataClass        string         `json:"data_class"`
	Licence          string         `json:"licence"`
	SourceRecordID   *string        `json:"source_record_id,omitempty"`
	Category         string         `json:"category"`
	CategoryLabel    string         `json:"category_label"`
	Severity         int16          `json:"severity"`
	Confidence       *int16         `json:"confidence,omitempty"`
	ConfidenceBasis  string         `json:"confidence_basis"`
	ObservedAt       *time.Time     `json:"observed_at,omitempty"`
	ReportedAt       *time.Time     `json:"reported_at,omitempty"`
	IngestedAt       time.Time      `json:"ingested_at"`
	ValidUntil       *time.Time     `json:"valid_until,omitempty"`
	SrcIP            *string        `json:"src_ip,omitempty"`
	SrcASN           *int32         `json:"src_asn,omitempty"`
	SrcCountry       *string        `json:"src_country,omitempty"`
	SrcLat           *float32       `json:"src_lat,omitempty"`
	SrcLon           *float32       `json:"src_lon,omitempty"`
	DstSensor        *string        `json:"dst_sensor,omitempty"`
	DstCountry       *string        `json:"dst_country,omitempty"`
	DstLat           *float32       `json:"dst_lat,omitempty"`
	DstLon           *float32       `json:"dst_lon,omitempty"`
	GeoMethod        string         `json:"geo_method"`
	GeoAccuracyKm    *int32         `json:"geo_accuracy_km,omitempty"`
	AttackTechniques []string       `json:"attack_techniques,omitempty"`
	Attrs            map[string]any `json:"attrs,omitempty"`
}

// Filter narrows a page of events. Zero values mean "no filter".
type Filter struct {
	After       int64    // return events with seq > After
	Limit       int      // 1..MaxLimit
	Classes     []string // data_class values
	MinSeverity int16
	Country     string // ISO 3166-1 alpha-2, upper case
	ASN         int32
}

const (
	DefaultLimit = 200
	MaxLimit     = 1000
)

var ErrBadFilter = errors.New("bad filter")

var validClasses = map[string]bool{
	"simulated": true, "telemetry": true, "aggregate_telemetry": true,
	"indicator": true, "vulnerability": true, "breach_report": true,
}

// Validate normalises the filter in place and rejects values the SQL must
// never see.
func (f *Filter) Validate() error {
	if f.After < 0 {
		return fmt.Errorf("%w: after must be >= 0", ErrBadFilter)
	}
	if f.Limit == 0 {
		f.Limit = DefaultLimit
	}
	if f.Limit < 1 || f.Limit > MaxLimit {
		return fmt.Errorf("%w: limit must be 1 to %d", ErrBadFilter, MaxLimit)
	}
	for _, c := range f.Classes {
		if !validClasses[c] {
			return fmt.Errorf("%w: unknown class %q", ErrBadFilter, c)
		}
	}
	if f.MinSeverity < 0 || f.MinSeverity > 4 {
		return fmt.Errorf("%w: min_severity must be 0 to 4", ErrBadFilter)
	}
	if f.Country != "" {
		f.Country = strings.ToUpper(f.Country)
		if len(f.Country) != 2 || f.Country[0] < 'A' || f.Country[0] > 'Z' || f.Country[1] < 'A' || f.Country[1] > 'Z' {
			return fmt.Errorf("%w: country must be two letters", ErrBadFilter)
		}
	}
	if f.ASN < 0 {
		return fmt.Errorf("%w: asn must be positive", ErrBadFilter)
	}
	return nil
}

// Store reads events. It is safe for concurrent use.
type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

const selectEvents = `
SELECT e.seq, e.event_uid::text, s.name, s.data_class, s.licence, e.source_record_id,
       c.slug, c.label, e.severity, e.confidence, e.confidence_basis,
       e.observed_at, e.reported_at, e.ingested_at, e.valid_until,
       abbrev(e.src_ip), e.src_asn, e.src_country, e.src_lat, e.src_lon,
       e.dst_sensor, e.dst_country, e.dst_lat, e.dst_lon,
       e.geo_method, e.geo_accuracy_km, e.attack_techniques, e.attrs
FROM event e
JOIN source s   ON s.id = e.source_id
JOIN category c ON c.id = e.category
WHERE e.seq > $1
  AND (cardinality($2::text[]) = 0 OR s.data_class = ANY($2))
  AND e.severity >= $3
  AND ($4 = '' OR e.src_country = $4)
  AND ($5 = 0 OR e.src_asn = $5)
ORDER BY e.seq
LIMIT $6`

// EventsAfter returns up to f.Limit events with seq greater than f.After, in
// seq order. The caller uses the last seq as the next cursor.
func (s *Store) EventsAfter(ctx context.Context, f Filter) ([]Event, error) {
	if err := f.Validate(); err != nil {
		return nil, err
	}
	classes := f.Classes
	if classes == nil {
		classes = []string{}
	}
	rows, err := s.pool.Query(ctx, selectEvents, f.After, classes, f.MinSeverity, f.Country, f.ASN, f.Limit)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	return pgx.CollectRows(rows, scanEvent)
}

func scanEvent(row pgx.CollectableRow) (Event, error) {
	var e Event
	err := row.Scan(
		&e.Seq, &e.UID, &e.Source, &e.DataClass, &e.Licence, &e.SourceRecordID,
		&e.Category, &e.CategoryLabel, &e.Severity, &e.Confidence, &e.ConfidenceBasis,
		&e.ObservedAt, &e.ReportedAt, &e.IngestedAt, &e.ValidUntil,
		&e.SrcIP, &e.SrcASN, &e.SrcCountry, &e.SrcLat, &e.SrcLon,
		&e.DstSensor, &e.DstCountry, &e.DstLat, &e.DstLon,
		&e.GeoMethod, &e.GeoAccuracyKm, &e.AttackTechniques, &e.Attrs,
	)
	return e, err
}

// Ping reports whether the database answers. Neon may take about a second to
// wake from autosuspend, so callers should give it a generous timeout.
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// LatestSeq returns the highest committed seq, or 0 when the table is empty.
func (s *Store) LatestSeq(ctx context.Context) (int64, error) {
	var seq int64
	err := s.pool.QueryRow(ctx, `SELECT coalesce(max(seq), 0) FROM event`).Scan(&seq)
	return seq, err
}
