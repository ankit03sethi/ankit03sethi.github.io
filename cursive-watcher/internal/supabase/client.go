package supabase

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

const (
	URL     = "https://bttppihskbfmxwujyztj.supabase.co"
	AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8"
)

type Config struct {
	JWT          string `json:"jwt"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
	Email        string `json:"email"`
}

type Product struct {
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	Platform   string `json:"platform"`
	ProductID  string `json:"product_id"`
	ProductURL string `json:"product_url"`
}

type SnapshotResult struct {
	ProductIDFk string  `json:"product_id_fk"`
	Rating      *float64 `json:"rating,omitempty"`
	ReviewCount *int     `json:"review_count,omitempty"`
	Price       *string  `json:"price,omitempty"`
	Seller      *string  `json:"seller,omitempty"`
	Status      string   `json:"status"`
}

func LoadConfig(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return &cfg, nil
}

func SaveConfig(path string, cfg *Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0600)
}

func NextProducts(ctx context.Context, cfg *Config, limit int) ([]Product, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("%s/functions/v1/analytics-next-products?limit=%d", URL, limit), nil)
	req.Header.Set("Authorization", "Bearer "+cfg.JWT)
	req.Header.Set("apikey", AnonKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	var body struct {
		OK       bool      `json:"ok"`
		Products []Product `json:"products"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body.Products, nil
}

func PostSnapshot(ctx context.Context, cfg *Config, results []SnapshotResult) error {
	body := map[string]any{"results": results}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, "POST",
		URL+"/functions/v1/analytics-snapshot",
		bytesReader(b))
	req.Header.Set("Authorization", "Bearer "+cfg.JWT)
	req.Header.Set("apikey", AnonKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil { return err }
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("snapshot post: HTTP %d", resp.StatusCode)
	}
	return nil
}

// shim because we can't import bytes in client snippet without bloat
func bytesReader(b []byte) *bytesBuf {
	return &bytesBuf{data: b}
}
type bytesBuf struct{ data []byte; pos int }
func (b *bytesBuf) Read(p []byte) (int, error) {
	if b.pos >= len(b.data) { return 0, fmt.Errorf("EOF") }
	n := copy(p, b.data[b.pos:])
	b.pos += n
	return n, nil
}
