/* Cursive — Universal OTP Popup (loaded on customer-facing pages)
 *
 * Automatically intercepts fetch() responses. When server returns:
 *   { otp_required: true, intent_hash, intent_description }  (HTTP 402)
 *
 * This script:
 *   1. Shows a modal asking for the 6-digit OTP
 *   2. Calls payment-otp-request to send the OTP email
 *   3. Waits for user to enter the code
 *   4. Calls payment-otp-verify to mint an action_token (60-sec validity)
 *   5. Retries the ORIGINAL request with action_token added to body
 *   6. Returns the retry response to the caller transparently
 *
 * Routes OTP to admin email if running inside an admin impersonation session.
 *
 * Safe to include on every page. Does NOT modify fetch behaviour unless server
 * sends an otp_required response.
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8";

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

  function showOtpModal(intentDescription, maskedEmail, routedToAdmin) {
    return new Promise(function (resolve) {
      // Remove existing modal if any
      var existing = document.getElementById("cursive-otp-modal");
      if (existing) existing.remove();

      var overlay = document.createElement("div");
      overlay.id = "cursive-otp-modal";
      overlay.style.cssText = [
        "position:fixed", "top:0", "left:0", "right:0", "bottom:0",
        "background:rgba(15,23,42,0.75)", "z-index:2147483646",
        "display:flex", "align-items:center", "justify-content:center",
        "font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
      ].join(";");

      var adminNote = routedToAdmin
        ? '<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin:0 0 12px;font-size:12px;color:#7f1d1d;"><b>Admin Mode:</b> OTP sent to your admin email (not the customer\'s).</div>'
        : "";

      overlay.innerHTML =
        '<div style="background:#fff;border-radius:14px;max-width:420px;width:90%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
          '<h2 style="margin:0 0 4px;font-size:18px;color:#0f172a;display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:22px;">🔒</span> Confirm action' +
          '</h2>' +
          '<p style="margin:0 0 14px;font-size:13px;color:#64748b;line-height:1.45;">' +
            escapeHtml(intentDescription) +
          '</p>' +
          adminNote +
          '<div style="background:#f1f5f9;border-radius:8px;padding:12px;margin:0 0 14px;font-size:13px;color:#475467;">' +
            '<span id="otp-status">📧 Sending OTP to <b>' + escapeHtml(maskedEmail) + '</b>...</span>' +
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
        // Send signal back via custom event for the caller to re-send OTP
        overlay.dispatchEvent(new CustomEvent("resend"));
      });

      // Expose API for the caller to update the modal
      overlay._enableInput = function () {
        input.disabled = false;
        resendBtn.disabled = false;
        input.focus();
        setStatus("📧 Code sent to <b>" + escapeHtml(maskedEmail) + "</b>. Check inbox (or spam).", false);
      };
      overlay._showError = function (msg) {
        setStatus(msg, true);
      };
    });
  }

  async function requestOtp(intentHash, intentDescription) {
    var token = getAccessToken();
    if (!token) throw new Error("Not signed in");
    var adminEmail = getAdminImpersonationEmail();

    var headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token,
    };
    if (adminEmail) headers["x-admin-email"] = adminEmail;

    var resp = await fetch(SUPABASE_URL + "/functions/v1/payment-otp-request", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        intent_hash: intentHash,
        intent_description: intentDescription,
      }),
    });
    var j = await resp.json();
    if (!resp.ok) throw new Error(j.error || "OTP request failed");
    return j; // { otp_id, masked_email, routed_to_admin }
  }

  async function verifyOtp(intentHash, otpCode) {
    var token = getAccessToken();
    if (!token) throw new Error("Not signed in");
    var adminEmail = getAdminImpersonationEmail();

    var headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token,
    };
    if (adminEmail) headers["x-admin-email"] = adminEmail;

    var resp = await fetch(SUPABASE_URL + "/functions/v1/payment-otp-verify", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        intent_hash: intentHash,
        otp_code: otpCode,
      }),
    });
    var j = await resp.json();
    if (!resp.ok) throw new Error(j.error || "OTP verify failed");
    return j; // { action_token }
  }

  async function handleOtpRequired(originalInput, originalInit, otpInfo) {
    var modalPromise = showOtpModal(
      otpInfo.intent_description || "sensitive operation",
      "your email",
      false  // will update after OTP request returns
    );
    var modalEl = document.getElementById("cursive-otp-modal");

    var requestOtpAndUpdateUI = async function () {
      try {
        var info = await requestOtp(otpInfo.intent_hash, otpInfo.intent_description || "sensitive operation");
        var maskedEl = modalEl.querySelector("b");
        if (maskedEl) maskedEl.textContent = info.masked_email;
        if (info.routed_to_admin) {
          var statusEl = modalEl.querySelector("#otp-status");
          if (statusEl) {
            statusEl.innerHTML = '🔒 <b>ADMIN MODE</b> — OTP sent to your admin email: <b>' + escapeHtml(info.masked_email) + '</b>';
          }
        }
        modalEl._enableInput();
      } catch (e) {
        modalEl._showError("Could not send OTP: " + e.message);
      }
    };

    // Listen for resend
    modalEl.addEventListener("resend", requestOtpAndUpdateUI);
    requestOtpAndUpdateUI();

    var otp = await modalPromise;
    if (!otp) {
      // User cancelled — return original 402 response (caller will see otp_required)
      return null;
    }

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

    // Re-issue the original fetch with action_token added to body
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

  // Skip these endpoints from interception (avoid recursion)
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
    try {
      data = await response.clone().json();
    } catch (e) { return response; }
    if (!data || data.otp_required !== true || !data.intent_hash) return response;

    var retried = await handleOtpRequired(input, init, data);
    if (retried) return retried;
    return response;
  };

  console.log("[cursive otp-popup] active");
})();
