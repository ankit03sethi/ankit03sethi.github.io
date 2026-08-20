// cursive /processing/ - Processing team dashboard
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ooT6WLYpHh6NOVWJBH7ECw_E78_gwqQ";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cursive_admin_auth" },
});

const $ = (s) => document.querySelector(s);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

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

let rows = [];
let activeTop = "new";
let _isManager = false;
let _myEmpCode = "";
let _myEmpName = "";
let _employeeCache = [];
let serviceFilter = "";
let employeeFilter = "";

window.addEventListener("DOMContentLoaded", async () => {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#refreshBtn").addEventListener("click", refreshAll);
  $("#searchBox").addEventListener("input", () => renderRows());
  document.querySelectorAll(".top-tab").forEach((btn) =>
    btn.addEventListener("click", () => switchTop(btn.dataset.top))
  );
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { hide($("#dashView")); show($("#loginView")); return; }
  bootDashboard();
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
  let who;
  try {
    who = await callProc("whoami");
  } catch (err) {
    document.body.innerHTML = accessDeniedHtml(err?.message || "Access denied.");
    return;
  }
  _isManager = !!who?.is_manager;
  _myEmpCode = who?.employee_code || "";
  _myEmpName = who?.email || "";
  const roles = Array.isArray(who?.roles) ? who.roles : [];
  const hasProcessing = roles.includes("processing");
  if (!_isManager && !hasProcessing) {
    document.body.innerHTML = accessDeniedHtml("You don't have the 'processing' role. Ask a super-admin.");
    return;
  }
  $("#emailChip").textContent = _isManager ? (who?.email || "manager") : (_myEmpCode || who?.email || "");
  show($("#emailChip")); show($("#signOutBtn"));
  // Managers get the employees list for the assignee filter
  if (_isManager) {
    try {
      const res = await fetch(SUPABASE_URL + "/functions/v1/admin-employees", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (await sb.auth.getSession()).data.session.access_token, "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify({ op: "list" }),
      });
      const jj = await res.json();
      if (jj?.ok && Array.isArray(jj.employees)) _employeeCache = jj.employees.filter(e => e.is_active);
    } catch {}
  }
  await refreshAll();
}

async function callProc(op, extra = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch(SUPABASE_URL + "/functions/v1/processing-data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + session.access_token,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ op, ...extra }),
  });
  const json = await res.json().catch(() => ({ ok: false, message: "Bad response." }));
  if (!json.ok) throw new Error(json.message || "Request failed.");
  return json.data;
}

async function refreshAll() {
  try {
    rows = await callProc("list_processing");
    $("#lastRefreshed").textContent = "Last refreshed " + new Date().toLocaleTimeString();
    updateCounts();
    renderFilterBar();
    renderRows();
  } catch (e) {
    $("#paneRows").innerHTML = `<div class="empty"><strong>Error:</strong> ${esc(e.message)}</div>`;
  }
}

function bucketOf(l) {
  const ps = l.processing_status;
  if (ps === "in_progress") return "progress";
  if (ps === "delivered")   return "delivered";
  if (ps === "renewal")     return "renewal";
  if (l.stage === "payment_complete") return "new";
  return "new";
}

function updateCounts() {
  const counts = { new:0, progress:0, delivered:0, renewal:0 };
  filteredByToolbar().forEach((l) => { counts[bucketOf(l)] += 1; });
  $("#topcnt_new").textContent       = counts.new;
  $("#topcnt_progress").textContent  = counts.progress;
  $("#topcnt_delivered").textContent = counts.delivered;
  $("#topcnt_renewal").textContent   = counts.renewal;
}

function filteredByToolbar() {
  let r = rows;
  if (serviceFilter) r = r.filter((l) => (l.service_type || "").toLowerCase() === serviceFilter.toLowerCase());
  if (_isManager && employeeFilter) {
    if (employeeFilter === "__none__") r = r.filter((l) => !l.assigned_employee_code);
    else r = r.filter((l) => (l.assigned_employee_code || "") === employeeFilter);
  }
  return r;
}

