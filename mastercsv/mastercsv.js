// cursive /mastercsv/ — admin-only view of public.wt_csv (Watcher dual-write data)
// Reads via Supabase REST; admin-gated by RLS (is_pd_admin()).

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cursive_mastercsv_auth" },
});

const $  = (s) => document.querySelector(s);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

let allRows = [];          // full fetched payload
let activePlatform = "";   // "" = All
let searchTerm = "";
let companyFilter = "";
let dateFrom = "";
let dateTo = "";
let refreshTimer = null;

window.addEventListener("DOMContentLoaded", async () => {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#denySignOut").addEventListener("click", onSignOut);
  $("#refreshBtn").addEventListener("click", () => refreshAll());
  $("#downloadBtn").addEventListener("click", downloadExcel);
  $("#searchBox").addEventListener("input", debounce(() => {
    searchTerm = $("#searchBox").value.trim().toLowerCase();
    renderTable();
  }, 200));
  $("#companyFilter").addEventListener("change", () => {
    companyFilter = $("#companyFilter").value;
    renderTable();
  });
  $("#dateFrom").addEventListener("change", () => { dateFrom = $("#dateFrom").value; renderTable(); });
  $("#dateTo").addEventListener("change",   () => { dateTo   = $("#dateTo").value;   renderTable(); });

  document.querySelectorAll(".platform-tab").forEach((btn) =>
    btn.addEventListener("click", () => switchPlatform(btn.dataset.platform))
  );

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
  hide($("#downloadBtn"));
  allRows = [];
}

async function onAuthed(session) {
  hide($("#loginView"));
  $("#emailChip").textContent = session.user.email;
  show($("#emailChip"));
  show($("#signOutBtn"));

  // Admin gate via is_pd_admin() RPC
  const isAdmin = await checkAdmin();
  if (!isAdmin) {
    show($("#denyView"));
    return;
  }

  show($("#dashView"));
  show($("#downloadBtn"));
  await refreshAll();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshAll, 60_000);
}

async function checkAdmin() {
  // Lightweight check: query analytics_users for current user's tier
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
    // RLS gives admin all rows automatically (admin-select policy)
    // Cap at 10000 rows for performance; admin can refine via filters
    const { data, error } = await sb
      .from("wt_csv")
      .select("id, user_id, company, platform, source_file, download_date, year, month, order_id, raw_row, ingested_by, created_at")
      .order("created_at", { ascending: false })
      .limit(10000);
    if (error) throw error;
    allRows = data || [];
    populateCompanyFilter();
    updateCounts();
    renderTable();
    $("#lastRefreshed").textContent = "Refreshed " + new Date().toLocaleTimeString();
  } catch (err) {
    console.error(err);
    $("#lastRefreshed").textContent = "Refresh failed: " + (err.message || err);
  }
}

function populateCompanyFilter() {
  const cur = $("#companyFilter").value;
  const companies = [...new Set(allRows.map((r) => r.company).filter(Boolean))].sort();
  const sel = $("#companyFilter");
  sel.innerHTML = '<option value="">All companies</option>' +
    companies.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
  if (companies.includes(cur)) sel.value = cur;
}

function updateCounts() {
  const counts = { "": allRows.length, flipkart: 0, amazon: 0, meesho: 0, firstcry: 0, myntra: 0 };
  for (const r of allRows) if (counts[r.platform] !== undefined) counts[r.platform]++;
  $("#cnt_all").textContent      = counts[""].toLocaleString();
  $("#cnt_flipkart").textContent = counts.flipkart.toLocaleString();
  $("#cnt_amazon").textContent   = counts.amazon.toLocaleString();
  $("#cnt_meesho").textContent   = counts.meesho.toLocaleString();
  $("#cnt_firstcry").textContent = counts.firstcry.toLocaleString();
  $("#cnt_myntra").textContent   = counts.myntra.toLocaleString();
}

