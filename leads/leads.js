// cursive /leads/ — 3-bucket pipeline: New / Follow-ups / Completed
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cursive_admin_auth" },
});

const $ = (s) => document.querySelector(s);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

// Sub-tabs for NEW LEADS bucket
const NEW_SUBS = [
  { id: "lead_captured", title: "Lead captured" },
  { id: "otp_sent",      title: "OTP sent" },
  { id: "otp_verified",  title: "OTP verified" },
  { id: "callback",      title: "Callback" },
  { id: "click_to_call", title: "Click to Call" },
  { id: "click_to_wa",   title: "Click to WhatsApp" },
  { id: "tried_payment", title: "Tried payment" },
];

// Sub-tabs for FOLLOW UPS bucket (by talk_status) — high-intent first
const FOLLOW_SUBS = [
  { id: "not_picked",      title: "Call not picked" },
  { id: "callback",        title: "Call me later" },     // synthetic — uses manual_status=callback
  { id: "interested",      title: "Interested" },
  { id: "in_progress",     title: "In progress" },
  { id: "never_visited",   title: "Said: never visited" },
  { id: "dont_call_again", title: "Said: don't call" },
  { id: "not_interested",  title: "Not interested" },
];

const TALK_STATUS_OPTIONS = [
  { value: "",                label: "— select —" },
  { value: "not_picked",      label: "Call not picked" },
  { value: "never_visited",   label: "Said: never visited site" },
  { value: "dont_call_again", label: "Said: don't call again" },
  { value: "in_progress",     label: "In progress" },
  { value: "interested",      label: "Interested" },
  { value: "not_interested",  label: "Not interested" },
  { value: "won_offline",     label: "Won (paid offline)" },
];

let pipelineCache = [];
let activeTop = "new";   // "new" | "follow" | "done"
let activeSub = "lead_captured";

window.addEventListener("DOMContentLoaded", async () => {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#refreshBtn").addEventListener("click", () => refreshAll());
  $("#searchBox").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

  document.querySelectorAll(".top-tab").forEach((btn) =>
    btn.addEventListener("click", () => switchTop(btn.dataset.top))
  );

  const { data: { session } } = await sb.auth.getSession();
  if (session) bootDashboard();
  else { hide($("#dashView")); show($("#loginView")); }
});

async function onLogin(e) {
  e.preventDefault();
  hide($("#loginError"));
  const email = $("#email").value.trim().toLowerCase();
  const password = $("#password").value;
  $("#loginBtn").disabled = true; $("#loginBtn").textContent = "Signing in...";
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    bootDashboard();
  } catch (err) {
    const el = $("#loginError"); el.textContent = humanError(err); show(el);
  } finally {
    $("#loginBtn").disabled = false; $("#loginBtn").textContent = "Sign in";
  }
}
async function onSignOut() {
  await sb.auth.signOut();
  hide($("#dashView")); show($("#loginView"));
  hide($("#emailChip")); hide($("#signOutBtn"));
}
async function bootDashboard() {
  hide($("#loginView")); show($("#dashView"));
  const { data: { user } } = await sb.auth.getUser();
  $("#emailChip").textContent = user?.email || "";
  show($("#emailChip")); show($("#signOutBtn"));
  await refreshAll();
}

async function callAdmin(kind, extra = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch(SUPABASE_URL + "/functions/v1/admin-data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + session.access_token,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ kind, ...extra }),
  });
  const json = await res.json().catch(() => ({ ok: false, message: "Bad response." }));
  if (!json.ok) throw new Error(json.message || "Request failed.");
  return json.data;
}

async function refreshAll() {
  try {
    pipelineCache = await callAdmin("pipeline");
    $("#lastRefreshed").textContent = "Last refreshed " + new Date().toLocaleTimeString();
    updateTopCounts();
    renderActive();
  } catch (e) {
    $("#paneStage").innerHTML = `<div class="empty"><strong>Error:</strong> ${esc(e.message)}</div>`;
  }
}

async function runSearch() {
  const q = $("#searchBox").value.trim().toLowerCase();
  if (!q) return refreshAll();
  // Client-side filter on the cached pipeline
  const filtered = pipelineCache.filter(l =>
    (l.email || "").toLowerCase().includes(q) ||
    (l.mobile || "").toLowerCase().includes(q) ||
    (l.service_name || "").toLowerCase().includes(q) ||
    (l.service_type || "").toLowerCase().includes(q)
  );
  $("#paneStage").innerHTML = renderTable(filtered, true, `Search: "${esc(q)}" — ${filtered.length} match(es). Showing across all buckets.`);
  wireRowHandlers();
}

// ---------- Bucket logic ----------
function bucketOf(lead) {
  // Top precedence: actual paid event
  if (["payment_completed","wallet_recharged","wallet_debited"].includes(lead.latest_event)) return "done";
  // Manual won
  if (lead.manual_status === "won" || lead.talk_status === "won_offline") return "done";
  // Triaged (operator has set a talk_status, but not done) -> Follow ups
  if (lead.talk_status && lead.talk_status !== "won_offline") return "follow";
  // Manual stage moves (callback) without talk_status -> still Follow ups
  if (lead.manual_status === "callback") return "follow";
  // Otherwise -> new inbox
  return "new";
}

