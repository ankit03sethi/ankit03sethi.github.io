// cursive /leads/ — 3-bucket pipeline with append-only remarks log
const LEADS_JS_VERSION = "2026082244";
console.log("%c[leads.js] version:", "background:#1f6feb;color:#fff;padding:2px 6px;border-radius:3px;", LEADS_JS_VERSION);
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
  // v2026082206: Forwarded sub-tab — leads born from another lead's forward
  // (pipeline_leads.is_forwarded = true). Sits just before Lost.
  { id: "forwarded",          title: "↪ Forwarded" },
  { id: "lost",               title: "Lost" },
  { id: "never_visited",      title: "Never visited" },
  { id: "dont_call_again",    title: "Don't call again" },
  { id: "not_interested",     title: "Not interested" },
  { id: "not_a_lead",         title: "Not A Lead" },
  { id: "already_purchased",  title: "Already Purchased" },
];

const TALK_STATUS_OPTIONS = [
  { value: "",                  label: "— select —" },
  { value: "not_picked",        label: "Call not picked" },
  { value: "callback",          label: "Call me later" },
  { value: "interested",        label: "Interested" },
  { value: "in_progress",       label: "Send Quote" },
  { value: "lost",              label: "Lost" },
  { value: "never_visited",     label: "Never visited" },
  { value: "dont_call_again",   label: "Don't call again" },
  { value: "not_interested",    label: "Not interested" },
  { value: "not_a_lead",        label: "Not A Lead" },
  { value: "already_purchased", label: "Already Purchased" },
];

// v2026082026: 3-mode status dropdown constants.
// Mode A (normal working state): show positives only.
// Mode B (dropped lead — all services crossed): show negatives (incl. already_purchased).
// Mode C (pending forwards queued): show ONLY the Interested option. The
//   Save + Forward flow still routes per-service forwards under the hood.
const STATUS_MODE_A = ["not_picked", "callback", "interested", "in_progress"];
const STATUS_MODE_B = ["lost", "never_visited", "dont_call_again", "not_interested", "not_a_lead", "already_purchased"];

