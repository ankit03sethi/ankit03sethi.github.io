// cursive.world analytics + UTM capture
// ────────────────────────────────────────────────────────────────────────
// To turn on tracking, paste your IDs below. Leave blank to keep silent.
//   META_PIXEL_ID      — from Meta Business Manager (e.g. '1234567890123456')
//   GA4_MEASUREMENT_ID — from Google Analytics 4 (e.g. 'G-XXXXXXXXXX')
//   GADS_TAG_ID        — from Google Ads (e.g. 'AW-12345678')
//   GADS_PURCHASE_LBL  — conversion action label for 'Purchase' (e.g. 'abcdEFGH123')
// ────────────────────────────────────────────────────────────────────────
(function () {
  var META_PIXEL_ID      = "";
  var GA4_MEASUREMENT_ID = "";
  var GADS_TAG_ID        = "";
  var GADS_PURCHASE_LBL  = "";

  // ── UTM / click-id capture ─────────────────────────────────────────────
  // Persist the first set of ad params we saw, so even if the customer
  // bounces from /pdtracker/ to /gst/ to checkout we still know they came
  // from a Meta ad.
  var KEY = "cw_attribution";
  function captureAttribution() {
    try {
      var existing = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (existing) return existing; // first-touch wins
      var p = new URLSearchParams(location.search);
      var out = {};
      ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid","msclkid"]
        .forEach(function (k) { var v = p.get(k); if (v) out[k] = v; });
      if (Object.keys(out).length) {
        out.landing_page = location.pathname;
        out.referrer = document.referrer || "";
        out.captured_at = new Date().toISOString();
        sessionStorage.setItem(KEY, JSON.stringify(out));
        return out;
      }
    } catch (e) { /* no-op */ }
    return {};
  }
  var attr = captureAttribution();

  // ── Public helpers ─────────────────────────────────────────────────────
  window.cwGetAttribution = function () {
    try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch { return {}; }
  };
  window.cwTrack = function (event, params) {
    params = params || {};
    try {
      // Meta Pixel
      if (window.fbq) window.fbq("track", event, params);
      // GA4 (gtag.js)
      if (window.gtag) window.gtag("event", event.toLowerCase(), params);
      // Google Ads conversion (purchase only by default — extend if needed)
      if (event === "Purchase" && window.gtag && GADS_TAG_ID && GADS_PURCHASE_LBL) {
        window.gtag("event", "conversion", {
          send_to: GADS_TAG_ID + "/" + GADS_PURCHASE_LBL,
          value: params.value || 0,
          currency: params.currency || "INR",
          transaction_id: params.transaction_id || ""
        });
      }
    } catch (e) { /* swallow */ }
  };

  // ── Loader: Meta Pixel ─────────────────────────────────────────────────
  if (META_PIXEL_ID) {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
      document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq("init", META_PIXEL_ID);
    window.fbq("track", "PageView");
  }

  // ── Loader: GA4 + Google Ads ───────────────────────────────────────────
  if (GA4_MEASUREMENT_ID || GADS_TAG_ID) {
    var gaScript = document.createElement("script");
    gaScript.async = true;
    gaScript.src = "https://www.googletagmanager.com/gtag/js?id=" + (GA4_MEASUREMENT_ID || GADS_TAG_ID);
    document.head.appendChild(gaScript);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    if (GA4_MEASUREMENT_ID) window.gtag("config", GA4_MEASUREMENT_ID);
    if (GADS_TAG_ID)        window.gtag("config", GADS_TAG_ID);
  }
})();
