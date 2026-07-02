// Cursive PD Tracker — offscreen background scraper v1.0.95
// Runs in a hidden offscreen document. Does fetch + DOMParser + extraction.
// v1.0.95: Amazon price fix v5 — anchor price extraction to MAIN PRODUCT AREA
//          only, skipping the "Customers who viewed" carousel at top.
//          Uses "-80%" discount indicator + "M.R.P." text as anchors that
//          only appear in the main product section.

console.log('[PD-OFFSCREEN] loaded v1.0.95');

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
    const res = await fetch(product.product_url, {
      credentials: 'include',
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

  // ===== v1.0.94: Amazon "Price to Pay" — multiple strategies =====
  // Amazon marks the actual selling price with class="priceToPay". The
  // .a-offscreen span inside contains the formatted ₹value for accessibility.
  // We try DOM selectors first, then raw-HTML regex, then a-price-whole pattern.
  if (platform === 'Amazon') {
    // Strategy 1: DOM selectors
    const priceToPaySelectors = [
      '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
      '#apex_desktop .priceToPay .a-offscreen',
      '#corePrice_feature_div .priceToPay .a-offscreen',
      '.priceToPay .a-offscreen',
    ];
    for (const sel of priceToPaySelectors) {
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
    // Strategy 2: MAIN-PRODUCT-ONLY anchored regex.
    // The "Customers who viewed" carousel at the TOP shows related products
    // with their own prices. We skip that by anchoring to markers that ONLY
    // appear in the main product section:
    //    - "-80%" savings percentage indicator
    //    - "M.R.P.:" text (only on main product)
    //    - #corePriceDisplay_desktop_feature_div (main Buy Box only)
    if (!price) {
      const anchoredPatterns = [
        // Discount % IMMEDIATELY followed by ₹price (main product's savings + price)
        /-\d+%[\s\S]{0,80}?₹\s*([\d,.]+)/,
        // Discount % badge followed by a-offscreen span (main product structure)
        /-\d+%[\s\S]{0,500}?class="a-offscreen"[^>]*>[^\d]*([\d,.]+)/,
        // Inside #corePriceDisplay_desktop_feature_div — main Buy Box only
        /id="corePriceDisplay_desktop_feature_div"[\s\S]{0,2000}?class="a-offscreen"[^>]*>[^\d]*([\d,.]+)/,
        // Inside #corePriceDisplay_desktop_feature_div — a-price-whole (integer part)
        /id="corePriceDisplay_desktop_feature_div"[\s\S]{0,2000}?class="a-price-whole"[^>]*>[^\d]*([\d,.]+)/,
        // Price before "M.R.P.:" text (main product always has this label)
        /class="a-offscreen"[^>]*>[^\d]*([\d,.]+)[^<]*<\/span>[\s\S]{0,300}?M\.?R\.?P/,
        // priceToPay class (Amazon's marker for actual selling price)
        /priceToPay[^>]{0,300}a-offscreen[^>]*>[^\d]*([\d,.]+)/,
        // apex_desktop feature block
        /id="apex_desktop"[\s\S]{0,3000}?"amount"\s*:\s*"?([\d.]+)"?/,
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
    // Strategy 3: a-price-whole (Amazon shows the integer part in a-price-whole)
    if (!price) {
      const wholeEl = doc.querySelector('#corePriceDisplay_desktop_feature_div .a-price-whole') ||
                      doc.querySelector('.priceToPay .a-price-whole');
      if (wholeEl) {
        const v = parseFloat(String(wholeEl.textContent || '').replace(/[^\d.]/g, ''));
        if (v >= 10 && v < 1000000) price = String(Math.round(v));
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
              // Skip carousel entries on the strict pass
              if (mustMatchAsin) {
                const pid = String(it.productID || it.sku || it.mpn || it['@id'] || '').toUpperCase();
                if (pid.indexOf(String(productId).toUpperCase()) < 0) continue;
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
  