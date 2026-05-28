// Cursive Watcher — invisible scraper service.
// Runs in background, no UI, no taskbar entry.
// Auto-launches headless Chrome on boot, scrapes marketplace pages, posts to Supabase.

package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ankit03sethi/cursive-watcher/internal/scrape"
	"github.com/ankit03sethi/cursive-watcher/internal/supabase"
)

const (
	Version       = "0.1.0"
	TickInterval  = 3 * time.Second
	BatchSize     = 15
	CooldownSecs  = 60
)

func main() {
	var configPath string
	flag.StringVar(&configPath, "config", defaultConfigPath(), "Path to config.json with JWT + refresh token")
	flag.Parse()

	log.Printf("[Watcher] Starting v%s (config: %s)", Version, configPath)

	cfg, err := supabase.LoadConfig(configPath)
	if err != nil {
		log.Fatalf("[Watcher] Failed to load config: %v\nPlease run installer first.", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Graceful shutdown on Ctrl+C / SIGTERM (Windows service stop signal)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("[Watcher] Shutdown signal received")
		cancel()
	}()

	// Start headless browser
	browser, err := scrape.NewHeadlessBrowser(ctx)
	if err != nil {
		log.Fatalf("[Watcher] Failed to start headless browser: %v", err)
	}
	defer browser.Close()

	// Main scrape loop
	ticker := time.NewTicker(TickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[Watcher] Stopped.")
			return
		case <-ticker.C:
			if err := tick(ctx, cfg, browser); err != nil {
				log.Printf("[Watcher] tick error: %v", err)
			}
		}
	}
}

func tick(ctx context.Context, cfg *supabase.Config, browser *scrape.Browser) error {
	products, err := supabase.NextProducts(ctx, cfg, BatchSize)
	if err != nil {
		return fmt.Errorf("fetch products: %w", err)
	}
	if len(products) == 0 {
		time.Sleep(5 * time.Second)
		return nil
	}

	var results []supabase.SnapshotResult
	for _, p := range products {
		data, err := browser.ScrapeProduct(ctx, p)
		if err != nil {
			log.Printf("[Watcher] scrape err for %s/%s: %v", p.Platform, p.ProductID, err)
			results = append(results, supabase.SnapshotResult{
				ProductIDFk: p.ID,
				Status:      "fail_temporary",
			})
		} else {
			results = append(results, *data)
		}
		// Per-platform throttle so we don't burst-hit the same marketplace
		time.Sleep(time.Duration(2+jitter()) * time.Second)
	}

	if err := supabase.PostSnapshot(ctx, cfg, results); err != nil {
		return fmt.Errorf("post snapshot: %w", err)
	}
	return nil
}

func defaultConfigPath() string {
	if appData := os.Getenv("LOCALAPPDATA"); appData != "" {
		return fmt.Sprintf("%s\\Cursive\\Watcher\\config.json", appData)
	}
	return "./config.json"
}

// jitter returns 0-3 second randomness so requests don't look robotic
func jitter() int {
	return int(time.Now().UnixNano() % 4)
}
