package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// writerLockKey serialises every event writer. See InsertEvents.
const writerLockKey = 1

// NewEvent is what an ingester hands to InsertEvents. UID must be derived from
// (source, upstream id) so re-ingesting the same record is a no-op.
type NewEvent struct {
	UID             string
	SourceID        int16
	SourceRecordID  *string
	Category        int16
	Severity        int16
	Confidence      *int16
	ConfidenceBasis string
	ObservedAt      *time.Time
	ReportedAt      *time.Time
	ValidUntil      *time.Time
	SrcIP           *string
	SrcASN          *int32
	SrcCountry      *string
	SrcLat, SrcLon  *float32
	DstSensor       *string
	DstCountry      *string
	DstLat, DstLon  *float32
	GeoMethod       string
	GeoAccuracyKm   *int32
}

// InsertEvents writes a batch and returns how many rows were new.
//
// Why the advisory lock: seq comes from an identity column, so two writers can
// take seq 104 and 105 and commit 105 first. A stream reader polling
// "seq > 103" would then see 105, move its cursor past 104, and never see 104.
// Holding one transaction-scoped lock for every writer makes commit order
// equal seq order, so a cursor never skips a row that commits later.
func (s *Store) InsertEvents(ctx context.Context, evs []NewEvent) (int64, error) {
	var inserted int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, writerLockKey); err != nil {
			return fmt.Errorf("take writer lock: %w", err)
		}
		for _, e := range evs {
			tag, err := tx.Exec(ctx, `
INSERT INTO event (event_uid, source_id, source_record_id, category, severity,
  confidence, confidence_basis, observed_at, reported_at, valid_until,
  src_ip, src_asn, src_country, src_lat, src_lon,
  dst_sensor, dst_country, dst_lat, dst_lon, geo_method, geo_accuracy_km)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::inet,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
ON CONFLICT (event_uid) DO NOTHING`,
				e.UID, e.SourceID, e.SourceRecordID, e.Category, e.Severity,
				e.Confidence, e.ConfidenceBasis, e.ObservedAt, e.ReportedAt, e.ValidUntil,
				e.SrcIP, e.SrcASN, e.SrcCountry, e.SrcLat, e.SrcLon,
				e.DstSensor, e.DstCountry, e.DstLat, e.DstLon, e.GeoMethod, e.GeoAccuracyKm)
			if err != nil {
				return fmt.Errorf("insert %s: %w", e.UID, err)
			}
			inserted += tag.RowsAffected()
		}
		return nil
	})
	return inserted, err
}

// UpsertSource creates or updates a source row and returns its id.
func (s *Store) UpsertSource(ctx context.Context, name, dataClass, licence string, minInterval time.Duration, providesPairs bool) (int16, error) {
	var id int16
	err := s.pool.QueryRow(ctx, `
INSERT INTO source (name, data_class, licence, min_interval, provides_pairs)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (name) DO UPDATE SET data_class = EXCLUDED.data_class, licence = EXCLUDED.licence,
  min_interval = EXCLUDED.min_interval, provides_pairs = EXCLUDED.provides_pairs
RETURNING id`, name, dataClass, licence, minInterval, providesPairs).Scan(&id)
	return id, err
}
