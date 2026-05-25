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
  { id: "lead_captured", title: "Lead captured" },
  { id: "otp_sent",      title: "OTP sent" },
  { id: "otp_verified",  title: "OTP verified" },
  { id: "callback",      title: "Callback" },
  { id: "click_to_call", title: "Click to Call" },
  { id: "click_to_wa",   title: "Click to WhatsApp" },
  { id: "tried_payment", title: "Tried payment" },
];

const FOLLOW_SUBS = [
  { id: "not_picked",      title: "Call not picked" },
  { id: "callback",        title: "Call me later" },
  { id: "interested",      title: "Interested" },
  { id: "in_progress",     title: "In progress" },
  { id: "never_visited",   title: "Said: never visited" },
  { id: "dont_call_again", title: "Said: don't call" },
  { id: "not_interested",  title: "Not interested" },
];

const TALK_STATUS_OPTIONS = [
  { value: "",                label: "— select —" },
  { value: "not_picked",      label: "Call not picked" },
  { value: "never_visited",   label: "Said: never visited site" },
  { value: "dont_call_again", label: "Said: don't call again" },
  { value: "in_progress",     label: "In progress" },
  { value: "interested",      label: "Interested" },
  { value: "not_interested",  label: "Not interested" },
  { value: "won_offline",     label: "Won (paid offline)" },
];

let pipelineCache = [];
let activeTop = "new";
let activeSub = "lead_captured";
let remarkFilter = "";      // free-text contains filter
let expandedRows = new Set(); // customer_keys with expanded remark history
let remarksByKey = {};       // cache: customer_key -> [ {remark, created_at, created_by} ]

