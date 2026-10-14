# geoip: placing IP addresses

Uses the DB-IP Lite city and ASN databases (CC BY 4.0). They are MaxMind-format (`.mmdb`) files: a binary search tree over IP ranges, so a lookup is a few memory reads and needs no network.

- `scripts/fetch-geo.sh` downloads this month's files (falling back to last month's early in a month). Vercel runs it during the build and bundles `geo/` with the function.
- Private, loopback and link-local addresses are never located.
- A record with a city name and coordinates is a city-level result. Anything else is country-level and gets no coordinates. DB-IP stores a country centroid for some records; drawing that would put a dot in the middle of a country that the data never pointed to.
- Attribution: "IP geolocation by DB-IP" appears in the map attribution and the README.
