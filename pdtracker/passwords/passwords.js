// cursive /pdtracker/passwords/ — admin-only view of per-customer install passwords
// Reads from public.pdtracker_install_passwords (RLS: admin-only)
// Joined with analytics_users for email + mobile

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cursive_pdpwd_auth" },
});

const $ = (s) => document.querySelector(s);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

let allRows = [];
let searchTerm = "";
let refreshTimer = null;

window.addEventListener("DOMContentLoaded", async () => {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#denySignOut").addEventListener("click", onSignOut);
  $("#refreshBtn").addEventListener("click", () => refreshAll());
  $("#searchBox").addEventListener("input", debounce(() => {
    searchTerm = $("#searchBox").value.trim().toLowerCase();
    renderTable();
  }, 150));

  await bootstrap();
});

async function bootstrap() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await onAuthed(session);
  else show($("#loginView"));
}

async function onLogin(e) {
  e.preventDefault();
  hide($("#loginError"));
  $("#loginBtn").disabled = true;
  $("#loginBtn").textContent = "Signing in...";
  const email = $("#email").value.trim().toLowerCase();
  const password = $("#password").value;
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await onAuthed(data.session);
  } catch (err) {
    $("#loginError").textContent = err.message || "Sign-in failed.";
    show($("#loginError"));
  } finally {
    $("#loginBtn").disabled = false;
    $("#loginBtn").textContent = "Sign in";
  }
}

async function onSignOut() {
  await sb.auth.signOut();
  if (refreshTimer) clearInterval(refreshTimer);
  hide($("#dashView"));
  hide($("#denyView"));
  show($("#loginView"));
  $("#emailChip").textContent = "";
  hide($("#emailChip"));
  hide($("#signOutBtn"));
  allRows = [];
}

async function onAuthed(session) {
  hide($("#loginView"));
  $("#emailChip").textContent = session.user.email;
  show($("#emailChip"));
  show($("#signOutBtn"));

  const isAdmin = await checkAdmin();
  if (!isAdmin) {
    show($("#denyView"));
    return;
  }
  show($("#dashView"));

  await refreshAll();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshAll, 30_000);
}

async function checkAdmin() {
  try {
    const { data, error } = await sb
      .from("analytics_users")
      .select("user_tier")
      .limit(1)
      .maybeSingle();
    if (error) return false;
    return data && data.user_tier === "admin";
  } catch {
    return false;
  }
}

async function refreshAll() {
  try {
    // First, ensure every customer has a password row (free for admin since SECURITY DEFINER)
    await sb.rpc("ensure_pdtracker_install_passwords").catch(() => {});

    // Pull passwords + customer info
    const { data: pwds, error: e1 } = await sb
      .from("pdtracker_install_passwords")
      .select("user_id, current_password, rotates_at, is_blocked, updated_at");
    if (e1) throw e1;

    const { data: users, error: e2 } = await sb
      .from("analytics_users")
      .select("user_id, email, mobile, full_name, user_tier");
    if (e2) throw e2;

    const userMap = Object.fromEntries((users || []).map((u) => [u.user_id, u]));

    // Pull last attempt per customer
    const { data: attempts } = await sb
      .from("pdtracker_install_attempts")
      .select("user_id, attempted_at, success, failure_reason")
      .order("attempted_at", { ascending: false })
      .limit(500);
    const lastByUser = {};
    for (const a of attempts || []) {
      if (!lastByUser[a.user_id]) lastByUser[a.user_id] = a;
    }

    allRows = (pwds || []).map((p) => ({
      ...p,
      email:  userMap[p.user_id]?.email  || "(unknown)",
      mobile: userMap[p.user_id]?.mobile || "",
      name:   userMap[p.user_id]?.full_name || "",
      tier:   userMap[p.user_id]?.user_tier || "",
      lastAttempt: lastByUser[p.user_id] || null,
    }));
    // Hide internal admin user from this list (only show real customers)
    // (Comment-out the line below if you want to see your own row too)
    // allRows = allRows.filter((r) => r.tier !== "admin");

    renderTable();
    renderAttempts(attempts || []);
    $("#lastRefreshed").textContent = "Refreshed " + new Date().toLocaleTimeString();
  } catch (err) {
    console.error(err);
    $("#lastRefreshed").textContent = "Refresh failed: " + (err.message || err);
  }
}

