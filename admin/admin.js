// cursive /admin/ — 8-stage tabbed pipeline with status dropdown + remarks
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cursive_admin_auth" },
});

const $ = (s) => document.querySelector(s);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

const STAGES = [
  { id: "lead_captured",    title: "Lead captured" },
  { id: "otp_sent",         title: "OTP sent" },
  { id: "otp_verified",     title: "OTP verified" },
  { id: "callback",         title: "Callback requested" },
  { id: "click_to_call",    title: "Click to Call" },
  { id: "click_to_wa",      title: "Click to WhatsApp" },
  { id: "tried_payment",    title: "Tried payment" },
  { id: "payment_complete", title: "Payment complete" },
];

const TALK_STATUS_OPTIONS = [
  { value: "",                  label: "— select —",                cls: "" },
  { value: "not_picked",        label: "Call not picked",           cls: "warn" },
  { value: "never_visited",     label: "Said: never visited site",  cls: "bad" },
  { value: "dont_call_again",   label: "Said: don't call again",    cls: "bad" },
  { value: "in_progress",       label: "In progress",               cls: "set" },
  { value: "interested",        label: "Interested",                cls: "set" },
  { value: "not_interested",    label: "Not interested",            cls: "bad" },
  { value: "won_offline",       label: "Won (paid offline)",        cls: "good" },
];

let pipelineCache = [];
let activeStage = "lead_captured";
let activeOtherTab = null;
let saveTimers = new Map();

