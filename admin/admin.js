// cursive /admin/ - operator dashboard + pipeline
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
  { id: "pay_started", title: "Payment started", emoji: "🔥", hint: "Recover now" },
  { id: "verified",    title: "Verified — call", emoji: "🟢", hint: "Hot lead" },
  { id: "otp_sent",    title: "OTP sent",        emoji: "🟡", hint: "Awaiting verify" },
  { id: "new",         title: "New lead",        emoji: "🔵", hint: "Just typed details" },
  { id: "callback",    title: "Callback later",  emoji: "📅", hint: "Scheduled by you" },
  { id: "paid",        title: "Paid",            emoji: "✅", hint: "Customer" },
  { id: "lost",        title: "Lost",            emoji: "❌", hint: "Not interested / cold" },
];

let lastFetchByTab = {};
let pipelineCache = [];
let hideStaleByDefault = false;

window.addEventListener("DOMContentLoaded", async () => {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#refreshBtn").addEventListener("click", () => refreshActiveTab(true));
  $("#searchBox").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
  document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

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
  await Promise.all([ refreshSummary(), refreshTab("pipeline") ]);
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["pipeline","leads","pending","completed","invoices","wallets","search"].forEach((t) => {
    const el = document.getElementById("pane" + cap(t));
    if (el) (t === tab ? show : hide)(el);
  });
  if (!lastFetchByTab[tab]) refreshTab(tab);
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function refreshActiveTab(force) {
  const tab = document.querySelector(".tab.active")?.dataset.tab || "pipeline";
  if (force) lastFetchByTab[tab] = null;
  refreshSummary();
  refreshTab(tab);
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

async function refreshSummary() {
  try {
    const s = await callAdmin("summary");
    renderSummary(s);
    $("#lastRefreshed").textContent = "Last refreshed " + new Date().toLocaleTimeString();
  } catch (e) {
    $("#kpiStrip").innerHTML = `<div class="kpi" style="grid-column:1/-1;border-left-color:#dc2626;"><div class="lbl">Admin error</div><div class="val" style="font-size:14px;">${esc(e.message)}</div></div>`;
  }
}

async function refreshTab(tab) {
  try {
    if (tab === "pipeline")    { pipelineCache = await callAdmin("pipeline"); lastFetchByTab.pipeline = pipelineCache; renderPipeline(); }
    if (tab === "leads")       { const d = await callAdmin("leads", { limit: 100 });             lastFetchByTab.leads = d;    renderLeads(d); }
    if (tab === "pending")     { const d = await callAdmin("pending_payments");                   lastFetchByTab.pending = d;  renderPending(d); $("#badgePending").textContent = d.length; }
    if (tab === "completed")   { const d = await callAdmin("completed_payments", { limit: 100 }); lastFetchByTab.completed = d;renderCompleted(d); }
    if (tab === "invoices")    { const d = await callAdmin("invoices",  { limit: 100 });          lastFetchByTab.invoices = d; renderInvoices(d); }
    if (tab === "wallets")     { const d = await callAdmin("wallets");                             lastFetchByTab.wallets = d;  renderWallets(d); }
  } catch (e) {
    const pane = document.getElementById("pane" + cap(tab));
    if (pane) pane.innerHTML = `<div class="empty"><strong>Error:</strong> ${esc(e.message)}</div>`;
  }
}

async function runSearch() {
  const q = $("#searchBox").value.trim();
  if (!q) return;
  document.querySelector('.tab[data-tab="search"]').classList.remove("hidden");
  switchTab("search");
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

function renderPipeline() {
  const filtered = hideStaleByDefault ? pipelineCache.filter(l => !l.is_stale) : pipelineCache;
  const grouped = {};
  STAGES.forEach(s => grouped[s.id] = []);
  filtered.forEach(l => {
    const s = l.stage || "new";
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(l);
  });

  const toolbar = `<div class="pipeline-toolbar">
    <label><input type="checkbox" id="hideStaleChk" ${hideStaleByDefault ? "checked" : ""}> Hide stale (no activity in 3+ days)</label>
    <span style="color:#94a3b8;">${filtered.length} of ${pipelineCache.length} leads shown</span>
  </div>`;

  const cols = STAGES.map(stage => {
    const cards = grouped[stage.id] || [];
    return `
      <div class="kanban-col" data-stage="${stage.id}">
        <div class="kanban-col-head">
          <span class="title">${stage.emoji} ${esc(stage.title)}</span>
          <span class="count">${cards.length}</span>
        </div>
        <div class="kanban-cards">
          ${cards.length === 0 ? `<div class="card-empty">${esc(stage.hint)}</div>` : cards.map(renderCard).join("")}
        </div>
      </div>
    `;
  }).join("");

  $("#panePipeline").innerHTML = toolbar + `<div class="kanban">${cols}</div>`;

  $("#hideStaleChk").addEventListener("change", (e) => {
    hideStaleByDefault = e.target.checked;
    renderPipeline();
  });

  $("#panePipeline").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-set-status]");
    if (!btn) return;
    e.preventDefault();
    const key = btn.dataset.customerKey;
    const status = btn.dataset.setStatus === "clear" ? null : btn.dataset.setStatus;
    btn.disabled = true; btn.textContent = "…";
    try {
      await callAdmin("set_lead_status", { customer_key: key, manual_status: status });
      pipelineCache = pipelineCache.map(l => {
        if (l.customer_key !== key) return l;
        const newStage = status === "won" ? "paid" : status === "callback" ? "callback" : status === "not_interested" ? "lost" : computeAutoStage(l);
        return { ...l, manual_status: status, stage: newStage };
      });
      renderPipeline();
    } catch (err) {
      alert("Could not update: " + err.message);
      btn.disabled = false;
    }
  });
}

function computeAutoStage(l) {
  const e = l.latest_event;
  if (e === "payment_completed" || e === "wallet_recharged" || e === "wallet_debited") return "paid";
  if (e === "payment_initiated") return "pay_started";
  if (e === "otp_verified")      return "verified";
  if (e === "otp_sent")          return "otp_sent";
  if (e === "lead_captured")     return "new";
  return "new";
}

function renderCard(l) {
  const ageHrs = (Date.now() - new Date(l.last_event_at).getTime()) / 3600000;
  const ageStr = ageHrs < 1 ? Math.round(ageHrs * 60) + "m ago"
              : ageHrs < 24 ? Math.round(ageHrs) + "h ago"
              : Math.round(ageHrs / 24) + "d ago";
  const phone = (l.mobile || "").replace(/\D/g, "");
  const waPhone = phone.length === 10 ? "91" + phone : phone;
  const waText  = encodeURIComponent(`Hi! This is cursive. I see you started ${l.service_name || l.service_type} — quick chat?`);
  const cur = l.customer_key || "";

  const phoneRow = phone ? `<a href="tel:+${waPhone}" class="call" title="Call">☎️ ${esc(l.mobile)}</a>` : "";
  const waRow = phone ? `<a href="https://wa.me/${waPhone}?text=${waText}" target="_blank" rel="noopener" class="whatsapp" title="WhatsApp">💬 WhatsApp</a>` : "";

  let statusButtons = "";
  if (l.manual_status) {
    statusButtons = `<button class="status-btn status-clear" data-set-status="clear" data-customer-key="${esc(cur)}" title="Clear manual status">↺ ${esc(l.manual_status)}</button>`;
  } else {
    statusButtons = `<button class="status-btn status-won" data-set-status="won" data-customer-key="${esc(cur)}" title="Won">✓ Won</button>
      <button class="status-btn status-call" data-set-status="callback" data-customer-key="${esc(cur)}" title="Callback">📅 Call later</button>
      <button class="status-btn status-nope" data-set-status="not_interested" data-customer-key="${esc(cur)}" title="Not interested">✕ Not interested</button>`;
  }

  return `<div class="lead-card ${l.is_stale ? "stale" : ""}">
    <div class="row1">
      <span class="service">${esc(l.service_name || l.service_type || "Lead")}</span>
      ${l.is_stale ? `<span class="stale-badge">⏰ stale</span>` : ""}
    </div>
    <div class="contact">
      ${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : ""}
      ${l.mobile && !l.email ? `<span>${esc(l.mobile)}</span>` : ""}
    </div>
    <div class="meta">
      <span>${esc(ageStr)} · ${l.events_count} event${l.events_count > 1 ? "s" : ""}</span>
      ${l.amount ? `<span class="amount">${inr(l.amount)}</span>` : ""}
    </div>
    ${l.manual_notes ? `<div class="notes">${esc(l.manual_notes)}</div>` : ""}
    <div class="actions">${phoneRow}${waRow}${statusButtons}</div>
  </div>`;
}

function renderLeads(rows) {
  if (!rows.length) return ($("#paneLeads").innerHTML = `<div class="empty">No leads yet.</div>`);
  $("#paneLeads").innerHTML = `<div class="std-panel"><div class="table-scroll"><table class="data">
    <thead><tr><th>Last activity</th><th>Latest event</th><th>Service</th><th>Email / mobile</th><th>Amount</th><th>Events</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><div>${fmtDate(r.last_event_at)}</div><div class="muted-small">${fmtTime(r.last_event_at)}</div></td>
      <td><span class="event-pill ${esc(r.latest_event || "")}">${esc(r.latest_event || "—")}</span></td>
      <td><div>${esc(r.service_name || r.service_type || "—")}</div></td>
      <td>${r.email ? `<div>${esc(r.email)}</div>` : ""}${r.mobile ? `<div class="muted-small">${esc(r.mobile)}</div>` : ""}</td>
      <td class="money">${r.amount ? inr(r.amount) : "—"}</td>
      <td><span style="background:#eef2ff;color:#1d4ed8;padding:2px 9px;border-radius:999px;font-weight:700;font-size:11px;">${r.events_count}</span></td>
    </tr>`).join("")}</tbody></table></div></div>`;
}

function renderPending(rows) {
  if (!rows.length) return ($("#panePending").innerHTML = `<div class="empty">No pending payments. 🎉</div>`);
  $("#panePending").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Started</th><th>Type</th><th>Customer</th><th>Description</th><th>Amount</th><th>Razorpay order</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><div>${fmtDate(r.created_at)}</div><div class="muted-small">${fmtTime(r.created_at)}</div></td>
      <td><span class="event-pill ${esc(r.type)}">${esc(r.type)}</span></td>
      <td>${r.email ? `<div>${esc(r.email)}</div>` : ""}${r.mobile ? `<div class="muted-small">${esc(r.mobile)}</div>` : ""}</td>
      <td>${esc(r.description || "—")}</td>
      <td class="money">${inr(r.amount)}</td>
      <td><span class="mono">${esc(r.razorpay_order_id || "—")}</span></td>
    </tr>`).join("")}</tbody></table></div>`;
}

function renderCompleted(rows) {
  if (!rows.length) return ($("#paneCompleted").innerHTML = `<div class="empty">No completed payments yet.</div>`);
  $("#paneCompleted").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>When</th><th>Type</th><th>Customer</th><th>Service</th><th>Amount</th><th>Invoice</th><th>Razorpay payment</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><div>${fmtDate(r.completed_at)}</div><div class="muted-small">${fmtTime(r.completed_at)}</div></td>
      <td><span class="event-pill ${esc(r.type)}">${esc(r.type)}</span></td>
      <td>${esc(r.email || "—")}</td>
      <td>${esc(r.service_name || "—")}</td>
      <td class="money green">${inr(r.amount)}</td>
      <td><span class="mono">${esc(r.invoice_number || "—")}</span></td>
      <td><span class="mono">${esc(r.razorpay_payment_id || "—")}</span></td>
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
  const sec = (title, rows, html) => rows.length ? `<h3 style="margin:18px 14px 8px;font-size:13px;color:#64748b;">${title} (${rows.length})</h3>${html(rows)}` : "";
  if (!d.leads.length && !d.invoices.length && !d.wallets.length && !d.completed.length) {
    $("#paneSearch").innerHTML = `<div class="empty">No results for "<strong>${esc(d.query)}</strong>".</div>`;
    return;
  }
  $("#paneSearch").innerHTML = `
    ${sec("Leads", d.leads, (rows) => `<div class="table-scroll"><table class="data"><tbody>${rows.map(r => `<tr><td>${fmtDate(r.last_event_at || r.created_at)}</td><td><span class="event-pill ${esc(r.latest_event || r.event_type || "")}">${esc(r.latest_event || r.event_type || "")}</span></td><td>${esc(r.service_name || "")}</td><td>${esc(r.email || "")}</td><td>${esc(r.mobile || "")}</td><td class="money">${r.amount ? inr(r.amount) : ""}</td></tr>`).join("")}</tbody></table></div>`)}
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
