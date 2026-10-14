# stream: server-sent events with resume

## The wire format
SSE is a plain HTTP response with `Content-Type: text/event-stream` that never finishes until the server closes it. Each message is a few `field: value` lines and a blank line:

```
id: 884213
event: events
data: [{"seq":884210,...},{"seq":884213,...}]

```

- `retry: 1000` at the start tells the browser to wait 1 s before reconnecting.
- `event: events` carries a JSON array of events. `id` is the `seq` of the last event in the batch.
- `event: close` with `{"reason":"max_duration"}` is sent just before a planned close.
- `event: error` means the database failed. The browser reconnects and resumes.
- `: ping` is a comment sent every 15 s when idle, so proxies don't drop a quiet connection.

## How resume works
The browser's `EventSource` remembers the last `id` it received. When the connection ends for any reason, it reconnects and sends that value in a `Last-Event-ID` header. The server reads the header (or `?after=` on the first connect) and continues from there. Nothing is kept on the server between connections, so any instance can serve the reconnect.

## Why 280 s
Vercel Hobby kills a function at 300 s. Closing at 280 s on purpose means the close is clean and planned, with 20 s of headroom. `STREAM_MAX_SECONDS` overrides it.

## The poll loop
Every second the handler asks Postgres for `seq > cursor`. If a full batch comes back it asks again at once, so a client that reconnects far behind catches up quickly. The handler holds no database connection between polls.

## Without a cursor
A brand new client gets only new events: the handler starts at `max(seq)`. The client is expected to load history from `GET /api/events` first and then open the stream with `?after=` set to that page's `next_after`.

## The forced-reconnect test
`reconnect_integration_test.go` runs Postgres in Docker, has 4 writers insert 1,200 events (half the batches sent twice), and has a client drop its connection at random points and reconnect with `Last-Event-ID`. At the end it compares the set of `event_uid` values the client saw with the set in the database. The test passes only with zero missing and zero duplicates. It compares sets, not `seq` numbers, because `seq` has holes.
