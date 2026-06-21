/* cursive - shared JS for home page + service landing pages
 *
 * Lead flow:
 *   1. User clicks "Get started" -> modal opens
 *   2. Mobile + Email -> POST lead_otp_send -> OTP email
 *   3. OTP -> POST lead_otp_verify -> lead recorded
 *   4. Show action chooser: Pay (Razorpay) OR Request callback
 *   5a. Pay -> service_pay_initiate -> Razorpay -> service_pay_complete
 *   5b. Callback -> done (lead already in sheet via OTP verify)
 */
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

    // Knowledge-page mode: skip OTP entirely. Show only Call / WhatsApp / Callback.
    // The Pay button is hidden because payment now happens via /home/ wallet.
    if (payBtn) payBtn.style.display = "none";
    var oldQty = document.getElementById("leadQtyWrap");
    if (oldQty) oldQty.remove();

    // Inject a minimal name+mobile mini-form inside stepAction (once)
    if (stepAction && !document.getElementById("leadKpForm")) {
      var miniForm = document.createElement("div");
      miniForm.id = "leadKpForm";
      miniForm.style.cssText = "margin:10px 0 14px;padding:14px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;text-align:left;";
      miniForm.innerHTML =
        '<div style="font-weight:600;color:#0f172a;margin-bottom:8px;font-size:13px;">For callback / WhatsApp</div>' +
        '<input id="leadKpName" type="text" placeholder="Your name" style="width:100%;padding:9px 11px;border:1px solid #d0d5dd;border-radius:8px;font-size:13px;margin-bottom:8px;box-sizing:border-box;" />' +
        '<input id="leadKpMobile" type="tel" placeholder="Mobile number" style="width:100%;padding:9px 11px;border:1px solid #d0d5dd;border-radius:8px;font-size:13px;box-sizing:border-box;" />';
      stepAction.insertBefore(miniForm, stepAction.querySelector(".lead-actions") || stepAction.firstChild.nextSibling);
    }

    showStep("action");
    overlay.classList.remove("hidden");
    setTimeout(function () { var nm = document.getElementById("leadKpName"); if (nm) nm.focus(); }, 50);
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
      // OTP ok. Show action step with "Register now" button (no Pay, no Quantity).
      // Payment now happens through /home/ after wallet recharge.
      if (stepAction && payBtn) {
        // Re-purpose the Pay button into a "Register now" button → /home/
        payBtn.innerHTML = '<span class="lead-pay-emoji">&#128274;</span> Register now &rarr;';
        payBtn.disabled = false;
        // Remove any previously injected quantity selector (in case of re-entry)
        var existingQty = document.getElementById("leadQtyWrap");
        if (existingQty) existingQty.remove();
        // Replace the click handler — clone-and-replace to drop the Razorpay handler
        var freshPayBtn = payBtn.cloneNode(true);
        payBtn.parentNode.replaceChild(freshPayBtn, payBtn);
        freshPayBtn.addEventListener("click", function () {
          var svc = encodeURIComponent(currentService || "");
          location.href = "/home/?svc=" + svc;
        });
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

  // ---- Callback button (knowledge-page mode: no OTP, mini-form Name+Mobile) ----
  if (callbackBtn) {
    callbackBtn.addEventListener("click", function () {
      var nameEl = document.getElementById("leadKpName");
      var mobEl  = document.getElementById("leadKpMobile");
      var name = (nameEl && nameEl.value || "").trim();
      var mob  = (mobEl && mobEl.value || "").trim().replace(/\D/g, "");
      if (!name || mob.length < 10) {
        if (mobEl) mobEl.style.borderColor = "#dc2626";
        if (nameEl && !name) nameEl.style.borderColor = "#dc2626";
        var hint = document.getElementById("leadKpHint");
        if (!hint && stepAction) {
          hint = document.createElement("p");
          hint.id = "leadKpHint";
          hint.style.cssText = "color:#dc2626;font-size:12px;margin:6px 0 0;";
          hint.textContent = "Please enter your name + 10-digit mobile.";
          var miniForm = document.getElementById("leadKpForm");
          if (miniForm) miniForm.appendChild(hint);
        }
        return;
      }
      // Log the callback request
      postAS("lead_cta", {
        email:        "",   // not collected in knowledge mode
        mobile:       mob,
        name:         name,
        serviceType:  currentServiceTag,
        serviceName:  currentService,
        servicePrice: currentPrice,
        channel:      "callback",
        origin:       window.location.pathname
      }).catch(function () { /* non-blocking */ });
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
