package feeds

import (
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/pkg/geoip"
	"github.com/VijaysinghPuwar/BreachScope/pkg/store"
)

// recentWindow limits the large feeds to what is actually recent. URLhaus and
// ThreatFox exports cover weeks; the console is about the last two days.
const recentWindow = 48 * time.Hour

// perSourceCap keeps one busy feed from crowding out the others.
const perSourceCap = 1200

// Default returns the sources used in production. Intervals follow each
// operator's guidance or are slower than it.
func Default() []Source {
	return []Source{
		{
			Name: "ThreatFox", DataClass: "indicator", Licence: "CC0 (abuse.ch)",
			URL: "https://threatfox.abuse.ch", FeedURL: "https://threatfox.abuse.ch/export/json/recent/",
			MinInterval: 5 * time.Minute, Parse: parseThreatFox,
		},
		{
			Name: "URLhaus", DataClass: "indicator", Licence: "CC0 (abuse.ch)",
			URL: "https://urlhaus.abuse.ch", FeedURL: "https://urlhaus.abuse.ch/downloads/json_recent/",
			MinInterval: 5 * time.Minute, Parse: parseURLhaus,
		},
		{
			Name: "Feodo Tracker", DataClass: "indicator", Licence: "CC0 (abuse.ch)",
			URL: "https://feodotracker.abuse.ch", FeedURL: "https://feodotracker.abuse.ch/downloads/ipblocklist.json",
			MinInterval: 15 * time.Minute, Parse: parseFeodo,
		},
		{
			Name: "DShield", DataClass: "aggregate_telemetry", Licence: "CC BY-NC-SA 4.0 (SANS ISC)",
			URL: "https://isc.sans.edu", FeedURL: "https://isc.sans.edu/api/sources/attacks/100?json",
			MinInterval: 30 * time.Minute, Parse: parseDShield,
		},
		{
			Name: "CISA KEV", DataClass: "vulnerability", Licence: "CC0 (CISA)",
			URL:         "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
			FeedURL:     "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
			MinInterval: time.Hour, Parse: parseKEV,
		},
		{
			Name: "Have I Been Pwned", DataClass: "breach_report", Licence: "CC BY 4.0 (haveibeenpwned.com)",
			URL: "https://haveibeenpwned.com/PwnedWebsites", FeedURL: "https://haveibeenpwned.com/api/v3/breaches",
			MinInterval: time.Hour, Parse: parseHIBP,
		},
	}
}

// base fills the fields every event shares.
func base(src Source, id string, now time.Time) store.Event {
	return store.Event{
		UID:            uid(src.Name, id),
		Source:         src.Name,
		DataClass:      src.DataClass,
		Licence:        src.Licence,
		SourceRecordID: &id,
		IngestedAt:     now.UTC(),
		GeoMethod:      geoip.MethodNone,
		Attrs:          map[string]any{},
	}
}

// locate fills the location fields from an IP. Country-only results get no
// coordinates, so the client shades the country instead of inventing a point.
func locate(e *store.Event, geo *geoip.DB, ip netip.Addr) {
	ipStr := ip.String()
	e.SrcIP = &ipStr
	loc, ok := geo.Lookup(ip)
	e.GeoMethod = loc.Method(ok)
	if !ok {
		return
	}
	cc := loc.CountryCode
	e.SrcCountry = &cc
	e.Attrs["country_name"] = loc.CountryName
	if loc.City != "" {
		e.Attrs["city"] = loc.City
	}
	if loc.HasPoint {
		lat, lon := float32(loc.Lat), float32(loc.Lon)
		e.SrcLat, e.SrcLon = &lat, &lon
	}
	if loc.ASN != 0 {
		asn := int32(loc.ASN)
		e.SrcASN = &asn
		e.Attrs["as_name"] = loc.ASName
	}
}

func parseTime(layout, v string) *time.Time {
	t, err := time.Parse(layout, strings.TrimSpace(v))
	if err != nil {
		return nil
	}
	t = t.UTC()
	return &t
}

