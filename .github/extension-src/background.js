// Cursive PD Tracker — background service worker v1.0.100
// =====================================================
// v1.0.100: FIX heartbeat to report actual manifest version instead of
//           hardcoded "1.0.60". All this time heartbeat reported wrong
//           version even though offscreen.js was being updated.

const SUPABASE_URL = "https://bttppihskbfmxwujyztj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dHBwaWhza2JmbXh3dWp5enRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTk2OTksImV4cCI6MjA5NTI3NTY5OX0.HVy2iOv9t4u6vA2TaMolp2GOrvi-5m9pLW1lXKCnEl8";
// Read version dynamically from manifest so heartbeat always shows real running version
const EXTENSION_VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "unknown";
const ALARM = "pd_tick";
const TICK_SECONDS = 3;
const SELF_CHAIN_MS_MIN = 200;
const SELF_CHAIN_MS_MAX = 800;
function selfChainDelay() { return Math.floor(SELF_CHAIN_MS_MIN + Math.random() * (SELF_CHAIN_MS_MAX - SELF_CHAIN_MS_MIN)); }
const EMPTY_PAUSE_MS = 5000;
const BATCH_SIZE = 15;
const PARALLEL_TABS = 5;
const TAB_TIMEOUT_MS = 35000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const RECIPES_TTL_MS = 24 * 60 * 60 * 1000;
const RECENT_WRITE_TTL_MS = 60000;

const TAB_FALLBACK_FOR_SELLER = new Set(["Flipkart", "Myntra"]);
const PLATFORM_WAIT_MS = { Amazon: 7000, Flipkart: 15000, Meesho: 9000, Myntra: 15000, FirstCry: 7000 };

chrome.runtime.onInstalled.addListener(setupAlarm);
chrome.runtime.onStartup.addListener(setupAlarm);
function setupAlarm() { chrome.alarms.create(ALARM, { periodInMinutes: TICK_SECONDS / 60 }); }
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) tick().catch(e => console.warn("[PD] tick err:", e)); });

