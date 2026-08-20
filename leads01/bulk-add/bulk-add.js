// cursive /leads01/bulk-add/ — spreadsheet-style bulk lead entry
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8";

// Share the same storageKey as /leads01/ so the user stays signed in.
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cursive_admin_auth" },
});

const $ = (s) => document.querySelector(s);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

// Kept in sync with SERVICES const in ../leads.js.
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

const SOURCES = [
  { value: "call", label: "Call" },
  { value: "wa",   label: "WhatsApp" },
  { value: "ref",  label: "Reference" },
];

const ROW_BLOCK = 10;
const INITIAL_ROWS = 10;

// Per-row model: { id, source, name, mobile, email, service, note, assigned:{code,name}|null, status, saved }
let rows = [];
let nextRowId = 1;
// Per-service cached recommendation: {code, name} on success, null on empty, Promise while in-flight.
const _recommendCache = new Map();

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

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

function blankRow() {
  return {
    id: nextRowId++,
    source: "call",
    name: "",
    mobile: "",
    email: "",
    service: "",
    note: "",
    assigned: null,   // {code, name} once resolved
    assignErr: false, // true when no eligible employee for this service
    status: "—",
    statusKind: "",   // "", "saved", "err", "dup", "pending"
    saved: false,
  };
}

function seedRows(n) {
  rows = [];
  for (let i = 0; i < n; i++) rows.push(blankRow());
}

function isValidRow(r) {
  if (r.saved) return false;
  if (!r.source) return false;
  if (!r.service) return false;
  const mobDigits = String(r.mobile || "").replace(/\D/g, "");
  if (mobDigits.length !== 10 && !r.email) return false;
  if (mobDigits.length !== 10 && !r.email) return false;
  if (mobDigits && mobDigits.length !== 10) return false;
  // Need mobile OR email (both accepted forms per backend); mobile field is marked required
  // in the UI, but we still allow email-only when mobile blank so a manager can enter
  // reference leads with only an email.
  if (!mobDigits && !r.email) return false;
  if (!r.assigned || !r.assigned.code) return false;
  if (r.assignErr) return false;
  return true;
}

function isEmptyRow(r) {
  return !r.source || (r.source === "call" && !r.name && !r.mobile && !r.email && !r.service && !r.note);
}

function isPartiallyFilled(r) {
  // Any user input beyond defaults
  return !!(r.name || r.mobile || r.email || r.service || r.note);
}

function refreshSaveButton() {
  const btn = $("#saveAllBtn");
  if (!btn) return;
  const anyValid = rows.some(isValidRow);
  btn.disabled = !anyValid;
}

function updateRowCountNote() {
  const el = $("#rowCountNote");
  if (!el) return;
  const total = rows.length;
  const valid = rows.filter(isValidRow).length;
  const saved = rows.filter((r) => r.saved).length;
  el.textContent = `${total} rows · ${valid} ready to save${saved ? ` · ${saved} already saved` : ""}`;
}

function renderRowHTML(r, idx) {
  const trCls = r.statusKind === "saved" ? "saved" : r.statusKind === "dup" ? "dup" : r.statusKind === "err" ? "err" : "";
  const asgText = r.assignErr
    ? "⚠️ no sales person for this service"
    : (r.assigned ? `${r.assigned.code}${r.assigned.name ? " — " + r.assigned.name : ""}` : "");
  const asgCls  = r.assignErr ? "assigned err" : "assigned";
  const statusColor = r.statusKind === "saved" ? "#065f46"
                    : r.statusKind === "dup"   ? "#92400e"
                    : r.statusKind === "err"   ? "#991b1b"
                    : "#94a3b8";
  const disabledAttr = r.saved ? "disabled" : "";
  return `<tr data-row-id="${r.id}" class="${trCls}">
    <td class="num">${idx + 1}</td>
    <td>
      <select data-field="source" ${disabledAttr}>
        ${SOURCES.map(s => `<option value="${s.value}" ${r.source === s.value ? "selected" : ""}>${s.label}</option>`).join("")}
      </select>
    </td>
    <td><input data-field="name"   type="text" value="${esc(r.name)}"   placeholder="Customer name" ${disabledAttr}/></td>
    <td><input data-field="mobile" type="tel"  value="${esc(r.mobile)}" placeholder="10-digit"      ${disabledAttr}/></td>
    <td><input data-field="email"  type="email" value="${esc(r.email)}" placeholder="optional"      ${disabledAttr}/></td>
    <td>
      <select data-field="service" ${disabledAttr}>
        <option value="">— pick service —</option>
        ${SERVICES.map(s => `<option value="${s.value}" ${r.service === s.value ? "selected" : ""}>${s.label}</option>`).join("")}
      </select>
    </td>
    <td><input data-field="note"   type="text" value="${esc(r.note)}"   placeholder="optional"      ${disabledAttr}/></td>
    <td><input data-field="assigned" class="${asgCls}" type="text" readonly value="${esc(asgText)}" placeholder="Pick a service first" tabindex="-1"/></td>
    <td class="status" style="color:${statusColor};">${esc(r.status)}</td>
  </tr>`;
}