// State machine: from each sub-tab, these are the valid next moves.
const STATUS_TRANSITIONS = {
  not_picked:        ["callback", "interested", "in_progress", "lost", "never_visited", "dont_call_again", "not_interested", "not_a_lead", "already_purchased"],
  callback:          ["interested", "in_progress", "lost", "never_visited", "dont_call_again", "not_interested", "not_a_lead", "already_purchased"],
  interested:        ["in_progress", "lost", "not_a_lead", "already_purchased"],
  in_progress:       ["lost", "not_a_lead", "already_purchased"],
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
// v2026082236: set of customer_keys that have at least one quotation. Any lead
// NOT in this set + marked "won" is treated as a site-direct purchase (bought
// straight from cursive.world without a quotation) — those should NOT appear
// in the leads01 pipeline; the customer + invoice live only in /invoices.
let _quotedCustomerKeys = new Set();
// v2026082239: customer_keys whose ANY quotation has been sent (status !=
// draft/regenerated/cancelled). Once a lead is quoted, they belong to the
// Quotations card FOREVER — even if talk_status later flips back to callback/
// interested/etc. Keeps Sent card and Follow Ups from double-claiming them.
let _sentQuotedCustomerKeys = new Set();
// v2026082237: customer_key → { from_code, at } for leads that were
// automatically reassigned because the previous assignee lost the service.
// Populated by refreshReassignedChips() on every refreshAll.
let _reassignedFromMap = new Map();
async function refreshReassignedChips() {
  try {
    const { data, error } = await sb.rpc("latest_service_removed_reassigns");
    if (error) { console.warn("reassigned chip fetch failed:", error); return; }
    const m = new Map();
    for (const r of (data || [])) {
      if (r.customer_key) m.set(r.customer_key, { from_code: r.from_code || "", at: r.at });
    }
    _reassignedFromMap = m;
  } catch (e) { console.warn("reassigned chip rpc failed:", e); }
}
let activeTop = "new";
let activeSub = "lead_captured";
// Populated in bootDashboard(). _isManager = super || leads. _myEmpCode is the caller's
// employees.code (needed to scope + label). _isEmployeeOnly = employee perm w/out super/leads.
let _isManager = false;
let _isEmployeeOnly = false;
let _myEmpCode = "";
let _myEmpName = "";
// v2026082023: per-action gates hydrated from admin-data whoami.leads01_actions.
// Structure: { view, add, edit_status, add_remarks, reassign, bulk_add, remove_services }.
// Empty object means "no rights"; super-admins get everything true from server.
let _leads01Actions = { view:false, add:false, edit_status:false, add_remarks:false, reassign:false, bulk_add:false, remove_services:false, add_service:false, add_rating:false, save_forward:false };
let _isAddLeadsOnly = false; // true when caller has 'add_leads' but neither 'leads' nor 'super' nor 'employee'
function leadsCan(action) {
  return !!(_leads01Actions && _leads01Actions[action] === true);
}
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

  // RBAC gate — leads pipeline is open to super, leads, quotations, employee, OR add_leads.
  // (The quote-builder sub-page /leads01/quotations/ enforces 'quotations' or 'super' separately.)
  const { data: perms } = await sb.rpc("current_admin_permissions");
  const list = Array.isArray(perms) ? perms : [];
  const hasSuper = list.includes("super");
  const hasLeads = list.includes("leads");
  const hasQuot = list.includes("quotations");
  const hasEmp = list.includes("employee");
  const hasAddLeads = list.includes("add_leads");
  if (!hasSuper && !hasLeads && !hasQuot && !hasEmp && !hasAddLeads) {
    document.body.innerHTML = `<div style="max-width:520px;margin:60px auto;padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,0.06);font-family:-apple-system,'Segoe UI',Roboto,sans-serif;text-align:center;">
      <h1 style="margin:0 0 10px;font-size:22px;color:#0f172a;">🚫 No access to <b style="color:#1f6feb;">Leads pipeline</b></h1>
      <p style="color:#64748b;font-size:14px;line-height:1.6;">Your admin account doesn't have the <code>leads</code>, <code>add_leads</code>, <code>quotations</code>, or <code>employee</code> permission. Ask a super-admin in <a href="/admin/users/">/admin/users/</a>.</p>
      <p style="color:#94a3b8;font-size:12px;margin-top:10px;">Your permissions: <code>${list.length ? list.join(", ") : "(none)"}</code></p>
      <a href="/home/" style="display:inline-block;margin-top:14px;padding:10px 22px;background:#1f6feb;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">← Home</a>
    </div>`;
    return;
  }
  _isManager = hasSuper || hasLeads;
  _isEmployeeOnly = hasEmp && !_isManager;
  _isAddLeadsOnly = hasAddLeads && !hasSuper && !hasLeads && !hasEmp;
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
      _myEmpName = who?.employee_name || who?.email || em;
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

  // v2026082234: seed from URL params first, then fall back to Last 30 days.
  // ?date=today|yesterday|last7|last30|thismonth|lastmonth|all|custom
  //   +  ?from=YYYY-MM-DD&to=YYYY-MM-DD  when date=custom
  const urlParams = new URLSearchParams(location.search);
  const urlPreset = urlParams.get("date");
  const urlFrom = urlParams.get("from");
  const urlTo = urlParams.get("to");
  // v2026082235: default to Today (was Last 30 days).
  let seedPreset = "today";
  let seedRange;
  if (urlPreset === "custom" && urlFrom && urlTo) {
    seedPreset = "custom";
    seedRange = {
      from: iso(new Date(urlFrom + "T00:00:00")),
      to: iso(new Date(urlTo + "T23:59:59.999")),
    };
    from.value = urlFrom;
    to.value = urlTo;
    from.style.display = "";
    to.style.display = "";
    sep.style.display = "";
    apply.style.display = "";
  } else if (urlPreset && urlPreset !== "custom") {
    seedPreset = urlPreset;
    seedRange = computePreset(urlPreset);
  } else {
    seedRange = computePreset("today");
  }
  preset.value = seedPreset;
  dateRange = { from: seedRange.from, to: seedRange.to, preset: seedPreset };

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
    // v2026082234: reload the whole parent with the preset in the URL. This
    // is the bulletproof path — no dependence on cached iframe HTML, cached
    // leads.js, or postMessage timing. Cards + list + iframe are all rebuilt
    // from scratch with the new date filter.
    const url = new URL(location.href);
    url.searchParams.set("date", v);
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    location.href = url.toString();
  });

  apply.addEventListener("click", async () => {
    if (!from.value || !to.value) { alert("Pick both dates"); return; }
    const url = new URL(location.href);
    url.searchParams.set("date", "custom");
    url.searchParams.set("from", from.value);
    url.searchParams.set("to", to.value);
    location.href = url.toString();
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
  $("#emailChip").textContent = _isEmployeeOnly ? `${_myEmpCode}${_myEmpName ? " · " + _myEmpName : ""}` : "01";
  $("#emailChip").title = _isEmployeeOnly ? (user?.email || "") : "";
  show($("#emailChip")); show($("#signOutBtn"));
  // v2026082023: hydrate fine-grained action flags from whoami so every UI
  // gate reads a single source of truth. Managers get all-true from the
  // server; add_leads-only users get just { add:true }.
  try {
    const who = await callAdmin("whoami").catch(() => null);
    if (who && who.leads01_actions && typeof who.leads01_actions === "object") {
      _leads01Actions = Object.assign({ view:false, add:false, edit_status:false, add_remarks:false, reassign:false, bulk_add:false, remove_services:false }, who.leads01_actions);
    }
  } catch {}
  // Page title: employees see their own dashboard label
  if (_isEmployeeOnly) {
    try {
      const titleEl = document.querySelector("h1.dash-title") || document.querySelector("h1");
      if (titleEl) titleEl.textContent = `My Leads · ${_myEmpCode}${_myEmpName ? " — " + _myEmpName : ""}`;
      document.title = `My Leads · ${_myEmpCode}`;
    } catch {}
  }
  // Unassigned tab is manager-only AND requires reassign (that's the entire purpose of that tab).
  const uTab = document.getElementById("topTabUnassigned");
  if (uTab) uTab.classList.toggle("hidden", !(_isManager && leadsCan("reassign")));
  // Add-leads tab: visible whenever caller has the 'add' sub-action (super/leads
  // with add ticked, OR the atomic add_leads permission). Managers see it too.
  const addTab = document.getElementById("topTabAdd");
  const canAdd = leadsCan("add") || _isAddLeadsOnly;
  if (addTab) addTab.classList.toggle("hidden", !(canAdd || _isManager));

  // add_leads-only users: land them on the Add Leads tab, hide every other tab.
  if (_isAddLeadsOnly) {
    document.querySelectorAll(".top-tab").forEach((btn) => {
      if (btn.id !== "topTabAdd") btn.classList.add("hidden");
    });
    // Route the user directly to Add Leads on boot.
    setTimeout(() => switchTop("add"), 0);
  }
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

// v2026082226: iframe explicitly asks the parent for the current date range
// on its own load — race-free replacement for the parent's fire-and-hope
// postMessage during refreshAll. This is the reliable channel.
window.addEventListener("message", (ev) => {
  if (ev?.data?.type === "cursive:request-date-range") {
    const f = document.getElementById("quotationsFrame");
    if (f && f.contentWindow) {
      try { f.contentWindow.postMessage({ type: "cursive:date-range", from: dateRange.from, to: dateRange.to }, "*"); } catch {}
    }
  }
});

// v2026082228: fast path — re-render cards + list from cached pipeline WITHOUT
// hitting the server. Called from date-range change so the UI moves instantly.
// Also force-reloads the Quotations iframe so its list refreshes together with
// the top cards (postMessage-only was landing in stale cached iframe code).
function applyDateFilterOnly() {
  console.log("[leads.js v" + LEADS_JS_VERSION + "] applyDateFilterOnly()", dateRange);
  // Stamp the visible version marker in the DOM (updated in initTopbar too),
  // so user can look at page and immediately confirm which build is running.
  const vm = document.getElementById("leadsJsVerMark");
  if (vm) vm.textContent = "v" + LEADS_JS_VERSION;
  $("#dateActiveRange").textContent = labelForRange();
  refreshQuotationsCard();          // recomputes card counts from admin-quotations cache-of-1 fetch
  updateTopCounts();                // recomputes top cards from cached pipeline
  renderActive();                   // re-renders the lead list from cached pipeline
  refreshTotalPaid();
  const f = $("#quotationsFrame");
  if (f && f.src && f.src.includes("/leads01/quotations")) {
    // v2026082229: ALWAYS force-reload the iframe on any date change (whether
    // it's the visible pane or not) so cards + list truly move together the
    // instant the user picks a new date range.
    let currentFilter = "";
    try { currentFilter = new URL(f.src).searchParams.get("filter") || ""; } catch {}
    const params = new URLSearchParams();
    if (currentFilter) params.set("filter", currentFilter);
    if (dateRange.from) params.set("from", dateRange.from);
    if (dateRange.to) params.set("to", dateRange.to);
    params.set("v", String(Date.now()));
    f.onload = () => {
      try {
        f.contentWindow?.postMessage({ type: "cursive:date-range", from: dateRange.from, to: dateRange.to }, "*");
        if (currentFilter) f.contentWindow?.postMessage({ type: "cursive:set-filter", filter: currentFilter }, "*");
      } catch {}
    };
    f.src = `/leads01/quotations/?${params.toString()}`;
  }
}

async function refreshAll() {
  try {
    // v2026082244: fire-and-forget reconciliation kick so any Razorpay payment
    // that landed in the last minute gets marked paid + invoiced BEFORE the
    // quotations card fetch runs. Non-blocking — doesn't slow anything.
    fetch(SUPABASE_URL + "/functions/v1/quote-payment-reconcile-cron", { method: "POST" }).catch(() => {});
    // v2026082102: fire the quotations-card fetch in PARALLEL with pipeline —
    // don't wait for pipeline to finish before populating the accepted/total
    // numbers on the top card. Otherwise the numbers show as "0" for the full
    // pipeline load time (often 2-3s).
    refreshQuotationsCard();
    refreshReassignedChips(); // v2026082237: parallel fetch, non-blocking
    pipelineCache = await callAdmin("pipeline");
    $("#lastRefreshed").textContent = "Last refreshed " + new Date().toLocaleTimeString();
    $("#dateActiveRange").textContent = labelForRange();
    updateTopCounts();
    renderActive();
    refreshTotalPaid();
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
  // v2026082209: card now shows big SENT number + breakdown for
  // Follow Up / Regen / Accepted / Expired / Rejected + ₹ total of Accepted.
  const sentEl = document.getElementById("quotSentCount");
  const draftEl = document.getElementById("quotDraftCount");
  const followEl = document.getElementById("quotFollowCount");
  const regenEl = document.getElementById("quotRegenCount");
  const acceptedEl = document.getElementById("quotAcceptedCount");
  const expiredEl = document.getElementById("quotExpiredCount");
  const rejectedEl = document.getElementById("quotRejectedCount");
  const totEl = document.getElementById("quotAcceptedTotal");
  const statsWrap = document.getElementById("quotStatsWrap");
  const iconOnly = document.getElementById("quotIconOnly");
  if (!sentEl || !totEl) return;
  if (statsWrap) statsWrap.classList.remove("hidden");
  if (iconOnly)  iconOnly.classList.add("hidden");
  const zero = () => {
    sentEl.textContent = "0";
    if (draftEl) draftEl.textContent = "0";
    followEl.textContent = "0";
    regenEl.textContent = "0";
    acceptedEl.textContent = "0";
    expiredEl.textContent = "0";
    rejectedEl.textContent = "0";
    totEl.textContent = "₹0";
  };
  zero();
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
    const scopeToOwnCode = (!_isManager && _myEmpCode) ? _myEmpCode : null;
    // v2026082236: rebuild the "customer_keys that have a quotation" set so
    // filteredPipeline() can suppress site-direct purchases.
    _quotedCustomerKeys = new Set(j.quotations.map(q => q.customer_key).filter(Boolean));
    // v2026082239: rebuild the "customer_keys that received at least ONE sent
    // quotation" set. bucketOf() uses it to keep those leads in the Quotations
    // card forever, even if the admin later flips their talk_status back to
    // not_picked / callback / interested etc.
    _sentQuotedCustomerKeys = new Set(
      j.quotations
        .filter(q => q.customer_key && q.status !== "draft" && q.status !== "regenerated" && q.status !== "cancelled")
        .map(q => q.customer_key)
    );
    let draft = 0, follow = 0, regen = 0, accepted = 0, expired = 0, rejected = 0, acceptedPaise = 0, paidCount = 0, paidPaise = 0;
    // v2026082240: Sent = unique LEADS (customer_keys) with any live quotation,
    // NOT total quotation count. Keeps top-row math clean:
    //   New + Follow Ups + Sent = Total Leads.
    const sentLeadKeys = new Set();
    for (const q of j.quotations) {
      const ts = q.created_at || q.updated_at;
      if (ts) {
        const t = new Date(ts).getTime();
        if (fromT !== null && t < fromT) continue;
        if (toT !== null && t > toT) continue;
      }
      if (scopeToOwnCode) {
        if ((q.employee_code || "").toUpperCase() !== String(scopeToOwnCode).toUpperCase()) continue;
      } else if (employeeFilter) {
        if (employeeFilter === "__none__") { if (q.employee_code) continue; }
        else if ((q.employee_code || "").toUpperCase() !== String(employeeFilter).toUpperCase()) continue;
      }
      const st = q.status;
      if (st !== "draft" && st !== "regenerated" && st !== "cancelled" && q.customer_key) sentLeadKeys.add(q.customer_key);
      if (st === "draft") draft += 1;
      else if (st === "follow_up" || st === "sent") follow += 1;
      else if (st === "regenerated") regen += 1;
      // v2026082218: separate Accepted from Paid — Accepted card ONLY counts
      // status='accepted'; Paid card counts status='paid' with its own ₹ total.
      else if (st === "accepted") { accepted += 1; acceptedPaise += Number(q.total_paise || 0); }
      else if (st === "paid") { paidCount += 1; paidPaise += Number(q.total_paise || 0); }
      else if (st === "expired") expired += 1;
      else if (st === "rejected") rejected += 1;
    }
    sentEl.textContent = String(sentLeadKeys.size);
    if (draftEl) draftEl.textContent = String(draft);
    // v2026082211: Expected Receivable card = accepted count + accepted ₹ total
    const rcvCountEl = document.getElementById("topcnt_receivable");
    const rcvTotalEl = document.getElementById("receivableTotal");
    if (rcvCountEl) rcvCountEl.textContent = String(accepted);
    if (rcvTotalEl) rcvTotalEl.textContent = "₹" + Math.round(acceptedPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
    // v2026082222: also fill the new Received (paid) count in the Quotations
    // top card breakdown.
    const quotPaidEl = document.getElementById("quotPaidCount");
    if (quotPaidEl) quotPaidEl.textContent = String(paidCount);
    // v2026082218: Paid / Received top card. Uses PAID quotes as source of
    // truth (completed_payments is a legacy sink that may be empty).
    const doneCntEl = document.getElementById("topcnt_done");
    const rcvdEl    = document.getElementById("receivedTotal");
    if (doneCntEl) doneCntEl.textContent = String(paidCount);
    if (rcvdEl)    rcvdEl.textContent    = "₹" + Math.round(paidPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
    followEl.textContent = String(follow);
    regenEl.textContent = String(regen);
    acceptedEl.textContent = String(accepted);
    expiredEl.textContent = String(expired);
    rejectedEl.textContent = String(rejected);
    const rupees = Math.round(acceptedPaise / 100);
    totEl.textContent = "₹" + rupees.toLocaleString("en-IN", { maximumFractionDigits: 0 });
    // v2026082242: race-fix — once _sentQuotedCustomerKeys is populated, force
    // a re-render of top counts + row list so leads that should live in the
    // Quotations bucket don't briefly appear in Follow Ups (81 vs 84 flicker).
    if (typeof updateTopCounts === "function" && pipelineCache && pipelineCache.length) {
      updateTopCounts();
      if (typeof renderActive === "function") renderActive();
    }
  } catch (e) {
    console.warn("quotations card fetch failed:", e);
  }
}

async function refreshTotalPaid() {
  try {
    const data = await callAdmin("total_paid", { from: dateRange.from, to: dateRange.to });
    const total = Number(data?.total || 0);
    // v2026082219: Received card is owned by refreshQuotationsCard() (uses paid
    // quote totals). Don't overwrite it from total_paid — that reads the empty
    // completed_payments table and would stomp the correct value to ₹0.
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
  if (lead.manual_status === "won") return "done";
  // v2026082239: If the customer has EVER received a sent quotation, they live
  // in the Quotations card permanently — even if the admin later switches the
  // talk_status back to callback / not_picked / interested / etc. The
  // quotation itself is the source of truth for what tab they belong on.
  if (lead.customer_key && _sentQuotedCustomerKeys.has(lead.customer_key)) return "quotations";
  // v2026082237: fallback — legacy talk_status='quotation_sent' rows.
  if (lead.talk_status === "quotation_sent") return "quotations";
  if (lead.talk_status) return "follow";
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
  // v2026082206: Forwarded leads (created from another lead's forward) land
  // in the dedicated Forwarded sub-tab UNLESS the user has already moved
  // them past that first triage step (any explicit talk_status other than the
  // Send-Quote route wins).
  if (lead.is_forwarded && !lead.talk_status && lead.manual_status !== "callback") return "forwarded";
  // Quote-sent leads route back to Send Quote (no dedicated tab).
  if (lead.talk_status === "quotation_sent") return "in_progress";
  if (lead.talk_status) return lead.talk_status;
  if (lead.manual_status === "callback") return "callback";
  return "in_progress";
}

function updateTopCounts() {
  // v2026082206: Follow Ups top-card now counts EVERY sub-tab (big number),
  // and breaks the total into Right (positive path) and Wrong (dropped path).
  //   Right = not_picked + callback + interested + in_progress + forwarded
  //   Wrong = lost + never_visited + dont_call_again + not_interested + not_a_lead + already_purchased
  const RIGHT_SUBS = new Set(["not_picked", "callback", "interested", "in_progress", "forwarded"]);
  const WRONG_SUBS = new Set(["lost", "never_visited", "dont_call_again", "not_interested", "not_a_lead", "already_purchased"]);
  const counts = { new: 0, follow: 0, followRight: 0, followWrong: 0, done: 0, unassigned: 0 };
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
      if (originFilter === "forwarded"  && !l.is_forwarded) return;
      if (originFilter === "direct"     &&  l.is_forwarded) return;
      if (originFilter === "reassigned" && !(l.customer_key && _reassignedFromMap.has(l.customer_key))) return;
    }
    if (b === "follow") {
      const sub = followSubOf(l);
      counts.follow += 1; // total Follow Ups (all sub-tabs)
      if (RIGHT_SUBS.has(sub)) counts.followRight += 1;
      else if (WRONG_SUBS.has(sub)) counts.followWrong += 1;
    } else if (b in counts) {
      counts[b] += 1;
    }
    // v2026082237: 'quotations' bucket has no pipeline card — the count lives
    // on the Sent card driven by admin-quotations (refreshQuotationsCard).
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
  // v2026082218: Received/Paid card is owned by refreshQuotationsCard() (uses
  // quote-based paid data). Do NOT overwrite it from the leads pipeline bucket,
  // otherwise the paid count keeps getting stomped to 0.
  const uEl = $("#topcnt_unassigned"); if (uEl) uEl.textContent = counts.unassigned;
  const frEl = document.getElementById("topcnt_followright"); if (frEl) frEl.textContent = counts.followRight;
  const fwEl = document.getElementById("topcnt_followwrong"); if (fwEl) fwEl.textContent = counts.followWrong;

  // v2026082206: Total-Leads card = Manual + Website + Forwarded (mutually exclusive).
  //   Forwarded = pipeline_leads.is_forwarded (new lead born from another's forward)
  //   Manual    = !is_forwarded AND latest_event starts with "manual_add"
  //   Website   = everything else (unassigned inbound + all other origins)
  // Also drives the standalone "Forwarded" top card between Unassigned and New leads.
  let totalManual = 0, totalWebsite = 0, totalForwarded = 0;
  filteredPipeline().forEach((l) => {
    if (l.is_forwarded) { totalForwarded += 1; return; }
    const ev = String(l.latest_event || "");
    if (ev.startsWith("manual_add")) totalManual += 1;
    else totalWebsite += 1;
  });
  const totalAll = totalManual + totalWebsite + totalForwarded;
  const mEl = document.getElementById("topcnt_totmanual");
  const wEl = document.getElementById("topcnt_totwebsite");
  const fEl = document.getElementById("topcnt_totforwarded");
  const tEl = document.getElementById("topcnt_totall");
  if (mEl) mEl.textContent = totalManual;
  if (wEl) wEl.textContent = totalWebsite;
  if (fEl) fEl.textContent = totalForwarded;
  if (tEl) tEl.textContent = totalAll;
  const fwdCardEl = document.getElementById("topcnt_forwarded");
  if (fwdCardEl) fwdCardEl.textContent = totalForwarded;
}

// v2026082019: Origin filter is exposed only on Follow Ups / Quotations / Paid.
// Everywhere else (Add / Unassigned / New) the filter is intentionally ignored
// so switching it doesn't shift counts on tabs where it isn't visible.
function isOriginFilterTab(top) {
  return top === "follow" || top === "quotations" || top === "done";
}
function applyOriginFilter(rows) {
  if (!originFilter) return rows;
  if (originFilter === "forwarded")  return rows.filter((l) => !!l.is_forwarded);
  if (originFilter === "direct")     return rows.filter((l) => !l.is_forwarded);
  if (originFilter === "reassigned") return rows.filter((l) => l.customer_key && _reassignedFromMap.has(l.customer_key));
  return rows;
}

// Pipeline filtered by active date range (uses last_event_at).
// NOTE: Origin filter is NOT applied here — callers apply it via
// applyOriginFilter() at the point where they know they're rendering rows /
// counting a tab that exposes the Origin filter.
function filteredPipeline() {
  let rows = pipelineCache;
  // v2026082236: hide site-direct purchases from the leads01 pipeline. A lead
  // whose manual_status is 'won' but has NO quotation ever raised for them =
  // customer signed up + paid on cursive.world directly. Their invoice lives
  // in /invoices; they should NOT clutter the sales pipeline.
  rows = rows.filter((l) => {
    if ((l.manual_status || "") !== "won") return true;
    if (!l.customer_key) return true;
    return _quotedCustomerKeys.has(l.customer_key);
  });
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
    if (f) {
      // v2026082229: always reload iframe + carry date range in the URL so
      // the iframe applies it deterministically even if postMessage races.
      const params = new URLSearchParams();
      if (dateRange.from) params.set("from", dateRange.from);
      if (dateRange.to) params.set("to", dateRange.to);
      params.set("v", String(Date.now()));
      f.onload = () => { try { f.contentWindow?.postMessage({ type: "cursive:date-range", from: dateRange.from, to: dateRange.to }, "*"); } catch {} };
      f.src = "/leads01/quotations/?" + params.toString();
    }
    return;
  }
  // v2026082220-1: Received (data-top="done") + Expected Receivable
  // (data-top="receivable") both route into the Quotations iframe pre-filtered.
  //   Received    → filter=paid
  //   Receivable  → filter=accepted
  // Both views auto-sort latest-first (see quotations page loadList).
  if (top === "done" || top === "receivable") {
    const filterName = (top === "done") ? "paid" : "accepted";
    const f = $("#quotationsFrame");
    if (f) {
      // v2026082229: carry date range in the URL so iframe applies it even
      // if the postMessage races with the iframe's own script boot.
      const params = new URLSearchParams();
      params.set("filter", filterName);
      if (dateRange.from) params.set("from", dateRange.from);
      if (dateRange.to) params.set("to", dateRange.to);
      params.set("v", String(Date.now()));
      f.onload = () => {
        try {
          f.contentWindow?.postMessage({ type: "cursive:date-range", from: dateRange.from, to: dateRange.to }, "*");
          f.contentWindow?.postMessage({ type: "cursive:set-filter", filter: filterName }, "*");
        } catch {}
      };
      f.src = "/leads01/quotations/?" + params.toString();
    }
    paneStage?.classList.add("hidden");
    paneQuot?.classList.remove("hidden");
    document.querySelectorAll(".top-tab").forEach(b => b.classList.toggle("active", b.dataset.top === top));
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
  if (activeTop === "forwarded") subs = [{ id: "all", title: "All forwarded" }];

  // Managers: New/Follow/Paid tabs must EXCLUDE unassigned leads (those live on Unassigned tab).
  // Employees only see leads assigned to them anyway.
  let inBucket;
  if (activeTop === "unassigned")      inBucket = filteredPipeline().filter((l) => !l.assigned_employee_code);
  else if (activeTop === "forwarded")  inBucket = filteredPipeline().filter((l) => !!l.is_forwarded);
  else                                  inBucket = filteredPipeline().filter((l) => bucketOf(l) === activeTop && (!_isManager || !!l.assigned_employee_code));
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
    if (activeTop === "forwarded")  k = "all";
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

      ${leadsCan("bulk_add") ? `<!-- Card B: Bulk add -->
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
      </div>` : ""}
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
          ${leadsCan("bulk_add") ? `<a href="/leads01/bulk-add/" target="_blank" rel="noopener" style="background:#0f766e;color:#fff;padding:6px 12px;border-radius:4px;font-size:12.5px;font-weight:700;text-decoration:none;display:inline-block;">📋 Bulk add</a>` : ""}
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
  let inBucket;
  if (activeTop === "unassigned")     inBucket = filteredPipeline().filter((l) => !l.assigned_employee_code);
  else if (activeTop === "forwarded") inBucket = filteredPipeline().filter((l) => !!l.is_forwarded);
  else                                 inBucket = filteredPipeline().filter((l) => bucketOf(l) === activeTop && (!_isManager || !!l.assigned_employee_code));
  // v2026082019: Origin filter — only meaningful on Follow / Quotations / Paid.
  if (isOriginFilterTab(activeTop)) inBucket = applyOriginFilter(inBucket);
  let rows;
  if (activeTop === "new")    rows = inBucket.filter((l) => newSubOf(l) === activeSub);
  if (activeTop === "follow") rows = inBucket.filter((l) => followSubOf(l) === activeSub);
  if (activeTop === "done")   rows = inBucket;
  if (activeTop === "unassigned") rows = inBucket;
  if (activeTop === "forwarded")  rows = inBucket;

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
  let inBucket;
  if (activeTop === "unassigned")     inBucket = filteredPipeline().filter((l) => !l.assigned_employee_code);
  else if (activeTop === "forwarded") inBucket = filteredPipeline().filter((l) => !!l.is_forwarded);
  else                                 inBucket = filteredPipeline().filter((l) => bucketOf(l) === activeTop && (!_isManager || !!l.assigned_employee_code));
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
      <option value=""           ${originFilter === ""           ? "selected" : ""}>All</option>
      <option value="direct"     ${originFilter === "direct"     ? "selected" : ""}>Direct only</option>
      <option value="forwarded"  ${originFilter === "forwarded"  ? "selected" : ""}>Forwarded only</option>
      <option value="reassigned" ${originFilter === "reassigned" ? "selected" : ""}>&#128257; Reassigned only</option>
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

  // Latest customer name (v43 pipeline enrichment; empty if never set)
  const latestName = (l.customer_name || "").trim();
  // Contact cell HTML: latest name + email + mobile + WhatsApp + Add contact button
  const contactCell = `
    <div style="font-size:12.5px;line-height:1.4;">
      ${latestName ? `<div style="font-weight:700;color:#0f172a;font-size:13px;">👤 ${esc(latestName)}</div>` : `<div class="muted-small" style="color:#94a3b8;">no name yet</div>`}
      ${latestEmail ? `<div><a href="mailto:${esc(latestEmail)}" style="color:#0f766e;">${esc(latestEmail)}</a></div>` : `<div class="muted-small">no email</div>`}
      ${latestMobile ? `<div class="muted-small" style="color:#0f172a;font-weight:600;">📱 ${esc(latestMobile)}</div>` : ""}
      ${(l.whatsapp && l.whatsapp !== latestMobile) ? `<div class="muted-small" style="color:#065f46;">💬 ${esc(l.whatsapp)}</div>` : ""}
      ${readOnly ? "" : `<button data-action="edit-contact" data-customer-key="${cur}" data-name="${esc(latestName)}" data-email="${esc(latestEmail)}" data-mobile="${esc(latestMobile)}" data-whatsapp="${esc(l.whatsapp || '')}" style="margin-top:4px;background:transparent;border:1px dashed #94a3b8;color:#475569;padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer;">＋ Add / Update contact</button>`}
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
  // v2026082201: legacy inline "History" chip removed — the 5 tab pills in
  // the Remarks cell now cover the full history including forwards.
  const historyBtn = "";
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
  // v2026082201: legacy History chip removed — 5-tab pills in Remarks cell cover it.
  const historyBtnInCell = "";
  // v2026082019: Forwarded chip. Shown on every row (any tab) whose backing
  // lead_overrides row has is_forwarded=true — i.e. this pipeline lead was
  // auto-created when a manager added a service that the previous assignee
  // couldn't handle. Sits next to the assignee chip so it's obvious at a
  // glance who inherited it and why.
  const forwardedChip = l.is_forwarded
    ? `<span title="This lead was auto-forwarded from another service." style="display:inline-block;margin-top:3px;padding:2px 7px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:10px;font-size:10.5px;font-weight:700;letter-spacing:.2px;align-self:flex-start;">&#8618; Forwarded</span>`
    : "";
  // v2026082237: chip shown when the lead was moved to this employee because
  // the previous assignee lost this service (admin removed the service from
  // their profile → DB trigger reassigns → history row w/ reason
  // 'service_removed_from_employee'). Data comes from _reassignedFromMap
  // (populated on each refreshAll via RPC latest_service_removed_reassigns).
  const reassignedInfo = _reassignedFromMap.get(l.customer_key);
  const reassignedChip = reassignedInfo && reassignedInfo.from_code
    ? `<span title="Reassigned automatically: previous assignee (${esc(reassignedInfo.from_code)}) lost this service." style="display:inline-block;margin-top:3px;padding:2px 7px;background:#f5f3ff;color:#6d28d9;border:1px solid #c4b5fd;border-radius:10px;font-size:10.5px;font-weight:700;letter-spacing:.2px;align-self:flex-start;">&#128257; Reassigned from ${esc(reassignedInfo.from_code)}</span>`
    : "";
  let empCellHtml = `<div style="display:flex;flex-direction:column;gap:3px;">
      <span title="Assigned employee (read-only — use Forward to reassign)" style="display:inline-block;padding:3px 9px;background:${asnChipBg};color:${asnChipFg};border:1px solid ${asnChipBd};border-radius:10px;font-size:11px;font-weight:700;letter-spacing:.2px;">${esc(asnDisplay)}</span>
      ${forwardedChip}
      ${reassignedChip}
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
        <!-- Row title removed — chips below (renderServicesCell) include primary + additions, all with ×. -->
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

  // Editable row — v2026082025: dropdown options are filtered by a
  // 3-mode rule based on active-services / pending-adds / assignee coverage
  // (see statusModeForRow). This replaces the older per-sub-tab state machine
  // for the row-level dropdown so the manager always sees exactly the right
  // subset (positives OR negatives OR just ↪ Forward).
  const rowMode = statusModeForRow(l);
  // Terminal state only makes sense in Mode A/B where the sub-tab's own
  // STATUS_TRANSITIONS list is empty (e.g. already_purchased row on Follow Ups).
  const legacyAllowed = allowedStatusesFor(l);
  const isTerminal = (activeTop === "follow") && rowMode !== "C" && legacyAllowed.length === 0;
  const statusOpts = isTerminal
    ? `<option value="">— no further moves —</option>`
    : buildModeStatusOptionsHtml(rowMode, statusValue);

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
      <!-- Row title removed — chips below cover primary + additions, all crossable. -->
      ${servicesCell}
      ${l.is_stale ? `<span class="stale-tag">stale</span>` : ""}
    </td>
    <td>${contactCell}</td>
    <td>
      <div>${esc(ageStr)} ago</div>
      <div class="muted-small">${esc(fmtDate(l.last_event_at))} ${esc(fmtTime(l.last_event_at))}</div>
      <div style="margin-top:6px;">${callBtn}${waBtn}</div>
    </td>
    ${hideStatusCell ? "" : (showQuoteBtn
      ? `<td style="text-align:center;">${quoteBtn}</td>`
      : `<td>
      <select class="status-select" data-customer-key="${cur}" ${(isTerminal || !leadsCan("edit_status")) ? "disabled" : ""}>${statusOpts}</select>
    </td>`)}
    <td>${empCellHtml}</td>
    <td>${remarksCell}</td>
    ${hideStatusCell ? "" : `<td>
      <div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;">
        ${isTerminal
          ? `<span class="muted-small">Terminal state</span>`
          : (!leadsCan("save_forward")
             ? `<span class="muted-small" title="Ask a super-admin to enable the 'Save + Forward' sub-action.">🔒 Save disabled by permission</span>`
             : ((leadsCan("edit_status") || leadsCan("reassign"))
                ? `<button class="row-save-btn" data-action="save-and-forward" data-customer-key="${cur}" disabled style="opacity:.4;cursor:not-allowed;pointer-events:none;padding:7px 14px;background:linear-gradient(90deg,#2563eb 0%,#f97316 100%);color:#fff;border:0;border-radius:5px;font-size:12.5px;font-weight:700;">💾 Save + Forward</button>`
                : `<span class="muted-small" title="You don't have edit or reassign permission">Read-only</span>`))}
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

// v2026082025: Count of currently-active services on a lead.
// Prefers services_detail (rich rows), falls back to services_active array,
// then to service_type as a last-resort synthetic single row.
function activeServicesCount(lead) {
  const detail = Array.isArray(lead.services_detail) ? lead.services_detail : [];
  if (detail.length > 0) return detail.filter((x) => x.is_active).length;
  if (Array.isArray(lead.services_active)) return lead.services_active.length;
  if (lead.service_type) return 1;
  return 0;
}

// v2026082026: 3-mode status dropdown decision.
// Mode A — activeCount > 0 AND pendingCount === 0. Positives.
// Mode B — activeCount === 0 AND pendingCount === 0. Negatives (incl. already_purchased).
// Mode C — pendingCount > 0. Only the Interested option is shown; Save + Forward
//   still per-service routes any pendings the assignee doesn't handle to the
//   receiving employee under the hood.
function statusModeForRow(lead) {
  const activeCount = activeServicesCount(lead);
  const pendingCount = Array.isArray(_pendingServiceAdds[lead.customer_key])
    ? _pendingServiceAdds[lead.customer_key].length
    : 0;
  if (pendingCount > 0) return "C";
  if (activeCount === 0) return "B";
  return "A";
}

// v2026082026: build the row status dropdown options based on the 3 modes.
// Mode C shows ONLY the "Interested" option (the save handler still per-service
// forwards pending adds under the hood). Modes A/B emit their respective
// allow-lists. The lead's current talk_status is preserved as a disabled
// "(current)" entry when it's not in the allowed set — this keeps the dropdown
// non-empty for legacy rows that already sit on hidden statuses.
function buildModeStatusOptionsHtml(mode, currentValue) {
  if (mode === "C") {
    return `<option value="interested" selected>Interested</option>`;
  }
  let allowed = (mode === "B") ? STATUS_MODE_B : STATUS_MODE_A;
  // v2026082208: on the Interested sub-tab, only show Interested + Send Quote —
  // hide Call not picked / Call me later since the lead is already past that step.
  if (activeTop === "follow" && activeSub === "interested" && mode !== "B") {
    allowed = ["interested", "in_progress"];
  }
  const opts = [`<option value="">— select —</option>`];
  const currentOpt = TALK_STATUS_OPTIONS.find((o) => o.value === currentValue);
  if (currentOpt && currentOpt.value && !allowed.includes(currentValue)) {
    opts.push(`<option value="${currentOpt.value}" selected disabled>${esc(currentOpt.label)} (current)</option>`);
  }
  allowed.forEach((id) => {
    const o = TALK_STATUS_OPTIONS.find((x) => x.value === id);
    if (!o) return;
    const sel = (id === currentValue) ? "selected" : "";
    opts.push(`<option value="${o.value}" ${sel}>${esc(o.label)}</option>`);
  });
  return opts.join("");
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
    // v2026082201: Per-row Lead History tab pills replace the old
    // "+ Add remark" / "Rate" buttons and the redundant "History" chip.
    // Every pill opens the History modal focused on that filter — All,
    // Remarks, Ratings, Forwards, or Quote.
    const tabPill = (label, tab, bg = "#fff", fg = "#334155", bd = "#cbd5e1") =>
      `<button type="button" data-action="show-lead-history-tab" data-tab="${tab}" data-customer-key="${cur}" style="padding:3px 9px;font-size:11px;font-weight:700;border-radius:12px;border:1px solid ${bd};background:${bg};color:${fg};cursor:pointer;">${label}</button>`;
    html += `<div class="add-remark-wrap" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;">
      ${tabPill("All", "all", "#1f6feb", "#fff", "#1f6feb")}
      ${tabPill("💬 Remarks", "remark")}
      ${tabPill("⭐ Ratings", "star")}
      ${tabPill("↔️ Forwards", "assign")}
      ${tabPill("📋 Quote", "quote")}
    </div>`;
  }

  return html;
}

function bucketReason(l) {
  if (l.manual_status === "won") return "won";
  if (l.latest_event === "payment_completed") return "paid via Razorpay";
  if (l.latest_event === "wallet_recharged") return "wallet recharged";
  return "completed";
}

let _paneClickAttached = false;
function wireRowHandlers() {
  // On initial render, refresh Save-and-Forward gate for every visible row so
  // Mode C rows (where "Interested" is auto-selected) don't stay disabled.
  document.querySelectorAll("#paneStage tr[data-customer-key]").forEach((tr) => {
    refreshRowSaveGate(tr);
  });
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
        name: target.dataset.name || "",
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
      if (!leadsCan("add_service")) return;
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
      if (!leadsCan("add_service")) return;
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
      if (!leadsCan("remove_services")) return;
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
    if (action === "show-lead-history-tab") {
      // v2026082201: per-row tab pills open the same history modal focused
      // on the clicked tab (all / remark / star / assign / quote).
      const tab = target.dataset.tab || "all";
      await showAssignmentHistoryModal(key, tab);
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
      // v2026082026: Mode C locks the dropdown to "interested" (the save
      // handler still per-service forwards pending adds under the hood). All
      // three modes now emit a real talk_status value — no synthetic sentinel.
      const rawStatus = sel ? sel.value : "";
      let talk_status = rawStatus || null;
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
            forwardedTo.push({ service: svc, empCode: first.employee_code || "?", customerKey: first.customer_key || "" });
          } else {
            stayedSvcs.push(svc);
          }
        } catch (err) {
          addErrors.push({ service: svc, msg: err.message || "failed" });
        }
      }

      // v2026082026: No more special "forwarded_away" routing — whatever the
      // user picked in the dropdown (Mode A/B) or the locked "interested"
      // (Mode C) is the source of truth. Per-service forwards happened above
      // and produce their own new pipeline rows; the current lead just keeps
      // the chosen talk_status.

      // Step 2: save the call-status. If this fails we still want the toast
      // to reflect anything that already happened above, so we don't bail early.
      let statusSaved = false;
      let statusError = null;
      if (talk_status) {
        try {
          await callAdmin("set_lead_status", { customer_key: key, talk_status });
          const idx = pipelineCache.findIndex((x) => x.customer_key === key);
          if (idx >= 0) pipelineCache[idx].talk_status = talk_status;
          statusSaved = true;
        } catch (err) {
          statusError = err.message || "failed";
        }
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
      // v2026082028: Only ERROR cases pop an alert. Success shows an inline
      // green tick on the button briefly (see below); no interrupting popup.
      const hasErrors = addErrors.length > 0 || !!statusError;
      if (hasErrors) {
        alert(lines.join("\n"));
      } else {
        // Inline green tick on the button that just fired.
        try {
          const btn = tr.querySelector(".row-save-btn");
          if (btn) {
            const originalHtml = btn.innerHTML;
            const originalStyle = btn.getAttribute("style") || "";
            btn.innerHTML = "✓ Saved";
            btn.style.background = "#16a34a";
            btn.disabled = true;
            setTimeout(() => {
              // Row may have been re-rendered by refresh; only restore if still in DOM.
              if (document.body.contains(btn)) {
                btn.innerHTML = originalHtml;
                btn.setAttribute("style", originalStyle);
                btn.disabled = false;
              }
            }, 1200);
          }
        } catch {}
      }

      // Step 4: clear pending queue for this row (only if the add call was
      // attempted — leave any items with real errors so the user can retry).
      if (addErrors.length === 0) {
        delete _pendingServiceAdds[key];
      } else {
        _pendingServiceAdds[key] = addErrors.map((e) => e.service);
      }

      // Step 5: refresh pipeline + re-render.
      // v2026082030: If any forward actually created new leads, do a full page
      // reload after showing the ✓ Saved animation. Sidesteps every possible
      // cache/state mismatch and guarantees FOLLOW UPS reflects all N new
      // forwarded leads. No forwards = in-place refresh only (fast).
      const hadForwards = forwardedTo.length > 0;
      if (hadForwards) {
        setTimeout(() => location.reload(), 900);
      } else {
        try { pipelineCache = await callAdmin("pipeline"); } catch {}
        updateTopCounts();
        renderActive();
      }

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
      ${fieldRow("Name",     "👤", current.name || "", "cuName",  "Customer name",       "")}
      ${fieldRow("Email",    "📧", current.email,    "cuEmail",    "customer@email.com",  "")}
      ${fieldRow("Mobile",   "📱", current.mobile,   "cuMobile",   "10-digit mobile",     "")}
      ${fieldRow("WhatsApp", "💬", current.whatsapp || current.mobile, "cuWhatsapp", "10-digit WhatsApp number", current.whatsapp ? "" : "Currently defaulting to mobile. Add here to use a separate WhatsApp number going forward.")}
      <div id="cuMsg" style="font-size:12px;margin-top:6px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button id="cuSaveAll" style="background:#059669;color:#fff;padding:8px 16px;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer;">💾 Save All</button>
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

  // 2026-08-21: live ALL-CAPS validation for Name + Email. When lowercase is
  // detected the input goes red, the row's per-field Save button is disabled
  // and the shared Save All button is disabled with a red hint. Clears the
  // moment the field is fully uppercase (or empty).
  function attachCapsGuard(fieldId, label) {
    const input = document.getElementById(fieldId + "Input");
    if (!input) return;
    const saveBtn = overlay.querySelector(`[data-savefield="${fieldId}"]`);
    const saveAllBtn = document.getElementById("cuSaveAll");
    const msg = document.getElementById("cuMsg");
    const recompute = () => {
      const v = (input.value || "").trim();
      const bad = /[a-z]/.test(v);
      if (bad) {
        input.style.border = "2px solid #dc2626";
        input.style.background = "#fef2f2";
        if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = "0.4"; saveBtn.style.cursor = "not-allowed"; }
        if (saveAllBtn) { saveAllBtn.disabled = true; saveAllBtn.style.opacity = "0.4"; saveAllBtn.style.cursor = "not-allowed"; }
        msg.style.color = "#dc2626";
        msg.textContent = label + " must be in CAPITAL letters. Please retype in ALL CAPS.";
      } else {
        input.style.border = "1px solid #cbd5e1";
        input.style.background = "";
        if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = ""; saveBtn.style.cursor = "pointer"; }
        // Only re-enable Save All if NEITHER name nor email have lowercase
        const nameV = (document.getElementById("cuNameInput")?.value || "").trim();
        const emailV = (document.getElementById("cuEmailInput")?.value || "").trim();
        if (!/[a-z]/.test(nameV) && !/[a-z]/.test(emailV) && saveAllBtn) {
          saveAllBtn.disabled = false; saveAllBtn.style.opacity = ""; saveAllBtn.style.cursor = "pointer";
        }
        if (msg.textContent && msg.textContent.startsWith(label + " must")) {
          msg.textContent = ""; msg.style.color = "";
        }
      }
    };
    input.addEventListener("input", recompute);
    input.addEventListener("blur", recompute);
  }
  attachCapsGuard("cuName", "Name");
  attachCapsGuard("cuEmail", "Email");

  // 2026-08-21: live 10-digit guard for Mobile + WhatsApp. Anything other than
  // exactly 10 digits turns the input red and disables that field's Save +
  // the shared Save All button.
  function attachTenDigitGuard(fieldId, label) {
    const input = document.getElementById(fieldId + "Input");
    if (!input) return;
    const saveBtn = overlay.querySelector(`[data-savefield="${fieldId}"]`);
    const saveAllBtn = document.getElementById("cuSaveAll");
    const msg = document.getElementById("cuMsg");
    const recompute = () => {
      const digits = (input.value || "").replace(/\D/g, "");
      const raw = (input.value || "").trim();
      const bad = raw && digits.length !== 10;
      if (bad) {
        input.style.border = "2px solid #dc2626";
        input.style.background = "#fef2f2";
        if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = "0.4"; saveBtn.style.cursor = "not-allowed"; }
        if (saveAllBtn) { saveAllBtn.disabled = true; saveAllBtn.style.opacity = "0.4"; saveAllBtn.style.cursor = "not-allowed"; }
        msg.style.color = "#dc2626";
        msg.textContent = label + " must be exactly 10 digits (got " + digits.length + ").";
      } else {
        input.style.border = "1px solid #cbd5e1";
        input.style.background = "";
        if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = ""; saveBtn.style.cursor = "pointer"; }
        // Re-enable Save All only if every guarded field is clean.
        const mV = (document.getElementById("cuMobileInput")?.value || "").replace(/\D/g, "");
        const wV = (document.getElementById("cuWhatsappInput")?.value || "").replace(/\D/g, "");
        const nameV = (document.getElementById("cuNameInput")?.value || "").trim();
        const emailV = (document.getElementById("cuEmailInput")?.value || "").trim();
        const mobOk = !(document.getElementById("cuMobileInput")?.value || "").trim() || mV.length === 10;
        const waOk  = !(document.getElementById("cuWhatsappInput")?.value || "").trim() || wV.length === 10;
        if (!/[a-z]/.test(nameV) && !/[a-z]/.test(emailV) && mobOk && waOk && saveAllBtn) {
          saveAllBtn.disabled = false; saveAllBtn.style.opacity = ""; saveAllBtn.style.cursor = "pointer";
        }
        if (msg.textContent && msg.textContent.startsWith(label + " must be exactly")) {
          msg.textContent = ""; msg.style.color = "";
        }
      }
    };
    input.addEventListener("input", recompute);
    input.addEventListener("blur", recompute);
  }
  attachTenDigitGuard("cuMobile", "Mobile");
  attachTenDigitGuard("cuWhatsapp", "WhatsApp");

  const doSave = async (id, btn) => {
    const input = document.getElementById(id + "Input");
    let raw = (input.value || "").trim();
    if (!raw) return;
    // Names AND emails must be typed in ALL CAPITAL letters (policy 2026-08-21).
    // Reject anything containing a lowercase letter so users can't half-cap by accident.
    if ((id === "cuName" || id === "cuEmail") && /[a-z]/.test(raw)) {
      const msg = document.getElementById("cuMsg");
      msg.style.color = "#dc2626";
      msg.textContent = (id === "cuEmail" ? "Email" : "Name") + " must be in CAPITAL letters. Please retype in ALL CAPS.";
      return;
    }
    const payload = { customer_key: current.customer_key };
    if (id === "cuName")     payload.name     = raw.slice(0, 120);
    if (id === "cuEmail")    payload.email    = raw; // preserve CAPS as user typed
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

  // 2026-08-21: Save All — batch-save every field whose input has a non-empty
  // value. Runs the same validation (ALL-CAPS name/email) and hits the same
  // update_lead_contact op in one call.
  document.getElementById("cuSaveAll").addEventListener("click", async () => {
    const msg = document.getElementById("cuMsg");
    msg.textContent = ""; msg.style.color = "";
    const payload = { customer_key: current.customer_key };
    const errs = [];
    const getVal = (id) => (document.getElementById(id + "Input")?.value || "").trim();
    const nameV = getVal("cuName");
    const emailV = getVal("cuEmail");
    const mobV = getVal("cuMobile");
    const waV  = getVal("cuWhatsapp");
    if (nameV) {
      if (/[a-z]/.test(nameV)) errs.push("Name must be in CAPITAL letters.");
      else payload.name = nameV.slice(0, 120);
    }
    if (emailV) {
      if (/[a-z]/.test(emailV)) errs.push("Email must be in CAPITAL letters.");
      else payload.email = emailV;
    }
    if (mobV) payload.mobile = mobV.replace(/\D/g, "");
    if (waV)  payload.whatsapp = waV.replace(/\D/g, "");
    if (errs.length) { msg.style.color = "#dc2626"; msg.textContent = errs.join(" "); return; }
    // Nothing typed? Nothing to save.
    if (!payload.name && !payload.email && !payload.mobile && !payload.whatsapp) {
      msg.style.color = "#64748b"; msg.textContent = "Nothing to save — type into at least one field."; return;
    }
    const btn = document.getElementById("cuSaveAll");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await callAdmin("update_lead_contact", payload);
      pipelineCache = await callAdmin("pipeline");
      updateTopCounts();
      renderActive();
      // Reload history and clear inputs
      await loadAndRenderHistory(current.customer_key);
      ["cuName","cuEmail","cuMobile","cuWhatsapp"].forEach(id => {
        const inp = document.getElementById(id + "Input");
        if (inp) inp.value = "";
        document.getElementById(id + "Wrap")?.classList.add("hidden");
      });
      msg.style.color = "#059669"; msg.textContent = "✓ Saved all fields. History updated below.";
    } catch (err) {
      msg.style.color = "#dc2626"; msg.textContent = "Save failed: " + (err.message || err);
    } finally {
      btn.disabled = false; btn.innerHTML = "💾 Save All";
    }
  });

  // Load and render history under each field
  await loadAndRenderHistory(current.customer_key);
}