function switchTop(top) {
  activeTop = top;
  document.querySelectorAll(".top-tab").forEach((b) => b.classList.toggle("active", b.dataset.top === top));
  renderRows();
}

function renderFilterBar() {
  const el = $("#filterBar");
  el.innerHTML = `<div class="filter-bar" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;">
    <span class="filter-lbl">Service:</span>
    <select id="pServiceSelect" class="remark-filter-select">
      <option value="">All services</option>
      ${SERVICES.map(s => `<option value="${s.value}" ${s.value === serviceFilter ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
    </select>
    ${_isManager ? `
      <span class="filter-lbl" style="margin-left:12px;">Assigned to:</span>
      <select id="pEmployeeSelect" class="remark-filter-select">
        <option value="" ${employeeFilter === "" ? "selected" : ""}>All</option>
        <option value="__none__" ${employeeFilter === "__none__" ? "selected" : ""}>Unassigned</option>
        ${(_employeeCache || []).map(e => `<option value="${esc(e.code)}" ${e.code === employeeFilter ? "selected" : ""}>${esc(e.code + (e.name ? " - " + e.name : ""))}</option>`).join("")}
      </select>
    ` : ""}
  </div>`;
  const s = $("#pServiceSelect");
  if (s) s.addEventListener("change", (e) => { serviceFilter = e.target.value; updateCounts(); renderRows(); });
  const em = $("#pEmployeeSelect");
  if (em) em.addEventListener("change", (e) => { employeeFilter = e.target.value; updateCounts(); renderRows(); });
}

function renderRows() {
  const q = ($("#searchBox")?.value || "").trim().toLowerCase();
  let list = filteredByToolbar().filter((l) => bucketOf(l) === activeTop);
  if (q) list = list.filter((l) =>
    (l.email || "").toLowerCase().includes(q) ||
    (l.alt_email || "").toLowerCase().includes(q) ||
    (l.mobile || "").toLowerCase().includes(q) ||
    (l.alt_mobile || "").toLowerCase().includes(q) ||
    (l.service_name || "").toLowerCase().includes(q) ||
    (l.service_type || "").toLowerCase().includes(q)
  );
  if (!list.length) {
    $("#paneRows").innerHTML = `<div class="empty">No leads in this view.</div>`;
    return;
  }
  $("#paneRows").innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr>
      <th>Service</th>
      <th>Customer</th>
      <th>Since (assigned)</th>
      <th>Status</th>
      <th style="min-width:220px;">Notes</th>
      <th style="min-width:220px;">Actions</th>
    </tr></thead>
    <tbody>${list.map(rowHtml).join("")}</tbody>
  </table></div>`;
  wireRowHandlers();
}

function rowHtml(l) {
  const cur = esc(l.customer_key || "");
  const email = esc(l.alt_email || l.email || "");
  const mobile = esc(l.alt_mobile || l.mobile || "");
  const svc = esc(l.service_name || l.service_type || "-");
  const assignedAt = l.assigned_at ? new Date(l.assigned_at) : null;
  const sinceStr = assignedAt ? sinceLabel(assignedAt) : "-";
  const ps = l.processing_status || null;
  const pillLabel = ps ? ps.replace("_", " ") : "new handoff";
  const assigneeChip = l.assigned_employee_code
    ? `<div class="muted-small" style="margin-top:3px;">Emp: ${esc(l.assigned_employee_code)}${l.assigned_employee_name ? " - " + esc(l.assigned_employee_name) : ""}</div>`
    : `<div class="muted-small" style="margin-top:3px;color:#b45309;">Unassigned</div>`;
  const notesVal = esc(l.processing_notes || "");
  const actions = actionButtonsFor(l);

  return `<tr data-key="${cur}">
    <td>${svc}${assigneeChip}</td>
    <td>${email ? `<div>${email}</div>` : ""}${mobile ? `<div class="muted-small">${mobile}</div>` : ""}</td>
    <td>${sinceStr}${assignedAt ? `<div class="muted-small">${assignedAt.toLocaleString()}</div>` : ""}</td>
    <td><span class="pstatus-pill pstatus-${ps || "null"}">${esc(pillLabel)}</span></td>
    <td>
      <textarea class="proc-notes" data-role="notes">${notesVal}</textarea>
      <div class="proc-saved hidden" data-role="notes-saved">Saved.</div>
    </td>
    <td>${actions}</td>
  </tr>`;
}

function actionButtonsFor(l) {
  const ps = l.processing_status || null;
  const out = [];
  if (ps !== "in_progress") {
    out.push(`<button class="proc-action-btn primary" data-action="in_progress">&#128296; In progress</button>`);
  }
  if (ps !== "delivered") {
    out.push(`<button class="proc-action-btn success" data-action="delivered">&#9989; Delivered</button>`);
  }
  if (ps !== "renewal") {
    out.push(`<button class="proc-action-btn renewal" data-action="renewal">&#10145; Send to renewal</button>`);
  }
  return out.join("");
}

function wireRowHandlers() {
  document.querySelectorAll("#paneRows tr[data-key]").forEach((tr) => {
    const key = tr.getAttribute("data-key");
    tr.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const status = btn.getAttribute("data-action");
        if (status === "renewal" && !confirm("Hand this lead over to the Renewal team? An available renewal employee will be picked automatically.")) return;
        const old = btn.textContent;
        btn.disabled = true; btn.textContent = "...";
        try {
          const res = await callProc("set_processing_status", { customer_key: key, status });
          if (status === "renewal" && res?.handoff?.to_code) {
            alert("Assigned to renewal: " + res.handoff.to_code + (res.handoff.to_name ? " (" + res.handoff.to_name + ")" : ""));
          }
          await refreshAll();
        } catch (e) {
          alert("Failed: " + e.message);
          btn.disabled = false; btn.textContent = old;
        }
      });
    });
    const ta = tr.querySelector('textarea[data-role="notes"]');
    if (ta) {
      let saved = ta.value;
      ta.addEventListener("blur", async () => {
        const val = ta.value;
        if (val === saved) return;
        try {
          await callProc("save_notes", { customer_key: key, notes: val });
          saved = val;
          const chip = tr.querySelector('[data-role="notes-saved"]');
          if (chip) {
            chip.classList.remove("hidden");
            setTimeout(() => chip.classList.add("hidden"), 1200);
          }
        } catch (e) {
          alert("Save notes failed: " + e.message);
        }
      });
    }
  });
}

function sinceLabel(d) {
  const ms = Date.now() - d.getTime();
  const h = ms / 3600000;
  if (h < 1) return Math.max(0, Math.round(h * 60)) + "m ago";
  if (h < 24) return Math.round(h) + "h ago";
  return Math.round(h / 24) + "d ago";
}

function accessDeniedHtml(msg) {
  return `<div style="max-width:520px;margin:60px auto;padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,0.06);font-family:-apple-system,'Segoe UI',Roboto,sans-serif;text-align:center;">
    <h1 style="margin:0 0 10px;font-size:22px;color:#0f172a;">&#128683; No access to <b style="color:#16a34a;">Processing</b></h1>
    <p style="color:#64748b;font-size:14px;line-height:1.6;">${esc(msg)}</p>
    <a href="/leads01/" style="display:inline-block;margin-top:14px;padding:10px 22px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Go to Leads</a>
  </div>`;
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function humanError(err) {
  const m = String(err?.message || err || "");
  if (/invalid.*credential/i.test(m)) return "Wrong email or password.";
  if (/email.*not.*confirmed/i.test(m)) return "Email not confirmed.";
  return m || "Sign-in failed.";
}
