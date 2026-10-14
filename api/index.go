// Package handler is the Vercel Go function. vercel.json rewrites every
// /api/* path here, and the chi router inside dispatches on the original path.
package handler

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"sync"

	"github.com/VijaysinghPuwar/BreachScope/internal/app"
	"github.com/VijaysinghPuwar/BreachScope/internal/config"
)

var (
	once    sync.Once
	router  http.Handler
	initErr error
)

// Handler is called once per request. The router and the database pool are
// built on the first call and reused while the instance stays warm.
func Handler(w http.ResponseWriter, r *http.Request) {
	once.Do(func() {
		log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
		cfg, err := config.Load()
		if err != nil {
			initErr = err
			return
		}
		router, _, initErr = app.Build(context.Background(), cfg, log)
	})
	if initErr != nil {
		slog.Error("init", "err", initErr)
		http.Error(w, "server misconfigured", http.StatusInternalServerError)
		return
	}
	router.ServeHTTP(w, r)
}