function newSubOf(lead) {
  // For leads in the NEW bucket, which stage sub-tab?
  if (lead.manual_status === "callback") return "callback";
  if (lead.manual_status === "clicked_wa") return "click_to_wa";
  if (lead.manual_status === "clicked_call") return "click_to_call";
  if (lead.latest_event === "payment_initiated") return "tried_payment";
  if (lead.latest_event === "otp_verified")      return "otp_verified";
  if (lead.latest_event === "otp_sent")          return "otp_sent";
  return "lead_captured";
}

function followSubOf(lead) {
  // Talk status takes precedence
  if (lead.talk_status) return lead.talk_status;
  if (lead.manual_status === "callback") return "callback";
  return "in_progress";
}

function updateTopCounts() {
  const counts = { new: 0, follow: 0, done: 0 };
  pipelineCache.forEach((l) => { counts[bucketOf(l)] += 1; });
  $("#topcnt_new").textContent    = counts.new;
  $("#topcnt_follow").textContent = counts.follow;
  $("#topcnt_done").textContent   = counts.done;
}

function switchTop(top) {
  activeTop = top;
  document.querySelectorAll(".top-tab").forEach((b) => b.classList.toggle("active", b.dataset.top === top));
  // pick a default sub-tab for the bucket
  if (top === "new")    activeSub = "lead_captured";
  if (top === "follow") activeSub = "not_picked";
  if (top === "done")   activeSub = "all";
  renderActive();
}

function renderActive() {
  renderSubTabs();
  renderPane();
}

function renderSubTabs() {
  let subs = [];
  if (activeTop === "new")    subs = NEW_SUBS;
  if (activeTop === "follow") subs = FOLLOW_SUBS;
  if (activeTop === "done")   subs = [{ id: "all", title: "All completed" }];

  // Compute counts within this bucket
  const inBucket = pipelineCache.filter((l) => bucketOf(l) === activeTop);
  const counts = {};
  subs.forEach((s) => counts[s.id] = 0);
  inBucket.forEach((l) => {
    let k;
    if (activeTop === "new")    k = newSubOf(l);
    if (activeTop === "follow") k = followSubOf(l);
    if (activeTop === "done")   k = "all";
    if (k in counts) counts[k] += 1;
  });

  $("#subTabs").innerHTML = subs.map((s, i) => `
    <button class="sub-tab ${(s.id === activeSub) ? "active" : ""}" data-sub="${esc(s.id)}">
      ${esc(s.title)}<span class="sub-count">${counts[s.id] || 0}</span>
    </button>
  `).join("");

  document.querySelectorAll(".sub-tab").forEach((btn) =>
    btn.addEventListener("click", () => { activeSub = btn.dataset.sub; renderActive(); })
  );

  // If the active sub doesn't exist for this bucket, pick the first one
  if (!subs.find((s) => s.id === activeSub)) {
    activeSub = subs[0]?.id || "";
    renderSubTabs();
  }
}

function renderPane() {
  const inBucket = pipelineCache.filter((l) => bucketOf(l) === activeTop);
  let rows;
  if (activeTop === "new")    rows = inBucket.filter((l) => newSubOf(l) === activeSub);
  if (activeTop === "follow") rows = inBucket.filter((l) => followSubOf(l) === activeSub);
  if (activeTop === "done")   rows = inBucket;

  if (!rows.length) {
    $("#paneStage").innerHTML = `<div class="empty">No leads in this view.</div>`;
    return;
  }
  $("#paneStage").innerHTML = renderTable(rows, activeTop === "done");
  wireRowHandlers();
}

function renderTable(rows, readOnly, headerNote = "") {
  return `${headerNote ? `<p style="margin:0 14px 10px;color:#475467;font-size:13px;">${headerNote}</p>` : ""}
    <div class="table-scroll"><table class="data">
    <thead><tr>
      <th>Service</th>
      <th>Contact</th>
      <th>Last activity</th>
      <th>Actions</th>
      <th style="min-width:170px;">Call status</th>
      <th style="min-width:200px;">Remarks</th>
      ${readOnly ? "" : "<th>Save</th>"}
    </tr></thead>
    <tbody>${rows.map((r) => rowHtml(r, readOnly)).join("")}</tbody>
  </table></div>`;
}

