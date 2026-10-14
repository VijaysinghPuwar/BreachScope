// Package testpg starts a throwaway Postgres for integration tests.
package testpg

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/VijaysinghPuwar/BreachScope/pkg/db"
)

// Start runs Postgres 16 in a container, applies the migrations twice (the
// second run must be a no-op) and returns a pool. Set SKIP_DOCKER_TESTS=1 to
// skip on a machine without Docker.
func Start(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if os.Getenv("SKIP_DOCKER_TESTS") == "1" {
		t.Skip("SKIP_DOCKER_TESTS=1")
	}
	ctx := context.Background()
	ctr, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("breachscope"),
		postgres.WithUsername("bs"),
		postgres.WithPassword("bs"),
		postgres.BasicWaitStrategies(),
	)
	testcontainers.CleanupContainer(t, ctr)
	if err != nil {
		t.Fatal(err)
	}
	url, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}

	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	if _, err := db.Migrate(ctx, conn); err != nil {
		t.Fatal(err)
	}
	again, err := db.Migrate(ctx, conn)
	if err != nil || len(again) != 0 {
		t.Fatalf("second migrate applied %v, err %v; want nothing", again, err)
	}

	pool, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}
