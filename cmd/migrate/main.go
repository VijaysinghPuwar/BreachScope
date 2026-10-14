// Command migrate applies the embedded schema migrations. Point it at the
// direct (unpooled) database URL, because the migration lock is a session
// advisory lock and a transaction-mode pooler would drop it.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/VijaysinghPuwar/BreachScope/pkg/db"
)

func main() {
	url := os.Getenv("DATABASE_URL_UNPOOLED")
	if url == "" {
		url = os.Getenv("DATABASE_URL")
	}
	if url == "" {
		fmt.Fprintln(os.Stderr, "set DATABASE_URL_UNPOOLED or DATABASE_URL")
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect:", err)
		os.Exit(1)
	}
	defer conn.Close(context.Background())

	applied, err := db.Migrate(ctx, conn)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if len(applied) == 0 {
		fmt.Println("schema up to date")
		return
	}
	for _, v := range applied {
		fmt.Println("applied", v)
	}
}