window.addEventListener("DOMContentLoaded", async () => {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#signOutBtn").addEventListener("click", onSignOut);
  $("#refreshBtn").addEventListener("click", () => refreshAll());
  $("#searchBox").addEventListener("keydown", (e) => { if (e.key === "Enter") refreshAll(); });

  document.querySelectorAll(".top-tab").forEach((btn) =>
    btn.addEventListener("click", () => switchTop(btn.dataset.top))
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
    updateTopCounts();
    renderActive();
  } catch (e) {
    $("#paneStage").innerHTML = `<div class="empty"><strong>Error:</strong> ${esc(e.message)}</div>`;
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
  if (lead.manual_status === "callback") return "callback";
  if (lead.manual_status === "clicked_wa") return "click_to_wa";
  if (lead.manual_status === "clicked_call") return "click_to_call";
  if (lead.latest_event === "payment_initiated") return "tried_payment";
  if (lead.latest_event === "otp_verified")      return "otp_verified";
  if (lead.latest_event === "otp_sent")          return "otp_sent";
  return "lead_captured";
}
function followSubOf(lead) {
  if (lead.talk_status) return lead.talk_status;
  if (lead.manual_status === "callback") return "callback";
  return "in_progress";
}

function updateTopCounts() {
  // Follow Ups top-tab count is the sum of ACTIONABLE sub-tabs only
  // (Call not picked, Call me later, Interested, In progress).
  // "Dead" buckets (not_interested, dont_call_again, never_visited) stay in
  // the Follow Ups view but do not inflate the top number.
  const activeFollowSubs = new Set(["not_picked", "callback", "interested", "in_progress"]);
  const counts = { new: 0, follow: 0, done: 0 };
  pipelineCache.forEach((l) => {
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

function switchTop(top) {
  activeTop = top;
  document.querySelectorAll(".top-tab").forEach((b) => b.classList.toggle("active", b.dataset.top === top));
  if (top === "new")    activeSub = "lead_captured";
  if (top === "follow") activeSub = "not_picked";
  if (top === "done")   activeSub = "all";
  expandedRows.clear();
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
  if (activeTop === "done")   subs = [{ id: "all", title: "All completed" }];

  const inBucket = pipelineCache.filter((l) => bucketOf(l) === activeTop);
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
    btn.addEventListener("click", () => { activeSub = btn.dataset.sub; expandedRows.clear(); renderActive(); })
  );

  if (!subs.find((s) => s.id === activeSub)) {
    activeSub = subs[0]?.id || "";
    renderSubTabs();
  }
}

function renderPane() {
  const inBucket = pipelineCache.filter((l) => bucketOf(l) === activeTop);
  let rows;
  if (activeTop === "new")    rows = inBucket.filter((l) => newSubOf(l) === activeSub);
  if (activeTop === "follow") rows = inBucket.filter((l) => followSubOf(l) === activeSub);
  if (activeTop === "done")   rows = inBucket;

  // Apply optional remark filter
  const qq = (remarkFilter || "").trim().toLowerCase();
  if (qq) rows = rows.filter((l) => (l.remarks || "").toLowerCase().includes(qq));

  // Search box also filters
  const searchTerm = ($("#searchBox").value || "").trim().toLowerCase();
  if (searchTerm) {
    rows = rows.filter((l) =>
      (l.email || "").toLowerCase().includes(searchTerm) ||
      (l.mobile || "").toLowerCase().includes(searchTerm) ||
      (l.service_name || "").toLowerCase().includes(searchTerm) ||
      (l.service_type || "").toLowerCase().includes(searchTerm) ||
      (l.remarks || "").toLowerCase().includes(searchTerm)
    );
  }

  $("#paneStage").innerHTML = renderToolbar() + (rows.length
    ? renderTable(rows, activeTop === "done")
    : `<div class="empty">No leads in this view${qq ? ` matching remark "${esc(qq)}"` : ""}.</div>`);

  wireToolbarHandlers();
  wireRowHandlers();
}

function renderToolbar() {
  // Build remark filter dropdown from distinct latest remarks in cache
  const distinct = new Map(); // text -> count
  pipelineCache.forEach((l) => {
    const r = (l.remarks || "").trim();
    if (r) distinct.set(r, (distinct.get(r) || 0) + 1);
  });
  const opts = Array.from(distinct.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([txt, cnt]) => `<option value="${esc(txt)}" ${txt === remarkFilter ? "selected" : ""}>${esc(txt.slice(0, 50))} (${cnt})</option>`)
    .join("");

  return `<div class="filter-bar">
    <span class="filter-lbl">Filter by remark:</span>
    <input id="remarkFilterText" type="text" class="remark-filter-input" placeholder="Type to filter..." value="${esc(remarkFilter)}" />
    <select id="remarkFilterSelect" class="remark-filter-select">
      <option value="">All remarks</option>
      ${opts}
    </select>
    ${remarkFilter ? `<button id="remarkFilterClear" class="remark-filter-clear">Clear</button>` : ""}
  </div>`;
}

function wireToolbarHandlers() {
  const txt = $("#remarkFilterText");
  if (txt) {
    txt.addEventListener("input", (e) => { remarkFilter = e.target.value; renderPane(); });
  }
  const sel = $("#remarkFilterSelect");
  if (sel) {
    sel.addEventListener("change", (e) => { remarkFilter = e.target.value; renderPane(); });
  }
  const clear = $("#remarkFilterClear");
  if (clear) {
    clear.addEventListener("click", () => { remarkFilter = ""; renderPane(); });
  }
}

function renderTable(rows, readOnly) {
  return `<div class="table-scroll"><table class="data">
    <thead><tr>
      <th>Service</th>
      <th>Contact</th>
      <th>Last activity</th>
      <th>Actions</th>
      <th style="min-width:160px;">Call status</th>
      <th style="min-width:260px;">Remarks (latest + history)</th>
      ${readOnly ? "" : "<th>Save / Add</th>"}
    </tr></thead>
    <tbody>${rows.map((r) => rowHtml(r, readOnly)).join("")}</tbody>
  </table></div>`;
}

function rowHtml(l, readOnly) {
  const phone = (l.mobile || "").replace(/\D/g, "");
  const waPhone = phone.length === 10 ? "91" + phone : phone;
  const waText = encodeURIComponent(`Hi! This is cursive. I see you started ${l.service_name || l.service_type || ""} - quick chat?`);
  const cur = esc(l.customer_key || "");
  const ageHrs = (Date.now() - new Date(l.last_event_at).getTime()) / 3600000;
  const ageStr = ageHrs < 1 ? Math.round(ageHrs * 60) + "m"
              : ageHrs < 24 ? Math.round(ageHrs) + "h"
              : Math.round(ageHrs / 24) + "d";

  const statusValue = l.talk_status || "";
  const statusLabel = (TALK_STATUS_OPTIONS.find(o => o.value === statusValue) || {}).label || "—";
  const callBtn = phone ? `<a href="tel:+${waPhone}" class="call" data-action="call">Call</a>` : "";
  const waBtn   = phone ? `<a href="https://wa.me/${waPhone}?text=${waText}" target="_blank" rel="noopener" class="whatsapp" data-action="wa">WhatsApp</a>` : "";

  const remarksCell = renderRemarksCell(l, readOnly);

  // Read-only completed row
  if (readOnly) {
    return `<tr class="done">
      <td>
        <div style="font-weight:600;">${esc(l.service_name || l.service_type || "—")}</div>
        <span class="done-tag">${esc(bucketReason(l))}</span>
      </td>
      <td>
        ${l.email ? `<div>${esc(l.email)}</div>` : ""}
        ${l.mobile ? `<div class="muted-small">${esc(l.mobile)}</div>` : ""}
      </td>
      <td>
        <div>${esc(ageStr)} ago</div>
        <div class="muted-small">${esc(fmtDate(l.last_event_at))} ${esc(fmtTime(l.last_event_at))}</div>
      </td>
      <td><div class="row-actions">${callBtn}${waBtn}</div></td>
      <td><span class="muted-small" style="font-weight:600;color:#0f172a;">${esc(statusLabel)}</span></td>
      <td>${remarksCell}</td>
    </tr>`;
  }

  // Editable row
  const statusOpts = TALK_STATUS_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === statusValue ? "selected" : ""}>${esc(o.label)}</option>`).join("");
  return `<tr class="${l.is_stale ? "stale" : ""}" data-customer-key="${cur}">
    <td>
      <div style="font-weight:600;">${esc(l.service_name || l.service_type || "—")}</div>
      ${l.is_stale ? `<span class="stale-tag">stale</span>` : ""}
    </td>
    <td>
      ${l.email ? `<div><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></div>` : ""}
      ${l.mobile ? `<div class="muted-small">${esc(l.mobile)}</div>` : ""}
    </td>
    <td>
      <div>${esc(ageStr)} ago</div>
      <div class="muted-small">${esc(fmtDate(l.last_event_at))} ${esc(fmtTime(l.last_event_at))}</div>
    </td>
    <td><div class="row-actions">${callBtn}${waBtn}</div></td>
    <td>
      <select class="status-select" data-customer-key="${cur}">${statusOpts}</select>
    </td>
    <td>${remarksCell}</td>
    <td>
      <button class="row-save-btn" data-action="save-status" data-customer-key="${cur}">${statusValue ? "Update status" : "Save status"}</button>
      <div class="row-save-error" style="display:none;"></div>
    </td>
  </tr>`;
}

function renderRemarksCell(l, readOnly) {
  const cur = esc(l.customer_key || "");
  const latest = l.remarks || "";
  const latestAt = l.latest_remark_at || l.manual_updated_at || "";
  const count = Number(l.remarks_count || 0);
  const isExpanded = expandedRows.has(l.customer_key);
  const olderCount = Math.max(0, count - 1);

  let html = "";

  if (latest) {
    html += `<div class="remark-latest">
      <div class="remark-text">${esc(latest)}</div>
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
    // skip the first one (already shown as latest)
    const older = list.slice(1);
    html += `<div class="remark-history">
      ${older.map((r) => `<div class="remark-older">
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
        <textarea class="add-remark-input" placeholder="Type new remark..." rows="2"></textarea>
        <div class="add-remark-actions">
          <button class="add-remark-save" data-action="add-remark-save" data-customer-key="${cur}">Save</button>
          <button class="add-remark-cancel" data-action="add-remark-cancel" data-customer-key="${cur}">Cancel</button>
        </div>
        <div class="add-remark-error" style="display:none;"></div>
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

function wireRowHandlers() {
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
      const input = wrap.querySelector(".add-remark-input");
      const errBox = wrap.querySelector(".add-remark-error");
      const text = (input.value || "").trim();
      errBox.style.display = "none";
      if (!text) {
        errBox.textContent = "Type something before saving.";
        errBox.style.display = "block";
        return;
      }
      target.disabled = true; target.textContent = "Saving...";
      try {
        const saved = await callAdmin("add_remark", { customer_key: key, remark: text });
        // Update cache
        const idx = pipelineCache.findIndex((x) => x.customer_key === key);
        if (idx >= 0) {
          pipelineCache[idx].remarks = saved.remark;
          pipelineCache[idx].latest_remark_at = saved.created_at;
          pipelineCache[idx].remarks_count = (pipelineCache[idx].remarks_count || 0) + 1;
        }
        // Append to remarks cache too
        if (remarksByKey[key]) {
          remarksByKey[key].unshift(saved);
        }
        renderPane();
      } catch (err) {
        target.disabled = false; target.textContent = "Save";
        errBox.textContent = "Save failed: " + err.message;
        errBox.style.display = "block";
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
