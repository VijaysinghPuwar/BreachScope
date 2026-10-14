# feeds: public threat feeds without a database

## What it does
`Hub.Snapshot` returns the latest events from five public feeds, merged and sorted newest first. `GET /api/live` serves it.

## The refresh rule
Each `Source` has a `MinInterval`. When a request arrives, any source whose last attempt is older than its interval is fetched again; the others are served from memory. Only one refresh runs at a time: twenty visitors arriving together share one upstream request (`TestHubIsPoliteToFeeds` proves this).

The refresh runs on its own context, not the visitor's. If the visitor leaves, the fetch still finishes and the next visitor gets fresh data.

## How we avoid being blocked
- Minimum intervals at or above each operator's guidance (URLhaus and ThreatFox exports update every 5 minutes, so we never fetch more often).
- A `User-Agent` with the project URL and a contact address. DShield asks for this.
- Conditional requests (`If-None-Match`, `If-Modified-Since`). A `304` costs the operator almost nothing.
- A `429` keeps the last good data and is shown as the source's `last_error`.
- The API response carries `Cache-Control: s-maxage=120, stale-while-revalidate=600`. Vercel's CDN answers repeat visitors itself, so our function, and therefore the feeds, see a small fraction of page views.

## Honest locations
- `locate` asks DB-IP for the IP. A city-level answer gets coordinates (`geo_method = dbip_city_lite`). A country-only answer gets the country code and no coordinates (`dbip_country`), and the map shades the country instead of drawing a fake point at its centre.
- DB-IP Lite does not publish an accuracy radius, so `geo_accuracy_km` is left empty rather than guessed.
- URLs and domains are not resolved to IPs. Resolving would contact infrastructure run by the people we are tracking, and the answer changes by resolver and time.

## Event ids
`uid(source, upstream id)` hashes the pair into a UUID-shaped string. The same record always has the same id, so the browser can merge polls without duplicates.
