# BreachScope

A threat-intelligence console that is honest about its data. Observations, indicators and reports are shown on a flat map or a globe, in a live feed and on a timeline. Every record carries its source, licence, three timestamps, a confidence value with its basis, and how precise its location is.

Status: early development. The console runs on real public threat feeds today. Saved investigations, sign-in, replay and a self-hosted honeypot (the only source that can draw true source-to-target arcs) come next.

## Principles

- An arc is drawn only when the source provides both ends. An indicator is a point, never an arc.
- Approximate locations carry an accuracy ring and the method used to locate them.
- An indicator is labelled as reported, not as an attack.
- Runs at $0 on free tiers. Nothing in the stack bills on overage.

## Stack

| Layer | Choice |
|---|---|
| Web | React 18, TypeScript, Vite, Tailwind, Radix, MapLibre GL JS (flat and globe) |
| API | Go, `net/http`, chi, pgx v5, hand-written SQL |
| Live updates | Server-sent events with a `seq` cursor and `Last-Event-ID` resume |
| Database | Postgres 16 (Neon in production) |
| Hosting | Vercel (static site and one Go function) |

## Layout

```
api/            Vercel Go function (one handler, all /api routes)
cmd/apiserver/  the same router as a standalone server (Docker, local)
cmd/migrate/    applies schema migrations
cmd/ssecheck/   holds an SSE connection against a deployment and reports drops
internal/
  db/           pool setup and embedded migrations
  store/        SQL for reading and writing events
  stream/       SSE handler with cursor resume
  httpapi/      routes, validation, error shape
web/            React app
```

Each package has a `NOTES.md` explaining how it works and why.

## Run locally

Requirements: Go 1.26+, Node 24+, Docker.

```sh
docker compose up -d --build        # Postgres on :55432, API on :8080
curl localhost:8080/api/healthz

cd web
npm install
npm run dev                         # http://localhost:5173
```

## API

| Route | Purpose |
|---|---|
| `GET /api/healthz` | API and database status |
| `GET /api/events?after=&limit=&class=&min_severity=&country=&asn=` | One page of events after a `seq` cursor |
| `GET /api/stream?after=` | Server-sent events. Resumes from `Last-Event-ID`. Closes cleanly at 280 s |
| `GET /api/live` | Merged snapshot of the public feeds, newest first, every IP placed with DB-IP. CDN-cacheable |
| `GET /api/sse-test` | One tick per second with no database, to test streaming on a deployment |

## Tests

```sh
go vet ./... && staticcheck ./...
go test -race ./...                 # needs Docker for the Postgres tests

cd web
npm run typecheck && npm run lint && npm test
npm run test:e2e                    # Playwright and axe at 1440, 1024, 820 and 390 px
```

`internal/stream/reconnect_integration_test.go` runs four concurrent writers against a real Postgres while a client drops and resumes its connection at random points, then checks that the set of event ids it received equals the set in the database: nothing missing, nothing twice.

## Data sources and licences

| Source | What it is | Class | Refresh (at most) | Licence |
|---|---|---|---|---|
| [ThreatFox](https://threatfox.abuse.ch) | C2 servers and payload hosts | indicator | every 5 min | CC0 |
| [URLhaus](https://urlhaus.abuse.ch) | URLs serving malware | indicator | every 5 min | CC0 |
| [Feodo Tracker](https://feodotracker.abuse.ch) | Botnet C2 servers | indicator | every 15 min | CC0 |
| [DShield](https://isc.sans.edu) | Top sources seen by SANS ISC sensors | aggregate telemetry | every 30 min | CC BY-NC-SA 4.0 |
| [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) | Exploited vulnerabilities | vulnerability | hourly | CC0 |
| [DB-IP Lite](https://db-ip.com) | IP to city and ASN | location | monthly | CC BY 4.0 |
| [Natural Earth](https://www.naturalearthdata.com) | Basemap | | | Public domain |

How the feeds are treated:
- Requests identify BreachScope with a contact address, respect a minimum interval per source, and use conditional requests. The API response is cached by the CDN, so visitor traffic never multiplies upstream traffic.
- An IP that DB-IP places in a city is drawn at that city and labelled `approx · city`. An IP known only to its country shades the country; it is never drawn as a point in the middle of it. Hostnames are not resolved and are listed, not mapped.
- None of these feeds says who was targeted, so the map draws no arcs for them.
- Malicious URLs are defanged (`hxxp`, `[.]`) and never rendered as links.

This is a non-commercial project. IP location identifies a network, not a person.
