package feeds

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/pkg/geoip"
	"github.com/VijaysinghPuwar/BreachScope/pkg/store"
)

// Cloudflare Radar publishes which countries layer 7 attacks come from and
// which they target, as shares of the traffic Cloudflare mitigated. It is the
// one public source that names both ends, so these are the only arcs drawn
// for third-party data. Both ends are countries, so each end sits at the
// country's centroid and the event says so (geo_method country_centroid).

// MethodCountryCentroid marks an end placed at the centre of its country.
const MethodCountryCentroid = "country_centroid"

//go:embed centroids.json
var centroidsJSON []byte

// centroids maps ISO alpha-2 codes to [lat, lon], from the Natural Earth
// country label points the map uses (largest polygon of each country).
var centroids = func() map[string][2]float32 {
	var m map[string][2]float32
	if err := json.Unmarshal(centroidsJSON, &m); err != nil {
		panic(err)
	}
	return m
}()

const radarURL = "https://api.cloudflare.com/client/v4/radar/attacks/layer7/top/attacks" +
	"?limit=20&dateRange=1d&limitDirection=ORIGIN&limitPerLocation=3&format=JSON"

// radarSource is enabled only when CLOUDFLARE_API_TOKEN is set.
func radarSource() (Source, bool) {
	token := strings.TrimSpace(os.Getenv("CLOUDFLARE_API_TOKEN"))
	if token == "" {
		return Source{}, false
	}
	return Source{
		Name: "Cloudflare Radar", DataClass: "aggregate_telemetry", Licence: "CC BY-NC 4.0 (Cloudflare Radar)",
		URL: "https://radar.cloudflare.com", FeedURL: radarURL,
		Header:      map[string]string{"Authorization": "Bearer " + token},
		MinInterval: time.Hour, Parse: parseRadar,
	}, true
}

func parseRadar(body []byte, _ *geoip.DB, now time.Time) ([]store.Event, error) {
	var raw struct {
		Success bool `json:"success"`
		Result  struct {
			Meta struct {
				LastUpdated string `json:"lastUpdated"`
				DateRange   []struct {
					StartTime string `json:"startTime"`
					EndTime   string `json:"endTime"`
				} `json:"dateRange"`
			} `json:"meta"`
			Top []struct {
				Origin     string `json:"originCountryAlpha2"`
				OriginName string `json:"originCountryName"`
				Target     string `json:"targetCountryAlpha2"`
				TargetName string `json:"targetCountryName"`
				Value      string `json:"value"`
			} `json:"top_0"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	if !raw.Success {
		return nil, fmt.Errorf("radar responded with success=false")
	}
	src := Source{Name: "Cloudflare Radar", DataClass: "aggregate_telemetry", Licence: "CC BY-NC 4.0 (Cloudflare Radar)"}
	reported := parseTime(time.RFC3339, raw.Result.Meta.LastUpdated)
	window := ""
	if len(raw.Result.Meta.DateRange) > 0 {
		window = raw.Result.Meta.DateRange[0].StartTime + "/" + raw.Result.Meta.DateRange[0].EndTime
	}
	var evs []store.Event
	for _, p := range raw.Result.Top {
		from, okFrom := centroids[strings.ToUpper(p.Origin)]
		to, okTo := centroids[strings.ToUpper(p.Target)]
		share, err := strconv.ParseFloat(p.Value, 64)
		if !okFrom || !okTo || err != nil || p.Origin == p.Target {
			continue
		}
		e := base(src, window+"|"+p.Origin+"|"+p.Target, now)
		e.ReportedAt = reported
		e.Category, e.CategoryLabel = "l7_attack_pair", "L7 attacks (country pair)"
		e.Severity = 1
		switch {
		case share >= 10:
			e.Severity = 3
		case share >= 3:
			e.Severity = 2
		}
		e.ConfidenceBasis = fmt.Sprintf("Cloudflare Radar: %.2f%% of mitigated layer 7 attack traffic in the last 24 h", share)
		oc, tc := strings.ToUpper(p.Origin), strings.ToUpper(p.Target)
		e.SrcCountry, e.DstCountry = &oc, &tc
		e.SrcLat, e.SrcLon = ptr(from[0]), ptr(from[1])
		e.DstLat, e.DstLon = ptr(to[0]), ptr(to[1])
		e.GeoMethod = MethodCountryCentroid
		e.Attrs["share_percent"] = share
		e.Attrs["origin_name"] = p.OriginName
		e.Attrs["target_name"] = p.TargetName
		e.Attrs["window"] = window
		evs = append(evs, e)
	}
	return evs, nil
}
