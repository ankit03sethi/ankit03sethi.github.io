// cursive /admin/ — operator dashboard
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cursive_admin_auth" },
});

const $ = (s) => document.querySelector(s);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

let lastSummary = null;
let lastFetchByTab = {};

// ---- Boot ----
window.addEventListener("DOMContentLoaded", async () => {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#refreshBtn").addEventListener("click", () => refreshActiveTab(true));
  $("#searchBox").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

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
    const el = $("#loginError");
    el.textContent = humanError(err);
    show(el);
  } finally {
    $("#loginBtn").disabled = false; $("#loginBtn").textContent = "Sign in";
  }
}

async function onSignOut() {
  await sb.auth.signOut();
  hide($("#dashView"));
  show($("#loginView"));
  hide($("#emailChip"));
  hide($("#signOutBtn"));
}

async function bootDashboard() {
  hide($("#loginView"));
  show($("#dashView"));
  const { data: { user } } = await sb.auth.getUser();
  $("#emailChip").textContent = user?.email || "";
  show($("#emailChip"));
  show($("#signOutBtn"));

  // Initial loads in parallel
  await Promise.all([
    refreshSummary(),
    refreshTab("leads"),
    refreshTab("pending"),
  ]);
}

// ---- Tab switching ----
function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["leads","pending","completed","invoices","wallets","search"].forEach((t) => {
    const el = document.getElementById("pane" + cap(t));
    if (el) (t === tab ? show : hide)(el);
  });
  if (!lastFetchByTab[tab]) refreshTab(tab);
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function refreshActiveTab(force) {
  const tab = document.querySelector(".tab.active")?.dataset.tab || "leads";
  if (force) lastFetchByTab[tab] = null;
  refreshSummary();
  refreshTab(tab);
}

// ---- Data fetching via admin-data Edge Function ----
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
    lastSummary = await callAdmin("summary");
    renderSummary(lastSummary);
    $("#lastRefreshed").textContent = "Last refreshed " + new Date().toLocaleTimeString();
  } catch (e) {
    renderSummaryError(e);
  }
}

async function refreshTab(tab) {
  try {
    if (tab === "leads")       { const d = await callAdmin("leads", { limit: 100 });              lastFetchByTab.leads = d;    renderLeads(d); $("#badgeLeads").textContent = d.length; }
    if (tab === "pending")     { const d = await callAdmin("pending_payments");                    lastFetchByTab.pending = d;  renderPending(d); $("#badgePending").textContent = d.length; }
    if (tab === "completed")   { const d = await callAdmin("completed_payments", { limit: 100 }); lastFetchByTab.completed = d;renderCompleted(d); }
    if (tab === "invoices")    { const d = await callAdmin("invoices",  { limit: 100 });          lastFetchByTab.invoices = d; renderInvoices(d); }
    if (tab === "wallets")     { const d = await callAdmin("wallets");                             lastFetchByTab.wallets = d;  renderWallets(d); }
  } catch (e) {
    document.getElementById("pane" + cap(tab)).innerHTML = `<div class="empty"><strong>Error:</strong> ${esc(e.message)}</div>`;
  }
}

async function runSearch() {
  const q = $("#searchBox").value.trim();
  if (!q) return;
  document.querySelector('.tab[data-tab="search"]').classList.remove("hidden");
  switchTab("search");
  $("#paneSearch").innerHTML = `<div class="empty">Searching…</div>`;
  try {
    const d = await callAdmin("search", { query: q });
    renderSearch(d);
  } catch (e) {
    $("#paneSearch").innerHTML = `<div class="empty"><strong>Error:</strong> ${esc(e.message)}</div>`;
  }
}