async function loadAndRenderHistory(customerKey) {
  try {
    const history = await callAdmin("contact_history", { customer_key: customerKey });
    const byField = { name: [], email: [], mobile: [], whatsapp: [] };
    (history || []).forEach((h) => { if (byField[h.field]) byField[h.field].push(h); });
    // If a name has been saved, update the "latest" label AND the visible
    // value at the top of the Name row (initial value is empty in the DB).
    const newestName = byField.name[0];
    if (newestName?.new_value) {
      const nameHeaderRow = document.querySelector("#cuNameLatestTs")?.parentElement;
      if (nameHeaderRow) {
        const strong = nameHeaderRow.querySelector("div:nth-child(2)");
        if (strong) strong.textContent = newestName.new_value;
      }
    }
    // Latest timestamp per field goes next to the LATEST value at top
    const setLatestTs = (elId, list) => {
      const el = document.getElementById(elId);
      if (!el) return;
      const newest = list[0];
      el.innerHTML = newest ? `Updated ${esc(fmtDate(newest.changed_at))} ${esc(fmtTime(newest.changed_at))}` : "(initial value — never updated)";
    };
    setLatestTs("cuNameLatestTs",     byField.name);
    setLatestTs("cuEmailLatestTs",    byField.email);
    setLatestTs("cuMobileLatestTs",   byField.mobile);
    setLatestTs("cuWhatsappLatestTs", byField.whatsapp);
    renderHistoryList("cuNameHistory",     byField.name);
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

  const canRemoveSvc = leadsCan("remove_services");
  const activeChips = active.map((s) => {
    const svcVal = String(s.service || "").toLowerCase();
    const rmBtn = (readOnly || !canRemoveSvc) ? "" : `<button data-action="remove-service" data-customer-key="${cur}" data-service="${esc(svcVal)}" title="Remove ${esc(svcLabel(svcVal))}" style="margin-left:4px;background:transparent;border:0;color:#7c2d12;font-weight:700;cursor:pointer;font-size:11px;line-height:1;">✕</button>`;
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
  // + Add service dropdown gated on both 'add_service' (dedicated sub-action)
  // AND 'reassign' (adding a service can trigger a forward). Managers only.
  const canAddSvc = leadsCan("add_service");
  const addSvcHtml = (readOnly || !canAddSvc || availableSvcs.length === 0) ? "" : `
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
      updateTopCounts();
      renderActive();
      // Auto-close the modal after successful save
      document.getElementById("starRatingOverlay")?.remove();
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
async function showAssignmentHistoryModal(customerKey, initialTab = "all") {
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
  // Resolve an email to the matching employee's code+name. Returns "" if not an employee.
  const empByEmail = (email) => {
    if (!email) return null;
    const hit = (_allEmployeesCache || []).find((e) => String(e.email || "").toLowerCase() === String(email).toLowerCase());
    return hit || null;
  };
  // Show WHO performed the action as employee chip if we can resolve them; else fall back to "the system".
  const byActorChip = (email) => {
    if (!email || email === "system") return `<span style="color:#94a3b8;font-style:italic;">the system</span>`;
    const emp = empByEmail(email);
    if (emp) {
      return `<span style="display:inline-block;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;padding:2px 8px;border-radius:5px;font-weight:700;font-size:12px;">${esc(emp.code)}${emp.name ? ` <span style="font-weight:500;">— ${esc(emp.name)}</span>` : ""}</span>`;
    }
    // Admin user (super) not in employees table
    return `<span style="display:inline-block;background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;padding:2px 8px;border-radius:5px;font-weight:700;font-size:12px;">👤 Admin</span>`;
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

  // Unified timeline (v2026082102): identical style/data to the Quotations page —
  // remarks + stars + assignments + service events + quote-status logs merged in
  // one feed. Uses lead_unified_history from admin-data v41 which enriches every
  // event with the actor's CODE+Name so we never display raw emails.
  const overlay = document.createElement("div");
  overlay.id = "asnHistoryOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:22px 24px;max-width:720px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 50px rgba(15,23,42,.35);">
      <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:4px;">📜 Lead history</div>
      <div style="color:#475569;font-size:13px;margin-bottom:12px;">Contact <b>${esc(rawContact || "—")}</b> · Service <b>${esc(svcNice)}</b></div>
      <!-- Tabs -->
      <div id="asnHistoryTabs" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;">
        <button type="button" data-asntab="all"    class="asntab active" style="padding:5px 11px;font-size:12px;font-weight:700;border-radius:14px;border:1px solid #cbd5e1;background:#1f6feb;color:#fff;cursor:pointer;">All</button>
        <button type="button" data-asntab="remark" class="asntab" style="padding:5px 11px;font-size:12px;font-weight:700;border-radius:14px;border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer;">💬 Remarks</button>
        <button type="button" data-asntab="star"   class="asntab" style="padding:5px 11px;font-size:12px;font-weight:700;border-radius:14px;border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer;">⭐ Ratings</button>
        <button type="button" data-asntab="assign" class="asntab" style="padding:5px 11px;font-size:12px;font-weight:700;border-radius:14px;border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer;">↔️ Forwards</button>
        <button type="button" data-asntab="quote"  class="asntab" style="padding:5px 11px;font-size:12px;font-weight:700;border-radius:14px;border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer;">📋 Quote</button>
      </div>
      <div id="asnHistoryAddRow" style="display:flex;gap:8px;margin-bottom:12px;">
        <button id="asnAddRemarkBtn" type="button" style="flex:1;background:#0ea5e9;color:#fff;border:none;border-radius:6px;padding:9px 12px;font-size:13px;font-weight:700;cursor:pointer;">💬 + Remark</button>
        <button id="asnAddStarBtn" type="button" style="flex:1;background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:9px 12px;font-size:13px;font-weight:700;cursor:pointer;">⭐ + Rating</button>
      </div>
      <div id="asnHistoryList" style="font-size:13px;color:#334155;">Loading…</div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px;">
        <button id="asnHistoryClose" style="background:#1f6feb;color:#fff;padding:8px 16px;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const cleanup = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });
  overlay.querySelector("#asnHistoryClose").onclick = cleanup;

  // Emp chip (CODE — Name), matching quotations page. `info` = {code, name} | null.
  const empChipUnified = (info, tone) => {
    if (!info || (!info.code && !info.name)) {
      return `<span style="color:#94a3b8;font-style:italic;">Admin</span>`;
    }
    const bg = tone === "to"   ? "background:#dcfce7;color:#166534;border:1px solid #86efac;"
             : tone === "from" ? "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;"
             : "background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;";
    const code = info.code ? `<b>${esc(info.code)}</b>` : "";
    const name = info.name ? ` — ${esc(info.name)}` : "";
    return `<span style="display:inline-block;${bg}padding:2px 8px;border-radius:5px;font-size:12px;font-weight:600;white-space:nowrap;">${code}${name}</span>`;
  };
  const niceSvc = (code) => {
    if (!code) return "—";
    const hit = (typeof SERVICES !== "undefined" ? SERVICES : []).find(s => String(s.value).toLowerCase() === String(code).toLowerCase());
    return hit ? hit.label : String(code);
  };
  const fmtWhen = (iso) => `${esc(fmtDate(iso))} · ${esc(fmtTime(iso))}`;

  function renderUnifiedEvents(events) {
    const listEl = document.getElementById("asnHistoryList");
    if (!events || events.length === 0) {
      listEl.innerHTML = `<div style="padding:16px;color:#94a3b8;text-align:center;background:#f8fafc;border-radius:6px;">No history yet. Add a remark or star to start the timeline.</div>`;
      return;
    }
    const iconMap = { remark:"💬", star:"⭐", assign:"↔️", service:"🧩", quote:"📋" };
    const colorMap = { remark:"#0ea5e9", star:"#f59e0b", assign:"#7c3aed", service:"#059669", quote:"#1f6feb" };
    let html = "";
    for (const ev of events) {
      const isQuoteRemark = ev.type === "remark" && ev.header && /^Quote /.test(ev.header);
      const kind = isQuoteRemark ? "quote" : ev.type;
      const icon = iconMap[kind] || "•";
      const color = colorMap[kind] || "#64748b";
      let body = "";
      if (ev.type === "star") {
        const filled = "★".repeat(ev.stars || 0);
        const empty = "☆".repeat(5 - (ev.stars || 0));
        body = `<span style="color:#f59e0b;font-size:16px;letter-spacing:1px;">${filled}<span style="color:#e2e8f0;">${empty}</span></span>${ev.text ? ` <span style="color:#334155;">— ${esc(ev.text)}</span>` : ""}`;
      } else if (ev.type === "assign") {
        body = `
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:4px;">
            ${empChipUnified(ev.from, "from")}
            <span style="color:#64748b;">→</span>
            ${empChipUnified(ev.to, "to")}
          </div>
          <div style="font-size:12px;color:#475569;">${esc(ev.reason_label || ev.reason_code || "changed")}</div>`;
      } else if (ev.type === "service") {
        const isAdd = ev.action === "added";
        body = `<span style="font-weight:700;color:${isAdd?"#059669":"#dc2626"};">${isAdd?"➕ Added":"✖ Removed"}</span> service: <b>${esc(niceSvc(ev.service))}</b>`;
      } else {
        body = esc(ev.text || "");
      }
      // v2026082223: Quote-tagged events now show the quote amount inline.
      let headerText = ev.header || "";
      if (isQuoteRemark && ev.quote_total_paise != null) {
        const fmtAmt = "₹" + (Math.round(ev.quote_total_paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        headerText = `${ev.header} · ${fmtAmt}`;
      }
      const header = ev.header ? `<span style="background:${color}15;color:${color};padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700;margin-right:6px;">${esc(headerText)}</span>` : "";
      const byLine = ev.by ? `<div style="font-size:11.5px;color:#64748b;margin-top:5px;">by ${empChipUnified(ev.by, null)}</div>` : "";
      html += `
        <div style="border-left:3px solid ${color};padding:8px 12px;margin-bottom:10px;background:#f8fafc;border-radius:0 8px 8px 0;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:3px;">
            <span style="font-size:11.5px;font-weight:700;color:${color};">${icon} ${kind.toUpperCase()}</span>
            <span style="font-size:11px;color:#94a3b8;">${fmtWhen(ev.at)}</span>
          </div>
          <div style="font-size:13px;color:#0f172a;line-height:1.45;">${header}${body}</div>
          ${byLine}
        </div>`;
    }
    listEl.innerHTML = html;
  }

  // Tab state for this modal instance
  let _asnEvents = [];
  let _asnTab = initialTab || "all";
  function filterAsnByTab(events, tab) {
    if (tab === "all") return events;
    if (tab === "quote") return events.filter(ev => ev.type === "remark" && ev.header && /^Quote /.test(ev.header));
    if (tab === "remark") return events.filter(ev => ev.type === "remark" && !(ev.header && /^Quote /.test(ev.header)));
    return events.filter(ev => ev.type === tab);
  }
  function applyAsnTab(tab) {
    _asnTab = tab;
    overlay.querySelectorAll("#asnHistoryTabs .asntab").forEach(b => {
      const active = b.dataset.asntab === tab;
      b.style.background = active ? "#1f6feb" : "#fff";
      b.style.color = active ? "#fff" : "#334155";
    });
    const row = overlay.querySelector("#asnHistoryAddRow");
    const rBtn = overlay.querySelector("#asnAddRemarkBtn");
    const sBtn = overlay.querySelector("#asnAddStarBtn");
    if (row && rBtn && sBtn) {
      // Add buttons only appear when the relevant tab is selected — 'All' hides them.
      if (tab === "remark")      { row.style.display = "flex"; rBtn.style.display = ""; sBtn.style.display = "none"; }
      else if (tab === "star")   { row.style.display = "flex"; rBtn.style.display = "none"; sBtn.style.display = ""; }
      else                        { row.style.display = "none"; }
    }
    renderUnifiedEvents(filterAsnByTab(_asnEvents, tab));
  }
  overlay.querySelectorAll("#asnHistoryTabs .asntab").forEach(b => {
    b.addEventListener("click", () => applyAsnTab(b.dataset.asntab));
  });
  // v2026082202: apply the initial tab BEFORE the async fetch so we never
  // flash the wrong add-row / active pill for the loading window.
  applyAsnTab(_asnTab);

  async function loadUnifiedHistory() {
    try {
      const res = await callAdmin("lead_unified_history", { customer_key: customerKey });
      _asnEvents = (res && res.events) || [];
      applyAsnTab(_asnTab);
    } catch (err) {
      document.getElementById("asnHistoryList").innerHTML = `<div style="color:#991b1b;padding:12px;background:#fef2f2;border-radius:6px;">Load failed: ${esc(err.message || err)}</div>`;
    }
  }

  // + Remark
  overlay.querySelector("#asnAddRemarkBtn").onclick = async () => {
    const text = (prompt("Add a remark (visible on the Quotations screen too):") || "").trim();
    if (!text) return;
    try {
      await callAdmin("add_remark", { customer_key: customerKey, remark: text });
      loadUnifiedHistory();
    } catch (e) { alert("Failed: " + (e.message || e)); }
  };

  // + Rating (1–5)
  overlay.querySelector("#asnAddStarBtn").onclick = async () => {
    const raw = prompt("Star rating (1–5):");
    if (!raw) return;
    const stars = parseInt(raw, 10);
    if (!stars || stars < 1 || stars > 5) { alert("Enter a number between 1 and 5"); return; }
    const note = (prompt("Note (optional):") || "").trim() || null;
    try {
      await callAdmin("add_star_rating", { customer_key: customerKey, stars, note });
      loadUnifiedHistory();
    } catch (e) { alert("Failed: " + (e.message || e)); }
  };

  loadUnifiedHistory();
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
