package geoip

import (
	"net/netip"
	"os"
	"testing"
)

func openTestDB(t *testing.T) *DB {
	t.Helper()
	dir := os.Getenv("GEOIP_DIR")
	if dir == "" {
		dir = "../../geo"
	}
	db, err := Open(dir)
	if err != nil {
		t.Skipf("DB-IP databases not present (%v); run scripts/fetch-geo.sh", err)
	}
	t.Cleanup(db.Close)
	return db
}

func TestLookupPublicAddress(t *testing.T) {
	db := openTestDB(t)
	// 8.8.8.8 is a long-lived, well-known address.
	loc, ok := db.Lookup(netip.MustParseAddr("8.8.8.8"))
	if !ok || loc.CountryCode == "" {
		t.Fatalf("no result for 8.8.8.8: %+v", loc)
	}
	if loc.HasPoint && (loc.Lat < -90 || loc.Lat > 90 || loc.Lon < -180 || loc.Lon > 180) {
		t.Fatalf("coordinates out of range: %+v", loc)
	}
	if loc.ASN == 0 {
		t.Errorf("expected an ASN for 8.8.8.8")
	}
	if m := loc.Method(ok); m != MethodCity && m != MethodCountry {
		t.Errorf("method %q", m)
	}
}

func TestLookupRejectsNonPublic(t *testing.T) {
	db := openTestDB(t)
	for _, s := range []string{"10.0.0.1", "192.168.1.1", "127.0.0.1", "::1", "fe80::1", "0.0.0.0"} {
		if _, ok := db.Lookup(netip.MustParseAddr(s)); ok {
			t.Errorf("%s should not be located", s)
		}
	}
}

func TestNilDBIsSafe(t *testing.T) {
	var db *DB
	if _, ok := db.Lookup(netip.MustParseAddr("8.8.8.8")); ok {
		t.Fatal("nil DB returned a location")
	}
	db.Close()
}
