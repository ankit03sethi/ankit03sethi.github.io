// Cursive PD Tracker — offscreen background scraper v1.0.93
// Runs in a hidden offscreen document. Does fetch + DOMParser + extraction.
// No tabs, no windows, no visible activity at all.
// v1.0.93: Amazon price fix — v1.0.92 JSON-LD returned Amazon's list price (599)
//          not the actual "Price to Pay" (399). Now targets .priceToPay class
//          (Amazon's marker for the current selling price). JSON-LD is fallback.

console.log('[PD-OFFSCREEN] loaded v1.0.93');

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

  // ===== v1.0.93: Amazon "Price to Pay" DOM selectors (most reliable) =====
  // Amazon marks the actual selling price with class="priceToPay". This is
  // separate from list price, MRP, coupon promo, etc. The .a-offscreen span
  // inside contains the formatted ₹value for screen-readers — perfect target.
  if (platform === 'Amazon') {
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
          }
        } catch {}
      }
    }
  } catch {}

  // ===== Meta tags (works for many e-commerce sites) =====
  try {
    if (!price) {
      const metaSelectors = [
        'meta[property="product:price:amount"]',
        'meta[property="og:price:amount"]',
        'meta[itemprop="price"]',
        'meta[name="twitter:data1"]',
      ];
      for (const sel of metaSelectors) {
        const m = doc.querySelector(sel);
        if (m) {
          const v = parseFloat(String(m.getAttribute('content') || '').replace(/[^\d.]/g, ''));
          if (v >= 10 && v < 1000000) { price = String(Math.round(v)); break; }
        }
      }
    }
  } catch {}

  // ===== Meesho: __NEXT_DATA__ =====
  if (platform === 'Meesho' && (!price || !rating)) {
    try {
      const nd = doc.querySelector('#__NEXT_DATA__');
      if (nd) {
        const j = JSON.parse(nd.textContent);
        const single = j?.props?.pageProps?.initialState?.productDetails?.singleProductDetails;
        if (single) {
          if (single.transient_price && !price) price = String(Math.round(single.transient_price));
          if (single.price && !price) price = String(Math.round(single.price));
          if (single.product_rating?.avg_rating && !rating) rating = parseFloat(single.product_rating.avg_rating);
          if (single.product_rating?.rating_count && !reviewCount) reviewCount = single.product_rating.rating_count;
          if (single.supplier_name && !seller) seller = single.supplier_name;
          if (single.shop_name && !seller) seller = single.shop_name;
        }
      }
    } catch {}
  }

  // ===== Myntra: window.__myx =====
  if (platform === 'Myntra' && (!price || !rating)) {
    try {
      const m = html.match(/window\.__myx\s*=\s*({[\s\S]*?});\s*<\/script>/);
      if (m) {
        const j = JSON.parse(m[1]);
        const pd = j?.pdpData;
        if (pd) {
          if (pd.price?.discounted && !price) price = String(Math.round(pd.price.discounted));
          if (pd.price?.mrp && !price) price = String(Math.round(pd.price.mrp));
          if (pd.ratings?.averageRating && !rating) rating = parseFloat(pd.ratings.averageRating);
          if (pd.ratings?.totalCount && !reviewCount) reviewCount = pd.ratings.totalCount;
          if (pd.brand?.name && !seller) seller = pd.brand.name;
        }
     