# api: the Vercel function

Vercel turns each exported `http.HandlerFunc` in a `.go` file under `api/` into a function. There is one: `index.go`. `vercel.json` rewrites every `/api/*` path to it, and the chi router inside dispatches on the original path.

The router and the database pool are built once per warm instance (`sync.Once`) and reused across requests. pgxpool connects lazily, so a cold start that never touches the database never wakes Neon.

`cmd/apiserver` runs the same router as a normal server for Docker and local work. The folder is not called `cmd/api` on purpose: Vercel treats `cmd/api/main.go` as a signal to deploy the whole project as a Go server, which would replace the static site.

The shared code lives in `pkg/`, not `internal/`. Vercel compiles `index.go` inside a generated wrapper module, and Go refuses to let code outside this module import an `internal/` package, so the first deploy failed with "use of internal package not allowed".