// ---- Renderers ----
function renderSummary(s) {
  const strip = $("#kpiStrip");
  strip.innerHTML = `
    <div class="kpi"><div class="lbl">Leads (7d)</div><div class="val">${num(s.leads_week)}</div><div class="sub">${num(s.leads_total)} all time</div></div>
    <div class="kpi ok"><div class="lbl">Captured (7d)</div><div class="val">${num(s.captured_week)}</div><div class="sub">${num(s.captured_total)} all time</div></div>
    <div class="kpi warn"><div class="lbl">Pending payments</div><div class="val">${num(s.pending_count)}</div><div class="sub">${inr(s.pending_value)} value</div></div>
    <div class="kpi"><div class="lbl">Invoices today</div><div class="val">${inr(s.invoices_today_value)}</div><div class="sub">${num(s.invoices_today_count)} count</div></div>
    <div class="kpi muted"><div class="lbl">Total invoiced</div><div class="val">${inr(s.invoices_total_value)}</div><div class="sub">${num(s.invoices_total_count)} count</div></div>
    <div class="kpi muted"><div class="lbl">Wallet float</div><div class="val">${inr(s.wallets_float)}</div><div class="sub">across all wallets</div></div>
  `;
}
function renderSummaryError(e) {
  $("#kpiStrip").innerHTML = `<div class="kpi" style="grid-column:1/-1;border-left-color:#dc2626;"><div class="lbl">Admin error</div><div class="val" style="font-size:14px;">${esc(e.message)}</div></div>`;
}

