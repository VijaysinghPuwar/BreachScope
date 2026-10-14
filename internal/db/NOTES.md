# db: connection pool and migrations

## What it does
- `Open` builds a pgx connection pool from `DATABASE_URL`.
- `Migrate` applies the SQL files in `migrations/` in name order and records each one in `schema_migration`.

## Why the pool is small
A Vercel function instance can be frozen between requests. Every open connection counts against Neon's limit, so the pool keeps at most 4 connections and drops idle ones after 30 s.

## Why `QueryExecModeExec`
Neon's pooled URL goes through PgBouncer in transaction mode. One client transaction can land on a different server connection than the next one. pgx normally prepares statements on the server and reuses them, which breaks when the next query lands elsewhere. Exec mode sends each query with its parameters in one round trip and prepares nothing on the server.

## Why migrations take an advisory lock
`pg_advisory_lock(key)` is a named mutex inside Postgres. If two deploys start at once, the second waits until the first has finished, then sees the versions already recorded and skips them. A session lock only works on a direct connection, so `cmd/migrate` prefers `DATABASE_URL_UNPOOLED`.

## Schema in one paragraph per table
- `source`: one row per feed. Holds the licence and the data class, so every event can show where it came from and what you may do with it.
- `category`: a lookup table for event categories, so labels live in one place.
- `event`: one observation, indicator or report. `seq` is the stream cursor. `event_uid` is a hash of (source, upstream id), and its UNIQUE index makes re-ingesting the same record a no-op. Two CHECK constraints refuse half a coordinate, because an arc needs both ends.
- `rollup_hourly`: counts per hour, kept after raw events are pruned. `UNIQUE NULLS NOT DISTINCT` treats NULL country as one value, so upserts into it work.
- `app_user`, `user_role`: who signed in and what they may do. Roles live in our database, not in the identity provider.
- `investigation`, `investigation_event`, `investigation_share`: saved work. Pinned events keep a JSON snapshot so pruning raw events never breaks an investigation.
- `anomaly`: robust-z results with every number used, so the UI can show its work.
- `ingest_nonce`: one-time values from the honeypot shipper, to reject replayed batches.

## Indexes
- `observed_at DESC`: newest first for the feed.
- `(category, severity, src_country, observed_at DESC)`: the common filter combination.
- `(src_asn, observed_at DESC)`: "everything from this network".
- GiST on `src_ip inet_ops`: lets `src_ip << '198.51.100.0/24'` (inside this subnet) use an index.
