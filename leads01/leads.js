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
let remarkFilter = "";      // free-text contains filter
let expandedRows = new Set(); // customer_keys with expanded remark history
let remarksByKey = {};       // cache: customer_key -> [ {remark, created_at, created_by} ]

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
  if (session) bootDashboard();
  else { hide($("#dashView")); show($("#loginView")); }
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
  $("#emailChip").textContent = "01";
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
  // Route quotation_sent leads back to Send Quote (Quote Sent tab removed)
  if (lead.talk_status === "quotation_sent") return "in_progress";
  if (lead.talk_status) return lead.talk_status;
  if (lead.manual_status === "callback") return "callback";
  return "in_progress";
}

function updateTopCounts() {
  const activeFollowSubs = new Set(["not_picked", "callback", "interested", "in_progress"]);
  const counts = { new: 0, follow: 0, done: 0 };
  filteredPipeline().forEach((l) => {
    const b = bucketOf(l);
    if (b === "follow") {
      if (activeFollowSubs.has(followSubOf(l))) counts.follow += 1;
    } else {
      counts[b] += 1;
    }
  });
  $("#topcnt_new").textContent    = counts.new;
  $("#topcnt_follow").textContent = counts.follow;
  $("#topcnt_done").textContent   = counts.done;
}

// Pipeline filtered by active date range (uses last_event_at)
function filteredPipeline() {
  if (!dateRange.from && !dateRange.to) return pipelineCache;
  return pipelineCache.filter((l) => withinRange(l.last_event_at));
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

  paneStage?.classList.toggle("hidden", isEmbedded);
  paneQuot?.classList.toggle("hidden", !isEmbedded);
  if (subTabs) subTabs.style.display = isEmbedded ? "none" : "";
  // Keep the top toolbar (search + refresh + date range) VISIBLE on all tabs
  if (toolbar) toolbar.style.display = "";

  if (top === "quotations") {
    const f = $("#quotationsFrame");
    if (f && (!f.src || f.src === "about:blank" || !f.src.includes("/leads01/quotations"))) f.src = "/leads01/quotations/?v=" + Date.now();
    return;
  }

  if (top === "new")    activeSub = "lead_captured";
  if (top === "follow") activeSub = "not_picked";
  if (top === "done")   activeSub = "all";
  expandedRows.clear();
  remarkFilter = "";
  $("#paneStage").innerHTML = "";
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
  if (activeTop === "done")   subs = [{ id: "all", title: "All paid" }];

  const inBucket = filteredPipeline().filter((l) => bucketOf(l) === activeTop);
  const counts = {};
  subs.forEach((s) => counts[s.id] = 0);
  inBucket.forEach((l) => {
    let k;
    if (activeTop === "new")    k = newSubOf(l);
    if (activeTop === "follow") k = followSubOf(l);
    if (activeTop === "done")   k = "all";
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
  const isManualAdd = activeTop === "new" && MANUAL_ADD_SUBS.has(activeSub);
  const needShell = !$("#filterBar") || !$("#rowsContainer") || (isManualAdd && !$("#manualAddBar")) || (!isManualAdd && $("#manualAddBar"));
  if (needShell) {
    const manualBarHtml = isManualAdd ? `<div id="manualAddBar"></div>` : "";
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
}

// Manual-add bar: Add lead button + inline form (Reference / Call / WhatsApp sub-tabs)
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
        <button id="manualAddOpenBtn" data-type="${type}" style="background:#2563eb;color:#fff;padding:6px 12px;border-radius:4px;font-size:12.5px;font-weight:700;border:0;cursor:pointer;">+ Add lead</button>
      </div>
      <div id="manualAddForm" class="hidden" style="margin-top:10px;padding-top:10px;border-top:1px dashed #cfe0ff;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
          <div><div class="muted-small" style="margin-bottom:3px;">Name (optional)</div><input id="manualAddName" type="text" placeholder="Customer name" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;"/></div>
          <div><div class="muted-small" style="margin-bottom:3px;">Mobile</div><input id="manualAddMobile" type="tel" placeholder="10-digit mobile" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;"/></div>
          <div><div class="muted-small" style="margin-bottom:3px;">Email (optional)</div><input id="manualAddEmail" type="email" placeholder="customer@email.com" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;"/></div>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
          <button id="manualAddSaveBtn" data-type="${type}" style="background:#059669;color:#fff;padding:6px 14px;border-radius:4px;font-size:12.5px;font-weight:700;border:0;cursor:pointer;">Save lead</button>
          <button id="manualAddCancelBtn" style="background:#e5e7eb;color:#111;padding:6px 12px;border-radius:4px;font-size:12.5px;border:0;cursor:pointer;">Cancel</button>
          <div id="manualAddMsg" style="font-size:12px;flex:1;"></div>
        </div>
        <div class="muted-small" style="margin-top:6px;color:#64748b;">Once saved you can't change these details, but you can keep adding remarks. Remarks carry over to Follow Ups.</div>
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
  if (!openBtn) return;

  openBtn.onclick = () => {
    form.classList.remove("hidden");
    openBtn.style.display = "none";
    $("#manualAddMobile").focus();
    msg.textContent = ""; msg.style.color = "";
  };
  cancelBtn.onclick = () => {
    form.classList.add("hidden");
    openBtn.style.display = "";
    ["manualAddName","manualAddMobile","manualAddEmail"].forEach(id => { const el = $("#"+id); if (el) el.value = ""; });
    msg.textContent = "";
  };
  saveBtn.onclick = async () => {
    const type = saveBtn.dataset.type;
    const name = ($("#manualAddName").value || "").trim();
    const mobile = ($("#manualAddMobile").value || "").replace(/\D/g, "");
    const email = ($("#manualAddEmail").value || "").trim().toLowerCase();
    msg.textContent = ""; msg.style.color = "";
    if (!mobile && !email) {
      msg.style.color = "#dc2626"; msg.textContent = "Enter mobile or email (at least one).";
      return;
    }
    saveBtn.disabled = true; saveBtn.textContent = "Saving...";
    try {
      const res = await callAdmin("add_manual_lead", { type, name, mobile, email });
      // Show success + any duplicate info
      let dupMsg = "";
      if (res.duplicates && res.duplicates.length > 0) {
        const list = res.duplicates.slice(0, 3).map(d => `${d.service_name || d.service_type} (${d.email || d.mobile})`).join(", ");
        dupMsg = ` Already exists in: ${list}`;
      }
      msg.style.color = "#059669";
      msg.textContent = "Saved." + dupMsg;
      ["manualAddName","manualAddMobile","manualAddEmail"].forEach(id => { const el = $("#"+id); if (el) el.value = ""; });
      // Refresh pipeline so the new row appears
      pipelineCache = await callAdmin("pipeline");
      updateTopCounts();
      renderActive();
    } catch (err) {
      msg.style.color = "#dc2626"; msg.textContent = "Save failed: " + err.message;
      saveBtn.disabled = false; saveBtn.textContent = "Save lead";
    }
  };
}

function renderRows() {
  const inBucket = filteredPipeline().filter((l) => bucketOf(l) === activeTop);
  let rows;
  if (activeTop === "new")    rows = inBucket.filter((l) => newSubOf(l) === activeSub);
  if (activeTop === "follow") rows = inBucket.filter((l) => followSubOf(l) === activeSub);
  if (activeTop === "done")   rows = inBucket;

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
  const inBucket = filteredPipeline().filter((l) => bucketOf(l) === activeTop);
  if (activeTop === "new")    return inBucket.filter((l) => newSubOf(l) === activeSub);
  if (activeTop === "follow") return inBucket.filter((l) => followSubOf(l) === activeSub);
  return inBucket;
}

function renderToolbarInto(el) {
  el.innerHTML = `<div class="filter-bar">
    <span class="filter-lbl">Filter by remark:</span>
    <input id="remarkFilterText" type="text" class="remark-filter-input" placeholder="Type to filter..." value="${esc(remarkFilter)}" />
    <select id="remarkFilterSelect" class="remark-filter-select">
      <option value="">All remarks</option>
      ${buildRemarkOptions()}
    </select>
    <button id="remarkFilterClear" class="remark-filter-clear" style="display:${remarkFilter ? "inline-block" : "none"};">Clear</button>
  </div>`;
}

function renderToolbarDropdownOnly() {
  // Refresh the dropdown options on data change without touching the input
  const sel = $("#remarkFilterSelect");
  if (sel) sel.innerHTML = `<option value="">All remarks</option>` + buildRemarkOptions();
  const clear = $("#remarkFilterClear");
  if (clear) clear.style.display = remarkFilter ? "inline-block" : "none";
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
}

function renderTable(rows, readOnly) {
  return `<div class="table-scroll"><table class="data">
    <thead><tr>
      <th>Service</th>
      <th>Contact</th>
      <th>Last activity</th>
      <th style="min-width:160px;">Call status</th>
      <th style="min-width:260px;">Remarks (latest + history)</th>
      ${readOnly ? "" : "<th>Save / Add</th>"}
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

  // Read-only completed row
  if (readOnly) {
    return `<tr class="done">
      <td>
        <div style="font-weight:600;">${esc(l.service_name || l.service_type || "—")}</div>
        <span class="done-tag">${esc(bucketReason(l))}</span>
      </td>
      <td>${contactCell}</td>
      <td>
        <div>${esc(ageStr)} ago</div>
        <div class="muted-small">${esc(fmtDate(l.last_event_at))} ${esc(fmtTime(l.last_event_at))}</div>
        <div style="margin-top:6px;">${callBtn}${waBtn}${emailBtn}</div>
      </td>
      <td><span class="muted-small" style="font-weight:600;color:#0f172a;">${esc(statusLabel)}</span></td>
      <td>${remarksCell}</td>
    </tr>`;
  }

  // Editable row — dropdown options depend on current sub-tab (state machine)
  const allowed = allowedStatusesFor(l);
  const isTerminal = (activeTop === "follow") && allowed.length === 0;
  const statusOpts = isTerminal
    ? `<option value="">— no further moves —</option>`
    : buildStatusOptionsHtml(allowed, statusValue);

  return `<tr class="${l.is_stale ? "stale" : ""}" data-customer-key="${cur}">
    <td>
      <div style="font-weight:600;">${esc(l.service_name || l.service_type || "—")}</div>
      ${l.is_stale ? `<span class="stale-tag">stale</span>` : ""}
    </td>
    <td>${contactCell}</td>
    <td>
      <div>${esc(ageStr)} ago</div>
      <div class="muted-small">${esc(fmtDate(l.last_event_at))} ${esc(fmtTime(l.last_event_at))}</div>
      <div style="margin-top:6px;">${callBtn}${waBtn}</div>
      ${quoteBtn ? `<div style="margin-top:6px;">${quoteBtn}</div>` : ""}
    </td>
    <td>
      <select class="status-select" data-customer-key="${cur}" ${isTerminal ? "disabled" : ""}>${statusOpts}</select>
    </td>
    <td>${remarksCell}</td>
    <td>
      ${isTerminal
        ? `<span class="muted-small">Terminal state</span>`
        : `<button class="row-save-btn" data-action="save-status" data-customer-key="${cur}">${statusValue ? "Update status" : "Save status"}</button>`}
      <div class="row-save-error" style="display:none;"></div>
    </td>
  </tr>`;
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

function renderRemarksCell(l, readOnly) {
  const cur = esc(l.customer_key || "");
  const latestHeader = l.latest_remark_header || "";
  const latest = l.remarks || "";
  const latestAt = l.latest_remark_at || l.manual_updated_at || "";
  const count = Number(l.remarks_count || 0);
  const isExpanded = expandedRows.has(l.customer_key);
  const olderCount = Math.max(0, count - 1);

  let html = "";

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
  $("#paneStage").addEventListener("click", async (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const key = target.dataset.customerKey;

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
    if (action === "send-quote") {
      const prefill = target.dataset.prefill || "";
      // Switch to Quotations tab + load prefilled URL in iframe
      switchTop("quotations");
      const f = document.getElementById("quotationsFrame");
      if (f) f.src = "/leads01/quotations/?" + prefill;
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
      target.disabled = true; target.textContent = "Saving...";
      try {
        await callAdmin("set_lead_status", { customer_key: key, talk_status });
        const idx = pipelineCache.findIndex((x) => x.customer_key === key);
        if (idx >= 0) pipelineCache[idx].talk_status = talk_status;
        updateTopCounts();
        renderActive();
      } catch (err) {
        target.disabled = false; target.textContent = "Save status";
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
