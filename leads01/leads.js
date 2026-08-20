// cursive /leads/ — 3-bucket pipeline with append-only remarks log
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cursive_admin_auth" },
});

const $ = (s) => document.querySelector(s);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

const NEW_SUBS = [
  { id: "manual_ref",    title: "Reference" },       // manual-add tab (referrals)
  { id: "manual_call",   title: "Call" },            // manual-add tab
  { id: "manual_wa",     title: "WhatsApp" },        // manual-add tab
  { id: "lead_captured", title: "Lead captured" },
  { id: "otp_sent",      title: "OTP sent" },
  { id: "otp_verified",  title: "OTP verified" },
  { id: "callback",      title: "Callback" },
  { id: "click_to_call", title: "Click to Call" },
  { id: "click_to_wa",   title: "Click to WhatsApp" },
  { id: "payment",       title: "Payment" },
];
// Sub-tabs that allow manual add (Add lead button + form)
const MANUAL_ADD_SUBS = new Set(["manual_ref", "manual_call", "manual_wa"]);

const FOLLOW_SUBS = [
  { id: "not_picked",         title: "Call not picked" },
  { id: "callback",           title: "Call me later" },
  { id: "interested",         title: "Interested" },
  { id: "in_progress",        title: "Send Quote" },
  { id: "already_purchased",  title: "Already Purchased" },
  { id: "lost",               title: "Lost" },
  { id: "never_visited",      title: "Never visited" },
  { id: "dont_call_again",    title: "Don't call again" },
  { id: "not_interested",     title: "Not interested" },
  { id: "not_a_lead",         title: "Not A Lead" },
];

const TALK_STATUS_OPTIONS = [
  { value: "",                  label: "— select —" },
  { value: "not_picked",        label: "Call not picked" },
  { value: "callback",          label: "Call me later" },
  { value: "interested",        label: "Interested" },
  { value: "in_progress",       label: "Send Quote" },
  { value: "already_purchased", label: "Already Purchased" },
  { value: "lost",              label: "Lost" },
  { value: "never_visited",     label: "Never visited" },
  { value: "dont_call_again",   label: "Don't call again" },
  { value: "not_interested",    label: "Not interested" },
  { value: "not_a_lead",        label: "Not A Lead" },
  { value: "won_offline",       label: "Won (paid offline)" },
];

// State machine: from each sub-tab, these are the valid next moves.
const STATUS_TRANSITIONS = {
  not_picked:        ["callback", "interested", "in_progress", "already_purchased", "lost", "never_visited", "dont_call_again", "not_interested", "not_a_lead"],
  callback:          ["interested", "in_progress", "already_purchased", "lost", "never_visited", "dont_call_again", "not_interested", "not_a_lead"],
  interested:        ["in_progress", "already_purchased", "lost", "not_a_lead"],
  in_progress:       ["already_purchased", "won_offline", "lost", "not_a_lead"],
  already_purchased: [],
  lost:              [],
  never_visited:     [],
  dont_call_again:   [],
  not_interested:    [],
  not_a_lead:        [],
};
// For New-bucket leads — show ALL Follow-Up statuses so admin can classify from any entry-point tab.
const NEW_BUCKET_STATUS_OPTIONS = [
  "not_picked", "callback", "interested", "in_progress",
  "already_purchased", "lost",
  "never_visited", "dont_call_again", "not_interested", "not_a_lead"
];

let pipelineCache = [];
let activeTop = "new";
let activeSub = "lead_captured";
// Populated in bootDashboard(). _isManager = super || leads. _myEmpCode is the caller's
// employees.code (needed to scope + label). _isEmployeeOnly = employee perm w/out super/leads.
let _isManager = false;
let _isEmployeeOnly = false;
let _myEmpCode = "";
let _myEmpName = "";
let _allEmployeesCache = [];  // [{code, name, is_active}] for reassign dropdown & assignee filter
let assignedFilter = ""; // "" = all, "__none__" = unassigned, else employee code
let remarkFilter = "";      // free-text contains filter
let expandedRows = new Set(); // customer_keys with expanded remark history
let remarksByKey = {};       // cache: customer_key -> [ {remark, created_at, created_by} ]
let starRatingsByKey = {};   // cache: customer_key -> [ {stars, note, created_by, created_at} ] (v2026082020)

// Services that a customer might be asking about — used by the Add-lead form dropdown
// AND the "Filter by service" dropdown on every sub-tab.
const SERVICES = [
  { value: "pd_tracker",        label: "PD Tracker" },
  { value: "analyst",           label: "Cursive Analyst" },
  { value: "business_launcher", label: "Business Launcher" },
  { value: "gst",               label: "GST Registration" },
  { value: "trademark",         label: "Trademark" },
  { value: "udyam",             label: "Udyam (MSME)" },
  { value: "iec",               label: "IEC Code" },
  { value: "platform_account",  label: "Marketplace Setup" },
  { value: "listing",           label: "Listing Service" },
  { value: "imaging",           label: "Product Imaging" },
  { value: "website",           label: "Website Creation" },
  { value: "creators",          label: "Creators" },
  { value: "other",             label: "Other / Not sure" },
];
let serviceFilter = "";  // "" = all; else a service value
let employeeFilter = ""; // "" = all; "__none__" = no-code leads; else employee_code
// v2026082019: Origin filter — "" = All, "direct" = only leads NOT auto-forwarded,
// "forwarded" = only auto-forwarded leads. Applied on Follow Ups, Quotations, Paid tabs.
// Ignored on Add Leads / Unassigned / New Leads (filter UI is hidden there too).
let originFilter = "";

// Cache of the most recently resolved employee name from the add-lead code lookup
let _lastResolvedEmp = { code: "", name: "" };
let _empLookupTimer = null;
// In-flight recommendation request token so old responses don't overwrite newer picks
let _recommendReqSeq = 0;
// Per-service cache for lowest-count-employee recommendations used by the Unassigned tab
// inline assign UI. Value: {code, name} on success, null on empty result, or a Promise
// while a call is in flight — so we hit admin-data at most once per distinct service.
const _recommendCache = new Map();

async function recommendForService(service) {
  if (!service) return null;
  const svc = String(service).toLowerCase();
  if (_recommendCache.has(svc)) {
    const cached = _recommendCache.get(svc);
    if (cached && typeof cached.then === "function") return await cached;
    return cached;
  }
  const p = (async () => {
    try {
      const rec = await callAdmin("recommend_employee_for_lead", { service: svc });
      const val = (rec && rec.code) ? { code: rec.code, name: rec.name || "" } : null;
      _recommendCache.set(svc, val);
      return val;
    } catch (e) {
      _recommendCache.delete(svc);
      return null;
    }
  })();
  _recommendCache.set(svc, p);
  return await p;
}