window.addEventListener("DOMContentLoaded", async () => {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#refreshBtn").addEventListener("click", () => refreshAll());
  $("#searchBox").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

  // Build stage tabs
  $("#stageTabs").innerHTML = STAGES.map((s, i) =>
    `<button class="tab ${i === 0 ? "active" : ""}" data-stage="${s.id}">${s.title} <span class="badge" id="cnt_${s.id}">0</span></button>`
  ).join("");
  document.querySelectorAll(".stage-tabs .tab").forEach((btn) =>
    btn.addEventListener("click", () => switchStage(btn.dataset.stage))
  );
  document.querySelectorAll(".other-tabs .tab").forEach((btn) =>
    btn.addEventListener("click", () => switchOther(btn.dataset.tab))
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
  $("#loginBtn").disabled = true; $("#loginBtn").textContent = "Signing in…";
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

async function refreshAll() {
  await Promise.all([refreshSummary(), refreshPipeline()]);
  if (activeOtherTab) refreshOther(activeOtherTab);
}

function switchStage(stage) {
  activeStage = stage;
  activeOtherTab = null;
  document.querySelectorAll(".stage-tabs .tab").forEach((b) => b.classList.toggle("active", b.dataset.stage === stage));
  document.querySelectorAll(".other-tabs .tab").forEach((b) => b.classList.remove("active"));
  ["Stage","Pending","Invoices","Wallets","Search"].forEach(n => hide(document.getElementById("pane" + n)));
  show($("#paneStage"));
  renderStage();
}
function switchOther(tab) {
  activeOtherTab = tab;
  document.querySelectorAll(".other-tabs .tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".stage-tabs .tab").forEach((b) => b.classList.remove("active"));
  ["Stage","Pending","Invoices","Wallets","Search"].forEach(n => hide(document.getElementById("pane" + n)));
  show(document.getElementById("pane" + cap(tab)));
  refreshOther(tab);
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

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

async function refreshSummary() {
  try {
    const s = await callAdmin("summary");
    renderSummary(s);
    $("#lastRefreshed").textContent = "Last refreshed " + new Date().toLocaleTimeString();
  } catch (e) {
    $("#kpiStrip").innerHTML = `<div class="kpi" style="grid-column:1/-1;border-left-color:#dc2626;"><div class="lbl">Admin error</div><div class="val" style="font-size:14px;">${esc(e.message)}</div></div>`;
  }
}

async function refreshPipeline() {
  try {
    pipelineCache = await callAdmin("pipeline");
    updateStageCounts();
    if (!activeOtherTab) renderStage();
  } catch (e) {
    $("#paneStage").innerHTML = `<div class="empty"><strong>Error:</strong> ${esc(e.message)}</div>`;
  }
}

async function refreshOther(tab) {
  try {
    if (tab === "pending")  { const d = await callAdmin("pending_payments");   renderPending(d);  $("#badgePending").textContent = d.length; }
    if (tab === "invoices") { const d = await callAdmin("invoices",{limit:100}); renderInvoices(d); }
    if (tab === "wallets")  { const d = await callAdmin("wallets");             renderWallets(d); }
  } catch (e) {
    const pane = document.getElementById("pane" + cap(tab));
    if (pane) pane.innerHTML = `<div class="empty"><strong>Error:</strong> ${esc(e.message)}</div>`;
  }
}

async function runSearch() {
  const q = $("#searchBox").value.trim();
  if (!q) return;
  document.querySelector('.tab[data-tab="search"]').classList.remove("hidden");
  switchOther("search");
  $("#paneSearch").innerHTML = `<div class="empty">Searching…</div>`;
  try { renderSearch(await callAdmin("search", { query: q })); }
  catch (e) { $("#paneSearch").innerHTML = `<div class="empty"><strong>Error:</strong> ${esc(e.message)}</div>`; }
}

function renderSummary(s) {
  $("#kpiStrip").innerHTML = `
    <div class="kpi"><div class="lbl">Leads (7d)</div><div class="val">${num(s.leads_week)}</div><div class="sub">${num(s.leads_total)} all time</div></div>
    <div class="kpi ok"><div class="lbl">Captured (7d)</div><div class="val">${num(s.captured_week)}</div><div class="sub">${num(s.captured_total)} all time</div></div>
    <div class="kpi warn"><div class="lbl">Pending payments</div><div class="val">${num(s.pending_count)}</div><div class="sub">${inr(s.pending_value)} value</div></div>
    <div class="kpi"><div class="lbl">Invoices today</div><div class="val">${inr(s.invoices_today_value)}</div><div class="sub">${num(s.invoices_today_count)} count</div></div>
    <div class="kpi muted"><div class="lbl">Total invoiced</div><div class="val">${inr(s.invoices_total_value)}</div><div class="sub">${num(s.invoices_total_count)} count</div></div>
    <div class="kpi muted"><div class="lbl">Wallet float</div><div class="val">${inr(s.wallets_float)}</div><div class="sub">across all wallets</div></div>
  `;
}

function updateStageCounts() {
  const counts = {};
  STAGES.forEach(s => counts[s.id] = 0);
  pipelineCache.forEach(l => { counts[l.stage] = (counts[l.stage] || 0) + 1; });
  STAGES.forEach(s => {
    const el = document.getElementById("cnt_" + s.id);
    if (el) el.textContent = counts[s.id] || 0;
  });
}

function renderStage() {
  const rows = pipelineCache.filter(l => l.stage === activeStage);
  if (!rows.length) {
    $("#paneStage").innerHTML = `<div class="empty">No leads in this stage.</div>`;
    return;
  }
  const stageTitle = STAGES.find(s => s.id === activeStage)?.title || activeStage;
  $("#paneStage").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr>
      <th>Service</th>
      <th>Contact</th>
      <th>Last activity</th>
      <th>Amount</th>
      <th>Actions</th>
      <th style="min-width:170px;">Call status</th>
      <th style="min-width:200px;">Remarks</th>
    </tr></thead>
    <tbody>${rows.map(rowHtml).join("")}</tbody>
  </table></div>
  <p style="margin:10px 14px;color:#94a3b8;font-size:11px;">Status and remarks auto-save. Yellow rows = no activity for 3+ days.</p>`;

  // Wire actions
  $("#paneStage").addEventListener("click", onActionClick);
  $("#paneStage").addEventListener("change", onStatusChange);
  document.querySelectorAll("#paneStage textarea.remarks-input").forEach((ta) => {
    ta.addEventListener("input", () => onRemarksInput(ta));
    ta.addEventListener("blur", () => flushRemarks(ta));
  });
}

function rowHtml(l) {
  const phone = (l.mobile || "").replace(/\D/g, "");
  const waPhone = phone.length === 10 ? "91" + phone : phone;
  const waText = encodeURIComponent(`Hi! This is cursive. I see you started ${l.service_name || l.service_type || ""} — quick chat?`);
  const cur = esc(l.customer_key || "");
  const ageHrs = (Date.now() - new Date(l.last_event_at).getTime()) / 3600000;
  const ageStr = ageHrs < 1 ? Math.round(ageHrs * 60) + "m"
              : ageHrs < 24 ? Math.round(ageHrs) + "h"
              : Math.round(ageHrs / 24) + "d";
  const callBtn = phone ? `<a href="tel:+${waPhone}" class="call" data-action="call" data-customer-key="${cur}">☎️ Call</a>` : "";
  const waBtn   = phone ? `<a href="https://wa.me/${waPhone}?text=${waText}" target="_blank" rel="noopener" class="whatsapp" data-action="wa" data-customer-key="${cur}">💬 WA</a>` : "";

  const statusValue = l.talk_status || "";
  const statusOpts = TALK_STATUS_OPTIONS.map(o => `<option value="${o.value}" ${o.value === statusValue ? "selected" : ""}>${esc(o.label)}</option>`).join("");
  const statusCls = TALK_STATUS_OPTIONS.find(o => o.value === statusValue)?.cls || "";

  return `<tr class="${l.is_stale ? "stale" : ""}" data-customer-key="${cur}">
    <td>
      <div style="font-weight:600;">${esc(l.service_name || l.service_type || "—")}</div>
      ${l.is_stale ? `<span class="stale-tag">⏰ stale</span>` : ""}
    </td>
    <td>
      ${l.email ? `<div><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></div>` : ""}
      ${l.mobile ? `<div class="muted-small">${esc(l.mobile)}</div>` : ""}
    </td>
    <td>
      <div>${esc(ageStr)} ago</div>
      <div class="muted-small">${esc(fmtDate(l.last_event_at))} ${esc(fmtTime(l.last_event_at))}</div>
    </td>
    <td class="money">${l.amount ? inr(l.amount) : "—"}</td>
    <td><div class="row-actions">${callBtn}${waBtn}</div></td>
    <td>
      <select class="status-select ${statusCls}" data-field="talk_status" data-customer-key="${cur}">${statusOpts}</select>
    </td>
    <td>
      <textarea class="remarks-input" data-field="remarks" data-customer-key="${cur}" placeholder="Notes…" rows="1">${esc(l.remarks || "")}</textarea>
      <span class="saved-mark" data-saved-for="${cur}-remarks">✓ saved</span>
    </td>
  </tr>`;
}

function onActionClick(e) {
  const a = e.target.closest("[data-action]");
  if (!a) return;
  const action = a.dataset.action;
  const key = a.dataset.customerKey;
  // The link's native href still fires; we just additionally log the action
  const manual_status = action === "call" ? "clicked_call" : action === "wa" ? "clicked_wa" : null;
  if (manual_status) {
    callAdmin("set_lead_status", { customer_key: key, manual_status }).then(() => {
      // Move lead to its new stage in the cache
      const idx = pipelineCache.findIndex(x => x.customer_key === key);
      if (idx >= 0) {
        pipelineCache[idx].manual_status = manual_status;
        pipelineCache[idx].stage = manual_status === "clicked_call" ? "click_to_call" : "click_to_wa";
      }
      updateStageCounts();
      renderStage();
    }).catch(err => console.error("logging action failed", err));
  }
}

function onStatusChange(e) {
  const sel = e.target.closest("select.status-select");
  if (!sel) return;
  const key = sel.dataset.customerKey;
  const value = sel.value || null;
  sel.disabled = true;
  callAdmin("set_lead_status", { customer_key: key, talk_status: value }).then(() => {
    const idx = pipelineCache.findIndex(x => x.customer_key === key);
    if (idx >= 0) pipelineCache[idx].talk_status = value;
    sel.disabled = false;
    const cls = TALK_STATUS_OPTIONS.find(o => o.value === (value || ""))?.cls || "";
    sel.className = "status-select " + cls;
    flashSaved(sel.closest("tr"), key + "-status");
  }).catch(err => {
    sel.disabled = false;
    alert("Could not save status: " + err.message);
  });
}

function onRemarksInput(ta) {
  const key = ta.dataset.customerKey;
  if (saveTimers.has(key)) clearTimeout(saveTimers.get(key));
  saveTimers.set(key, setTimeout(() => flushRemarks(ta), 800));
}
function flushRemarks(ta) {
  const key = ta.dataset.customerKey;
  const value = ta.value;
  if (saveTimers.has(key)) { clearTimeout(saveTimers.get(key)); saveTimers.delete(key); }
  ta.disabled = true;
  callAdmin("set_lead_status", { customer_key: key, remarks: value }).then(() => {
    const idx = pipelineCache.findIndex(x => x.customer_key === key);
    if (idx >= 0) pipelineCache[idx].remarks = value;
    ta.disabled = false;
    flashSaved(ta.closest("tr"), key + "-remarks");
  }).catch(err => {
    ta.disabled = false;
    console.error("save remarks failed", err);
  });
}
function flashSaved(tr, savedKey) {
  const mark = tr.querySelector(`[data-saved-for="${savedKey.replace(/[^-a-zA-Z0-9|@.]/g, "\\$&")}"]`);
  // simpler: find any .saved-mark inside the row
  const m = tr.querySelector(".saved-mark");
  if (!m) return;
  m.classList.add("show");
  setTimeout(() => m.classList.remove("show"), 1200);
}

function renderPending(rows) {
  if (!rows.length) return ($("#panePending").innerHTML = `<div class="empty">No pending payments. 🎉</div>`);
  $("#panePending").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Started</th><th>Type</th><th>Customer</th><th>Description</th><th>Amount</th><th>Razorpay order</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><div>${fmtDate(r.created_at)}</div><div class="muted-small">${fmtTime(r.created_at)}</div></td>
      <td><span class="event-pill">${esc(r.type)}</span></td>
      <td>${r.email ? `<div>${esc(r.email)}</div>` : ""}${r.mobile ? `<div class="muted-small">${esc(r.mobile)}</div>` : ""}</td>
      <td>${esc(r.description || "—")}</td>
      <td class="money">${inr(r.amount)}</td>
      <td><span class="mono">${esc(r.razorpay_order_id || "—")}</span></td>
    </tr>`).join("")}</tbody></table></div>`;
}

function renderInvoices(rows) {
  if (!rows.length) return ($("#paneInvoices").innerHTML = `<div class="empty">No invoices yet.</div>`);
  $("#paneInvoices").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Date</th><th>Invoice #</th><th>Customer</th><th>GST</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Emailed</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td>${fmtDate(r.created_at)}</td>
      <td><span class="mono">${esc(r.invoice_number)}</span></td>
      <td>${esc(r.email || "—")}</td>
      <td>${r.customer_gst_name ? esc(r.customer_gst_name) : "<span class='muted-small'>—</span>"}</td>
      <td class="money">${inr(r.subtotal)}</td>
      <td class="money">${inr(Number(r.cgst) + Number(r.sgst) + Number(r.igst))}</td>
      <td class="money green">${inr(r.total)}</td>
      <td>${r.emailed_at ? "<span style='color:#047857;'>✓</span>" : "<span class='muted-small'>—</span>"}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function renderWallets(rows) {
  if (!rows.length) return ($("#paneWallets").innerHTML = `<div class="empty">No wallet activity yet.</div>`);
  $("#paneWallets").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Email</th><th>Mobile</th><th>Balance</th><th>Updated</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td>${esc(r.email)}</td>
      <td>${esc(r.mobile || "—")}</td>
      <td class="money ${Number(r.balance) > 0 ? "green" : ""}">${inr(r.balance)}</td>
      <td>${fmtDate(r.updated_at)} <span class="muted-small">${fmtTime(r.updated_at)}</span></td>
    </tr>`).join("")}</tbody></table></div>`;
}

function renderSearch(d) {
  if (!d.leads.length && !d.invoices.length && !d.wallets.length && !d.completed.length) {
    $("#paneSearch").innerHTML = `<div class="empty">No results for "<strong>${esc(d.query)}</strong>".</div>`;
    return;
  }
  const sec = (title, rows, html) => rows.length ? `<h3 style="margin:18px 14px 8px;font-size:13px;color:#64748b;">${title} (${rows.length})</h3>${html(rows)}` : "";
  $("#paneSearch").innerHTML = `
    ${sec("Leads", d.leads, (rows) => `<div class="table-scroll"><table class="data"><tbody>${rows.map(r => `<tr><td>${fmtDate(r.last_event_at)}</td><td>${esc(r.service_name || "")}</td><td>${esc(r.email || "")}</td><td>${esc(r.mobile || "")}</td><td class="money">${r.amount ? inr(r.amount) : ""}</td></tr>`).join("")}</tbody></table></div>`)}
    ${sec("Completed payments", d.completed, (rows) => `<div class="table-scroll"><table class="data"><tbody>${rows.map(r => `<tr><td>${fmtDate(r.completed_at)}</td><td>${esc(r.email || "")}</td><td>${esc(r.service_name || "")}</td><td class="money green">${inr(r.amount)}</td><td class="mono">${esc(r.invoice_number || "")}</td></tr>`).join("")}</tbody></table></div>`)}
    ${sec("Invoices", d.invoices, (rows) => `<div class="table-scroll"><table class="data"><tbody>${rows.map(r => `<tr><td>${fmtDate(r.created_at)}</td><td class="mono">${esc(r.invoice_number)}</td><td>${esc(r.email || "")}</td><td class="money green">${inr(r.total)}</td></tr>`).join("")}</tbody></table></div>`)}
    ${sec("Wallets", d.wallets, (rows) => `<div class="table-scroll"><table class="data"><tbody>${rows.map(r => `<tr><td>${esc(r.email)}</td><td>${esc(r.mobile || "")}</td><td class="money ${Number(r.balance) > 0 ? "green" : ""}">${inr(r.balance)}</td></tr>`).join("")}</tbody></table></div>`)}
  `;
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function num(n) { return Number(n || 0).toLocaleString("en-IN"); }
function inr(n) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(Number(n || 0)); }
function fmtDate(iso) { if (!iso) return "—"; return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }); }
function fmtTime(iso) { if (!iso) return ""; return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); }
function humanError(err) {
  const msg = (err && err.message) || String(err);
  if (/invalid login credentials/i.test(msg)) return "Email and password don't match.";
  if (/rate limit/i.test(msg)) return "Too many attempts, wait a minute.";
  if (/don't have admin access/i.test(msg)) return "This email isn't on the admin whitelist.";
  return msg;
}