function renderTable() {
  const filtered = !searchTerm
    ? allRows
    : allRows.filter((r) =>
        (r.email || "").toLowerCase().includes(searchTerm) ||
        (r.mobile || "").toLowerCase().includes(searchTerm) ||
        (r.name || "").toLowerCase().includes(searchTerm)
      );

  $("#customerCount").textContent = `${filtered.length} customer${filtered.length === 1 ? "" : "s"}`;

  const tbody = $("#rowsBody");
  if (!filtered.length) {
    tbody.innerHTML = "";
    show($("#emptyState"));
    return;
  }
  hide($("#emptyState"));

  filtered.sort((a, b) => (a.email || "").localeCompare(b.email || ""));

  tbody.innerHTML = filtered.map((r, i) => {
    const rotatesMs = new Date(r.rotates_at) - new Date();
    let rotatesText, rotatesCls = "";
    if (rotatesMs <= 0) {
      rotatesText = "Rotating now…";
      rotatesCls = "now";
    } else if (rotatesMs < 5 * 60_000) {
      rotatesText = `${Math.ceil(rotatesMs / 60_000)} min`;
      rotatesCls = "soon";
    } else {
      rotatesText = `${Math.floor(rotatesMs / 60_000)} min`;
    }

    let attemptCellHtml = '<span class="attempt-cell">—</span>';
    if (r.lastAttempt) {
      const ago = humanAgo(r.lastAttempt.attempted_at);
      const cls = r.lastAttempt.success ? "success" : "failed";
      const label = r.lastAttempt.success ? "OK" : (r.lastAttempt.failure_reason || "fail");
      attemptCellHtml = `<span class="attempt-cell ${cls}">${escapeHTML(label)} · ${escapeHTML(ago)}</span>`;
    }

    const isMe = r.tier === "admin";
    return `
      <tr class="${r.is_blocked ? "blocked" : ""}">
        <td>${i + 1}</td>
        <td>${escapeHTML(r.email)}${isMe ? ' <span style="font-size:10px;color:#1d4ed8;background:#f0f6ff;padding:1px 6px;border-radius:4px;margin-left:4px;">you</span>' : ""}</td>
        <td>${escapeHTML(r.mobile)}</td>
        <td><span class="password-cell ${r.is_blocked ? "blocked" : ""}" title="Click to copy" data-pwd="${escapeHTML(r.current_password)}">${escapeHTML(r.current_password)}</span></td>
        <td class="rotates-cell ${rotatesCls}">${rotatesText}</td>
        <td>${attemptCellHtml}</td>
        <td><span class="status-pill ${r.is_blocked ? "blocked" : "active"}">${r.is_blocked ? "Blocked" : "Active"}</span></td>
        <td>
          <div class="row-actions">
            <button class="action-rotate" data-uid="${escapeHTML(r.user_id)}">Rotate now</button>
            <button class="action-block ${r.is_blocked ? "" : "danger"}" data-uid="${escapeHTML(r.user_id)}" data-blocked="${r.is_blocked ? "1" : "0"}">
              ${r.is_blocked ? "Unblock" : "Block"}
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Wire click handlers
  tbody.querySelectorAll(".password-cell").forEach((el) => {
    el.addEventListener("click", () => copyPassword(el.dataset.pwd));
  });
  tbody.querySelectorAll(".action-rotate").forEach((el) => {
    el.addEventListener("click", () => forceRotate(el.dataset.uid));
  });
  tbody.querySelectorAll(".action-block").forEach((el) => {
    el.addEventListener("click", () => toggleBlock(el.dataset.uid, el.dataset.blocked === "1"));
  });
}

function renderAttempts(attempts) {
  const tbody = $("#attemptsBody");
  if (!attempts.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:14px;text-align:center;color:#94a3b8;">No attempts yet.</td></tr>`;
    return;
  }
  const userById = Object.fromEntries(allRows.map((r) => [r.user_id, r.email]));
  tbody.innerHTML = attempts.slice(0, 50).map((a) => {
    const cls = a.success ? "success" : "failed";
    const label = a.success ? "✓ OK" : `✗ ${a.failure_reason || "fail"}`;
    return `<tr>
      <td style="font-size:11px;color:#64748b;">${escapeHTML(new Date(a.attempted_at).toLocaleString())}</td>
      <td>${escapeHTML(userById[a.user_id] || (a.user_id ? a.user_id.slice(0,8) + "…" : "—"))}</td>
      <td><span class="attempt-cell ${cls}">${escapeHTML(label)}</span></td>
      <td style="font-size:11px;color:#94a3b8;font-family:ui-monospace,monospace;">${escapeHTML(a.ip_address || "—")}</td>
    </tr>`;
  }).join("");
}

async function forceRotate(userId) {
  if (!confirm("Generate a fresh password for this customer right now? Current password will stop working immediately.")) return;
  const newPwd = String(10000000 + Math.floor(Math.random() * 90000000));
  const { error } = await sb
    .from("pdtracker_install_passwords")
    .update({ current_password: newPwd, rotates_at: new Date(Date.now() + 60*60*1000).toISOString(), updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) { alert("Failed: " + error.message); return; }
  await refreshAll();
}

async function toggleBlock(userId, currentlyBlocked) {
  const verb = currentlyBlocked ? "Unblock" : "Block";
  if (!confirm(`${verb} install for this customer? ${currentlyBlocked ? "They will be able to install again." : "Their current password will stop working immediately."}`)) return;
  const { error } = await sb
    .from("pdtracker_install_passwords")
    .update({ is_blocked: !currentlyBlocked, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) { alert("Failed: " + error.message); return; }
  await refreshAll();
}

async function copyPassword(pwd) {
  try {
    await navigator.clipboard.writeText(pwd);
    showToast("Password copied");
  } catch {
    showToast("Couldn't copy — select manually");
  }
}

function showToast(msg) {
  let t = document.querySelector(".copied-toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "copied-toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 1500);
}

function humanAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
