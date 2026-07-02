// Cursive PD Tracker — offscreen background scraper v1.0.97
// Runs in a hidden offscreen document. Does fetch + DOMParser + extraction.
// v1.0.97: Strict main-product-only for Amazon. v1.0.96 had a broad
//          .priceToPay selector that matched carousel items too. Now every
//          selector is anchored to #corePriceDisplay_desktop_feature_div,
//          #apex_desktop, or #centerCol — all scoped to main product ONLY.
//          Also expands JSON-LD ASIN matching to check offers.url and
//          mainEntityOfPage.@id.

console.log('[PD-OFFSCREEN] loaded v1.0.97');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'pd_scrape_url') return;
  scrapeUrl(msg.product).then(sendResponse).catch(e => {
    console.warn('[PD-OFFSCREEN] err', e);
    sendResponse({ success: false, error: e.message });
  });
  return true;
});

async function scrapeUrl(product) {
  try {
    // v1.0.96: credentials:'omit' → don't send Amazon Business cookies.
    // This gives us the ANONYMOUS "normal customer" view with correct sale prices.
    const res = await fetch(product.product_url, {
      credentials: 'omit',
      redirect: 'follow',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
    });
    if (!res.ok) {
      console.log('[PD-OFF] HTTP ' + res.status + ' for ' + product.product_url);
      return { success: false, status: 'fail_temporary', reason: 'http_' + res.status };
    }
    const html = await res.text();
    if (html.length < 500) {
      console.log('[PD-OFF] empty body for ' + product.product_url);
      return { success: false, status: 'fail_temporary', reason: 'empty_body' };
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const data = extract(doc, html, product.platform, product.product_id);
    if (!data.price && !data.rating) {
      console.log('[PD-OFF] no data extracted for ' + product.platform + ' ' + product.product_url + ' (html len: ' + html.length + ')');
    }
    return {
      success: !!(data.price || data.rating),
      rating: data.rating, review_count: data.reviewCount,
      price: data.price, seller: data.seller,
    };
  } catch (e) {
    console.warn('[PD-OFF] err ' + e.message + ' for ' + product.product_url);
    return { success: false, status: 'fail_temporary', reason: e.message };
  }
}

function extract(doc, html, platform, productId) {
  let rating = null, reviewCount = null, price = null, seller = null;

  // ===== v1.0.97: Amazon MAIN PRODUCT price — STRICT (no carousel matches) =====
  // Every selector below is scoped to a container that only exists in the main
  // product area. The "Customers who viewed" carousel is OUTSIDE these
  // containers so its prices are never picked up.
  if (platform === 'Amazon') {
    // Strategy 1: STRICT scoped DOM selectors (main product containers only)
    const priceSelectors = [
      '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-price[class*="priceToPay"] .a-offscreen',
      '#apex_desktop .priceToPay .a-offscreen',
      '#corePrice_feature_div .priceToPay .a-offscreen',
      '#centerCol .priceToPay .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-price-whole',
      '#apex_desktop .a-price-whole',
      '#centerCol .a-price-whole',
    ];
    for (const sel of priceSelectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const text = (el.textContent || '').trim();
        const cleaned = text.replace(/[^\d.]/g, '');
        const v = parseFloat(cleaned);
        if (v >= 10 && v < 1000000) {
          price = String(Math.round(v));
          break;
        }
      }
    }
    // Strategy 2: HTML regex — anchored to main product containers ONLY.
    // These string patterns exist in the SSR HTML for main product but not
    // in the carousel section.
    if (!price) {
      const anchoredPatterns = [
        // Inside #corePriceDisplay_desktop_feature_div — 1st .a-offscreen
        /id="corePriceDisplay_desktop_feature_div"[\s\S]{0,3000}?class="a-offscreen"[^>]*>[^\d]*([\d,.]+)/,
        // Inside #corePriceDisplay_desktop_feature_div — 1st a-price-whole
        /id="corePriceDisplay_desktop_feature_div"[\s\S]{0,3000}?class="a-price-whole"[^>]*>[^\d]*([\d,.]+)/,
        // Inside #apex_desktop — 1st .a-offscreen
        /id="apex_desktop"[\s\S]{0,3000}?class="a-offscreen"[^>]*>[^\d]*([\d,.]+)/,
        // Inside #centerCol container (main product only)
        /id="centerCol"[\s\S]{0,5000}?class="a-offscreen"[^>]*>[^\d]*([\d,.]+)/,
      ];
      for (const re of anchoredPatterns) {
        const m = html.match(re);
        if (m) {
          const v = parseFloat(String(m[1]).replace(/,/g, ''));
          if (v >= 10 && v < 1000000) {
            price = String(Math.round(v));
            break;
          }
        }
      }
    }
  }

  // ===== JSON-LD (works for Amazon, Flipkart, FirstCry) =====
  // v1.0.92: Two-pass strategy specifically for Amazon.
  //   Pass 0: Only accept JSON-LD entries whose productID/sku matches the
  //           tracked ASIN. This skips "Customers who viewed" carousel items.
  //   Pass 1: Fallback — accept any JSON-LD (behaviour identical to v1.0.90).
  // For non-Amazon platforms, only Pass 1 runs (behaviour unchanged).
  try {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    const passes = (platform === 'Amazon' && productId) ? [true, false] : [false];
    for (const mustMatchAsin of passes) {
      if (price && rating && reviewCount) break;
      for (const s of scripts) {
        try {
          const j = JSON.parse(s.textContent);
          const items = Array.isArray(j) ? j : [j];
          for (const item of items) {
            // Also dig into @graph if present
            const candidates = item['@graph'] ? item['@graph'] : [item];
            for (const it of candidates) {
              // Skip carousel entries on the strict pass — check multiple fields.
              if (mustMatchAsin) {
                const asin = String(productId).toUpperCase();
                const meoi = it.mainEntityOfPage && (it.mainEntityOfPage['@id'] || it.mainEntityOfPage.id) || '';
                const offersRaw = Array.isArray(it.offers) ? it.offers[0] : it.offers;
                const offersUrl = (offersRaw && offersRaw.url) || '';
                const candidates = [
                  it.productID, it.sku, it.mpn, it['@id'], meoi, offersUrl,
                ].map(v => String(v || '').toUpperCase());
                if (!candidates.some(c => c.indexOf(asin) >= 0)) continue;
              }
              if (it.aggregateRating) {
                if (it.aggregateRating.ratingValue && !rating) {
                  const v = parseFloat(it.aggregateRating.ratingValue);
                  if (v >= 1 && v <= 5) rating = v;
                }
                const rc = it.aggregateRating.ratingCount || it.aggregateRating.reviewCount;
                if (rc && !reviewCount) reviewCount = parseInt(String(rc).replace(/,/g, ''));
              }
              if (it.offers) {
                const offers = Array.isArray(it.offers) ? it.offers[0] : it.offers;
                if (!price) {
                  const p = offers.price || offers.lowPrice || offers.highPrice;
                  if (p) {
                    const v = parseFloat(String(p).replace(/,/g, ''));
                    if (v >= 10) price = String(Math.round(v));
                  }
                }
                // v1.0.92: seller from offers.seller.name (real Marketplace seller)
                if (!seller && offers.seller) {
                  const s2 = typeof offers.seller === 'string' ? offers.seller : offers.seller.name;
                  if (s2 && typeof s2 === 'string' && s2.trim().length > 0) {
                    seller = s2.trim().substring(0, 100);
                  }
                }
              }
              // v1.0.27: brand is NOT seller. Skip this mapping — only use real seller fields.
            }
          }
        } catch {}
      }
    }
  } catch {}

  // ===== Meta tags (works for many e-commerce sites) =====
  try {
    if (!price) {
      const metaSelectors