// Candidates eligible to be assigned this lead: active + sales role + (if service supplied) handles service.
function candidatesForLead(service) {
  const svc = String(service || "").toLowerCase();
  const activeSales = (_allEmployeesCache || []).filter((e) => {
    if (e.is_active === false) return false;
    const roles = Array.isArray(e.roles) ? e.roles : [];
    return roles.includes("sales");
  });
  if (!svc) return activeSales.slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const matched = activeSales.filter((e) => {
    const services = Array.isArray(e.services) ? e.services.map((s) => String(s).toLowerCase()) : [];
    return services.includes(svc);
  });
  // Fallback: if no sales member handles this exact service (e.g. legacy service_type
  // values like 'manual'/'other'), show all active sales so managers can still assign.
  const list = matched.length > 0 ? matched : activeSales;
  return list.slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

function empLabel(e) {
  const services = Array.isArray(e.services) ? e.services.join(", ") : "";
  return `${e.code} — ${e.name || ""}${services ? " · " + services : ""}`.trim();
}

// Per-row employee lookup state for existing (editable) lead rows.
// Keyed by customer_key. Each entry: { code, name, ok (true=resolved), timer }.
const _rowEmpState = {};

// v2026082018: Per-row pending service-add queue. Keyed by customer_key.
// Value: array of service values ("gst", "iec", ...) queued to be added on
// the next Save + Forward click. Nothing here has hit the backend yet — the
// chips render with a dashed "pending" style so the user can see the queue.
const _pendingServiceAdds = {};

// Date-range filter (applies to pipeline + total-paid chip + quotations iframe)
let dateRange = { from: null, to: null, preset: "last30" };  // ISO strings or null

function iso(d) { return d ? new Date(d).toISOString() : null; }
function ymd(d) { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`; }
function computePreset(preset) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (preset === "all")       return { from: null, to: null };
  if (preset === "today")     return { from: iso(startOfToday), to: iso(endOfToday) };
  if (preset === "yesterday") { const y = new Date(startOfToday.getTime() - 86400000); const yEnd = new Date(y.getTime() + 86399999); return { from: iso(y), to: iso(yEnd) }; }
  if (preset === "last7")     return { from: iso(new Date(startOfToday.getTime() - 6 * 86400000)), to: iso(endOfToday) };
  if (preset === "last30")    return { from: iso(new Date(startOfToday.getTime() - 29 * 86400000)), to: iso(endOfToday) };
  if (preset === "thismonth") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(endOfToday) };
  if (preset === "lastmonth") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { from: iso(first), to: iso(last) };
  }
  return { from: null, to: null };
}
function withinRange(iso_ts) {
  if (!iso_ts) return true;
  const t = new Date(iso_ts).getTime();
  if (dateRange.from && t < new Date(dateRange.from).getTime()) return false;
  if (dateRange.to && t > new Date(dateRange.to).getTime()) return false;
  return true;
}
function labelForRange() {
  if (!dateRange.from && !dateRange.to) return "All time";
  const f = dateRange.from ? new Date(dateRange.from).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "…";
  const t = dateRange.to   ? new Date(dateRange.to  ).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "…";
  return f === t ? f : `${f} → ${t}`;
}

window.addEventListener("DOMContentLoaded", async () => {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#refreshBtn").addEventListener("click", () => refreshAll());
  $("#searchBox").addEventListener("keydown", (e) => { if (e.key === "Enter") refreshAll(); });

  document.querySelectorAll(".top-tab").forEach((btn) =>
    btn.addEventListener("click", () => switchTop(btn.dataset.top))
  );

  wireDateRangeHandlers();

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { hide($("#dashView")); show($("#loginView")); return; }

  // RBAC gate — leads pipeline is open to super, leads, quotations, OR employee.
  // (The quote-builder sub-page /leads01/quotations/ enforces 'quotations' or 'super' separately.)
  const { data: perms } = await sb.rpc("current_admin_permissions");
  const list = Array.isArray(perms) ? perms : [];
  const hasSuper = list.includes("super");
  const hasLeads = list.includes("leads");
  const hasQuot = list.includes("quotations");
  const hasEmp = list.includes("employee");
  if (!hasSuper && !hasLeads && !hasQuot && !hasEmp) {
    document.body.innerHTML = `<div style="max-width:520px;margin:60px auto;padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,0.06);font-family:-apple-system,'Segoe UI',Roboto,sans-serif;text-align:center;">
      <h1 style="margin:0 0 10px;font-size:22px;color:#0f172a;">🚫 No access to <b style="color:#1f6feb;">Leads pipeline</b></h1>
      <p style="color:#64748b;font-size:14px;line-height:1.6;">Your admin account doesn't have the <code>leads</code>, <code>quotations</code>, or <code>employee</code> permission. Ask a super-admin in <a href="/admin/users/">/admin/users/</a>.</p>
      <p style="color:#94a3b8;font-size:12px;margin-top:10px;">Your permissions: <code>${list.length ? list.join(", ") : "(none)"}</code></p>
      <a href="/home/" style="display:inline-block;margin-top:14px;padding:10px 22px;background:#1f6feb;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">← Home</a>
    </div>`;
    return;
  }
  _isManager = hasSuper || hasLeads;
  _isEmployeeOnly = hasEmp && !_isManager;
  // Track whether this admin can also access the quote builder — used to hide the "Send Quote" button etc.
  window._canQuotations = hasSuper || hasQuot;

  // If this is an employee-only caller, look up their employees.code + name.
  if (_isEmployeeOnly) {
    try {
      const { data: { user } } = await sb.auth.getUser();
      const em = String(user?.email || "").toLowerCase();
      // Look up via admin-data whoami (server-side) so no direct table access needed
      const who = await callAdmin("whoami").catch(() => null);
      _myEmpCode = who?.employee_code || "";
      _myEmpName = who?.email || em;
      // Auto-redirect processing-only employees to /processing/. Managers stay put.
      const roles = Array.isArray(who?.roles) ? who.roles : [];
      if (!_isManager && roles.includes("processing") && !roles.includes("sales")) {
        location.replace("/processing/");
        return;
      }
    } catch {}
    if (!_myEmpCode) {
      document.body.innerHTML = `<div style="max-width:520px;margin:60px auto;padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;font-family:system-ui;text-align:center;">
        <h1 style="margin:0 0 10px;font-size:20px;">👤 Employee account not linked</h1>
        <p style="color:#64748b;font-size:14px;">Your login has the <code>employee</code> permission, but your email isn't linked to an entry in the Employees directory yet. Ask a super-admin to add you at <a href="/admin/users/">/admin/users/</a>.</p>
      </div>`;
      return;
    }
  }
  bootDashboard();
});

function wireDateRangeHandlers() {
  const preset = $("#dateRangePreset");
  const from = $("#dateFrom");
  const to = $("#dateTo");
  const sep = $("#dateSep");
  const apply = $("#dateApply");
  if (!preset) return;

  // Default = last30
  const def = computePreset("last30");
  dateRange = { from: def.from, to: def.to, preset: "last30" };

  preset.addEventListener("change", async () => {
    const v = preset.value;
    if (v === "custom") {
      from.style.display = "";
      to.style.display = "";
      sep.style.display = "";
      apply.style.display = "";
      const today = new Date();
      const monthAgo = new Date(today.getTime() - 30 * 86400000);
      if (!from.value) from.value = ymd(monthAgo);
      if (!to.value)   to.value   = ymd(today);
      return;
    }
    from.style.display = "none";
    to.style.display = "none";
    sep.style.display = "none";
    apply.style.display = "none";
    const r = computePreset(v);
    dateRange = { from: r.from, to: r.to, preset: v };
    $("#dateActiveRange").textContent = labelForRange();
    await refreshAll();
  });

  apply.addEventListener("click", async () => {
    if (!from.value || !to.value) { alert("Pick both dates"); return; }
    const fromISO = iso(new Date(from.value + "T00:00:00"));
    const toISO = iso(new Date(to.value + "T23:59:59.999"));
    if (new Date(fromISO) > new Date(toISO)) { alert("From date must be before To date"); return; }
    dateRange = { from: fromISO, to: toISO, preset: "custom" };
    $("#dateActiveRange").textContent = labelForRange();
    await refreshAll();
  });
}

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
  $("#emailChip").textContent = _isEmployeeOnly ? `${_myEmpCode}` : "01";
  show($("#emailChip")); show($("#signOutBtn"));
  // Page title: employees see their own dashboard label
  if (_isEmployeeOnly) {
    try {
      const titleEl = document.querySelector("h1.dash-title") || document.querySelector("h1");
      if (titleEl) titleEl.textContent = `My Leads · ${_myEmpCode}${_myEmpName ? " — " + _myEmpName : ""}`;
      document.title = `My Leads · ${_myEmpCode}`;
    } catch {}
  }
  // Unassigned tab is manager-only
  const uTab = document.getElementById("topTabUnassigned");
  if (uTab) uTab.classList.toggle("hidden", !_isManager);
  // Add-leads tab is manager-only (super OR leads perm) — same gate as Unassigned.
  const addTab = document.getElementById("topTabAdd");
  if (addTab) addTab.classList.toggle("hidden", !_isManager);
  // Load the full active-employees list so the Add-Lead form can render its
  // service-filtered "Assigned to" dropdown for both managers AND employees.
  // Managers first try the richer `list` op (needs super/employees perm), then
  // fall back to the lightweight `list_active_employees` op available to any
  // signed-in admin (super/leads/quotations/employee/technical).
  try {
    const token = (await sb.auth.getSession()).data.session.access_token;
    const commonHeaders = { "Content-Type": "application/json", "Authorization": "Bearer " + token, "apikey": SUPABASE_ANON_KEY };
    let loaded = false;
    if (_isManager) {
      try {
        const r = await fetch(SUPABASE_URL + "/functions/v1/admin-employees", {
          method: "POST", headers: commonHeaders, body: JSON.stringify({ op: "list" }),
        });
        const jj = await r.json();
        if (jj?.ok && Array.isArray(jj.employees)) {
          _allEmployeesCache = jj.employees.filter(e => e.is_active);
          loaded = true;
        }
      } catch (e) { console.warn("employees list (manager) failed:", e); }
    }
    if (!loaded) {
      try {
        const r = await fetch(SUPABASE_URL + "/functions/v1/admin-employees", {
          method: "POST", headers: commonHeaders, body: JSON.stringify({ op: "list_active_employees" }),
        });
        const jj = await r.json();
        if (jj?.ok && Array.isArray(jj.employees)) {
          _allEmployeesCache = jj.employees; // already filtered to is_active on server
        }
      } catch (e) { console.warn("list_active_employees failed:", e); }
    }
  } catch (e) { console.warn("employees load failed:", e); }
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

// Look up an employee by code via admin-employees v2 op:"lookup".
// Returns { ok:true, employee:{code,name,is_active} } or { ok:false, error:"not_found" }.
async function callEmployeeLookup(code) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch(SUPABASE_URL + "/functions/v1/admin-employees", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + session.access_token,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ op: "lookup", code }),
  });
  return await res.json().catch(() => ({ ok: false, error: "bad_response" }));
}

async function refreshAll() {
  try {
    pipelineCache = await callAdmin("pipeline");
    $("#lastRefreshed").textContent = "Last refreshed " + new Date().toLocaleTimeString();
    $("#dateActiveRange").textContent = labelForRange();
    updateTopCounts();
    renderActive();
    refreshTotalPaid();
    refreshQuotationsCard();
    // Push date range into quotations iframe (if loaded)
    const f = $("#quotationsFrame");
    if (f && f.contentWindow) {
      try { f.contentWindow.postMessage({ type: "cursive:date-range", from: dateRange.from, to: dateRange.to }, "*"); } catch {}
    }
  } catch (e) {
    $("#paneStage").innerHTML = `<div class="empty"><strong>Error:</strong> ${esc(e.message)}</div>`;
  }
}

async function refreshQuotationsCard() {
  const cntEl = document.getElementById("quotAcceptedCount");
  const totEl = document.getElementById("quotAcceptedTotal");
  const statsWrap = document.getElementById("quotStatsWrap");
  const iconOnly = document.getElementById("quotIconOnly");
  if (!cntEl || !totEl) return;
  // Managers only (super OR leads perm). Employees see the plain 📋 icon.
  if (!_isManager) {
    if (statsWrap) statsWrap.classList.add("hidden");
    if (iconOnly)  iconOnly.classList.remove("hidden");
    return;
  } else {
    if (statsWrap) statsWrap.classList.remove("hidden");
    if (iconOnly)  iconOnly.classList.add("hidden");
  }
  cntEl.textContent = "—";
  totEl.textContent = "—";
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const res = await fetch(SUPABASE_URL + "/functions/v1/admin-quotations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + session.access_token,
        "apikey": SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ op: "list" }),
    });
    const j = await res.json().catch(() => ({}));
    if (!j || !j.ok || !Array.isArray(j.quotations)) return;
    const fromT = dateRange.from ? new Date(dateRange.from).getTime() : null;
    const toT = dateRange.to ? new Date(dateRange.to).getTime() : null;
    let count = 0;
    let totalPaise = 0;
    for (const q of j.quotations) {
      if (q.status !== "accepted") continue;
      const ts = q.created_at || q.updated_at;
      if (ts) {
        const t = new Date(ts).getTime();
        if (fromT !== null && t < fromT) continue;
        if (toT !== null && t > toT) continue;
      }
      if (employeeFilter) {
        if (employeeFilter === "__none__") { if (q.employee_code) continue; }
        else if ((q.employee_code || "") !== employeeFilter) continue;
      }
      count += 1;
      totalPaise += Number(q.total_paise || 0);
    }
    const rupees = Math.round(totalPaise / 100);
    cntEl.textContent = String(count);
    totEl.textContent = "₹" + rupees.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  } catch (e) {
    console.warn("quotations card fetch failed:", e);
  }
}

async function refreshTotalPaid() {
  try {
    const data = await callAdmin("total_paid", { from: dateRange.from, to: dateRange.to });
    const total = Number(data?.total || 0);
    const chip = $("#totalPaidChip");
    if (chip) {
      chip.textContent = "💰 ₹" + total.toLocaleString("en-IN");
      chip.classList.remove("hidden");
      chip.title = `Total paid by customers ${labelForRange()} (${data?.count || 0} payment${data?.count === 1 ? "" : "s"})`;
    }
  } catch (e) {
    console.warn("total_paid fetch failed:", e);
  }
}

// ---------- Bucket logic ----------
function bucketOf(lead) {
  if (["payment_completed","wallet_recharged","wallet_debited"].includes(lead.latest_event)) return "done";
  if (lead.manual_status === "won" || lead.talk_status === "won_offline") return "done";
  if (lead.talk_status && lead.talk_status !== "won_offline") return "follow";
  if (lead.manual_status === "callback") return "follow";
  return "new";
}
function newSubOf(lead) {
  if (lead.manual_status === "manual_ref")  return "manual_ref";
  if (lead.manual_status === "manual_call") return "manual_call";
  if (lead.manual_status === "manual_wa")   return "manual_wa";
  if (lead.manual_status === "callback") return "callback";
  if (lead.manual_status === "clicked_wa") return "click_to_wa";
  if (lead.manual_status === "clicked_call") return "click_to_call";
  if (lead.manual_status === "clicked_pay") return "payment";
  if (lead.latest_event === "payment_initiated") return "payment";
  if (lead.latest_event === "otp_verified")      return "otp_verified";
  if (lead.latest_event === "otp_sent")          return "otp_sent";
  return "lead_captured";
}
function followSubOf(lead) {
  // Quote-sent leads route back to Send Quote (no dedicated tab).
  if (lead.talk_status === "quotation_sent") return "in_progress";
  if (lead.talk_status) return lead.talk_status;
  if (lead.manual_status === "callback") return "callback";
  return "in_progress";
}

function updateTopCounts() {
  // Follow Ups top-card count = only Call not picked + Call me later + Interested
  // (Send Quote and later sub-tabs are past the actionable follow-up stage.)
  const activeFollowSubs = new Set(["not_picked", "callback", "interested"]);
  const counts = { new: 0, follow: 0, done: 0, unassigned: 0 };
  filteredPipeline().forEach((l) => {
    // Cards must be mutually exclusive for managers: an unassigned lead lives
    // in the Unassigned card, NOT double-counted in New/Follow/Done. Employees
    // don't see the Unassigned card and only see their own assigned leads, so
    // for them every lead is countable.
    if (_isManager && !l.assigned_employee_code) return;
    const b = bucketOf(l);
    // v2026082019: Origin filter also constrains the Follow/Done top-tab counts
    // (it's exposed on those tabs, so counts should match what the user will
    // see when they click through). New/Unassigned tabs never expose it, so we
    // don't apply it there.
    if (originFilter && isOriginFilterTab(b)) {
      if (originFilter === "forwarded" && !l.is_forwarded) return;
      if (originFilter === "direct"    &&  l.is_forwarded) return;
    }
    if (b === "follow") {
      if (activeFollowSubs.has(followSubOf(l))) counts.follow += 1;
    } else {
      counts[b] += 1;
    }
  });
  // Unassigned count is manager-only: total leads without an assigned_employee_code.
  // Use the raw pipeline (date-range only, no assignee-filter) so switching the
  // Assigned-to dropdown doesn't zero the Unassigned card.
  if (_isManager) {
    let raw = pipelineCache;
    if (dateRange.from || dateRange.to) raw = raw.filter((l) => withinRange(l.last_event_at));
    if (serviceFilter) raw = raw.filter((l) => (l.service_type || "").toLowerCase() === serviceFilter.toLowerCase());
    raw.forEach((l) => { if (!l.assigned_employee_code) counts.unassigned += 1; });
  }
  $("#topcnt_new").textContent    = counts.new;
  $("#topcnt_follow").textContent = counts.follow;
  $("#topcnt_done").textContent   = counts.done;
  const uEl = $("#topcnt_unassigned"); if (uEl) uEl.textContent = counts.unassigned;
}

// v2026082019: Origin filter is exposed only on Follow Ups / Quotations / Paid.
// Everywhere else (Add / Unassigned / New) the filter is intentionally ignored
// so switching it doesn't shift counts on tabs where it isn't visible.
function isOriginFilterTab(top) {
  return top === "follow" || top === "quotations" || top === "done";
}
function applyOriginFilter(rows) {
  if (!originFilter) return rows;
  if (originFilter === "forwarded") return rows.filter((l) => !!l.is_forwarded);
  if (originFilter === "direct")    return rows.filter((l) => !l.is_forwarded);
  return rows;
}

// Pipeline filtered by active date range (uses last_event_at).
// NOTE: Origin filter is NOT applied here — callers apply it via
// applyOriginFilter() at the point where they know they're rendering rows /
// counting a tab that exposes the Origin filter.
function filteredPipeline() {
  let rows = pipelineCache;
  if (dateRange.from || dateRange.to) rows = rows.filter((l) => withinRange(l.last_event_at));
  if (serviceFilter) rows = rows.filter((l) => (l.service_type || "").toLowerCase() === serviceFilter.toLowerCase());
  if (employeeFilter) {
    if (employeeFilter === "__none__") rows = rows.filter((l) => !l.employee_code);
    else rows = rows.filter((l) => (l.employee_code || "") === employeeFilter);
  }
  // Assigned-to filter (manager only). Employee-only callers are already server-scoped.
  if (_isManager && assignedFilter) {
    if (assignedFilter === "__none__") rows = rows.filter((l) => !l.assigned_employee_code);
    else rows = rows.filter((l) => (l.assigned_employee_code || "") === assignedFilter);
  }
  // v2026082020: sort by max_stars DESC NULLS LAST so priority customers surface
  // first on every tab. Ties fall back to existing pipeline order (last_event_at
  // DESC — that's already how the server returned them, so we keep the stable
  // slice() + sort by max_stars only).
  rows = rows.slice().sort((a, b) => {
    const sa = (a.max_stars == null) ? -1 : Number(a.max_stars);
    const sb = (b.max_stars == null) ? -1 : Number(b.max_stars);
    return sb - sa;
  });
  return rows;
}

// Distinct sorted list of employee codes present in the currently loaded pipeline.
// Returns [{code, name}], sorted by code.
function distinctEmployees() {
  const map = new Map();
  (pipelineCache || []).forEach((l) => {
    if (!l.employee_code) return;
    if (!map.has(l.employee_code)) map.set(l.employee_code, l.employee_name || "");
    else if (!map.get(l.employee_code) && l.employee_name) map.set(l.employee_code, l.employee_name);
  });
  return Array.from(map.entries())
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function switchTop(top) {
  activeTop = top;
  document.querySelectorAll(".top-tab").forEach((b) => b.classList.toggle("active", b.dataset.top === top));

  // Show/hide the correct panel based on tab
  const paneStage = $("#paneStage");
  const paneQuot = $("#paneQuotations");
  const subTabs = $("#subTabs");
  const toolbar = document.querySelector(".toolbar");
  const isEmbedded = top === "quotations";
  const isAddLeads = top === "add";

  paneStage?.classList.toggle("hidden", isEmbedded);
  paneQuot?.classList.toggle("hidden", !isEmbedded);
  if (subTabs) subTabs.style.display = (isEmbedded || isAddLeads) ? "none" : "";
  // Keep the top toolbar (search + refresh + date range) VISIBLE on all tabs
  if (toolbar) toolbar.style.display = "";

  if (top === "quotations") {
    const f = $("#quotationsFrame");
    if (f && (!f.src || f.src === "about:blank" || !f.src.includes("/leads01/quotations"))) f.src = "/leads01/quotations/?v=" + Date.now();
    return;
  }

  if (top === "add") {
    expandedRows.clear();
    remarkFilter = "";
    if (paneStage) {
      paneStage.innerHTML = "";
      renderAddLeadsPanel(paneStage);
    }
    return;
  }

  if (top === "new")    activeSub = "lead_captured";
  if (top === "follow") activeSub = "not_picked";
  if (top === "done")   activeSub = "all";
  if (top === "unassigned") activeSub = "all";
  expandedRows.clear();
  remarkFilter = "";
  $("#paneStage").innerHTML = "";
  renderActive();
}

function renderActive() {
  // The Add-leads top-card renders its own dedicated two-card panel via switchTop("add").
  // Skip the sub-tabs + rows pipeline for it (there are no leads to list).
  if (activeTop === "add") return;
  renderSubTabs();
  renderPane();
}

function renderSubTabs() {
  let subs = [];
  if (activeTop === "new")    subs = NEW_SUBS;
  if (activeTop === "follow") subs = FOLLOW_SUBS;
  if (activeTop === "done")   subs = [{ id: "all", title: "All paid" }];
  if (activeTop === "unassigned") subs = [{ id: "all", title: "All unassigned" }];

  // Managers: New/Follow/Paid tabs must EXCLUDE unassigned leads (those live on Unassigned tab).
  // Employees only see leads assigned to them anyway.
  let inBucket = activeTop === "unassigned"
    ? filteredPipeline().filter((l) => !l.assigned_employee_code)
    : filteredPipeline().filter((l) => bucketOf(l) === activeTop && (!_isManager || !!l.assigned_employee_code));
  // v2026082019: sub-tab counts also honour the Origin filter on tabs that expose it.
  if (isOriginFilterTab(activeTop)) inBucket = applyOriginFilter(inBucket);
  const counts = {};
  subs.forEach((s) => counts[s.id] = 0);
  inBucket.forEach((l) => {
    let k;
    if (activeTop === "new")    k = newSubOf(l);
    if (activeTop === "follow") k = followSubOf(l);
    if (activeTop === "done")   k = "all";
    if (activeTop === "unassigned") k = "all";
    if (k in counts) counts[k] += 1;
  });

  $("#subTabs").innerHTML = subs.map((s) => `
    <button class="sub-tab ${(s.id === activeSub) ? "active" : ""}" data-sub="${esc(s.id)}">
      ${esc(s.title)}<span class="sub-count">${counts[s.id] || 0}</span>
    </button>
  `).join("");

  document.querySelectorAll(".sub-tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      activeSub = btn.dataset.sub;
      expandedRows.clear();
      remarkFilter = ""; // reset per-tab so dropdown/filter refreshes
      renderActive();
    })
  );

  if (!subs.find((s) => s.id === activeSub)) {
    activeSub = subs[0]?.id || "";
    renderSubTabs();
  }
}

function renderPane() {
  // Render the SHELL (toolbar + rows container) only once per tab switch.
  // Filter input changes only re-render the rows, preserving input focus.
  // Add-Lead bar was formerly rendered under New leads' Reference/Call/WhatsApp sub-tabs.
  // It now lives ONLY on the dedicated "Add leads" top-card, so it never renders here.
  const isManualAdd = false;
  const currentBarSub = $("#manualAddBar")?.dataset.sub || "";
  // Rebuild shell if the manual-add state OR the specific sub-tab changed
  const needShell = !$("#filterBar") || !$("#rowsContainer")
    || (isManualAdd && !$("#manualAddBar"))
    || (!isManualAdd && $("#manualAddBar"))
    || (isManualAdd && currentBarSub !== activeSub);
  if (needShell) {
    const manualBarHtml = isManualAdd ? `<div id="manualAddBar" data-sub="${esc(activeSub)}"></div>` : "";
    $("#paneStage").innerHTML = `<div id="filterBar"></div>${manualBarHtml}<div id="rowsContainer"></div>`;
    renderToolbarInto($("#filterBar"));
    wireToolbarHandlers();
    if (isManualAdd) renderManualAddBar($("#manualAddBar"));
  } else {
    // Refresh the dropdown options but DO NOT replace the text input
    renderToolbarDropdownOnly();
  }
  renderRows();
  wireRowHandlers();
  if (activeTop === "unassigned" && _isManager) primeInlineAssignRecommendations();
}

// Enable/disable the Assign button based on whether a service is picked AND
// the auto-picker resolved a valid employee code (stored on dataset.resolvedCode).
// Manager can no longer override the employee — it's purely auto-picked.
function refreshAsnGate(wrap) {
  if (!wrap) return;
  const btn = wrap.querySelector(".asn-inline-btn");
  if (!btn) return;
  const svc = String(wrap.dataset.service || "").trim();
  const resolvedCode = String(wrap.dataset.resolvedCode || "").trim();
  const enable = !!svc && !!resolvedCode;
  btn.disabled = !enable;
  if (enable) {
    btn.style.opacity = "";
    btn.style.cursor = "pointer";
  } else {
    btn.style.opacity = ".4";
    btn.style.cursor = "not-allowed";
  }
}

// Tiny grey "(overriding lead's service: X)" hint under the row's dropdowns — shown only
// when the manager picked a different service than the lead's original service_type.
function updateAsnServiceNote(wrap) {
  if (!wrap) return;
  const note = wrap.querySelector(".asn-inline-svc-note");
  if (!note) return;
  const orig = String(wrap.dataset.originalService || "").trim();
  const picked = String(wrap.dataset.service || "").trim();
  if (picked && orig && picked !== orig) {
    note.textContent = `(overriding lead's service: ${orig})`;
    note.style.color = "#64748b";
  } else {
    note.textContent = "";
  }
}

// Apply a service selection to an inline-assign wrap: update the read-only employee
// display, refresh the override note, refresh the gate, and (unless opts.autoPick === false)
// fetch a recommendation via recommendForService. Stores the resolved code/name on
// wrap.dataset so the Assign button can read it. Guarded so a slow recommendation
// call doesn't overwrite a newer service pick.
function applyServiceToAsnWrap(wrap, svc, opts) {
  opts = opts || {};
  if (!wrap) return;
  const svcLc = String(svc || "").toLowerCase();
  wrap.dataset.service = svcLc;
  wrap.dataset.resolvedCode = "";
  wrap.dataset.resolvedName = "";
  const display = wrap.querySelector(".asn-inline-emp-display");
  const status = wrap.querySelector(".asn-inline-status");
  updateAsnServiceNote(wrap);

  const setDisplay = (text, color) => {
    if (!display) return;
    display.textContent = text;
    display.style.color = color;
  };

  if (!svcLc) {
    setDisplay("— pick a service —", "#64748b");
    if (status) {
      status.textContent = "Pick a service to filter employees.";
      status.style.color = "#991b1b";
    }
    refreshAsnGate(wrap);
    return;
  }

  setDisplay("Finding best fit…", "#64748b");
  if (status) {
    status.textContent = "Finding the sales rep with the fewest open leads…";
    status.style.color = "#64748b";
  }
  refreshAsnGate(wrap);

  if (opts.autoPick === false) return;

  recommendForService(svcLc).then((rec) => {
    // Guard: manager may have changed the service before this resolved.
    if (String(wrap.dataset.service || "").toLowerCase() !== svcLc) return;
    if (!rec || !rec.code) {
      wrap.dataset.resolvedCode = "";
      wrap.dataset.resolvedName = "";
      setDisplay("⚠️ No sales person handles this service", "#991b1b");
      if (status) {
        status.textContent = "No auto-pick available for this service.";
        status.style.color = "#991b1b";
      }
      refreshAsnGate(wrap);
      return;
    }
    wrap.dataset.resolvedCode = rec.code;
    wrap.dataset.resolvedName = rec.name || "";
    setDisplay(`✓ ${rec.code}${rec.name ? " — " + rec.name : ""}`, "#065f46");
    if (status) {
      status.textContent = `✓ Auto-picked ${rec.code}${rec.name ? " — " + rec.name : ""} (fewest open leads).`;
      status.style.color = "#065f46";
    }
    refreshAsnGate(wrap);
  }).catch(() => {
    if (String(wrap.dataset.service || "").toLowerCase() !== svcLc) return;
    wrap.dataset.resolvedCode = "";
    wrap.dataset.resolvedName = "";
    setDisplay("⚠️ Auto-pick failed — try again", "#991b1b");
    if (status) {
      status.textContent = "Auto-pick unavailable — try again.";
      status.style.color = "#991b1b";
    }
    refreshAsnGate(wrap);
  });
}

// After rendering the Unassigned tab, for every row that already has a service pre-selected
// (either the lead's own valid service_type, or one the manager just picked), kick off the
// "lowest open-lead count" recommendation and pre-fill the employee input. Recommendations
// are cached per-service in _recommendCache so N rows with the same service share one RPC.
function primeInlineAssignRecommendations() {
  const wraps = document.querySelectorAll("#rowsContainer .asn-inline");
  wraps.forEach((wrap) => {
    const svc = String(wrap.dataset.service || "").toLowerCase();
    if (!svc) return; // no pre-selected service -> wait for manager to pick one
    applyServiceToAsnWrap(wrap, svc, {});
  });
}

// Manual-add bar: Add lead button + inline form (Reference / Call / WhatsApp sub-tabs)
// --- "Add leads" dedicated top-card panel ---------------------------------
// Two side-by-side cards: single-lead form (Card A) + bulk-add launcher (Card B).
// Card A reuses all the wireManualAddHandlers() logic — the presence of
// #manualAddSource inside the DOM tells that wiring to derive the lead's `type`
// from a picked value instead of from the (removed) sub-tab context.
function renderAddLeadsPanel(el) {
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:16px;padding:12px 0;">
      <!-- Card A: Single lead -->
      <div style="flex:1 1 380px;min-width:320px;background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:18px;">
        <div style="font-size:16px;font-weight:800;color:#065f46;margin-bottom:4px;">&#10133; Add single lead</div>
        <div class="muted-small" style="color:#065f46;opacity:.8;margin-bottom:12px;">Pick the source, fill the customer details, and it lands directly on the matching sub-tab under NEW LEADS.</div>
        <div id="manualAddForm">
          <div style="margin-bottom:8px;">
            <div class="muted-small" style="margin-bottom:3px;">Source *</div>
            <select id="manualAddSource" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;background:#fff;">
              <option value="call" selected>Call</option>
              <option value="ref">Reference</option>
              <option value="wa">WhatsApp</option>
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div><div class="muted-small" style="margin-bottom:3px;">Name (optional)</div><input id="manualAddName" type="text" placeholder="Customer name" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;"/></div>
            <div><div class="muted-small" style="margin-bottom:3px;">Mobile</div><input id="manualAddMobile" type="tel" placeholder="10-digit mobile" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;"/></div>
          </div>
          <div style="margin-top:8px;">
            <div class="muted-small" style="margin-bottom:3px;">Email (optional)</div>
            <input id="manualAddEmail" type="email" placeholder="customer@email.com" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;"/>
          </div>
          <div style="margin-top:8px;">
            <div class="muted-small" style="margin-bottom:3px;">Service *</div>
            <select id="manualAddService" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;background:#fff;">
              <option value="">&mdash; pick service the customer asked for &mdash;</option>
              ${SERVICES.map(s => `<option value="${s.value}">${s.label}</option>`).join("")}
            </select>
          </div>
          <div style="margin-top:8px;">
            <div class="muted-small" style="margin-bottom:3px;">First note (carries through all tabs, never deletes)</div>
            <textarea id="manualAddNote" rows="2" placeholder="e.g. Called about GST registration for a Delhi seller. Callback tomorrow 3 PM." style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;resize:vertical;font-family:inherit;"></textarea>
          </div>
          <div style="margin-top:8px;">
            <div class="muted-small" style="margin-bottom:3px;">Assigned to * <span style="color:#0f172a;">(auto-picked &mdash; not editable)</span> <span style="color:#dc2626;">(cannot be changed later)</span></div>
            <input id="empAssignPicker" type="text" readonly placeholder="Select a service first" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;background:#f8fafc;color:#334155;cursor:not-allowed;pointer-events:none;"/>
            <datalist id="empAssignList"></datalist>
            <div class="muted-small" style="margin-top:4px;color:#64748b;">System auto-picks the sales member handling this service with the fewest open leads (ties broken by earliest join date).</div>
            <div id="empAssignStatus" class="muted-small" style="margin-top:4px;color:#64748b;min-height:16px;">&mdash;</div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button id="manualAddSaveBtn" style="background:#059669;color:#fff;padding:8px 18px;border-radius:6px;font-size:13px;font-weight:700;border:0;cursor:pointer;">Save lead</button>
            <button id="manualAddCancelBtn" style="background:#e5e7eb;color:#111;padding:8px 14px;border-radius:6px;font-size:13px;border:0;cursor:pointer;">Clear</button>
            <div id="manualAddMsg" style="font-size:12.5px;flex:1;min-width:180px;"></div>
          </div>
          <div class="muted-small" style="margin-top:6px;color:#64748b;">Once saved you can't change name/mobile/email/service, but you can keep adding remarks. Form clears after save so you can add another.</div>
        </div>
      </div>

      <!-- Card B: Bulk add -->
      <div style="flex:1 1 380px;min-width:320px;background:#eff6ff;border:2px solid #93c5fd;border-radius:12px;padding:18px;display:flex;flex-direction:column;">
        <div style="font-size:16px;font-weight:800;color:#1e3a8a;margin-bottom:4px;">&#128203; Bulk add many leads</div>
        <div style="color:#1e3a8a;opacity:.85;font-size:13px;line-height:1.55;margin-bottom:14px;">
          Open a spreadsheet-style page to enter multiple leads at once. Each row auto-assigns to the sales person with the fewest open leads for that service.
        </div>
        <ul style="margin:0 0 14px 18px;padding:0;color:#334155;font-size:12.5px;line-height:1.7;">
          <li>Paste rows from Excel or type them one by one.</li>
          <li>Pick the source per row (Reference / Call / WhatsApp).</li>
          <li>Same auto-assign rule as the single-add form.</li>
        </ul>
        <div style="margin-top:auto;">
          <a href="/leads01/bulk-add/" target="_blank" rel="noopener" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none;">&#128203; Open Bulk Add page &rarr;</a>
        </div>
      </div>
    </div>`;
  wireManualAddHandlers();
}

function renderManualAddBar(el) {
  const type = activeSub === "manual_ref" ? "ref" : (activeSub === "manual_call" ? "call" : "wa");
  const label = type === "ref" ? "Reference" : (type === "call" ? "Call" : "WhatsApp");
  el.innerHTML = `
    <div class="manual-add-wrap" style="background:#f0f7ff;border:1px solid #cfe0ff;border-radius:6px;padding:10px 12px;margin:8px 0;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div style="font-size:13px;color:#1e40af;font-weight:600;">
          + Add a lead manually to <b>${label}</b> sub-tab
          <div class="muted-small" style="font-weight:400;margin-top:2px;color:#475569;">Once saved it can't be deleted. Same status options as Lead captured.</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <button id="manualAddOpenBtn" data-type="${type}" style="background:#2563eb;color:#fff;padding:6px 12px;border-radius:4px;font-size:12.5px;font-weight:700;border:0;cursor:pointer;">+ Add lead</button>
          <a href="/leads01/bulk-add/" target="_blank" rel="noopener" style="background:#0f766e;color:#fff;padding:6px 12px;border-radius:4px;font-size:12.5px;font-weight:700;text-decoration:none;display:inline-block;">📋 Bulk add</a>
        </div>
      </div>
      <div id="manualAddForm" class="hidden" style="margin-top:10px;padding-top:10px;border-top:1px dashed #cfe0ff;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
          <div><div class="muted-small" style="margin-bottom:3px;">Name (optional)</div><input id="manualAddName" type="text" placeholder="Customer name" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;"/></div>
          <div><div class="muted-small" style="margin-bottom:3px;">Mobile</div><input id="manualAddMobile" type="tel" placeholder="10-digit mobile" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;"/></div>
          <div><div class="muted-small" style="margin-bottom:3px;">Email (optional)</div><input id="manualAddEmail" type="email" placeholder="customer@email.com" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;"/></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-top:8px;">
          <div><div class="muted-small" style="margin-bottom:3px;">Service *</div>
            <select id="manualAddService" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;background:#fff;">
              <option value="">— pick service the customer asked for —</option>
              ${SERVICES.map(s => `<option value="${s.value}">${s.label}</option>`).join("")}
            </select>
          </div>
          <div><div class="muted-small" style="margin-bottom:3px;">First note (carries through all tabs, never deletes)</div>
            <textarea id="manualAddNote" rows="2" placeholder="e.g. Called about GST registration for a Delhi seller. Callback tomorrow 3 PM." style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;resize:vertical;font-family:inherit;"></textarea>
          </div>
        </div>
        <div style="margin-top:8px;">
          <div class="muted-small" style="margin-bottom:3px;">Assigned to * <span style="color:#0f172a;">(auto-picked — not editable)</span> <span style="color:#dc2626;">(cannot be changed later)</span></div>
          <input id="empAssignPicker" type="text" readonly placeholder="Select a service first" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;background:#f8fafc;color:#334155;cursor:not-allowed;pointer-events:none;"/>
          <datalist id="empAssignList"></datalist>
          <div class="muted-small" style="margin-top:4px;color:#64748b;">System auto-picks the sales team member handling this service with the fewest open leads (ties broken by earliest join date). Non-editable.</div>
          <div id="empAssignStatus" class="muted-small" style="margin-top:4px;color:#64748b;min-height:16px;">—</div>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
          <button id="manualAddSaveBtn" data-type="${type}" style="background:#059669;color:#fff;padding:6px 14px;border-radius:4px;font-size:12.5px;font-weight:700;border:0;cursor:pointer;">Save lead</button>
          <button id="manualAddCancelBtn" style="background:#e5e7eb;color:#111;padding:6px 12px;border-radius:4px;font-size:12.5px;border:0;cursor:pointer;">Cancel</button>
          <div id="manualAddMsg" style="font-size:12px;flex:1;"></div>
        </div>
        <div class="muted-small" style="margin-top:6px;color:#64748b;">Once saved you can't change name/mobile/email/service, but you can keep adding remarks. Note + remarks carry over to Follow Ups &amp; every subsequent tab.</div>
      </div>
    </div>`;
  wireManualAddHandlers();
}

function wireManualAddHandlers() {
  const openBtn = $("#manualAddOpenBtn");
  const form = $("#manualAddForm");
  const saveBtn = $("#manualAddSaveBtn");
  const cancelBtn = $("#manualAddCancelBtn");
  const msg = $("#manualAddMsg");
  const sourceSel = $("#manualAddSource"); // present only on the "Add leads" top-card panel
  if (!saveBtn) return;
  // isAddPanel = the always-open two-card panel. When false we're in the legacy
  // (now-unused) sub-tab variant that still uses an openBtn / hide-on-cancel toggle.
  const isAddPanel = !!sourceSel;

  const svcSel = $("#manualAddService");
  const empPicker = $("#empAssignPicker");
  const empList = $("#empAssignList");
  const empStatus = $("#empAssignStatus");

  const setEmpStatus = (text, tone) => {
    if (!empStatus) return;
    empStatus.textContent = text || "";
    if (tone === "ok")   { empStatus.style.color = "#065f46"; }
    else if (tone === "err") { empStatus.style.color = "#991b1b"; }
    else                 { empStatus.style.color = "#64748b"; }
  };

  const resetEmpPicker = (placeholder) => {
    if (empPicker) {
      empPicker.value = "";
      empPicker.disabled = true;
      empPicker.placeholder = placeholder || "Select a service first";
    }
    if (empList) empList.innerHTML = "";
    _lastResolvedEmp = { code: "", name: "" };
    setEmpStatus("—", "muted");
    refreshManualSaveGate();
  };

  // Employees eligible for the currently-selected service (sales role + service capability + active).
  const candidatesForService = (service) => {
    if (!service) return [];
    return (_allEmployeesCache || []).filter((e) => {
      if (e.is_active === false) return false;
      const roles = Array.isArray(e.roles) ? e.roles : [];
      const services = Array.isArray(e.services) ? e.services : [];
      return roles.includes("sales") && services.includes(service);
    }).slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));
  };

  const fillDatalist = (candidates) => {
    if (!empList) return;
    empList.innerHTML = candidates.map((e) => {
      const services = Array.isArray(e.services) ? e.services.join(", ") : "";
      const label = `${e.code} — ${e.name || ""}${services ? " · " + services : ""}`;
      return `<option value="${esc(label)}"></option>`;
    }).join("");
  };

  const findByLabelOrCode = (raw, candidates) => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return null;
    // Try "CODE — NAME · services" -> extract CODE before " — "
    const codeGuess = trimmed.split(/[\s—\-·]/)[0].trim().toUpperCase();
    let hit = candidates.find((e) => e.code === codeGuess);
    if (hit) return hit;
    // Fall back to case-insensitive contains / exact-label match
    const upper = trimmed.toUpperCase();
    hit = candidates.find((e) => (e.code || "").toUpperCase() === upper);
    if (hit) return hit;
    hit = candidates.find((e) => {
      const services = Array.isArray(e.services) ? e.services.join(", ") : "";
      const label = `${e.code} — ${e.name || ""}${services ? " · " + services : ""}`;
      return label.toUpperCase() === upper;
    });
    return hit || null;
  };

  // --- Mobile 10-digit validation -----------------------------------------
  const mobileInput = $("#manualAddMobile");
  const ensureMobileErrEl = () => {
    if (!mobileInput) return null;
    let err = document.getElementById("manualAddMobileErr");
    if (!err) {
      err = document.createElement("div");
      err.id = "manualAddMobileErr";
      err.className = "muted-small";
      err.style.color = "#dc2626";
      err.style.marginTop = "3px";
      err.style.fontSize = "11.5px";
      err.style.display = "none";
      mobileInput.parentNode && mobileInput.parentNode.appendChild(err);
    }
    return err;
  };
  const isMobileValid = () => {
    const digits = ((mobileInput?.value || "")).replace(/\D/g, "");
    return digits.length === 10;
  };
  const setMobileInvalidUI = (invalid) => {
    if (!mobileInput) return;
    const err = ensureMobileErrEl();
    if (invalid) {
      mobileInput.classList.add("invalid");
      mobileInput.style.border = "1px solid #dc2626";
      mobileInput.style.background = "#fef2f2";
      if (err) { err.textContent = "Mobile must be exactly 10 digits"; err.style.display = "block"; }
    } else {
      mobileInput.classList.remove("invalid");
      mobileInput.style.border = "1px solid #cbd5e1";
      mobileInput.style.background = "";
      if (err) { err.textContent = ""; err.style.display = "none"; }
    }
  };
  if (mobileInput) {
    mobileInput.addEventListener("input", () => {
      // Only show red once the user has typed something; empty stays neutral until blur.
      const raw = mobileInput.value || "";
      if (!raw) { setMobileInvalidUI(false); }
      else setMobileInvalidUI(!isMobileValid());
      refreshManualSaveGate();
    });
    mobileInput.addEventListener("blur", () => {
      setMobileInvalidUI(!isMobileValid());
      refreshManualSaveGate();
    });
  }

  const refreshManualSaveGate = () => {
    if (!saveBtn) return;
    const service = ($("#manualAddService")?.value || "").trim();
    const empOk = !!(_lastResolvedEmp && _lastResolvedEmp.code);
    const mobileOk = isMobileValid();
    const enabled = !!service && empOk && mobileOk;
    saveBtn.disabled = !enabled;
    saveBtn.style.opacity = enabled ? "" : ".4";
    saveBtn.style.cursor = enabled ? "" : "not-allowed";
    saveBtn.style.pointerEvents = enabled ? "" : "none";
  };

  if (openBtn) {
    openBtn.onclick = () => {
      if (form) form.classList.remove("hidden");
      openBtn.style.display = "none";
      $("#manualAddMobile")?.focus();
      msg.textContent = ""; msg.style.color = "";
      refreshManualSaveGate();
    };
  }
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      ["manualAddName","manualAddMobile","manualAddEmail","manualAddService","manualAddNote"].forEach(id => { const el = $("#"+id); if (el) el.value = ""; });
      setMobileInvalidUI(false);
      resetEmpPicker("Select a service first");
      msg.textContent = "";
      // Legacy sub-tab variant: collapse the form back behind the open button.
      // Add-panel variant: form is always open, so leave it visible.
      if (openBtn && form) {
        form.classList.add("hidden");
        openBtn.style.display = "";
      }
    };
  }

  // Service change -> repopulate datalist, kick off recommendation
  if (svcSel) {
    svcSel.addEventListener("change", async () => {
      const service = (svcSel.value || "").trim();
      _lastResolvedEmp = { code: "", name: "" };
      if (!service) {
        resetEmpPicker("Select a service first");
        return;
      }
      const candidates = candidatesForService(service);
      fillDatalist(candidates);
      if (empPicker) {
        empPicker.disabled = candidates.length === 0;
        empPicker.value = "";
        empPicker.placeholder = candidates.length === 0
          ? "No sales employee handles this service yet"
          : "Type or pick — e.g. PR3471 — Alice";
      }
      if (candidates.length === 0) {
        setEmpStatus("No active sales employee handles this service yet.", "err");
        refreshManualSaveGate();
        return;
      }
      setEmpStatus("Finding the sales rep with the fewest open leads…", "muted");
      refreshManualSaveGate();
      const mySeq = ++_recommendReqSeq;
      try {
        const rec = await callAdmin("recommend_employee_for_lead", { service });
        if (mySeq !== _recommendReqSeq) return; // stale
        let picked = null;
        if (rec && rec.code) {
          picked = candidates.find((e) => e.code === rec.code) || { code: rec.code, name: rec.name || "" };
        }
        if (!picked) picked = candidates[0]; // safety fallback
        _lastResolvedEmp = { code: picked.code, name: picked.name || "" };
        if (empPicker) {
          const services = Array.isArray(picked.services) ? picked.services.join(", ") : "";
          empPicker.value = `${picked.code} — ${picked.name || ""}${services ? " · " + services : ""}`.trim();
        }
        setEmpStatus(`✓ Auto-picked ${picked.code}${picked.name ? " — " + picked.name : ""} (fewest open leads). Change if needed.`, "ok");
      } catch (err) {
        if (mySeq !== _recommendReqSeq) return;
        const picked = candidates[0];
        _lastResolvedEmp = { code: picked.code, name: picked.name || "" };
        if (empPicker) {
          const services = Array.isArray(picked.services) ? picked.services.join(", ") : "";
          empPicker.value = `${picked.code} — ${picked.name || ""}${services ? " · " + services : ""}`.trim();
        }
        setEmpStatus(`⚠ Auto-pick failed (${err.message}). Falling back to ${picked.code}. Pick anyone from the list.`, "err");
      }
      refreshManualSaveGate();
    });
  }

  // Datalist / free-text picker: resolve to a candidate on every change
  if (empPicker) {
    const onPickerChange = () => {
      const service = ($("#manualAddService")?.value || "").trim();
      const candidates = candidatesForService(service);
      const hit = findByLabelOrCode(empPicker.value, candidates);
      if (hit) {
        _lastResolvedEmp = { code: hit.code, name: hit.name || "" };
        const services = Array.isArray(hit.services) ? hit.services.join(", ") : "";
        empPicker.value = `${hit.code} — ${hit.name || ""}${services ? " · " + services : ""}`.trim();
        setEmpStatus(`✓ Assigned to ${hit.code}${hit.name ? " — " + hit.name : ""}`, "ok");
      } else {
        _lastResolvedEmp = { code: "", name: "" };
        setEmpStatus("✗ Pick someone from the dropdown (only sales members who handle this service are listed).", "err");
      }
      refreshManualSaveGate();
    };
    empPicker.addEventListener("change", onPickerChange);
    empPicker.addEventListener("input", () => {
      // Live re-check as they type / pick from datalist
      const service = ($("#manualAddService")?.value || "").trim();
      const candidates = candidatesForService(service);
      const hit = findByLabelOrCode(empPicker.value, candidates);
      if (hit) {
        _lastResolvedEmp = { code: hit.code, name: hit.name || "" };
        setEmpStatus(`✓ Assigned to ${hit.code}${hit.name ? " — " + hit.name : ""}`, "ok");
      } else {
        _lastResolvedEmp = { code: "", name: "" };
        setEmpStatus(empPicker.value ? "Keep typing / pick from the list…" : "—", "muted");
      }
      refreshManualSaveGate();
    });
  }

  saveBtn.onclick = async () => {
    // Type source:
    //   - Add-leads top-card panel: picked from #manualAddSource dropdown
    //   - Legacy sub-tab bar: baked into saveBtn.dataset.type from the sub-tab id
    const type = sourceSel ? (sourceSel.value || "call") : saveBtn.dataset.type;
    const name = ($("#manualAddName").value || "").trim();
    const mobile = ($("#manualAddMobile").value || "").replace(/\D/g, "");
    const email = ($("#manualAddEmail").value || "").trim().toLowerCase();
    const service = ($("#manualAddService").value || "").trim();
    const note = ($("#manualAddNote").value || "").trim();
    const empCode = (_lastResolvedEmp && _lastResolvedEmp.code) || "";
    msg.textContent = ""; msg.style.color = "";
    if (mobile.length !== 10) {
      setMobileInvalidUI(true);
      msg.style.color = "#dc2626"; msg.textContent = "Mobile must be exactly 10 digits.";
      mobileInput && mobileInput.focus();
      return;
    }
    if (!service) {
      msg.style.color = "#dc2626"; msg.textContent = "Pick which service the customer asked about.";
      return;
    }
    if (!empCode) {
      msg.style.color = "#dc2626";
      msg.textContent = "Pick an assignee from the dropdown — this cannot be changed later.";
      if (empPicker) empPicker.focus();
      return;
    }
    saveBtn.disabled = true; saveBtn.textContent = "Saving...";
    try {
      const res = await callAdmin("add_manual_lead", { type, name, mobile, email, service, note, employee_code: empCode, employee_name: _lastResolvedEmp.name || "" });
      let dupMsg = "";
      if (res.duplicates && res.duplicates.length > 0) {
        const list = res.duplicates.slice(0, 3).map(d => `${d.service_name || d.service_type} (${d.email || d.mobile})`).join(", ");
        dupMsg = ` Already exists in: ${list}`;
      }
      const subLabel = type === "ref" ? "Reference" : (type === "wa" ? "WhatsApp" : "Call");
      msg.style.color = "#059669";
      msg.textContent = `✓ Saved — visible on NEW LEADS → ${subLabel}.` + dupMsg;
      ["manualAddName","manualAddMobile","manualAddEmail","manualAddService","manualAddNote"].forEach(id => { const el = $("#"+id); if (el) el.value = ""; });
      setMobileInvalidUI(false);
      // Keep the Source selection on the Add-panel so the user can rapidly add another lead
      // of the same type without re-picking. Reset employee picker for the next entry.
      resetEmpPicker("Select a service first");
      saveBtn.disabled = false; saveBtn.textContent = "Save lead";
      pipelineCache = await callAdmin("pipeline");
      updateTopCounts();
      renderActive();
    } catch (err) {
      msg.style.color = "#dc2626"; msg.textContent = "Save failed: " + err.message;
      saveBtn.disabled = false; saveBtn.textContent = "Save lead";
    }
  };

  // Initial gate — disabled until service + employee are chosen.
  refreshManualSaveGate();
}

function renderRows() {
  // Managers: New/Follow/Paid tabs must EXCLUDE unassigned leads (those live on Unassigned tab).
  // Employees only see leads assigned to them anyway.
  let inBucket = activeTop === "unassigned"
    ? filteredPipeline().filter((l) => !l.assigned_employee_code)
    : filteredPipeline().filter((l) => bucketOf(l) === activeTop && (!_isManager || !!l.assigned_employee_code));
  // v2026082019: Origin filter — only meaningful on Follow / Quotations / Paid.
  if (isOriginFilterTab(activeTop)) inBucket = applyOriginFilter(inBucket);
  let rows;
  if (activeTop === "new")    rows = inBucket.filter((l) => newSubOf(l) === activeSub);
  if (activeTop === "follow") rows = inBucket.filter((l) => followSubOf(l) === activeSub);
  if (activeTop === "done")   rows = inBucket;
  if (activeTop === "unassigned") rows = inBucket;

  const qq = (remarkFilter || "").trim().toLowerCase();
  if (qq) rows = rows.filter((l) =>
    (l.remarks || "").toLowerCase().includes(qq) ||
    (l.latest_remark_header || "").toLowerCase().includes(qq)
  );

  const searchTerm = ($("#searchBox")?.value || "").trim().toLowerCase();
  if (searchTerm) {
    rows = rows.filter((l) =>
      (l.email || "").toLowerCase().includes(searchTerm) ||
      (l.alt_email || "").toLowerCase().includes(searchTerm) ||
      (l.mobile || "").toLowerCase().includes(searchTerm) ||
      (l.alt_mobile || "").toLowerCase().includes(searchTerm) ||
      (l.whatsapp || "").toLowerCase().includes(searchTerm) ||
      (l.service_name || "").toLowerCase().includes(searchTerm) ||
      (l.service_type || "").toLowerCase().includes(searchTerm) ||
      (l.remarks || "").toLowerCase().includes(searchTerm) ||
      (l.latest_remark_header || "").toLowerCase().includes(searchTerm)
    );
  }

  $("#rowsContainer").innerHTML = rows.length
    ? renderTable(rows, activeTop === "done")
    : `<div class="empty">No leads in this view${qq ? ` matching remark "${esc(qq)}"` : ""}.</div>`;
}

function buildRemarkOptions() {
  // Only leads in the CURRENT sub-tab, and show only the LATEST remark HEADER per customer.
  const rows = leadsInCurrentSubTab();
  const seen = new Map(); // customer_key -> latest header (or first line of remark)
  rows.forEach((l) => {
    const cur = l.customer_key;
    if (seen.has(cur)) return;
    const h = (l.latest_remark_header || "").trim() || (l.remarks || "").split("\n")[0].trim();
    if (h) seen.set(cur, h);
  });
  const counts = new Map();
  seen.forEach((h) => counts.set(h, (counts.get(h) || 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([txt, cnt]) => `<option value="${esc(txt)}" ${txt === remarkFilter ? "selected" : ""}>${esc(txt.slice(0, 60))} (${cnt})</option>`)
    .join("");
}

// All leads currently visible in the active sub-tab (matches renderRows() logic minus filters)
function leadsInCurrentSubTab() {
  // Managers: New/Follow/Paid tabs must EXCLUDE unassigned leads (those live on Unassigned tab).
  // Employees only see leads assigned to them anyway.
  let inBucket = activeTop === "unassigned"
    ? filteredPipeline().filter((l) => !l.assigned_employee_code)
    : filteredPipeline().filter((l) => bucketOf(l) === activeTop && (!_isManager || !!l.assigned_employee_code));
  // v2026082019: Origin filter on tabs that expose it.
  if (isOriginFilterTab(activeTop)) inBucket = applyOriginFilter(inBucket);
  if (activeTop === "new")    return inBucket.filter((l) => newSubOf(l) === activeSub);
  if (activeTop === "follow") return inBucket.filter((l) => followSubOf(l) === activeSub);
  return inBucket;
}

function renderToolbarInto(el) {
  el.innerHTML = `<div class="filter-bar" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;">
    <span class="filter-lbl">Filter by remark:</span>
    <input id="remarkFilterText" type="text" class="remark-filter-input" placeholder="Type to filter..." value="${esc(remarkFilter)}" />
    <select id="remarkFilterSelect" class="remark-filter-select">
      <option value="">All remarks</option>
      ${buildRemarkOptions()}
    </select>
    <button id="remarkFilterClear" class="remark-filter-clear" style="display:${remarkFilter ? "inline-block" : "none"};">Clear</button>

    <span class="filter-lbl" style="margin-left:12px;">Service:</span>
    <select id="serviceFilterSelect" class="remark-filter-select">
      <option value="">All services</option>
      ${SERVICES.map(s => `<option value="${s.value}" ${s.value === serviceFilter ? "selected" : ""}>${s.label}</option>`).join("")}
    </select>
    <button id="serviceFilterClear" class="remark-filter-clear" style="display:${serviceFilter ? "inline-block" : "none"};">Clear service</button>

    <!-- 'Emp:' (lead creator) filter removed — redundant with 'Assigned to' since auto-assign makes them the same on manual leads. -->

    ${_isManager ? `
    <span class="filter-lbl" style="margin-left:12px;">Assigned to:</span>
    <select id="assignedFilterSelect" class="remark-filter-select">
      ${buildAssignedFilterOptions()}
    </select>
    <button id="assignedFilterClear" class="remark-filter-clear" style="display:${assignedFilter ? "inline-block" : "none"};">Clear</button>
    ` : ""}

    ${isOriginFilterTab(activeTop) ? `
    <span class="filter-lbl" style="margin-left:12px;" title="Filter by whether the lead was auto-forwarded from another service">Origin:</span>
    <select id="originFilterSelect" class="remark-filter-select" title="Only affects Follow Ups, Quotations and Paid tabs">
      <option value=""          ${originFilter === ""          ? "selected" : ""}>All</option>
      <option value="direct"    ${originFilter === "direct"    ? "selected" : ""}>Direct only</option>
      <option value="forwarded" ${originFilter === "forwarded" ? "selected" : ""}>Forwarded only</option>
    </select>
    <button id="originFilterClear" class="remark-filter-clear" style="display:${originFilter ? "inline-block" : "none"};">Clear origin</button>
    ` : ""}

    ${(_isManager && activeTop === "unassigned") ? `
    <div style="flex-basis:100%;height:0;"></div>
    <div id="bulkAssignWrap" style="width:100%;margin-top:6px;padding:10px 12px;background:#fef9c3;border:1px solid #fde68a;border-radius:6px;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <button id="bulkAssignRun" style="padding:6px 14px;background:#0284c7;color:#fff;border:0;border-radius:5px;font-size:12.5px;font-weight:700;cursor:pointer;">📌 Assign all visible</button>
        <span class="muted-small" style="font-size:11.5px;color:#92400e;">Uses the Service + Employee already picked in each row. Rows missing either are skipped — assign those one-by-one after filling.</span>
        <div id="bulkAssignStatus" class="muted-small" style="width:100%;font-size:12px;color:#64748b;margin-top:2px;"></div>
      </div>
    </div>
    ` : ""}
  </div>`;
}

function buildAssignedFilterOptions() {
  const opts = [
    `<option value="" ${assignedFilter === "" ? "selected" : ""}>All</option>`,
    `<option value="__none__" ${assignedFilter === "__none__" ? "selected" : ""}>Unassigned</option>`,
  ];
  (_allEmployeesCache || []).forEach((e) => {
    const label = `${e.code}${e.name ? " — " + e.name : ""}`;
    opts.push(`<option value="${esc(e.code)}" ${e.code === assignedFilter ? "selected" : ""}>${esc(label)}</option>`);
  });
  return opts.join("");
}

function buildEmployeeFilterOptions() {
  const emps = distinctEmployees();
  const opts = [
    `<option value="" ${employeeFilter === "" ? "selected" : ""}>All employees</option>`,
    `<option value="__none__" ${employeeFilter === "__none__" ? "selected" : ""}>(no code)</option>`,
  ];
  emps.forEach((e) => {
    const label = e.name ? `${e.code} — ${e.name}` : e.code;
    opts.push(`<option value="${esc(e.code)}" ${e.code === employeeFilter ? "selected" : ""}>${esc(label)}</option>`);
  });
  return opts.join("");
}

function renderToolbarDropdownOnly() {
  // Refresh the dropdown options on data change without touching the input
  const sel = $("#remarkFilterSelect");
  if (sel) sel.innerHTML = `<option value="">All remarks</option>` + buildRemarkOptions();
  const clear = $("#remarkFilterClear");
  if (clear) clear.style.display = remarkFilter ? "inline-block" : "none";
  const empSel = $("#employeeFilterSelect");
  if (empSel) empSel.innerHTML = buildEmployeeFilterOptions();
  const empClear = $("#employeeFilterClear");
  if (empClear) empClear.style.display = employeeFilter ? "inline-block" : "none";
}

function wireToolbarHandlers() {
  const txt = $("#remarkFilterText");
  if (txt) {
    txt.addEventListener("input", (e) => {
      remarkFilter = e.target.value;
      renderRows();
      const clear = $("#remarkFilterClear");
      if (clear) clear.style.display = remarkFilter ? "inline-block" : "none";
    });
  }
  const sel = $("#remarkFilterSelect");
  if (sel) {
    sel.addEventListener("change", (e) => {
      remarkFilter = e.target.value;
      const txtIn = $("#remarkFilterText");
      if (txtIn) txtIn.value = remarkFilter;
      renderRows();
      const clear = $("#remarkFilterClear");
      if (clear) clear.style.display = remarkFilter ? "inline-block" : "none";
    });
  }
  const clear = $("#remarkFilterClear");
  if (clear) {
    clear.addEventListener("click", () => {
      remarkFilter = "";
      const txtIn = $("#remarkFilterText");
      if (txtIn) txtIn.value = "";
      renderRows();
      clear.style.display = "none";
    });
  }

  // Service filter dropdown — applies globally (all sub-tabs + all top-tabs)
  const svcSel = $("#serviceFilterSelect");
  if (svcSel) {
    svcSel.addEventListener("change", (e) => {
      serviceFilter = e.target.value;
      updateTopCounts();
      renderActive();
    });
  }
  const svcClear = $("#serviceFilterClear");
  if (svcClear) {
    svcClear.addEventListener("click", () => {
      serviceFilter = "";
      updateTopCounts();
      renderActive();
    });
  }

  // Employee filter — applies globally across all tabs + sub-tabs
  const empSel = $("#employeeFilterSelect");
  if (empSel) {
    empSel.addEventListener("change", (e) => {
      employeeFilter = e.target.value;
      updateTopCounts();
      renderActive();
      refreshQuotationsCard();
    });
  }
  const empClear = $("#employeeFilterClear");
  if (empClear) {
    empClear.addEventListener("click", () => {
      employeeFilter = "";
      updateTopCounts();
      renderActive();
      refreshQuotationsCard();
    });
  }
  // Assigned-to filter (manager only)
  const asnSel = $("#assignedFilterSelect");
  if (asnSel) {
    asnSel.addEventListener("change", (e) => {
      assignedFilter = e.target.value;
      updateTopCounts();
      renderActive();
    });
  }
  const asnClear = $("#assignedFilterClear");
  if (asnClear) {
    asnClear.addEventListener("click", () => {
      assignedFilter = "";
      updateTopCounts();
      renderActive();
    });
  }

  // Origin filter (v2026082019) — Follow Ups / Quotations / Paid tabs only.
  const originSel = $("#originFilterSelect");
  if (originSel) {
    originSel.addEventListener("change", (e) => {
      originFilter = e.target.value;
      updateTopCounts();
      renderActive();
    });
  }
  const originClear = $("#originFilterClear");
  if (originClear) {
    originClear.addEventListener("click", () => {
      originFilter = "";
      updateTopCounts();
      renderActive();
    });
  }

  // Bulk "Assign all visible" (manager, Unassigned tab only) — opens an inline
  // picker (service + employee) that mirrors the per-row picker, then loops
  // reassign_lead over every currently-visible unassigned lead.
  wireBulkAssignHandlers();
}

function wireBulkAssignHandlers() {
  const run    = document.getElementById("bulkAssignRun");
  const status = document.getElementById("bulkAssignStatus");
  if (!run) return;

  const setStatus = (txt, tone) => {
    if (!status) return;
    status.textContent = txt || "";
    status.style.color = tone === "err" ? "#991b1b" : (tone === "ok" ? "#065f46" : "#64748b");
  };

  run.addEventListener("click", async () => {
    // Iterate every currently-visible unassigned row and read what the manager
    // has already picked in each row's per-row Service + Employee dropdowns.
    // Only rows where BOTH service AND a resolved employee code are set get
    // assigned. Rows missing either are counted as skipped.
    const wraps = Array.from(document.querySelectorAll("#rowsContainer .asn-inline"));
    if (wraps.length === 0) { alert("No unassigned leads visible."); return; }

    const jobs = [];
    for (const wrap of wraps) {
      const key   = wrap.dataset.customerKey || "";
      const svcLc = String(wrap.dataset.service || "").trim().toLowerCase();
      const code  = String(wrap.dataset.resolvedCode || "").trim();
      const name  = String(wrap.dataset.resolvedName || "").trim();
      if (!key || !svcLc || !code) continue;
      jobs.push({ key, svcLc, code, name });
    }

    const skipped = wraps.length - jobs.length;
    if (jobs.length === 0) {
      setStatus(`✗ None ready. All ${wraps.length} rows are missing Service or have no sales person for that service.`, "err");
      return;
    }

    const ok = window.confirm(`Assign ${jobs.length} lead${jobs.length > 1 ? "s" : ""}?${skipped > 0 ? `\n\n${skipped} row${skipped > 1 ? "s" : ""} will be skipped (no sales person handles that service).` : ""}`);
    if (!ok) return;

    run.disabled = true;
    run.style.opacity = ".5";
    run.style.cursor = "wait";

    let done = 0, failed = 0;
    const failures = [];
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      setStatus(`Assigning ${i + 1} of ${jobs.length}… (${done} done${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} skipped` : ""})`);
      try {
        await callAdmin("reassign_lead", {
          customer_key: job.key,
          to_code: job.code,
          service: job.svcLc || null,
          reset_status: true,
        });
        done += 1;
      } catch (err) {
        failed += 1;
        failures.push(`${job.key}: ${err.message || err}`);
      }
    }
    setStatus(`✓ ${done} of ${jobs.length} assigned${failed ? ` · ${failed} failed` : ""}${skipped ? ` · ${skipped} skipped (no sales person for that service)` : ""}. Reloading…`, failed ? "err" : "ok");
    setTimeout(() => location.reload(), 600);
    if (failures.length) {
      console.error("Bulk assign failures:\n" + failures.join("\n"));
    }
  });
}