function isValidSeller(s) {
  if (!s) return false;
  const v = String(s).trim();
  if (v.length < 2 || v.length > 80) return false;
  const lw = v.toLowerCase();
  if (lw.startsWith("brand:") || lw.startsWith("brand ") || lw === "brand") return false;
  if (lw.startsWith("visit the ") || lw.startsWith("explore ") || lw.startsWith("see other ")) return false;
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "pd_signed_in" || msg.action === "pd_start") { setupAlarm(); tick(); sendResponse({ ok: true }); return true; }
  if (msg.action === "pd_stop" || msg.action === "pd_signed_out") { chrome.alarms.clear(ALARM); sendResponse({ ok: true }); return true; }
  if (msg.action === "pd_bridge_signin") {
    (async () => {
      try {
        if (!sender.tab || !sender.tab.url || !sender.tab.url.startsWith("https://cursive.world/")) {
          sendResponse({ ok: false, error: "Invalid origin" }); return;
        }
        await chrome.storage.local.set({
          pd_jwt: msg.access_token,
          pd_refresh_token: msg.refresh_token || null,
          pd_jwt_expires_at: msg.expires_at || (Date.now() + 3600 * 1000),
          pd_email: msg.email, pd_running: true,
        });
        setupAlarm(); tick().catch(() => {});
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true;
  }
  if (msg.action === "pd_diag") {
    const tag = msg.source === "MANUAL" ? "[PD-DIAG-MANUAL]" : "[PD-DIAG-AUTO]";
    console.log(tag, msg.platform, "url=", String(msg.url || "").substring(0, 80),
      "price=", msg.price, "rating=", msg.rating, "count=", msg.reviewCount,
      "seller=", msg.seller, "ok=", msg.success);
    sendResponse({ ok: true });
    return true;
  }
  sendResponse({ ok: true }); return true;
});

const _recentlyWritten = new Map();
function markRecentlyWritten(productId) { _recentlyWritten.set(productId, Date.now()); }
function isRecentlyWritten(productId) {
  const t = _recentlyWritten.get(productId);
  if (!t) return false;
  if (Date.now() - t > RECENT_WRITE_TTL_MS) { _recentlyWritten.delete(productId); return false; }
  return true;
}

async function getAuth() {
  const s = await chrome.storage.local.get(["pd_jwt", "pd_refresh_token", "pd_jwt_expires_at", "pd_running"]);
  if (s.pd_running === false) return null;
  const hasJwt = !!s.pd_jwt;
  const expiresAt = s.pd_jwt_expires_at || 0;
  const expiresIn = expiresAt - Date.now();
  const needsRefresh = !hasJwt || !expiresAt || expiresIn < 5 * 60 * 1000;
  if (needsRefresh && s.pd_refresh_token) {
    try {
      const r = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: s.pd_refresh_token }),
      });
      const j = await r.json();
      if (r.ok && j.access_token) {
        await chrome.storage.local.set({
          pd_jwt: j.access_token, pd_refresh_token: j.refresh_token,
          pd_jwt_expires_at: Date.now() + (j.expires_in * 1000),
          pd_last_refresh: Date.now(),
        });
        console.log("[PD] JWT refreshed silently. Expires in", j.expires_in, "sec");
        return j.access_token;
      } else {
        console.warn("[PD] refresh rejected:", r.status, j.error_description || j.msg);
      }
    } catch (e) { console.warn("[PD] refresh network err:", e); }
  }
  if (!hasJwt) return null;
  if (expiresIn < -60 * 60 * 1000) return null;
  return s.pd_jwt;
}
async function apiFetch(path, opts) {
  opts = opts || {};
  const jwt = await getAuth();
  if (!jwt) throw new Error("Not signed in");
  const headers = Object.assign({
    "Content-Type": "application/json",
    "Authorization": "Bearer " + jwt,
    "apikey": SUPABASE_ANON_KEY,
  }, opts.headers || {});
  return fetch(SUPABASE_URL + path, Object.assign({}, opts, { headers }));
}
async function refreshRecipesIfStale() {
  const s = await chrome.storage.local.get(["pd_recipes", "pd_recipes_at"]);
  if (s.pd_recipes && s.pd_recipes_at && (Date.now() - s.pd_recipes_at) < RECIPES_TTL_MS) return s.pd_recipes;
  try {
    const r = await fetch(SUPABASE_URL + "/functions/v1/analytics-recipes", { headers: { "apikey": SUPABASE_ANON_KEY } });
    const j = await r.json();
    if (j.ok && j.recipes) {
      await chrome.storage.local.set({ pd_recipes: j.recipes, pd_recipes_at: Date.now() });
      return j.recipes;
    }
  } catch (e) { console.warn("[PD] recipes:", e); }
  return s.pd_recipes || null;
}
async function sendHeartbeatIfDue() {
  const s = await chrome.storage.local.get(["pd_last_heartbeat", "pd_pending_count"]);
  if (s.pd_last_heartbeat && (Date.now() - s.pd_last_heartbeat) < HEARTBEAT_INTERVAL_MS) return;
  try {
    const r = await apiFetch("/functions/v1/analytics-heartbeat", {
      method: "POST",
      body: JSON.stringify({ extension_version: EXTENSION_VERSION, platform_os: navigator.platform || "Unknown", active_products: s.pd_pending_count || 0 }),
    });
    if (r.ok) await chrome.storage.local.set({ pd_last_heartbeat: Date.now() });
  } catch (e) { console.warn("[PD] heartbeat:", e); }
}

// ===== HERO WINDOW =====
let _heroWinId = null;
let _heroTabId = null;
let _heroCreatePromise = null;
async function ensureHeroWindow() {
  if (_heroWinId != null) {
    try { await chrome.windows.get(_heroWinId); return _heroWinId; }
    catch { _heroWinId = null; _heroTabId = null; }
  }
  if (_heroCreatePromise) return await _heroCreatePromise;
  _heroCreatePromise = (async () => {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL("mask.html"),
      focused: false, type: "normal",
      width: 1280, height: 800, left: 0, top: 0,
    });
    _heroWinId = win.id;
    _heroTabId = (win.tabs && win.tabs[0]) ? win.tabs[0].id : null;
    await new Promise(r => setTimeout(r, 200));
    try { await chrome.windows.update(_heroWinId, { state: "minimized", focused: false }); } catch {}
    return _heroWinId;
  })();
  try { return await _heroCreatePromise; }
  finally { _heroCreatePromise = null; }
}

