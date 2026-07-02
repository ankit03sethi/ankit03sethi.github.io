// Cursive PD Tracker — offscreen background scraper v1.0.91
// Runs in a hidden offscreen document. Does fetch + DOMParser + extraction.
// No tabs, no windows, no visible activity at all.
// v1.0.91: Fix Amazon picking wrong price from "Customers who viewed" carousel.
//          Now targets main product price zone (#corePriceDisplay_desktop_feature_div)
//          AND prefers JSON-LD entries whose productID matches the tracked ASIN.

console.log('[PD-OFFSCREEN] loaded v1.0.91');

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

  // ===== v1.0.91: AMAZON PRICE ONLY — target MAIN Buy Box (NOT the carousel) =====
  // Fixes issue where "Customers who viewed" carousel prices were being picked up.
  // Nothing else changed — seller / rating / reviews continue to use JSON-LD below.
  if (platform === 'Amazon') {
    const amazonPriceSelectors = [
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-price-whole',
      '#corePrice_desktop .a-offscreen',
      '#corePrice_feature_div .a-offscreen',
      '#apex_desktop .a-price .a-offscreen',
      '.priceToPay .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#priceblock_saleprice',
    ];
    for (const sel of amazonPriceSelectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const text = (el.textContent || el.getAttribute('content') || '').trim();
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
  // UNCHANGED from prior version. Only difference: for Amazon, price will
  // usually already be set from the Buy Box selectors above, so the JSON-LD
  // offers loop skips assignment (guarded by `!price`).
  try {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const j = JSON.parse(s.textContent);
        const items = Array.isArray(j) ? j : [j];
        for (const item of items) {
          // Also dig into @graph if present
          const candidates = item['@graph'] ? item['@graph'] : [item];
          for (const it of candidates) {
            if (it.aggregateRating) {
              if (it.aggregateRating.ratingValue && !rating) {
                const v = parseFloat(it.aggregateRating.ratingValue);
                if (v >= 1 && v <= 5) rating = v;
              }
              const rc = it.aggregateRating.ratingCount || it.aggregateRating.reviewCount;
              if (rc && !reviewCount) reviewCount = parseInt(String(rc).replace(/,/g, ''));
            }
            if (it.offers && !price) {
              const offers = Array.isArray(it.offers) ? it.offers[0] : it.offers;
              const p = offers.price || offers.lowPrice || offers.highPrice;
              if (p) {
                const v = parseFloat(String(p).replace(/,/g, ''));
                if (v >= 10) price = String(Math.round(v));
              }
            }
            // v1.0.27: brand is NOT seller. Skip this mapping — only use real seller fields.
          }
        }
      } catch {}
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
      }
    } catch {}
  }

  // ===== Flipkart: __INITIAL_STATE__ =====
  if (platform === 'Flipkart' && (!price || !rating)) {
    try {
      const m = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
      if (m) {
        const j = JSON.parse(m[1]);
        // Flipkart structure varies; try common paths
        const pageData = j?.pageDataV4?.page?.data || j?.data?.product;
        if (pageData) {
          const priceObj = pageData?.PRODUCT_DETAILS_WIDGET?.priceObj;
          if (priceObj?.finalPrice?.value && !price) price = String(Math.round(priceObj.finalPrice.value));
          if (pageData?.PRODUCT_DETAILS_WIDGET?.rating?.average && !rating) rating = parseFloat(pageData.PRODUCT_DETAILS_WIDGET.rating.average);
        }
      }
    } catch {}
  }

  // ===== Generic JSON regex (last-ditch) =====
  // v1.0.16: Only well-scoped price patterns that target product-specific JSON.
  // Removed loose "price" / "mrp" patterns that matched unrela