function renderTable(rows, readOnly) {
  // On the Unassigned tab there is no meaningful call status yet (the lead hasn't
  // been actioned) and there's nothing to "save" — so we hide the Call Status
  // and Save/Add columns entirely. Assignment happens via the inline picker in
  // the Employee cell.
  const hideStatusCol = activeTop === "unassigned";
  return `<div class="table-scroll"><table class="data">
    <thead><tr>
      <th>Service</th>
      <th>Contact</th>
      <th>Last activity</th>
      ${hideStatusCol ? "" : `<th style="min-width:160px;">Call status</th>`}
      <th style="min-width:170px;">Employee</th>
      <th style="min-width:260px;">Remarks (latest + history)</th>
      ${(readOnly || hideStatusCol) ? "" : "<th>Save / Add</th>"}
    </tr></thead>
    <tbody>${rows.map((r) => rowHtml(r, readOnly)).join("")}</tbody>
  </table></div>`;
}

function rowHtml(l, readOnly) {
  // LATEST values: prefer alt_* / whatsapp overrides, fall back to base
  const latestEmail  = l.alt_email  || l.email  || "";
  const latestMobile = l.alt_mobile || l.mobile || "";
  const latestWA     = l.whatsapp   || latestMobile;  // WA defaults to mobile if not separately set
  const phone = (latestMobile || "").replace(/\D/g, "");
  const waPhone = (latestWA || "").replace(/\D/g, "");
  const waPhoneFmt = waPhone.length === 10 ? "91" + waPhone : waPhone;
  const waText = encodeURIComponent(`Hi! This is cursive. I see you started ${l.service_name || l.service_type || ""} - quick chat?`);
  const cur = esc(l.customer_key || "");
  const ageHrs = (Date.now() - new Date(l.last_event_at).getTime()) / 3600000;
  const ageStr = ageHrs < 1 ? Math.round(ageHrs * 60) + "m"
              : ageHrs < 24 ? Math.round(ageHrs) + "h"
              : Math.round(ageHrs / 24) + "d";

  const statusValue = l.talk_status || "";
  const statusLabel = (TALK_STATUS_OPTIONS.find(o => o.value === statusValue) || {}).label || "—";
  // Contact-update data (used by fallback buttons when a value is missing)
  const contactData = `data-customer-key="${cur}" data-email="${esc(latestEmail)}" data-mobile="${esc(latestMobile)}" data-whatsapp="${esc(l.whatsapp || '')}"`;
  const callBtn = phone
    ? `<a href="tel:+${(phone.length===10?"91":"")+phone}" style="display:inline-block;padding:4px 10px;background:#dbeafe;color:#1e40af;border-radius:4px;font-size:11.5px;font-weight:700;text-decoration:none;margin-right:4px;">📞 Call</a>`
    : `<button data-action="edit-contact" ${contactData} title="No mobile yet — add one" style="padding:4px 10px;background:#f1f5f9;color:#64748b;border:1px dashed #cbd5e1;border-radius:4px;font-size:11.5px;font-weight:700;cursor:pointer;margin-right:4px;">📞 Call</button>`;
  const waBtn = waPhone
    ? `<a href="https://wa.me/${waPhoneFmt}?text=${waText}" target="_blank" rel="noopener" style="display:inline-block;padding:4px 10px;background:#dcfce7;color:#065f46;border-radius:4px;font-size:11.5px;font-weight:700;text-decoration:none;margin-right:4px;">💬 WhatsApp</a>`
    : `<button data-action="edit-contact" ${contactData} title="No WhatsApp yet — add one" style="padding:4px 10px;background:#f1f5f9;color:#64748b;border:1px dashed #cbd5e1;border-radius:4px;font-size:11.5px;font-weight:700;cursor:pointer;margin-right:4px;">💬 WhatsApp</button>`;
  const emailBtn = latestEmail
    ? `<a href="mailto:${esc(latestEmail)}" style="display:inline-block;padding:4px 10px;background:#fef3c7;color:#92400e;border-radius:4px;font-size:11.5px;font-weight:700;text-decoration:none;">✉️ Email</a>`
    : `<button data-action="edit-contact" ${contactData} title="No email yet — add one" style="padding:4px 10px;background:#f1f5f9;color:#64748b;border:1px dashed #cbd5e1;border-radius:4px;font-size:11.5px;font-weight:700;cursor:pointer;">✉️ Email</button>`;

  // Contact cell HTML: latest email + mobile + WhatsApp + Add contact button (opens add-only modal)
  const contactCell = `
    <div style="font-size:12.5px;line-height:1.4;">
      ${latestEmail ? `<div><a href="mailto:${esc(latestEmail)}" style="color:#0f766e;">${esc(latestEmail)}</a></div>` : `<div class="muted-small">no email</div>`}
      ${latestMobile ? `<div class="muted-small" style="color:#0f172a;font-weight:600;">📱 ${esc(latestMobile)}</div>` : ""}
      ${(l.whatsapp && l.whatsapp !== latestMobile) ? `<div class="muted-small" style="color:#065f46;">💬 ${esc(l.whatsapp)}</div>` : ""}
      ${readOnly ? "" : `<button data-action="edit-contact" data-customer-key="${cur}" data-email="${esc(latestEmail)}" data-mobile="${esc(latestMobile)}" data-whatsapp="${esc(l.whatsapp || '')}" style="margin-top:4px;background:transparent;border:1px dashed #94a3b8;color:#475569;padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer;">＋ Add / Update contact</button>`}
    </div>`;
  // Send Quote button - appears in Send Quote sub-tab; opens Quotations tab with prefilled data
  const quotePrefill = new URLSearchParams({
    new: "1",
    email: l.email || "",
    mobile: l.mobile || "",
    service: l.service_name || l.service_type || "",
    customer_key: l.customer_key || ""
  }).toString();
  const showQuoteBtn = activeTop === "follow" && activeSub === "in_progress";
  const quoteBtn = showQuoteBtn ? `<button data-action="send-quote" data-prefill="${esc(quotePrefill)}" style="background:#7c3aed;color:#fff;padding:4px 10px;border-radius:4px;font-size:11.5px;font-weight:700;border:0;cursor:pointer;margin-left:4px;">📋 Send Quote</button>` : "";

  const remarksCell = renderRemarksCell(l, readOnly);

  // Employee chip (prefers native pipeline_leads.employee_code from admin-data v20+)
  // This is the CREATOR chip (👤) — immutable once stamped.
  const empChipLabel = l.employee_code
    ? `👤 ${esc(l.employee_code)}${l.employee_name ? ` · ${esc(l.employee_name)}` : ""}`
    : "";
  const empChip = l.employee_code
    ? `<span title="Employee who created / owns this lead (immutable)" style="display:inline-block;margin-top:4px;padding:2px 8px;background:#ffedd5;color:#9a3412;border:1px solid #fed7aa;border-radius:10px;font-size:10.5px;font-weight:700;letter-spacing:.2px;">${empChipLabel}</span>`
    : "";

  // Assignee chip (📌) — separate from creator. Managers see a "Reassign" button.
  const asnCode = l.assigned_employee_code || "";
  const asnName = l.assigned_employee_name || "";
  const asnChipInner = asnCode
    ? `📌 ${esc(asnCode)}${asnName ? " — " + esc(asnName) : ""}`
    : `📌 Unassigned`;
  const asnBg = asnCode ? "#fef3c7" : "#f1f5f9";
  const asnFg = asnCode ? "#92400e" : "#64748b";
  const asnBorder = asnCode ? "#fde68a" : "#e2e8f0";
  // v2026082015: the Reassign button was moved out of the chip and into its own
  // "Forward" action button placed right before Save (see below). The chip is now
  // purely a display of the current assignee + a tiny "History" click that opens
  // a modal listing lead_assignment_history.
  const historyBtn = (_isManager && !readOnly) ? `<button class="asn-history-btn" data-action="show-asn-history" data-customer-key="${cur}" title="Show past assignees" style="margin-left:6px;padding:1px 6px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;font-size:10px;font-weight:600;cursor:pointer;color:#334155;">History</button>` : "";
  const assigneeChip = `<span title="Employee this lead is currently assigned to" style="display:inline-flex;align-items:center;margin-top:4px;margin-left:4px;padding:2px 8px;background:${asnBg};color:${asnFg};border:1px solid ${asnBorder};border-radius:10px;font-size:10.5px;font-weight:700;letter-spacing:.2px;">${asnChipInner}${historyBtn}</span>`;

  // Employee CELL for the dedicated column (v2026082015).
  // ── EMP CODE input is gone. The cell is a READ-ONLY chip showing the current
  // ASSIGNEE (assigned_employee_code / _name) with a small History button.
  // To change the assignee, managers use the "Forward" action button in the
  // right-side action column (see rowSaveCell below).
  const asnDisplay = asnCode
    ? `${esc(asnCode)}${asnName ? ` · ${esc(asnName)}` : ""}`
    : `— Unassigned —`;
  const asnChipBg = asnCode ? "#fef3c7" : "#f1f5f9";
  const asnChipFg = asnCode ? "#92400e" : "#64748b";
  const asnChipBd = asnCode ? "#fde68a" : "#e2e8f0";
  const creatorLine = l.employee_code
    ? `<div class="muted-small" style="font-size:10.5px;color:#9a3412;">👤 creator: ${esc(l.employee_code)}${l.employee_name ? " · " + esc(l.employee_name) : ""}</div>`
    : "";
  const historyBtnInCell = (_isManager && !readOnly)
    ? `<button data-action="show-asn-history" data-customer-key="${cur}" title="Show past assignees" style="margin-top:3px;padding:1px 6px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;font-size:10px;font-weight:600;cursor:pointer;color:#334155;align-self:flex-start;">History</button>`
    : "";
  // v2026082019: Forwarded chip. Shown on every row (any tab) whose backing
  // lead_overrides row has is_forwarded=true — i.e. this pipeline lead was
  // auto-created when a manager added a service that the previous assignee
  // couldn't handle. Sits next to the assignee chip so it's obvious at a
  // glance who inherited it and why.
  const forwardedChip = l.is_forwarded
    ? `<span title="This lead was auto-forwarded from another service." style="display:inline-block;margin-top:3px;padding:2px 7px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:10px;font-size:10.5px;font-weight:700;letter-spacing:.2px;align-self:flex-start;">&#8618; Forwarded</span>`
    : "";
  let empCellHtml = `<div style="display:flex;flex-direction:column;gap:3px;">
      <span title="Assigned employee (read-only — use Forward to reassign)" style="display:inline-block;padding:3px 9px;background:${asnChipBg};color:${asnChipFg};border:1px solid ${asnChipBd};border-radius:10px;font-size:11px;font-weight:700;letter-spacing:.2px;">${esc(asnDisplay)}</span>
      ${forwardedChip}
      ${creatorLine}
      ${historyBtnInCell}
    </div>`;

  // Unassigned tab (managers only): inline Service dropdown + searchable Employee dropdown
  // + Assign button. Service dropdown is populated from SERVICES; pre-selects the lead's
  // service_type when it maps to a real service (legacy values like manual/other/service/
  // website leave the placeholder). Employee dropdown starts disabled until a service is
  // picked, then repopulates + auto-prefills the "fewest open leads" recommendation
  // (fetched via recommendForService, cached per-service). Assign gates on BOTH set.
  // Backend contract is unchanged: only the assignee is written — the lead's original
  // service_type is preserved even if the manager picks a different service for filtering.
  if (_isManager && !readOnly && activeTop === "unassigned") {
    // Service is the only editable field. If the lead's own service_type isn't a
    // real value in SERVICES (blank/null/legacy like 'manual'), default to 'other'
    // so the auto-picker kicks in immediately.
    const origSvcLc = String(l.service_type || "").toLowerCase();
    const inSvcList = SERVICES.some((s) => s.value === origSvcLc);
    const pickedSvc = inSvcList ? origSvcLc : "other";
    const svcOptsHtml = SERVICES.map(
      (s) => `<option value="${esc(s.value)}" ${s.value === pickedSvc ? "selected" : ""}>${esc(s.label)}</option>`
    ).join("");

    // Employee is auto-picked and shown as a read-only label. The Assign button
    // reads dataset.resolvedCode set by applyServiceToAsnWrap after the recommend RPC.
    const initialEmpText = "Finding best fit…";
    const initialEmpColor = "#64748b";
    const initialStatus = "Finding the sales rep with the fewest open leads…";
    const statusColor = "#64748b";
    const inlineAssign = `
      <div class="asn-inline" data-customer-key="${cur}" data-service="${esc(pickedSvc)}" data-original-service="${esc(origSvcLc)}" data-resolved-code="" data-resolved-name="" style="margin-top:6px;display:flex;flex-direction:column;gap:3px;">
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
          <select class="asn-inline-svc" data-customer-key="${cur}" style="flex:0 1 130px;min-width:100px;max-width:150px;padding:3px 5px;border:1px solid #cbd5e1;border-radius:4px;font-size:11.5px;background:#fff;">${svcOptsHtml}</select>
          <span class="asn-inline-emp-display" data-customer-key="${cur}" style="flex:1 1 130px;min-width:120px;padding:3px 5px;font-size:11.5px;font-weight:600;color:${initialEmpColor};">${esc(initialEmpText)}</span>
          <button class="asn-inline-btn" data-action="assign-inline" data-customer-key="${cur}" disabled style="padding:3px 9px;background:#059669;color:#fff;border:0;border-radius:4px;font-size:11.5px;font-weight:700;cursor:not-allowed;opacity:.4;">Assign</button>
        </div>
        <div class="asn-inline-svc-note muted-small" style="font-size:10.5px;color:#64748b;min-height:0;"></div>
        <div class="asn-inline-status muted-small" style="color:${statusColor};font-size:11px;min-height:14px;">${esc(initialStatus)}</div>
      </div>`;
    // Keep the creator chip (if any) visible above the assign UI so the manager still sees who made the lead.
    const creatorChip = l.employee_code
      ? `<div style="margin-bottom:4px;"><span title="Lead creator (immutable)" style="display:inline-block;padding:2px 8px;background:#ffedd5;color:#9a3412;border:1px solid #fed7aa;border-radius:10px;font-size:10.5px;font-weight:700;">${empChipLabel}</span></div>`
      : "";
    empCellHtml = `${creatorChip}${inlineAssign}`;
  }

  // Services cell (chips + optional add-service dropdown). Replaces the old
  // single service_name text in the Service column.
  const servicesCell = renderServicesCell(l, readOnly);

  // Read-only completed row
  if (readOnly) {
    return `<tr class="done">
      <td>
        <div style="font-weight:600;">${esc(l.service_name || l.service_type || "—")}</div>
        ${servicesCell}
        <span class="done-tag">${esc(bucketReason(l))}</span>
      </td>
      <td>${contactCell}</td>
      <td>
        <div>${esc(ageStr)} ago</div>
        <div class="muted-small">${esc(fmtDate(l.last_event_at))} ${esc(fmtTime(l.last_event_at))}</div>
        <div style="margin-top:6px;">${callBtn}${waBtn}${emailBtn}</div>
      </td>
      <td><span class="muted-small" style="font-weight:600;color:#0f172a;">${esc(statusLabel)}</span></td>
      <td>${empCellHtml}</td>
      <td>${remarksCell}</td>
    </tr>`;
  }

  // Editable row — dropdown options depend on current sub-tab (state machine)
  const allowed = allowedStatusesFor(l);
  const isTerminal = (activeTop === "follow") && allowed.length === 0;
  const statusOpts = isTerminal
    ? `<option value="">— no further moves —</option>`
    : buildStatusOptionsHtml(allowed, statusValue);

  // Unassigned tab: no call-status dropdown and no Save/Add cell — those only
  // make sense once the lead has been assigned and moved into New / Follow Ups.
  const hideStatusCell = activeTop === "unassigned";
  // v2026082018: The "↪ Manual forward" link below Save + Forward has been
  // removed. Save + Forward now handles both the queued pending service adds
  // (each of which the backend will auto-forward if the assignee doesn't
  // handle the service) AND the status update in one shot — there's nothing
  // Manual forward could do that Save + Forward doesn't already cover.
  return `<tr class="${l.is_stale ? "stale" : ""}" data-customer-key="${cur}">
    <td>
      <div style="font-weight:600;">${esc(l.service_name || l.service_type || "—")}</div>
      ${servicesCell}
      ${l.is_stale ? `<span class="stale-tag">stale</span>` : ""}
    </td>
    <td>${contactCell}</td>
    <td>
      <div>${esc(ageStr)} ago</div>
      <div class="muted-small">${esc(fmtDate(l.last_event_at))} ${esc(fmtTime(l.last_event_at))}</div>
      <div style="margin-top:6px;">${callBtn}${waBtn}</div>
      ${quoteBtn ? `<div style="margin-top:6px;">${quoteBtn}</div>` : ""}
    </td>
    ${hideStatusCell ? "" : `<td>
      <select class="status-select" data-customer-key="${cur}" ${isTerminal ? "disabled" : ""}>${statusOpts}</select>
    </td>`}
    <td>${empCellHtml}</td>
    <td>${remarksCell}</td>
    ${hideStatusCell ? "" : `<td>
      <div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;">
        ${isTerminal
          ? `<span class="muted-small">Terminal state</span>`
          : `<button class="row-save-btn" data-action="save-and-forward" data-customer-key="${cur}" disabled style="opacity:.4;cursor:not-allowed;pointer-events:none;padding:7px 14px;background:linear-gradient(90deg,#2563eb 0%,#f97316 100%);color:#fff;border:0;border-radius:5px;font-size:12.5px;font-weight:700;">💾 Save + Forward</button>`}
      </div>
      <div class="row-save-error" style="display:none;"></div>
    </td>`}
  </tr>`;
}