function rowHtml(l, readOnly) {
  const phone = (l.mobile || "").replace(/\D/g, "");
  const waPhone = phone.length === 10 ? "91" + phone : phone;
  const waText = encodeURIComponent(`Hi! This is cursive. I see you started ${l.service_name || l.service_type || ""} - quick chat?`);
  const cur = esc(l.customer_key || "");
  const ageHrs = (Date.now() - new Date(l.last_event_at).getTime()) / 3600000;
  const ageStr = ageHrs < 1 ? Math.round(ageHrs * 60) + "m"
              : ageHrs < 24 ? Math.round(ageHrs) + "h"
              : Math.round(ageHrs / 24) + "d";

  const statusValue = l.talk_status || "";
  const statusLabel = (TALK_STATUS_OPTIONS.find(o => o.value === statusValue) || {}).label || "—";

  const callBtn = phone ? `<a href="tel:+${waPhone}" class="call" data-action="call">Call</a>` : "";
  const waBtn   = phone ? `<a href="https://wa.me/${waPhone}?text=${waText}" target="_blank" rel="noopener" class="whatsapp" data-action="wa">WhatsApp</a>` : "";

  // Completed (read-only) row
  if (readOnly) {
    return `<tr class="done">
      <td>
        <div style="font-weight:600;">${esc(l.service_name || l.service_type || "—")}</div>
        <span class="done-tag">${esc(bucketReason(l))}</span>
      </td>
      <td>
        ${l.email ? `<div>${esc(l.email)}</div>` : ""}
        ${l.mobile ? `<div class="muted-small">${esc(l.mobile)}</div>` : ""}
      </td>
      <td>
        <div>${esc(ageStr)} ago</div>
        <div class="muted-small">${esc(fmtDate(l.last_event_at))} ${esc(fmtTime(l.last_event_at))}</div>
      </td>
      <td><div class="row-actions">${callBtn}${waBtn}</div></td>
      <td><span class="muted-small" style="font-weight:600;color:#0f172a;">${esc(statusLabel)}</span></td>
      <td><span class="muted-small">${esc(l.remarks || "—")}</span></td>
    </tr>`;
  }

  // Editable row
  const statusOpts = TALK_STATUS_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === statusValue ? "selected" : ""}>${esc(o.label)}</option>`).join("");
  return `<tr class="${l.is_stale ? "stale" : ""}" data-customer-key="${cur}">
    <td>
      <div style="font-weight:600;">${esc(l.service_name || l.service_type || "—")}</div>
      ${l.is_stale ? `<span class="stale-tag">stale</span>` : ""}
    </td>
    <td>
      ${l.email ? `<div><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></div>` : ""}
      ${l.mobile ? `<div class="muted-small">${esc(l.mobile)}</div>` : ""}
    </td>
    <td>
      <div>${esc(ageStr)} ago</div>
      <div class="muted-small">${esc(fmtDate(l.last_event_at))} ${esc(fmtTime(l.last_event_at))}</div>
    </td>
    <td><div class="row-actions">${callBtn}${waBtn}</div></td>
    <td>
      <select class="status-select" data-customer-key="${cur}">${statusOpts}</select>
    </td>
    <td>
      <textarea class="remarks-input" data-customer-key="${cur}" placeholder="Notes..." rows="1">${esc(l.remarks || "")}</textarea>
    </td>
    <td>
      <button class="row-save-btn" data-action="save" data-customer-key="${cur}">${statusValue ? "Update" : "Save"}</button>
      <div class="row-save-error" style="display:none;"></div>
    </td>
  </tr>`;
}

function bucketReason(l) {
  if (l.talk_status === "won_offline") return "won (offline)";
  if (l.manual_status === "won") return "won";
  if (l.latest_event === "payment_completed") return "paid via Razorpay";
  if (l.latest_event === "wallet_recharged") return "wallet recharged";
  return "completed";
}

function wireRowHandlers() {
  $("#paneStage").addEventListener("click", async (e) => {
    const btn = e.target.closest('[data-action="save"]');
    if (!btn) return;
    const tr = btn.closest("tr");
    const key = btn.dataset.customerKey;
    const sel = tr.querySelector("select.status-select");
    const ta  = tr.querySelector("textarea.remarks-input");
    const errBox = tr.querySelector(".row-save-error");
    errBox.style.display = "none";

    const talk_status = sel.value || null;
    const remarks = ta.value || null;
    if (!talk_status && !remarks) {
      errBox.textContent = "Pick a status or type remarks before saving.";
      errBox.style.display = "block";
      return;
    }

    btn.disabled = true; btn.textContent = "Saving...";
    try {
      await callAdmin("set_lead_status", { customer_key: key, talk_status, remarks });
      // Update cache
      const idx = pipelineCache.findIndex((x) => x.customer_key === key);
      if (idx >= 0) {
        pipelineCache[idx].talk_status = talk_status;
        pipelineCache[idx].remarks = remarks;
      }
      // Re-render -> lead moves to its new bucket / sub-tab automatically
      updateTopCounts();
      renderActive();
    } catch (err) {
      btn.disabled = false; btn.textContent = "Save";
      errBox.textContent = "Save failed: " + err.message;
      errBox.style.display = "block";
    }
  });
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmtDate(iso) { if (!iso) return "—"; return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }); }
function fmtTime(iso) { if (!iso) return ""; return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); }
function humanError(err) {
  const msg = (err && err.message) || String(err);
  if (/invalid login credentials/i.test(msg)) return "Email and password don't match.";
  if (/rate limit/i.test(msg)) return "Too many attempts, wait a minute.";
  if (/don't have admin access/i.test(msg)) return "This email isn't on the admin whitelist.";
  return msg;
}
