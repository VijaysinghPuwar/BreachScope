//go:build !geoembed

package geoip

func embedded() (city, asn []byte, ok bool) { return nil, nil, false }
