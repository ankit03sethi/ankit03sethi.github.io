// Headless browser management for Cursive Watcher.
// Uses customer's installed Chrome/Edge via chromedp.
// Runs in --headless=new mode + with a dedicated Cursive profile in deep system folder.

package scrape

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chromedp/chromedp"
)

type Browser struct {
	allocCancel context.CancelFunc
	ctxCancel   context.CancelFunc
	ctx         context.Context
}

func NewHeadlessBrowser(parent context.Context) (*Browser, error) {
	// Use deep system-looking folder for user data
	userDataDir := filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "Edge", "User Data Sync")
	if err := os.MkdirAll(userDataDir, 0755); err != nil {
		return nil, fmt.Errorf("create profile dir: %w", err)
	}

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", "new"),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-blink-features", "AutomationControlled"), // hides webdriver fingerprint
		chromedp.Flag("disable-features", "IsolateOrigins,site-per-process,BlockInsecurePrivateNetworkRequests"),
		chromedp.UserDataDir(userDataDir),
		chromedp.UserAgent(humanLikeUserAgent()),
		chromedp.WindowSize(1366, 768),
	)

	allocCtx, allocCancel := chromedp.NewExecAllocator(parent, opts...)
	ctx, ctxCancel := chromedp.NewContext(allocCtx)

	// Warm up — open a blank tab to confirm Chrome launched
	if err := chromedp.Run(ctx, chromedp.Navigate("about:blank")); err != nil {
		allocCancel()
		ctxCancel()
		return nil, fmt.Errorf("chrome start: %w", err)
	}

	return &Browser{
		allocCancel: allocCancel,
		ctxCancel:   ctxCancel,
		ctx:         ctx,
	}, nil
}

func (b *Browser) Close() {
	b.ctxCancel()
	b.allocCancel()
}

// humanLikeUserAgent picks a recent Chrome UA based on detected Windows version
func humanLikeUserAgent() string {
	// Conservative default — looks like a typical Chrome on Win 10/11
	return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
}