// Called after every input/change in a row (status dropdown or emp-code input)
// to flip the row's Save button between enabled and disabled/blurred.
function refreshRowSaveGate(tr) {
  if (!tr) return;
  const btn = tr.querySelector(".row-save-btn");
  if (!btn) return;
  const sel = tr.querySelector("select.status-select");
  const key = tr.getAttribute("data-customer-key") || "";
  const lead = pipelineCache.find((x) => x.customer_key === key);
  const hasStatus = !!(sel && sel.value);
  // v2026082015: EMP CODE input is gone. Gate save on either an existing
  // creator code OR a current assignee. If neither, block save and prompt
  // the manager to Forward the lead instead.
  let empOk = false;
  if (lead && (lead.employee_code || lead.assigned_employee_code)) {
    empOk = true;
  }
  const enable = hasStatus && empOk;
  btn.disabled = !enable;
  if (enable) {
    btn.style.opacity = "";
    btn.style.cursor = "";
    btn.style.pointerEvents = "";
  } else {
    btn.style.opacity = ".4";
    btn.style.cursor = "not-allowed";
    btn.style.pointerEvents = "none";
  }
}

function allowedStatusesFor(lead) {
  if (activeTop === "follow") {
    // Per-tab state machine: only show valid next moves.
    return STATUS_TRANSITIONS[activeSub] || [];
  }
  if (activeTop === "new") {
    // Entry points into the Follow Ups bucket
    return NEW_BUCKET_STATUS_OPTIONS.slice();
  }
  return [];
}

