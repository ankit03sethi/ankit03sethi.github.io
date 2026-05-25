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
    if (stepAction)   stepAction.classList.add("hidden");
    if (stepCallback) stepCallback.classList.add("hidden");
    if (stepPaid)     stepPaid.classList.add("hidden");
    if (which === "contact")  formContact.classList.remove("hidden");
    if (which === "otp")      formOtp.classList.remove("hidden");
    if (which === "action" && stepAction)     stepAction.classList.remove("hidden");
    if (which === "callback" && stepCallback) stepCallback.classList.remove("hidden");
    if (which === "paid" && stepPaid)         stepPaid.classList.remove("hidden");
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
  function postAS(action, params) {
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
      // OTP ok. If this service has a price, show action chooser (Pay or Callback).
      // If no price, just show callback confirmation.
      if (currentPriceNum > 0 && stepAction && payBtn) {
        if (payAmountEl) payAmountEl.textContent = currentPriceNum;
        setBusy(payBtn, false, payBtnLabel());
        injectQtySelector();
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

  // ---- STEP 3a - Callback (lead already saved on OTP verify) ----
  if (callbackBtn) {
    callbackBtn.addEventListener("click", function () {
      // Log the callback request before showing the thank-you step
      if (currentEmail) {
        postAS("lead_cta", {
          email:        currentEmail,
          mobile:       currentMobile,
          serviceType:  currentServiceTag,
          serviceName:  currentService,
          servicePrice: currentPrice,
          channel:      "callback",
          origin:       window.location.pathname
        });
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

  // ---- STEP 3b - Pay -> Razorpay ----
  if (payBtn) {
    payBtn.addEventListener("click", function () {
      hideErr();
      setBusy(payBtn, true);

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
          setBusy(payBtn, false, payBtnLabel());
          showErr((res && res.message) || "Could not start payment. Please try again or call us.");
          showStep("action");
          return;
        }
        openRazorpay(res);
      }).catch(function (err) {
        setBusy(payBtn, false, payBtnLabel());
        showErr("Could not reach the server: " + (err && err.message ? err.message : err));
        showStep("action");
      });
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
