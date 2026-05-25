// cursive /app/ — Supabase-backed dashboard
// ESM. Loaded with <script type="module">.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const cfg = window.CURSIVE_CONFIG || {};
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit"
  }
});

// --------------- DOM helpers ---------------
const $ = (sel) => document.querySelector(sel);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");
function showView(name) {
  ["loginView", "forgotView", "setPasswordView", "dashView"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === name) show(el); else hide(el);
  });
}
function setError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (msg) { el.textContent = msg; show(el); }
  else hide(el);
}
function setSuccess(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (msg) { el.textContent = msg; show(el); el.classList.add("success"); el.classList.remove("error"); }
  else hide(el);
}

// --------------- Boot ---------------
window.addEventListener("DOMContentLoaded", async () => {
  wireUpHandlers();

  // The Supabase JS SDK auto-parses the URL hash on load (#access_token=... from
  // invite / magic-link / recovery emails) and creates a session. We just have
  // to wait for it. The flow's "type" is in the hash too — capture it before
  // the SDK clears it.
  const incomingType = (function () {
    const h = window.location.hash || "";
    if (!h) return null;
    const params = new URLSearchParams(h.replace(/^#/, ""));
    return params.get("type");
  })();

  // Listen for auth state changes
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) {
      // If this sign-in came from an invite or recovery email, prompt password
      if (incomingType === "invite" || incomingType === "recovery" || incomingType === "signup") {
        showSetPassword(incomingType);
      } else {
        renderDashboard();
      }
    } else if (event === "SIGNED_OUT") {
      hideTopbarChips();
      showView("loginView");
    }
  });

  // Initial check
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    if (incomingType === "invite" || incomingType === "recovery") {
      showSetPassword(incomingType);
    } else {
      renderDashboard();
    }
  } else {
    showView("loginView");
  }
});

// --------------- Wiring ---------------
function wireUpHandlers() {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#forgotForm").addEventListener("submit", onForgot);
  $("#setPasswordForm").addEventListener("submit", onSetPassword);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#showForgot").addEventListener("click", (e) => { e.preventDefault(); setError("loginError", ""); showView("forgotView"); });
  $("#backToLogin").addEventListener("click", (e) => { e.preventDefault(); setError("forgotError", ""); setSuccess("forgotMsg", ""); showView("loginView"); });
  // Tab switching
  document.querySelectorAll(".nav-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll(".nav-tab").forEach(b => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".tab-pane").forEach(p => {
        if (p.dataset.pane === tab) show(p); else hide(p);
      });
    });
  });
}

// --------------- Auth actions ---------------
async function onLogin(e) {
  e.preventDefault();
  setError("loginError", "");
  const email = $("#loginEmail").value.trim().toLowerCase();
  const password = $("#loginPassword").value;
  const btn = $("#loginBtn");
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // onAuthStateChange handles the rest
  } catch (err) {
    setError("loginError", friendlyError(err));
  } finally {
    btn.disabled = false; btn.textContent = "Sign in";
  }
}

async function onForgot(e) {
  e.preventDefault();
  setError("forgotError", ""); setSuccess("forgotMsg", "");
  const email = $("#forgotEmail").value.trim().toLowerCase();
  const btn = $("#forgotBtn");
  btn.disabled = true; btn.textContent = "Sending…";
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: cfg.APP_URL
    });
    if (error) throw error;
    setSuccess("forgotMsg", "If an account exists for " + email + ", a reset link is on its way. Check your inbox.");
  } catch (err) {
    setError("forgotError", friendlyError(err));
  } finally {
    btn.disabled = false; btn.textContent = "Send reset link";
  }
}

function showSetPassword(flowType) {
  setError("setPasswordError", "");
  if (flowType === "recovery") {
    $("#setPasswordTitle").textContent = "Choose a new password";
    $("#setPasswordLede").textContent = "Almost done. Pick a new password for your cursive account.";
  } else {
    $("#setPasswordTitle").textContent = "Set your password";
    $("#setPasswordLede").textContent = "Welcome to cursive! Pick a password to finish activating your account.";
  }
  showView("setPasswordView");
}

