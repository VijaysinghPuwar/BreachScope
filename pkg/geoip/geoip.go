// Package geoip places IP addresses using the DB-IP Lite databases
// (CC BY 4.0, https://db-ip.com). Lookups happen at ingest, never per page view.
package geoip

import (
	"errors"
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"strings"

	"github.com/oschwald/maxminddb-golang/v2"
)

// Location is what we know about where an address is announced from.
// Lat and Lon are zero when only the country is known; check HasPoint.
type Location struct {
	City        string
	CountryCode string
	CountryName string
	Lat, Lon    float64
	HasPoint    bool
	ASN         uint32
	ASName      string
}

// Method names stored in event.geo_method.
const (
	MethodCity    = "dbip_city_lite"
	MethodCountry = "dbip_country"
	MethodNone    = "none"
)

type DB struct {
	city *maxminddb.Reader
	asn  *maxminddb.Reader // optional
}

// Open loads the databases from dir. The ASN database is optional.
func Open(dir string) (*DB, error) {
	city, err := maxminddb.Open(filepath.Join(dir, "dbip-city-lite.mmdb"))
	if err != nil {
		return nil, fmt.Errorf("open city database: %w", err)
	}
	db := &DB{city: city}
	if asn, err := maxminddb.Open(filepath.Join(dir, "dbip-asn-lite.mmdb")); err == nil {
		db.asn = asn
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("open asn database: %w", err)
	}
	return db, nil
}

// OpenEmbedded returns the databases compiled into the binary, if this build
// has them (-tags geoembed). ok is false otherwise.
func OpenEmbedded() (db *DB, ok bool, err error) {
	city, asn, ok := embedded()
	if !ok {
		return nil, false, nil
	}
	c, err := maxminddb.OpenBytes(city)
	if err != nil {
		return nil, true, fmt.Errorf("embedded city database: %w", err)
	}
	db = &DB{city: c}
	if a, err := maxminddb.OpenBytes(asn); err == nil {
		db.asn = a
	}
	return db, true, nil
}

type cityRecord struct {
	City struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"city"`
	Country struct {
		ISOCode string            `maxminddb:"iso_code"`
		Names   map[string]string `maxminddb:"names"`
	} `maxminddb:"country"`
	Location struct {
		Latitude  *float64 `maxminddb:"latitude"`
		Longitude *float64 `maxminddb:"longitude"`
	} `maxminddb:"location"`
}

type asnRecord struct {
	Number uint32 `maxminddb:"autonomous_system_number"`
	Org    string `maxminddb:"autonomous_system_organization"`
}

// Lookup returns the location of ip. ok is false for private, reserved or
// unknown addresses.
func (d *DB) Lookup(ip netip.Addr) (loc Location, ok bool) {
	if d == nil || !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return loc, false
	}
	var rec cityRecord
	if err := d.city.Lookup(ip.Unmap()).Decode(&rec); err != nil || rec.Country.ISOCode == "" {
		return loc, false
	}
	loc.CountryCode = strings.ToUpper(rec.Country.ISOCode)
	loc.CountryName = rec.Country.Names["en"]
	loc.City = rec.City.Names["en"]
	// A city-level record has both coordinates and a city name. DB-IP also
	// carries coordinates for country-only records (the country's centre),
	// and those must not be drawn as if they were a real point.
	if rec.Location.Latitude != nil && rec.Location.Longitude != nil && loc.City != "" {
		loc.Lat, loc.Lon, loc.HasPoint = *rec.Location.Latitude, *rec.Location.Longitude, true
	}
	if d.asn != nil {
		var a asnRecord
		if err := d.asn.Lookup(ip.Unmap()).Decode(&a); err == nil {
			loc.ASN, loc.ASName = a.Number, a.Org
		}
	}
	return loc, true
}

// Method is the geo_method value for a lookup result.
func (l Location) Method(ok bool) string {
	switch {
	case !ok:
		return MethodNone
	case l.HasPoint:
		return MethodCity
	default:
		return MethodCountry
	}
}

func (d *DB) Close() {
	if d == nil {
		return
	}
	d.city.Close()
	if d.asn != nil {
		d.asn.Close()
	}
}
