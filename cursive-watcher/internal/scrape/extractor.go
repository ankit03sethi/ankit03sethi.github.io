// Per-platform product data extraction.
// Loads page in headless Chrome, waits for JS to render, runs JS in page context to grab data.

package scrape

import (
	"context"
	"fmt"
	"time"

	"github.com/chromedp/chromedp"

	"github.com/ankit03sethi/cursive-watcher/internal/supabase"
)

func (b *Browser) ScrapeProduct(ctx context.Context, p supabase.Product) (*supabase.SnapshotResult, error) {
	// Per-call context with 30 sec timeout
	taskCtx, cancel := context.WithTimeout(b.ctx, 30*time.Second)
	defer cancel()

	var html string
	if err := chromedp.Run(taskCtx,
		chromedp.Navigate(p.ProductURL),
		chromedp.Sleep(3*time.Second), // wait for JS to render product data
		chromedp.OuterHTML("html", &html, chromedp.ByQuery),
	); err != nil {
		return nil, fmt.Errorf("navigate: %w", err)
	}

	// TODO: port content.js per-platform extraction logic here
	// For now: return raw HTML so we can debug
	_ = html

	return &supabase.SnapshotResult{
		ProductIDFk: p.ID,
		Status:      "fail_temporary", // until extraction logic is ported
	}, nil
}
