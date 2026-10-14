# store: hand-written SQL

## Reading: `EventsAfter`
One query, cursor paging: `WHERE seq > $after ORDER BY seq LIMIT $n`. The client passes back the last `seq` it saw. This is faster and more stable than `OFFSET`, which rescans skipped rows and shifts when new rows arrive.

Optional filters use the pattern `($4 = '' OR src_country = $4)`. An empty value turns that filter off, so one prepared shape serves every combination. All values are bind parameters, never string-built SQL, so there is no injection path.

`abbrev(src_ip)` prints a single host as `198.51.100.23` and a netblock as `2001:db8:5::/48`. Plain `::text` would print `/32` on every host.

Nullable columns scan into pointers, and JSON omits them when NULL. "Unknown" and "zero" are different facts.

`Filter.Validate` checks every value before SQL sees it: class names from a fixed list, severity 0 to 4, two-letter country, limit 1 to 1000.

## Writing: `InsertEvents`
Every writer takes `pg_advisory_xact_lock(1)` inside its transaction. The problem it solves: `seq` values are handed out when a row is inserted, but rows become visible when the transaction commits. Writer A takes seq 104, writer B takes 105, B commits first. A reader polling `seq > 103` sees 105, moves its cursor to 105, and never sees 104. With the lock, writers commit one at a time in seq order, so a cursor can never jump over a row that is still in flight.

`ON CONFLICT (event_uid) DO NOTHING` makes ingest idempotent. It also burns a `seq` value, which is why `seq` has holes and is only ever used as a cursor.

## Tests
`store_integration_test.go` starts a real Postgres 16 in Docker (Testcontainers), applies the migrations twice, and checks idempotent inserts, filters, cursor paging and the coordinate CHECK constraints.
