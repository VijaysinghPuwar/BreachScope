package feeds

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/pkg/geoip"
	"github.com/VijaysinghPuwar/BreachScope/pkg/store"
)

// Our own Cowrie honeypot (infra/azure). It is the only source that saw the
// traffic itself, so its events are telemetry with both ends known: the
// attacker's address and our sensor. The sensor's position is the published
// centre of its Azure region, never a geolocation of the VM.

const (
	sensorName = "sensor-eus1"
	sensorLat  = float32(37.3719)
	sensorLon  = float32(-79.8164)
	// A signed response older than this is refused, so an old capture
	// cannot be replayed.
	sensorMaxAge = 10 * time.Minute
)

// sensorSource is enabled when SENSOR_URL and SENSOR_HMAC_SECRET are set.
func sensorSource() (Source, bool) {
	url := strings.TrimSpace(os.Getenv("SENSOR_URL"))
	secret := strings.TrimSpace(os.Getenv("SENSOR_HMAC_SECRET"))
	if url == "" || secret == "" {
		return Source{}, false
	}
	return Source{
		Name: "Cowrie (sensor-eus1)", DataClass: "telemetry", Licence: "Own data",
		URL: "https://github.com/cowrie/cowrie", FeedURL: url,
		MinInterval: 2 * time.Minute,
		Verify:      verifySensor([]byte(secret)),
		Parse:       parseSensor,
	}, true
}

var errBadSignature = errors.New("bad or missing signature")

func verifySensor(secret []byte) func(http.Header, []byte, time.Time) error {
	return func(h http.Header, body []byte, now time.Time) error {
		stamp := h.Get("X-Timestamp")
		sig, err := hex.DecodeString(h.Get("X-Signature"))
		if stamp == "" || err != nil {
			return errBadSignature
		}
		mac := hmac.New(sha256.New, secret)
		mac.Write([]byte(stamp + "."))
		mac.Write(body)
		if !hmac.Equal(mac.Sum(nil), sig) {
			return errBadSignature
		}
		secs, err := strconv.ParseInt(stamp, 10, 64)
		if err != nil {
			return errBadSignature
		}
		if age := now.Sub(time.Unix(secs, 0)); age > sensorMaxAge || age < -time.Minute {
			return fmt.Errorf("signed response is %s old", age.Round(time.Second))
		}
		return nil
	}
}

func parseSensor(body []byte, geo *geoip.DB, now time.Time) ([]store.Event, error) {
	var raw struct {
		Groups []struct {
			SrcIP          string   `json:"src_ip"`
			Protocol       string   `json:"protocol"`
			Hour           string   `json:"hour"`
			FirstSeen      string   `json:"first_seen"`
			LastSeen       string   `json:"last_seen"`
			Sessions       int      `json:"sessions"`
			LoginAttempts  int      `json:"login_attempts"`
			LoginSuccesses int      `json:"login_successes"`
			Commands       int      `json:"commands"`
			TopUsernames   []string `json:"top_usernames"`
		} `json:"groups"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	src := Source{Name: "Cowrie (sensor-eus1)", DataClass: "telemetry", Licence: "Own data"}
	var evs []store.Event
	for _, g := range raw.Groups {
		ip, err := netip.ParseAddr(g.SrcIP)
		if err != nil {
			continue
		}
		e := base(src, g.SrcIP+"|"+g.Protocol+"|"+g.Hour, now)
		e.ObservedAt = parseTime(time.RFC3339Nano, g.LastSeen)
		e.ReportedAt = e.ObservedAt
		if g.Protocol == "telnet" {
			e.Category, e.CategoryLabel = "telnet_login", "Telnet login attempts"
		} else {
			e.Category, e.CategoryLabel = "ssh_bruteforce", "SSH brute force"
		}
		// Getting into the fake shell or running commands is worse than guessing.
		switch {
		case g.LoginSuccesses > 0 || g.Commands > 0:
			e.Severity = 3
		case g.LoginAttempts >= 20:
			e.Severity = 2
		default:
			e.Severity = 1
		}
		e.Confidence = ptr[int16](100)
		e.ConfidenceBasis = "Direct observation on owned sensor"
		locate(&e, geo, ip)
		name := sensorName
		e.DstSensor = &name
		e.DstLat, e.DstLon = ptr(sensorLat), ptr(sensorLon)
		e.Attrs["sensor"] = "configured · Azure East US"
		e.Attrs["protocol"] = g.Protocol
		e.Attrs["sessions"] = g.Sessions
		e.Attrs["login_attempts"] = g.LoginAttempts
		e.Attrs["logins_accepted_by_honeypot"] = g.LoginSuccesses
		e.Attrs["commands"] = g.Commands
		e.Attrs["first_seen"] = g.FirstSeen
		if len(g.TopUsernames) > 0 {
			e.Attrs["usernames_tried"] = strings.Join(g.TopUsernames, ", ")
		}
		evs = append(evs, e)
	}
	return evs, nil
}
