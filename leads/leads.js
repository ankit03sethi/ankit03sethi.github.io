// cursive /leads/ - 8-stage tabbed lead pipeline (Save button per row, lock on save)
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
  { id: "callback",         title: "Callback" },
  { id: "click_to_call",    title: "Click to Call" },
  { id: "click_to_wa",      title: "Click to WhatsApp" },
  { id: "tried_payment",    title: "Tried payment" },
  { id: "payment_complete", title: "Payment complete" },
];

const TALK_STATUS_OPTIONS = [
  { value: "",                label: "-- select --" },
  { value: "not_picked",      label: "Call not picked" },
  { value: "never_visited",   label: "Said: never visited site" },
  { value: "dont_call_again", label: "Said: don't call again" },
  { value: "in_progress",     label: "In progress" },
  { value: "interested",      label: "Interested" },
  { value: "not_interested",  label: "Not interested" },
  { value: "won_offline",     label: "Won (paid offline)" },
];

let pipelineCache = [];
let activeStage = "lead_captured";
let activeOtherTab = null;

window.addEventListener("DOMContentLoaded", async () => {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#refreshBtn").addEventListener("click", () => refreshAll());
  $("#searchBox").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

  // Build stage tabs: count on top, title below
  $("#stageTabs").innerHTML = STAGES.map((s, i) =>
    `<button class="tab ${i === 0 ? "active" : ""}" data-stage="${s.id}">
      <span class="big-count" id="cnt_${s.id}">0</span>
      <span class="stage-title">${s.title}</span>
    </button>`
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

async function refreshAll() {
  await refreshPipeline();
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

async function refreshPipeline() {
  try {
    pipelineCache = await callAdmin("pipeline");
    updateStageCounts();
    $("#lastRefreshed").textContent = "Last refreshed " + new Date().toLocaleTimeString();
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
  $("#paneSearch").innerHTML = `<div class="empty">Searching...</div>`;
  try { renderSearch(await callAdmin("search", { query: q })); }
  catch (e) { $("#paneSearch").innerHTML = `<div class="empty"><strong>Error:</strong> ${esc(e.message)}</div>`; }
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
  $("#paneStage").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr>
      <th>Service</th>
      <th>Contact</th>
      <th>Last activity</th>
      <th>Amount</th>
      <th>Actions</th>
      <th style="min-width:170px;">Call status</th>
      <th style="min-width:200px;">Remarks</th>
      <th>Save</th>
    </tr></thead>
    <tbody>${rows.map(rowHtml).join("")}</tbody>
  </table></div>
  <p style="margin:10px 14px;color:#94a3b8;font-size:11px;">Click Save to lock the row. Once saved, status and remarks cannot be edited again.</p>`;

  $("#paneStage").addEventListener("click", onPaneClick);
}

function rowHtml(l) {
  const isLocked = !!l.talk_status; // server-side talk_status set = row is locked
  const phone = (l.mobile || "").replace(/\D/g, "");
  const waPhone = phone.length === 10 ? "91" + phone : phone;
  const waText = encodeURIComponent(`Hi! This is cursive. I see you started ${l.service_name || l.service_type || ""} - quick chat?`);
  const cur = esc(l.customer_key || "");
  const ageHrs = (Date.now() - new Date(l.last_event_at).getTime()) / 3600000;
  const ageStr = ageHrs < 1 ? Math.round(ageHrs * 60) + "m"
              : ageHrs < 24 ? Math.round(ageHrs) + "h"
              : Math.round(ageHrs / 24) + "d";
  const callBtn = phone ? `<a href="tel:+${waPhone}" class="call" data-action="call" data-customer-key="${cur}">Call</a>` : "";
  const waBtn   = phone ? `<a href="https://wa.me/${waPhone}?text=${waText}" target="_blank" rel="noopener" class="whatsapp" data-action="wa" data-customer-key="${cur}">WhatsApp</a>` : "";

  const statusValue = l.talk_status || "";
  const statusOpts = TALK_STATUS_OPTIONS.map(o => `<option value="${o.value}" ${o.value === statusValue ? "selected" : ""}>${esc(o.label)}</option>`).join("");

  const saveBtnHtml = isLocked
    ? `<button class="row-save-btn saved" disabled>Saved</button>`
    : `<button class="row-save-btn" data-action="save" data-customer-key="${cur}">Save</button>`;

  return `<tr class="${l.is_stale ? "stale" : ""} ${isLocked ? "locked" : ""}" data-customer-key="${cur}">
    <td>
      <div style="font-weight:600;">${esc(l.service_name || l.service_type || "-")}</div>
      ${l.is_stale ? `<span class="stale-tag">stale</span>` : ""}
      ${isLocked ? `<span class="locked-tag">saved</span>` : ""}
    </td>
    <td>
      ${l.email ? `<div><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></div>` : ""}
      ${l.mobile ? `<div class="muted-small">${esc(l.mobile)}</div>` : ""}
    </td>
    <td>
      <div>${esc(ageStr)} ago</div>
      <div class="muted-small">${esc(fmtDate(l.last_event_at))} ${esc(fmtTime(l.last_event_at))}</div>
    </td>
    <td class="money">${l.amount ? inr(l.amount) : "-"}</td>
    <td><div class="row-actions">${callBtn}${waBtn}</div></td>
    <td>
      <select class="status-select" data-field="talk_status" data-customer-key="${cur}" ${isLocked ? "disabled" : ""}>${statusOpts}</select>
    </td>
    <td>
      <textarea class="remarks-input" data-field="remarks" data-customer-key="${cur}" placeholder="Notes..." rows="1" ${isLocked ? "disabled" : ""}>${esc(l.remarks || "")}</textarea>
    </td>
    <td>${saveBtnHtml}<div class="row-save-error" style="display:none;"></div></td>
  </tr>`;
}

function onPaneClick(e) {
  const a = e.target.closest("[data-action]");
  if (!a) return;
  const action = a.dataset.action;
  const key = a.dataset.customerKey;
  if (action === "call" || action === "wa") {
    // Admin clicking Call / WhatsApp only opens the link (native href).
    // It does NOT change the lead's pipeline stage — those stages reflect
    // customer behaviour, not operator actions.
    return;
  } else if (action === "save") {
    onSaveRow(a, key);
  }
}

async function onSaveRow(btn, key) {
  const tr = btn.closest("tr");
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

  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    await callAdmin("set_lead_status", { customer_key: key, talk_status, remarks });
    // Update cache
    const idx = pipelineCache.findIndex(x => x.customer_key === key);
    if (idx >= 0) {
      pipelineCache[idx].talk_status = talk_status;
      pipelineCache[idx].remarks = remarks;
    }
    // Lock the row visually
    sel.disabled = true;
    ta.disabled = true;
    btn.textContent = "Saved";
    btn.classList.add("saved");
    tr.classList.add("locked");
    // Add saved tag
    const serviceCell = tr.cells[0];
    if (serviceCell && !serviceCell.querySelector(".locked-tag")) {
      const tag = document.createElement("span");
      tag.className = "locked-tag";
      tag.textContent = "saved";
      tag.style.marginLeft = "6px";
      serviceCell.appendChild(tag);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Save";
    errBox.textContent = "Save failed: " + err.message;
    errBox.style.display = "block";
  }
}

function renderPending(rows) {
  if (!rows.length) return ($("#panePending").innerHTML = `<div class="empty">No pending payments.</div>`);
  $("#panePending").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Started</th><th>Type</th><th>Customer</th><th>Description</th><th>Amount</th><th>Razorpay order</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><div>${fmtDate(r.created_at)}</div><div class="muted-small">${fmtTime(r.created_at)}</div></td>
      <td>${esc(r.type)}</td>
      <td>${r.email ? `<div>${esc(r.email)}</div>` : ""}${r.mobile ? `<div class="muted-small">${esc(r.mobile)}</div>` : ""}</td>
      <td>${esc(r.description || "-")}</td>
      <td class="money">${inr(r.amount)}</td>
      <td><span class="mono">${esc(r.razorpay_order_id || "-")}</span></td>
    </tr>`).join("")}</tbody></table></div>`;
}
function renderInvoices(rows) {
  if (!rows.length) return ($("#paneInvoices").innerHTML = `<div class="empty">No invoices yet.</div>`);
  $("#paneInvoices").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Date</th><th>Invoice #</th><th>Customer</th><th>GST</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Emailed</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td>${fmtDate(r.created_at)}</td>
      <td><span class="mono">${esc(r.invoice_number)}</span></td>
      <td>${esc(r.email || "-")}</td>
      <td>${r.customer_gst_name ? esc(r.customer_gst_name) : "<span class='muted-small'>-</span>"}</td>
      <td class="money">${inr(r.subtotal)}</td>
      <td class="money">${inr(Number(r.cgst) + Number(r.sgst) + Number(r.igst))}</td>
      <td class="money green">${inr(r.total)}</td>
      <td>${r.emailed_at ? "<span style='color:#047857;'>Yes</span>" : "<span class='muted-small'>-</span>"}</td>
    </tr>`).join("")}</tbody></table></div>`;
}
function renderWallets(rows) {
  if (!rows.length) return ($("#paneWallets").innerHTML = `<div class="empty">No wallet activity yet.</div>`);
  $("#paneWallets").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Email</th><th>Mobile</th><th>Balance</th><th>Updated</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td>${esc(r.email)}</td>
      <td>${esc(r.mobile || "-")}</td>
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
function inr(n) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(Number(n || 0)); }
function fmtDate(iso) { if (!iso) return "-"; return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }); }
function fmtTime(iso) { if (!iso) return ""; return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); }
function humanError(err) {
  const msg = (err && err.message) || String(err);
  if (/invalid login credentials/i.test(msg)) return "Email and password don't match.";
  if (/rate limit/i.test(msg)) return "Too many attempts, wait a minute.";
  if (/don't have admin access/i.test(msg)) return "This email isn't on the admin whitelist.";
  return msg;
}