let _tickInProgress = false;
async function tick() {
  if (_tickInProgress) return;
  const jwt = await getAuth(); if (!jwt) return;
  _tickInProgress = true;
  try {
    await refreshRecipesIfStale();
    await sendHeartbeatIfDue();
    const r = await apiFetch("/functions/v1/analytics-next-products?limit=" + BATCH_SIZE);
    if (!r.ok) { console.warn("[PD] next-products failed:", r.status); return; }
    const j = await r.json();
    let products = (j.products || []).filter(p => !isRecentlyWritten(p.id));
    await chrome.storage.local.set({ pd_pending_count: products.length });
    if (products.length === 0) {
      setTimeout(() => tick().catch(() => {}), EMPTY_PAUSE_MS);
      return;
    }
    await chrome.storage.local.set({ pd_last_fetch: Date.now() });
    const results = [];
    for (let i = 0; i < products.length; i += PARALLEL_TABS) {
      const chunk = products.slice(i, i + PARALLEL_TABS);
      const chunkResults = await Promise.all(chunk.map(p => extractProduct(p)));
      results.push(...chunkResults);
    }
    const validResults = results.filter(r => r != null);
    if (validResults.length > 0) {
      validResults.forEach(r => markRecentlyWritten(r.product_id_fk));
      const postR = await apiFetch("/functions/v1/analytics-snapshot", {
        method: "POST", body: JSON.stringify({ results: validResults }),
      });
      if (postR.ok) await chrome.storage.local.set({ pd_last_ok: Date.now() });
    }
    setTimeout(() => tick().catch(() => {}), selfChainDelay());
  } finally { _tickInProgress = false; }
}

// ===== OFFSCREEN =====
let _offscreenReady = false;
async function ensureOffscreen() {
  if (_offscreenReady) return;
  try {
    const has = await (chrome.offscreen.hasDocument && chrome.offscreen.hasDocument());
    if (has) { _offscreenReady = true; return; }
  } catch {}
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "Parse marketplace HTML in background without opening tabs",
    });
    _offscreenReady = true;
  } catch (e) {
    if (String(e).includes("Only a single offscreen document")) { _offscreenReady = true; return; }
    console.warn("[PD] offscreen create failed:", e);
  }
}
async function extractViaOffscreen(product) {
  await ensureOffscreen();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 15000);
    chrome.runtime.sendMessage({ action: "pd_scrape_url", product }, (resp) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) return resolve(null);
      resolve(resp);
    });
  });
}

// ===== TAB FALLBACK =====
async function extractViaTab(product) {
  let tabId = null;
  try {
    const winId = await ensureHeroWindow();
    const tab = await chrome.tabs.create({ url: product.product_url, active: false, windowId: winId });
    tabId = tab.id;
    try { await chrome.windows.update(winId, { state: "minimized", focused: false }); } catch {}
    await waitForTabComplete(tabId, 12000);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: injectHeroOverlay,
        args: [chrome.runtime.getURL("icon128.png")],
      });
    } catch (e) { console.warn("[PD] overlay inject err:", e && e.message); }
    try {
      const t = await chrome.tabs.get(tabId);
      if (t && t.windowId !== winId) await chrome.tabs.move(tabId, { windowId: winId, index: -1 });
    } catch {}
    const waitMs = PLATFORM_WAIT_MS[product.platform] || 7000;
    await new Promise(r => setTimeout(r, waitMs));
    const recipes = (await chrome.storage.local.get("pd_recipes")).pd_recipes || {};
    const recipe = recipes[product.platform] || {};
    const data = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), TAB_TIMEOUT_MS);
      chrome.tabs.sendMessage(tabId, { action: "extractRating", recipe }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return resolve(null);
        resolve(response);
      });
    });
    try { await chrome.history.deleteUrl({ url: product.product_url }); } catch {}
    chrome.tabs.remove(tabId).catch(() => {});
    if (!data || !data.success) {
      return { product_id_fk: product.id, status: "fail_temporary",
        rating: null, review_count: null, price: null, seller: null };
    }
    return {
      product_id_fk: product.id,
      rating: data.rating != null ? data.rating : null,
      review_count: data.reviewCount != null ? data.reviewCount : null,
      price: data.price != null ? data.price : null,
      seller: data.seller != null ? data.seller : null,
      status: (data.price != null || data.rating != null) ? "ok" : "fail_temporary",
    };
  } catch (e) {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
    console.warn("[PD] tab extract failed:", e && e.message);
    return { product_id_fk: product.id, status: "fail_temporary",
      rating: null, review_count: null, price: null, seller: null };
  }
}