function renderGrid() {
  const body = $("#bulkBody");
  body.innerHTML = rows.map(renderRowHTML).join("");
  updateRowCountNote();
  refreshSaveButton();
}

function updateRowDom(r) {
  const idx = rows.findIndex((x) => x.id === r.id);
  if (idx < 0) return;
  const tr = document.querySelector(`tr[data-row-id="${r.id}"]`);
  if (!tr) return;
  tr.outerHTML = renderRowHTML(r, idx);
  updateRowCountNote();
  refreshSaveButton();
}

function findRowFromEvent(e) {
  const tr = e.target.closest("tr[data-row-id]");
  if (!tr) return null;
  const id = Number(tr.dataset.rowId);
  return rows.find((r) => r.id === id) || null;
}

function maybeAppendRows() {
  // If the LAST row has any input, auto-append 10 more blanks.
  const last = rows[rows.length - 1];
  if (last && isPartiallyFilled(last)) {
    for (let i = 0; i < ROW_BLOCK; i++) rows.push(blankRow());
    renderGrid();
  }
}

async function onServiceChange(r) {
  if (!r.service) {
    r.assigned = null; r.assignErr = false;
    updateRowDom(r);
    return;
  }
  // Show pending state
  r.assigned = null; r.assignErr = false;
  updateRowDom(r);
  const rec = await recommendForService(r.service);
  if (rec && rec.code) {
    r.assigned = { code: rec.code, name: rec.name || "" };
    r.assignErr = false;
  } else {
    r.assigned = null;
    r.assignErr = true;
  }
  updateRowDom(r);
}

function wireGridEvents() {
  const body = $("#bulkBody");

  body.addEventListener("input", (e) => {
    const r = findRowFromEvent(e); if (!r || r.saved) return;
    const f = e.target.dataset.field;
    if (!f || f === "assigned") return;
    if (f === "mobile") {
      r.mobile = String(e.target.value || "").replace(/[^\d]/g, "").slice(0, 10);
      if (e.target.value !== r.mobile) e.target.value = r.mobile;
    } else if (f === "email") {
      r.email = String(e.target.value || "").trim().toLowerCase();
    } else {
      r[f] = e.target.value;
    }
    refreshSaveButton();
    updateRowCountNote();
    maybeAppendRows();
  });

  body.addEventListener("change", async (e) => {
    const r = findRowFromEvent(e); if (!r || r.saved) return;
    const f = e.target.dataset.field;
    if (f === "source") { r.source = e.target.value; }
    if (f === "service") {
      r.service = e.target.value;
      await onServiceChange(r);
    }
    refreshSaveButton();
    maybeAppendRows();
  });

  // Enter in Mobile jumps to Service in same row.
  body.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.dataset && e.target.dataset.field === "mobile") {
      e.preventDefault();
      const tr = e.target.closest("tr[data-row-id]");
      if (!tr) return;
      const svc = tr.querySelector('select[data-field="service"]');
      if (svc) svc.focus();
    }
  });
}

function toast(text, ms) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.remove("hidden");
  if (ms) {
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.add("hidden"), ms);
  }
}
function toastHide() { $("#toast").classList.add("hidden"); }

