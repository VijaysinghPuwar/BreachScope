//go:build geoembed

package geoip

import _ "embed"

// Vercel's Go runtime does not bundle extra files with a function, so the
// production build compiles the databases into the binary instead. The build
// downloads them into embedded/ first (see vercel.json and
// scripts/fetch-geo.sh); this file is only compiled with -tags geoembed.

//go:embed embedded/dbip-city-lite.mmdb
var embeddedCity []byte

//go:embed embedded/dbip-asn-lite.mmdb
var embeddedASN []byte

func embedded() (city, asn []byte, ok bool) { return embeddedCity, embeddedASN, true }