function buildStatusOptionsHtml(allowedIds, currentValue) {
  // Always include placeholder + (if current value is set but not in allowed list, include it too as 'current')
  const opts = [`<option value="">— select —</option>`];
  // Show the current value (so the dropdown isn't blank for leads that landed here)
  const currentOpt = TALK_STATUS_OPTIONS.find(o => o.value === currentValue);
  if (currentOpt && currentOpt.value && !allowedIds.includes(currentValue)) {
    opts.push(`<option value="${currentOpt.value}" selected disabled>${esc(currentOpt.label)} (current)</option>`);
  }
  allowedIds.forEach((id) => {
    const o = TALK_STATUS_OPTIONS.find(x => x.value === id);
    if (!o) return;
    const sel = (id === currentValue) ? "selected" : "";
    opts.push(`<option value="${o.value}" ${sel}>${esc(o.label)}</option>`);
  });
  return opts.join("");
}

function renderStarChip(l) {
  // v2026082020: current max priority rating chip. Gold when >=4, grey when unrated,
  // slate when 1-3. Click opens the star history/add modal.
  const cur = esc(l.customer_key || "");
  const maxStars = (l.max_stars == null) ? 0 : Number(l.max_stars);
  const rated = maxStars > 0;
  const gold = maxStars >= 4;
  const bg = gold ? "#fef3c7" : (rated ? "#e2e8f0" : "#f1f5f9");
  const fg = gold ? "#b45309" : (rated ? "#334155" : "#94a3b8");
  const bd = gold ? "#f59e0b" : (rated ? "#cbd5e1" : "#e2e8f0");
  const label = rated ? `⭐ ${maxStars}` : "☆ Unrated";
  const tip = "Highest priority rating on this lead. Click to see history.";
  return `<button data-action="show-star-modal" data-customer-key="${cur}" title="${esc(tip)}" style="display:inline-flex;align-items:center;padding:2px 8px;background:${bg};color:${fg};border:1px solid ${bd};border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.2px;">${label}</button>`;
}

