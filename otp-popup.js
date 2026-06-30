/* Cursive — Universal OTP Popup (loaded on customer-facing pages)
 *
 * Intercepts fetch() responses with HTTP 402 + otp_required:true.
 * Shows a structured modal with action breakdown, sends OTP, verifies,
 * and retries the original request with the action_token injected.
 *
 * Routes OTP to admin email if running inside an admin impersonation session.
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";

  function getAccessToken() {
    try {
      var raw = localStorage.getItem("pd_tracker_auth");
      if (!raw) return null;
      var obj = JSON.parse(raw);
      var s = (obj && obj.currentSession) ? obj.currentSession : obj;
      return (s && s.access_token) ? s.access_token : null;
    } catch (e) { return null; }
  }

  function getAdminImpersonationEmail() {
    try {
      var raw = sessionStorage.getItem("pd_admin_impersonation");
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.admin_email) return null;
      if (obj.expires_at && Date.now() > obj.expires_at) return null;
      return obj.admin_email;
    } catch (e) { return null; }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c];
    });
  }

  function rupees(paise) {
    var v = (Number(paise) || 0) / 100;
    return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Render the action breakdown based on what the server told us
  function renderBreakdownHtml(otpInfo) {
    var b = otpInfo.breakdown || {};
    var kind = b.kind || "generic";

    if (kind === "wallet_debit" || kind === "wallet_pay") {
      var insuf = b.sufficient === false || (b.wallet_after_paise !== undefined && b.wallet_after_paise < 0);
      var afterStr = (b.wallet_after_paise === undefined || b.wallet_after_paise < 0) ? rupees(0) : rupees(b.wallet_after_paise);
      var row = function (label, value, opts) {
        opts = opts || {};
        var style = "display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px;color:#475467;";
        if (opts.bold) style += "font-weight:700;color:#0f172a;font-size:14px;";
        if (opts.danger) style += "color:#dc2626;";
        if (opts.success) style += "color:#16a34a;";
        if (opts.border) style += "border-top:1px solid #e2e8f0;margin-top:6px;padding-top:10px;";
        return '<div style="' + style + '"><span>' + escapeHtml(label) + '</span><span>' + escapeHtml(value) + '</span></div>';
      };
      var insufNote = insuf
        ? '<div style="margin-top:10px;padding:10px;background:#fee2e2;border:1px solid #fecaca;border-radius:6px;font-size:12px;color:#7f1d1d;"><b>⚠️ Insufficient balance.</b> You need ' + rupees(b.shortfall_paise) + ' more in your wallet. Please recharge first.</div>'
        : "";
      return (
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 14px;">' +
          '<div style="font-size:11px;color:#1f6feb;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">💳 Wallet Deduction</div>' +
          row("Service", escapeHtml(b.service_name || "")) +
          row("Base", rupees(b.base_paise)) +
          row("GST (18%)", rupees(b.gst_paise)) +
          row("Total amount", rupees(b.total_paise), { bold: true, border: true }) +
          '<div style="height:8px;"></div>' +
          row("Current wallet balance", rupees(b.wallet_balance_paise)) +
          row("After this deduction", afterStr, { success: !insuf, danger: insuf, bold: true }) +
        '</div>' +
        insufNote
      );
    }

    if (kind === "buy_pack") {
      return (
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 14px;">' +
          '<div style="font-size:11px;color:#1f6feb;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">📦 Buy Credit Pack</div>' +
          '<div style="display:flex;justify-content:space-between;font-size:13px;color:#475467;padding:4px 0;"><span>' + escapeHtml(b.plan_label || "") + '</span><span style="font-weight:700;color:#0f172a;">' + rupees(b.total_paise) + '</span></div>' +
          '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">After OTP, Razorpay will open for payment.</div>' +
        '</div>'
      );
    }

    if (kind === "upload_confirm") {
      return (
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 14px;">' +
          '<div style="font-size:11px;color:#1f6feb;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">📤 Upload Confirmation</div>' +
          '<div style="display:flex;justify-content:space-between;font-size:13px;color:#475467;padding:4px 0;"><span>' + (b.row_count || 0) + ' rows · ' + escapeHtml(b.plan || "paid") + '</span><span style="font-weight:700;color:#0f172a;">' + rupees(b.estimated_cost_paise) + '</span></div>' +
        '</div>'
      );
    }

    if (kind === "renew_now") {
      return (
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 14px;">' +
          '<div style="font-size:11px;color:#1f6feb;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">🔄 Renew Subscriptions</div>' +
          '<div style="display:flex;justify-content:space-between;font-size:13px;color:#475467;padding:4px 0;"><span>' + (b.row_count || 0) + ' rows × ₹5.90</span><span style="font-weight:700;color:#0f172a;">up to ' + rupees(b.max_paise) + '</span></div>' +
        '</div>'
      );
    }

    if (kind === "toggle_auto_renew") {
      return (
        '<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;margin:0 0 14px;">' +
          '<div style="font-size:11px;color:#92400e;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">⚙️ Account Setting Change</div>' +
          '<div style="font-size:14px;color:#0f172a;font-weight:600;">' + escapeHtml(otpInfo.intent_description || "Toggle auto-renew") + '</div>' +
        '</div>'
      );
    }

    // Generic fallback
    return (
      '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 14px;font-size:14px;color:#0f172a;">' +
        escapeHtml(otpInfo.intent_description || "Confirm this action") +
      '</div>'
    );
  }

  function showOtpModal(otpInfo, routedToAdmin) {
    return new Promise(function (resolve) {
      var existing = document.getElementById("cursive-otp-modal");
      if (existing) existing.remove();

      var overlay = document.createElement("div");
      overlay.id = "cursive-otp-modal";
      overlay.style.cssText = [
        "position:fixed", "top:0", "left:0", "right:0", "bottom:0",
        "background:rgba(15,23,42,0.75)", "z-index:2147483646",
        "display:flex", "align-items:center", "justify-content:center",
        "font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        "padding:20px"
      ].join(";");

      var adminNote = routedToAdmin
        ? '<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin:0 0 12px;font-size:12px;color:#7f1d1d;"><b>🟡 ADMIN MODE:</b> OTP sent to your admin email (not the customer\'s).</div>'
        : "";

      var breakdownHtml = renderBreakdownHtml(otpInfo);
      var headerLabel = (otpInfo.breakdown && otpInfo.breakdown.kind === "wallet_debit") ? "Confirm wallet deduction" : "Confirm action";

      overlay.innerHTML =
        '<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-height:90vh;overflow-y:auto;">' +
          '<h2 style="margin:0 0 4px;font-size:18px;color:#0f172a;display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:22px;">🔒</span> ' + headerLabel +
          '</h2>' +
          '<p style="margin:0 0 14px;font-size:12px;color:#64748b;">Enter the one-time code we just sent to verify this transaction.</p>' +
          adminNote +
          breakdownHtml +
          '<div style="background:#f1f5f9;border-radius:8px;padding:10px 12px;margin:0 0 14px;font-size:12px;color:#475467;">' +
            '<span id="otp-status">📧 Sending OTP to <b>your email</b>...</span>' +
          '</div>' +
          '<label style="display:block;font-size:12px;color:#475467;margin:0 0 6px;font-weight:600;">Enter 6-digit code</label>' +
          '<input id="otp-input" type="text" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="off" placeholder="000000" ' +
            'style="width:100%;padding:14px;font-size:24px;text-align:center;letter-spacing:8px;font-family:ui-monospace,Menlo,monospace;border:2px solid #cbd5e1;border-radius:8px;outline:none;box-sizing:border-box;" disabled>' +
          '<div id="otp-error" style="color:#dc2626;font-size:13px;margin:8px 0 0;display:none;"></div>' +
          '<div style="display:flex;gap:8px;margin-top:18px;">' +
            '<button id="otp-cancel" style="flex:1;padding:11px;background:#fff;color:#475467;border:1px solid #cbd5e1;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;">Cancel</button>' +
            '<button id="otp-confirm" style="flex:1;padding:11px;background:#1f6feb;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;" disabled>Confirm</button>' +
          '</div>' +
          '<div style="margin-top:10px;text-align:center;">' +
            '<button id="otp-resend" style="background:transparent;border:none;color:#1f6feb;font-size:12px;cursor:pointer;text-decoration:underline;font-family:inherit;padding:4px;" disabled>Resend code</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(overlay);

      var input = overlay.querySelector("#otp-input");
      var status = overlay.querySelector("#otp-status");
      var confirmBtn = overlay.querySelector("#otp-confirm");
      var cancelBtn = overlay.querySelector("#otp-cancel");
      var resendBtn = overlay.querySelector("#otp-resend");
      var errorBox = overlay.querySelector("#otp-error");

      function setStatus(msg, isError) {
        if (isError) {
          errorBox.textContent = msg;
          errorBox.style.display = "block";
        } else {
          status.innerHTML = msg;
          errorBox.style.display = "none";
        }
      }

      function close(otp) {
        overlay.remove();
        resolve(otp);
      }

      cancelBtn.addEventListener("click", function () { close(null); });
      input.addEventListener("input", function () {
        var v = input.value.replace(/\D/g, "").substring(0, 6);
        input.value = v;
        confirmBtn.disabled = v.length !== 6;
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && input.value.length === 6) confirmBtn.click();
      });
      confirmBtn.addEventListener("click", function () { close(input.value); });
      resendBtn.addEventListener("click", function () {
        resendBtn.disabled = true;
        setStatus("📧 Resending OTP...", false);
        overlay.dispatchEvent(new CustomEvent("resend"));
      });

      overlay._enableInput = function (maskedEmail, routedToAdminFlag) {
        input.disabled = false;
        resendBtn.disabled = false;
        input.focus();
        if (routedToAdminFlag) {
          setStatus("🔒 <b>ADMIN MODE</b> — OTP sent to your admin email: <b>" + escapeHtml(maskedEmail) + "</b>", false);
        } else {
          setStatus("📧 Code sent to <b>" + escapeHtml(maskedEmail) + "</b>. Check inbox (or spam).", false);
        }
      };
      overlay._showError = function (msg) { setStatus(msg, true); };
    });
  }

  async function requestOtp(intentHash, intentDescription) {
    var token = getAccessToken();
    if (!token) throw new Error("Not signed in");
    var adminEmail = getAdminImpersonationEmail();
    var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + token };
    if (adminEmail) headers["x-admin-email"] = adminEmail;
    var resp = await fetch(SUPABASE_URL + "/functions/v1/payment-otp-request", {
      method: "POST", headers: headers,
      body: JSON.stringify({ intent_hash: intentHash, intent_description: intentDescription }),
    });
    var j = await resp.json();
    if (!resp.ok) throw new Error(j.error || "OTP request failed");
    return j;
  }

  async function verifyOtp(intentHash, otpCode) {
    var token = getAccessToken();
    if (!token) throw new Error("Not signed in");
    var adminEmail = getAdminImpersonationEmail();
    var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + token };
    if (adminEmail) headers["x-admin-email"] = adminEmail;
    var resp = await fetch(SUPABASE_URL + "/functions/v1/payment-otp-verify", {
      method: "POST", headers: headers,
      body: JSON.stringify({ intent_hash: intentHash, otp_code: otpCode }),
    });
    var j = await resp.json();
    if (!resp.ok) throw new Error(j.error || "OTP verify failed");
    return j;
  }

  async function handleOtpRequired(originalInput, originalInit, otpInfo) {
    var modalPromise = showOtpModal(otpInfo, false);
    var modalEl = document.getElementById("cursive-otp-modal");

    var requestOtpAndUpdateUI = async function () {
      try {
        var info = await requestOtp(otpInfo.intent_hash, otpInfo.intent_description || "sensitive operation");
        modalEl._enableInput(info.masked_email, info.routed_to_admin);
      } catch (e) {
        modalEl._showError("Could not send OTP: " + e.message);
      }
    };

    modalEl.addEventListener("resend", requestOtpAndUpdateUI);
    requestOtpAndUpdateUI();

    var otp = await modalPromise;
    if (!otp) return null;

    var verifyResult;
    try {
      verifyResult = await verifyOtp(otpInfo.intent_hash, otp);
    } catch (e) {
      alert("OTP verification failed: " + e.message);
      return null;
    }
    if (!verifyResult.action_token) {
      alert("OTP verification failed: no token returned");
      return null;
    }

    var newInit = Object.assign({}, originalInit || {});
    var bodyObj = {};
    if (newInit.body) {
      try { bodyObj = JSON.parse(newInit.body); } catch (e) {}
    }
    bodyObj.action_token = verifyResult.action_token;
    newInit.body = JSON.stringify(bodyObj);
    newInit.headers = Object.assign({}, newInit.headers || {}, { "Content-Type": "application/json" });

    return await __originalFetch(originalInput, newInit);
  }

  var SKIP_PATHS = [
    "/functions/v1/payment-otp-request",
    "/functions/v1/payment-otp-verify",
    "/functions/v1/admin-impersonate",
    "/functions/v1/admin-list-customers",
    "/functions/v1/admin-audit-log",
  ];

  var __originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    var url = (typeof input === "string") ? input : (input && input.url) || "";
    var skip = SKIP_PATHS.some(function (p) { return url.indexOf(p) !== -1; });
    var response = await __originalFetch(input, init);
    if (skip) return response;
    if (response.status !== 402) return response;
    var ctype = (response.headers.get("content-type") || "").toLowerCase();
    if (ctype.indexOf("application/json") === -1) return response;

    var data;
    try { data = await response.clone().json(); } catch (e) { return response; }
    if (!data || data.otp_required !== true || !data.intent_hash) return response;

    var retried = await handleOtpRequired(input, init, data);
    if (retried) return retried;
    return response;
  };

  console.log("[cursive otp-popup] v2 active");
})();