func ptr[T any](v T) *T { return &v }

// defang makes a malicious URL safe to display and impossible to click by
// accident: http becomes hxxp and the dots in the host become [.].
func defang(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return strings.ReplaceAll(raw, "http", "hxxp")
	}
	host := strings.ReplaceAll(u.Host, ".", "[.]")
	scheme := strings.Replace(u.Scheme, "http", "hxxp", 1)
	rest := strings.TrimPrefix(raw, u.Scheme+"://"+u.Host)
	return scheme + "://" + host + rest
}

func keepRecent(evs []store.Event, now time.Time) []store.Event {
	out := evs[:0]
	for _, e := range evs {
		if e.ReportedAt != nil && now.Sub(*e.ReportedAt) <= recentWindow {
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ReportedAt.After(*out[j].ReportedAt) })
	if len(out) > perSourceCap {
		out = out[:perSourceCap]
	}
	return out
}

func parseThreatFox(body []byte, geo *geoip.DB, now time.Time) ([]store.Event, error) {
	src := Default()[0]
	var raw map[string][]struct {
		IOCValue   string `json:"ioc_value"`
		IOCType    string `json:"ioc_type"`
		ThreatType string `json:"threat_type"`
		Malware    string `json:"malware_printable"`
		FirstSeen  string `json:"first_seen_utc"`
		Confidence int16  `json:"confidence_level"`
		Tags       string `json:"tags"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	var evs []store.Event
	for id, recs := range raw {
		for _, r := range recs {
			e := base(src, id, now)
			e.ReportedAt = parseTime(time.DateTime, r.FirstSeen)
			e.Confidence = ptr(r.Confidence)
			e.ConfidenceBasis = fmt.Sprintf("ThreatFox confidence level %d", r.Confidence)
			e.Attrs["malware"] = r.Malware
			e.Attrs["threat"] = r.ThreatType
			e.Attrs["ioc_type"] = r.IOCType
			switch r.ThreatType {
			case "botnet_cc":
				e.Category, e.CategoryLabel, e.Severity = "c2_server", "C2 server", 3
			case "payload_delivery":
				e.Category, e.CategoryLabel, e.Severity = "payload_delivery", "Payload delivery", 2
			default:
				e.Category, e.CategoryLabel, e.Severity = "malware_ioc", "Malware indicator", 2
			}
			switch r.IOCType {
			case "ip:port":
				host, port, err := net.SplitHostPort(r.IOCValue)
				if ip, perr := netip.ParseAddr(host); err == nil && perr == nil {
					locate(&e, geo, ip)
					if p, err := strconv.Atoi(port); err == nil {
						e.Attrs["port"] = p
					}
				}
			case "url":
				e.Attrs["url"] = defang(r.IOCValue)
			case "domain":
				e.Attrs["domain"] = strings.ReplaceAll(r.IOCValue, ".", "[.]")
			default:
				e.Attrs["hash"] = r.IOCValue
			}
			evs = append(evs, e)
		}
	}
	return keepRecent(evs, now), nil
}

func parseURLhaus(body []byte, geo *geoip.DB, now time.Time) ([]store.Event, error) {
	src := Default()[1]
	var raw map[string][]struct {
		DateAdded string `json:"dateadded"`
		URL       string `json:"url"`
		Status    string `json:"url_status"`
		Threat    string `json:"threat"`
		Reporter  string `json:"reporter"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	var evs []store.Event
	for id, recs := range raw {
		for _, r := range recs {
			e := base(src, id, now)
			e.ReportedAt = parseTime("2006-01-02 15:04:05 MST", r.DateAdded)
			e.Category, e.CategoryLabel = "malware_url", "Malware URL"
			e.Severity = 1
			if r.Status == "online" {
				e.Severity = 2
			}
			e.ConfidenceBasis = "Reported to URLhaus by " + r.Reporter
			e.Attrs["url"] = defang(r.URL)
			e.Attrs["status"] = r.Status
			e.Attrs["threat"] = r.Threat
			if u, err := url.Parse(r.URL); err == nil {
				if ip, err := netip.ParseAddr(u.Hostname()); err == nil {
					locate(&e, geo, ip)
				}
			}
			evs = append(evs, e)
		}
	}
	return keepRecent(evs, now), nil
}

// ParseFeodo is exported for tests that need a real parser.
var ParseFeodo = parseFeodo

func parseFeodo(body []byte, geo *geoip.DB, now time.Time) ([]store.Event, error) {
	src := Default()[2]
	var raw []struct {
		IP         string `json:"ip_address"`
		Port       int    `json:"port"`
		Status     string `json:"status"`
		Malware    string `json:"malware"`
		FirstSeen  string `json:"first_seen"`
		LastOnline string `json:"last_online"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	var evs []store.Event
	for _, r := range raw {
		ip, err := netip.ParseAddr(r.IP)
		if err != nil {
			continue
		}
		e := base(src, r.IP, now)
		e.ReportedAt = parseTime(time.DateTime, r.FirstSeen)
		e.ObservedAt = parseTime(time.DateOnly, r.LastOnline)
		e.Category, e.CategoryLabel = "botnet_c2", "Botnet C2 server"
		e.Severity = 1
		if r.Status == "online" {
			e.Severity = 3
		}
		e.ConfidenceBasis = "Verified C2 server, Feodo Tracker"
		e.Attrs["malware"] = r.Malware
		e.Attrs["status"] = r.Status
		e.Attrs["port"] = r.Port
		locate(&e, geo, ip)
		evs = append(evs, e)
	}
	return evs, nil
}

func parseDShield(body []byte, geo *geoip.DB, now time.Time) ([]store.Event, error) {
	src := Default()[3]
	var raw []struct {
		IP        string `json:"ip"`
		Attacks   int    `json:"attacks"`
		Count     int    `json:"count"`
		FirstSeen string `json:"firstseen"`
		LastSeen  string `json:"lastseen"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	var evs []store.Event
	for _, r := range raw {
		// DShield zero-pads addresses ("079.124.059.078") in some endpoints.
		ip, err := netip.ParseAddr(trimOctets(r.IP))
		if err != nil {
			continue
		}
		e := base(src, ip.String()+"|"+r.LastSeen, now)
		e.ObservedAt = parseTime(time.DateOnly, r.LastSeen)
		e.ReportedAt = e.ObservedAt
		e.Category, e.CategoryLabel = "scanning_source", "Scanning source"
		e.Severity = 1
		if r.Count >= 100_000 {
			e.Severity = 2
		}
		e.ConfidenceBasis = fmt.Sprintf("Seen by DShield sensors: %d reports against %d targets", r.Count, r.Attacks)
		e.Attrs["reports"] = r.Count
		e.Attrs["targets"] = r.Attacks
		e.Attrs["first_seen"] = r.FirstSeen
		locate(&e, geo, ip)
		evs = append(evs, e)
	}
	return evs, nil
}

func trimOctets(s string) string {
	if strings.Contains(s, ":") {
		return s
	}
	parts := strings.Split(s, ".")
	for i, p := range parts {
		if n, err := strconv.Atoi(p); err == nil {
			parts[i] = strconv.Itoa(n)
		}
	}
	return strings.Join(parts, ".")
}

func parseKEV(body []byte, _ *geoip.DB, now time.Time) ([]store.Event, error) {
	src := Default()[4]
	var raw struct {
		Vulnerabilities []struct {
			CVE        string `json:"cveID"`
			Vendor     string `json:"vendorProject"`
			Product    string `json:"product"`
			Name       string `json:"vulnerabilityName"`
			DateAdded  string `json:"dateAdded"`
			DueDate    string `json:"dueDate"`
			Ransomware string `json:"knownRansomwareCampaignUse"`
		} `json:"vulnerabilities"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	var evs []store.Event
	for _, v := range raw.Vulnerabilities {
		added := parseTime(time.DateOnly, v.DateAdded)
		// The catalogue goes back to 2021; the console shows the last 30 days.
		if added == nil || now.Sub(*added) > 30*24*time.Hour {
			continue
		}
		e := base(src, v.CVE, now)
		e.ReportedAt = added
		e.Category, e.CategoryLabel = "known_exploited_vuln", "Known exploited vuln"
		e.Severity = 3
		if v.Ransomware == "Known" {
			e.Severity = 4
		}
		e.Confidence = ptr[int16](100)
		e.ConfidenceBasis = "Authoritative: CISA KEV catalogue"
		e.Attrs["cve"] = v.CVE
		e.Attrs["vendor"] = v.Vendor
		e.Attrs["product"] = v.Product
		e.Attrs["name"] = v.Name
		e.Attrs["due_date"] = v.DueDate
		e.Attrs["ransomware"] = v.Ransomware
		evs = append(evs, e)
	}
	return evs, nil
}

// breachWindow is how far back breach disclosures are shown. They arrive a few
// times a week, so 90 days keeps the list useful without the whole catalogue.
const breachWindow = 90 * 24 * time.Hour

func parseHIBP(body []byte, _ *geoip.DB, now time.Time) ([]store.Event, error) {
	src := Default()[5]
	var raw []struct {
		Name          string   `json:"Name"`
		Title         string   `json:"Title"`
		Domain        string   `json:"Domain"`
		BreachDate    string   `json:"BreachDate"`
		AddedDate     string   `json:"AddedDate"`
		PwnCount      int      `json:"PwnCount"`
		DataClasses   []string `json:"DataClasses"`
		IsVerified    bool     `json:"IsVerified"`
		IsFabricated  bool     `json:"IsFabricated"`
		IsSpamList    bool     `json:"IsSpamList"`
		IsSensitive   bool     `json:"IsSensitive"`
		IsStealerLog  bool     `json:"IsStealerLog"`
		DisclosureURL string   `json:"DisclosureUrl"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	var evs []store.Event
	for _, b := range raw {
		added := parseTime(time.RFC3339, b.AddedDate)
		// Fabricated breaches and spam lists are not breaches of the named
		// organisation, and sensitive breaches are hidden by HIBP itself.
		if added == nil || now.Sub(*added) > breachWindow || b.IsFabricated || b.IsSpamList || b.IsSensitive {
			continue
		}
		e := base(src, b.Name, now)
		e.ReportedAt = added
		e.Category, e.CategoryLabel = "breach_disclosure", "Data breach"
		e.Severity = breachSeverity(b.PwnCount, b.DataClasses)
		if b.IsVerified {
			e.Confidence = ptr[int16](100)
			e.ConfidenceBasis = "Verified by Have I Been Pwned"
		} else {
			e.Confidence = ptr[int16](50)
			e.ConfidenceBasis = "Listed by Have I Been Pwned, not verified"
		}
		e.Attrs["organisation"] = b.Title
		e.Attrs["domain"] = b.Domain
		e.Attrs["breach_date"] = b.BreachDate
		e.Attrs["records"] = b.PwnCount
		e.Attrs["data_types"] = strings.Join(b.DataClasses, ", ")
		e.Attrs["verified"] = b.IsVerified
		if b.DisclosureURL != "" {
			e.Attrs["disclosure_url"] = b.DisclosureURL
		}
		evs = append(evs, e)
	}
	return evs, nil
}

// breachSeverity ranks a breach by size and by what leaked. Passwords and
// financial data raise it regardless of size.
func breachSeverity(records int, dataClasses []string) int16 {
	for _, c := range dataClasses {
		switch c {
		case "Passwords", "Bank account numbers", "Credit cards", "Partial credit card data", "Government issued IDs", "Social security numbers":
			return 4
		}
	}
	switch {
	case records >= 1_000_000:
		return 3
	case records >= 100_000:
		return 2
	default:
		return 1
	}
}