function renderRemarksCell(l, readOnly) {
  const cur = esc(l.customer_key || "");
  const latestHeader = l.latest_remark_header || "";
  const latest = l.remarks || "";
  const latestAt = l.latest_remark_at || l.manual_updated_at || "";
  const count = Number(l.remarks_count || 0);
  const isExpanded = expandedRows.has(l.customer_key);
  const olderCount = Math.max(0, count - 1);

  // v2026082020: star chip sits at the top of the remarks cell so it's always visible.
  let html = `<div style="margin-bottom:4px;">${renderStarChip(l)}</div>`;

  if (latest || latestHeader) {
    html += `<div class="remark-latest">
      ${latestHeader ? `<div style="font-weight:700;color:#0f172a;font-size:13px;">${esc(latestHeader)}</div>` : ""}
      ${latest ? `<div class="remark-text" style="color:#334155;font-size:12.5px;">${esc(latest)}</div>` : ""}
      ${latestAt ? `<div class="remark-meta">${esc(fmtDate(latestAt))} ${esc(fmtTime(latestAt))}</div>` : ""}
    </div>`;
  } else {
    html += `<div class="remark-empty muted-small">No remarks yet.</div>`;
  }

  if (olderCount > 0 && !isExpanded) {
    html += `<button class="remark-expand" data-action="expand-remarks" data-customer-key="${cur}">+${olderCount} earlier remark${olderCount > 1 ? "s" : ""}</button>`;
  }
  if (isExpanded) {
    const list = remarksByKey[l.customer_key] || [];
    const older = list.slice(1);
    html += `<div class="remark-history">
      ${older.map((r) => `<div class="remark-older">
        ${r.header ? `<div style="font-weight:700;color:#0f172a;">${esc(r.header)}</div>` : ""}
        <div class="remark-text">${esc(r.remark)}</div>
        <div class="remark-meta">${esc(fmtDate(r.created_at))} ${esc(fmtTime(r.created_at))}${r.created_by ? ` &middot; ${esc(r.created_by)}` : ""}</div>
      </div>`).join("")}
      <button class="remark-collapse" data-action="collapse-remarks" data-customer-key="${cur}">Hide history</button>
    </div>`;
  }

  if (!readOnly) {
    html += `<div class="add-remark-wrap">
      <button class="add-remark-btn" data-action="show-add-remark" data-customer-key="${cur}">+ Add remark</button>
      <button data-action="show-star-modal" data-customer-key="${cur}" title="Add a priority star rating (or view history)" style="margin-left:6px;background:#fef3c7;color:#b45309;border:1px solid #f59e0b;padding:3px 8px;border-radius:4px;font-size:11.5px;font-weight:700;cursor:pointer;">⭐ Rate</button>
      <div class="add-remark-form hidden">
        <input class="add-remark-header" type="text" placeholder="Header / short caption (e.g. Called at 3pm, discussed pricing)" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:12.5px;font-weight:600;margin-bottom:4px;"/>
        <textarea class="add-remark-input" placeholder="Full discussion / details..." rows="2" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:12.5px;"></textarea>
        <div class="add-remark-actions" style="margin-top:4px;">
          <button class="add-remark-save" data-action="add-remark-save" data-customer-key="${cur}">Save</button>
          <button class="add-remark-cancel" data-action="add-remark-cancel" data-customer-key="${cur}">Cancel</button>
        </div>
        <div class="add-remark-error" style="display:none;color:#dc2626;font-size:11.5px;margin-top:3px;"></div>
      </div>
    </div>`;
  }

  return html;
}

function bucketReason(l) {
  if (l.talk_status === "won_offline") return "won (offline)";
  if (l.manual_status === "won") return "won";
  if (l.latest_event === "payment_completed") return "paid via Razorpay";
  if (l.latest_event === "wallet_recharged") return "wallet recharged";
  return "completed";
}

let _paneClickAttached = false;
function wireRowHandlers() {
  // Attach exactly ONCE. Without this guard, every re-render adds a new
  // listener and a single click fires multiple times (which is why one
  // add-remark click was producing 50+ rows).
  if (_paneClickAttached) return;
  _paneClickAttached = true;

  // Live gate refresh: react to status dropdown + per-row employee-code input.
  $("#paneStage").addEventListener("change", (e) => {
    const sel = e.target.closest("select.status-select");
    if (sel) {
      const tr = sel.closest("tr");
      refreshRowSaveGate(tr);
    }
    // Unassigned tab: service dropdown changed -> refetch recommendation & update display.
    const svcSel = e.target.closest("select.asn-inline-svc");
    if (svcSel) {
      const wrap = svcSel.closest(".asn-inline");
      if (wrap) applyServiceToAsnWrap(wrap, svcSel.value, {});
    }
  });
  $("#paneStage").addEventListener("input", (e) => {
    const inp = e.target.closest("input.row-emp-code");
    if (!inp) return;
    const tr = inp.closest("tr");
    const key = inp.dataset.customerKey || "";
    const raw = (inp.value || "").trim().toUpperCase();
    inp.value = raw;
    const nameSpan = tr.querySelector(".row-emp-name");
    // reset resolution
    _rowEmpState[key] = { code: "", name: "", ok: false, timer: (_rowEmpState[key] && _rowEmpState[key].timer) || null };
    if (_rowEmpState[key].timer) clearTimeout(_rowEmpState[key].timer);
    if (!raw) {
      if (nameSpan) { nameSpan.textContent = "Enter code above…"; nameSpan.style.color = "#64748b"; nameSpan.style.background = "#f8fafc"; }
      refreshRowSaveGate(tr);
      return;
    }
    if (nameSpan) { nameSpan.textContent = "Checking…"; nameSpan.style.color = "#64748b"; nameSpan.style.background = "#f8fafc"; }
    refreshRowSaveGate(tr);
    _rowEmpState[key].timer = setTimeout(async () => {
      try {
        const res = await callEmployeeLookup(raw);
        if (res && res.ok && res.employee && res.employee.code === raw) {
          _rowEmpState[key] = { code: raw, name: res.employee.name || "", ok: true, timer: null };
          if (nameSpan) { nameSpan.textContent = "✓ " + (res.employee.name || raw); nameSpan.style.color = "#065f46"; nameSpan.style.background = "#d1fae5"; }
        } else {
          _rowEmpState[key] = { code: "", name: "", ok: false, timer: null };
          if (nameSpan) { nameSpan.textContent = "✗ unknown code"; nameSpan.style.color = "#991b1b"; nameSpan.style.background = "#fee2e2"; }
        }
      } catch {
        _rowEmpState[key] = { code: "", name: "", ok: false, timer: null };
        if (nameSpan) { nameSpan.textContent = "✗ lookup failed"; nameSpan.style.color = "#991b1b"; nameSpan.style.background = "#fee2e2"; }
      }
      refreshRowSaveGate(tr);
    }, 300);
  });

  $("#paneStage").addEventListener("click", async (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const key = target.dataset.customerKey;
    // Manual forward link is an <a href="#"> — stop the page from jumping to top.
    if (target.tagName === "A") e.preventDefault();

    if (action === "expand-remarks") {
      // Fetch full remarks list and expand
      target.disabled = true; target.textContent = "Loading...";
      try {
        const list = await callAdmin("lead_remarks", { customer_key: key });
        remarksByKey[key] = list;
        expandedRows.add(key);
        renderPane();
      } catch (err) {
        target.disabled = false; target.textContent = "+ Show history (failed)";
        console.error(err);
      }
      return;
    }
    if (action === "collapse-remarks") {
      expandedRows.delete(key);
      renderPane();
      return;
    }
    if (action === "show-add-remark") {
      const wrap = target.closest(".add-remark-wrap");
      target.style.display = "none";
      wrap.querySelector(".add-remark-form").classList.remove("hidden");
      wrap.querySelector(".add-remark-input").focus();
      return;
    }
    if (action === "add-remark-cancel") {
      const wrap = target.closest(".add-remark-wrap");
      wrap.querySelector(".add-remark-form").classList.add("hidden");
      wrap.querySelector(".add-remark-input").value = "";
      wrap.querySelector(".add-remark-error").style.display = "none";
      wrap.querySelector(".add-remark-btn").style.display = "";
      return;
    }
    if (action === "add-remark-save") {
      const wrap = target.closest(".add-remark-wrap");
      const headerInput = wrap.querySelector(".add-remark-header");
      const input = wrap.querySelector(".add-remark-input");
      const errBox = wrap.querySelector(".add-remark-error");
      const header = (headerInput?.value || "").trim();
      const text = (input.value || "").trim();
      errBox.style.display = "none";
      if (!header && !text) {
        errBox.textContent = "Fill header or body before saving.";
        errBox.style.display = "block";
        return;
      }
      target.disabled = true; target.textContent = "Saving...";
      try {
        const saved = await callAdmin("add_remark", { customer_key: key, header, remark: text || header });
        const idx = pipelineCache.findIndex((x) => x.customer_key === key);
        if (idx >= 0) {
          pipelineCache[idx].remarks = saved.remark;
          pipelineCache[idx].latest_remark_header = saved.header || "";
          pipelineCache[idx].latest_remark_at = saved.created_at;
          pipelineCache[idx].remarks_count = (pipelineCache[idx].remarks_count || 0) + 1;
        }
        if (remarksByKey[key]) remarksByKey[key].unshift(saved);
        renderPane();
      } catch (err) {
        target.disabled = false; target.textContent = "Save";
        errBox.textContent = "Save failed: " + err.message;
        errBox.style.display = "block";
      }
      return;
    }
    if (action === "edit-contact") {
      showContactUpdateModal({
        customer_key: key,
        email: target.dataset.email || "",
        mobile: target.dataset.mobile || "",
        whatsapp: target.dataset.whatsapp || "",
      });
      return;
    }
    if (action === "assign-inline") {
      if (!_isManager) return;
      const wrap = target.closest(".asn-inline");
      if (!wrap) return;
      const statusEl = wrap.querySelector(".asn-inline-status");
      const serviceLc = String(wrap.dataset.service || "").toLowerCase();
      const resolvedCode = String(wrap.dataset.resolvedCode || "").trim();
      const setStatus = (txt, tone) => {
        if (!statusEl) return;
        statusEl.textContent = txt || "";
        statusEl.style.color = tone === "err" ? "#991b1b" : (tone === "ok" ? "#065f46" : "#64748b");
      };
      if (!serviceLc) {
        setStatus("Pick a service first.", "err");
        wrap.querySelector(".asn-inline-svc")?.focus();
        return;
      }
      if (!resolvedCode) {
        setStatus("✗ No sales person available for this service — cannot assign.", "err");
        return;
      }
      target.disabled = true; target.textContent = "Assigning…";
      target.style.opacity = ".5"; target.style.cursor = "wait";
      try {
        // v26: also send reset_status=true so the RPC wipes talk_status → lead lands in NEW LEADS
        // (not stuck in FOLLOW UPS due to historical status like 'quotation_sent').
        await callAdmin("reassign_lead", { customer_key: key, to_code: resolvedCode, service: serviceLc || null, reset_status: true });
        // Full page reload — guarantees NEW LEADS count reflects the assign,
        // sidesteps any cached JS / stale state. Only used from Unassigned assign.
        setStatus("✓ Assigned. Reloading…", "ok");
        setTimeout(() => location.reload(), 400);
      } catch (err) {
        target.disabled = false; target.textContent = "Assign";
        target.style.opacity = ""; target.style.cursor = "pointer";
        setStatus("Assign failed: " + err.message, "err");
      }
      return;
    }
    if (action === "reassign") {
      if (!_isManager) return;
      const list = (_allEmployeesCache || []);
      if (list.length === 0) { alert("No active employees found. Add employees at /admin/users/ first."); return; }
      const listStr = list.map((e, i) => `${i + 1}. ${e.code}${e.name ? " — " + e.name : ""}`).join("\n");
      const pick = prompt(`Reassign lead to which employee?\n\n${listStr}\n\nEnter the number (1-${list.length}) or the code:`);
      if (pick === null) return;
      const trimmed = String(pick).trim();
      let toCode = "";
      if (/^\d+$/.test(trimmed)) {
        const idx = parseInt(trimmed, 10) - 1;
        if (idx >= 0 && idx < list.length) toCode = list[idx].code;
      } else {
        const upper = trimmed.toUpperCase();
        const match = list.find(e => e.code === upper);
        if (match) toCode = match.code;
      }
      if (!toCode) { alert("Invalid selection."); return; }
      try {
        const res = await callAdmin("reassign_lead", { customer_key: key, to_code: toCode });
        const chosen = list.find(e => e.code === toCode);
        // Optimistically update local cache so the chip re-renders
        const idx = pipelineCache.findIndex((x) => x.customer_key === key);
        if (idx >= 0) {
          pipelineCache[idx].assigned_employee_code = toCode;
          pipelineCache[idx].assigned_employee_name = chosen?.name || "";
          pipelineCache[idx].assigned_at = new Date().toISOString();
        }
        updateTopCounts();
        renderActive();
      } catch (err) {
        alert("Reassign failed: " + err.message);
      }
      return;
    }
    if (action === "add-service") {
      // v2026082018: Local queue only. Do NOT call the backend here — that
      // used to fire add_service_to_lead immediately (which auto-forwarded
      // and popped a "Forwarded X to Y…" alert every click). Instead we
      // push the picked service into _pendingServiceAdds and re-render, so
      // it shows up as a dashed "pending" chip. The real backend call
      // happens once, in the Save + Forward handler.
      if (!_isManager) return;
      const wrap = target.closest(".add-svc-wrap");
      const sel = wrap?.querySelector(".add-svc-select");
      const svc = String(sel?.value || "").trim().toLowerCase();
      if (!svc) { alert("Pick a service first."); return; }
      const list = Array.isArray(_pendingServiceAdds[key]) ? _pendingServiceAdds[key] : [];
      if (!list.includes(svc)) list.push(svc);
      _pendingServiceAdds[key] = list;
      renderActive();
      return;
    }
    if (action === "remove-pending-service") {
      // Cancel a queued (not-yet-saved) service add. No backend call — just
      // drop it from the local queue and re-render so the chip disappears
      // and the option reappears in the dropdown.
      if (!_isManager) return;
      const svc = String(target.dataset.service || "").trim().toLowerCase();
      if (!svc) return;
      const list = Array.isArray(_pendingServiceAdds[key]) ? _pendingServiceAdds[key] : [];
      const next = list.filter((x) => x !== svc);
      if (next.length === 0) delete _pendingServiceAdds[key];
      else _pendingServiceAdds[key] = next;
      renderActive();
      return;
    }
    if (action === "remove-service") {
      if (!_isManager) return;
      const svc = String(target.dataset.service || "").trim().toLowerCase();
      if (!svc) return;
      if (!confirm(`Remove service "${svcLabel(svc)}" from this lead? (It will be kept as history.)`)) return;
      try {
        await callAdmin("remove_service_from_lead", { customer_key: key, service: svc });
        pipelineCache = await callAdmin("pipeline");
        updateTopCounts();
        renderActive();
      } catch (err) {
        alert("Remove service failed: " + err.message);
      }
      return;
    }
    if (action === "show-asn-history") {
      await showAssignmentHistoryModal(key);
      return;
    }
    if (action === "show-star-modal") {
      // v2026082020: 5-star priority rating modal — click stars to pick N,
      // optional note, save (append-only). History shown below.
      await showStarRatingModal(key);
      return;
    }
    if (action === "send-quote") {
      const prefill = target.dataset.prefill || "";
      // Switch to Quotations tab + load prefilled URL in iframe
      switchTop("quotations");
      const f = document.getElementById("quotationsFrame");
      if (f) f.src = "/leads01/quotations/?" + prefill;
      return;
    }
    if (action === "save-and-forward") {
      // v2026082018: rewritten flow. The Add-service dropdown no longer hits
      // the backend on click — it just queues into _pendingServiceAdds. This
      // handler now:
      //   1. Validates status + assignee (same as before).
      //   2. For each PENDING queued service, calls add_service_to_lead.
      //      The backend RPC decides "stayed" vs "forwarded" per service, and
      //      it's ALSO the place that writes lead_assignment_history rows —
      //      so history is naturally only logged now, on Save + Forward.
      //   3. Then calls set_lead_status for the status update.
      //   4. Shows ONE combined toast summarising all of it.
      //   5. Clears the pending queue for this row and refetches pipeline
      //      (NEW LEADS count updates naturally when new pipeline rows show up).
      const tr = target.closest("tr");
      const sel = tr.querySelector("select.status-select");
      const errBox = tr.querySelector(".row-save-error");
      errBox.style.display = "none";
      const talk_status = sel.value || null;
      if (!talk_status) {
        errBox.textContent = "Pick a status before saving.";
        errBox.style.display = "block";
        return;
      }
      const leadRow = pipelineCache.find((x) => x.customer_key === key) || {};
      if (!leadRow.employee_code && !leadRow.assigned_employee_code) {
        errBox.textContent = "Lead has no assignee — assign it first.";
        errBox.style.display = "block";
        return;
      }
      // Freeze the button visuals during the multi-step operation
      const origHtml = target.innerHTML;
      target.disabled = true;
      target.innerHTML = "Saving + forwarding…";
      target.style.opacity = ".5";
      target.style.cursor = "wait";
      target.style.pointerEvents = "none";

      // Step 1: process every pending service add. Each call may return
      // "stayed" (assignee handles it → same employee's lead just gains the
      // service) or "forwarded"/"split" (backend spun up new pipeline rows
      // for another employee → we surface the SERVICE → CODE mapping so the
      // manager sees exactly where it went).
      const pending = Array.isArray(_pendingServiceAdds[key])
        ? _pendingServiceAdds[key].slice()
        : [];
      const stayedSvcs = [];             // ["gst", ...]
      const forwardedTo = [];            // [{service, empCode}]
      const addErrors = [];              // [{service, msg}]
      for (const svc of pending) {
        try {
          const res = await callAdmin("add_service_to_lead", { customer_key: key, service: svc });
          const kind = res?.result || "stayed";
          const newLeads = res?.new_leads || [];
          if (kind === "forwarded" || kind === "split") {
            const first = newLeads[0] || {};
            forwardedTo.push({ service: svc, empCode: first.employee_code || "?" });
          } else {
            stayedSvcs.push(svc);
          }
        } catch (err) {
          addErrors.push({ service: svc, msg: err.message || "failed" });
        }
      }

      // Step 2: save the call-status. If this fails we still want the toast
      // to reflect anything that already happened above, so we don't bail early.
      let statusSaved = false;
      let statusError = null;
      try {
        await callAdmin("set_lead_status", { customer_key: key, talk_status });
        const idx = pipelineCache.findIndex((x) => x.customer_key === key);
        if (idx >= 0) pipelineCache[idx].talk_status = talk_status;
        statusSaved = true;
      } catch (err) {
        statusError = err.message || "failed";
      }

      // Step 3: build the single combined toast per spec.
      const lines = [];
      if (statusSaved) lines.push("✓ Status saved");
      if (stayedSvcs.length > 0) {
        const list = stayedSvcs.map((s) => svcLabel(s)).join(", ");
        lines.push(`✓ Added ${stayedSvcs.length} service${stayedSvcs.length === 1 ? "" : "s"}: ${list}`);
      }
      if (forwardedTo.length > 0) {
        const list = forwardedTo.map((f) => `${svcLabel(f.service)} → ${f.empCode}`).join(", ");
        lines.push(`✓ Forwarded ${forwardedTo.length} service${forwardedTo.length === 1 ? "" : "s"} → new lead${forwardedTo.length === 1 ? "" : "s"}: ${list}`);
      }
      if (addErrors.length > 0) {
        const list = addErrors.map((f) => `${svcLabel(f.service)}: ${f.msg}`).join("; ");
        lines.push(`⚠ Some service adds failed: ${list}`);
      }
      if (statusError) {
        lines.push(`⚠ Status save failed: ${statusError}`);
      }
      if (lines.length === 0) lines.push("Nothing to save.");
      alert(lines.join("\n"));

      // Step 4: clear pending queue for this row (only if the add call was
      // attempted — leave any items with real errors so the user can retry).
      if (addErrors.length === 0) {
        delete _pendingServiceAdds[key];
      } else {
        _pendingServiceAdds[key] = addErrors.map((e) => e.service);
      }

      // Step 5: refresh pipeline + re-render. Any forwarded services will
      // materialise as brand-new pipeline_leads rows, and the top NEW LEADS
      // counter will naturally bump when it re-reads pipelineCache.
      try {
        pipelineCache = await callAdmin("pipeline");
      } catch {}
      updateTopCounts();
      renderActive();

      // If status also failed and nothing else worked, unfreeze the button
      // so the manager can retry.
      if (!statusSaved && stayedSvcs.length === 0 && forwardedTo.length === 0) {
        target.disabled = false;
        target.innerHTML = origHtml;
        target.style.opacity = "";
        target.style.cursor = "";
        target.style.pointerEvents = "";
      }
      return;
    }
    if (action === "save-status") {
      const tr = target.closest("tr");
      const sel = tr.querySelector("select.status-select");
      const errBox = tr.querySelector(".row-save-error");
      errBox.style.display = "none";
      const talk_status = sel.value || null;
      if (!talk_status) {
        errBox.textContent = "Pick a status before saving.";
        errBox.style.display = "block";
        return;
      }
      // v2026082015: no more EMP CODE input; the row is gated on assignee /
      // creator existing (checked by refreshRowSaveGate). If neither exists,
      // the manager must Forward the lead first.
      const leadRow = pipelineCache.find((x) => x.customer_key === key) || {};
      if (!leadRow.employee_code && !leadRow.assigned_employee_code) {
        errBox.textContent = "Lead has no assignee — click Forward to assign first.";
        errBox.style.display = "block";
        return;
      }
      target.disabled = true; target.textContent = "Saving...";
      target.style.opacity = ".4"; target.style.cursor = "not-allowed"; target.style.pointerEvents = "none";
      try {
        const payload = { customer_key: key, talk_status };
        await callAdmin("set_lead_status", payload);
        const idx = pipelineCache.findIndex((x) => x.customer_key === key);
        if (idx >= 0) {
          pipelineCache[idx].talk_status = talk_status;
        }
        updateTopCounts();
        renderActive();
      } catch (err) {
        target.disabled = false; target.textContent = "Save status";
        target.style.opacity = ""; target.style.cursor = ""; target.style.pointerEvents = "";
        errBox.textContent = "Save failed: " + err.message;
        errBox.style.display = "block";
      }
      return;
    }
  });
}

