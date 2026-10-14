// Command ssecheck holds an SSE connection open against a deployed URL for a
// set time, reconnecting whenever the server closes, and reports how long each
// connection lasted and whether any tick went missing. It is the M0 proof that
// a Go function on Vercel can stream for the full 280 s.
//
//	go run ./cmd/ssecheck -url https://<preview>.vercel.app/api/sse-test -for 1h
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/internal/stream"
)

func main() {
	url := flag.String("url", "http://localhost:8080/api/sse-test", "SSE endpoint")
	total := flag.Duration("for", time.Hour, "how long to keep reconnecting")
	minHold := flag.Duration("min-hold", 270*time.Second, "a connection shorter than this counts as a failure")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, *total)
	defer cancel()

	var conns, short, gaps int
	for ctx.Err() == nil {
		conns++
		start := time.Now()
		ticks, gap, reason, err := hold(ctx, *url)
		held := time.Since(start).Round(time.Second)
		gaps += gap
		status := "ok"
		if ctx.Err() == nil && held < *minHold {
			short++
			status = "SHORT"
		}
		fmt.Printf("%s conn %d held %v ticks %d gaps %d close=%q err=%v %s\n",
			time.Now().UTC().Format("15:04:05"), conns, held, ticks, gap, reason, err, status)
		if err != nil && ctx.Err() == nil {
			time.Sleep(2 * time.Second)
		}
	}
	fmt.Printf("connections %d, short %d, gaps %d\n", conns, short, gaps)
	if short > 0 || gaps > 0 {
		os.Exit(1)
	}
}

// hold reads one connection until it ends. Tick ids restart at 1 on every
// connection, so a gap is any id that is not the previous one plus one.
func hold(ctx context.Context, url string) (ticks, gaps int, reason string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, 0, "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, 0, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, 0, "", fmt.Errorf("status %s", resp.Status)
	}
	last := 0
	err = stream.ReadMessages(resp.Body, func(m stream.Message) bool {
		switch m.Event {
		case "tick":
			id, _ := strconv.Atoi(m.ID)
			if id != last+1 {
				gaps++
			}
			last = id
			ticks++
		case "close":
			var c struct {
				Held int `json:"held_seconds"`
			}
			_ = json.Unmarshal([]byte(m.Data), &c)
			reason = fmt.Sprintf("server closed after %ds", c.Held)
		}
		return true
	})
	if ctx.Err() != nil {
		err = nil
	}
	return ticks, gaps, reason, err
}