async function onSaveAll() {
  const btn = $("#saveAllBtn");
  const savable = rows.filter(isValidRow);
  if (!savable.length) return;
  btn.disabled = true;
  const orig = btn.textContent;
  let okCount = 0, dupCount = 0, errCount = 0;

  for (let i = 0; i < savable.length; i++) {
    const r = savable[i];
    r.status = "Saving…"; r.statusKind = "pending";
    updateRowDom(r);
    toast(`Saving ${i + 1} of ${savable.length}…`);
    try {
      const mobile = String(r.mobile || "").replace(/\D/g, "");
      const res = await callAdmin("add_manual_lead", {
        type: r.source,
        name: r.name || "",
        mobile,
        email: r.email || "",
        service: r.service,
        note: r.note || "",
        employee_code: r.assigned.code,
        employee_name: r.assigned.name || "",
      });
      if (res && Array.isArray(res.duplicates) && res.duplicates.length > 0) {
        const d = res.duplicates[0];
        const svc = d.service_name || d.service_type || "";
        r.status = `↩︎ Duplicate${svc ? " · " + svc : ""}`;
        r.statusKind = "dup";
        r.saved = true;
        dupCount++;
      } else {
        r.status = "✓ Saved";
        r.statusKind = "saved";
        r.saved = true;
        okCount++;
      }
    } catch (err) {
      r.status = "✗ " + (err.message || "Error");
      r.statusKind = "err";
      r.saved = false;
      errCount++;
    }
    updateRowDom(r);
  }

  const skipped = rows.filter((r) => !r.saved && !isValidRow(r) && isPartiallyFilled(r)).length;
  const summary = `✓ ${okCount} saved · ${dupCount} duplicate · ${errCount} error${skipped ? ` · ${skipped} skipped (incomplete)` : ""}`;
  toast(summary, 6000);
  const sumEl = $("#summary");
  sumEl.textContent = summary + " — rows with errors stay editable; fix and click Save all again.";
  sumEl.classList.remove("hidden");

  btn.textContent = orig;
  refreshSaveButton();
}

function wireUI() {
  $("#saveAllBtn").addEventListener("click", onSaveAll);
  $("#add10Btn").addEventListener("click", () => {
    for (let i = 0; i < 10; i++) rows.push(blankRow());
    renderGrid();
  });
  $("#add50Btn").addEventListener("click", () => {
    for (let i = 0; i < 50; i++) rows.push(blankRow());
    renderGrid();
  });
  $("#clearBtn").addEventListener("click", () => {
    if (!confirm("Clear ALL rows (including saved ones)? This just empties the grid — saved leads stay in the pipeline.")) return;
    seedRows(INITIAL_ROWS);
    $("#summary").classList.add("hidden");
    toastHide();
    renderGrid();
  });
  $("#signOutBtn").addEventListener("click", async () => {
    await sb.auth.signOut();
    location.reload();
  });
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim();
    const password = $("#password").value;
    const errEl = $("#loginError");
    errEl.classList.add("hidden");
    const btn = $("#loginBtn"); btn.disabled = true; btn.textContent = "Signing in…";
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      location.reload();
    } catch (err) {
      errEl.textContent = err.message || "Sign in failed.";
      errEl.classList.remove("hidden");
      btn.disabled = false; btn.textContent = "Sign in";
    }
  });
}

async function boot() {
  wireUI();
  wireGridEvents();

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { show($("#loginView")); return; }

  const emailChip = $("#emailChip");
  const { data: { user } } = await sb.auth.getUser();
  if (emailChip && user?.email) {
    emailChip.textContent = user.email;
    emailChip.classList.remove("hidden");
  }
  $("#signOutBtn").classList.remove("hidden");

  // RBAC — manager only: super OR leads.
  let perms = [];
  try {
    const { data } = await sb.rpc("current_admin_permissions");
    perms = Array.isArray(data) ? data : [];
  } catch {}
  const isManager = perms.includes("super") || perms.includes("leads");
  if (!isManager) {
    $("#gatePerms").innerHTML = `Your permissions: <code>${perms.length ? perms.join(", ") : "(none)"}</code>`;
    show($("#gateView"));
    return;
  }

  seedRows(INITIAL_ROWS);
  renderGrid();
  show($("#bulkView"));
}

window.addEventListener("DOMContentLoaded", boot);