// Contact update modal — 3 fields, ADD-ONLY, shows full history under each
async function showContactUpdateModal(current) {
  document.getElementById("contactUpdateModalOverlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "contactUpdateModalOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;";
  const fieldRow = (label, icon, value, id, placeholder, hint) => `
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:10px;background:#f8fafc;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">${icon} ${label} <span style="color:#059669;">(latest)</span></div>
          <div style="font-size:14px;color:#0f172a;font-weight:600;word-break:break-all;">${esc(value) || `<span style="color:#94a3b8;font-weight:400;">(no ${label.toLowerCase()} yet)</span>`}</div>
          <div id="${id}LatestTs" class="muted-small" style="color:#64748b;font-size:11px;margin-top:2px;"></div>
          ${hint ? `<div class="muted-small" style="color:#64748b;font-size:11px;margin-top:2px;">${hint}</div>` : ""}
        </div>
        <button data-add="${id}" style="background:#2563eb;color:#fff;border:none;border-radius:5px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">+ Add new</button>
      </div>
      <div id="${id}Wrap" class="hidden" style="margin-top:8px;display:flex;gap:6px;">
        <input id="${id}Input" type="text" placeholder="${placeholder}" style="flex:1;padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px;"/>
        <button data-savefield="${id}" style="background:#059669;color:#fff;border:none;border-radius:5px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;">Save</button>
      </div>
      <div id="${id}History" style="margin-top:8px;"></div>
    </div>`;
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:10px;padding:22px 24px;max-width:560px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.2);max-height:90vh;overflow-y:auto;">
      <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:4px;">Customer contact</div>
      <div class="muted-small" style="margin-bottom:14px;color:#64748b;">Contact info is <b>add-only</b> — every old value is always kept in history below each field. Click <b>+ Add new</b> to save a newer value. Newer value is used for Call / WhatsApp / Email going forward.</div>
      ${fieldRow("Email",    "📧", current.email,    "cuEmail",    "customer@email.com",  "")}
      ${fieldRow("Mobile",   "📱", current.mobile,   "cuMobile",   "10-digit mobile",     "")}
      ${fieldRow("WhatsApp", "💬", current.whatsapp || current.mobile, "cuWhatsapp", "10-digit WhatsApp number", current.whatsapp ? "" : "Currently defaulting to mobile. Add here to use a separate WhatsApp number going forward.")}
      <div id="cuMsg" style="font-size:12px;margin-top:6px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button id="cuClose" style="background:#e5e7eb;color:#111;padding:8px 14px;border:none;border-radius:5px;font-size:13px;cursor:pointer;">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const cleanup = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });
  document.getElementById("cuClose").onclick = cleanup;

  overlay.querySelectorAll("[data-add]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.add;
    document.getElementById(id + "Wrap").classList.toggle("hidden");
    document.getElementById(id + "Input")?.focus();
  }));

  const doSave = async (id, btn) => {
    const input = document.getElementById(id + "Input");
    let raw = (input.value || "").trim();
    if (!raw) return;
    const payload = { customer_key: current.customer_key };
    if (id === "cuEmail")    payload.email    = raw.toLowerCase();
    if (id === "cuMobile")   payload.mobile   = raw.replace(/\D/g, "");
    if (id === "cuWhatsapp") payload.whatsapp = raw.replace(/\D/g, "");
    const msg = document.getElementById("cuMsg");
    msg.textContent = ""; msg.style.color = "";
    btn.disabled = true; btn.textContent = "Saving...";
    try {
      await callAdmin("update_lead_contact", payload);
      msg.style.color = "#059669"; msg.textContent = "Saved. Reloading history...";
      pipelineCache = await callAdmin("pipeline");
      updateTopCounts();
      renderActive();
      // Reload the modal's history section
      await loadAndRenderHistory(current.customer_key);
      input.value = "";
      document.getElementById(id + "Wrap").classList.add("hidden");
      btn.disabled = false; btn.textContent = "Save";
      msg.textContent = "Saved. History updated below.";
    } catch (err) {
      msg.style.color = "#dc2626"; msg.textContent = "Save failed: " + err.message;
      btn.disabled = false; btn.textContent = "Save";
    }
  };
  overlay.querySelectorAll("[data-savefield]").forEach(btn => btn.addEventListener("click", () => doSave(btn.dataset.savefield, btn)));

  // Load and render history under each field
  await loadAndRenderHistory(current.customer_key);
}

async function loadAndRenderHistory(customerKey) {
  try {
    const history = await callAdmin("contact_history", { customer_key: customerKey });
    const byField = { email: [], mobile: [], whatsapp: [] };
    (history || []).forEach((h) => { if (byField[h.field]) byField[h.field].push(h); });
    // Latest timestamp per field goes next to the LATEST value at top
    const setLatestTs = (elId, list) => {
      const el = document.getElementById(elId);
      if (!el) return;
      const newest = list[0];
      el.innerHTML = newest ? `Updated ${esc(fmtDate(newest.changed_at))} ${esc(fmtTime(newest.changed_at))}` : "(initial value — never updated)";
    };
    setLatestTs("cuEmailLatestTs",    byField.email);
    setLatestTs("cuMobileLatestTs",   byField.mobile);
    setLatestTs("cuWhatsappLatestTs", byField.whatsapp);
    renderHistoryList("cuEmailHistory",    byField.email);
    renderHistoryList("cuMobileHistory",   byField.mobile);
    renderHistoryList("cuWhatsappHistory", byField.whatsapp);
  } catch (e) {
    console.warn("history load failed:", e);
  }
}

function renderHistoryList(elId, list) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!list || list.length === 0) { el.innerHTML = ""; return; }

  // list is DESC (newest change first). Build full value timeline ASC:
  //   [ initial old_value (from oldest change, no timestamp),
  //     new_value of oldest change (activated at its changed_at),
  //     ... newer changes ]
  const asc = list.slice().reverse();
  const values = [];
  const seen = new Set();
  const oldest = asc[0];
  if (oldest?.old_value && String(oldest.old_value).trim()) {
    const v = String(oldest.old_value).trim();
    values.push({ value: v, at: null });
    seen.add(v);
  }
  asc.forEach((h) => {
    const v = (h.new_value || "").trim();
    if (!v) return;
    if (!seen.has(v) || values[values.length - 1]?.value !== v) {
      values.push({ value: v, at: h.changed_at });
      seen.add(v);
    }
  });
  // Reverse so newest is first
  values.reverse();
  if (values.length === 0) { el.innerHTML = ""; return; }

  const rows = values.map((v, i) => `
    <div style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#475569;display:flex;justify-content:space-between;gap:6px;align-items:center;">
      <span style="color:${i===0?"#059669":"#334155"};font-weight:600;word-break:break-all;">${esc(v.value)}${i===0?` <span style="font-size:10px;color:#059669;font-weight:700;">LATEST</span>`:""}</span>
      ${v.at ? `<span style="color:#94a3b8;font-size:10.5px;white-space:nowrap;">${esc(fmtDate(v.at))} ${esc(fmtTime(v.at))}</span>` : `<span style="color:#94a3b8;font-size:10.5px;">(initial)</span>`}
    </div>`).join("");
  el.innerHTML = `
    <div style="background:#fff;border:1px dashed #cbd5e1;border-radius:5px;margin-top:6px;">
      <div style="padding:4px 8px;font-size:11px;font-weight:700;color:#64748b;background:#f1f5f9;">📜 All values (${values.length}) — read only, cannot be deleted</div>
      ${rows}
    </div>`;
}

// ── Multi-service chip rendering (v2026082015) ─────────────────────────────
// Reads services from either the aggregated arrays (services_active / services_removed)
// or from services_detail[] returned by admin-data v31 (needed for the tooltip
// showing WHO removed a service AND WHEN — the arrays alone don't carry that).
function svcLabel(svc) {
  const hit = SERVICES.find((s) => s.value === String(svc || "").toLowerCase());
  return hit ? hit.label : String(svc || "");
}

