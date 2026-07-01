/* Cursive demo-mode helper (v2).
 * Loaded on customer-facing pages (home, pdtracker, wallet).
 *
 * Strategy:
 *   - Shared reads (product data, snapshots, wallet balance) come from the real
 *     rahul@cursive.world account via the normal endpoints. All demo visitors
 *     see the same underlying data.
 *   - Per-visitor writes (auto-renew toggle, billing profile, simulated
 *     purchases) are intercepted in the browser and stored in localStorage.
 *     Nothing is written to the database.
 *   - Hard blocks (Razorpay payments, uploads, extension download, reports)
 *     show a friendly demo modal.
 *
 * This means Customer A's actions never affect Customer B's demo experience.
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
  var LS_KEY = "cw_demo_state_v1";
  var _isDemo = null;

  // ---------- localStorage state helpers ----------
  function getState() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (e) { return {}; }
  }
  function setState(patch) {
    var s = getState();
    Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function clearState() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
  window.cwDemoClearState = clearState;

  // ---------- Detect demo ----------
  async function checkIsDemo() {
    if (_isDemo !== null) return _isDemo;
    try {
      var raw = localStorage.getItem("pd_tracker_auth");
      if (!raw) return false;
      var obj = JSON.parse(raw);
      var s = (obj && obj.currentSession) ? obj.currentSession : obj;
      var token = s && s.access_token;
      if (!token) return false;
      var res = await origFetch(SUPABASE_URL + "/functions/v1/analytics-wallet-summary?limit=1", {
        headers: { "Authorization": "Bearer " + token }
      });
      var j = await res.json();
      _isDemo = !!j.is_demo_account;
    } catch (e) { _isDemo = false; }
    return _isDemo;
  }

  // ---------- UI helpers ----------
  function showDemoBanner() {
    if (document.getElementById("cw-demo-banner")) return;
    var b = document.createElement("div");
    b.id = "cw-demo-banner";
    b.style.cssText = "position:sticky;top:0;z-index:9998;background:linear-gradient(90deg,#fef3c7,#fde68a);color:#92400e;padding:8px 16px;text-align:center;font-size:13px;font-weight:700;border-bottom:1px solid #f59e0b;box-shadow:0 2px 4px rgba(0,0,0,0.05);";
    b.innerHTML = "🎬 <b>DEMO ACCOUNT</b> — This is a preview. Payments and downloads are disabled. <a href='/pdtracker/signup.html' style='color:#0d4cb8;text-decoration:underline;'>Create your own account →</a>";
    if (document.body) document.body.insertBefore(b, document.body.firstChild);
    else document.addEventListener("DOMContentLoaded", function () { document.body.insertBefore(b, document.body.firstChild); });
  }

  function showDemoModal(message, isPositive) {
    var m = document.getElementById("cw-demo-modal");
    if (m) m.remove();
    m = document.createElement("div");
    m.id = "cw-demo-modal";
    m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;";
    var emoji = isPositive ? "✅" : "🎬";
    var title = isPositive ? "Demo action completed" : "This is a demo account";
    var defMsg = isPositive
      ? "Nothing was actually charged or stored. In a real account, this action would go through."
      : "Payments, uploads and downloads are disabled here so you can safely explore the tool.";
    m.innerHTML = "" +
      "<div style='background:#fff;border-radius:14px;max-width:420px;width:100%;padding:26px 28px;box-shadow:0 20px 40px rgba(0,0,0,0.25);'>" +
        "<div style='font-size:44px;text-align:center;margin-bottom:8px;'>" + emoji + "</div>" +
        "<h2 style='margin:0 0 8px;text-align:center;font-size:20px;color:#0f172a;'>" + title + "</h2>" +
        "<p class='msg' style='margin:0 0 18px;text-align:center;color:#64748b;font-size:14px;line-height:1.5;'>" + (message || defMsg) + "</p>" +
        "<div style='background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px;margin-bottom:14px;color:#0c4a6e;font-size:13px;line-height:1.6;'>" +
          "<b>Ready to try it for real?</b><br>Create your free account and start with a 30-day trial — no credit card required." +
        "</div>" +
        "<div style='display:flex;gap:8px;'>" +
          "<button class='cw-demo-close' style='flex:1;background:#f1f5f9;color:#475467;border:none;padding:11px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;'>Continue browsing</button>" +
          "<a href='/pdtracker/signup.html' style='flex:1;background:#1f6feb;color:#fff;border:none;padding:11px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;text-align:center;text-decoration:none;'>Sign up free →</a>" +
        "</div>" +
      "</div>";
    document.body.appendChild(m);
    m.querySelector(".cw-demo-close").addEventListener("click", function () { m.remove(); });
    m.addEventListener("click", function (e) { if (e.target === m) m.remove(); });
  }
  window.cwDemoModal = showDemoModal;

  // ---------- Fetch response builder ----------
  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ---------- URL matchers ----------
  function isEndpoint(url, slug) {
    return url && url.indexOf("/functions/v1/" + slug) >= 0;
  }
  function isEndpointAny(url, slugs) {
    for (var i = 0; i < slugs.length; i++) if (isEndpoint(url, slugs[i])) return true;
    return false;
  }

  // ---------- Original fetch reference ----------
  var origFetch = window.fetch.bind(window);

  // ---------- Intercepting fetch ----------
  window.fetch = async function (input, init) {
    var url = (typeof input === "string") ? input : (input && input.url) || "";
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var isJson = init && init.body && typeof init.body === "string";
    var body = null;
    if (isJson) { try { body = JSON.parse(init.body); } catch (e) {} }

    // Only intercept if we know we're in demo mode
    var demoActive = _isDemo === true;

    if (demoActive) {
      // ---- GETs that we overlay with localStorage state ----

      // auto-renew GET
      if (method === "GET" && isEndpoint(url, "pdtracker-toggle-auto-renew")) {
        var st = getState();
        if (st.auto_renew !== undefined) {
          return jsonResponse({ ok: true, auto_renew_enabled: !!st.auto_renew });
        }
      }

      // billing-profile GET
      if (method === "GET" && isEndpoint(url, "analytics-billing-profile")) {
        var st2 = getState();
        if (st2.billing_profile) {
          return jsonResponse({ ok: true, profile: st2.billing_profile });
        }
      }

      // ---- POSTs that we simulate + save locally ----

      // Toggle auto-renew POST → save locally, fake success
      if (method === "POST" && isEndpoint(url, "pdtracker-toggle-auto-renew") && body) {
        // Backend already returns { ok:false, otp_required:true } on first hit.
        // If we're being asked WITHOUT action_token, just save the desired state.
        if (!body.action_token) {
          setState({ auto_renew_pending: !!body.enabled });
          // Return a fake OTP prompt so the OTP UI opens; user enters ANY 6 digits.
          // Actually simpler: just save state directly and return success (skip OTP for demo).
          setState({ auto_renew: !!body.enabled });
          return jsonResponse({ ok: true, auto_renew_enabled: !!body.enabled });
        }
      }

      // Billing-profile POST → save locally
      if (method === "POST" && isEndpoint(url, "analytics-billing-profile") && body) {
        var profile = {
          legal_name: body.legal_name || "",
          billing_address: body.billing_address || "",
          gst_number: body.gst_number || null,
          state_code: body.state_code || null,
          mobile: body.mobile || null,
          updated_at: new Date().toISOString(),
        };
        setState({ billing_profile: profile });
        return jsonResponse({ ok: true, profile: profile });
      }

      // Simulate service purchase → save "order" locally, don't hit backend
      if (method === "POST" && isEndpoint(url, "wallet-pay-service") && body) {
        // Backend already blocks with { code:"demo_account" } but we can pretend success.
        // The OTP-required first hit — return no-otp-required so the UI proceeds cleanly.
        var svc = body.service_tag || "service";
        var qty = body.qty || 1;
        // Push into simulated orders
        var st3 = getState();
        var orders = st3.demo_orders || [];
        orders.push({ tag: svc, qty: qty, at: new Date().toISOString() });
        setState({ demo_orders: orders });
        setTimeout(function () {
          showDemoModal("Demo purchase recorded (browser only). Nothing was charged. Sign up to make real purchases.", true);
        }, 100);
        return jsonResponse({
          ok: true,
          service_tag: svc,
          service_name: svc,
          qty: qty,
          total_paise: 0,
          base_paise: 0,
          gst_paise: 0,
          new_balance_paise: 50000,
          description: "Demo simulated purchase",
        });
      }

      // Simulate pack purchase
      if (method === "POST" && isEndpoint(url, "pdtracker-buy-pack") && body) {
        setTimeout(function () {
          showDemoModal("Demo pack purchase recorded (browser only). Nothing was charged.", true);
        }, 100);
        return jsonResponse({
          ok: true,
          order_id: "demo-" + Date.now(),
          amount_paise: 0,
          plan_tier: body.plan_tier,
          plan_label: "Demo pack",
        });
      }
    }

    // ---- Pass through to real fetch ----
    var res = await origFetch(input, init);

    // Post-process: catch demo_account error codes from backend and show modal
    try {
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("application/json") >= 0) {
        var cloned = res.clone();
        var j = await cloned.json();
        if (j && j.ok === false && j.code === "demo_account") {
          showDemoModal(j.message);
        }
      }
    } catch (e) {}

    return res;
  };

  // ---------- Boot ----------
  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(async function () {
      var isDemo = await checkIsDemo();
      if (isDemo) showDemoBanner();
    }, 200);
  });

  window.cwCheckIsDemo = checkIsDemo;
})();