function switchPlatform(platform) {
  activePlatform = platform || "";
  document.querySelectorAll(".platform-tab").forEach((btn) => {
    btn.classList.toggle("active", (btn.dataset.platform || "") === activePlatform);
  });
  renderTable();
}

function applyFilters() {
  let out = allRows;
  if (activePlatform) out = out.filter((r) => r.platform === activePlatform);
  if (companyFilter)  out = out.filter((r) => r.company === companyFilter);
  if (dateFrom)       out = out.filter((r) => r.download_date && r.download_date >= dateFrom);
  if (dateTo)         out = out.filter((r) => r.download_date && r.download_date <= dateTo);
  if (searchTerm) {
    out = out.filter((r) => {
      const hay = [
        r.company, r.platform, r.source_file, r.order_id,
        r.user_id, r.month, String(r.year || ""),
        JSON.stringify(r.raw_row || ""),
      ].join(" ").toLowerCase();
      return hay.includes(searchTerm);
    });
  }
  return out;
}

function renderTable() {
  const filtered = applyFilters();
  const tbody = $("#rowsBody");
  if (!filtered.length) {
    tbody.innerHTML = "";
    show($("#emptyState"));
    $("#rowCountLabel").textContent = "0 rows";
    $("#customerCountLabel").textContent = "";
    return;
  }
  hide($("#emptyState"));

  const customers = new Set(filtered.map((r) => r.user_id));
  $("#rowCountLabel").textContent = `${filtered.length.toLocaleString()} rows`;
  $("#customerCountLabel").textContent = `${customers.size} customer${customers.size === 1 ? "" : "s"}`;

  // Render up to 2000 rows in DOM for perf
  const slice = filtered.slice(0, 2000);
  tbody.innerHTML = slice.map((r, i) => {
    const rawPreview = Array.isArray(r.raw_row)
      ? r.raw_row.slice(0, 6).map((c) => escapeHTML(String(c)).slice(0, 60)).join(" | ")
      : escapeHTML(JSON.stringify(r.raw_row || "")).slice(0, 240);
    const dt = r.download_date || "";
    const ts = r.created_at ? new Date(r.created_at).toLocaleString() : "";
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHTML(dt)}</td>
        <td>${escapeHTML(r.company || "")}</td>
        <td><span class="platform-badge ${escapeHTML(r.platform || "")}">${escapeHTML(r.platform || "")}</span></td>
        <td>${escapeHTML(r.order_id || "")}</td>
        <td>${escapeHTML(r.source_file || "")}</td>
        <td><span class="user-id-chip" title="${escapeHTML(r.user_id || "")}">${escapeHTML((r.user_id || "").slice(0, 8))}…</span></td>
        <td>${escapeHTML(ts)}</td>
        <td class="raw-preview" title="${escapeHTML(JSON.stringify(r.raw_row || ""))}">${rawPreview}</td>
      </tr>
    `;
  }).join("");

  if (filtered.length > 2000) {
    tbody.insertAdjacentHTML("beforeend", `<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:14px;">Showing first 2,000 of ${filtered.length.toLocaleString()} matching rows. Refine filters to see more or use Download Excel.</td></tr>`);
  }
}

function downloadExcel() {
  const filtered = applyFilters();
  if (!filtered.length) { alert("No rows to download."); return; }

  const headerCols = ["#", "Date", "Year", "Month", "Company", "Platform", "Order ID", "Source file", "User ID", "Ingested", "Raw row JSON"];
  const lines = [headerCols.join(",")];
  filtered.forEach((r, i) => {
    const cells = [
      i + 1,
      r.download_date || "",
      r.year || "",
      r.month || "",
      r.company || "",
      r.platform || "",
      r.order_id || "",
      r.source_file || "",
      r.user_id || "",
      r.created_at || "",
      JSON.stringify(r.raw_row || ""),
    ].map(csvEscape);
    lines.push(cells.join(","));
  });

  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.download = `mastercsv_${activePlatform || "all"}_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