function renderServicesCell(l, readOnly) {
  const cur = esc(l.customer_key || "");
  const detail = Array.isArray(l.services_detail) ? l.services_detail : [];
  // Fallback: build a synthetic detail array if only services_active/services_removed present
  let active   = detail.filter((x) => x.is_active);
  let removed  = detail.filter((x) => !x.is_active);
  if (active.length === 0 && Array.isArray(l.services_active)) {
    active = (l.services_active || []).map((s) => ({ service: s, is_active: true, added_at: null, added_by: null }));
  }
  if (removed.length === 0 && Array.isArray(l.services_removed)) {
    removed = (l.services_removed || []).map((s) => ({ service: s, is_active: false, removed_at: null, removed_by: null }));
  }
  // If no lead_services rows at all (legacy row not yet migrated), synthesize one from service_type
  if (active.length === 0 && removed.length === 0 && l.service_type) {
    active = [{ service: String(l.service_type).toLowerCase(), is_active: true, is_primary: true, added_at: null }];
  }

  const activeChips = active.map((s) => {
    const svcVal = String(s.service || "").toLowerCase();
    const rmBtn = readOnly ? "" : `<button data-action="remove-service" data-customer-key="${cur}" data-service="${esc(svcVal)}" title="Remove ${esc(svcLabel(svcVal))}" style="margin-left:4px;background:transparent;border:0;color:#7c2d12;font-weight:700;cursor:pointer;font-size:11px;line-height:1;">✕</button>`;
    return `<span title="${esc(svcVal)}${s.added_at ? ' · added ' + fmtDate(s.added_at) : ''}" style="display:inline-flex;align-items:center;margin:2px 4px 2px 0;padding:2px 6px;background:#dcfce7;color:#065f46;border:1px solid #86efac;border-radius:8px;font-size:10.5px;font-weight:700;">${esc(svcLabel(svcVal))}${rmBtn}</span>`;
  }).join("");

  // v2026082019: Removed chips render as a vertical column, newest removal on
  // top. Sort by removed_at DESC (nulls last). Keep strikethrough + tooltip.
  const removedSorted = removed.slice().sort((a, b) => {
    const ta = a.removed_at ? new Date(a.removed_at).getTime() : 0;
    const tb = b.removed_at ? new Date(b.removed_at).getTime() : 0;
    return tb - ta;
  });
  const removedChips = removedSorted.map((s) => {
    const svcVal = String(s.service || "").toLowerCase();
    const tip = s.removed_at
      ? `Removed on ${fmtDate(s.removed_at)}${s.removed_by ? ' by ' + s.removed_by : ''}`
      : "Removed";
    return `<span title="${esc(tip)}" style="display:block;margin:2px 0;padding:2px 6px;background:#f1f5f9;color:#94a3b8;border:1px dashed #cbd5e1;border-radius:8px;font-size:10.5px;font-weight:600;text-decoration:line-through;width:fit-content;max-width:100%;">${esc(svcLabel(svcVal))}</span>`;
  }).join("");

  // v2026082018: Pending service adds — chips rendered with a dashed "pending"
  // style so the user knows they haven't been sent to the backend yet. Save +
  // Forward is what actually calls add_service_to_lead for each of these.
  const pendingList = Array.isArray(_pendingServiceAdds[l.customer_key])
    ? _pendingServiceAdds[l.customer_key].slice()
    : [];
  const pendingChips = pendingList.map((svcVal) => {
    const rmBtn = readOnly ? "" : `<button data-action="remove-pending-service" data-customer-key="${cur}" data-service="${esc(svcVal)}" title="Cancel pending add — nothing has been saved yet" style="margin-left:4px;background:transparent;border:0;color:#9a3412;font-weight:700;cursor:pointer;font-size:11px;line-height:1;">✕</button>`;
    return `<span title="Pending — will be added on Save + Forward" style="display:inline-flex;align-items:center;margin:2px 4px 2px 0;padding:2px 6px;background:#fff7ed;color:#9a3412;border:1px dashed #fdba74;border-radius:8px;font-size:10.5px;font-weight:700;">${esc(svcLabel(svcVal))} <span style="margin-left:4px;padding:0 4px;background:#fed7aa;color:#7c2d12;border-radius:6px;font-size:9.5px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;">pending</span>${rmBtn}</span>`;
  }).join("");

  // Build add-service dropdown that lists all SERVICES not already active on this lead
  // AND not already sitting in the pending queue.
  const activeSet = new Set(active.map((s) => String(s.service || "").toLowerCase()));
  const pendingSet = new Set(pendingList.map((s) => String(s || "").toLowerCase()));
  const availableSvcs = SERVICES.filter((s) => !activeSet.has(s.value) && !pendingSet.has(s.value));
  const addSvcHtml = (readOnly || !_isManager || availableSvcs.length === 0) ? "" : `
    <div class="add-svc-wrap" data-customer-key="${cur}" style="margin-top:4px;display:flex;align-items:center;gap:4px;">
      <select class="add-svc-select" data-customer-key="${cur}" style="padding:3px 5px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;background:#fff;max-width:140px;">
        <option value="">＋ Add service…</option>
        ${availableSvcs.map((s) => `<option value="${esc(s.value)}">${esc(s.label)}</option>`).join("")}
      </select>
      <button data-action="add-service" data-customer-key="${cur}" title="Queue this service — nothing hits the backend until you click Save + Forward" style="padding:2px 8px;background:#059669;color:#fff;border:0;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;">Add</button>
    </div>`;

  return `<div class="services-cell">${activeChips || `<span class="muted-small">no active services</span>`}${pendingChips ? `<div style="margin-top:2px;">${pendingChips}</div>` : ""}${removedChips ? `<div style="margin-top:2px;">${removedChips}</div>` : ""}${addSvcHtml}</div>`;
}

// v2026082020: 5-star priority rating modal.
// - 5 empty stars (click to select N, hover to preview)
// - Optional note
// - Save button (append-only — history never deletes)
// - History below (newest first) with format: ⭐⭐⭐⭐ "note" — by <email> — <date>
async function showStarRatingModal(customerKey) {
  document.getElementById("starRatingOverlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "starRatingOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;";

  // Star row builder — buttons drive the pick, hover previews via mouseenter/leave.
  const buildStarsHtml = (selected) => {
    let s = "";
    for (let i = 1; i <= 5; i++) {
      const filled = i <= selected;
      s += `<button type="button" class="star-btn" data-star="${i}" style="background:transparent;border:0;padding:0 2px;font-size:32px;line-height:1;cursor:pointer;color:${filled ? "#f59e0b" : "#cbd5e1"};transition:color .1s;">${filled ? "★" : "☆"}</button>`;
    }
    return s;
  };

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:22px 24px;max-width:560px;width:100%;max-height:88vh;overflow-y:auto;box-shadow:0 20px 50px rgba(15,23,42,.35);">
      <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:2px;">⭐ Priority rating</div>
      <div style="color:#64748b;font-size:12.5px;margin-bottom:14px;">Rate this lead 1-5 stars. Past ratings are kept as history (never deleted).</div>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-bottom:14px;">
        <div style="font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">New rating</div>
        <div id="starRow" style="display:flex;align-items:center;gap:2px;margin-bottom:8px;">${buildStarsHtml(0)}</div>
        <textarea id="starNote" rows="2" placeholder="Optional note (e.g. Big client, ready to buy, high-value deal)" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px;resize:vertical;font-family:inherit;"></textarea>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
          <button id="starSaveBtn" disabled style="background:#f59e0b;color:#fff;border:0;border-radius:5px;padding:7px 16px;font-size:13px;font-weight:700;cursor:not-allowed;opacity:.4;">Save rating</button>
          <span id="starMsg" style="font-size:12px;color:#64748b;"></span>
        </div>
      </div>

      <div style="font-size:12px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">History (newest first — cannot be deleted)</div>
      <div id="starHistoryList" style="font-size:13px;color:#334155;">Loading…</div>

      <div style="display:flex;justify-content:flex-end;margin-top:16px;">
        <button id="starClose" style="background:#e5e7eb;color:#111;padding:8px 16px;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer;">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const cleanup = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });
  overlay.querySelector("#starClose").onclick = cleanup;

  const starRow = overlay.querySelector("#starRow");
  const saveBtn = overlay.querySelector("#starSaveBtn");
  const noteEl  = overlay.querySelector("#starNote");
  const msgEl   = overlay.querySelector("#starMsg");
  let selectedStars = 0;

  const paint = (n) => {
    Array.from(starRow.querySelectorAll(".star-btn")).forEach((btn) => {
      const v = Number(btn.dataset.star);
      const filled = v <= n;
      btn.textContent = filled ? "★" : "☆";
      btn.style.color = filled ? "#f59e0b" : "#cbd5e1";
    });
  };
  const refreshGate = () => {
    const enable = selectedStars >= 1 && selectedStars <= 5;
    saveBtn.disabled = !enable;
    saveBtn.style.opacity = enable ? "" : ".4";
    saveBtn.style.cursor = enable ? "pointer" : "not-allowed";
  };
  starRow.addEventListener("mouseover", (e) => {
    const btn = e.target.closest(".star-btn");
    if (!btn) return;
    paint(Number(btn.dataset.star));
  });
  starRow.addEventListener("mouseleave", () => paint(selectedStars));
  starRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".star-btn");
    if (!btn) return;
    selectedStars = Number(btn.dataset.star);
    paint(selectedStars);
    refreshGate();
  });

  saveBtn.addEventListener("click", async () => {
    if (selectedStars < 1) return;
    saveBtn.disabled = true; saveBtn.textContent = "Saving...";
    msgEl.style.color = "#64748b"; msgEl.textContent = "";
    try {
      const saved = await callAdmin("add_star_rating", {
        customer_key: customerKey,
        stars: selectedStars,
        note: (noteEl.value || "").trim() || null,
      });
      msgEl.style.color = "#059669"; msgEl.textContent = "✓ Saved.";
      // Optimistically update pipelineCache so the row chip re-renders correctly
      const idx = pipelineCache.findIndex((x) => x.customer_key === customerKey);
      if (idx >= 0) {
        const prev = pipelineCache[idx].max_stars || 0;
        if (selectedStars > prev) {
          pipelineCache[idx].max_stars = selectedStars;
          pipelineCache[idx].latest_stars_at = saved?.created_at || new Date().toISOString();
        }
      }
      if (starRatingsByKey[customerKey]) starRatingsByKey[customerKey].unshift(saved);
      // Reset form for another
      selectedStars = 0; paint(0); noteEl.value = ""; refreshGate();
      await loadStarHistory(customerKey);
      updateTopCounts();
      renderActive();
      saveBtn.textContent = "Save rating";
    } catch (err) {
      msgEl.style.color = "#dc2626"; msgEl.textContent = "Save failed: " + err.message;
      saveBtn.disabled = false; saveBtn.textContent = "Save rating";
    }
  });

  await loadStarHistory(customerKey);
}

async function loadStarHistory(customerKey) {
  const listEl = document.getElementById("starHistoryList");
  if (!listEl) return;
  try {
    const rows = await callAdmin("lead_star_ratings", { customer_key: customerKey });
    starRatingsByKey[customerKey] = rows || [];
    if (!rows || rows.length === 0) {
      listEl.innerHTML = `<div style="padding:12px;color:#94a3b8;text-align:center;background:#f8fafc;border-radius:6px;">No ratings yet.</div>`;
      return;
    }
    // Format: ⭐⭐⭐⭐ "note" — by <email> — <date>. Newest first.
    listEl.innerHTML = rows.map((r) => {
      const stars = "⭐".repeat(Math.max(0, Math.min(5, Number(r.stars) || 0)));
      const noteHtml = r.note ? ` "${esc(r.note)}"` : "";
      const byHtml = r.created_by ? ` — by ${esc(r.created_by)}` : "";
      const dtHtml = ` — ${esc(fmtDate(r.created_at))} ${esc(fmtTime(r.created_at))}`;
      return `<div style="padding:8px 10px;margin-bottom:6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;color:#334155;">
        <span style="color:#f59e0b;letter-spacing:1px;">${stars}</span>${noteHtml}<span style="color:#64748b;font-size:12px;">${byHtml}${dtHtml}</span>
      </div>`;
    }).join("");
  } catch (err) {
    listEl.innerHTML = `<div style="color:#991b1b;padding:12px;background:#fef2f2;border-radius:6px;">Load failed: ${esc(err.message)}</div>`;
  }
}

// Modal that lists lead_assignment_history for a lead
async function showAssignmentHistoryModal(customerKey) {
  document.getElementById("asnHistoryOverlay")?.remove();

  // Parse "9111000006|gst" → { contact: "9111000006", service: "gst" }
  const [rawContact, rawSvc] = String(customerKey || "").split("|");
  const svcNice = (function(){
    const found = (typeof SERVICES !== "undefined" ? SERVICES : []).find(s => String(s.value).toLowerCase() === String(rawSvc||"").toLowerCase());
    return found ? found.label : (rawSvc || "—");
  })();

  // Lookup employee name by code from cached list
  const empName = (code) => {
    if (!code) return "";
    const hit = (_allEmployeesCache || []).find((e) => e.code === code);
    return hit ? (hit.name || "") : "";
  };
  const empChip = (code, tone) => {
    if (!code) return `<span style="color:#94a3b8;font-style:italic;">no one</span>`;
    const nm = empName(code);
    const bg = tone === "to"   ? "background:#dcfce7;color:#166534;border:1px solid #86efac;"
             : tone === "from" ? "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;"
             : "background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;";
    return `<span style="display:inline-block;${bg}padding:2px 8px;border-radius:5px;font-weight:700;font-size:12px;">${esc(code)}${nm ? ` <span style="font-weight:500;">— ${esc(nm)}</span>` : ""}</span>`;
  };

  // Human-friendly "why"
  const reasonPretty = {
    auto_new_lead:            "🎯 Auto-assigned when lead was created",
    auto_website_lead:        "🌐 Auto-assigned when captured from website",
    auto_forward_service_add: "↪ Auto-forwarded because a service was added",
    auto_handoff_payment:     "💰 Auto-handed off to processing on payment",
    auto_handoff_renewal:     "🔁 Auto-handed off to renewal",
    manual_reassign:          "✏️ Manually reassigned by an admin",
    backfill_scraped:         "🛠 Backfilled (existing lead)",
  };

  const overlay = document.createElement("div");
  overlay.id = "asnHistoryOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:22px 24px;max-width:680px;width:100%;max-height:82vh;overflow-y:auto;box-shadow:0 20px 50px rgba(15,23,42,.35);">
      <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:4px;">Lead history</div>
      <div style="color:#475569;font-size:13px;margin-bottom:14px;">Contact <b>${esc(rawContact || "—")}</b> · Service <b>${esc(svcNice)}</b></div>
      <div id="asnHistoryList" style="font-size:13px;color:#334155;">Loading…</div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px;">
        <button id="asnHistoryClose" style="background:#1f6feb;color:#fff;padding:8px 16px;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const cleanup = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });
  overlay.querySelector("#asnHistoryClose").onclick = cleanup;

  try {
    // v2026082019: fetch the merged timeline — assignment history + service
    // add/remove events — so managers see the full story in one place.
    const full = await callAdmin("lead_full_history", { customer_key: customerKey });
    const asnRows = (full && full.assignments)     || [];
    const svcRows = (full && full.service_events)  || [];
    const listEl = document.getElementById("asnHistoryList");
    if (asnRows.length === 0 && svcRows.length === 0) {
      listEl.innerHTML = `<div style="padding:16px;color:#94a3b8;text-align:center;background:#f8fafc;border-radius:6px;">No history yet.</div>`;
      return;
    }
    // Tag each row with its kind then merge & sort oldest-first.
    const merged = []
      .concat(asnRows.map((r) => ({ kind: "assignment", at: r.at, data: r })))
      .concat(svcRows.map((r) => ({ kind: "service",    at: r.at, data: r })))
      .sort((a, b) => new Date(a.at) - new Date(b.at));

    const renderAssignment = (r) => {
      const why = reasonPretty[r.reason] || `↪ ${esc(r.reason || "changed")}`;
      const byLine = r.by_email && r.by_email !== "system"
        ? `<div style="color:#64748b;font-size:11.5px;margin-top:3px;">Done by <b>${esc(r.by_email)}</b></div>`
        : `<div style="color:#94a3b8;font-size:11.5px;margin-top:3px;font-style:italic;">Done by the system</div>`;
      return `
        <div style="padding:10px 12px;margin-bottom:8px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;position:relative;">
          <div style="position:absolute;left:-20px;top:14px;width:11px;height:11px;background:#1f6feb;border-radius:50%;border:2px solid #fff;"></div>
          <div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:6px;">${why}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;">
            <span style="color:#64748b;">From</span> ${empChip(r.from_code, "from")}
            <span style="color:#64748b;">→</span>
            <span style="color:#64748b;">To</span> ${empChip(r.to_code, "to")}
          </div>
          <div style="color:#475569;font-size:11.5px;margin-top:4px;">📅 ${esc(fmtDate(r.at))} · ${esc(fmtTime(r.at))}</div>
          ${byLine}
        </div>`;
    };
    const renderServiceEvent = (r) => {
      const isAdd = r.action === "added";
      const icon  = isAdd ? "➕" : "✖";
      const verb  = isAdd ? "Added service" : "Removed service";
      const dot   = isAdd ? "#059669" : "#dc2626";
      const bg    = isAdd ? "#f0fdf4" : "#fef2f2";
      const bd    = isAdd ? "#bbf7d0" : "#fecaca";
      const svcNiceLabel = (function () {
        const hit = (typeof SERVICES !== "undefined" ? SERVICES : []).find(s => String(s.value).toLowerCase() === String(r.service || "").toLowerCase());
        return hit ? hit.label : (r.service || "—");
      })();
      const byLine = r.by_email
        ? `<div style="color:#64748b;font-size:11.5px;margin-top:3px;">Done by <b>${esc(r.by_email)}</b></div>`
        : `<div style="color:#94a3b8;font-size:11.5px;margin-top:3px;font-style:italic;">Done by the system</div>`;
      return `
        <div style="padding:10px 12px;margin-bottom:8px;background:${bg};border-radius:6px;border:1px solid ${bd};position:relative;">
          <div style="position:absolute;left:-20px;top:14px;width:11px;height:11px;background:${dot};border-radius:50%;border:2px solid #fff;"></div>
          <div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:4px;">${icon} ${esc(verb)}: <span style="color:${dot};">${esc(svcNiceLabel)}</span></div>
          <div style="color:#475569;font-size:11.5px;margin-top:4px;">📅 ${esc(fmtDate(r.at))} · ${esc(fmtTime(r.at))}</div>
          ${byLine}
        </div>`;
    };

    listEl.innerHTML = `
      <div style="border-left:3px solid #cbd5e1;padding-left:14px;margin-left:4px;">
      ${merged.map((entry) => entry.kind === "assignment" ? renderAssignment(entry.data) : renderServiceEvent(entry.data)).join("")}
      </div>`;
  } catch (err) {
    document.getElementById("asnHistoryList").innerHTML = `<div style="color:#991b1b;padding:12px;background:#fef2f2;border-radius:6px;">Load failed: ${esc(err.message)}</div>`;
  }
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
