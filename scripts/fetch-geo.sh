#!/bin/sh
# Downloads the DB-IP Lite city and ASN databases (CC BY 4.0) into geo/.
# DB-IP publishes a new file each month; fall back to last month early on.
set -eu
dir="$(dirname "$0")/../geo"
mkdir -p "$dir"
this=$(date -u +%Y-%m)
last=$(date -u -d "$(date -u +%Y-%m-15) -1 month" +%Y-%m 2>/dev/null || date -u -v-1m +%Y-%m)
for kind in city asn; do
  out="$dir/dbip-$kind-lite.mmdb"
  for month in "$this" "$last"; do
    url="https://download.db-ip.com/free/dbip-$kind-lite-$month.mmdb.gz"
    if curl -fsS --retry 2 -A "BreachScope build (+https://github.com/VijaysinghPuwar/BreachScope)" "$url" | gunzip > "$out.tmp"; then
      mv "$out.tmp" "$out"
      echo "fetched $url"
      break
    fi
  done
  test -s "$out" || { echo "could not fetch DB-IP $kind database" >&2; exit 1; }
done
