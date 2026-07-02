// UNIVERSAL E-commerce Rating Extractor
// Works on: Amazon.in, Flipkart, Meesho, Myntra, Nykaa, FirstCry, and more!

(function() {
  'use strict';

  console.log('🌟 Cursive PD Tracker scraper v1.0.79 (force-inject + tab logs): Loaded');

  const platform = detectPlatform();
  console.log('Platform detected:', platform);

  if (platform !== 'unknown') {
    // Try extraction at different intervals as page loads
    setTimeout(() => extractAndSendRating(), 2000);
    setTimeout(() => extractAndSendRating(), 4000);
    setTimeout(() => extractAndSendRating(), 6000);
    setTimeout(() => extractAndSendRating(), 9000);
    setTimeout(() => extractAndSendRating(), 12000);
    setTimeout(() => extractAndSendRating(), 15000);
  }

  // v1.0.83: DevTools defense. Extraction refuses to run when DevTools is open.
  // Multiple heuristics; if ANY trip, we assume a developer is inspecting.
  function pdDevToolsOpen() {
    try {
      // Heuristic 1: window dimension delta (DevTools docked side/bottom)
      const wd = (window.outerWidth - window.innerWidth) > 160;
      const hd = (window.outerHeight - window.innerHeight) > 160;
      if (wd || hd) return true;
      // Heuristic 2: console.log({}-formatter side effect. DevTools serializes objects
      // via .toString() of the prototype chain when grouped. We override toString
      // on a probe object and see if console.log triggers it (DevTools opens "preview").
      let tripped = false;
      const probe = {};
      Object.defineProperty(probe, "id", { get() { tripped = true; return "x"; } });
      // The console.log itself is a no-op visually but DevTools reads .id eagerly.
      console.log("%c", "", probe);
      if (tripped) return true;
      // Heuristic 3: debugger timing. `debugger;` is a no-op unless DevTools is paused;
      // we measure execution time. Skipped here to avoid pause-on-exception loops.
      return false;
    } catch { return false; }
  }

  // Listen for manual extraction
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractRating') {
      if (pdDevToolsOpen()) {
        // Pretend extraction failed temporarily. Looks like a network/DOM issue
        // to the customer; they'll see no useful data while DevTools is open.
        sendResponse({ success: false, error: "fail_temporary", platform: null });
        return true;
      }
      const data = extractRatingData();
      // v1.0.49: Diagnostic for MANUAL extraction (what background actually uses)
      try {
        chrome.runtime.sendMessage({
          action: "pd_diag",
          ts: Date.now(),
          source: "MANUAL",
          url: window.location.href,
          platform: data.platform,
          success: data.success,
          rating: data.rating,
          reviewCount: data.reviewCount,
          price: data.price,
          seller: data.seller,
          error: data.error,
        }).catch(() => {});
      } catch (e) {}
      console.log('Manual extraction:', data);
      sendResponse(data);
    }
    return true;
  });

  // v1.0.87: WASM-first count parser. Falls back to JS if .wasm fails to load.
  // Source for WASM is hidden in cursive_core.wasm binary (Phase 2C Stage B).
  let _pdWasm = null;
  let _pdWasmReady = (async () => {
    try {
      const r = await fetch(chrome.runtime.getURL('cursive_core.wasm'));
      const buf = await r.arrayBuffer();
      const mod = await WebAssembly.instantiate(buf, { env: { abort: () => {} } });
      _pdWasm = mod.instance.exports;
    } catch (e) { _pdWasm = null; }
  })();

  function pdParseCount(s) {
    if (s == null) return 0;
    // Try WASM path first (sensitive logic compiled to binary)
    if (_pdWasm) {
      try {
        const str = String(s);
        const buf = new TextEncoder().encode(str);
        const ptr = 1024;  // free zone above runtime allocations
        new Uint8Array(_pdWasm.memory.buffer, ptr, buf.length).set(buf);
        return Number(_pdWasm.pdParseCount(ptr, buf.length));
      } catch (e) { /* fall through to JS */ }
    }
    // JS fallback (only triggers if WASM failed to load or threw)
    const m = s.toString().match(/([\d,.]+)\s*([KkMmLl]?)/);
    if (!m) return 0;
    const num = parseFloat(m[1].replace(/,/g, ''));
    if (isNaN(num)) return 0;
    const suffix = (m[2] || '').toLowerCase();
    if (suffix === 'k') return Math.round(num * 1000);
    if (suffix === 'm') return Math.round(num * 1000000);
    if (suffix === 'l') return Math.round(num * 100000);
    return Math.round(num);
  }

  // v1.0.87: WASM-first price validator (rejects EMI/Save/Cashback/Coupon/% off)
  function pdValidatePrice(s) {
    if (!s || typeof s !== 'string') return false;
    if (_pdWasm) {
      try {
        const buf = new TextEncoder().encode(s);
        const ptr = 2048;
        new Uint8Array(_pdWasm.memory.buffer, ptr, buf.length).set(buf);
        return _pdWasm.validatePrice(ptr, buf.length) === 1;
      } catch (e) {}
    }
    // JS fallback
    const lower = s.toLowerCase();
    if (lower.indexOf('emi') >= 0 || lower.indexOf('cashback') >= 0 || lower.indexOf('save') >= 0 || lower.indexOf('coupon') >= 0 || lower.indexOf('off') >= 0) return false;
    return /\d/.test(s);
  }

  function detectPlatform() {
    const url = window.location.href.toLowerCase();
    const hostname = window.location.hostname.toLowerCase();

    if (hostname.includes('flipkart.com')) return 'Flipkart';
    if (hostname.includes('amazon.in') || hostname.includes('amazon.com')) return 'Amazon';
    if (hostname.includes('meesho.com')) return 'Meesho';
    if (hostname.includes('myntra.com')) return 'Myntra';
    if (hostname.includes('nykaa.com')) return 'Nykaa';
    if (hostname.includes('firstcry.com')) return 'FirstCry';
    if (hostname.includes('ajio.com')) return 'Ajio';
    if (hostname.includes('snapdeal.com')) return 'Snapdeal';
    if (hostname.includes('shopclues.com')) return 'ShopClues';
    if (hostname.includes('pepperfry.com')) return 'Pepperfry';
    if (hostname.includes('urbancompany.com')) return 'UrbanCompany';

    return 'unknown';
  }

  function isSearchOrListingPage() {
    const url = window.location.href.toLowerCase();
    const bodyText = document.body.innerText.toLowerCase();

    // Meesho /search URLs: detect multi-product pages using multiple methods.
    // If more than 1 product is visible → it's a listing → write dashes.
    if (url.includes('meesho.com') && (url.includes('/search') || url.includes('?q='))) {
      let productCount = 0;

      // Method 1: Count product card links (various Meesho URL patterns)
      const allLinks = document.querySelectorAll('a[href]');
      const uniqueProductLinks = new Set();
      for (const link of allLinks) {
        const href = (link.getAttribute('href') || '').toLowerCase();
        // Meesho product pages: /p/, /product/, or direct product slugs with numeric IDs
        if (href.match(/\/(p|product)\//) || href.match(/\/[a-z0-9-]+\/p\//)) {
          uniqueProductLinks.add(href.split('?')[0]);
        }
      }
      productCount = uniqueProductLinks.size;

      // Method 2: If no product links found, count distinct ₹ price elements
      // (product cards each show a price — more than 3 distinct prices = multi-product)
      if (productCount <= 1) {
        const allEls = document.querySelectorAll('span, div, h4, p');
        const prices = new Set();
        for (const el of allEls) {
          const t = el.textContent.trim();
          if (t.length > 20) continue;
          const m = t.match(/^₹\s*([\d,]+)$/);
          if (m) prices.add(m[1]);
          if (prices.size > 3) break;
        }
        if (prices.size > 3) productCount = prices.size;
      }

      // Method 3: Count product card images (Meesho shows grid of product images)
      if (productCount <= 1) {
        const productImages = document.querySelectorAll('img[src*="meeshocdn"], img[src*="images/products"]');
        if (productImages.length > 3) productCount = productImages.length;
      }

      console.log('[Meesho] Search page: detected ' + productCount + ' products');
      return productCount > 1;
    }

    // Standard URL patterns for all other platforms
    if (url.includes('/search') || url.includes('/results') || url.includes('?q=') || url.includes('&q=')) {
      return true;
    }

    // Listing page indicators
    if (bodyText.includes('results for') || bodyText.includes('search results')) {
      return true;
    }

    return false;
  }

  function extractRatingData() {
    const platform = detectPlatform();

    if (platform === 'unknown') {
      return {
        success: false,
        platform: 'Unknown',
        error: 'Not an e-commerce site'
      };
    }

    // Skip extraction on search/listing pages
    if (isSearchOrListingPage()) {
      return {
        success: false,
        platform: platform,
        error: 'Search or listing page detected. Please visit a product page.'
      };
    }

    console.log(`Extracting rating for ${platform}...`);

    let rating = null;
    let reviewCount = null;
    let productName = null;
    let seller = null;

    // UNIVERSAL METHOD 1: Search entire page text
    const bodyText = document.body.innerText;
    const htmlContent = document.documentElement.innerHTML;

    // Common rating patterns across all sites
    const textPatterns = [
      /(\d\.\d)\s*★/,                          // "4.2 ★"
      /(\d\.\d)\s*out of 5/i,                  // "4.2 out of 5"
      /Rating[:\s]*(\d\.\d)/i,                 // "Rating: 4.2"
      /(\d\.\d)\s*\/\s*5/,                     // "4.2 / 5"
      /★\s*(\d\.\d)/,                          // "★ 4.2"
      /(\d\.\d)\s*stars?/i,                    // "4.2 stars"
    ];

    for (const pattern of textPatterns) {
      const match = bodyText.match(pattern);
      if (match && match[1] && platform !== 'Amazon') {
        const val = parseFloat(match[1]);
        if (val >= 0 && val <= 5) {
          rating = val;
          console.log(`✓ Found rating via text pattern: ${rating}`);
          break;
        }
      }
    }

    // UNIVERSAL METHOD 2: Search HTML/JSON data
    // v1.0.78: skip for Myntra/Amazon — Myntra page has "rating":N per-star bars in
    // its state JSON that this regex catches, masking the correct platform extraction.
    if (!rating && platform !== 'Myntra' && platform !== 'Amazon') {
      const htmlPatterns = [
        /"ratingValue":"?(\d+\.?\d*)"?/,
        /"rating":"?(\d+\.?\d*)"?/,
        /aggregateRating[^}]*ratingValue[^}]*?(\d+\.?\d*)/,
        /"averageRating":"?(\d+\.?\d*)"?/,
        /"productRating":"?(\d+\.?\d*)"?/,
      ];

      for (const pattern of htmlPatterns) {
        const match = htmlContent.match(pattern);
        if (match && match[1] && platform !== 'Amazon') {
          const val = parseFloat(match[1]);
          if (val >= 0 && val <= 5) {
            rating = val;
            console.log(`✓ Found rating in HTML: ${rating}`);
            break;
          }
        }
      }
    }

    // UNIVERSAL METHOD 3: Find elements with rating-like content
    if (!rating) {
      const allElements = document.querySelectorAll('div, span, p');

      for (const el of allElements) {
        const text = el.textContent.trim();

        // Look for standalone numbers between 0-5 with 1 decimal
        if (/^\d\.\d$/.test(text) && text.length <= 3) {
          const val = parseFloat(text);
          if (val >= 1 && val <= 5) {
            // Check if parent/nearby text has rating keywords
            const parent = el.parentElement;
            const parentText = parent ? parent.textContent.toLowerCase() : '';

            if ((parentText.includes('rating') ||
                parentText.includes('star') ||
                parentText.includes('★') ||
                parentText.includes('review')) && platform !== 'Amazon') {
              rating = val;
              console.log(`✓ Found rating via element scan: ${rating}`);
              break;
            }
          }
        }
      }
    }

    // Flipkart-specific: Try JSON-LD first, then DOM
    if (platform === 'Flipkart' && !rating) {
      // Check JSON-LD
      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const ldScript of ldScripts) {
        try {
          const ld = JSON.parse(ldScript.textContent);
          const items = Array.isArray(ld) ? ld : [ld];
          for (const item of items) {
            if (item.aggregateRating && item.aggregateRating.ratingValue) {
              const v = parseFloat(item.aggregateRating.ratingValue);
              if (v > 0 && v <= 5) {
                rating = v;
                console.log(`✓ Flipkart: Rating from JSON-LD: ${rating}`);
              }
            }
          }
        } catch (e) {}
        if (rating) break;
      }

      // Then try DOM
      if (!rating) {
        rating = platformSpecificExtraction(platform);
      }
    }

    // Amazon-specific: Platform extraction with container checks
    if (platform === 'Amazon' && !rating) {
      rating = platformSpecificExtraction(platform);
    }

    // PLATFORM-SPECIFIC SELECTORS (fallback for other platforms)
    if (!rating && platform !== 'Flipkart' && platform !== 'Amazon') {
      rating = platformSpecificExtraction(platform);
    }

    // Extract review count — JSON-LD first (most reliable), then platform-specific DOM
    // JSON-LD has standardized aggregateRating.ratingCount / reviewCount
    if (platform !== 'Amazon') {
      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const ldScript of ldScripts) {
        try {
          const ld = JSON.parse(ldScript.textContent);
          const items = Array.isArray(ld) ? ld : [ld];
          for (const item of items) {
            if (item.aggregateRating) {
              const ar = item.aggregateRating;
              const rc = (ar.ratingCount || ar.reviewCount || '').toString();
              if (rc && rc !== '0' && rc !== '') {
                reviewCount = rc;
                console.log(`✓ Review count from JSON-LD: ${reviewCount}`);
              }
              // Also grab rating from JSON-LD if not found yet
              if (!rating && ar.ratingValue) {
                const v = parseFloat(ar.ratingValue);
                if (v > 0 && v <= 5) { rating = v; console.log(`✓ Rating from JSON-LD: ${rating}`); }
              }
            }
          }
        } catch (e) {}
        if (reviewCount) break;
      }
    }

    // v1.0.79: FirstCry-specific count - read directly from .ratingcount element.
    // Universal extractors mis-pick "7" from "0 to 7 Kg" weight labels.
    if (platform === 'FirstCry') {
      try {
        const fcCount = document.querySelector('.ratingNreview .ratingcount, .ratingcount');
        if (fcCount) {
          const c = parseInt(fcCount.textContent.replace(/[^0-9]/g, ''));
          if (c > 0 && c < 1000000) {
            reviewCount = String(c);
            console.log('✓ FirstCry count from .ratingcount selector: ' + reviewCount);
          }
        }
      } catch (e) {}
      // Also force-set rating from .rate if available
      try {
        const fcRate = document.querySelector('.ratingNreview .rate, .rate');
        if (fcRate) {
          const m = fcRate.textContent.trim().match(/(\d\.\d)/);
          if (m) {
            const v = parseFloat(m[1]);
            if (v >= 1 && v <= 5 && v !== 5.0) {
              rating = v;  // overwrite — canonical source
              console.log('✓ FirstCry rating from .rate selector: ' + rating);
            }
          }
        }
      } catch (e) {}
    }
    // Fallback: platform-specific DOM extraction
    if (!reviewCount) {
      reviewCount = platformSpecificCountExtraction(platform, bodyText, htmlContent);
    }
    console.log(`Review count after extraction: ${reviewCount}`);

    // Extract price (digits only, no ₹ symbol)
    let price = extractPrice(platform, bodyText, htmlContent);
    console.log(`Price after extraction: ${price}`);

    // Extract product name (universal)
    const nameSelectors = ['h1', '[class*="title"]', '[class*="name"]', '[class*="product"]'];
    for (const selector of nameSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent.trim();
        if (text.length > 10 && text.length < 200) {
          productName = text.substring(0, 100);
          console.log(`✓ Found product name: ${productName}`);
          break;
        }
      }
      if (productName) break;
    }

    // No rating → no count (count without rating is meaningless)
    if (rating === null) {
      reviewCount = null;
    }

    // Myntra sanity check: if count equals price (exact string match), the count
    // extractor almost certainly fell through and picked up the price. Reject it.
    if (platform === 'Myntra' && reviewCount && price) {
      const countNum = String(reviewCount).replace(/[^\d]/g, '');
      const priceNum = String(price).replace(/[^\d]/g, '');
      if (countNum === priceNum && countNum.length > 0) {
        console.log(`✗ Myntra: count=${reviewCount} equals price=${price}, rejecting count`);
        reviewCount = null;
        // Also drop the rating since it was likely the "Rate this product" false positive
        rating = null;
      }
    }

    // UNIVERSAL RULE: no count (or count=0) → clear rating. A product cannot have
    // a valid average rating without at least 1 review contributing to it.
    const countNumCheck = parseInt((reviewCount || '0').toString().replace(/,/g, ''));
    if (!reviewCount || countNumCheck < 1) {
      if (rating !== null) {
        console.log(`✗ Rating=${rating} rejected: count is empty/0 (no valid rating without ≥1 review). Price kept: ${price}`);
      }
      rating = null;
      reviewCount = null;
    }

    // Round rating to 1 decimal place
    if (rating !== null) {
      rating = Math.round(rating * 10) / 10;
    }

    // Extract seller name (skip Meesho for now — causes issues)
    if (platform !== 'Meesho' && platform !== 'Myntra') {
      seller = extractSeller(platform);  // v1.0.77: also skip Myntra (like Meesho)
    }

    console.log('Final extraction result:', { rating, reviewCount, price, seller, productName, platform });

    return {
      success: rating !== null || price !== null,
      platform: platform,
      rating: rating,
      reviewCount: reviewCount,
      price: price,
      seller: seller,
      productName: productName,
      url: window.location.href,
      error: (rating === null && price === null) ? 'Rating and price not found. Try scrolling the page first.' : null
    };
  }

  function platformSpecificExtraction(platform) {
    let rating = null;

    try {
      switch(platform) {
        case 'Amazon':
          // Amazon-specific selectors with container checks
          // First look for rating INSIDE specific containers
          let ratingContainer = document.querySelector('#averageCustomerReviews');
          if (!ratingContainer) ratingContainer = document.querySelector('#acrPopover');
          if (!ratingContainer) ratingContainer = document.querySelector('[data-hook="rating-out-of-text"]');

          if (ratingContainer) {
            const match = ratingContainer.textContent.match(/(\d\.\d)/);
            if (match) {
              rating = parseFloat(match[1]);
              console.log(`✓ Amazon-specific extraction from container: ${rating}`);
              break;
            }
          }

          // Fallback: span[data-hook="rating-out-of-text"] directly (only exists for actual product rating)
          if (!rating) {
            const ratingSpan = document.querySelector('span[data-hook="rating-out-of-text"]');
            if (ratingSpan) {
              const match = ratingSpan.textContent.match(/(\d\.\d)/);
              if (match) {
                rating = parseFloat(match[1]);
                console.log(`✓ Amazon-specific extraction from span: ${rating}`);
              }
            }
          }
          break;

        case 'Flipkart':
          // Flipkart-specific selectors
          const flipkartSelectors = [
            'div.XQDdHH',
            'div._1lRcqv',
            'div.hGSR34',
            'span.Wphh3N'
          ];
          for (const sel of flipkartSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const val = parseFloat(el.textContent.trim());
              if (val >= 0 && val <= 5) {
                rating = val;
                console.log(`✓ Flipkart-specific extraction: ${rating}`);
                break;
              }
            }
          }
          break;

        case 'Myntra':
          // v1.0.64: try canonical JSON sources first (Myntra-only):
          //   1. window.__myx.pdpData.ratings.averageRating
          //   2. window.__NEXT_DATA__.props.pageProps...averageRating
          //   3. JSON-LD aggregateRating in any <script type="application/ld+json">
          // If none yield a value, fall back to DOM selectors with SCORING:
          //   - prefer elements matching "X.Y | N Ratings" (canonical summary)
          //   - reject "Rate this product" widgets
          //   - pick the candidate with the HIGHEST adjacent review count
          //     (per-star bars in the distribution have lower counts)
          try {
            const scripts = document.querySelectorAll('script');
            for (const sc of scripts) {
              const txt = sc.textContent || '';
              // 1. __myx
              if (txt.includes('__myx')) {
                const m = txt.match(/window\.__myx\s*=\s*(\{[\s\S]*?\});/);
                if (m) {
                  try {
                    const j = JSON.parse(m[1]);
                    const avg = j && j.pdpData && j.pdpData.ratings && j.pdpData.ratings.averageRating;
                    if (avg) {
                      const v = parseFloat(avg);
                      if (v >= 1 && v <= 5 && v !== 5.0) {
                        rating = v;
                        console.log('✓ Myntra rating (__myx): ' + rating);
                        break;
                      }
                    }
                  } catch (e) {}
                }
              }
              // 2. __NEXT_DATA__
              if (sc.id === '__NEXT_DATA__' || txt.startsWith('{') && txt.includes('"averageRating"')) {
                try {
                  const j = JSON.parse(txt);
                  const walk = (o, depth) => {
                    if (!o || typeof o !== 'object' || depth > 8) return null;
                    if (o.averageRating != null) {
                      const v = parseFloat(o.averageRating);
                      if (v >= 1 && v <= 5 && v !== 5.0) return v;
                    }
                    for (const k of Object.keys(o)) {
                      const r = walk(o[k], depth + 1);
                      if (r != null) return r;
                    }
                    return null;
                  };
                  const v = walk(j, 0);
                  if (v != null) {
                    rating = v;
                    console.log('✓ Myntra rating (__NEXT_DATA__): ' + rating);
                    break;
                  }
                } catch (e) {}
              }
              // 3. JSON-LD aggregateRating
              if (sc.type === 'application/ld+json' || txt.includes('aggregateRating')) {
                try {
                  const j = JSON.parse(txt);
                  const items = Array.isArray(j) ? j : [j];
                  for (const it of items) {
                    const candidates = it['@graph'] ? it['@graph'] : [it];
                    for (const c of candidates) {
                      if (c.aggregateRating && c.aggregateRating.ratingValue) {
                        const v = parseFloat(c.aggregateRating.ratingValue);
                        if (v >= 1 && v <= 5 && v !== 5.0) {
                          rating = v;
                          console.log('✓ Myntra rating (JSON-LD): ' + rating);
                          break;
                        }
                      }
                    }
                    if (rating) break;
                  }
                } catch (e) {}
                if (rating) break;
              }
            }
          } catch (e) {}
          if (rating) break;

          // Fallback: DOM selector with scoring. Collect all candidates,
          // score them, pick the best one.
          {
            // v1.0.76: case-insensitive — Myntra uses camelCase like "overallRating"
            const myntraCandidates = document.querySelectorAll('[class*="rating" i]');
            let best = null;
            for (const el of myntraCandidates) {
              const text = el.textContent.trim();
              if (text.length > 500 || text.length < 3) continue;  // v1.0.85: was 200
              const lower = text.toLowerCase();
              // Skip "Rate this product" widgets
              if (lower.includes('rate this') || lower.includes('be the first')) continue;
              const hasStar = /[★⭐]/.test(text);
              const hasOutOf = /out of\s*5/i.test(text);
              // v1.0.65: handle "4.2 ★ | 19 Ratings" format (star AND pipe, any order, optional)
              const summaryMatch = text.match(/(\d\.\d)\s*[★⭐]?\s*\|?\s*([\d,.]+\s*[KkMmLl]?)\s*(?:Ratings?|Reviews?)/i);
              const plainMatch = text.match(/(\d\.\d)/);
              let val = null;
              let count = 0;
              let score = 0;
              if (summaryMatch) {
                val = parseFloat(summaryMatch[1]);
                count = pdParseCount(summaryMatch[2]);  // v1.0.85: handles K/M/L
                score = 100 + Math.min(count, 100000);  // strongly prefer summary format
              } else if (plainMatch && (hasStar || hasOutOf)) {
                val = parseFloat(plainMatch[1]);
                // try to find a review count nearby
                const nearCount = text.match(/([\d,.]+\s*[KkMmLl]?)\s*(?:Ratings?|Reviews?)/i);
                if (nearCount) count = pdParseCount(nearCount[1]);  // v1.0.85: handles K/M/L
                score = 10 + Math.min(count, 100000);
              }
              if (val == null || val < 1 || val > 5 || val === 5.0) continue;
              if (!best || score > best.score) best = { val, score, text };
            }
            if (best) {
              rating = best.val;
              console.log('✓ Myntra rating (DOM scored): ' + rating + ' (score=' + best.score + ')');
            }
          }
          break;  // v1.0.75: CRITICAL fix — was falling through to Nykaa which overwrote rating

        case 'Nykaa':
          // Nykaa rating selectors
          const nykaaEl = document.querySelector('[class*="rating"], [class*="stars"]');
          if (nykaaEl) {
            const match = nykaaEl.textContent.match(/(\d\.\d)/);
            if (match) {
              rating = parseFloat(match[1]);
              console.log(`✓ Nykaa-specific extraction: ${rating}`);
            }
          }
          break;

        case 'Meesho':
          // Meesho format: "4.3 ★ 1096 Reviews" — rating is typically in a short badge
          // element near the product title. The star "★" is usually rendered as an
          // SVG icon, not text, so element textContent may just be "4.3" or "4.31096 Reviews".

          // Method 1: Look in short badge-like elements whose text starts with "X.Y"
          // and whose parent/self mentions "review"/"★"/"rating" — this avoids picking
          // up price decimals like "4.99" by mistake.
          const meeshoCandidates = document.querySelectorAll('span, div, p');
          for (const el of meeshoCandidates) {
            const text = el.textContent.trim();
            if (text.length < 3 || text.length > 60) continue;

            const m = text.match(/^(\d\.\d)(?:\D|$)/);
            if (!m) continue;
            const val = parseFloat(m[1]);
            if (!(val > 0 && val <= 5)) continue;

            const selfLower = text.toLowerCase();
            const parent = el.parentElement;
            const parentLower = parent ? parent.textContent.toLowerCase() : '';
            if (
              selfLower.includes('review') ||
              selfLower.includes('★') ||
              parentLower.includes('review') ||
              parentLower.includes('★') ||
              parentLower.includes('rating')
            ) {
              rating = val;
              console.log(`✓ Meesho-specific extraction from badge: ${rating}`);
              break;
            }
          }

          // Method 2: Regex over bodyText — "X.Y ★" or "X.Y ... N Reviews"
          if (!rating) {
            const bodyText = document.body.innerText || '';
            let m = bodyText.match(/(\d\.\d)\s*★/);
            if (!m) m = bodyText.match(/(\d\.\d)[^\d]{0,6}\d+\s*Reviews?/i);
            if (m) {
              const v = parseFloat(m[1]);
              if (v > 0 && v <= 5) {
                rating = v;
                console.log(`✓ Meesho-specific extraction from bodyText: ${rating}`);
              }
            }
          }

          // Method 3: Last resort — scan the hydrated __NEXT_DATA__ script tag
          if (!rating) {
            const next = document.getElementById('__NEXT_DATA__');
            if (next && next.textContent) {
              const patterns = [
                /"averageRating"\s*:\s*(\d+\.?\d*)/,
                /"average_rating"\s*:\s*(\d+\.?\d*)/,
                /"catalog_rating"\s*:\s*(\d+\.?\d*)/,
                /"ratingValue"\s*:\s*"?(\d+\.?\d*)"?/
              ];
              for (const p of patterns) {
                const m = next.textContent.match(p);
                if (m) {
                  const v = parseFloat(m[1]);
                  if (v > 0 && v <= 5) {
                    rating = v;
                    console.log(`✓ Meesho-specific extraction from __NEXT_DATA__: ${rating}`);
                    break;
                  }
                }
              }
            }
          }
          break;
      }
    } catch (e) {
      console.log('Platform-specific extraction failed:', e);
    }

    return rating;
  }

  function platformSpecificCountExtraction(platform, bodyText, htmlContent) {
    let count = null;

    try {
      // ===== FLIPKART =====
      // Format: "4.2 ★ | 538" — count is after the pipe symbol
      if (platform === 'Flipkart') {
        // Method 1: Scan small elements for "rating | count" pattern
        const allEls = document.querySelectorAll('span, div');
        for (const el of allEls) {
          const text = el.textContent.trim();
          if (text.length > 100) continue;

          // "4.2 ★ | 538" or "4.2★|538"
          const pipeMatch = text.match(/★\s*\|?\s*(\d[\d,\.]*\s*[KkLl]?)\s*$/);
          if (pipeMatch) {
            count = pipeMatch[1].trim();
            console.log(`✓ Flipkart: count from ★|N pattern: ${count}`);
            break;
          }

          // "538 Ratings" or "54,232 Ratings & 6,543 Reviews"
          const ratingsMatch = text.match(/^(\d[\d,\.]*\s*[KkLl]?)\s+Ratings?/i);
          if (ratingsMatch && text.length < 80) {
            count = ratingsMatch[1].trim();
            console.log(`✓ Flipkart: count from N Ratings pattern: ${count}`);
            break;
          }
        }

        // Method 2: Look for the number right next to rating value in DOM
        if (!count) {
          const ratingEls = document.querySelectorAll('div.XQDdHH, div._1lRcqv, div.hGSR34, span.Wphh3N');
          for (const el of ratingEls) {
            const parent = el.parentElement;
            if (parent) {
              const parentText = parent.textContent.trim();
              // Extract number after the rating: "4.2 538" or "4.2 | 538"
              const m = parentText.match(/\d\.\d\s*[★\|]?\s*(\d[\d,\.]+)/);
              if (m && m[1] && parseFloat(m[1]) > 5) {
                count = m[1].trim();
                console.log(`✓ Flipkart: count from parent element: ${count}`);
                break;
              }
            }
          }
        }
      }

      // ===== AMAZON =====
      // Format: "4.1 ★★★★☆ (117)" — count in parentheses
      if (platform === 'Amazon' && !count) {
        // Method 1: Amazon's dedicated review count element
        const amazonCountEl = document.querySelector('#acrCustomerReviewText');
        if (amazonCountEl) {
          const m = amazonCountEl.textContent.match(/(\d[\d,]*)/);
          if (m) {
            count = m[1];
            console.log(`✓ Amazon: count from #acrCustomerReviewText: ${count}`);
          }
        }

        // Method 2: "(117)" link near the rating
        if (!count) {
          const ratingLinks = document.querySelectorAll('#acrCustomerReviewLink, a[href*="#customerReviews"]');
          for (const el of ratingLinks) {
            const m = el.textContent.match(/(\d[\d,]*)/);
            if (m) {
              count = m[1];
              console.log(`✓ Amazon: count from review link: ${count}`);
              break;
            }
          }
        }

        // Method 3: Look for "(number)" pattern in body text near a rating
        if (!count) {
          const m = bodyText.match(/\d\.\d[^(]{0,30}\((\d[\d,]+)\)/);
          if (m) {
            count = m[1];
            console.log(`✓ Amazon: count from (N) pattern: ${count}`);
          }
        }
      }

      // ===== MEESHO =====
      // Format: "4.3 ★ 1096 Reviews"
      // BUG FIX: DOM elements often concatenate rating + count (e.g. "4.31100 Reviews")
      // so we strip the leading rating pattern before matching to avoid "31100" instead of "1100"
      if (platform === 'Meesho' && !count) {
        // Method 1: Scan elements for "N Reviews" pattern
        const allEls = document.querySelectorAll('span, div, p');
        for (const el of allEls) {
          const text = el.textContent.trim();
          if (text.length > 100) continue;

          // Strip leading rating pattern (e.g. "4.3★", "4.3 ★ ") to prevent
          // the last digit of the rating from merging with the review count
          const cleanedText = text.replace(/\d\.\d\s*★?\s*/g, ' ').trim();

          // "1096 Reviews" — match FULL number before "Reviews"
          const m = cleanedText.match(/(\d+)\s*Reviews?/i);
          if (m && parseInt(m[1]) > 0) {
            count = m[1];
            console.log(`✓ Meesho: count from element: ${count}`);
            break;
          }
        }

        // Method 2: bodyText fallback — strip rating patterns first
        if (!count) {
          const cleanedBody = bodyText.replace(/\d\.\d\s*★?\s*/g, ' ');
          const m = cleanedBody.match(/(?<!\d)(\d{2,})\s*Reviews?/i);
          if (m) {
            count = m[1];
            console.log(`✓ Meesho: count from bodyText: ${count}`);
          }
        }
      }

      // ===== FIRSTCRY =====
      // Format: "4.3 ★ 89" — the ★ is rendered as an icon/image, NOT as text
      // So textContent may be "4.3 149", "4.3149", or "4.3 ★ 149"
      if (platform === 'FirstCry' && !count) {
        // Method 1: Scan SHORT badge elements for "rating + count" pattern
        const allEls = document.querySelectorAll('span, div, a');
        for (const el of allEls) {
          const text = el.textContent.trim();
          if (text.length < 3 || text.length > 20) continue;

          // Flexible match: "4.3 ★ 149", "4.3 149", "4.3149"
          // \D*? handles any non-digit chars between rating and count (star, spaces, etc.)
          const m = text.match(/(\d\.\d)\D*?(\d+)\s*$/);
          if (m) {
            const ratingDecimal = m[1].charAt(2); // "3" from "4.3"
            const countStr = m[2];
            // Make sure count isn't just the decimal digit of the rating (e.g. "3" from "4.3")
            if (countStr !== ratingDecimal && parseInt(countStr) > 0) {
              count = countStr;
              console.log(`✓ FirstCry: count from badge pattern: ${count}`);
              break;
            }
          }
        }

        // Method 2: Broader search — any element with "X.X number" pattern
        if (!count) {
          const allEls2 = document.querySelectorAll('span, div, a');
          for (const el of allEls2) {
            const text = el.textContent.trim();
            if (text.length > 50) continue;
            // "4.3  89" — number after the rating with at least one space
            const m = text.match(/\d\.\d\s+(\d+)/);
            if (m && parseInt(m[1]) > 0) {
              count = m[1];
              console.log(`✓ FirstCry: count from spaced pattern: ${count}`);
              break;
            }
          }
        }
      }

      // ===== MYNTRA / NYKAA =====
      if ((platform === 'Myntra' || platform === 'Nykaa') && !count) {
        const allEls = document.querySelectorAll('span, div');
        for (const el of allEls) {
          const text = el.textContent.trim();
          if (text.length > 100) continue;
          const m = text.match(/(\d[\d,\.]*\s*[KkLl]?)\s*(?:ratings?|reviews?)/i);
          if (m && m[1].trim().length > 1) {
            count = m[1].trim();
            console.log(`✓ ${platform}: count from element: ${count}`);
            break;
          }
        }
      }

    } catch(e) {
      console.log('Platform-specific count extraction error:', e);
    }

    // ===== UNIVERSAL FALLBACKS =====
    if (!count) {
      // Fallback 1: HTML/JSON structured data
      const htmlCountPatterns = [
        /"ratingCount":\s*"?(\d[\d,]*)"?/,
        /"reviewCount":\s*"?(\d[\d,]*)"?/,
        /aggregateRating[^}]*?"ratingCount":\s*"?(\d[\d,]*)"?/,
      ];
      for (const pattern of htmlCountPatterns) {
        const match = htmlContent.match(pattern);
        if (match && match[1]) {
          count = match[1];
          console.log(`✓ Count from HTML/JSON: ${count}`);
          break;
        }
      }
    }

    if (!count) {
      // Fallback 2: Universal text patterns with word boundaries
      const reviewPatterns = [
        // "54.2K Ratings" or "1.2L Reviews" (abbreviated)
        /(?<!\d)(\d+\.?\d*\s*[KkLlMm])\s*(?:ratings?|reviews?)/i,
        // "54232 Ratings" (plain number, 2+ digits, word boundary to get full number)
        /(?<!\d)(\d{2,})\s*(?:ratings?|reviews?)/i,
        // "(117)" right after a rating number
        /\d\.\d[^(]{0,30}\((\d[\d,]+)\)/,
        // "based on 1234"
        /based on\s*(\d[\d,]+)/i,
      ];

      for (const pattern of reviewPatterns) {
        const match = bodyText.match(pattern);
        if (match && match[1]) {
          const val = match[1].trim();
          if (/^\d$/.test(val)) continue;
          count = val;
          console.log(`✓ Count from universal text pattern: ${count}`);
          break;
        }
      }
    }

    // Clean up count: remove trailing commas, dots, spaces that may have
    // been captured by greedy regex patterns (e.g. "544," → "544")
    if (count) {
      count = count.replace(/[,.\s]+$/, '').trim();
    }

    return count;
  }

  function extractPrice(platform, bodyText, htmlContent) {
    let price = null;

    try {
      // ===== AMAZON =====
      if (platform === 'Amazon') {
        // GUARD: Skip price extraction entirely if the product is unavailable.
        // Amazon's "Currently unavailable" pages still contain price elements
        // (last-known price, similar-product prices in carousels, etc.) which
        // get falsely picked up by the selectors below.
        const availabilityEl = document.querySelector('#availability, #outOfStock, #buybox');
        const availabilityText = availabilityEl ? availabilityEl.textContent.toLowerCase() : '';
        const hasUnavailableText = /currently unavailable|out of stock|we don'?t know when or if this item will be back/i.test(availabilityText);
        const hasAddToCart = !!document.querySelector('#add-to-cart-button, #buy-now-button, input[name="submit.add-to-cart"], input[name="submit.buy-now"]');
        // v1.0.79: variant pages (price range) hide add-to-cart until a variant is selected.
        // Accept the page as valid if a price element is present, even without add-to-cart.
        const hasPriceElement = !!document.querySelector('span.a-price-whole, .a-price .a-offscreen, .a-price-range');

        if (hasUnavailableText) {
          console.log(`✗ Amazon: product unavailable (text match) — skipping price extraction`);
          return null;
        }
        if (!hasAddToCart && !hasPriceElement) {
          console.log(`✗ Amazon: no add-to-cart AND no price element — skipping`);
          return null;
        }

        // v1.0.100 Method 0 (PRIMARY): ATC hidden input — bulletproof.
        // Exists ONCE per page (main product), never in carousel.
        const atcInput = document.querySelector('input[name="items[0.base][customerVisiblePrice][amount]"]');
        if (atcInput && atcInput.value) {
          const v = parseFloat(String(atcInput.value).replace(/,/g, ''));
          if (v >= 10 && v < 1000000) {
            price = String(Math.round(v));
            console.log(`✓ Amazon v1.0.100: price from ATC input: ${price}`);
          }
        }

        // Method 1: SCOPED main price (apex-pricetopay-value or corePriceDisplay)
        if (!price) {
          const mainPrice = document.querySelector('.apex-pricetopay-value .a-offscreen') ||
                            document.querySelector('#corePriceDisplay_desktop_feature_div .a-offscreen') ||
                            document.querySelector('#apex_desktop .a-offscreen');
          if (mainPrice) {
            const m = mainPrice.textContent.match(/[\₹Rs\.]*\s*([\d,]+)/);
            if (m) {
              price = m[1].replace(/,/g, '');
              console.log(`✓ Amazon: price from scoped main price: ${price}`);
            }
          }
        }

        // Method 2 (fallback): a-price-whole — may pick carousel on some pages
        if (!price) {
          const priceWhole = document.querySelector('span.a-price-whole');
          if (priceWhole) {
            const digits = priceWhole.textContent.replace(/[^0-9]/g, '');
            if (digits) {
              price = digits;
              console.log(`✓ Amazon: price from a-price-whole (fallback): ${price}`);
            }
          }
        }

        // Method 3: Offscreen price (contains full price like "₹299.00")
        if (!price) {
          const offscreen = document.querySelector('.a-price .a-offscreen');
          if (offscreen) {
            const m = offscreen.textContent.match(/[\₹Rs\.]*\s*([\d,]+)/);
            if (m) {
              price = m[1].replace(/,/g, '');
              console.log(`✓ Amazon: price from a-offscreen: ${price}`);
            }
          }
        }

        // Method 3: Deal price or our price
        if (!price) {
          const priceEls = document.querySelectorAll('#priceblock_dealprice, #priceblock_ourprice, #price_inside_buybox, .a-price .a-offscreen');
          for (const el of priceEls) {
            const m = el.textContent.match(/[\₹Rs\.]*\s*([\d,]+)/);
            if (m) {
              price = m[1].replace(/,/g, '');
              console.log(`✓ Amazon: price from price block: ${price}`);
              break;
            }
          }
        }
      }

      // ===== FLIPKART =====
      if (platform === 'Flipkart' && !price) {
        // Method 1: Flipkart selling price selectors
        const flipkartPriceSelectors = [
          'div.Nx9bqj._4b5DiR',   // current selling price (product page)
          'div.Nx9bqj',            // selling price
          'div._30jeq3',           // older class for selling price
          'div._25b18c div._30jeq3'
        ];
        for (const sel of flipkartPriceSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const m = el.textContent.match(/[\₹Rs\.]*\s*([\d,]+)/);
            if (m) {
              price = m[1].replace(/,/g, '');
              console.log(`✓ Flipkart: price from ${sel}: ${price}`);
              break;
            }
          }
        }
      }

      // ===== MEESHO =====
      // BUG FIX: ₹ symbol MUST be present to avoid picking up search query numbers
      // BUG FIX: Skip crossed-out MRP prices (strikethrough) — only pick selling price
      if (platform === 'Meesho' && !price) {
        // Helper: check if an element or its ancestors have strikethrough (= MRP, not selling price)
        function isStrikethrough(el) {
          let node = el;
          while (node && node !== document.body) {
            const tag = node.tagName ? node.tagName.toLowerCase() : '';
            if (tag === 's' || tag === 'strike' || tag === 'del') return true;
            try {
              const style = window.getComputedStyle(node);
              if (style.textDecorationLine.includes('line-through') ||
                  style.textDecoration.includes('line-through')) return true;
            } catch(e) {}
            node = node.parentElement;
          }
          return false;
        }

        // Method 1: Look for elements that are exactly "₹234" or "₹1,234"
        const allEls = document.querySelectorAll('h4, h3, h2, span, div, p');
        for (const el of allEls) {
          const text = el.textContent.trim();
          if (text.length > 20) continue;

          // MUST start with ₹ — prevents matching bare numbers like search queries
          const m = text.match(/^₹\s*([\d,]+)$/);
          if (m) {
            const val = parseInt(m[1].replace(/,/g, ''));
            if (val > 0 && val < 100000 && !isStrikethrough(el)) {
              price = m[1].replace(/,/g, '');
              console.log(`✓ Meesho: price from element: ${price}`);
              break;
            }
          }
        }

        // Method 2: Look for ₹ followed by number in any element (skip delivery & crossed-out prices)
        if (!price) {
          const allEls2 = document.querySelectorAll('span, div, h1, h2, h3, h4, h5, p');
          for (const el of allEls2) {
            const text = el.textContent.trim();
            if (text.length > 50) continue;
            const m = text.match(/₹\s*([\d,]+)/);
            if (m) {
              const val = parseInt(m[1].replace(/,/g, ''));
              // Must have ₹ symbol, reasonable price, not delivery, not crossed-out MRP
              if (val > 0 && val < 100000 && !text.includes('Delivery') && !isStrikethrough(el)) {
                price = m[1].replace(/,/g, '');
                console.log(`✓ Meesho: price from ₹ pattern: ${price}`);
                break;
              }
            }
          }
        }

        // Method 3: Pull price directly from hydrated __NEXT_DATA__ script tag.
        // Meesho's SPA embeds product data here and it's reliable even if the
        // price DOM elements haven't rendered yet.
        if (!price) {
          const next = document.getElementById('__NEXT_DATA__');
          if (next && next.textContent) {
            const pricePatterns = [
              /"discounted_price"\s*:\s*"?(\d+)"?/,
              /"selling_price"\s*:\s*"?(\d+)"?/,
              /"offerPrice"\s*:\s*"?(\d+)"?/,
              /"min_product_price"\s*:\s*"?(\d+)"?/,
              /"transient_price"\s*:\s*"?(\d+)"?/,
              /"final_price"\s*:\s*"?(\d+)"?/
            ];
            for (const p of pricePatterns) {
              const m = next.textContent.match(p);
              if (m) {
                const v = parseInt(m[1]);
                if (v > 0 && v < 100000) {
                  price = m[1];
                  console.log(`✓ Meesho: price from __NEXT_DATA__: ${price}`);
                  break;
                }
              }
            }
          }
        }

        // Method 4: Standard product-price meta tags (OpenGraph / schema.org)
        if (!price) {
          const metaSelectors = [
            'meta[property="product:price:amount"]',
            'meta[property="og:price:amount"]',
            'meta[itemprop="price"]',
            'meta[name="price"]'
          ];
          for (const sel of metaSelectors) {
            const el = document.querySelector(sel);
            if (el && el.content) {
              const v = parseInt(el.content.replace(/[^\d]/g, ''));
              if (v > 0 && v < 100000) {
                price = String(v);
                console.log(`✓ Meesho: price from ${sel}: ${price}`);
                break;
              }
            }
          }
        }

        // Method 5: JSON-LD offers (standardized structured data)
        if (!price) {
          const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
          for (const s of ldScripts) {
            try {
              const ld = JSON.parse(s.textContent);
              const items = Array.isArray(ld) ? ld : [ld];
              for (const item of items) {
                if (item.offers) {
                  const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                  const raw = offer.price || offer.lowPrice || offer.highPrice;
                  if (raw != null) {
                    const v = parseInt(String(raw).replace(/[^\d]/g, ''));
                    if (v > 0 && v < 100000) {
                      price = String(v);
                      console.log(`✓ Meesho: price from JSON-LD offers: ${price}`);
                      break;
                    }
                  }
                }
              }
            } catch (e) {}
            if (price) break;
          }
        }
      }

      // ===== MEESHO: Add delivery charge to price =====
      // Delivery shown as "Delivery ₹63 ₹70" — ₹70 is strikethrough (old price).
      // We want the NON-strikethrough ₹63 added to product price.
      if (platform === 'Meesho' && price) {
        let deliveryCharge = 0;

        // Method 1 (most reliable): Check __NEXT_DATA__ for delivery/shipping charge
        const nextData = document.getElementById('__NEXT_DATA__');
        if (nextData && nextData.textContent) {
          const deliveryPatterns = [
            /"delivery_charge"\s*:\s*"?(\d+)"?/,
            /"shipping_charge"\s*:\s*"?(\d+)"?/,
            /"deliveryCharge"\s*:\s*"?(\d+)"?/,
            /"shippingCost"\s*:\s*"?(\d+)"?/,
            /"delivery_fee"\s*:\s*"?(\d+)"?/
          ];
          for (const p of deliveryPatterns) {
            const m = nextData.textContent.match(p);
            if (m) {
              const v = parseInt(m[1]);
              if (v > 0 && v < 5000) {
                deliveryCharge = v;
                console.log(`✓ Meesho: delivery from __NEXT_DATA__: ${deliveryCharge}`);
                break;
              }
            }
          }
        }

        // Method 2: Find the SMALLEST element whose text starts with "Delivery ₹"
        // Smallest = most specific = won't accidentally include product price
        if (deliveryCharge === 0) {
          let bestEl = null;
          let bestLen = 99999;
          const candidates = document.querySelectorAll('span, div, p');
          for (const el of candidates) {
            const text = el.textContent.trim();
            // Must contain "Delivery" and a ₹ amount, and be SHORT (specific)
            if (text.length > 50) continue;
            if (!/delivery/i.test(text)) continue;
            if (!/₹/.test(text)) continue;
            if (text.length < bestLen) {
              bestLen = text.length;
              bestEl = el;
            }
          }

          if (bestEl) {
            // Look at child elements for non-strikethrough ₹ amount
            const children = bestEl.querySelectorAll('span, s, del, strike, b, strong');
            for (const child of children) {
              const ct = child.textContent.trim();
              const m = ct.match(/₹\s*([\d,]+)/);
              if (!m) continue;
              const val = parseInt(m[1].replace(/,/g, ''));
              if (val <= 0 || val > 5000) continue;

              // Check strikethrough
              let isStruck = false;
              let node = child;
              while (node && node !== bestEl.parentElement) {
                const tag = node.tagName ? node.tagName.toLowerCase() : '';
                if (tag === 's' || tag === 'strike' || tag === 'del') { isStruck = true; break; }
                try {
                  const st = window.getComputedStyle(node);
                  if (st.textDecorationLine.includes('line-through') ||
                      st.textDecoration.includes('line-through')) { isStruck = true; break; }
                } catch(e) {}
                node = node.parentElement;
              }

              if (!isStruck) {
                deliveryCharge = val;
                console.log(`✓ Meesho: delivery from DOM (non-strike child): ${deliveryCharge}`);
                break;
              }
            }

            // Fallback: if no children had ₹, parse the element text directly
            // Take the FIRST ₹ amount after "Delivery" keyword
            if (deliveryCharge === 0) {
              const afterDelivery = bestEl.textContent.split(/delivery/i).pop();
              const amounts = [...afterDelivery.matchAll(/₹\s*([\d,]+)/g)];
              if (amounts.length >= 1) {
                // First amount after "Delivery" is the actual charge (non-crossed)
                const val = parseInt(amounts[0][1].replace(/,/g, ''));
                if (val > 0 && val < 5000) {
                  deliveryCharge = val;
                  console.log(`✓ Meesho: delivery from text parse: ${deliveryCharge}`);
                }
              }
            }
          }
        }

        if (deliveryCharge > 0) {
          const originalPrice = parseInt(price.replace(/,/g, ''));
          const totalPrice = originalPrice + deliveryCharge;
          console.log(`✓ Meesho: price ${originalPrice} + delivery ${deliveryCharge} = ${totalPrice}`);
          price = String(totalPrice);
        } else {
          console.log(`✓ Meesho: no delivery charge found, keeping price as ${price}`);
        }
      }

      // ===== FIRSTCRY =====
      if (platform === 'FirstCry' && !price) {
        const priceEls = document.querySelectorAll('[class*="price"], [class*="Price"], [id*="price"], [id*="Price"]');
        for (const el of priceEls) {
          const text = el.textContent.trim();
          const m = text.match(/₹\s*([\d,]+)/);
          if (m && parseInt(m[1].replace(/,/g, '')) > 0) {
            price = m[1].replace(/,/g, '');
            console.log(`✓ FirstCry: price from element: ${price}`);
            break;
          }
        }
      }

      // ===== MYNTRA / NYKAA / OTHERS =====
      if (!price && (platform === 'Myntra' || platform === 'Nykaa' || platform === 'Ajio' || platform === 'Snapdeal')) {
        const priceEls = document.querySelectorAll('[class*="price"], [class*="Price"], [class*="amount"], [class*="Amount"]');
        for (const el of priceEls) {
          const text = el.textContent.trim();
          if (!/₹|Rs\.?/i.test(text)) continue;  // v1.0.54: require ₹/Rs symbol
          const m = text.match(/(?:₹|Rs\.?)\s*([\d,]+)/i);
          if (m) {
            const val = parseInt(m[1].replace(/,/g, ''));
            if (val >= 30 && val < 1000000) {  // v1.0.54: floor ₹30 (real products never below)
              price = String(val);
              console.log(`✓ ${platform}: price from element: ${price}`);
              break;
            }
          }
        }
      }

    } catch (e) {
      console.log('Price extraction error:', e);
    }

    // ===== UNIVERSAL FALLBACK =====
    if (!price) {
      // Fallback 1: JSON structured data
      const jsonPricePatterns = [
        /"price":\s*"?([\d,]+\.?\d*)"?/,
        /"offerPrice":\s*"?([\d,]+\.?\d*)"?/,
        /"sellingPrice":\s*"?([\d,]+\.?\d*)"?/,
      ];
      for (const pattern of jsonPricePatterns) {
        const match = htmlContent.match(pattern);
        if (match && match[1]) {
          const val = parseFloat(match[1].replace(/,/g, ''));
          if (val > 0 && val < 1000000) {
            price = Math.round(val).toString();
            console.log(`✓ Price from JSON: ${price}`);
            break;
          }
        }
      }
    }

    if (!price) {
      // v1.0.54: First ₹ price on the page, with promo-context filter + floor ₹30
      const regex = /₹\s*([\d,]+)/g;
      let m;
      while ((m = regex.exec(bodyText)) !== null) {
        const val = parseInt(m[1].replace(/,/g, ''));
        if (val < 30 || val >= 100000) continue;  // skip too-small or too-large
        const start = Math.max(0, m.index - 60);
        const end = Math.min(bodyText.length, m.index + 30);
        const ctx = bodyText.slice(start, end).toLowerCase();
        // Skip promotional contexts
        if (/emi|save|cashback|discount|off |off$|coupon|bank offer|partner|free shipping|delivery charge|protection plan|warranty|exchange|supercoin|earn|reward/.test(ctx)) {
          console.log('✗ Skip ₹' + val + ' (promo context)');
          continue;
        }
        price = m[1].replace(/,/g, '');
        console.log('✓ Price from universal ₹ pattern: ' + price);
        break;
      }
    }

    return price;
  }

  // ========================================================================
  // SELLER NAME EXTRACTION
  // ========================================================================
  function extractSeller(platform) {
    try {
      // ===== AMAZON =====
      if (platform === 'Amazon') {
        // "Sold by X" in the buy box
        const soldByEl = document.querySelector('#sellerProfileTriggerId');
        if (soldByEl) return soldByEl.textContent.trim();

        // Fallback: "Sold by" text pattern
        const buyBox = document.querySelector('#buyBoxAccordion, #desktop_buybox, #newBuyBoxPrice')?.closest('[class*="buybox"], [id*="buybox"], [class*="BuyBox"]')?.parentElement || document.body;
        const allEls = buyBox.querySelectorAll('a, span, div');
        for (const el of allEls) {
          const text = el.textContent.trim();
          if (text.length < 80 && /sold\s*by/i.test(text)) {
            // Extract name after "Sold by"
            const m = text.match(/sold\s*by\s*[:\s]*(.*)/i);
            if (m && m[1].trim()) return m[1].trim();
          }
        }

        // Fallback: merchant name from page
        const merchantEl = document.querySelector('#merchant-info a, #tabular-buybox .tabular-buybox-text a');
        if (merchantEl) return merchantEl.textContent.trim();
      }

      // ===== FLIPKART =====
      if (platform === 'Flipkart') {
        // Strategy: find the SMALLEST element containing "Sold by" or "Fulfilled by"
        // Smallest = most specific = cleanest text without rating/years noise
        let bestEl = null;
        let bestLen = 99999;
        const allEls = document.querySelectorAll('span, div, a, p');
        for (const el of allEls) {
          const text = el.textContent.trim();
          if (text.length > 120 || text.length < 10) continue;
          if (/(?:sold|fulfilled)\s*by/i.test(text)) {
            if (text.length < bestLen) {
              bestLen = text.length;
              bestEl = el;
            }
          }
        }
        if (bestEl) {
          const text = bestEl.textContent.trim();
          const m = text.match(/(?:sold|fulfilled)\s*by\s*[:\s]*([\w\s&.\-]+)/i);
          if (m && m[1].trim().length > 1 && m[1].trim().length < 50) {
            // Clean up: remove trailing rating text like "4.1★" or "4.1•" or just "4.1"
            let name = m[1].trim()
              .replace(/\d+\.\d+\s*[★•].*$/, '')   // "4.1★..." or "4.1•..."
              .replace(/\d+\.\d+\s*$/, '')           // trailing "4.1"
              .trim();
            if (name) return name;
          }
        }
      }

      // ===== MEESHO =====
      if (platform === 'Meesho') {
        // Meesho shows "Sold By" on product pages (/p/...) only.
        // The DOM text is like: Sold By"365available"View Shop4.1...
        // We need to find the "Sold By" heading and extract the name after it.

        // Method 1: Find h6/h5 with "Sold By", then parse container text
        const headings = document.querySelectorAll('h6, h5, h4, h3, span, div');
        for (const h of headings) {
          const ht = h.textContent.trim();
          if (ht.length > 10 || !/^sold\s*by$/i.test(ht)) continue;
          // Found exact "Sold By" heading — get parent container text
          const container = h.closest('div') || h.parentElement;
          if (container) {
            const fullText = container.textContent.trim();
            // Pattern: Sold By"NAME"View Shop  or  Sold By NAME View Shop
            const m = fullText.match(/sold\s*by\s*[""]?\s*([^""]+?)\s*[""]?\s*(?:view\s*shop|$)/i);
            if (m && m[1].trim().length > 1) {
              const name = m[1].trim().replace(/^["'""]+|["'""]+$/g, '');
              if (name.length > 0 && name.length < 50) {
                console.log('✓ Meesho seller from heading container: ' + name);
                return name;
              }
            }
          }
        }

        // Method 2: Search all elements for "Sold By" + name pattern
        const allEls = document.querySelectorAll('span, div, p, a');
        for (const el of allEls) {
          const text = el.textContent.trim();
          if (text.length > 200 || text.length < 8) continue;
          if (!/sold\s*by/i.test(text)) continue;
          // Try to extract name between "Sold By" and "View Shop"
          const m = text.match(/sold\s*by\s*[""]?\s*([^""]+?)\s*[""]?\s*(?:view\s*shop|\d+\.\d+|$)/i);
          if (m && m[1].trim().length > 1 && m[1].trim().length < 50) {
            const name = m[1].trim().replace(/^["'""]+|["'""]+$/g, '');
            if (name) {
              console.log('✓ Meesho seller from text pattern: ' + name);
              return name;
            }
          }
        }

        // Method 3: __NEXT_DATA__
        const next = document.getElementById('__NEXT_DATA__');
        if (next && next.textContent) {
          const m = next.textContent.match(/"supplier_name"\s*:\s*"([^"\\]+)"/);
          if (m && m[1].trim()) return m[1].trim();
          const m2 = next.textContent.match(/"shop_name"\s*:\s*"([^"\\]+)"/);
          if (m2 && m2[1].trim()) return m2[1].trim();
        }
      }

      // ===== MYNTRA =====
      if (platform === 'Myntra') {
        // Strategy: find smallest element with "Seller:" text
        let bestEl = null;
        let bestLen = 99999;
        const allEls = document.querySelectorAll('span, div, a, p');
        for (const el of allEls) {
          const text = el.textContent.trim();
          if (text.length > 80 || text.length < 8) continue;
          if (/seller\s*:/i.test(text)) {
            if (text.length < bestLen) {
              bestLen = text.length;
              bestEl = el;
            }
          }
        }
        if (bestEl) {
          const text = bestEl.textContent.trim();
          const m = text.match(/seller\s*[:\s]+([\w\s&.\-]+)/i);
          if (m && m[1].trim().length > 1 && m[1].trim().length < 50) {
            let name = m[1].trim()
              .replace(/\s*View\s*Supplier\s*Information.*/i, '')
              .replace(/\s*View\s*Shop.*/i, '')
              .trim();
            if (name) return name;
          }
        }
      }

      // ===== UNIVERSAL FALLBACK =====
      // Try "Sold by" or "Seller:" pattern on any platform
      const allEls = document.querySelectorAll('span, div, a, p');
      for (const el of allEls) {
        const text = el.textContent.trim();
        if (text.length > 80) continue;
        const m = text.match(/(?:sold|fulfilled|shipped)\s*by\s*[:\s]*([\w\s&.\-"]+)/i);
        if (m && m[1].trim().length > 1 && m[1].trim().length < 50) {
          return m[1].trim().replace(/^["']|["']$/g, '');
        }
      }

    } catch (e) {
      console.log('Seller extraction error:', e);
    }
    return null;
  }

  function extractAndSendRating() {
    // v1.0.48 diagnostic: log every extraction attempt to background console
    try {
      const data = extractRatingData();
      chrome.runtime.sendMessage({
        action: "pd_diag",
        ts: Date.now(),
        url: window.location.href,
        platform: data.platform,
        success: data.success,
        rating: data.rating,
        reviewCount: data.reviewCount,
        price: data.price,
        seller: data.seller,
        error: data.error,
      }).catch(() => {});
    } catch (e) { console.warn('diag err:', e); }

    chrome.storage.sync.get(['autoMode'], (result) => {
      if (result.autoMode) {
        const data = extractRatingData();

        if (data.success) {
          console.log('✓ Auto-sync: Sending rating');

          chrome.runtime.sendMessage({
            action: 'ratingExtracted',
            data: data
          });

          showNotification(data);
        } else {
          console.log('✗ Rating extraction failed');
        }
      }
    });
  }

  function showNotification(data) {
    // Remove existing notification
    const existing = document.getElementById('universal-rating-toast');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'universal-rating-toast';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      min-width: 300px;
      animation: slideInRight 0.4s ease-out;
      cursor: pointer;
    `;

    notification.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
        <div style="font-weight: bold; font-size: 18px;">⭐ Rating Found!</div>
        <div style="background: rgba(255,255,255,0.3); border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: bold;">
          ${data.platform}
        </div>
      </div>

      <div style="background: rgba(255,255,255,0.25); padding: 16px; border-radius: 10px; margin-bottom: 12px; text-align: center;">
        <div style="font-size: 42px; font-weight: bold; line-height: 1;">${data.rating}</div>
        <div style="font-size: 28px; opacity: 0.9;">★★★★★</div>
        ${data.reviewCount ? `<div style="font-size: 13px; margin-top: 6px; opacity: 0.95;">${data.reviewCount} reviews</div>` : ''}
        ${data.price ? `<div style="font-size: 15px; margin-top: 8px; font-weight: bold; opacity: 0.95;">Price: ₹${data.price}</div>` : ''}
      </div>

      ${data.productName ? `<div style="font-size: 12px; opacity: 0.9; margin-bottom: 12px; line-height: 1.4; max-height: 40px; overflow: hidden;">${data.productName}</div>` : ''}

      <div style="background: #4ade80; color: #065f46; padding: 12px; border-radius: 8px; text-align: center; font-weight: bold; font-size: 13px;">
        ✓ RATING${data.reviewCount ? ' + COUNT' : ''}${data.price ? ' + PRICE' : ''} COPIED TO CLIPBOARD!
      </div>

      <div style="font-size: 11px; text-align: center; margin-top: 10px; opacity: 0.85;">
        Go to your Google Sheet and press Ctrl+V to paste${(data.reviewCount || data.price) ? ' (in separate columns)' : ''}
      </div>
    `;

    // Add animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideInRight {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    // Auto-copy to clipboard (rating + count + price, tab-separated for sheet columns)
    try {
      let clipboardText = data.rating.toString();
      if (data.reviewCount) clipboardText += `\t${data.reviewCount}`;
      if (data.price) clipboardText += `\t${data.price}`;
      navigator.clipboard.writeText(clipboardText);
      console.log('✓ Rating + count + price copied to clipboard');
    } catch (err) {
      console.log('Could not copy to clipboard:', err);
    }

    // Click to dismiss
    notification.addEventListener('click', () => {
      notification.style.animation = 'slideOutRight 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    });

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      if (document.getElementById('universal-rating-toast')) {
        notification.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
      }
    }, 8000);
  }
})();
