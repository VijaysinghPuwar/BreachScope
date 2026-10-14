// Package app builds the HTTP handler from config. Both entry points use it.
package app

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/internal/config"
	"github.com/VijaysinghPuwar/BreachScope/internal/db"
	"github.com/VijaysinghPuwar/BreachScope/internal/feeds"
	"github.com/VijaysinghPuwar/BreachScope/internal/geoip"
	"github.com/VijaysinghPuwar/BreachScope/internal/httpapi"
	"github.com/VijaysinghPuwar/BreachScope/internal/store"
	"github.com/VijaysinghPuwar/BreachScope/internal/stream"
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
	if err != nil {
		// The feeds still work without it; events just carry no location.
		log.Warn("geoip unavailable, events will not be located", "err", err)
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

// openGeo looks for the DB-IP files in the configured directory, then next to
// the working directory and the executable. Vercel bundles them via
// includeFiles, and the function's working directory is not documented.
func openGeo(dir string) (*geoip.DB, error) {
	candidates := []string{dir, "geo", "../geo"}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "geo"))
	}
	var firstErr error
	for _, c := range candidates {
		if c == "" {
			continue
		}
		db, err := geoip.Open(c)
		if err == nil {
			return db, nil
		}
		if firstErr == nil {
			firstErr = err
		}
	}
	return nil, firstErr
}
