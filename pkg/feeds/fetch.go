package feeds

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/VijaysinghPuwar/BreachScope/pkg/store"
)

// maxBody guards memory: the largest feed (URLhaus recent) is about 20 MB.
const maxBody = 64 << 20

func (h *Hub) fetch(ctx context.Context, s Source, lastModified, etag string, now time.Time) (
	evs []store.Event, newLM, newETag string, notModified bool, err error,
) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.FeedURL, nil)
	if err != nil {
		return nil, "", "", false, err
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/json")
	for k, v := range s.Header {
		req.Header.Set(k, v)
	}
	if lastModified != "" {
		req.Header.Set("If-Modified-Since", lastModified)
	}
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, "", "", false, err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotModified:
		return nil, "", "", true, nil
	case resp.StatusCode == http.StatusTooManyRequests:
		return nil, "", "", false, fmt.Errorf("rate limited by %s (429)", s.Name)
	case resp.StatusCode != http.StatusOK:
		return nil, "", "", false, fmt.Errorf("%s returned %s", s.Name, resp.Status)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return nil, "", "", false, fmt.Errorf("read %s: %w", s.Name, err)
	}
	if s.Verify != nil {
		if err := s.Verify(resp.Header, body, now); err != nil {
			return nil, "", "", false, fmt.Errorf("verify %s: %w", s.Name, err)
		}
	}
	evs, err = s.Parse(body, h.geo, now)
	if err != nil {
		return nil, "", "", false, fmt.Errorf("parse %s: %w", s.Name, err)
	}
	return evs, resp.Header.Get("Last-Modified"), resp.Header.Get("ETag"), false, nil
}