function injectHeroOverlay(iconUrl) {
  try {
    if (document.getElementById("__cursive_hero_overlay__")) return;
    const overlay = document.createElement("div");
    overlay.id = "__cursive_hero_overlay__";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:linear-gradient(135deg,#1f6feb 0%,#1858d6 100%);color:#fff;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:auto;overflow:hidden;";
    overlay.innerHTML =
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;">' +
        '<div style="width:56px;height:56px;border-radius:14px;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;">' +
          '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="3 17 9 11 13 15 21 6"/><polyline points="15 6 21 6 21 12"/>' +
          '</svg>' +
        '</div>' +
        '<div style="font-size:44px;font-weight:700;letter-spacing:0.5px;">Cursive<sup style="font-size:18px;">&reg;</sup></div>' +
      '</div>' +
      '<div style="font-size:13px;font-weight:700;letter-spacing:3px;background:rgba(255,255,255,0.16);padding:6px 14px;border-radius:999px;">PD TRACKER &middot; INDIA\'S SELLER TOOLKIT</div>' +
      '<div style="margin-top:36px;display:flex;gap:10px;align-items:center;background:rgba(255,255,255,0.12);padding:10px 18px;border-radius:999px;">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,0.8);animation:cwpulse 1.6s infinite;"></span>' +
        '<span style="font-size:14px;font-weight:600;">Service active &middot; tracking your products</span>' +
      '</div>' +
      '<div style="margin-top:32px;font-size:12px;opacity:0.78;max-width:520px;line-height:1.6;">' +
        'This window is the Cursive PD Tracker background service. ' +
        'Keep it minimized in the taskbar &mdash; the service runs automatically. ' +
        'You can close it any time; it relaunches when Chrome starts.' +
      '</div>' +
      '<div style="position:absolute;bottom:20px;font-size:11px;opacity:0.7;">' +
        'WhatsApp +91 96257 37475 &middot; contact@cursive.world' +
      '</div>' +
      '<style>@keyframes cwpulse {0%{box-shadow:0 0 0 0 rgba(34,197,94,0.7);}70%{box-shadow:0 0 0 12px rgba(34,197,94,0);}100%{box-shadow:0 0 0 0 rgba(34,197,94,0);}}</style>';
    document.documentElement.appendChild(overlay);
    try { document.title = "Cursive PD Tracker"; } catch {}
    try {
      document.querySelectorAll('link[rel*="icon"]').forEach(l => l.remove());
      const link = document.createElement("link");
      link.rel = "icon"; link.href = iconUrl;
      (document.head || document.documentElement).appendChild(link);
    } catch {}
  } catch (e) { console.warn("[PD] overlay err", e); }
}

async function extractProduct(product) {
  try {
    const off = await extractViaOffscreen(product);
    const hasPriceOrRating = off && off.success && (off.price != null || off.rating != null);
    const hasSeller = off && off.seller != null && String(off.seller).length > 0;
    const needsTabForSeller = TAB_FALLBACK_FOR_SELLER.has(product.platform) && !hasSeller;
    if (hasPriceOrRating && !needsTabForSeller) {
      return {
        product_id_fk: product.id,
        rating: off.rating != null ? off.rating : null,
        review_count: off.review_count != null ? off.review_count : null,
        price: off.price != null ? off.price : null,
        seller: isValidSeller(off.seller) ? off.seller : null,
        status: "ok",
      };
    }
    const tab = await extractViaTab(product);
    if (tab && tab.status === "ok") {
      return {
        product_id_fk: product.id,
        rating: tab.rating != null ? tab.rating : (off ? off.rating : null),
        review_count: tab.review_count != null ? tab.review_count : (off ? off.review_count : null),
        price: tab.price != null ? tab.price : (off ? off.price : null),
        seller: isValidSeller(tab.seller) ? tab.seller : (off && isValidSeller(off.seller) ? off.seller : null),
        status: "ok",
      };
    }
    if (hasPriceOrRating) {
      return {
        product_id_fk: product.id,
        rating: off.rating != null ? off.rating : null,
        review_count: off.review_count != null ? off.review_count : null,
        price: off.price != null ? off.price : null,
        seller: off.seller != null ? off.seller : null,
        status: "ok",
      };
    }
    return { product_id_fk: product.id, status: "fail_temporary",
      rating: null, review_count: null, price: null, seller: null };
  } catch (e) {
    console.warn("[PD] extractProduct err:", e);
    return { product_id_fk: product.id, status: "fail_temporary",
      rating: null, review_count: null, price: null, seller: null };
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(false); }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(() => resolve(true), 800);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

console.log("[PD] Service worker boot — version", EXTENSION_VERSION);
setupAlarm();
getAuth().then(jwt => {
  if (jwt) { console.log("[PD] JWT ready on boot, starting tick"); tick().catch(() => {}); }
  else { console.warn("[PD] No JWT on boot — waiting for customer to visit cursive.world/pdtracker/"); }
}).catch(e => console.warn("[PD] boot getAuth err:", e));