function renderLeads(rows) {
  if (!rows.length) return ($("#paneLeads").innerHTML = `<div class="empty">No leads yet.</div>`);
  $("#paneLeads").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Last activity</th><th>Latest event</th><th>Service</th><th>Email / mobile</th><th>Amount</th><th>Events</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr class="lead-row" data-email="${esc(r.email || "")}" data-mobile="${esc(r.mobile || "")}" data-service="${esc(r.service_type || "")}" style="cursor:pointer;">
        <td><div>${fmtDate(r.last_event_at)}</div><div class="muted-small">${fmtTime(r.last_event_at)}${r.first_seen_at && r.first_seen_at !== r.last_event_at ? ` &middot; first seen ${fmtDate(r.first_seen_at)}` : ""}</div></td>
        <td><span class="event-pill ${esc(r.latest_event || "")}">${esc(r.latest_event || "—")}</span></td>
        <td><div>${esc(r.service_name || r.service_type || "—")}</div>${r.latest_description ? `<div class="muted-small">${esc(r.latest_description)}</div>` : ""}</td>
        <td>${r.email ? `<div>${esc(r.email)}</div>` : ""}${r.mobile ? `<div class="muted-small">${esc(r.mobile)}</div>` : ""}</td>
        <td class="money">${r.amount ? inr(r.amount) : "—"}</td>
        <td><span class="muted-small" style="background:#eef2ff;color:#1d4ed8;padding:2px 9px;border-radius:999px;font-weight:700;">${r.events_count}</span></td>
      </tr>`).join("")}</tbody></table></div>
    <p style="margin:12px 16px;color:#94a3b8;font-size:11px;">Tip: click any row to see the full event history for that customer.</p>`;

  // Click-to-expand history
  document.querySelectorAll(".lead-row").forEach((tr) => {
    tr.addEventListener("click", async () => {
      const email = tr.dataset.email;
      const mobile = tr.dataset.mobile;
      const serviceType = tr.dataset.service;
      const next = tr.nextElementSibling;
      if (next && next.classList.contains("history-row")) { next.remove(); return; }
      const histTr = document.createElement("tr");
      histTr.className = "history-row";
      const td = document.createElement("td");
      td.colSpan = 6;
      td.style.cssText = "background:#f0f6ff;padding:14px 20px;";
      td.innerHTML = `<div style="color:#475467;font-size:12px;">Loading history…</div>`;
      histTr.appendChild(td);
      tr.after(histTr);
      try {
        const events = await callAdmin("lead_history", { email, mobile, service_type: serviceType });
        if (!events.length) { td.innerHTML = `<div class="muted-small">No detailed history.</div>`; return; }
        td.innerHTML = `<div style="font-size:12px;color:#0f172a;">
          <strong style="color:#1d4ed8;">${events.length} events for ${esc(email || mobile || "—")} · ${esc(serviceType)}</strong>
          <table class="data" style="margin-top:10px;background:#fff;border-radius:8px;">
            <thead><tr><th>When</th><th>Event</th><th>Channel</th><th>Description</th><th>Amount</th></tr></thead>
            <tbody>${events.map(e => `<tr>
              <td>${fmtDate(e.created_at)} ${fmtTime(e.created_at)}</td>
              <td><span class="event-pill ${esc(e.event_type || "")}">${esc(e.event_type || "")}</span></td>
              <td><span class="muted-small">${esc(e.channel || "")}</span></td>
              <td>${esc(e.description || "")}</td>
              <td class="money">${e.amount ? inr(e.amount) : "—"}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>`;
      } catch (err) {
        td.innerHTML = `<div class="muted-small" style="color:#991b1b;">Error: ${esc(err.message)}</div>`;
      }
    });
  });
}

function renderPending(rows) {
  if (!rows.length) return ($("#panePending").innerHTML = `<div class="empty">No pending payments. 🎉</div>`);
  $("#panePending").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Started</th><th>Type</th><th>Customer</th><th>Description</th><th>Amount</th><th>Razorpay order</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr>
        <td><div>${fmtDate(r.created_at)}</div><div class="muted-small">${fmtTime(r.created_at)}</div></td>
        <td><span class="event-pill ${esc(r.type)}">${esc(r.type)}</span></td>
        <td>${r.email ? `<div>${esc(r.email)}</div>` : ""}${r.mobile ? `<div class="muted-small">${esc(r.mobile)}</div>` : ""}</td>
        <td>${esc(r.description || "—")} ${r.qty > 1 ? `<span class="muted-small">× ${r.qty}</span>` : ""}</td>
        <td class="money">${inr(r.amount)}</td>
        <td><span class="mono">${esc(r.razorpay_order_id || "—")}</span></td>
      </tr>`).join("")}</tbody></table></div>`;
}

function renderCompleted(rows) {
  if (!rows.length) return ($("#paneCompleted").innerHTML = `<div class="empty">No completed payments yet.</div>`);
  $("#paneCompleted").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>When</th><th>Type</th><th>Customer</th><th>Service</th><th>Amount</th><th>Invoice</th><th>Razorpay payment</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr>
        <td><div>${fmtDate(r.completed_at)}</div><div class="muted-small">${fmtTime(r.completed_at)}</div></td>
        <td><span class="event-pill ${esc(r.type)}">${esc(r.type)}</span></td>
        <td>${esc(r.email || "—")}</td>
        <td>${esc(r.service_name || "—")} ${r.qty > 1 ? `<span class="muted-small">× ${r.qty}</span>` : ""}</td>
        <td class="money green">${inr(r.amount)}</td>
        <td><span class="mono">${esc(r.invoice_number || "—")}</span></td>
        <td><span class="mono">${esc(r.razorpay_payment_id || "—")}</span></td>
      </tr>`).join("")}</tbody></table></div>`;
}

function renderInvoices(rows) {
  if (!rows.length) return ($("#paneInvoices").innerHTML = `<div class="empty">No invoices yet.</div>`);
  $("#paneInvoices").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Date</th><th>Invoice #</th><th>Customer</th><th>GST</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Emailed</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr>
        <td>${fmtDate(r.created_at)}</td>
        <td><span class="mono">${esc(r.invoice_number)}</span></td>
        <td>${esc(r.email || "—")}${r.mobile ? `<div class="muted-small">${esc(r.mobile)}</div>` : ""}</td>
        <td>${r.customer_gst_name ? esc(r.customer_gst_name) : "<span class='muted-small'>—</span>"}${r.customer_gst_number ? `<div class="muted-small">${esc(r.customer_gst_number)}</div>` : ""}</td>
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
    <tbody>${rows.map(r => `
      <tr>
        <td>${esc(r.email)}</td>
        <td>${esc(r.mobile || "—")}</td>
        <td class="money ${Number(r.balance) > 0 ? "green" : ""}">${inr(r.balance)}</td>
        <td>${fmtDate(r.updated_at)} <span class="muted-small">${fmtTime(r.updated_at)}</span></td>
      </tr>`).join("")}</tbody></table></div>`;
}

function renderSearch(d) {
  const sec = (title, rows, render) => rows.length ? `<h3 style="margin:18px 14px 8px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">${title} (${rows.length})</h3>${render(rows)}` : "";
  const noResults = !d.leads.length && !d.invoices.length && !d.wallets.length && !d.completed.length;
  if (noResults) {
    $("#paneSearch").innerHTML = `<div 