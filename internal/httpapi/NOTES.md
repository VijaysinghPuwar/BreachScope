# httpapi: routes

| Route | What it returns |
|---|---|
| `GET /api/healthz` | `{"status":"ok","db":"ok"|"down"|"unconfigured","version":...}`. Always 200 so uptime checks can tell "API up, DB down" apart. |
| `GET /api/events` | `{"events":[...],"next_after":N}`. Query: `after`, `limit` (1 to 1000, default 200), `class` (comma list), `min_severity`, `country`, `asn` (`64500` or `AS64500`). |
| `GET /api/stream` | SSE. See `internal/stream/NOTES.md`. |
| `GET /api/sse-test` | One tick per second, no database, closes at the stream limit. Used to prove streaming works on a Vercel preview. |

## Errors
Every error is JSON: `{"error":"...","request_id":"..."}`. The same id is in the `X-Request-ID` header and in the server log line, so a user can quote it and you can find the exact request.

`503 database not configured` means `DATABASE_URL` is unset. `503 database unavailable` means the query failed. `400` means the input failed validation and the message says which parameter.

## Why chi
chi is a thin router over the standard `net/http` types. Handlers are ordinary `http.HandlerFunc`s, so the same code runs in a Vercel function, in `cmd/apiserver` and in `httptest` without adapters.
