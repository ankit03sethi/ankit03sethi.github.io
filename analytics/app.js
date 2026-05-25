/* cursive Analytics - app logic */
(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var store = pickStore(cfg.sessionMode);
  var SESSION_KEY = "365avail.session.v1";
  var DATA_KEY    = "365avail.data.v1";
  var REFRESH_MS  = 60 * 1000;
  var refreshTimer = null;

  var state = {
    rows: [], columns: [], visibleColumns: [],
    platformCol: null, productIdCol: null, nameCol: null,
    hiddenCols: [], filtered: [],
    pendingFilters: {}, activeFilters: {},
    searchText: "", user: null
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    document.getElementById("year").textContent = new Date().getFullYear();
    document.getElementById("loginForm").addEventListener("submit", onLogin);
    document.getElementById("logoutBtn").addEventListener("click", onLogout);
    document.getElementById("tableSearch").addEventListener("input", onSearchInput);
    document.getElementById("downloadBtn").addEventListener("click", onDownloadExcel);

    document.addEventListener("click", function (e) {
      var open = document.querySelector(".filter-multi[open]");
      if (open && !open.contains(e.target)) open.removeAttribute("open");
    });

    var saved = readSession();
    if (saved && saved.id && saved.password) {
      var cached = readData();
      if (cached && cached.rows && cached.columns) {
        applyAuthData(saved.id, cached);
        showDashboardUI();
      }
      authenticate(saved.id, saved.password).then(function (res) {
        if (res.ok) showDashboard(res, true);
        else if (isInvalidAuth(res)) { clearSession(); clearData(); if (state.user) onLogout(); }
      }).catch(function () {});
      startAutoRefresh();
    }
  }

  function isInvalidAuth(res) { return res && res.message && /invalid/i.test(res.message); }

  function pickStore(mode) {
    if (mode === "local") return window.localStorage;
    if (mode === "none")  return null;
    return window.sessionStorage;
  }
  function saveSession(id, password) { if (store) try { store.setItem(SESSION_KEY, JSON.stringify({ id: id, password: password })); } catch (e) {} }
  function readSession() { if (!store) return null; try { return JSON.parse(store.getItem(SESSION_KEY) || "null"); } catch (e) { return null; } }
  function clearSession() { if (store) try { store.removeItem(SESSION_KEY); } catch (e) {} }
  function saveData(d) { if (store) try { store.setItem(DATA_KEY, JSON.stringify({ rows: d.rows, columns: d.columns, name: d.name })); } catch (e) {} }
  function readData() { if (!store) return null; try { return JSON.parse(store.getItem(DATA_KEY) || "null"); } catch (e) { return null; } }
  function clearData() { if (store) try { store.removeItem(DATA_KEY); } catch (e) {} }

  function onLogin(e) {
    e.preventDefault();
    var btn = document.getElementById("loginBtn");
    var errEl = document.getElementById("loginError");
    errEl.classList.add("hidden");
    var id = document.getElementById("sellerId").value.trim();
    var pw = document.getElementById("password").value;
    if (!id || !pw) return;
    btn.disabled = true; btn.textContent = "Signing in...";
    authenticate(id, pw).then(function (res) {
      btn.disabled = false; btn.textContent = "Sign in";
      if (!res.ok) { errEl.textContent = res.message || "Invalid seller ID or password."; errEl.classList.remove("hidden"); return; }
      saveSession(id, pw);
      showDashboard(res, false);
      startAutoRefresh();
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = "Sign in";
      errEl.textContent = "Could not load data: " + (err && err.message ? err.message : err);
      errEl.classList.remove("hidden");
    });
  }

  function onLogout() {
    stopAutoRefresh(); clearSession(); clearData();
    state.user = null;
    document.getElementById("dashboardView").classList.add("hidden");
    document.getElementById("loginView").classList.remove("hidden");
    document.getElementById("logoutBtn").classList.add("hidden");
    document.getElementById("who").classList.add("hidden");
    document.getElementById("password").value = "";
  }

  function authenticate(id, password) {
    if (!cfg.appsScriptUrl || /PASTE_YOUR/.test(cfg.appsScriptUrl)) {
      return Promise.resolve({ ok: false, message: "Apps Script URL is not set in config.js." });
    }
    var body = "id=" + encodeURIComponent(id) + "&password=" + encodeURIComponent(password);
    return fetch(cfg.appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body, redirect: "follow"
    }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        if (!data || data.ok !== true) {
          return { ok: false, message: (data && data.message) || "Invalid seller ID or password." };
        }
        var res = { ok: true, id: id, rows: data.rows || [], columns: data.columns || [] };
        var name = id;
        var nameCol = resolveColumn(res.columns, cfg.displayNameColumn);
        if (nameCol && res.rows[0]) name = res.rows[0][nameCol] || id;
        res.name = name;
        saveData(res);
        return res;
      }).catch(function (err) {
        return { ok: false, message: "Could not reach the server: " + (err && err.message ? err.message : err) };
      });
  }

  function applyAuthData(id, data) {
    state.user = { id: id, name: data.name || id, rows: data.rows || [] };
    state.rows = data.rows || [];
    state.columns = data.columns && data.columns.length
      ? data.columns : (state.rows[0] ? Object.keys(state.rows[0]) : []);
    state.platformCol = resolveColumn(state.columns, cfg.platformColumn)
      || autoDetect(state.columns, ["platform", "marketplace", "channel", "site", "portal"]);
    state.productIdCol = resolveColumn(state.columns, cfg.productIdColumn)
      || autoDetect(state.columns, ["productid", "product id", "sku", "asin", "ean", "productcode", "itemcode"]);
    state.nameCol = resolveColumn(state.columns, cfg.displayNameColumn);
    state.hiddenCols = (cfg.hiddenColumns || []).map(function (c) { return resolveColumn(state.columns, c); }).filter(Boolean);
    var hide = new Set((state.hiddenCols || []).filter(Boolean));
    // Also hide auto-generated "Column N" headers (these are columns that had a
    // blank header cell in row 1 of the master sheet).
    state.columns.forEach(function (c) {
      if (/^Column\s+\d+$/i.test(c)) hide.add(c);
    });
    state.visibleColumns = state.columns.filter(function (c) { return !hide.has(c); });

    // Move "Product link" column to sit immediately after the Product ID column.
    var linkCol = autoDetect(state.columns, ["product link", "productlink", "link"]);
    if (linkCol && state.productIdCol && state.visibleColumns.indexOf(linkCol) !== -1) {
      var pidIdx = state.visibleColumns.indexOf(state.productIdCol);
      if (pidIdx !== -1) {
        state.visibleColumns = state.visibleColumns.filter(function (c) { return c !== linkCol; });
        var newPidIdx = state.visibleColumns.indexOf(state.productIdCol);
        state.visibleColumns.splice(newPidIdx + 1, 0, linkCol);
      }
    }

    // Move "Updated at" column to sit immediately after Product link
    // (or Product Id if no link column).
    var updCol = autoDetect(state.columns, ["updated at", "updatedat", "last updated", "updated"]);
    if (updCol && state.visibleColumns.indexOf(updCol) !== -1) {
      var anchor = linkCol && state.visibleColumns.indexOf(linkCol) !== -1 ? linkCol
                 : (state.productIdCol && state.visibleColumns.indexOf(state.productIdCol) !== -1 ? state.productIdCol : null);
      if (anchor) {
        state.visibleColumns = state.visibleColumns.filter(function (c) { return c !== updCol; });
        var anchorIdx = state.visibleColumns.indexOf(anchor);
        state.visibleColumns.splice(anchorIdx + 1, 0, updCol);
      }
    }
  }

  function resolveColumn(columns, spec) {
    if (spec == null || spec === "") return null;
    var s = String(spec).trim();
    if (/^[A-Za-z]{1,3}$/.test(s)) {
      var idx = letterToIndex(s);
      if (idx >= 0 && idx < columns.length) return columns[idx];
    }
    var target = norm(s);
    for (var i = 0; i < columns.length; i++) if (norm(columns[i]) === target) return columns[i];
    for (var j = 0; j < columns.length; j++) if (norm(columns[j]).indexOf(target) !== -1) return columns[j];
    return null;
  }
  function letterToIndex(letters) { var s = letters.toUpperCase(), n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; }
  function norm(x) { return String(x || "").toLowerCase().replace(/[\s_\-]+/g, ""); }
  function autoDetect(columns, hints) {
    for (var i = 0; i < hints.length; i++) {
      var h = norm(hints[i]);
      for (var j = 0; j < columns.length; j++) if (norm(columns[j]).indexOf(h) !== -1) return columns[j];
    }
    return null;
  }

  function showDashboard(res, preserveFilters) {
    var prevPending = preserveFilters ? cloneFilters(state.pendingFilters) : null;
    var prevActive  = preserveFilters ? cloneFilters(state.activeFilters)  : null;
    var prevSearch  = preserveFilters ? state.searchText : "";
    applyAuthData(res.id, res);
    if (preserveFilters) {
      state.pendingFilters = prevPending || {};
      state.activeFilters  = prevActive  || {};
      state.searchText     = prevSearch  || "";
    } else {
      state.pendingFilters = {}; state.activeFilters = {}; state.searchText = "";
      document.getElementById("tableSearch").value = "";
    }
    showDashboardUI();
  }

  function showDashboardUI() {
    var lv = document.getElementById("landingView");
    if (lv) lv.classList.add("hidden");
    document.getElementById("loginView").classList.add("hidden");
    document.getElementById("dashboardView").classList.remove("hidden");
    var whoEl = document.getElementById("who");
    whoEl.textContent = "Signed in as " + (state.user ? state.user.name : "");
    whoEl.classList.remove("hidden");
    document.getElementById("logoutBtn").classList.remove("hidden");
    document.getElementById("lastUpdated").textContent = "Data refreshed " + new Date().toLocaleString();
    renderKpis(); renderPlatformGrid(); renderFilters(); applyFilters();
    refreshWalletChip();
  }

  // ---- Wallet chip (top right) ----
  function refreshWalletChip() {
    var chip = document.getElementById("walletChip");
    if (!chip) return;
    var s = readSession();
    if (!s || !s.id || !s.password) { chip.classList.add("hidden"); return; }
    if (!cfg.appsScriptUrl) { chip.classList.add("hidden"); return; }
    var body = "action=wallet_balance"
             + "&email="    + encodeURIComponent(s.id)
             + "&password=" + encodeURIComponent(s.password);
    fetch(cfg.appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body, redirect: "follow"
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok === true) {
          var b = Number(res.balance || 0);
          chip.textContent = "Wallet: ₹" + b.toFixed(2);
          chip.classList.remove("hidden");
        } else {
          chip.classList.add("hidden");
        }
      }).catch(function () { chip.classList.add("hidden"); });
  }

  function renderKpis() {
    var grid = document.getElementById("kpiGrid");
    grid.innerHTML = "";
    if (state.productIdCol) {
      var seen = new Set();
      state.rows.forEach(function (r) { var v = String(r[state.productIdCol] || "").trim(); if (v) seen.add(v); });
      grid.appendChild(kpiCard("Total Product IDs", String(seen.size), "distinct " + state.productIdCol));
    } else {
      grid.appendChild(kpiCard("Total Product IDs", "—", "set productIdColumn in config.js"));
    }
    if (state.platformCol) {
      var platforms = new Set();
      state.rows.forEach(function (r) { var v = String(r[state.platformCol] || "").trim(); if (v) platforms.add(v); });
      grid.appendChild(kpiCard("Platforms", String(platforms.size), "distinct " + state.platformCol));
    }
  }

  function kpiCard(label, value, sub) {
    var div = document.createElement("div");
    div.className = "kpi-card";
    div.innerHTML = '<div class="kpi-label"></div><div class="kpi-value"></div><div class="kpi-sub"></div>';
    div.children[0].textContent = label;
    div.children[1].textContent = value;
    div.children[2].textContent = sub || "";
    return div;
  }

  function renderPlatformGrid() {
    var panel = document.getElementById("platformPanel");
    var grid = document.getElementById("platformGrid");
    var sub = document.getElementById("platformSub");
    grid.innerHTML = "";
    if (!state.platformCol) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    var counts = {};
    state.rows.forEach(function (r) {
      var v = String(r[state.platformCol] || "").trim() || "(blank)";
      counts[v] = (counts[v] || 0) + 1;
    });
    var pairs = Object.keys(counts).map(function (k) { return [k, counts[k]]; });
    pairs.sort(function (a, b) { return b[1] - a[1]; });
    sub.textContent = pairs.length + " platforms in your data";
    pairs.forEach(function (p) {
      var card = document.createElement("div");
      card.className = "platform-card";
      card.innerHTML = '<div class="platform-name"></div><div class="platform-count"></div>';
      card.children[0].textContent = p[0];
      card.children[1].textContent = String(p[1]);
      grid.appendChild(card);
    });
  }

  function cloneFilters(filters) {
    var out = {};
    Object.keys(filters || {}).forEach(function (k) { out[k] = new Set(filters[k]); });
    return out;
  }

  /* Returns counts for column 'col' from rows that satisfy ALL OTHER active filters.
   * Used to dim out values that aren't reachable given current selections. */
  function valuesForColumn(col) {
    var rows = state.rows.filter(function (r) {
      for (var otherCol in state.activeFilters) {
        if (otherCol === col) continue;
        var allowed = state.activeFilters[otherCol];
        if (!allowed.has(String(r[otherCol] == null ? "" : r[otherCol]).trim())) return false;
      }
      return true;
    });
    var counts = {};
    rows.forEach(function (r) {
      var v = String(r[col] == null ? "" : r[col]).trim();
      if (!v) return;
      counts[v] = (counts[v] || 0) + 1;
    });
    return counts;
  }

  function renderFilters() {
    var bar = document.getElementById("filters");
    bar.innerHTML = "";
    var anyFilter = false;

    state.visibleColumns.forEach(function (col) {
      var allValues = {};
      state.rows.forEach(function (r) {
        var v = String(r[col] == null ? "" : r[col]).trim();
        if (!v) return;
        allValues[v] = (allValues[v] || 0) + 1;
      });
      var keys = Object.keys(allValues);
      if (keys.length < 2 || keys.length > 100) return;
      anyFilter = true;

      var available = valuesForColumn(col);
      var details = document.createElement("details");
      details.className = "filter-multi";

      var summary = document.createElement("summary");
      summary.className = "filter-toggle";
      var pendingSet = state.pendingFilters[col];
      summary.textContent = summaryFor(col, pendingSet, keys.length);
      details.appendChild(summary);

      var pop = document.createElement("div");
      pop.className = "filter-options";

      // Select-all checkbox
      var selAllLabel = document.createElement("label");
      selAllLabel.className = "filter-option filter-option-all";
      var selAll = document.createElement("input");
      selAll.type = "checkbox";
      selAll.checked = !pendingSet || pendingSet.size === keys.length;
      selAllLabel.appendChild(selAll);
      var selAllTxt = document.createElement("span");
      selAllTxt.textContent = "Select all";
      selAllLabel.appendChild(selAllTxt);
      pop.appendChild(selAllLabel);

      var divider = document.createElement("div");
      divider.className = "filter-divider";
      pop.appendChild(divider);

      keys.sort();
      var optInputs = [];
      keys.forEach(function (k) {
        var l = document.createElement("label");
        l.className = "filter-option";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        // Checked when: no filter set (= all), OR this key is in the filter set
        cb.checked = !pendingSet || pendingSet.has(k);
        if ((available[k] || 0) === 0) l.classList.add("filter-option-empty");
        l.appendChild(cb);
        var txt = document.createElement("span");
        txt.textContent = k + "  (" + allValues[k] + ")";
        l.appendChild(txt);
        pop.appendChild(l);
        optInputs.push({ cb: cb, key: k });

        cb.addEventListener("change", function () {
          var s = state.pendingFilters[col];
          if (cb.checked) {
            // Including this value
            if (!s) {
              // "All" was implicit; checking is a no-op (still all)
              // But keep semantics consistent: just no-op
            } else {
              s.add(k);
              if (s.size === keys.length) {
                // All explicitly checked -> drop the filter (means "All")
                delete state.pendingFilters[col];
              }
            }
          } else {
            // Excluding this value
            if (!s) {
              // Was "all"; promote to a Set of every key except this one
              var newSet = new Set();
              keys.forEach(function (kk) { if (kk !== k) newSet.add(kk); });
              state.pendingFilters[col] = newSet;
            } else {
              s.delete(k);
            }
          }
          summary.textContent = summaryFor(col, state.pendingFilters[col], keys.length);
          var cur = state.pendingFilters[col];
          selAll.checked = !cur || cur.size === keys.length;
        });
      });

      selAll.addEventListener("change", function () {
        if (selAll.checked) {
          delete state.pendingFilters[col];
          optInputs.forEach(function (o) { o.cb.checked = true; });
        } else {
          state.pendingFilters[col] = new Set(); // empty: no values pass
          optInputs.forEach(function (o) { o.cb.checked = false; });
        }
        summary.textContent = summaryFor(col, state.pendingFilters[col], keys.length);
      });

      details.appendChild(pop);
      bar.appendChild(details);
    });

    if (anyFilter || Object.keys(state.activeFilters).length > 0) {
      var actions = document.createElement("div");
      actions.className = "filter-actions";

      var applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "btn btn-primary filter-apply";
      applyBtn.textContent = "Apply";
      applyBtn.addEventListener("click", function () {
        state.activeFilters = cloneFilters(state.pendingFilters);
        renderFilters();
        applyFilters();
      });
      actions.appendChild(applyBtn);

      var clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "btn btn-ghost filter-clear";
      clearBtn.textContent = "Clear all";
      clearBtn.addEventListener("click", function () {
        state.pendingFilters = {}; state.activeFilters = {};
        renderFilters(); applyFilters();
      });
      actions.appendChild(clearBtn);
      bar.appendChild(actions);
    }
  }

  function summaryFor(col, set, totalKeys) {
    if (!set || (totalKeys != null && set.size === totalKeys)) return col + ": All";
    if (set.size === 0) return col + ": None";
    if (set.size <= 2) return col + ": " + Array.from(set).join(", ");
    return col + ": " + set.size + " selected";
  }

  function onSearchInput(e) {
    state.searchText = String(e.target.value || "").toLowerCase().trim();
    applyFilters();
  }

  function applyFilters() {
    var q = state.searchText;
    var filters = state.activeFilters;
    var filterKeys = Object.keys(filters);
    state.filtered = state.rows.filter(function (r) {
      for (var i = 0; i < filterKeys.length; i++) {
        var k = filterKeys[i];
        var allowed = filters[k];
        // Empty Set = "none selected" = nothing passes for this column
        if (!allowed.has(String(r[k] == null ? "" : r[k]).trim())) return false;
      }
      if (q) {
        var hit = false;
        for (var j = 0; j < state.visibleColumns.length; j++) {
          var c = state.visibleColumns[j];
          if (String(r[c] == null ? "" : r[c]).toLowerCase().indexOf(q) !== -1) { hit = true; break; }
        }
        if (!hit) return false;
      }
      return true;
    });
    renderTable();
  }

  // Reformat ISO 8601 datetime strings (e.g. "2026-05-18T18:08:52.818Z")
  // to a friendly local representation like "5/18/2026, 11:40:52 PM".
  function prettifyValue(s) {
    if (typeof s !== "string") return s;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
      var d = new Date(s);
      if (!isNaN(d.getTime())) return d.toLocaleString();
    }
    return s;
  }

  function renderTable() {
    var thead = document.querySelector("#dataTable thead");
    var tbody = document.querySelector("#dataTable tbody");
    thead.innerHTML = ""; tbody.innerHTML = "";
    var cols = state.visibleColumns;
    var tr = document.createElement("tr");
    cols.forEach(function (c) {
      var th = document.createElement("th");
      th.textContent = c;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    state.filtered.forEach(function (r) {
      var rowEl = document.createElement("tr");
      cols.forEach(function (c) {
        var td = document.createElement("td");
        var v = r[c];
        var s = v == null ? "" : String(v);
        s = prettifyValue(s);
        if (/^https?:\/\//i.test(s.trim())) {
          var a = document.createElement("a");
          a.href = s.trim();
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = c;
          a.style.color = "#1f6feb";
          a.style.textDecoration = "underline";
          td.appendChild(a);
        } else {
          td.textContent = s;
        }
        rowEl.appendChild(td);
      });
      tbody.appendChild(rowEl);
    });
    var info = "Showing " + state.filtered.length + " of " + state.rows.length + " record" +
      (state.rows.length === 1 ? "" : "s");
    if (Object.keys(state.activeFilters).length || state.searchText) info += " (filtered)";
    document.getElementById("tableInfo").textContent = info + ".";
  }

  function onDownloadExcel() {
    if (!window.XLSX) { alert("Excel library is still loading. Try again in a moment."); return; }
    var cols = state.visibleColumns;
    var rows = state.filtered.length ? state.filtered : state.rows;
    var aoa = [cols.slice()];
    rows.forEach(function (r) {
      var line = cols.map(function (c) {
        var v = r[c];
        if (v == null) return "";
        return prettifyValue(String(v));
      });
      aoa.push(line);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    var who = state.user && state.user.id ? state.user.id : "data";
    XLSX.writeFile(wb, "cursive_" + who + "_" + stamp + ".xlsx");
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(softRefresh, REFRESH_MS);
  }
  function stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }
  function softRefresh() {
    var saved = readSession();
    if (!saved) { stopAutoRefresh(); return; }
    authenticate(saved.id, saved.password).then(function (res) {
      if (res.ok) showDashboard(res, t