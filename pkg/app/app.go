// Package app builds the HTTP handler from config. Both entry points use it.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/pkg/config"
	"github.com/VijaysinghPuwar/BreachScope/pkg/db"
	"github.com/VijaysinghPuwar/BreachScope/pkg/feeds"
	"github.com/VijaysinghPuwar/BreachScope/pkg/geoip"
	"github.com/VijaysinghPuwar/BreachScope/pkg/httpapi"
	"github.com/VijaysinghPuwar/BreachScope/pkg/store"
	"github.com/VijaysinghPuwar/BreachScope/pkg/stream"
)

// Build returns the handler and a close function. Opening the pool does not
// connect yet; pgxpool dials on first use, so a cold start without traffic to
// the database never wakes Neon.
func Build(ctx context.Context, cfg config.Config, log *slog.Logger) (http.Handler, func(), error) {
	deps := httpapi.Deps{
		Stream:  stream.DefaultConfig(),
		Version: cfg.Version,
		Log:     log,
	}
	deps.Stream.MaxDuration = cfg.StreamMaxDuration

	geo, err := openGeo(cfg.GeoIPDir)
	deps.GeoStatus = "ok"
	if err != nil {
		// The feeds still work without it; events just carry no location.
		log.Warn("geoip unavailable, events will not be located", "err", err)
		deps.GeoStatus = "missing: " + err.Error()
	}
	deps.Live = feeds.NewHub(feeds.Default(), &http.Client{Timeout: 30 * time.Second}, geo, log)

	closeFn := func() {}
	if cfg.DatabaseURL != "" {
		pool, err := db.Open(ctx, cfg.DatabaseURL)
		if err != nil {
			return nil, nil, err
		}
		deps.Events = store.New(pool)
		closeFn = pool.Close
	}
	return httpapi.NewRouter(deps), closeFn, nil
}

// openGeo uses the databases compiled into the binary when the build has them
// (production on Vercel), otherwise it looks for the files on disk.
func openGeo(dir string) (*geoip.DB, error) {
	if db, ok, err := geoip.OpenEmbedded(); ok {
		return db, err
	}
	candidates := []string{dir, "geo", "../geo"}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "geo"))
	}
	var tried []string
	for _, c := range candidates {
		if c == "" {
			continue
		}
		db, err := geoip.Open(c)
		if err == nil {
			return db, nil
		}
		abs, _ := filepath.Abs(c)
		tried = append(tried, abs)
	}
	return nil, fmt.Errorf("DB-IP files not found in %s", strings.Join(tried, ", "))
}
