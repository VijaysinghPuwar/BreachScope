// Package config reads settings from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	DatabaseURL       string        // pooled URL used by request handlers
	Port              string        // only used by cmd/api, Vercel picks its own
	StreamMaxDuration time.Duration // SSE connection lifetime
	Version           string        // git commit, shown by /api/healthz
	GeoIPDir          string        // folder holding the DB-IP .mmdb files
}

func Load() (Config, error) {
	c := Config{
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		Port:              getenv("PORT", "8080"),
		StreamMaxDuration: 280 * time.Second,
		Version:           getenv("VERCEL_GIT_COMMIT_SHA", "dev"),
		GeoIPDir:          os.Getenv("GEOIP_DIR"),
	}
	if v := os.Getenv("STREAM_MAX_SECONDS"); v != "" {
		n, err := strconv.Atoi(v)
		// 290 leaves headroom under Vercel's 300 s function limit.
		if err != nil || n < 1 || n > 290 {
			return c, fmt.Errorf("STREAM_MAX_SECONDS must be 1 to 290, got %q", v)
		}
		c.StreamMaxDuration = time.Duration(n) * time.Second
	}
	return c, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
