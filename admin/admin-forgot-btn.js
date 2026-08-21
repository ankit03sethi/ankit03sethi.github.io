// admin-forgot-btn.js — floating "🔑 Reset password" button for every admin page.
// Any admin page can drop `<script src="/admin/admin-forgot-btn.js" defer></script>`
// (anywhere in <head> or <body>) to get a small button top-right that lets the signed-in
// admin trigger their own password-reset email — no signout needed.
(function () {
  const STYLE = `
    #cw-forgot-btn { position: fixed; top: 12px; right: 12px; z-index: 9999;
      background: #fff; color: #1f6feb; border: 1px solid #1f6feb; border-radius: 8px;
      padding: 6px 12px; font: 600 12px/1 -apple-system,'Segoe UI',Roboto,sans-serif;
      cursor: pointer; box-shadow: 0 2px 8px rgba(15,23,42,0.08); display: none; }
    #cw-forgot-btn:hover { background: #eff6ff; }
    #cw-forgot-toast { position: fixed; bottom: 24px; right: 24px; z-index: 10000;
      background: #0f172a; color: #fff; padding: 12px 18px; border-radius: 8px;
      font: 500 13px/1.4 -apple-system,'Segoe UI',Roboto,sans-serif; max-width: 340px;
      box-shadow: 0 8px 24px rgba(15,23,42,0.25); display: none; }
    #cw-forgot-toast.err { background: #991b1b; }
  `;
  const s = document.createElement("style");
  s.textContent = STYLE;
  document.head.appendChild(s);

  // Forgot-password button (visible when SIGNED OUT)
  const btn = document.createElement("button");
  btn.id = "cw-forgot-btn";
  btn.type = "button";
  btn.title = "Send yourself a reset-password link";
  btn.innerHTML = "🔑 Forgot password?";
  document.body.appendChild(btn);

  // Sign-out button (visible when SIGNED IN)
  const outBtn = document.createElement("button");
  outBtn.id = "cw-signout-btn";
  outBtn.type = "button";
  outBtn.title = "Sign out of Cursive admin";
  outBtn.innerHTML = "🚪 Sign out";
  outBtn.style.cssText = "position:fixed; top:12px; right:12px; z-index:9999; background:#fff; color:#dc2626; border:1px solid #dc2626; border-radius:8px; padding:6px 12px; font:600 12px/1 -apple-system,'Segoe UI',Roboto,sans-serif; cursor:pointer; box-shadow:0 2px 8px rgba(15,23,42,0.08); display:none;";
  outBtn.addEventListener("mouseover", () => outBtn.style.background = "#fef2f2");
  outBtn.addEventListener("mouseout",  () => outBtn.style.background = "#fff");
  document.body.appendChild(outBtn);
  outBtn.addEventListener("click", async () => {
    if (!confirm("Sign out of Cursive admin?")) return;
    // Clear both known auth-token storage keys so we're logged out regardless
    // of which storageKey the page's supabase client uses.
    try {
      const token = (() => {
        for (const k of Object.keys(localStorage)) {
          if (k === "pd_tracker_auth" || /^sb-.*-auth-token$/.test(k)) {
            try { return JSON.parse(localStorage.getItem(k))?.access_token; } catch { return null; }
          }
        }
        return null;
      })();
      // Best-effort server-side sign-out (kills refresh token)
      if (token) {
        fetch(`https://bttppihskbfmxwujyztj.supabase.co/auth/v1/logout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": "sb_publishable_ooT6WLYpHh6NOVWJBH7ECw_E78_gwqQ",
            "Authorization": "Bearer " + token,
          },
        }).catch(() => {});
      }
    } catch (_) {}
    // Wipe local session
    try {
      for (const k of Object.keys(localStorage)) {
        if (k === "pd_tracker_auth" || /^sb-.*-auth-token$/.test(k)) localStorage.removeItem(k);
      }
    } catch (_) {}
    location.reload();
  });

  const toast = document.createElement("div");
  toast.id = "cw-forgot-toast";
  document.body.appendChild(toast);
  function say(msg, err) {
    toast.textContent = msg;
    toast.className = err ? "err" : "";
    toast.style.display = "block";
    setTimeout(() => { toast.style.display = "none"; }, 4000);
  }

  // Read the current session email from Supabase's localStorage key so we don't
  // need to import supabase-js just to know who's signed in.
  function currentEmail() {
    try {
      // Try every plausible Supabase storage key first.
      const keys = Object.keys(localStorage);
      for (const k of keys) {
        if (k === "pd_tracker_auth" || /^sb-.*-auth-token$/.test(k)) {
          try {
            const j = JSON.parse(localStorage.getItem(k));
            const em = j?.user?.email || j?.currentSession?.user?.email;
            if (em) return em;
          } catch (_) {}
        }
      }
      return null;
    } catch (_) { return null; }
  }
  // Also treat "the page shows its own signed-in chrome" as signed in — belt-and
  // suspenders when localStorage lookup misses (e.g. session in memory only).
  function pageLooksSignedIn() {
    const chip = document.getElementById("emailChip");
    const so   = document.getElementById("signOutBtn");
    const isVisible = (el) => el && !el.classList.contains("hidden") && el.offsetParent !== null;
    return isVisible(chip) || isVisible(so);
  }

  // 2026-08-21: Floating "Sign out" removed. Every admin page has its own inline
  // sign-out in the header — the floating one was redundant + visually noisy.
  // Forgot-password floating button STILL shows when signed out (useful when a
  // user hits an admin URL but never signed in). Sign-out button is force-hidden.
  outBtn.style.display = "none";
  outBtn.remove?.();
  function ensureVisible() {
    // Hide if signed in per EITHER localStorage OR the page's own signed-in chrome.
    if (currentEmail() || pageLooksSignedIn()) {
      btn.style.display = "none";
      return;
    }
    btn.style.display = "block";
    btn.innerHTML = "🔑 Forgot password?";
    btn.title = "Send yourself a reset-password link";
  }
  // Start hidden. Wait up to 2s + poll fast during hydration so we never flash
  // the Forgot-password button on a page that's actually signed in.
  btn.style.display = "none";
  const HYDRATION_POLL_MS = 250;
  const HYDRATION_WINDOW_MS = 2500;
  const hydStart = Date.now();
  const hydTimer = setInterval(() => {
    if (currentEmail() || pageLooksSignedIn()) {
      btn.style.display = "none";
      clearInterval(hydTimer);
      return;
    }
    if (Date.now() - hydStart >= HYDRATION_WINDOW_MS) {
      clearInterval(hydTimer);
      ensureVisible(); // now safe to show if truly signed out
    }
  }, HYDRATION_POLL_MS);
  // Long-term watcher so mid-session logout still surfaces the button.
  setInterval(ensureVisible, 3000);

  async function sendRecovery(email) {
    const r = await fetch(`https://bttppihskbfmxwujyztj.supabase.co/auth/v1/recover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": "sb_publishable_ooT6WLYpHh6NOVWJBH7ECw_E78_gwqQ",
      },
      body: JSON.stringify({
        email,
        gotrue_meta_security: {},
        options: { redirectTo: "https://cursive.world/pdtracker/reset-password.html" },
      }),
    });
    if (r.ok || r.status === 200) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return { ok: false, error: j.error_description || j.msg || j.error || "Failed" };
  }

  btn.addEventListener("click", async () => {
    // Button only shows when signed out, so always prompt for email
    const email = (prompt("Enter your admin email to receive a password-reset link:") || "").trim().toLowerCase();
    if (!email) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { say("Invalid email format", true); return; }
    btn.disabled = true;
    const oldText = btn.innerHTML;
    btn.innerHTML = "Sending…";
    try {
      const res = await sendRecovery(email);
      if (res.ok) say("✓ Reset email sent to " + email + ". Check inbox (and spam).");
      else say("❌ " + res.error, true);
    } catch (e) {
      say("❌ Network error: " + (e.message || e), true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldText;
      ensureVisible();
    }
  });
})();
