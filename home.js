/* cursive - shared JS for home page + service landing pages
 *
 * Lead flow:
 *   1. User clicks "Get started" -> modal opens
 *   2. Mobile + Email -> POST lead_otp_send -> OTP email
 *   3. OTP -> POST lead_otp_verify -> lead recorded
 *   4. Show action chooser: Pay (Razorpay) OR Request callback
 *   5a. Pay -> service_pay_initiate -> Razorpay -> service_pay_complete
 *   5b. Callback -> done (lead already in sheet via OTP verify)
 *
 * If user is already signed in (Supabase session in localStorage):
 *   - Topbar swaps "Login" for "Home" + "Logout"
 *   - Lead modal skips Mobile/Email/OTP and opens directly on action step
 */

// ---- Session helper + topbar nav swap (runs on EVERY page that loads home.js) ----
(function () {
  "use strict";

  // Read Supabase session straight from localStorage (no supabase-js needed here).
  // The /home/, /pdtracker/, etc. pages persist auth under storageKey "pd_tracker_auth".
  function readCursiveSession() {
    try {
      var raw = localStorage.getItem("pd_tracker_auth");
      if (!raw) return null;
      var obj = JSON.parse(raw);
      // supabase-js stores as { currentSession: {...} } in older versions OR direct object in newer.
      var s = (obj && obj.currentSession) ? obj.currentSession : obj;
      if (!s || !s.access_token) return null;
      // Check token not expired
      if (s.expires_at && s.expires_at * 1000 < Date.now()) return null;
      var email = (s.user && s.user.email) || s.email || "";
      var mobile = (s.user && s.user.user_metadata && (s.user.user_metadata.phone || s.user.user_metadata.mobile)) || "";
      return { access_token: s.access_token, email: email, mobile: mobile };
    } catch (e) { return null; }
  }
  // Expose for the main IIFE below
  window.__cursiveSession = readCursiveSession;

  function signOutAndGoHome() {
    try { localStorage.removeItem("pd_tracker_auth"); } catch (e) {}
    window.location.href = "/";
  }
  window.__cursiveSignOut = signOutAndGoHome;

  function swapTopbarNav() {
    var sess = readCursiveSession();
    if (!sess) return; // not logged in -> leave Login button alone

    // Robust detection: match by trailing "login" or "sign in" in textContent.
    // Handles 🔒 Login, Sign in, plain Login, etc.
    var nodes = document.querySelectorAll("a, button");
    var loginNodes = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var txt = (n.textContent || "").trim().toLowerCase();
      if (txt.length === 0 || txt.length > 20) continue;
      if (/(^|\s)log\s*in\s*$/.test(txt) || /(^|\s)sign\s*in\s*$/.test(txt)) {
        loginNodes.push(n);
      }
    }

    if (loginNodes.length === 0) return;

    // Build our own buttons with explicit inline styles (don't inherit the
    // original className — its CSS gradient/color was eating our Logout text).
    var BTN_BASE = "display:inline-block;padding:10px 18px;border-radius:10px;" +
                   "font-weight:600;font-size:14px;text-decoration:none;cursor:pointer;" +
                   "font-family:inherit;line-height:1.2;vertical-align:middle;";
    var BTN_PRIMARY = BTN_BASE + "background:#1f6feb;color:#fff;border:1px solid #1f6feb;";
    var BTN_GHOST   = BTN_BASE + "background:#fff;color:#1f6feb;border:1px solid #1f6feb;";

    loginNodes.forEach(function (loginEl) {
      var parent = loginEl.parentNode;
      if (!parent) return;

      var wrap = document.createElement("span");
      wrap.style.cssText = "display:inline-flex;gap:8px;align-items:center;";

      var homeBtn = document.createElement("a");
      homeBtn.href = "/home/";
      homeBtn.textContent = "Home";
      homeBtn.setAttribute("style", BTN_PRIMARY);

      var outBtn = document.createElement("button");
      outBtn.type = "button";
      outBtn.textContent = "Logout";
      outBtn.setAttribute("style", BTN_GHOST);
      outBtn.addEventListener("click", function (e) {
        e.preventDefault();
        signOutAndGoHome();
      });

      wrap.appendChild(homeBtn);
      wrap.appendChild(outBtn);
      parent.replaceChild(wrap, loginEl);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", swapTopbarNav);
  } else {
    swapTopbarNav();
  }
})();

(function () {
  "use strict";

  var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyf3idQypXbdftkUCj6y1W1jaZiZYTcnv5PoiFycwbh2PL7Ppl8MN_GCGLAdErEdHY/exec";
  var WHATSAPP_NUMBER = "919625737475";

  // ---- Supabase Edge Functions (feature-flagged migration) ----
  // Activate per-browser by adding ?supabase=1 to any page URL, OR
  // by running in console: localStorage.setItem("cursive_use_supabase","1")
  // Turn off with ?supabase=0 or localStorage.removeItem(...)
  var SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8";
  // Supabase is now the default backend for ALL customers.
  // Add ?supabase=0 to any URL to fall back to Apps Script (emergency switch).
  function useSupabase() {
    try {
      var qs = window.location.search || "";
      if (qs.indexOf("supabase=0") !== -1) {
        try { localStorage.setItem("cursive_use_supabase", "0"); } catch (e) {}
        return false;
      }
      if (qs.indexOf("supabase=1") !== -1) {
        try { localStorage.removeItem("cursive_use_supabase"); } catch (e) {}
        return true;
      }
      // Default true unless someone explicitly opted out via localStorage
      return localStorage.getItem("cursive_use_supabase") !== "0";
    } catch (e) { return true; }
  }

  // ---- year in footer ----
  var yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  // ---- elements ----
  var overlay     = document.getElementById("leadOverlay");
  if (!overlay) return; // No modal on this page, nothing to wire

  var closeBtn    = document.getElementById("leadCloseBtn");
  var serviceEl   = document.getElementById("leadService");
  var priceEl     = document.getElementById("leadPrice");

  var formContact = document.getElementById("leadFormContact");
  var formOtp     = document.getElementById("leadFormOtp");
  var stepAction  = document.getElementById("leadStepAction");
  var stepCallback = document.getElementById("leadStepCallback");
  var stepPaid    = document.getElementById("leadStepPaid");
  var stepPayDetails = null; // lazily created on first Pay click — shared on every service page

  var mobileEl    = document.getElementById("leadMobile");
  var emailEl     = document.getElementById("leadEmail");
  var otpEl       = document.getElementById("leadOtp");
  var otpEmailEl  = document.getElementById("leadOtpEmail");

  var sendOtpBtn    = document.getElementById("sendOtpBtn");
  var verifyOtpBtn  = document.getElementById("verifyOtpBtn");
  var resendBtn     = document.getElementById("resendOtpBtn");
  var changeEmailBtn = document.getElementById("changeEmailBtn");
  var payBtn        = document.getElementById("leadPayBtn");
  var callbackBtn   = document.getElementById("leadCallbackBtn");
  var payAmountEl   = document.getElementById("leadPayAmount");
  var paidEmailEl   = document.getElementById("leadPaidEmail");
  var paidInvoiceEl = document.getElementById("leadPaidInvoice");
  var doneBtn      = document.getElementById("leadDoneBtn");
  var doneBtn2     = document.getElementById("leadDoneBtn2");

  var errEl        = document.getElementById("leadError");
  var otpErrEl     = document.getElementById("leadOtpError");
  var otpOkEl      = document.getElementById("leadOtpSuccess");

  var currentService = "";
  var currentPrice   = "";
  var currentPriceNum = 0;
  var currentServiceTag = "";
  var currentEmail   = "";
  var currentMobile  = "";

  // ---- Service tag (column A in All Leads sheet) ----
  function serviceTag(serviceName) {
    var s = String(serviceName || "").toLowerCase();
    if (s.indexOf("business launcher") !== -1) return "business_launcher";
    if (s.indexOf("seller analytics") !== -1) return "analytics";
    if (s.indexOf("gst") !== -1)              return "gst";
    if (s.indexOf("trademark") !== -1)        return "trademark";
    if (s.indexOf("udyam") !== -1)            return "udyam";
    if (s.indexOf("iec") !== -1)              return "iec";
    if (s.indexOf("marketplace") !== -1)      return "platform_account";
    if (s.indexOf("account opening") !== -1)  return "platform_account";
    return "other";
  }

  function showStep(which) {
    formContact.classList.add("hidden");
    formOtp.classList.add("hidden");
    if (stepAction)     stepAction.classList.add("hidden");
    if (stepCallback)   stepCallback.classList.add("hidden");
    if (stepPaid)       stepPaid.classList.add("hidden");
    if (stepPayDetails) stepPayDetails.classList.add("hidden");
    if (which === "contact")     formContact.classList.remove("hidden");
    if (which === "otp")         formOtp.classList.remove("hidden");
    if (which === "action" && stepAction)         stepAction.classList.remove("hidden");
    if (which === "paydetails" && stepPayDetails) stepPayDetails.classList.remove("hidden");
    if (which === "callback" && stepCallback)     stepCallback.classList.remove("hidden");
    if (which === "paid" && stepPaid)             stepPaid.classList.remove("hidden");
  }

  // Determine current service for modal:
  //  1. From the clicked card's data-service / data-price (home page)
  //  2. From body[data-service-tag/name/price] (service pages)
  function configureFromCard(card) {
    currentService = card.getAttribute("data-service") || "";
    currentPrice   = card.getAttribute("data-price") || "";
    currentServiceTag = serviceTag(currentService);
    currentPriceNum = parseInt(String(currentPrice).replace(/[^\d]/g, ""), 10) || 0;
  }
  function configureFromBody() {
    var b = document.body;
    currentService    = b.getAttribute("data-service-name") || "";
    currentServiceTag = b.getAttribute("data-service-tag") || serviceTag(currentService);
    var priceNum = parseInt(b.getAttribute("data-service-price") || "0", 10) || 0;
    currentPriceNum = priceNum;
    currentPrice    = priceNum ? ("₹" + priceNum) : "";
  }

  function openLeadModal(triggerEl) {
    var card = triggerEl.closest("[data-service]");
    if (card) configureFromCard(card);
    else configureFromBody();

    serviceEl.textContent = currentService || "Service";
    priceEl.textContent   = currentPrice || "";
    if (payAmountEl) payAmountEl.textContent = currentPriceNum || "999";

    hideErr(); hideOtpErr(); hideOtpOk();

    formContact.reset();
    formOtp.reset();
    leadDraftSent = false;   // reset abandoned-form flag for this new modal session
    setBusy(sendOtpBtn, false, "Continue");
    setBusy(verifyOtpBtn, false, "Verify →");
    setBusy(resendBtn, false, "Resend OTP");
    if (payBtn) setBusy(payBtn, false, payBtnLabel());
    if (callbackBtn) setBusy(callbackBtn, false, "Request callback instead");

    // Knowledge-page mode: keep OTP (collects mobile + email), then show only Call / WhatsApp / Callback.
    // Remove any inline mini-form (we already get the number from OTP)
    var oldKp = document.getElementById("leadKpForm"); if (oldKp) oldKp.remove();

    // Remove any previously-injected "Register now to pay" button so we can
    // re-decide whether to add it based on the *current* session state.
    var oldReg = document.getElementById("leadRegisterBtn"); if (oldReg) oldReg.remove();

    // ---- If user is already signed in: skip Mobile/Email/OTP entirely ----
    // - Pre-fill currentEmail from session
    // - Jump straight to action step
    // - Hide native Pay button
    // - DO NOT inject "Register now to pay" (no need — they're logged in already)
    var sess = (typeof window.__cursiveSession === "function") ? window.__cursiveSession() : null;
    if (sess && sess.email) {
      currentEmail  = sess.email;
      currentMobile = sess.mobile || "";
      if (stepAction) {
        if (payBtn) payBtn.style.display = "none";
        var existingQty = document.getElementById("leadQtyWrap");
        if (existingQty) existingQty.remove();
        showStep("action");
        overlay.classList.remove("hidden");
        return;
      }
    }

    // Not signed in -> normal OTP flow
    showStep("contact");
    overlay.classList.remove("hidden");
    setTimeout(function () { mobileEl.focus(); }, 50);
  }
  function payBtnLabel() {
    return "🔒 Pay ₹" + (currentPriceNum || "") + "/- now";
  }
  function closeLeadModal() { overlay.classList.add("hidden"); }

  // ---- wire up triggers ----
  document.querySelectorAll("[data-open-lead]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      openLeadModal(btn);
    });
  });

  closeBtn.addEventListener("click", closeLeadModal);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeLeadModal(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeLeadModal();
  });

  // ---- validators ----
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim()); }
  function isMobile(s) { return /^[+]?[\d\s\-()]{7,18}$/.test(String(s || "").trim()); }
  function normMobile(s) { return String(s || "").replace(/\D/g, ""); }

  // ---- error helpers ----
  function showErr(m)    { errEl.textContent = m; errEl.classList.remove("hidden"); }
  function hideErr()     { errEl.classList.add("hidden"); }
  function showOtpErr(m) { otpErrEl.textContent = m; otpErrEl.classList.remove("hidden"); }
  function hideOtpErr()  { otpErrEl.classList.add("hidden"); }
  function showOtpOk(m)  { otpOkEl.textContent = m; otpOkEl.classList.remove("hidden"); }
  function hideOtpOk()   { otpOkEl.classList.add("hidden"); }
  function setBusy(btn, busy, idleText) {
    if (!btn) return;
    if (busy) {
      btn.disabled = true;
      btn.dataset.idle = btn.dataset.idle || btn.innerHTML;
      btn.innerHTML = "Please wait...";
    } else {
      btn.disabled = false;
      btn.innerHTML = idleText || btn.dataset.idle || "Continue";
    }
  }

  // ---- POST helper ----
  // Routes to Supabase Edge Functions when useSupabase() is true,
  // otherwise stays on Apps Script. Response shape is normalised so
  // the rest of home.js does not need to know which backend served it.
  function postAS(action, params) {
    if (useSupabase()) return postSB(action, params || {});
    var body = "action=" + encodeURIComponent(action);
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v == null) return;
      body += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(v);
    });
    return fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body, redirect: "follow"
    }).then(function (r) { return r.json().catch(function () { return { ok: true }; }); });
  }

  // ---- Supabase Edge Function router ----
  function postSB(action, params) {
    if (action === "lead_draft" || action === "lead_cta") {
      return sbFetch("service-lead", {
        service_type: params.serviceType || "tracking",
        service_name: params.serviceName || action,
        email:        params.email || null,
        mobile:       params.mobile || null,
        description:  action + ": " + (params.serviceName || ""),
        origin_url:   params.origin || null,
      }).then(function () { return { ok: true }; })
        .catch(function () { return { ok: true }; });
    }
    var endpoint = ({
      "lead_otp_send":        "lead-otp-send",
      "lead_otp_verify":      "lead-otp-verify",
      "service_pay_initiate": "service-pay-initiate",
      "service_pay_complete": "service-pay-complete"
    })[action];
    if (!endpoint) return Promise.resolve({ ok: false, message: "Unknown action: " + action });

    var body;
    if (action === "lead_otp_send") {
      body = {
        email:        params.email,
        mobile:       params.mobile,
        service_type: params.serviceType,
        service_name: params.serviceName,
        payload: {
          name:          params.name || "",
          service_price: params.servicePrice || "",
          origin:        params.origin || ""
        }
      };
    } else if (action === "lead_otp_verify") {
      body = { email: params.email, otp: params.otp };
    } else if (action === "service_pay_initiate") {
      var basePrice = Number(params.servicePrice) || 0;
      var qty       = Number(params.qty) || 1;
      var subtotal  = basePrice * qty;
      // Business Launcher prices are quoted EX-GST. Add 18% GST so Razorpay
      // collects the full ₹X + 18% the customer sees on the page.
      var gstMul    = 1.18; // 18% GST is now added to every service payment
      var amountFinal = Math.round(subtotal * gstMul);
      // Pull the GST + agent code from the new "Confirm payment" step (every page).
      var extras = {
        legal_name:      ((document.getElementById("pdLegalName") || {}).value || "").trim(),
        gstin:           ((document.getElementById("pdGstin") || {}).value || "").toUpperCase().replace(/\s+/g, ""),
        billing_address: ((document.getElementById("pdBillAddr") || {}).value || "").trim(),
        agent_code:      ((document.getElementById("pdAgentCode") || {}).value || "").trim()
      };
      body = {
        email:        params.email,
        mobile:       params.mobile,
        service_type: params.serviceType,
        service_name: params.serviceName,
        amount:       amountFinal,
        qty:          qty,
        origin_url:   params.origin,
        payload: {
          service_type:    params.serviceType,
          service_name:    params.serviceName,
          qty:             qty,
          base_price:      subtotal,
          gst_applied:     (gstMul > 1) ? Math.round(subtotal * (gstMul - 1)) : 0,
          legal_name:      extras.legal_name || null,
          gstin:           extras.gstin || null,
          billing_address: extras.billing_address || null,
          agent_code:      extras.agent_code || null
        }
      };
    } else if (action === "service_pay_complete") {
      body = {
        pendingId:           params.orderRef,
        razorpay_payment_id: params.razorpay_payment_id,
        razorpay_order_id:   params.razorpay_order_id,
        razorpay_signature:  params.razorpay_signature,
        email:               params.email,
        mobile:              params.mobile
      };
    }
    return sbFetch(endpoint, body).then(function (r) {
      if (action === "service_pay_initiate" && r && r.ok) {
        return {
          ok: true,
          orderRef: r.pendingId,
          razorpay: {
            keyId:       r.key_id,
            amountPaise: r.amount,
            currency:    r.currency,
            orderId:     r.order_id
          }
        };
      }
      if (action === "service_pay_complete" && r && r.ok) {
        return { ok: true, invoiceNumber: r.invoice_number, amount: r.amount };
      }
      return r;
    });
  }

  function sbFetch(endpoint, body) {
    return fetch(SUPABASE_URL + "/functions/v1/" + endpoint, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + SUPABASE_ANON_KEY,
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_ANON_KEY
      },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().catch(function () { return { ok: false, message: "Bad response" }; }); });
  }

  // ---- Abandoned-form capture ----
  // The moment a customer types BOTH a valid mobile AND a valid email
  // and tabs away from the field, fire a silent lead_draft tracking call.
  // If they later click Continue, the upsert in logAllLead_ updates the
  // same row. If they leave the site, we still have their contact.
  var leadDraftSent = false;
  function maybeSendLeadDraft() {
    if (leadDraftSent) return;
    var mobile    = (mobileEl.value || "").trim();
    var email     = (emailEl.value  || "").trim().toLowerCase();
    var hasMobile = isMobile(mobile);
    var hasEmail  = isEmail(email);
    if (!hasMobile && !hasEmail) return;
    leadDraftSent = true;
    // Send only what we have - blank if missing
    postAS("lead_draft", {
      email:        hasEmail  ? email : "",
      mobile:       hasMobile ? normMobile(mobile) : "",
      serviceType:  currentServiceTag,
      serviceName:  currentService,
      servicePrice: currentPrice,
      origin:       window.location.pathname
    }).catch(function () { leadDraftSent = false; });
  }
  if (mobileEl) mobileEl.addEventListener("blur", maybeSendLeadDraft);
  if (emailEl)  emailEl.addEventListener("blur",  maybeSendLeadDraft);

  // ---- STEP 1 - Send OTP ----
  formContact.addEventListener("submit", function (e) {
    e.preventDefault();
    hideErr();
    var mobile = mobileEl.value.trim();
    var email  = emailEl.value.trim().toLowerCase();
    if (!isMobile(mobile)) { showErr("Please enter a valid mobile number."); return; }
    if (!isEmail(email))   { showErr("Please enter a valid email address."); return; }

    currentEmail  = email;
    currentMobile = normMobile(mobile);

    setBusy(sendOtpBtn, true);
    postAS("lead_otp_send", {
      email: email,
      mobile: currentMobile,
      serviceType:  currentServiceTag,
      serviceName:  currentService,
      servicePrice: currentPrice,
      origin: window.location.pathname
    }).then(function (res) {
      setBusy(sendOtpBtn, false, "Continue");
      if (!res || res.ok !== true) {
        showErr((res && res.message) || "Could not send OTP. Please try again or call us.");
        return;
      }
      otpEmailEl.textContent = email;
      hideOtpErr(); hideOtpOk();
      otpEl.value = "";
      showStep("otp");
      setTimeout(function () { otpEl.focus(); }, 50);
    }).catch(function (err) {
      setBusy(sendOtpBtn, false, "Continue");
      showErr("Could not reach the server: " + (err && err.message ? err.message : err));
    });
  });

  // ---- STEP 2 - Verify OTP ----
  formOtp.addEventListener("submit", function (e) {
    e.preventDefault();
    hideOtpErr(); hideOtpOk();
    var otp = otpEl.value.trim();
    if (!/^\d{6}$/.test(otp)) { showOtpErr("OTP must be a 6-digit number."); return; }

    setBusy(verifyOtpBtn, true);
    postAS("lead_otp_verify", {
      email: currentEmail,
      mobile: currentMobile,
      otp: otp,
      serviceType:  currentServiceTag,
      serviceName:  currentService,
      servicePrice: currentPrice,
      origin: window.location.pathname
    }).then(function (res) {
      setBusy(verifyOtpBtn, false, "Verify →");
      if (!res || res.ok !== true) {
        showOtpErr((res && res.message) || "Invalid or expired OTP.");
        return;
      }
      // OTP ok. Knowledge-mode action step:
      //   - hide native Pay button + Qty selector
      //   - inject "Register now to pay" button (redirects to /home/ login)
      //   - keep Request callback / Call now / WhatsApp untouched
      if (stepAction) {
        if (payBtn) payBtn.style.display = "none";
        var existingQty = document.getElementById("leadQtyWrap");
        if (existingQty) existingQty.remove();

        // Inject Register-now-to-pay button just below "Verified! What next?"
        // (only once per modal session)
        if (!document.getElementById("leadRegisterBtn")) {
          var regBtn = document.createElement("button");
          regBtn.type = "button";
          regBtn.id = "leadRegisterBtn";
          regBtn.className = "btn btn-primary lead-submit lead-pay-btn";
          regBtn.innerHTML = '<span class="lead-pay-emoji">&#128274;</span> Register now to pay';
          regBtn.addEventListener("click", function () {
            // Send to /home/ — pass ?service=TAG so the pay modal auto-opens
            // with wallet-first auto-debit (recharge + pay in one tap if short).
            // Maps our internal serviceTag values to the catalog tags wallet-pay-service knows.
            var tagMap = {
              gst: "gst",
              trademark: "trademark",
              udyam: "udyam",
              iec: "iec",
              platform_account: "platform_account",
              imaging: "imaging",
              website: "website",
              listing: "listing",
              service: "service",
              business: "business_launcher",
              business_launcher: "business_launcher"
            };
            var svcParam = tagMap[currentServiceTag] || "";
            var target = svcParam
              ? "/home/?service=" + encodeURIComponent(svcParam)
              : "/home/?return=" + encodeURIComponent(window.location.pathname);
            window.location.href = target;
          });
          // Insert as the FIRST action in the stacked-actions block so it sits
          // directly under the "Verified! What next?" header, above Callback.
          var actionsWrap = stepAction.querySelector(".lead-actions-stacked");
          if (actionsWrap) {
            actionsWrap.insertBefore(regBtn, actionsWrap.firstChild);
          } else {
            stepAction.appendChild(regBtn);
          }
        }

        showStep("action");
      } else {
        showStep("callback");
      }
    }).catch(function (err) {
      setBusy(verifyOtpBtn, false, "Verify →");
      showOtpErr("Could not reach the server: " + (err && err.message ? err.message : err));
    });
  });

  // Resend OTP
  resendBtn.addEventListener("click", function () {
    hideOtpErr(); hideOtpOk();
    setBusy(resendBtn, true);
    postAS("lead_otp_send", {
      email: currentEmail,
      mobile: currentMobile,
      serviceType:  currentServiceTag,
      serviceName:  currentService,
      servicePrice: currentPrice,
      origin: window.location.pathname,
      resend: 1
    }).then(function (res) {
      setBusy(resendBtn, false, "Resend OTP");
      if (!res || res.ok !== true) {
        showOtpErr((res && res.message) || "Could not resend OTP.");
        return;
      }
      showOtpOk("A new OTP has been sent to your email.");
    }).catch(function (err) {
      setBusy(resendBtn, false, "Resend OTP");
      showOtpErr("Could not reach the server: " + (err && err.message ? err.message : err));
    });
  });

  changeEmailBtn.addEventListener("click", function () {
    hideErr();
    showStep("contact");
    setTimeout(function () { mobileEl.focus(); }, 50);
  });

  // ---- Callback button — uses email/mobile already collected via OTP ----
  if (callbackBtn) {
    callbackBtn.addEventListener("click", function () {
      if (currentEmail) {
        postAS("lead_cta", {
          email:        currentEmail,
          mobile:       currentMobile,
          serviceType:  currentServiceTag,
          serviceName:  currentService,
          servicePrice: currentPrice,
          channel:      "callback",
          origin:       window.location.pathname
        }).catch(function () { /* non-blocking */ });
      }
      showStep("callback");
    });
  }
  if (doneBtn) doneBtn.addEventListener("click", closeLeadModal);
  if (doneBtn2) doneBtn2.addEventListener("click", closeLeadModal);

  // ---- CTA click tracking (Call now / WhatsApp inside the modal) ----
  // Fire a tracking call BEFORE the native tel:/wa.me link opens, so the
  // lead status updates to cta_call or cta_whatsapp. Non-blocking - the
  // anchor still navigates normally.
  function trackCta(channel) {
    if (!currentEmail) return;
    postAS("lead_cta", {
      email:        currentEmail,
      mobile:       currentMobile,
      serviceType:  currentServiceTag,
      serviceName:  currentService,
      servicePrice: currentPrice,
      channel:      channel,
      origin:       window.location.pathname
    });
  }
  var doneCall = document.getElementById("leadDoneCall");
  var doneWa   = document.getElementById("leadDoneWa");
  if (doneCall) doneCall.addEventListener("click", function () { trackCta("call"); });
  if (doneWa)   doneWa.addEventListener("click",   function () { trackCta("whatsapp"); });

  // ---- Lazy-build the 'Confirm payment' step (GST breakdown + GST form + agent code) ----
  function ensurePayDetailsStep() {
    if (stepPayDetails) return stepPayDetails;
    var modal = overlay.querySelector(".lead-modal");
    if (!modal) return null;
    var div = document.createElement("div");
    div.id = "leadStepPayDetails";
    div.className = "lead-step-action hidden";
    div.innerHTML =
      '<div style="text-align:center;margin-bottom:12px;"><div class="lead-done-check lead-done-check-small">&#10003;</div></div>' +
      '<h3 style="margin:0 0 6px;">Confirm payment</h3>' +
      '<p class="muted" style="margin:0 0 14px;">Review the total and add your GST details if you want input-tax credit.</p>' +
      '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:0 0 14px;font-size:13px;color:#0f172a;">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:6px;font-weight:600;"><span>Service</span><span id="pdServiceName">&mdash;</span></div>' +
        '<div id="pdBaseRow" style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Base price</span><span>&#8377;<span id="pdBaseAmt">0</span>/-</span></div>' +
        '<div id="pdGstRow" style="display:flex;justify-content:space-between;margin-bottom:4px;color:#64748b;"><span>GST (18%)</span><span>&#8377;<span id="pdGstAmt">0</span>/-</span></div>' +
        '<hr style="border:none;border-top:1px solid #e5e7eb;margin:6px 0;" />' +
        '<div style="display:flex;justify-content:space-between;font-weight:700;font-size:14px;color:#0f172a;"><span>Total payable</span><span>&#8377;<span id="pdTotalAmt">0</span>/-</span></div>' +
      '</div>' +
      '<div style="margin:0 0 12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;padding:12px 14px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600;color:#1f6feb;margin-bottom:6px;">' +
          '<span>GST details for input-tax credit</span>' +
          '<span style="font-size:11px;color:#94a3b8;font-weight:500;">Optional &middot; Recommended</span>' +
        '</div>' +
        '<div>' +
          '<label style="display:block;font-size:12px;font-weight:600;color:#475467;margin:8px 0 4px;">Legal name (as on GST certificate)</label>' +
          '<input id="pdLegalName" type="text" autocomplete="off" placeholder="e.g. Cursive Hari Nagar" style="width:100%;padding:9px 12px;border:1px solid #d0d5dd;border-radius:8px;font-size:13px;" />' +
          '<label style="display:block;font-size:12px;font-weight:600;color:#475467;margin:10px 0 4px;">GSTIN</label>' +
          '<input id="pdGstin" type="text" autocomplete="off" placeholder="07ABCDE1234F1Z5" maxlength="15" style="width:100%;padding:9px 12px;border:1px solid #d0d5dd;border-radius:8px;font-size:13px;text-transform:uppercase;" />' +
          '<label style="display:block;font-size:12px;font-weight:600;color:#475467;margin:10px 0 4px;">Billing address</label>' +
          '<textarea id="pdBillAddr" rows="2" autocomplete="off" placeholder="Hari Nagar, New Delhi, 110064" style="width:100%;padding:9px 12px;border:1px solid #d0d5dd;border-radius:8px;font-size:13px;resize:vertical;"></textarea>' +
          '<p style="margin:8px 0 0;font-size:11px;color:#94a3b8;">Both fields must match the GST certificate exactly.</p>' +
        '</div>' +
      '</div></div>' +
      '<input id="pdAgentCode" type="text" autocomplete="off" placeholder="" maxlength="20" style="width:100%;padding:9px 12px;border:1px dashed #cbd5e1;border-radius:8px;font-size:13px;color:#475467;background:#fafbfc;margin:0 0 14px;letter-spacing:.3px;" />' +
      '<div class="lead-actions lead-actions-stacked">' +
        '<button type="button" class="btn btn-primary lead-submit" id="pdConfirmBtn"><span class="lead-pay-emoji">&#128274;</span> Confirm &amp; Pay &#8377;<span id="pdConfirmAmt">0</span>/- now</button>' +
        '<button type="button" class="btn btn-ghost" id="pdBackBtn">&larr; Back</button>' +
      '</div>' +
      '<p id="pdError" class="lead-error hidden" style="margin-top:10px;"></p>';
    modal.appendChild(div);
    stepPayDetails = div;

    // Wire interactions
    document.getElementById("pdBackBtn").addEventListener("click", function () { showStep("action"); });
    var gstInput = document.getElementById("pdGstin");
    gstInput.addEventListener("input", function (e) { e.target.value = e.target.value.toUpperCase().replace(/\s+/g, ""); });
    document.getElementById("pdConfirmBtn").addEventListener("click", function () { triggerRazorpayFlow(); });
    return stepPayDetails;
  }

  function readPayDetails() {
    return {
      legal_name:      ((document.getElementById("pdLegalName") || {}).value || "").trim(),
      gstin:           ((document.getElementById("pdGstin") || {}).value || "").toUpperCase().replace(/\s+/g, ""),
      billing_address: ((document.getElementById("pdBillAddr") || {}).value || "").trim(),
      agent_code:      ((document.getElementById("pdAgentCode") || {}).value || "").trim()
    };
  }

  function triggerRazorpayFlow() {
    var confirmBtn = document.getElementById("pdConfirmBtn");
    var pdErr = document.getElementById("pdError");
    if (pdErr) pdErr.classList.add("hidden");
    setBusy(confirmBtn, true);

    var qtyInput = document.getElementById("leadQty");
    var qtyVal = qtyInput ? Math.max(1, Math.min(10, parseInt(qtyInput.value, 10) || 1)) : 1;
    postAS("service_pay_initiate", {
      email:        currentEmail,
      mobile:       currentMobile,
      serviceType:  currentServiceTag,
      serviceName:  currentService,
      servicePrice: currentPriceNum,
      qty:          qtyVal,
      origin: window.location.pathname
    }).then(function (res) {
      if (!res || res.ok !== true) {
        setBusy(confirmBtn, false, '<span class="lead-pay-emoji">&#128274;</span> Confirm & Pay');
        if (pdErr) {
          pdErr.textContent = (res && res.message) || "Could not start payment. Please try again or call us.";
          pdErr.classList.remove("hidden");
        }
        return;
      }
      openRazorpay(res);
    }).catch(function (err) {
      setBusy(confirmBtn, false, '<span class="lead-pay-emoji">&#128274;</span> Confirm & Pay');
      if (pdErr) {
        pdErr.textContent = "Could not reach the server: " + (err && err.message ? err.message : err);
        pdErr.classList.remove("hidden");
      }
    });
  }

  // ---- STEP 3b - Pay button on Verified screen → show the new confirm step ----
  if (payBtn) {
    payBtn.addEventListener("click", function () {
      hideErr();
      ensurePayDetailsStep();
      // Populate breakdown
      var base = currentPriceNum;
      var gst  = Math.round(base * 0.18);
      var total = base + gst;
      var fmt = function (n) { return Number(n).toLocaleString("en-IN"); };
      var $ = function (id) { return document.getElementById(id); };
      if ($("pdServiceName")) $("pdServiceName").textContent = currentService || "Service";
      if ($("pdBaseAmt"))     $("pdBaseAmt").textContent     = fmt(base);
      if ($("pdGstAmt"))      $("pdGstAmt").textContent      = fmt(gst);
      if ($("pdTotalAmt"))    $("pdTotalAmt").textContent    = fmt(total);
      if ($("pdConfirmAmt"))  $("pdConfirmAmt").textContent  = fmt(total);
      // GST row always visible — 18% applies to every service
      showStep("paydetails");
    });
  }

  // Inject a quantity selector into the action step (Pay or Callback).
  // Default 1, min 1, max 10. Updates the displayed total as user changes qty.
  function injectQtySelector() {
    if (!stepAction || !payBtn) return;
    var existing = document.getElementById("leadQtyWrap");
    if (existing) existing.remove();
    var wrap = document.createElement("div");
    wrap.id = "leadQtyWrap";
    wrap.style.cssText = "display:flex;align-items:center;gap:10px;margin:14px 0;padding:12px;background:#f0f7ff;border:1px solid #cfe3ff;border-radius:10px;";
    wrap.innerHTML =
      '<label for="leadQty" style="font-weight:600;color:#1f2328;">Quantity:</label>' +
      '<button type="button" id="leadQtyMinus" style="width:32px;height:32px;border:1px solid #d0d7de;background:#fff;border-radius:6px;cursor:pointer;font-weight:600;">-</button>' +
      '<input id="leadQty" type="number" value="1" min="1" max="10" style="width:60px;height:32px;text-align:center;border:1px solid #d0d7de;border-radius:6px;font-size:15px;">' +
      '<button type="button" id="leadQtyPlus" style="width:32px;height:32px;border:1px solid #d0d7de;background:#fff;border-radius:6px;cursor:pointer;font-weight:600;">+</button>' +
      '<span style="color:#57606a;font-size:13px;margin-left:auto;">Total: <strong style="color:#1f6feb;font-size:16px;" id="leadQtyTotal">' + currentPriceNum + '</strong>/-</span>';
    payBtn.parentNode.insertBefore(wrap, payBtn);

    var qtyInput = document.getElementById("leadQty");
    var totalEl  = document.getElementById("leadQtyTotal");
    function refresh() {
      var n = Math.max(1, Math.min(10, parseInt(qtyInput.value, 10) || 1));
      qtyInput.value = n;
      totalEl.textContent = (n * currentPriceNum).toLocaleString("en-IN");
      payBtn.innerHTML = "🔒 Pay ₹" + (n * currentPriceNum).toLocaleString("en-IN") + "/- now";
    }
    qtyInput.addEventListener("input", refresh);
    qtyInput.addEventListener("change", refresh);
    document.getElementById("leadQtyMinus").addEventListener("click", function () {
      qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
      refresh();
    });
    document.getElementById("leadQtyPlus").addEventListener("click", function () {
      qtyInput.value = Math.min(10, (parseInt(qtyInput.value, 10) || 1) + 1);
      refresh();
    });
    refresh();
  }

  function openRazorpay(initData) {
    if (typeof Razorpay === "undefined") {
      setBusy(payBtn, false, payBtnLabel());
      showErr("Payment library missing. Please refresh and try again.");
      return;
    }
    var rzp = new Razorpay({
      key: initData.razorpay.keyId,
      amount: initData.razorpay.amountPaise,
      currency: initData.razorpay.currency,
      name: "SHOPPERSKART",
      description: "cursive - " + currentService,
      order_id: initData.razorpay.orderId,
      prefill: { email: currentEmail, contact: currentMobile },
      readonly: { email: true },
      theme: { color: "#1f6feb" },
      handler: function (response) {
        setBusy(payBtn, true);
        var qtyInputForComplete = document.getElementById("leadQty");
        var qtyForComplete = qtyInputForComplete ? Math.max(1, Math.min(10, parseInt(qtyInputForComplete.value, 10) || 1)) : 1;
        postAS("service_pay_complete", {
          email: currentEmail,
          mobile: currentMobile,
          serviceType: currentServiceTag,
          serviceName: currentService,
          servicePrice: currentPriceNum * qtyForComplete,
          qty: qtyForComplete,
          orderRef: initData.orderRef,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id:   response.razorpay_order_id,
          razorpay_signature:  response.razorpay_signature,
          origin: window.location.pathname
        }).then(function (res) {
          if (!res || res.ok !== true) {
            setBusy(payBtn, false, payBtnLabel());
            showErr((res && res.message) || "Payment succeeded but we couldn't record it. Please contact support immediately.");
            return;
          }
          if (paidEmailEl)   paidEmailEl.textContent = currentEmail;
          if (paidInvoiceEl) paidInvoiceEl.textContent = res.invoiceNumber || "(emailed)";
          showStep("paid");
        }).catch(function (err) {
          setBusy(payBtn, false, payBtnLabel());
          showErr("Server error: " + (err && err.message ? err.message : err));
        });
      },
      modal: {
        ondismiss: function () {
          setBusy(payBtn, false, payBtnLabel());
        }
      }
    });
    rzp.on('payment.failed', function (response) {
      setBusy(payBtn, false, payBtnLabel());
      showErr("Payment failed: " + (response.error && response.error.description ? response.error.description : "Please try again."));
    });
    rzp.open();
  }
})();