async function onSetPassword(e) {
  e.preventDefault();
  setError("setPasswordError", "");
  const p1 = $("#newPassword").value;
  const p2 = $("#confirmPassword").value;
  if (p1.length < 8) return setError("setPasswordError", "Password should be at least 8 characters.");
  if (p1 !== p2) return setError("setPasswordError", "The two passwords don't match.");
  const btn = $("#setPasswordBtn");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) throw error;
    // Clear the URL hash so a reload doesn't re-trigger the set-password flow
    history.replaceState(null, "", window.location.pathname);
    await renderDashboard();
  } catch (err) {
    setError("setPasswordError", friendlyError(err));
  } finally {
    btn.disabled = false; btn.textContent = "Save password & continue";
  }
}

async function onSignOut() {
  await sb.auth.signOut();
  // onAuthStateChange routes us back to login
}

// --------------- Dashboard rendering ---------------
async function renderDashboard() {
  showView("dashView");

  // Fetch the "me" view — returns the user + tenant in one row
  const { data: me, error: meErr } = await sb.from("me").select("*").maybeSingle();
  if (meErr || !me) {
    // Profile/tenant row missing — shouldn't happen because the trigger creates it
    showTopbarChips({ business_name: "Workspace", tenant_status: "active", trial_ends_at: null });
    $("#welcomeTitle").textContent = "Welcome to cursive";
    $("#welcomeBody").innerHTML = "Your workspace is being prepared. Refresh in a moment, or email <a style='color:#fff;text-decoration:underline;' href='mailto:Contact@cursive.world'>Contact@cursive.world</a> if this stays.";
    return;
  }

  showTopbarChips(me);
  $("#welcomeTitle").textContent = "Welcome, " + (me.business_name || "seller");
  $("#welcomeBody").innerHTML =
    "Your seller workspace is live. You&rsquo;re signed in as <strong>" +
    escapeHtml(me.profile_email || "") + "</strong> on the <span class='kbd'>" +
    escapeHtml(me.plan || "trial") + "</span> plan.";

  // KPIs — count(head:true) returns just the count without rows
  const counts = await Promise.allSettled([
    sb.from("products").select("*", { count: "exact", head: true }),
    sb.from("marketplace_files").select("*", { count: "exact", head: true }),
    sb.from("master_data").select("*", { count: "exact", head: true }),
    sb.rpc("unread_alert_count")
  ]);
  $("#kpiProducts").textContent     = countOrDash(counts[0]);
  $("#kpiFiles").textContent        = countOrDash(counts[1]);
  $("#kpiMasterRows").textContent   = countOrDash(counts[2]);
  const unread = (counts[3].status === "fulfilled" && counts[3].value && counts[3].value.data != null) ? counts[3].value.data : 0;
  $("#kpiAlerts").textContent       = unread;
  $("#alertsBadge").textContent     = unread;
}

function showTopbarChips(me) {
  const chip = $("#tenantChip");
  chip.textContent = me.business_name || "Workspace";
  show(chip);
  show($("#signOutBtn"));
  // Trial chip
  if (me.plan === "trial" && me.trial_ends_at) {
    const days = Math.max(0, Math.ceil((new Date(me.trial_ends_at) - new Date()) / 86400000));
    $("#trialDays").textContent = days;
    show($("#trialChip"));
  } else {
    hide($("#trialChip"));
  }
}
function hideTopbarChips() {
  hide($("#tenantChip"));
  hide($("#trialChip"));
  hide($("#signOutBtn"));
}

// --------------- Utils ---------------
function countOrDash(settled) {
  if (settled.status !== "fulfilled") return "—";
  const v = settled.value;
  if (v && typeof v.count === "number") return v.count.toLocaleString("en-IN");
  return "—";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function friendlyError(err) {
  const msg = (err && err.message) || String(err);
  if (/invalid login credentials/i.test(msg)) return "That email and password don't match. Try again or use 'Forgot password?'";
  if (/email not confirmed/i.test(msg)) return "Please confirm your email first — check your inbox for the cursive activation link.";
  if (/rate limit/i.test(msg)) return "Too many attempts. Please wait a minute and try again.";
  if (/user not found/i.test(msg)) return "No account found for that email.";
  return msg;
}
