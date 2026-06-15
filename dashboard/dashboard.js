// cursive /dashboard/ — admin-only Dashboard
// Section 1: Uploads of the 4 reference files used by the OLD Master CSV
// Files land in private Supabase Storage bucket `admin-uploads`,
// tracked in `wt_admin_uploads`. Latest upload per slot is the current one.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cursive_dashboard_auth" },
});

const $ = (s) => document.querySelector(s);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

const BUCKET = "admin-uploads";
const SLOTS = [
  { key: "master_sku",   label: "Master SKU File" },
  { key: "prices",       label: "Platform Prices" },
  { key: "multi_lookup", label: "Multi-Platform Lookup" },
  { key: "amazon_fba",   label: "Amazon FBA Orders" },
];

window.addEventListener("DOMContentLoaded", async () => {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#denySignOut").addEventListener("click", onSignOut);

  // Wire upload buttons -> hidden file inputs -> upload
  SLOTS.forEach(({ key }) => {
    const fileInput = document.getElementById(`file_${key}`);
    const btn = document.querySelector(`.slot-upload[data-slot-key="${key}"]`);
    btn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) handleUpload(key, f, fileInput);
    });
  });

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
  hide($("#dashView"));
  hide($("#denyView"));
  show($("#loginView"));
  $("#emailChip").textContent = "";
  hide($("#emailChip"));
  hide($("#signOutBtn"));
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

  await refreshSlots();
  await refreshHistory();
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

async function refreshSlots() {
  const { data, error } = await sb
    .from("wt_admin_uploads")
    .select("slot_key, file_name, file_size, uploaded_at, uploaded_by, storage_path")
    .eq("is_current", true);
  if (error) {
    console.error(error);
    return;
  }
  const byKey = Object.fromEntries((data || []).map((r) => [r.slot_key, r]));
  SLOTS.forEach(({ key }) => renderSlotStatus(key, byKey[key]));
}

function renderSlotStatus(key, row) {
  const el = document.getElementById(`status_${key}`);
  if (!row) {
    el.classList.remove("uploaded");
    el.innerHTML = "No upload yet.";
    return;
  }
  el.classList.add("uploaded");
  const dt = new Date(row.uploaded_at).toLocaleString();
  const size = formatBytes(row.file_size || 0);
  el.innerHTML = `
    <div class="file-line">${escapeHTML(row.file_name)}</div>
    <div class="meta-line">${size} &middot; uploaded ${escapeHTML(dt)}</div>
  `;
  const btn = document.querySelector(`.slot-upload[data-slot-key="${key}"]`);
  btn.textContent = "Replace file";
}

async function handleUpload(slotKey, file, fileInput) {
  const slot = SLOTS.find((s) => s.key === slotKey);
  const msg = document.getElementById(`msg_${slotKey}`);
  const btn = document.querySelector(`.slot-upload[data-slot-key="${slotKey}"]`);
  msg.className = "slot-msg";
  msg.textContent = "Uploading…";
  btn.disabled = true;

  try {
    // Path: <slot_key>/<ISO timestamp>_<original filename>
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = `${slotKey}/${stamp}_${safeName}`;

    const up = await sb.storage.from(BUCKET).upload(path, file, {
      cacheControl: "0",
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });
    if (up.error) throw up.error;

    // Insert tracking row — the DB trigger marks prior uploads for this slot as not current
    const ins = await sb.from("wt_admin_uploads").insert({
      slot_key:     slotKey,
      slot_label:   slot.label,
      storage_path: up.data.path,
      file_name:    file.name,
      file_size:    file.size,
      mime_type:    file.type || null,
    });
    if (ins.error) throw ins.error;

    msg.className = "slot-msg success";
    msg.textContent = "Uploaded.";
    await refreshSlots();
    await refreshHistory();
  } catch (err) {
    console.error(err);
    msg.className = "slot-msg error";
    msg.textContent = "Failed: " + (err.message || err);
  } finally {
    btn.disabled = false;
    fileInput.value = "";
    setTimeout(() => { msg.textContent = ""; msg.className = "slot-msg"; }, 5000);
  }
}

async function refreshHistory() {
  const { data, error } = await sb
    .from("wt_admin_uploads")
    .select("slot_label, file_name, file_size, uploaded_at, uploaded_by, is_current")
    .order("uploaded_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error(error);
    return;
  }
  const tbody = document.getElementById("historyBody");
  if (!data || !data.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:14px;text-align:center;color:#94a3b8;">No uploads yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((r) => `
    <tr>
      <td>${escapeHTML(r.slot_label)}</td>
      <td>${escapeHTML(r.file_name)}</td>
      <td>${formatBytes(r.file_size || 0)}</td>
      <td><span style="font-family:ui-monospace,monospace;font-size:11px;color:#64748b;">${escapeHTML((r.uploaded_by || "").slice(0, 8))}…</span></td>
      <td>${escapeHTML(new Date(r.uploaded_at).toLocaleString())}</td>
      <td><span class="pill ${r.is_current ? "current" : "stale"}">${r.is_current ? "current" : "stale"}</span></td>
    </tr>
  `).join("");
}

function formatBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