/* ============================================================
 * Universal policy-link footer
 * Auto-injected on every page that loads home.js.
 * Adds: Terms · Privacy · Refund · Contact
 * Skips injection if the page already has a footer with id "cursiveFooter".
 * ============================================================ */
(function injectCursiveFooter() {
  try {
    if (document.getElementById("cursiveFooter")) return;
    function build() {
      if (document.getElementById("cursiveFooter")) return;
      var f = document.createElement("footer");
      f.id = "cursiveFooter";
      f.style.cssText = "margin:40px auto 0;padding:20px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;text-align:center;color:#64748b;font-size:12.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.7;";
      f.innerHTML = '© ' + new Date().getFullYear() + ' Cursive. All rights reserved.' +
        ' &middot; <a href="/terms/" style="color:#1f6feb;text-decoration:none;font-weight:600;">Terms</a>' +
        ' &middot; <a href="/privacy/" style="color:#1f6feb;text-decoration:none;font-weight:600;">Privacy</a>' +
        ' &middot; <a href="/refund/" style="color:#1f6feb;text-decoration:none;font-weight:600;">Refund</a>' +
        ' &middot; <a href="mailto:support@cursive.world" style="color:#1f6feb;text-decoration:none;font-weight:600;">Contact</a>';
      document.body.appendChild(f);
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", build);
    } else {
      build();
    }
  } catch (e) { /* silent */ }
})();
