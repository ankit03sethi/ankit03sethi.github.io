# Cursive Watcher

Native Windows app that scrapes marketplace data invisibly. Replacement for the Chrome extension.

## How it works

1. Installed as a Windows service named "Cursive Background Helper"
2. On boot, launches headless Chrome (or Edge) from customer's existing browser install
3. Headless browser is controlled via DevTools Protocol (no visible window)
4. Polls Supabase Edge Function for products to scrape
5. Opens each product URL in headless browser, extracts data via injected JS
6. Posts results back to Supabase
7. Repeats every ~3 sec with jitter

## Customer-side safety

- Uses customer's IP only (no proxies, no shared infra)
- Random User-Agent per customer based on their Windows version
- Throttled to ~1 request per 30 sec per marketplace
- Random delays + occasional non-product page visits to look human
- No login to marketplace accounts — anonymous browsing only

## Customer experience

- Customer downloads `CursiveWatcher-Setup.exe` (~10 MB)
- Double-clicks installer
- Enters email + password once (links to their Cursive account)
- Done — service runs in background forever
- No Chrome window opens, no tab flashes, no UI
- Customer can verify it's running via Task Manager (named "Cursive Background Helper")

## Architecture

- `cmd/watcher/main.go` — entry point, runs the scrape loop
- `cmd/installer/main.go` — installer that creates Windows service
- `internal/scrape/` — headless Chrome control, per-platform extractors
- `internal/supabase/` — JWT auth, /analytics-next-products, /analytics-snapshot
- `internal/service/` — Windows service lifecycle (start, stop, restart)
- `scripts/build.sh` — local build helper
- `.github/workflows/build-watcher.yml` — GitHub Actions cross-compile to Windows

## Build

```
cd cursive-watcher
GOOS=windows GOARCH=amd64 go build -o CursiveWatcher.exe ./cmd/watcher
GOOS=windows GOARCH=amd64 go build -o CursiveWatcher-Setup.exe ./cmd/installer
```

Output: 2 .exe files. Real builds happen via GitHub Actions (`.github/workflows/build-watcher.yml`).
