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

  const btn = document.createElement("button");
  btn.id = "cw-forgot-btn";
  btn.type = "button";
  btn.title = "Send yourself a reset-password link";
  btn.innerHTML = "🔑 Reset password";
  document.body.appendChild(btn);

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
      // Supabase v2 storage key we use across all admin pages
      const raw = localStorage.getItem("sb-bttppihskbfmxwujyztj-auth-token")
               || localStorage.getItem("pd_tracker_auth");
      if (!raw) return null;
      const j = JSON.parse(raw);
      return j?.user?.email || j?.currentSession?.user?.email || null;
    } catch (_) { return null; }
  }

  function ensureVisible() {
    const email = currentEmail();
    btn.style.display = email ? "block" : "none";
    if (email) btn.title = "Send reset-password link to " + email;
  }
  ensureVisible();
  setInterval(ensureVisible, 3000); // catch login/logout mid-session

  btn.addEventListener("click", async () => {
    const email = currentEmail();
    if (!email) { say("Not signed in — nothing to reset.", true); return; }
    if (!confirm(`Send a password-reset link to ${email}?\n\nYou'll receive a Cursive email with a link to set a new password. Your current session stays open until you use it.`)) return;
    btn.disabled = true;
    const oldText = btn.innerHTML;
    btn.innerHTML = "Sending…";
    try {
      // Direct call to Supabase Auth REST — no need to import the full client
      const r = await fetch(`https://bttppihskbfmxwujyztj.supabase.co/auth/v1/recover`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": "sb_publishable_ooT6WLYpHh6NOVWJBH7ECw_E78_gwqQ",
        },
        body: JSON.stringify({
          email,
          gotrue_meta_security: {},
          // Land them on our custom reset page after they click the email link
          options: { redirectTo: "https://cursive.world/pdtracker/reset-password.html" },
        }),
      });
      if (r.ok || r.status === 200) {
        say("✓ Reset email sent to " + email + ". Check inbox (and spam).");
      } else {
        const j = await r.json().catch(() => ({}));
        say("❌ " + (j.error_description || j.msg || j.error || "Failed"), true);
      }
    } catch (e) {
      say("❌ Network error: " + (e.message || e), true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldText;
    }
  });
})();
