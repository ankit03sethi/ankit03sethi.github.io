/* Cursive — Admin Impersonation Banner (loaded on customer-facing pages)
 *
 * Detects sessionStorage["pd_admin_impersonation"] and:
 *   - Renders a sticky yellow banner at the top of <body>
 *   - Disables destructive controls (read-only enforcement)
 *   - Counts down to 30-min expiry
 *   - On "Exit": restores admin's original session and returns to /technical/
 *
 * Does NOTHING if no impersonation flag is present (zero impact on real customers).
 *
 * Safe to include on every page via: <script src="/admin-banner.js"></script>
 */
(function () {
  "use strict";

  var KEY_FLAG    = "pd_admin_impersonation";
  var KEY_BACKUP  = "pd_admin_backup_session";
  var KEY_ADMIN_EMAIL = "pd_admin_email";

  function readFlag() {
    try {
      var raw = sessionStorage.getItem(KEY_FLAG);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.target_email || !obj.expires_at) return null;
      if (Date.now() > obj.expires_at) return null; // expired
      return obj;
    } catch (e) { return null; }
  }

  function exitImpersonation(reason) {
    // Restore admin's original Supabase session
    try {
      var backup = sessionStorage.getItem(KEY_BACKUP);
      if (backup) {
        localStorage.setItem("pd_tracker_auth", backup);
      } else {
        localStorage.removeItem("pd_tracker_auth");
      }
    } catch (e) {}
    sessionStorage.removeItem(KEY_FLAG);
    sessionStorage.removeItem(KEY_BACKUP);
    sessionStorage.removeItem(KEY_ADMIN_EMAIL);
    // Best-effort audit log (don't block redirect on failure)
    try {
      var flag = readFlag();
      if (flag) {
        navigator.sendBeacon &&
          navigator.sendBeacon(
            "https://bttppihskbfmxwujyztj.supabase.co/functions/v1/admin-audit-log",
            new Blob([JSON.stringify({
              admin_email:    sessionStorage.getItem(KEY_ADMIN_EMAIL) || flag.admin_email,
              target_email:   flag.target_email,
              target_user_id: flag.target_user_id,
              action:         reason === "expired" ? "session_expired" : "impersonation_ended",
              metadata:       { reason: reason || "exit_clicked", page: location.pathname },
            })], { type: "application/json" })
          );
      }
    } catch (e) {}
    window.location.href = "/technical/";
  }

  function showBanner(flag) {
    if (document.getElementById("cursive-admin-banner")) return; // already shown

    var bar = document.createElement("div");
    bar.id = "cursive-admin-banner";
    bar.style.cssText = [
      "position:sticky", "top:0", "left:0", "right:0", "z-index:2147483647",
      "background:#fbbf24", "color:#78350f", "padding:10px 16px",
      "font:600 13px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      "border-bottom:2px solid #b45309", "box-shadow:0 2px 8px rgba(0,0,0,0.15)",
      "display:flex", "align-items:center", "justify-content:space-between", "gap:12px",
      "flex-wrap:wrap"
    ].join(";");

    var left = document.createElement("div");
    left.innerHTML =
      '<span style="font-size:16px;margin-right:8px;">🟡</span>' +
      '<b>ADMIN MODE</b> &middot; Viewing as <b>' + escapeHtml(flag.target_email) + '</b>' +
      ' <span style="opacity:0.7;font-weight:500;">(READ-ONLY)</span>';

    var right = document.createElement("div");
    right.style.cssText = "display:flex;align-items:center;gap:10px;";

    var timer = document.createElement("span");
    timer.id = "cursive-admin-timer";
    timer.style.cssText = "background:#fef3c7;padding:4px 10px;border-radius:6px;font-variant-numeric:tabular-nums;color:#78350f;";
    timer.textContent = "30:00";

    var exitBtn = document.createElement("button");
    exitBtn.textContent = "✕ Exit to /technical";
    exitBtn.style.cssText = [
      "background:#7c2d12", "color:#fff", "border:none",
      "padding:6px 12px", "border-radius:6px", "font-weight:700", "font-size:12px",
      "cursor:pointer", "font-family:inherit"
    ].join(";");
    exitBtn.addEventListener("click", function () {
      if (confirm("Exit admin mode and return to /technical/?")) {
        exitImpersonation("exit_clicked");
      }
    });

    right.appendChild(timer);
    right.appendChild(exitBtn);
    bar.appendChild(left);
    bar.appendChild(right);

    // Insert at very top of body
    if (document.body) {
      document.body.insertBefore(bar, document.body.firstChild);
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        document.body.insertBefore(bar, document.body.firstChild);
      });
    }

    // Live countdown
    setInterval(function () {
      var f = readFlag();
      if (!f) { exitImpersonation("expired"); return; }
      var left = f.expires_at - Date.now();
      if (left <= 0) { exitImpersonation("expired"); return; }
      var m = Math.floor(left / 60000);
      var s = Math.floor((left % 60000) / 1000);
      timer.textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
      if (m < 5) timer.style.background = "#fecaca";
      if (m < 1) timer.style.color = "#7f1d1d";
    }, 1000);
  }

  function disableDestructive() {
    // READ-ONLY enforcement: disable common destructive controls.
    // Strategy = conservative (mark, don't break the page).
    var DESTRUCTIVE_PATTERNS = [
      /^save$/i, /^update$/i, /^change\s+password$/i, /^delete$/i, /^remove$/i,
      /^upload$/i, /^add\s+money$/i, /^pay$/i, /^pay\s+now$/i, /^submit$/i,
      /^subscribe$/i, /^cancel\s+subscription$/i, /^renew$/i, /^buy$/i,
      /^logout$/i, /^sign\s+out$/i, /^purchase$/i, /^proceed$/i, /^confirm$/i
    ];
    var nodes = document.querySelectorAll("button, input[type=submit], input[type=button]");
    nodes.forEach(function (el) {
      var label = (el.textContent || el.value || "").trim();
      if (!label) return;
      var matches = DESTRUCTIVE_PATTERNS.some(function (re) { return re.test(label); });
      if (matches) {
        el.disabled = true;
        el.style.opacity = "0.45";
        el.style.cursor = "not-allowed";
        el.title = "🔒 Disabled in admin READ-ONLY mode";
      }
    });
    // Disable form submissions on text inputs (Enter key)
    document.querySelectorAll("form").forEach(function (f) {
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        e.stopPropagation();
        alert("🔒 Read-only admin mode — form submission disabled.");
      }, true);
    });
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c];
    });
  }

  function init() {
    var flag = readFlag();
    if (!flag) return; // not impersonating — do absolutely nothing

    showBanner(flag);
    disableDestructive();

    // Re-run disable check after dynamic content loads
    setTimeout(disableDestructive, 1000);
    setTimeout(disableDestructive, 3000);
    setTimeout(disableDestructive, 6000);

    // Log page visit (best effort)
    try {
      navigator.sendBeacon &&
        navigator.sendBeacon(
          "https://bttppihskbfmxwujyztj.supabase.co/functions/v1/admin-audit-log",
          new Blob([JSON.stringify({
            admin_email:    flag.admin_email,
            target_email:   flag.target_email,
            target_user_id: flag.target_user_id,
            action:         "page_visited",
            metadata:       { page: location.pathname + location.search, title: document.title },
          })], { type: "application/json" })
        );
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
