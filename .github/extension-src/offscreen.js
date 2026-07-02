// Cursive PD Tracker — offscreen background scraper v1.0.100
// Runs in a hidden offscreen document. Does fetch + DOMParser + extraction.
// v1.0.100: ATC hidden input as PRIMARY strategy for Amazon.
//           Reads name="items[0.base][customerVisiblePrice][amount]" value.
//           This exists ONCE per page (main product ATC button), never in
//           carousel. Bulletproof fix for MUAAZON-like products.

console.log('[PD-OFFSCREEN] loaded v1.0.103');

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

  // ===== v1.0.100: Amazon MAIN PRODUCT price — BULLETPROOF =====
  if (platform === 'Amazon') {
    // Strategy 1 (PRIMARY): ATC hidden input — ONE TRUE price.
    // Exists ONCE per page, cannot be in carousel.
    //   <input name="items[0.base][customerVisiblePrice][amount]" value="399.0">
    const atc1 = html.match(/name="items\[0\.base\]\[customerVisiblePrice\]\[amount\]"[^>]*value="([\d,.]+)"/);
    if (atc1) {
      const v = parseFloat(String(atc1[1]).replace(/,/g, ''));
      if (v >= 10 && v < 1000000) {
        price = String(Math.round(v));
        console.log('[PD-OFF v1.0.100] price from ATC input = ' + price);
      }
    }
    if (!price) {
      const atc2 = html.match(/value="([\d,.]+)"[^>]*name="items\[0\.base\]\[customerVisiblePrice\]\[amount\]"/);
      if (atc2) {
        const v = parseFloat(String(atc2[1]).replace(/,/g, ''));
        if (v >= 10 && v < 1000000) {
          price = String(Math.round(v));
          console.log('[PD-OFF v1.0.100] price from ATC (reversed) = ' + price);
        }
      }
    }

    // Strategy 2: DOM selectors using Amazon's REAL class names
    if (!price) {
      const priceSelectors = [
        '.apex-pricetopay-value .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-offscreen',
        '#apex_desktop .a-offscreen',
        '#corePrice_feature_div .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-price-whole',
        '#apex_desktop .a-price-whole',
      ];
      for (const sel of priceSelectors) {
        const el = doc.querySelector(sel);
        if (el) {
          const text = (el.textContent || '').trim();
          const cleaned = text.replace(/[^\d.]/g, '');
          const v = parseFloat(cleaned);
          if (v >= 10 && v < 1000000) {
            price = String(Math.round(v));
            console.log('[PD-OFF v1.0.100] price from ' + sel + ' = ' + price);
            break;
          }
        }
      }
    }

    // Strategy 3: HTML regex anchored to main product containers
    if (!price) {
      const anchoredPatterns = [
        /class="[^"]*apex-pricetopay-value[^"]*"[\s\S]{0,500}?class="a-offscreen"[^>]*>[^\d]*([\d,.]+)/,
        /id="corePriceDisplay_desktop_feature_div"[\s\S]{0,3000}?class="a-offscreen"[^>]*>[^\d]*([\d,.]+)/,
        /id="apex_desktop"[\s\S]{0,3000}?class="a-offscreen"[^>]*>[^\d]*([\d,.]+)/,
        /id="corePriceDisplay_desktop_feature_div"[\s\S]{0,3000}?class="a-price-whole"[^>]*>[^\d]*([\d,.]+)/,
      ];
      for (const re of anchoredPatterns) {
        const m = html.match(re);
        if (m) {
          const v = parseFloat(String(m[1]).replace(/,/g, ''));
          if (v >= 10 && v < 1000000) {
            price = String(Math.round(v));
            console.log('[PD-OFF v1.0.100] price from regex anchor');
            break;
          }
        }
      }
    }
  }

  // ===== JSON-LD (Amazon rating/count/seller + other platforms) =====
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
            const candidates = item['@graph'] ? item['@graph'] : [item];
            for (const it of candidates) {
              if (mustMatchAsin) {
                const asin = String(productId).toUpperCase();
                const meoi = it.mainEntityOfPage && (it.mainEntityOfPage['@id'] || it.mainEntityOfPage.id) || '';
                const offersRaw = Array.isArray(it.offers) ? it.offers[0] : it.offers;
                const offersUrl = (offersRaw && offersRaw.url) || '';
                const fields = [
                  it.productID, it.sku, it.mpn, it['@id'], meoi, offersUrl,
                ].map(v => String(v || '').toUpperCase());
                if (!fields.some(c => c.indexOf(asin) >= 0)) continue;
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
                // For Amazon, price is already set from ATC input — don't overwrite from JSON-LD
                if (!price && platform !== 'Amazon') {
                  const p = offers.price || offers.lowPrice || offers.highPrice;
                  if (p) {
                    const v = parseFloat(String(p).replace(/,/g, ''));
                    if (v >= 10) price = String(Math.round(v));
                  }
                }
                if (!seller && offers.seller) {
                  const s2 = typeof offers.seller === 'string' ? offers.seller : offers.seller.name;
                  if (s2 && typeof s2 === 'string' && s2.trim().length > 0) {
                    seller = s2.trim().substring(0, 100);
                  }
                }
              }
            }
          }
        } catch {}
      }
    }
  } catch {}

  // ===== Meta tags (fallback for price on non-Amazon) =====
  try {
    if (!price) {
      const metaSelectors = [
        'meta[itemprop="price"]',
        'meta[property="product:price:amount"]',
        'meta[property="og:price:amount"]',
        'meta[name="twitter:data1"]',
      ];
      for (const sel of metaSelectors) {
        const el = doc.querySelector(sel);
        if (el) {
          const c = el.getAttribute('content');
          if (c) {
            const m = c.match(/[\d,.]+/);
            if (m) {
              const v = parseFloat(m[0].replace(/,/g, ''));
              if (v >= 10 && v < 1000000) {
                price = String(Math.round(v));
                break;
              }
            }
          }
        }
      }
    }
  } catch {}

  // ===== Amazon rating + review count from DOM/HTML =====
  // STRICT — only from main product elements. NEVER greedy regex on whole HTML
  // because carousel/related products would leak.
  if (platform === 'Amazon') {
    // Rating — ONLY from #acrPopover which is main product's rating popover
    // (does NOT exist for carousel entries — those are simple stars only)
    if (!rating) {
      try {
        const el = doc.querySelector('#acrPopover .a-icon-alt') ||
                   doc.querySelector('#averageCustomerReviews .a-icon-alt');
        if (el) {
          const m = (el.textContent || '').match(/([\d.]+)\s*out\s*of\s*5/i);
          if (m) {
            const v = parseFloat(m[1]);
            if (v >= 1 && v <= 5) rating = v;
          }
        }
      } catch {}
    }
    // Regex fallback — ONLY anchored to #acrPopover context (never plain "out of 5")
    if (!rating) {
      const rm = html.match(/id="acrPopover"[\s\S]{0,500}?([\d.]+)\s*out\s*of\s*5/i);
      if (rm) {
        const v = parseFloat(rm[1]);
        if (v >= 1 && v <= 5) rating = v;
      }
    }
    // Review count — ONLY from #acrCustomerReviewText (main product)
    if (!reviewCount) {
      try {
        const el = doc.querySelector('#acrCustomerReviewText') ||
                   doc.querySelector('[data-hook="total-review-count"]');
        if (el) {
          const m = (el.textContent || '').match(/([\d,]+)/);
          if (m) reviewCount = parseInt(m[1].replace(/,/g, ''));
        }
      } catch {}
    }
    if (!reviewCount) {
      const cm = html.match(/id="acrCustomerReviewText"[^>]*>\s*([\d,]+)/i);
      if (cm) reviewCount = parseInt(cm[1].replace(/,/g, ''));
    }

    // BUSINESS RULE: rating requires at least 1 review. If count is null or 0,
    // rating must also be null (matches content.js logic). This prevents leaking
    // a stray "X out of 5" match when the product has no actual reviews.
    if (!reviewCount || reviewCount === 0) {
      if (rating) {
        console.log('[PD-OFF v1.0.103] rejecting rating=' + rating + ' because reviewCount is empty');
        rating = null;
      }
    }
  }

  // ===== Amazon seller — from Sold By text on the page =====
  if (platform === 'Amazon' && !seller) {
    try {
      const soldBy = doc.querySelector('#sellerProfileTriggerId, [data-csa-c-content-id="offerDisplayFeature_desktop_soldByText"]');
      if (soldBy) {
        const t = (soldBy.textContent || '').trim();
        if (t && t.length > 0 && t.length < 100) seller = t;
      }
    } catch {}
  }

  return { rating, reviewCount, price, seller };
}
