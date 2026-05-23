/**
 * cursive - combined Apps Script (v12 SERVICE PAY)
 * Changes vs v11:
 *   - service_pay_initiate + service_pay_complete endpoints
 *   - dedicated landing pages (/gst/, /trademark/, /udyam/, /iec/, /marketplace/) can take Razorpay payments
 *   - invoice + welcome email sent after payment
 *   - lead in "All Leads" marked as "paid" + recorded in "Service Payments"
 * v11:
 *   - lead_otp_send + lead_otp_verify endpoints (2-step OTP flow for service leads)
 *   - new "Lead OTP Pending" sheet auto-created
 *   - All Leads gets the row only after OTP is verified
 * v10:
 *   - service_lead endpoint (legacy direct lead, no OTP)
 *   - "All Leads" sheet (unified, column A = service type)
 * v9:
 *   - wallet flow: pay -> credit wallet -> Continue -> upload + debit
 *   - 3 wallet endpoints: wallet_balance, wallet_credit, wallet_upload
 *   - 2 new sheets auto-created: Wallets, Wallet Ledger
 *   - paid_upload_complete kept as fallback for old cached browsers
 */

// ====== ONE-TIME CLEANUP WRAPPERS (run these from the dropdown) ======
function AAA_RUN_REBUILD_ALL_LEADS() { return rebuildAllLeadsClean(); }
function AAA_RUN_CLEANUP_OLD_TABS() { return cleanupObsoleteTabs(); }
function AAA_RUN_MIGRATE_DATE_TIME() { return migrateAddDateTimeColumns(); }
function AAA_RUN_BOOTSTRAP_ALL_TABS() { return bootstrapAllTabs(); }
// =====================================================================

/**
 * Force-create every tab the script uses with proper headers,
 * so the admin sheet shows all tabs from day one (not lazily).
 */
function bootstrapAllTabs() {
  var log = [];
  try { allLeadsSheet_();        log.push("OK: All Leads"); } catch (e) { log.push("ERR All Leads: " + e); }
  try { pendingPaymentsSheet_(); log.push("OK: Pending Payments"); } catch (e) { log.push("ERR Pending Payments: " + e); }
  try { walletsSheet_();         log.push("OK: Wallets"); } catch (e) { log.push("ERR Wallets: " + e); }
  try { walletLedgerSheet_();    log.push("OK: Wallet Ledger"); } catch (e) { log.push("ERR Wallet Ledger: " + e); }
  try { promoCodesSheet_();      log.push("OK: Promo Codes"); } catch (e) { log.push("ERR Promo Codes: " + e); }
  // Completed Payments + Invoices created on first paid event - force them too
  var ss = _adminSS_();
  ["Completed Payments", "Invoices"].forEach(function(n){
    if (!ss.getSheetByName(n)) { ss.insertSheet(n); log.push("Created: " + n); }
    else log.push("Exists: " + n);
  });
  Logger.log(log.join("\n"));
  return log.join("\n");
}

const SOURCES = [
  [101, 'https://docs.google.com/spreadsheets/d/1tr8uIZv4WKvYGdqFwjKFUp0Kk6vKuHJ7NYk0kXZIpKU/edit'],
  [102, 'https://docs.google.com/spreadsheets/d/1AzMm0zCSVLxiHmYogGvUtXqzTzk0W7z7T84SchSDxV4/edit'],
  [103, 'https://docs.google.com/spreadsheets/d/1a6Q5TVXuIrC5V1MOyzm85gUmervqviNrBKFQYJUl9jU/edit'],
  [104, 'https://docs.google.com/spreadsheets/d/1hCuPIFw4Fv6bUPlzdL25P6aaYFnIzpP6UMf4BLt-IJQ/edit'],
  [105, 'https://docs.google.com/spreadsheets/d/1VnvzuPwuZSjDo841WQsImdMyz8iRO2LTLZaD78TVr6g/edit'],
  [106, 'https://docs.google.com/spreadsheets/d/1ImlF82dnoiZKK_WGUuR0bnB0KOUi7EYvggIKBs-9JkY/edit'],
  [107, 'https://docs.google.com/spreadsheets/d/1QKqnW28SvM8KtI3UF-_hFeAYuNL5QxtvzXBGIiXN9Y8/edit'],
  [108, 'https://docs.google.com/spreadsheets/d/11doC1u9Ani2V--uH8KVUaFfAKLCv8RJdlp4z5bi2l8k/edit'],
  [109, 'https://docs.google.com/spreadsheets/d/1eRbuXc9U3Yybq25aJDF9uxuJRoYsB00GGeehcDfb0Uw/edit'],
  [110, 'https://docs.google.com/spreadsheets/d/1f_yNZN-EZhIh8skLxoPwwh1QXB1UxTLBjfXkFNNzK3g/edit'],
  [111, 'https://docs.google.com/spreadsheets/d/1zd_BljmGEBWtrKOfZ-bv2tVBVrfvzB_CT0XsjLS1JCc/edit'],
  [112, 'https://docs.google.com/spreadsheets/d/1lIyyIHSHcNg4zMB6ZZwpm7YWGkyQ9-Uyfdg-4gWj_ME/edit'],
  [113, 'https://docs.google.com/spreadsheets/d/1WWlcEYON7xxSR60IlCJf2RO706r6ke-G0mf7YnnJo1o/edit'],
  [114, 'https://docs.google.com/spreadsheets/d/1r0z1DV_YndVlVgejMQr_14fFDHF18dnN3FDMveOmjpk/edit'],
  [115, 'https://docs.google.com/spreadsheets/d/1wvGtg2Lhlz6EcTjPtFHRq8v__4lZv2zMig3j1gBfV5c/edit'],
  [116, 'https://docs.google.com/spreadsheets/d/1v0mQiTQjN3mQQzitN3L3Cf8HKUWskz1EgbJmhpicj_w/edit'],
  [117, 'https://docs.google.com/spreadsheets/d/1kqeURNf7rZc0Sll0tFRwJ0hr68bC_wwnCzfr__81Yh8/edit'],
  [118, 'https://docs.google.com/spreadsheets/d/1mLrzM4qG9iVy2XE252FqzKd1vRDTNqWDtLldQ92SJgU/edit'],
  [119, 'https://docs.google.com/spreadsheets/d/1cdWXFfB2YBjTvACxBWxggPNf7DzO52sRM1j1KRvozUc/edit'],
  [120, 'https://docs.google.com/spreadsheets/d/1euOw9-zZ83bC7xgEQAH5EY2vhTpw5pq-exW_SeLAjt4/edit'],
  [121, 'https://docs.google.com/spreadsheets/d/1uyN5mWz3iZ7wuG0euxuWpGa5mxRqbVXB4ZUuNVAg2kY/edit']
];

const NUM_COLS = 9;
const START_ROW = 2;
const TRIGGER_MINUTES = 1;
const DEST_START_ROW = 2;
const RATINGS_URL = 'https://docs.google.com/spreadsheets/d/18lfy_FMDH8AM7gcIgbKIBlaxXljZKlVFhd_hsWvzLk8/edit';
const RATINGS_TAB = 'Ratings Others';
const RATINGS_NUM_COLS = 6;
const RATINGS_DEST_START_COL = 10;

function consolidateSheets(silent) {
  const dest = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = dest.getLastRow();
  if (lastRow >= DEST_START_ROW) dest.getRange(DEST_START_ROW, 1, lastRow - DEST_START_ROW + 1, NUM_COLS).clearContent();
  const allRows = []; const errors = [];
  SOURCES.forEach(function (entry) {
    try {
      const sheet = SpreadsheetApp.openByUrl(entry[1]).getSheets()[0];
      const lr = sheet.getLastRow();
      if (lr < START_ROW) return;
      sheet.getRange(START_ROW, 1, lr - START_ROW + 1, NUM_COLS).getValues().forEach(function (row) {
        if (!row.every(function (c) { return c === '' || c === null; })) allRows.push(row);
      });
    } catch (e) { errors.push('Sheet ' + entry[0] + ': ' + e.message); }
  });
  if (allRows.length > 0) dest.getRange(DEST_START_ROW, 1, allRows.length, NUM_COLS).setValues(allRows);
  importRatingsOthers(dest);
  if (!silent) { try { SpreadsheetApp.getUi().alert('Done. ' + allRows.length + ' rows.'); } catch (e) {} }
}

function importRatingsOthers(dest) {
  if (!dest) dest = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const destLastRow = dest.getLastRow();
  if (destLastRow >= DEST_START_ROW) dest.getRange(DEST_START_ROW, RATINGS_DEST_START_COL, destLastRow - DEST_START_ROW + 1, RATINGS_NUM_COLS).clearContent();
  let sheet;
  try { sheet = SpreadsheetApp.openByUrl(RATINGS_URL).getSheetByName(RATINGS_TAB); }
  catch (e) { return 'open failed.'; }
  if (!sheet) return 'tab not found.';
  const lr = sheet.getLastRow();
  if (lr < START_ROW) return 'no data.';
  const numRows = lr - START_ROW + 1;
  const block = sheet.getRange(START_ROW, 12, numRows, 13).getValues();
  const xFormats = sheet.getRange(START_ROW, 24, numRows, 1).getNumberFormats();
  const rows = []; const oFormats = [];
  block.forEach(function (r, idx) {
    const newRow = [r[1], r[2], r[3], r[4], r[0], r[12]];
    if (!newRow.every(function (c) { return c === '' || c === null; })) {
      rows.push(newRow); oFormats.push([xFormats[idx][0] || 'yyyy-mm-dd hh:mm:ss']);
    }
  });
  if (rows.length > 0) {
    dest.getRange(DEST_START_ROW, RATINGS_DEST_START_COL, rows.length, RATINGS_NUM_COLS).setValues(rows);
    dest.getRange(DEST_START_ROW, RATINGS_DEST_START_COL + 5, rows.length, 1).setNumberFormats(oFormats);
  }
  return rows.length + ' rows.';
}

function runAll() { consolidateSheets(); }
function installTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('consolidateSheets').timeBased().everyMinutes(TRIGGER_MINUTES).create();
}
function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'consolidateSheets') ScriptApp.deleteTrigger(t);
  });
}


/* ============================================================
 * Per-request caches
 * ============================================================ */

var __SSAdmin = null;
var __LandingSheet = null;
var __MasterValues = null;

var TRIAL_LANDING_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1tr8uIZv4WKvYGdqFwjKFUp0Kk6vKuHJ7NYk0kXZIpKU/edit';
var TRIAL_LANDING_TAB_INDEX = 0;
var TRIAL_ADMIN_SHEET_URL = 'https://docs.google.com/spreadsheets/d/16CEjVmUGp60K3yPM3aoBiDfn-Aaq-pvCSlUm2BRkCzY/edit';
var TRIAL_OTP_TAB    = "OTP Pending";
var TRIAL_SIGNUP_TAB = "Trial Signups";
var TRIAL_OTP_VALID_MIN   = 10;
var TRIAL_TOKEN_VALID_MIN = 30;
var TRIAL_MAX_PRODUCTS = 10;

function _adminSS_() {
  if (!__SSAdmin) __SSAdmin = SpreadsheetApp.openByUrl(TRIAL_ADMIN_SHEET_URL);
  return __SSAdmin;
}

function _landingSheet_() {
  if (!__LandingSheet) __LandingSheet = SpreadsheetApp.openByUrl(TRIAL_LANDING_SHEET_URL).getSheets()[TRIAL_LANDING_TAB_INDEX];
  return __LandingSheet;
}

function _masterValues_() {
  if (!__MasterValues) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    __MasterValues = sheet.getDataRange().getValues();
  }
  return __MasterValues;
}

/* Force re-read of master values after we mutate it (e.g. wallet_upload). */
function _invalidateMasterValues_() { __MasterValues = null; }


/* SECTION 2 - Analytics web-app helpers */

const ANALYTICS_SHEET_NAME    = "";
const ANALYTICS_ID_COL_LETTER = "D";
const ANALYTICS_PW_COL_LETTER = "H";

function analyticsHandle_(e) {
  try {
    var params = (e && e.parameter) || {};
    var id = String(params.id || "").trim();
    var pw = String(params.password || "");
    if (!id || !pw) return analyticsJson_({ ok: false, message: "Missing credentials." });
    var values = _masterValues_();
    if (values.length < 2) return analyticsJson_({ ok: false, message: "Sheet has no data rows." });
    var headers = values[0].map(function (h, i) {
      var s = String(h == null ? "" : h).trim();
      return s || ("Column " + (i + 1));
    });
    var idIdx = analyticsLetterToIndex_(ANALYTICS_ID_COL_LETTER);
    var pwIdx = analyticsLetterToIndex_(ANALYTICS_PW_COL_LETTER);
    var matched = []; var passwordOk = false;
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var rowId = String(row[idIdx] == null ? "" : row[idIdx]).trim();
      if (!rowId) continue;
      if (rowId.toLowerCase() !== id.toLowerCase()) continue;
      var rowObj = {};
      for (var c = 0; c < headers.length; c++) {
        if (c === pwIdx) continue;
        var v = row[c]; if (v instanceof Date) v = v.toISOString();
        rowObj[headers[c]] = v;
      }
      matched.push(rowObj);
      if (String(row[pwIdx]) === pw) passwordOk = true;
    }
    if (matched.length === 0 || !passwordOk) return analyticsJson_({ ok: false, message: "Invalid ID or password." });
    var visibleColumns = headers.filter(function (_, i) { return i !== pwIdx; });
    return analyticsJson_({ ok: true, id: id, columns: visibleColumns, rows: matched });
  } catch (err) {
    return analyticsJson_({ ok: false, message: "Server error: " + (err && err.message ? err.message : err) });
  }
}

function analyticsLetterToIndex_(letters) {
  var s = String(letters || "").toUpperCase(); var n = 0;
  for (var i = 0; i < s.length; i++) {
    var code = s.charCodeAt(i);
    if (code < 65 || code > 90) return -1;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function analyticsJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


/* SECTION 3 - Trial flow + main dispatcher */

function doGet(e)  { return handleRequest_(e); }
function doPost(e) { return handleRequest_(e); }

function handleRequest_(e) {
  var p = (e && e.parameter) || {};
  var action = String(p.action || "").toLowerCase();
  try {
    if (action === "trial_signup")          return analyticsJson_(trialSignup_(p));
    if (action === "trial_verify")          return analyticsJson_(trialVerify_(p));
    if (action === "trial_upload")          return analyticsJson_(trialUpload_(p));
    if (action === "paid_upload_initiate")  return analyticsJson_(paidUploadInitiate_(p));
    if (action === "paid_upload_complete")  return analyticsJson_(paidUploadComplete_(p));
    if (action === "wallet_balance")        return analyticsJson_(walletBalance_(p));
    if (action === "wallet_credit")         return analyticsJson_(walletCredit_(p));
    if (action === "wallet_upload")         return analyticsJson_(walletUpload_(p));
    if (action === "service_lead")          return analyticsJson_(serviceLead_(p));
    if (action === "lead_draft")            return analyticsJson_(leadDraft_(p));
    if (action === "lead_otp_send")         return analyticsJson_(leadOtpSend_(p));
    if (action === "lead_otp_verify")       return analyticsJson_(leadOtpVerify_(p));
    if (action === "lead_cta")              return analyticsJson_(leadCta_(p));
    if (action === "service_pay_initiate")  return analyticsJson_(servicePayInitiate_(p));
    if (action === "service_pay_complete")  return analyticsJson_(servicePayComplete_(p));
    if (action === "validate_promo")        return analyticsJson_(validatePromo_(p));
    return analyticsHandle_(e);
  } catch (err) {
    return analyticsJson_({ ok: false, message: "Server error: " + (err && err.message ? err.message : err) });
  }
}

function trialSignup_(p) {
  var mobile = String(p.mobile || "").replace(/\D/g, "");
  var email  = String(p.email  || "").trim().toLowerCase();
  var gstin  = String(p.gstin || p.gtin || "").trim().toUpperCase();
  if (!mobile || mobile.length < 7) return { ok: false, message: "Please enter a valid mobile number." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Please enter a valid email." };

  // Check All Leads for existing trial signup with same email or mobile
  var allLeads = allLeadsSheet_();
  var existing = allLeads.getDataRange().getValues();
  var emailTaken = false, mobileTaken = false;
  for (var k = 1; k < existing.length; k++) {
    var rowStatus = String(existing[k][9] || "").toLowerCase();
    if (rowStatus !== "trial_uploaded" && rowStatus !== "trial_verified") continue;
    if (String(existing[k][6] || "").trim().toLowerCase() === email)  emailTaken = true;
    if (String(existing[k][5] || "").replace(/\D/g, "") === mobile) mobileTaken = true;
  }
  if (emailTaken && mobileTaken) return { ok: false, message: "Both your mobile number and email are already registered. Please sign in instead." };
  if (emailTaken)  return { ok: false, message: "This email is already registered. Please sign in instead." };
  if (mobileTaken) return { ok: false, message: "This mobile number is already registered. Please sign in instead." };

  var otp = trialGenerateOtp_();
  // Store OTP in cache (10 min TTL) - no sheet needed
  var payload = JSON.stringify({ otp: otp, mobile: mobile, email: email, gstin: gstin, token: "", verified: false });
  CacheService.getScriptCache().put("trialotp:" + email, payload, TRIAL_OTP_VALID_MIN * 60);

  try { MailApp.sendEmail({ to: email, subject: "Your cursive verification code", htmlBody: trialOtpEmailHtml_(otp), name: "cursive" }); }
  catch (e1) { return { ok: false, message: "Could not send the OTP email." }; }

  // Log to All Leads as trial_otp_sent event
  logAllLead_("analytics", "", mobile, email, "",
              "Trial OTP " + otp + " sent. GSTIN: " + (gstin || "(not given)"),
              "Free Analytics Trial", "Free", "trial_otp_sent", "trial_signup", "/analytics/");

  return { ok: true, message: "OTP sent to " + email };
}

function trialOtpEmailHtml_(otp) {
  return '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f6f8fa">'
    + '<div style="background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:28px">'
    + '<div style="font-size:18px;font-weight:700;color:#1f6feb;margin-bottom:8px">cursive</div>'
    + '<h2>Your verification code</h2><p>Valid for ' + TRIAL_OTP_VALID_MIN + ' minutes.</p>'
    + '<div style="font-size:32px;font-weight:700;letter-spacing:6px;text-align:center;background:#f6f8fa;border:1px dashed #d0d7de;border-radius:8px;padding:16px">' + otp + '</div>'
    + '<p style="color:#57606a;font-size:12px;margin-top:20px">Need help? Contact@cursive.world or WhatsApp +91 96257 37475.</p>'
    + '</div></div>';
}

function trialVerify_(p) {
  var email = String(p.email || "").trim().toLowerCase();
  var otp   = String(p.otp   || "").trim();
  if (!email || !/^\d{4,8}$/.test(otp)) return { ok: false, message: "Invalid input." };

  var cacheKey = "trialotp:" + email;
  var cached = CacheService.getScriptCache().get(cacheKey);
  if (!cached) return { ok: false, message: "No OTP issued or expired. Sign up again." };
  var stored;
  try { stored = JSON.parse(cached); } catch (e) { return { ok: false, message: "OTP data corrupted." }; }

  if (String(stored.otp).trim() !== otp) return { ok: false, message: "Incorrect OTP." };

  // Issue token, mark verified, keep in cache for TRIAL_TOKEN_VALID_MIN to allow upload
  var token = Utilities.getUuid().replace(/-/g, "");
  stored.token = token;
  stored.verified = true;
  CacheService.getScriptCache().put(cacheKey, JSON.stringify(stored), TRIAL_TOKEN_VALID_MIN * 60);

  // Log to All Leads as trial_verified event
  logAllLead_("analytics", "", String(stored.mobile || ""), email, "",
              "Trial OTP verified. GSTIN: " + (String(stored.gstin || "") || "(not given)"),
              "Free Analytics Trial", "Free", "trial_verified", "trial_verify", "/analytics/");

  return { ok: true, token: token };
}

function trialUpload_(p) {
  var email = String(p.email || "").trim().toLowerCase();
  var token = String(p.token || "").trim();
  var password = String(p.password || "");
  var mobile = String(p.mobile || "").replace(/\D/g, "");
  var gstin = String(p.gstin || p.gtin || "").trim().toUpperCase();
  if (!email || !token || !password || !mobile) return { ok: false, message: "Missing fields." };
  if (password.length < 6) return { ok: false, message: "Password must be 6+ chars." };
  var rows;
  try { rows = (typeof p.rows === "string") ? JSON.parse(p.rows) : p.rows; }
  catch (e) { return { ok: false, message: "Invalid rows." }; }
  if (!rows || !rows.length) return { ok: false, message: "No rows." };
  if (rows.length > TRIAL_MAX_PRODUCTS) return { ok: false, message: "Free trial limited to " + TRIAL_MAX_PRODUCTS + " products. Your file has " + rows.length + "." };

  // Verify session via cache
  var cacheKey = "trialotp:" + email;
  var cached = CacheService.getScriptCache().get(cacheKey);
  if (!cached) return { ok: false, message: "Session expired. Sign up again." };
  var stored;
  try { stored = JSON.parse(cached); } catch (e) { return { ok: false, message: "Session corrupted." }; }
  if (!stored.verified || stored.token !== token) return { ok: false, message: "Session not verified." };
  for (var i = 0; i < rows.length; i++) {
    var rw = rows[i] || {};
    if (String(rw.mobile || "").replace(/\D/g, "") !== mobile) return { ok: false, message: "Row " + (i + 1) + ": mobile mismatch." };
    if (String(rw.email || "").trim().toLowerCase() !== email) return { ok: false, message: "Row " + (i + 1) + ": email mismatch." };
    if (!rw.country || !rw.state || !rw.platform || !rw.productId) return { ok: false, message: "Row " + (i + 1) + ": all fields required." };
  }
  var landing = _landingSheet_();
  var firstEmpty = landing.getLastRow() + 1;
  var batch = rows.map(function (rw) {
    var line = new Array(16); for (var k = 0; k < 16; k++) line[k] = "";
    line[0]=rw.country; line[1]=rw.state; line[3]=email; line[5]=rw.platform; line[6]=rw.productId; line[7]=password; line[15]=mobile;
    return line;
  });
  landing.getRange(firstEmpty, 1, batch.length, 16).setValues(batch);
  try {
    var master = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var masterBatch = rows.map(function (rw) {
      var line = new Array(NUM_COLS); for (var k = 0; k < NUM_COLS; k++) line[k] = "";
      line[0]=rw.country; line[1]=rw.state; line[3]=email; line[5]=rw.platform; line[6]=rw.productId; line[7]=password;
      return line;
    });
    master.getRange(master.getLastRow() + 1, 1, masterBatch.length, NUM_COLS).setValues(masterBatch);
    _invalidateMasterValues_();
  } catch (err) {}
  // No more Trial Signups sheet write - All Leads handles the record.
  // Clear the cache entry to release the session.
  CacheService.getScriptCache().remove(cacheKey);

  // Update All Leads to "trial_uploaded"
  logAllLead_("analytics", "", mobile, email, "",
              rows.length + " rows uploaded for free analytics trial",
              "Free Analytics Trial", "Free", "trial_uploaded", "trial_upload", "/analytics/");

  return { ok: true };
}

// Legacy helpers removed - OTP now in CacheService, trial data in All Leads.
// trialOtpSheet_, trialSignupSheet_, leadOtpSheet_ are no-ops kept only for
// backward compatibility with any cached browser callers.
function trialGenerateOtp_() { return String(Math.floor(100000 + Math.random() * 900000)); }


/* SECTION 4 - Paid upload + Razorpay */

var PAID_PER_ROW_RUPEES = 5;
var PAID_GST_RATE = 0.18;
var BIZ_NAME = "SHOPPERSKART";
var BIZ_BRAND = "cursive";
var BIZ_PROPRIETOR = "Ankit Sethi";
var BIZ_GSTIN = "07CJPPS7017B2Z1";
var BIZ_STATE_CODE = "07";
var BIZ_ADDRESS = "C-165, Shop No. 4, Ground Floor, Hari Nagar, New Delhi, Delhi - 110064";
var BIZ_EMAIL = "Contact@cursive.world";
var BIZ_PHONE = "+91 96257 37475";
var PAID_PENDING_TAB   = "Pending Payments";
var PAID_COMPLETED_TAB = "Completed Payments";
var INVOICES_TAB       = "Invoices";

function getRazorpayCreds_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('RAZORPAY_KEY_ID');
  var secret = props.getProperty('RAZORPAY_KEY_SECRET');
  if (!id || !secret) throw new Error('Razorpay keys not configured in Script Properties.');
  return { id: id, secret: secret };
}

function paidUploadInitiate_(p) {
  var email    = String(p.email    || "").trim().toLowerCase();
  var password = String(p.password || "");
  if (!email || !password) return { ok: false, message: "Missing credentials." };
  if (!validateLogin_(email, password)) return { ok: false, message: "Invalid login. Please sign in again." };
  var rows;
  try { rows = (typeof p.rows === "string") ? JSON.parse(p.rows) : p.rows; }
  catch (e) { return { ok: false, message: "Invalid rows." }; }
  if (!rows || !rows.length) return { ok: false, message: "No rows to upload." };

  var subtotal = rows.length * PAID_PER_ROW_RUPEES;
  var gst = Math.round(subtotal * PAID_GST_RATE * 100) / 100;
  var total = subtotal + gst;
  var amountPaise = Math.round(total * 100);
  var receipt = 'r_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

  var creds = getRazorpayCreds_();
  var auth = Utilities.base64Encode(creds.id + ':' + creds.secret);
  var resp = UrlFetchApp.fetch('https://api.razorpay.com/v1/orders', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Basic ' + auth },
    payload: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: receipt, payment_capture: 1 }),
    muteHttpExceptions: true
  });
  var rzpData = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() !== 200) {
    return { ok: false, message: "Razorpay order failed: " + (rzpData.error && rzpData.error.description || resp.getContentText()) };
  }

  var pendingId = Utilities.getUuid();
  var ts = fmtNow_();
  var customerMobile = getCustomerMobileFromMaster_(email) || "";
  var analyticsPayload = JSON.stringify({
    rows: rows,
    gstName: String(p.gstName || ""),
    gstNumber: String(p.gstNumber || ""),
    gstAddress: String(p.gstAddress || ""),
    subtotal: subtotal,
    gst: gst
  });
  pendingPaymentsSheet_().appendRow([
    ts.date, ts.time, "analytics", pendingId, rzpData.id,
    email, customerMobile, "Analytics upload (" + rows.length + " rows)",
    total, rows.length, "pending", analyticsPayload
  ]);

  return {
    ok: true,
    pendingId: pendingId,
    razorpay: { keyId: creds.id, orderId: rzpData.id, amountPaise: amountPaise, currency: 'INR' },
    customerMobile: getCustomerMobileFromMaster_(email) || "",
    summary: { rows: rows.length, perRow: PAID_PER_ROW_RUPEES, subtotal: subtotal, gst: gst, total: total }
  };
}

/* OLD direct-upload endpoint - kept for fallback so cached browsers
 * that still call paid_upload_complete keep working. New deployments
 * use wallet_credit + wallet_upload. */
function paidUploadComplete_(p) {
  var email     = String(p.email    || "").trim().toLowerCase();
  var password  = String(p.password || "");
  var pendingId = String(p.pendingId || "");
  var paymentId = String(p.razorpay_payment_id || "");
  var orderId   = String(p.razorpay_order_id || "");
  var signature = String(p.razorpay_signature || "");
  if (!validateLogin_(email, password)) return { ok: false, message: "Invalid login." };
  if (!pendingId || !paymentId || !orderId || !signature) return { ok: false, message: "Missing payment data." };

  var creds = getRazorpayCreds_();
  var hmac = Utilities.computeHmacSha256Signature(orderId + '|' + paymentId, creds.secret);
  var expected = hmac.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  if (expected !== signature) return { ok: false, message: "Payment signature verification failed." };

  var sh = pendingPaymentsSheet_();
  var data = sh.getDataRange().getValues();
  var rowIdx = -1, pendingData = null;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][3]) === pendingId) { rowIdx = r; pendingData = data[r]; break; }
  }
  if (!pendingData) return { ok: false, message: "Pending payment not found." };

  // Parse payload (unified schema: L = payload JSON)
  var payload = {};
  try { payload = JSON.parse(pendingData[11] || "{}"); }
  catch (e) { return { ok: false, message: "Pending data corrupted." }; }
  var rows = payload.rows || [];

  var customerState = getCustomerStateFromMaster_(email) || "";
  var isIntra = (stateNameToCode_(customerState) === BIZ_STATE_CODE);
  var total = Number(pendingData[8]);
  var subtotal = Number(payload.subtotal || (total / 1.18));
  var gst = Number(payload.gst || (total - subtotal));
  var cgst = isIntra ? Math.round((gst / 2) * 100) / 100 : 0;
  var sgst = isIntra ? Math.round((gst / 2) * 100) / 100 : 0;
  var igst = isIntra ? 0 : gst;
  var customerMobile = getCustomerMobileFromMaster_(email) || "";

  var landing = _landingSheet_();
  var firstEmpty = landing.getLastRow() + 1;
  var batch = rows.map(function (rw) {
    var line = new Array(16); for (var k = 0; k < 16; k++) line[k] = "";
    line[0]=rw.country||""; line[1]=rw.state||""; line[3]=email; line[5]=rw.platform||""; line[6]=rw.productId||""; line[7]=password; line[15]=customerMobile;
    return line;
  });
  landing.getRange(firstEmpty, 1, batch.length, 16).setValues(batch);

  try {
    var master = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var masterBatch = rows.map(function (rw) {
      var line = new Array(NUM_COLS); for (var k = 0; k < NUM_COLS; k++) line[k] = "";
      line[0]=rw.country||""; line[1]=rw.state||""; line[3]=email; line[5]=rw.platform||""; line[6]=rw.productId||""; line[7]=password;
      return line;
    });
    master.getRange(master.getLastRow() + 1, 1, masterBatch.length, NUM_COLS).setValues(masterBatch);
    _invalidateMasterValues_();
  } catch (err) {}

  var invoiceNumber = generateInvoiceNumber_();
  var invoice = {
    invoiceNumber: invoiceNumber,
    date: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM yyyy'),
    customerEmail: email, customerMobile: customerMobile, customerState: customerState,
    customerGstName: String(payload.gstName || ""),
    customerGstNumber: String(payload.gstNumber || ""),
    customerGstAddress: String(payload.gstAddress || ""),
    qty: rows.length, rate: PAID_PER_ROW_RUPEES,
    subtotal: subtotal, cgst: cgst, sgst: sgst, igst: igst, totalTax: gst, total: total,
    razorpayPaymentId: paymentId, razorpayOrderId: orderId
  };

  invoicesSheet_().appendRow([
    new Date(), invoiceNumber, email, customerMobile,
    invoice.customerGstName, invoice.customerGstNumber, invoice.customerGstAddress,
    rows.length, subtotal, cgst, sgst, igst, total, paymentId, orderId
  ]);
  completedPaymentsSheet_().appendRow([new Date(), email, paymentId, orderId, total, rows.length, invoiceNumber]);
  sh.getRange(rowIdx + 1, 11).setValue("complete");

  try {
    var pdfBlob = generateInvoicePdf_(invoice);
    MailApp.sendEmail({
      to: email,
      subject: 'Invoice ' + invoiceNumber + ' from ' + BIZ_NAME,
      htmlBody: invoiceEmailHtml_(invoice),
      attachments: [pdfBlob],
      name: BIZ_NAME + ' (' + BIZ_BRAND + ')'
    });
  } catch (mailErr) { Logger.log('Invoice email failed: ' + mailErr.message); }

  return { ok: true, invoiceNumber: invoiceNumber };
}

function validateLogin_(email, password) {
  if (!email || !password) return false;
  var values = _masterValues_();
  var idIdx = analyticsLetterToIndex_(ANALYTICS_ID_COL_LETTER);
  var pwIdx = analyticsLetterToIndex_(ANALYTICS_PW_COL_LETTER);
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idIdx] || "").trim().toLowerCase() !== email) continue;
    if (String(values[r][pwIdx]) === password) return true;
  }
  return false;
}

function getCustomerStateFromMaster_(email) {
  var values = _masterValues_();
  var idIdx = analyticsLetterToIndex_(ANALYTICS_ID_COL_LETTER);
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idIdx] || "").trim().toLowerCase() !== email) continue;
    return String(values[r][1] || "").trim();
  }
  return "";
}

function getCustomerMobileFromMaster_(email) {
  // First try All Leads tab (current source of truth)
  try {
    var ss = _adminSS_();
    var allSh = ss.getSheetByName(ALL_LEADS_TAB);
    if (allSh) {
      var d = allSh.getDataRange().getValues();
      // All Leads columns: A=Date, B=Time, C=Page, D=OTP, E=Name, F=Mobile, G=Email
      for (var r = 1; r < d.length; r++) {
        if (String(d[r][6] || "").trim().toLowerCase() === email && d[r][5]) return String(d[r][5]);
      }
    }
    // Fallback to legacy Trial Signups (only if it exists - do NOT create it)
    var legacySh = ss.getSheetByName(TRIAL_SIGNUP_TAB);
    if (legacySh) {
      var ld = legacySh.getDataRange().getValues();
      for (var i = 1; i < ld.length; i++) {
        if (String(ld[i][1] || "").trim().toLowerCase() === email) return String(ld[i][2] || "");
      }
    }
  } catch (e) {}
  return "";
}

function getCustomerPasswordFromMaster_(email) {
  var values = _masterValues_();
  var idIdx = analyticsLetterToIndex_(ANALYTICS_ID_COL_LETTER);
  var pwIdx = analyticsLetterToIndex_(ANALYTICS_PW_COL_LETTER);
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idIdx] || "").trim().toLowerCase() !== email) continue;
    return String(values[r][pwIdx] || "");
  }
  return "";
}

var STATE_CODES = {
  "andhra pradesh":"37","arunachal pradesh":"12","assam":"18","bihar":"10","chhattisgarh":"22",
  "goa":"30","gujarat":"24","haryana":"06","himachal pradesh":"02","jharkhand":"20",
  "karnataka":"29","kerala":"32","madhya pradesh":"23","maharashtra":"27","manipur":"14",
  "meghalaya":"17","mizoram":"15","nagaland":"13","odisha":"21","punjab":"03",
  "rajasthan":"08","sikkim":"11","tamil nadu":"33","telangana":"36","tripura":"16",
  "uttar pradesh":"09","uttarakhand":"05","west bengal":"19","delhi":"07",
  "jammu and kashmir":"01","ladakh":"38","chandigarh":"04","puducherry":"34",
  "andaman and nicobar islands":"35","lakshadweep":"31",
  "dadra and nagar haveli and daman and diu":"26"
};
function stateNameToCode_(name) { return STATE_CODES[String(name || "").trim().toLowerCase()] || ""; }

function getFinancialYearCode_() {
  var d = new Date();
  var year = d.getFullYear() % 100;
  if (d.getMonth() < 3) year = year - 1;
  return String(year) + String(year + 1);
}

function generateInvoiceNumber_() {
  var fy = getFinancialYearCode_();
  var sh = invoicesSheet_();
  var data = sh.getDataRange().getValues();
  var maxSeq = 0;
  var prefix = "SK/" + fy + "/";
  for (var r = 1; r < data.length; r++) {
    var num = String(data[r][1] || "");
    if (num.indexOf(prefix) === 0) {
      var seq = parseInt(num.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return prefix + ('000' + (maxSeq + 1)).slice(-4);
}

function generateInvoicePdf_(inv) {
  var doc = DocumentApp.create('Invoice ' + inv.invoiceNumber.replace(/\//g, '-'));
  var body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);
  body.appendParagraph(BIZ_NAME).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(BIZ_BRAND + ' — seller analytics').setItalic(true);
  body.appendParagraph(BIZ_ADDRESS);
  body.appendParagraph('GSTIN: ' + BIZ_GSTIN + '  ·  Proprietor: ' + BIZ_PROPRIETOR);
  body.appendParagraph('Email: ' + BIZ_EMAIL + '  ·  Phone: ' + BIZ_PHONE);
  body.appendHorizontalRule();
  body.appendParagraph('TAX INVOICE').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Invoice No: ' + inv.invoiceNumber);
  body.appendParagraph('Date: ' + inv.date);
  body.appendParagraph('');
  body.appendParagraph('Bill To:').setBold(true);
  body.appendParagraph(inv.customerGstName || inv.customerEmail);
  if (inv.customerGstNumber) body.appendParagraph('GSTIN: ' + inv.customerGstNumber);
  if (inv.customerGstAddress) body.appendParagraph(inv.customerGstAddress);
  body.appendParagraph('Email: ' + inv.customerEmail);
  if (inv.customerMobile) body.appendParagraph('Mobile: ' + inv.customerMobile);
  if (inv.customerState) body.appendParagraph('State: ' + inv.customerState);
  body.appendParagraph('');
  body.appendTable([
    ['Description', 'Qty', 'Rate (₹)', 'Amount (₹)'],
    [BIZ_BRAND + ' — analytics tracking', String(inv.qty), inv.rate.toFixed(2), inv.subtotal.toFixed(2)]
  ]);
  body.appendParagraph('');
  body.appendParagraph('Subtotal: ₹' + inv.subtotal.toFixed(2));
  if (inv.cgst > 0) {
    body.appendParagraph('CGST (9%): ₹' + inv.cgst.toFixed(2));
    body.appendParagraph('SGST (9%): ₹' + inv.sgst.toFixed(2));
  } else {
    body.appendParagraph('IGST (18%): ₹' + inv.igst.toFixed(2));
  }
  body.appendParagraph('Total: ₹' + inv.total.toFixed(2)).setBold(true);
  body.appendParagraph('');
  body.appendParagraph('Razorpay Payment ID: ' + inv.razorpayPaymentId);
  body.appendParagraph('');
  body.appendParagraph('Thank you for your purchase.');
  doc.saveAndClose();
  var docFile = DriveApp.getFileById(doc.getId());
  var pdfBlob = docFile.getAs('application/pdf').setName('Invoice-' + inv.invoiceNumber.replace(/\//g, '-') + '.pdf');
  docFile.setTrashed(true);
  return pdfBlob;
}

function invoiceEmailHtml_(inv) {
  return '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f6f8fa">'
    + '<div style="background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:28px">'
    + '<div style="font-size:18px;font-weight:700;color:#1f6feb">' + BIZ_NAME + '</div>'
    + '<div style="font-size:13px;color:#57606a;margin-bottom:16px">' + BIZ_BRAND + ' — seller analytics</div>'
    + '<h2>Invoice ' + inv.invoiceNumber + '</h2>'
    + '<p style="color:#57606a">Thank you for your purchase. Your products are now being tracked on the dashboard.</p>'
    + '<table style="width:100%;font-size:14px;margin:16px 0">'
    + '<tr><td>Products:</td><td style="text-align:right">' + inv.qty + '</td></tr>'
    + '<tr><td>Subtotal:</td><td style="text-align:right">₹' + inv.subtotal.toFixed(2) + '</td></tr>'
    + (inv.cgst > 0
        ? '<tr><td>CGST (9%):</td><td style="text-align:right">₹' + inv.cgst.toFixed(2) + '</td></tr><tr><td>SGST (9%):</td><td style="text-align:right">₹' + inv.sgst.toFixed(2) + '</td></tr>'
        : '<tr><td>IGST (18%):</td><td style="text-align:right">₹' + inv.igst.toFixed(2) + '</td></tr>')
    + '<tr style="font-weight:700;border-top:1px solid #d0d7de"><td>Total:</td><td style="text-align:right">₹' + inv.total.toFixed(2) + '</td></tr>'
    + '</table>'
    + '<p style="color:#57606a;font-size:12px">Razorpay Payment ID: ' + inv.razorpayPaymentId + '</p>'
    + '<p style="color:#57606a;font-size:12px">Full invoice attached as PDF.</p>'
    + '<p style="color:#57606a;font-size:12px;margin-top:24px">Need help? ' + BIZ_EMAIL + ' or WhatsApp ' + BIZ_PHONE + '.</p>'
    + '</div></div>';
}

/* UNIFIED Pending Payments sheet - used by both service flow and analytics
 * paid_upload flow. Schema:
 * A=Date, B=Time, C=Type, D=Reference, E=Razorpay Order ID, F=Email,
 * G=Mobile, H=Description, I=Amount, J=Qty, K=Status, L=Payload (JSON)
 */
function pendingPaymentsSheet_() {
  var ss = _adminSS_();
  var sh = ss.getSheetByName(PAID_PENDING_TAB);
  if (!sh) {
    sh = ss.insertSheet(PAID_PENDING_TAB);
    sh.appendRow(["Date", "Time", "Type", "Reference", "Razorpay Order ID",
                  "Email", "Mobile", "Description", "Amount", "Qty",
                  "Status", "Payload"]);
    sh.setFrozenRows(1); sh.getRange("A1:L1").setFontWeight("bold");
    sh.setColumnWidth(1, 110);  sh.setColumnWidth(2, 90);
    sh.setColumnWidth(3, 90);   sh.setColumnWidth(4, 220);
    sh.setColumnWidth(5, 200);  sh.setColumnWidth(6, 220);
    sh.setColumnWidth(7, 130);  sh.setColumnWidth(8, 220);
    sh.setColumnWidth(9, 90);   sh.setColumnWidth(10, 70);
    sh.setColumnWidth(11, 130); sh.setColumnWidth(12, 320);
  }
  return sh;
}

/* Service Pending Payments now points to the SAME unified sheet */
function servicePayPendingSheet_() { return pendingPaymentsSheet_(); }
function completedPaymentsSheet_() {
  var ss = _adminSS_();
  var sh = ss.getSheetByName(PAID_COMPLETED_TAB);
  if (!sh) {
    sh = ss.insertSheet(PAID_COMPLETED_TAB);
    sh.appendRow(["Date", "Email", "Razorpay Payment ID", "Razorpay Order ID", "Total ₹", "Rows", "Invoice #"]);
    sh.setFrozenRows(1); sh.getRange("A1:G1").setFontWeight("bold");
  }
  return sh;
}
function invoicesSheet_() {
  var ss = _adminSS_();
  var sh = ss.getSheetByName(INVOICES_TAB);
  if (!sh) {
    sh = ss.insertSheet(INVOICES_TAB);
    sh.appendRow(["Date", "Invoice #", "Customer Email", "Customer Mobile", "Bill-To Name", "Bill-To GSTIN", "Bill-To Address", "Qty", "Subtotal", "CGST", "SGST", "IGST", "Total", "Razorpay Payment ID", "Razorpay Order ID"]);
    sh.setFrozenRows(1); sh.getRange("A1:O1").setFontWeight("bold");
  }
  return sh;
}


/* ============================================================
 * SECTION 5 - WALLET (v9)
 *
 * After a successful Razorpay payment the front-end calls
 * wallet_credit. The full paid amount is credited to the
 * customer's wallet and a GST invoice is emailed.
 *
 * When the customer clicks Continue, the front-end calls
 * wallet_upload. We try to append rows FIRST and only debit the
 * wallet if the append succeeds. If the append fails the wallet
 * stays intact and the customer can retry without paying again.
 * ============================================================ */

var WALLET_SHEET_NAME  = "Wallets";
var WALLET_LEDGER_NAME = "Wallet Ledger";

function walletsSheet_() {
  var ss = _adminSS_();
  var sh = ss.getSheetByName(WALLET_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(WALLET_SHEET_NAME);
    sh.appendRow(["Date", "Time", "Email", "Mobile", "Balance", "Last Top-up"]);
    sh.setFrozenRows(1); sh.getRange("A1:F1").setFontWeight("bold");
    sh.setColumnWidth(1, 110);  // Date (last updated)
    sh.setColumnWidth(2, 90);   // Time (last updated)
    sh.setColumnWidth(3, 240);  // Email
    sh.setColumnWidth(4, 140);  // Mobile
    sh.setColumnWidth(5, 100);  // Balance
    sh.setColumnWidth(6, 170);  // Last Top-up
  }
  return sh;
}

function walletLedgerSheet_() {
  var ss = _adminSS_();
  var sh = ss.getSheetByName(WALLET_LEDGER_NAME);
  if (!sh) {
    sh = ss.insertSheet(WALLET_LEDGER_NAME);
    sh.appendRow(["Date", "Time", "Email", "Type", "Amount", "Balance After", "Reference", "Description"]);
    sh.setFrozenRows(1); sh.getRange("A1:H1").setFontWeight("bold");
    sh.setColumnWidth(1, 110);  // Date
    sh.setColumnWidth(2, 90);   // Time
    sh.setColumnWidth(3, 240);  // Email
    sh.setColumnWidth(4, 80);   // Type
    sh.setColumnWidth(5, 100);  // Amount
    sh.setColumnWidth(6, 120);  // Balance After
    sh.setColumnWidth(7, 220);  // Reference
    sh.setColumnWidth(8, 300);  // Description
  }
  return sh;
}

function walletGetBalance_(email) {
  email = String(email || "").toLowerCase().trim();
  if (!email) return 0;
  var sh = walletsSheet_();
  var lr = sh.getLastRow();
  if (lr < 2) return 0;
  // New layout: [0]=Date, [1]=Time, [2]=Email, [3]=Mobile, [4]=Balance, [5]=Last Top-up
  var data = sh.getRange(2, 1, lr - 1, 5).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][2] || "").toLowerCase().trim() === email) return Number(data[i][4] || 0);
  }
  return 0;
}

function walletSetBalance_(email, mobile, newBalance, isCredit) {
  email = String(email || "").toLowerCase().trim();
  if (!email) return;
  var sh = walletsSheet_();
  var lr = sh.getLastRow();
  var now = new Date();
  var ts = fmtNow_();
  // New layout: A=Date, B=Time, C=Email, D=Mobile, E=Balance, F=Last Top-up
  if (lr >= 2) {
    var data = sh.getRange(2, 1, lr - 1, 6).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][2] || "").toLowerCase().trim() === email) {
        sh.getRange(i + 2, 1).setValue(ts.date);    // Date (last updated)
        sh.getRange(i + 2, 2).setValue(ts.time);    // Time (last updated)
        sh.getRange(i + 2, 5).setValue(newBalance); // Balance
        if (isCredit) sh.getRange(i + 2, 6).setValue(now); // Last Top-up
        if (mobile && !data[i][3]) sh.getRange(i + 2, 4).setValue(mobile); // Mobile
        return;
      }
    }
  }
  sh.appendRow([ts.date, ts.time, email, mobile || "", newBalance, isCredit ? now : ""]);
}

function walletWriteLedger_(email, type, amount, balanceAfter, reference, description) {
  var ts = fmtNow_();
  walletLedgerSheet_().appendRow([ts.date, ts.time, email, type, amount, balanceAfter, reference || "", description || ""]);
}

/* -------- wallet_balance -------- */
function walletBalance_(p) {
  var email    = String(p.email    || "").trim().toLowerCase();
  var password = String(p.password || "");
  if (!validateLogin_(email, password)) {
    return { ok: false, balance: 0, message: "Invalid login." };
  }
  return { ok: true, balance: walletGetBalance_(email) };
}

/* -------- wallet_credit -------- */
function walletCredit_(p) {
  var email     = String(p.email    || "").trim().toLowerCase();
  var password  = String(p.password || "");
  var pendingId = String(p.pendingId || "");
  var paymentId = String(p.razorpay_payment_id || "");
  var orderId   = String(p.razorpay_order_id || "");
  var signature = String(p.razorpay_signature || "");

  if (!validateLogin_(email, password)) return { ok: false, message: "Invalid login." };
  if (!pendingId || !paymentId || !orderId || !signature) {
    return { ok: false, message: "Missing payment data." };
  }

  // Verify Razorpay signature
  var creds = getRazorpayCreds_();
  var hmac = Utilities.computeHmacSha256Signature(orderId + '|' + paymentId, creds.secret);
  var expected = hmac.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  if (expected !== signature) {
    logAllLead_("analytics", "", "", email, "",
                "Wallet recharge signature mismatch. Razorpay payment " + paymentId,
                "Analytics top-up", "", "wallet_recharge_failed", "wallet_credit", "/analytics/");
    return { ok: false, message: "Payment signature verification failed." };
  }

  // Find pending record (unified schema: D=Reference, I=Amount, K=Status, L=Payload)
  var sh = pendingPaymentsSheet_();
  var data = sh.getDataRange().getValues();
  var rowIdx = -1, pendingData = null;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][3]) === pendingId) { rowIdx = r; pendingData = data[r]; break; }
  }
  if (!pendingData) return { ok: false, message: "Pending payment not found." };

  // Idempotency: if already credited, just return current balance.
  if (String(pendingData[10] || "") === "wallet_credited") {
    return { ok: true, balance: walletGetBalance_(email), amountPaid: Number(pendingData[8] || 0), invoiceNumber: "(already credited)" };
  }

  var total = Number(pendingData[8]);
  if (!total || total <= 0) return { ok: false, message: "Invalid pending amount." };

  // Parse analytics payload (rows + GST details)
  var payload = {};
  try { payload = JSON.parse(pendingData[11] || "{}"); } catch (e) {}
  var subtotal = Number(payload.subtotal || (total / 1.18));
  var gst = Number(payload.gst || (total - subtotal));
  var rows = payload.rows || [];

  // ---- Credit wallet ----
  var oldBalance = walletGetBalance_(email);
  var newBalance = Math.round((oldBalance + total) * 100) / 100;
  var customerMobile = getCustomerMobileFromMaster_(email) || "";
  walletSetBalance_(email, customerMobile, newBalance, true);
  walletWriteLedger_(email, "credit", total, newBalance, paymentId, "Razorpay payment (order " + orderId + ")");

  // ---- Generate + email invoice (best-effort, does not roll back credit) ----
  var customerState = getCustomerStateFromMaster_(email) || "";
  var isIntra = (stateNameToCode_(customerState) === BIZ_STATE_CODE);
  var cgst = isIntra ? Math.round((gst / 2) * 100) / 100 : 0;
  var sgst = isIntra ? Math.round((gst / 2) * 100) / 100 : 0;
  var igst = isIntra ? 0 : gst;

  var invoiceNumber = "";
  try {
    invoiceNumber = generateInvoiceNumber_();
    var invoice = {
      invoiceNumber: invoiceNumber,
      date: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM yyyy'),
      customerEmail: email,
      customerMobile: customerMobile,
      customerState: customerState,
      customerGstName: String(payload.gstName || ""),
      customerGstNumber: String(payload.gstNumber || ""),
      customerGstAddress: String(payload.gstAddress || ""),
      qty: rows.length || Math.round(subtotal / PAID_PER_ROW_RUPEES),
      rate: PAID_PER_ROW_RUPEES,
      subtotal: subtotal, cgst: cgst, sgst: sgst, igst: igst, totalTax: gst, total: total,
      razorpayPaymentId: paymentId, razorpayOrderId: orderId
    };

    invoicesSheet_().appendRow([
      new Date(), invoiceNumber, email, customerMobile,
      invoice.customerGstName, invoice.customerGstNumber, invoice.customerGstAddress,
      invoice.qty, subtotal, cgst, sgst, igst, total, paymentId, orderId
    ]);
    completedPaymentsSheet_().appendRow([new Date(), email, paymentId, orderId, total, invoice.qty, invoiceNumber]);

    var pdfBlob = generateInvoicePdf_(invoice);
    MailApp.sendEmail({
      to: email,
      subject: 'Invoice ' + invoiceNumber + ' - Wallet credited ₹' + total.toFixed(2),
      htmlBody: invoiceEmailHtml_(invoice),
      attachments: [pdfBlob],
      name: BIZ_NAME + ' (' + BIZ_BRAND + ')'
    });
  } catch (mailErr) {
    Logger.log('Invoice generation/email failed: ' + mailErr.message);
  }

  // Mark pending as credited (column K = Status)
  sh.getRange(rowIdx + 1, 11).setValue("wallet_credited");

  // Log to All Leads as wallet_recharged event
  logAllLead_("analytics", "", customerMobile, email, "",
              "Wallet recharged Rs." + total.toFixed(2) + ". New balance Rs." + newBalance.toFixed(2) + ". Razorpay: " + paymentId,
              "Analytics top-up", total, "wallet_recharged", "wallet_credit", "/analytics/");

  return {
    ok: true,
    balance: newBalance,
    amountPaid: total,
    invoiceNumber: invoiceNumber || "(emailed)"
  };
}

/* -------- wallet_upload -------- */
function walletUpload_(p) {
  var email    = String(p.email    || "").trim().toLowerCase();
  var password = String(p.password || "");
  if (!validateLogin_(email, password)) return { ok: false, message: "Invalid login." };

  var rows;
  try { rows = (typeof p.rows === "string") ? JSON.parse(p.rows) : p.rows; }
  catch (e) { return { ok: false, message: "Invalid rows data." }; }
  if (!rows || !rows.length) return { ok: false, message: "No rows to upload." };

  // Server-side cost calc
  var subtotal = rows.length * PAID_PER_ROW_RUPEES;
  var gst  = Math.round(subtotal * PAID_GST_RATE * 100) / 100;
  var cost = Math.round((subtotal + gst) * 100) / 100;

  // Balance check
  var balance = walletGetBalance_(email);
  if (balance + 0.01 < cost) {
    return {
      ok: false,
      message: "Insufficient wallet balance. You have ₹" + balance.toFixed(2) +
               " but need ₹" + cost.toFixed(2) + ". Please top up first."
    };
  }

  // ---- TRY APPEND FIRST. Wallet stays untouched if this throws. ----
  var customerMobile = getCustomerMobileFromMaster_(email) || "";
  var rowsAdded = 0;
  try {
    var landing = _landingSheet_();
    var firstEmpty = landing.getLastRow() + 1;
    var landingBatch = rows.map(function (rw) {
      var line = new Array(16); for (var k = 0; k < 16; k++) line[k] = "";
      line[0]=String(rw.country||"").trim();
      line[1]=String(rw.state||"").trim();
      line[3]=email;
      line[5]=String(rw.platform||"").trim();
      line[6]=String(rw.productId||"").trim();
      line[7]=password;
      line[15]=customerMobile;
      return line;
    });
    landing.getRange(firstEmpty, 1, landingBatch.length, 16).setValues(landingBatch);

    try {
      var master = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
      var masterBatch = rows.map(function (rw) {
        var line = new Array(NUM_COLS); for (var k = 0; k < NUM_COLS; k++) line[k] = "";
        line[0]=String(rw.country||"").trim();
        line[1]=String(rw.state||"").trim();
        line[3]=email;
        line[5]=String(rw.platform||"").trim();
        line[6]=String(rw.productId||"").trim();
        line[7]=password;
        return line;
      });
      master.getRange(master.getLastRow() + 1, 1, masterBatch.length, NUM_COLS).setValues(masterBatch);
      _invalidateMasterValues_();
    } catch (innerErr) {
      // Master append failed but landing succeeded - log and continue.
      // Customer rows are still tracked via landing -> next consolidation will pick them up.
      Logger.log("Master append failed (landing OK): " + innerErr.message);
    }
    rowsAdded = rows.length;
  } catch (e) {
    return {
      ok: false,
      retry: true,
      message: "Could not add your rows: " + (e.message || e) + ". Your wallet was NOT charged. Click Continue to retry."
    };
  }

  if (!rowsAdded) {
    return {
      ok: false,
      retry: true,
      message: "No rows were added. Your wallet was NOT charged."
    };
  }

  // ---- Append OK. Debit wallet. ----
  var newBalance = Math.round((balance - cost) * 100) / 100;
  walletSetBalance_(email, customerMobile, newBalance, false);
  walletWriteLedger_(email, "debit", cost, newBalance, String(p.paymentId || ""), "Upload " + rowsAdded + " row" + (rowsAdded === 1 ? "" : "s"));

  // Wallet usage is operational (consuming pre-paid credit) - NOT a sales event.
  // We deliberately do NOT log to All Leads here. The Wallet Ledger and
  // Wallets sheet still track the debit for balance reconciliation.

  return {
    ok: true,
    balance: newBalance,
    rowsAdded: rowsAdded,
    amountCharged: cost
  };
}


/* ============================================================
 * SECTION 6 - SERVICE LEADS (v10)
 *
 * Captures lead-form submissions from the new home landing
 * (GST, Trademark, Udyam, IEC, Marketplace, etc.). All leads
 * land in ONE sheet called "All Leads" with column A = service
 * type, so you can filter by service type right in the sheet.
 * ============================================================ */

var ALL_LEADS_TAB = "All Leads";

function allLeadsSheet_() {
  var ss = _adminSS_();
  var sh = ss.getSheetByName(ALL_LEADS_TAB);
  if (!sh) {
    sh = ss.insertSheet(ALL_LEADS_TAB);
    sh.appendRow([
      "Date", "Time", "Page", "Latest OTP", "Name", "Mobile", "Email",
      "Service Name", "Qty", "Promo Code", "Price", "Status", "Repeat Visit"
    ]);
    sh.setFrozenRows(1);
    sh.getRange("A1:M1").setFontWeight("bold");
    sh.setColumnWidth(1, 110);   // A Date
    sh.setColumnWidth(2, 90);    // B Time
    sh.setColumnWidth(3, 130);   // C Page
    sh.setColumnWidth(4, 110);   // D Latest OTP
    sh.setColumnWidth(5, 180);   // E Name
    sh.setColumnWidth(6, 130);   // F Mobile
    sh.setColumnWidth(7, 220);   // G Email
    sh.setColumnWidth(8, 220);   // H Service Name
    sh.setColumnWidth(9, 70);    // I Qty
    sh.setColumnWidth(10, 120);  // J Promo Code
    sh.setColumnWidth(11, 110);  // K Price
    sh.setColumnWidth(12, 160);  // L Status
    sh.setColumnWidth(13, 130);  // M Repeat Visit
  }
  return sh;
}

/**
 * UPSERT into All Leads. One row per (email, type) pair.
 * On every event, this finds the existing lead row and UPDATES it
 * (appends noteAddition to the Notes column, refreshes Status + Source,
 * fills in any blank fields). If no row exists, a new one is created.
 * Date/Time stay at first-contact values - they don't change on update.
 */
/**
 * Upsert into All Leads. ONE row per (email, serviceName) pair.
 * Schema: A=Date, B=Time, C=Service Name, D=Page, E=Name, F=Mobile,
 *         G=Email, H=Price, I=Latest OTP, J=Status
 *
 * Args: type/business/noteAddition/source/origin params remain for
 * backward compatibility with existing callers but only the relevant
 * fields are stored. `origin` populates the Page column. `latestOtp`
 * is optional - only OTP-related callers pass it.
 */
function logAllLead_(type, name, mobile, email, business, noteAddition, serviceName, price, status, source, origin, latestOtp, qty, promoCode) {
  try {
    email = String(email || "").toLowerCase().trim();
    mobile = String(mobile || "").replace(/\D/g, "");
    if (!email && !mobile) return;
    var svcName = String(serviceName || "").trim();
    var svcNameLc = svcName.toLowerCase();

    var sh = allLeadsSheet_();
    var data = sh.getDataRange().getValues();

    // Schema indices: [0]=Date, [1]=Time, [2]=Page, [3]=Latest OTP,
    // [4]=Name, [5]=Mobile, [6]=Email, [7]=Service Name, [8]=Qty,
    // [9]=Promo Code, [10]=Price, [11]=Status, [12]=Repeat Visit

    // Statuses that represent a COMPLETED transaction - never overwrite.
    // If a row with one of these exists, we keep it untouched and any new
    // activity from this customer creates a fresh "Repeat Visit" row.
    // Note: payment_initiated is NOT locked - customer might cancel and retry.
    var LOCKED_STATUSES = {
      "payment_paid": 1,
      "wallet_recharged": 1,
      "trial_uploaded": 1
    };

    // Find matching rows separated by locked status. Non-locked rows are
    // the "active session" - update those. Locked rows (paid etc.) are
    // never touched.
    var nonLockedRows = [];
    var hasLockedRow = false;
    for (var r = 1; r < data.length; r++) {
      var rowEmail  = String(data[r][6]).toLowerCase().trim();
      var rowMobile = String(data[r][5]).replace(/\D/g, "");
      var rowSvc    = String(data[r][7]).toLowerCase().trim();
      var rowStatus = String(data[r][11]).toLowerCase().trim();  // Status now at index 11 after Promo Code added
      var svcMatch  = !svcName || !rowSvc || rowSvc === svcNameLc;
      var contactMatch = (email && rowEmail === email) ||
                         (mobile && rowMobile === mobile);
      if (svcMatch && contactMatch) {
        if (LOCKED_STATUSES[rowStatus]) hasLockedRow = true;
        else nonLockedRows.push(r + 1);
      }
    }

    var foundRow = -1;

    if (nonLockedRows.length > 0) {
      // Active session exists - dedup and update most recent row normally.
      // Status flows naturally through otp_initiated -> otp_verified -> paid.
      foundRow = nonLockedRows[nonLockedRows.length - 1];
      for (var i = nonLockedRows.length - 2; i >= 0; i--) {
        sh.deleteRow(nonLockedRows[i]);
        if (nonLockedRows[i] < foundRow) foundRow--;
      }
      data = sh.getDataRange().getValues();
    }

    // "Repeat Visit" flag for column K - ONLY shown while the customer is
    // still in the pre-transaction stages of their return journey.
    // Once they hit a locked status (paid, recharged, etc.) the flag clears
    // because the row is now itself a paid record.
    var statusLc = String(status || "").toLowerCase();
    var statusIsLocked = !!LOCKED_STATUSES[statusLc];
    var repeatFlag = (hasLockedRow && !statusIsLocked) ? "Repeat Visit" : "";

    var ts = fmtNow_();
    var rawOrigin = String(origin || "").trim();
    // Friendly page label: "/" = Main Page, anything else = Product Page
    var pageVal = "";
    if (rawOrigin) {
      pageVal = (rawOrigin === "/" || rawOrigin === "/index.html") ? "Main Page" : "Product Page";
    }

    if (foundRow > 0) {
      // ---- UPDATE existing row (the one we kept) ----
      var row = data[foundRow - 1];
      var existingEmail = String(row[6] || "").toLowerCase().trim();
      var emailIsPlaceholder = existingEmail.indexOf("nomail+") === 0;

      if (pageVal && !row[2])  sh.getRange(foundRow, 3).setValue(pageVal);
      if (latestOtp)           sh.getRange(foundRow, 4).setValue(latestOtp);
      if (name   && !row[4])   sh.getRange(foundRow, 5).setValue(name);
      if (mobile && !row[5])   sh.getRange(foundRow, 6).setValue(mobile);
      if (email && (emailIsPlaceholder || !existingEmail)) sh.getRange(foundRow, 7).setValue(email);
      if (svcName && !row[7])  sh.getRange(foundRow, 8).setValue(svcName);
      if (qty && !row[8])      sh.getRange(foundRow, 9).setValue(qty);
      if (promoCode)           sh.getRange(foundRow, 10).setValue(promoCode);
      if (price  && !row[10])  sh.getRange(foundRow, 11).setValue(price);
      sh.getRange(foundRow, 12).setValue(status || "");
      sh.getRange(foundRow, 13).setValue(repeatFlag);
    } else {
      // ---- INSERT new row ----
      sh.appendRow([
        ts.date,                       // A Date
        ts.time,                       // B Time
        pageVal,                       // C Page
        String(latestOtp || ""),       // D Latest OTP
        String(name || ""),            // E Name
        String(mobile || ""),          // F Mobile
        email,                         // G Email
        svcName,                       // H Service Name
        qty ? qty : "",                // I Qty
        String(promoCode || ""),       // J Promo Code
        String(price || ""),           // K Price
        String(status || "new"),       // L Status
        repeatFlag                     // M Repeat Visit
      ]);
    }
  } catch (e) {
    Logger.log("logAllLead_ error: " + e);
  }
}

function serviceLead_(p) {
  var type         = String(p.serviceType  || "other").toLowerCase().trim();
  var serviceName  = String(p.serviceName  || "Unknown service");
  var servicePrice = String(p.servicePrice || "");
  var name         = String(p.name         || "").trim();
  var mobile       = String(p.mobile       || "").replace(/\D/g, "");
  var email        = String(p.email        || "").toLowerCase().trim();
  var business     = String(p.business     || "").trim();
  var notes        = String(p.note         || "").trim();

  if (!name)                                              return { ok: false, message: "Name is required." };
  if (!mobile || mobile.length < 7)                       return { ok: false, message: "Valid mobile is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))          return { ok: false, message: "Valid email is required." };

  logAllLead_(type, name, mobile, email, business, notes, serviceName, servicePrice, "new", "service_lead", "", "", 1);

  try {
    var subject = "[cursive] New lead: " + serviceName + " from " + name;
    var html =
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f6f8fa">' +
      '<div style="background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:28px">' +
      '<div style="font-size:18px;font-weight:700;color:#1f6feb;margin-bottom:12px">cursive &mdash; New lead</div>' +
      '<table style="width:100%;font-size:14px;border-collapse:collapse">' +
      '<tr><td style="padding:6px 0;color:#57606a;width:130px">Service</td><td><strong>' + escHtml_(serviceName) + '</strong>' + (servicePrice ? ' &middot; ' + escHtml_(servicePrice) : '') + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Type tag</td><td>' + escHtml_(type) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Name</td><td>' + escHtml_(name) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Mobile</td><td><a href="tel:' + escHtml_(mobile) + '">' + escHtml_(mobile) + '</a> &middot; <a href="https://wa.me/91' + escHtml_(mobile) + '">WhatsApp</a></td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Email</td><td><a href="mailto:' + escHtml_(email) + '">' + escHtml_(email) + '</a></td></tr>' +
      (business ? '<tr><td style="padding:6px 0;color:#57606a">Business</td><td>' + escHtml_(business) + '</td></tr>' : '') +
      (notes    ? '<tr><td style="padding:6px 0;color:#57606a;vertical-align:top">Notes</td><td>' + escHtml_(notes) + '</td></tr>' : '') +
      '</table>' +
      '<p style="color:#57606a;font-size:12px;margin-top:20px">Call back within 2 working hours. Mark status in the "All Leads" sheet once contacted.</p>' +
      '</div></div>';
    MailApp.sendEmail({
      to: "Contact@cursive.world",
      replyTo: email,
      subject: subject,
      htmlBody: html,
      name: "cursive leads"
    });
  } catch (mailErr) {
    Logger.log("Lead email failed: " + mailErr.message);
  }

  return { ok: true, message: "Lead recorded." };
}

function escHtml_(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* Returns {date: "DD/MM/YYYY", time: "HH:MM:SS"} in Asia/Kolkata */
function fmtNow_() {
  var d = new Date();
  return {
    date: Utilities.formatDate(d, 'Asia/Kolkata', 'dd/MM/yyyy'),
    time: Utilities.formatDate(d, 'Asia/Kolkata', 'HH:mm:ss')
  };
}

/* ============================================================
 * ONE-TIME MIGRATION:
 * Run this ONCE from the Apps Script editor (Run -> migrateAddDateTimeColumns)
 * after pasting this updated code. It inserts blank Date + Time
 * columns at A and B of each affected sheet so future writes line
 * up with the headers. Existing rows keep their original data
 * (just shifted right by 2). Safe to run more than once - it
 * detects if migration was already done.
 * ============================================================ */
/* ============================================================
 * ONE-TIME: Rename messy old "All Leads" tab to "All Leads (old)"
 * and create a fresh clean one with the new column order
 * (Date, Time, Service Name, Type, Name, Mobile, Email, Notes,
 *  Price, Source, Status, Origin, Assigned to). Run ONCE from
 * the Apps Script editor after pasting this code.
 * ============================================================ */
function rebuildAllLeadsClean() {
  var ss = _adminSS_();
  var sh = ss.getSheetByName(ALL_LEADS_TAB);
  var msg = [];

  if (sh) {
    // Archive existing messy sheet
    var archiveName = "All Leads (old)";
    var n = 1;
    while (ss.getSheetByName(archiveName)) {
      n++;
      archiveName = "All Leads (old " + n + ")";
    }
    sh.setName(archiveName);
    msg.push("Renamed old tab to '" + archiveName + "' (data preserved).");
  } else {
    msg.push("No existing All Leads tab found.");
  }

  // allLeadsSheet_() will now create a fresh tab with the clean schema
  var newSh = allLeadsSheet_();
  msg.push("Created fresh 'All Leads' tab with 11-column clean schema.");
  msg.push("Columns: A=Date, B=Time, C=Page, D=Latest OTP, E=Name, F=Mobile, G=Email, H=Service Name, I=Price, J=Status, K=Repeat Visit.");

  Logger.log(msg.join("\n"));
  return msg.join("\n");
}

/* ============================================================
 * ONE-TIME CLEANUP: Delete obsolete tabs that are no longer used
 * after refactoring OTP/payment storage into CacheService and the
 * unified Pending Payments tab.
 *
 * Run this ONCE from the Apps Script editor (Run -> cleanupObsoleteTabs).
 * Safe to run multiple times - missing tabs are skipped silently.
 * ============================================================ */
function cleanupObsoleteTabs() {
  var ss = _adminSS_();
  var obsoleteTabs = [
    "Lead OTP Pending",            // moved to CacheService
    "OTP Pending",                 // moved to CacheService
    "Service Payments Pending",    // merged into Pending Payments
    "Trial Signups",               // now tracked in All Leads
    "Trial Signups Master",        // no longer used - duplicate of All Leads
    "Master Leads",                // replaced by All Leads
    "Service Payments"             // merged into Completed Payments
  ];
  var log = [];

  obsoleteTabs.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh) {
      ss.deleteSheet(sh);
      log.push("Deleted: " + name);
    } else {
      log.push("Skipped (not found): " + name);
    }
  });

  // Also delete archived "All Leads (old)" tabs
  var allSheets = ss.getSheets();
  allSheets.forEach(function (sh) {
    var name = sh.getName();
    if (/^All Leads \(old/.test(name)) {
      ss.deleteSheet(sh);
      log.push("Deleted archive: " + name);
    }
  });

  Logger.log(log.join("\n"));
  return log.join("\n");
}

function migrateAddDateTimeColumns() {
  var ss = _adminSS_();
  var targets = ["All Leads", "Lead OTP Pending", "Service Payments Pending", "Wallets", "Wallet Ledger"];
  var log = [];

  targets.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { log.push(name + ": sheet not found, skipped"); return; }
    var firstHeader = String(sh.getRange(1, 1).getValue() || "").toLowerCase().trim();
    if (firstHeader === "date") { log.push(name + ": already has Date in A1, skipped"); return; }

    sh.insertColumns(1, 2);            // insert 2 blank columns at position 1 (A)
    sh.getRange(1, 1).setValue("Date").setFontWeight("bold");
    sh.getRange(1, 2).setValue("Time").setFontWeight("bold");
    sh.setColumnWidth(1, 110);
    sh.setColumnWidth(2, 90);
    log.push(name + ": migrated - Date/Time columns inserted at A,B");
  });

  Logger.log(log.join("\n"));
  return log.join("\n");
}


/* ============================================================
 * SECTION 7 - LEAD OTP (v11)
 *
 * Two-step lead capture for non-analytics services. The customer
 * enters mobile + email on the home page, we email them a 6-digit
 * OTP, and only after they verify does the lead land in the
 * "All Leads" sheet (column A = service type).
 *
 * Sheets:
 *   Lead OTP Pending -> [Email, Mobile, ServiceType, ServiceName,
 *                        ServicePrice, OTP, Sent at, Expires]
 * ============================================================ */

var LEAD_OTP_TAB = "Lead OTP Pending";
var LEAD_OTP_VALID_MIN = 10;

// leadOtpSheet_ removed - OTPs now stored in CacheService (10 min TTL).
// No tab needed; auto-expires.

function leadOtpGenerate_() { return String(Math.floor(100000 + Math.random() * 900000)); }

/* -------- lead_draft (abandoned form capture) --------
 * Fired by the frontend the moment a customer types BOTH a valid mobile
 * and a valid email in the lead modal but hasn't clicked Continue yet.
 * Creates a row in All Leads with status "form_started" so we can chase
 * leads who walked away mid-form. If they later click Continue, the
 * upsert in logAllLead_ will UPDATE this same row with otp_sent etc.
 */
function leadDraft_(p) {
  var email        = String(p.email        || "").toLowerCase().trim();
  var mobile       = String(p.mobile       || "").replace(/\D/g, "");
  var serviceType  = String(p.serviceType  || "other").toLowerCase().trim();
  var serviceName  = String(p.serviceName  || "Unknown service");
  var servicePrice = String(p.servicePrice || "");
  var origin       = String(p.origin       || "").trim();

  var hasEmail  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  var hasMobile = mobile && mobile.length >= 7;
  if (!hasEmail && !hasMobile) return { ok: false, message: "Need email or mobile." };

  // Leave email blank if not provided - dedup logic will match by mobile.
  var note = "Form started (";
  if (hasEmail && hasMobile) note += "mobile + email entered";
  else if (hasMobile)        note += "only mobile entered";
  else                       note += "only email entered";
  note += ", no OTP requested yet)";

  logAllLead_(serviceType, "", hasMobile ? mobile : "", hasEmail ? email : "", "", note,
              serviceName, servicePrice, "form_started", "lead_draft", origin, "", 1);
  return { ok: true };
}

/* -------- lead_cta (call / whatsapp / callback click tracking) --------
 * Fired by the frontend when a customer clicks "Call now", "WhatsApp",
 * or "Request callback" buttons. Updates the lead status.
 */
function leadCta_(p) {
  var email        = String(p.email        || "").toLowerCase().trim();
  var mobile       = String(p.mobile       || "").replace(/\D/g, "");
  var serviceType  = String(p.serviceType  || "other").toLowerCase().trim();
  var serviceName  = String(p.serviceName  || "");
  var servicePrice = String(p.servicePrice || "");
  var channel      = String(p.channel      || "").toLowerCase().trim();
  var origin       = String(p.origin       || "").trim();

  if (!email) return { ok: false, message: "Email required." };
  var validChannels = ["call", "whatsapp", "callback"];
  if (validChannels.indexOf(channel) === -1) return { ok: false, message: "Invalid channel." };

  var statusMap = {
    "call":     "cta_call",
    "whatsapp": "cta_whatsapp",
    "callback": "callback_requested"
  };
  var noteMap = {
    "call":     "Customer clicked 'Call now' button",
    "whatsapp": "Customer clicked 'WhatsApp' button",
    "callback": "Customer requested callback"
  };

  logAllLead_(serviceType, "", mobile, email, "", noteMap[channel],
              serviceName, servicePrice, statusMap[channel], "lead_cta", origin, "", 1);
  return { ok: true };
}

/* -------- lead_otp_send --------
 * Stores OTP in Apps Script CacheService (auto-expires after 10 min).
 * No "Lead OTP Pending" sheet needed.
 */
function leadOtpSend_(p) {
  var email        = String(p.email        || "").toLowerCase().trim();
  var mobile       = String(p.mobile       || "").replace(/\D/g, "");
  var serviceType  = String(p.serviceType  || "other").toLowerCase().trim();
  var serviceName  = String(p.serviceName  || "Unknown service");
  var servicePrice = String(p.servicePrice || "");
  var origin       = String(p.origin       || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Please enter a valid email." };
  if (!mobile || mobile.length < 7)              return { ok: false, message: "Please enter a valid mobile." };

  var otp = leadOtpGenerate_();
  var cacheKey = "leadotp:" + email + "|" + serviceType;
  var payload = JSON.stringify({ otp: otp, mobile: mobile, serviceName: serviceName, servicePrice: servicePrice });
  CacheService.getScriptCache().put(cacheKey, payload, LEAD_OTP_VALID_MIN * 60);

  var isResend  = String(p.resend || "") === "1";
  var newStatus = isResend ? "otp_resent" : "otp_initiated";
  var noteMsg   = isResend ? "OTP resent" : "OTP sent";
  logAllLead_(serviceType, "", mobile, email, "", noteMsg,
              serviceName, servicePrice, newStatus, "lead_otp_send", origin, otp, 1);

  try {
    MailApp.sendEmail({
      to: email,
      subject: "Your cursive verification code",
      htmlBody: leadOtpEmailHtml_(otp, serviceName),
      name: "cursive"
    });
  } catch (e) {
    return { ok: false, message: "Could not send the OTP email. Please try WhatsApp instead." };
  }
  return { ok: true, message: "OTP sent to " + email };
}

function leadOtpEmailHtml_(otp, serviceName) {
  return '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f6f8fa">'
    + '<div style="background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:28px">'
    + '<div style="font-size:18px;font-weight:700;color:#1f6feb;margin-bottom:8px">cursive</div>'
    + '<h2>Your verification code</h2>'
    + '<p>You requested <strong>' + escHtml_(serviceName) + '</strong>. Use this code to verify your contact details. Valid for ' + LEAD_OTP_VALID_MIN + ' minutes.</p>'
    + '<div style="font-size:32px;font-weight:700;letter-spacing:6px;text-align:center;background:#f6f8fa;border:1px dashed #d0d7de;border-radius:8px;padding:16px;margin:14px 0">' + otp + '</div>'
    + '<p style="color:#57606a;font-size:12px;margin-top:20px">If you did not request this, ignore this email. Need help? Contact@cursive.world or WhatsApp +91 96257 37475.</p>'
    + '</div></div>';
}

/* -------- lead_otp_verify --------
 * Reads OTP from CacheService (auto-expires after 10 min).
 * No sheet lookup needed.
 */
function leadOtpVerify_(p) {
  var email = String(p.email || "").toLowerCase().trim();
  var otp   = String(p.otp   || "").trim();
  var serviceType = String(p.serviceType || "").toLowerCase().trim();
  var origin = String(p.origin || "").trim();

  if (!email || !/^\d{4,8}$/.test(otp)) return { ok: false, message: "Invalid input." };

  var cacheKey = "leadotp:" + email + "|" + serviceType;
  var cached = CacheService.getScriptCache().get(cacheKey);
  if (!cached) {
    logAllLead_(serviceType, "", "", email, "", "Tried OTP " + otp + " but no pending OTP (expired or not issued)",
                "", "", "otp_no_pending", "lead_otp_verify", origin, "", 1);
    return { ok: false, message: "No OTP issued or OTP expired. Please request a new one." };
  }
  var stored;
  try { stored = JSON.parse(cached); }
  catch (e) { return { ok: false, message: "OTP data corrupted. Please request a new one." }; }

  if (String(stored.otp).trim() !== otp) {
    logAllLead_(serviceType, "", String(stored.mobile || ""), email, "", "Wrong OTP entered: " + otp,
                String(stored.serviceName || ""), String(stored.servicePrice || ""),
                "otp_wrong", "lead_otp_verify", origin, "", 1);
    return { ok: false, message: "Incorrect OTP." };
  }

  // OTP verified - clear cache and record lead in All Leads
  CacheService.getScriptCache().remove(cacheKey);
  var mobile       = String(stored.mobile || "");
  var serviceName  = String(stored.serviceName || "");
  var servicePrice = String(stored.servicePrice || "");
  var found = -1, pendingRow = null;  // legacy var refs below — keep as no-op
  logAllLead_(serviceType, "", mobile, email, "", "OTP verified", serviceName, servicePrice, "otp_verified", "lead_otp_verify", origin, "", 1);

  // Email Ankit so leads don't get missed
  try {
    var subject = "[cursive] New verified lead: " + serviceName;
    var html =
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f6f8fa">' +
      '<div style="background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:28px">' +
      '<div style="font-size:18px;font-weight:700;color:#1f6feb;margin-bottom:12px">cursive &mdash; New verified lead</div>' +
      '<table style="width:100%;font-size:14px;border-collapse:collapse">' +
      '<tr><td style="padding:6px 0;color:#57606a;width:130px">Service</td><td><strong>' + escHtml_(serviceName) + '</strong>' + (servicePrice ? ' &middot; ' + escHtml_(servicePrice) : '') + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Type tag</td><td>' + escHtml_(serviceType) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Mobile</td><td><a href="tel:' + escHtml_(mobile) + '">' + escHtml_(mobile) + '</a> &middot; <a href="https://wa.me/91' + escHtml_(mobile) + '">WhatsApp</a></td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Email</td><td><a href="mailto:' + escHtml_(email) + '">' + escHtml_(email) + '</a></td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Status</td><td><strong style="color:#10b981">OTP verified</strong></td></tr>' +
      '</table>' +
      '<p style="color:#57606a;font-size:12px;margin-top:20px">Call back within 2 working hours. Mark status in the "All Leads" sheet once contacted.</p>' +
      '</div></div>';
    MailApp.sendEmail({
      to: "Contact@cursive.world",
      replyTo: email,
      subject: subject,
      htmlBody: html,
      name: "cursive leads"
    });
  } catch (mailErr) { Logger.log("Lead email failed: " + mailErr.message); }

  // Cache already cleared above. No sheet row to delete.
  return { ok: true, message: "Verified." };
}


/* ============================================================
 * SECTION 8 - SERVICE PAYMENTS (v12)
 *
 * After OTP verification, a customer on /gst/, /trademark/ etc.
 * can pay the service fee via Razorpay. We create the order,
 * verify the signature, mark the lead as paid, send the invoice,
 * and notify Ankit.
 *
 * Sheets:
 *   Service Payments Pending  -> tracks orders awaiting capture
 *   (existing) Completed Payments + Invoices reused
 * ============================================================ */

var SERVICE_PAY_PENDING_TAB = "Service Payments Pending";

/* Documents needed for each service (sent in welcome email after payment) */
var SERVICE_DOC_LIST = {
  "gst": ["Aadhaar card (front + back)", "PAN card", "Passport-size photo", "Business address proof (electricity bill / rent agreement / property tax)", "Cancelled cheque OR bank passbook first page"],
  "trademark": ["Brand name + logo (PDF/PNG)", "Class of goods/services you want to register", "Authorisation letter (we'll email a template)", "PAN card", "Address proof"],
  "udyam": ["Aadhaar card", "PAN card", "Mobile number linked to Aadhaar", "Bank account details", "Business activity description"],
  "iec": ["PAN card", "Aadhaar card", "Cancelled cheque OR bank certificate", "Address proof", "Email + mobile"],
  "platform_account": ["GSTIN certificate", "PAN card", "Bank account details", "Brand logo (PNG)", "Product catalogue (Excel)"]
};

var SERVICE_FRIENDLY_NAME = {
  "gst": "GST Registration",
  "trademark": "Trademark Registration",
  "udyam": "Udyam (MSME) Certificate",
  "iec": "IEC (Import-Export Code)",
  "platform_account": "Marketplace Seller Account"
};

/* ============================================================
 * PROMO CODES
 * Sheet schema: A=Code, B=Valid From, C=Valid Till, D=Percent %,
 * E=Flat Rs., F=Service Type (comma list or blank=all),
 * G=Used Count, H=Notes
 *
 * Discount rule: if BOTH % and Flat are set, use the SMALLER discount
 * (protects business margin). Discount applied to GST-inclusive total.
 * ============================================================ */
var PROMO_CODES_TAB = "Promo Codes";

function promoCodesSheet_() {
  var ss = _adminSS_();
  var sh = ss.getSheetByName(PROMO_CODES_TAB);
  if (!sh) {
    sh = ss.insertSheet(PROMO_CODES_TAB);
    sh.appendRow(["Code", "Valid From", "Valid Till", "Percent %", "Flat Rs.", "Service Type", "Used Count", "Notes"]);
    sh.setFrozenRows(1); sh.getRange("A1:H1").setFontWeight("bold");
    sh.setColumnWidth(1, 130);  sh.setColumnWidth(2, 160);
    sh.setColumnWidth(3, 160);  sh.setColumnWidth(4, 90);
    sh.setColumnWidth(5, 90);   sh.setColumnWidth(6, 180);
    sh.setColumnWidth(7, 100);  sh.setColumnWidth(8, 240);
  }
  return sh;
}

/* Look up a code, validate, return discount details.
 * Returns: { ok: bool, code, percent, flat, discount, finalTotal, message } */
function lookupPromoCode_(code, serviceType, baseTotal) {
  code = String(code || "").trim().toUpperCase();
  if (!code) return { ok: false, message: "" };
  var sh = promoCodesSheet_();
  var data = sh.getDataRange().getValues();
  var now = new Date();
  for (var r = 1; r < data.length; r++) {
    var rowCode = String(data[r][0] || "").trim().toUpperCase();
    if (rowCode !== code) continue;
    var validFrom = data[r][1] ? new Date(data[r][1]) : null;
    var validTill = data[r][2] ? new Date(data[r][2]) : null;
    if (validFrom && now < validFrom) return { ok: false, message: "Code is not yet active." };
    if (validTill && now > validTill) return { ok: false, message: "Code has expired." };
    var svcRestrict = String(data[r][5] || "").trim().toLowerCase();
    if (svcRestrict) {
      var allowedSvcs = svcRestrict.split(",").map(function (s) { return s.trim(); });
      if (allowedSvcs.indexOf(String(serviceType || "").toLowerCase()) === -1) {
        return { ok: false, message: "Code not valid for this service." };
      }
    }
    var percent = Number(data[r][3]) || 0;
    var flat    = Number(data[r][4]) || 0;
    var percentDisc = Math.round((baseTotal * percent / 100) * 100) / 100;
    var flatDisc    = Math.min(flat, baseTotal);
    var discount;
    if (percent > 0 && flat > 0)      discount = Math.min(percentDisc, flatDisc);  // smaller discount
    else if (percent > 0)             discount = percentDisc;
    else if (flat > 0)                discount = flatDisc;
    else                              return { ok: false, message: "Code has no discount configured." };
    if (discount > baseTotal) discount = baseTotal;
    var finalTotal = Math.round((baseTotal - discount) * 100) / 100;
    return {
      ok: true,
      code: code,
      percent: percent,
      flat: flat,
      discount: discount,
      finalTotal: finalTotal,
      rowIdx: r + 1,
      message: "Code applied. You save Rs." + discount.toFixed(2)
    };
  }
  return { ok: false, message: "Invalid code." };
}

/* Increment usage count after a successful paid payment */
function promoIncrementUse_(code) {
  if (!code) return;
  var sh = promoCodesSheet_();
  var data = sh.getDataRange().getValues();
  var upper = String(code).trim().toUpperCase();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0] || "").trim().toUpperCase() === upper) {
      var current = Number(data[r][6]) || 0;
      sh.getRange(r + 1, 7).setValue(current + 1);
      return;
    }
  }
}

/* -------- validate_promo endpoint -------- */
function validatePromo_(p) {
  var code = String(p.code || "").trim();
  var serviceType = String(p.serviceType || "").trim().toLowerCase();
  var baseTotal = Number(p.baseTotal || 0);
  if (!code) return { ok: false, message: "Enter a code first." };
  if (!baseTotal || baseTotal <= 0) return { ok: false, message: "Invalid base total." };
  return lookupPromoCode_(code, serviceType, baseTotal);
}

/* -------- service_pay_initiate -------- */
function servicePayInitiate_(p) {
  var email        = String(p.email        || "").toLowerCase().trim();
  var mobile       = String(p.mobile       || "").replace(/\D/g, "");
  var serviceType  = String(p.serviceType  || "other").toLowerCase().trim();
  var serviceName  = String(p.serviceName  || SERVICE_FRIENDLY_NAME[serviceType] || "Unknown service");
  var unitPrice    = Number(p.servicePrice || 0);
  var qty          = Math.max(1, Math.min(10, parseInt(p.qty || "1", 10) || 1));   // clamp 1..10
  var baseTotal    = unitPrice * qty;
  var promoCodeIn  = String(p.code || "").trim().toUpperCase();
  var discount     = 0;
  var appliedCode  = "";
  if (promoCodeIn) {
    var promo = lookupPromoCode_(promoCodeIn, serviceType, baseTotal);
    if (promo.ok) {
      discount = promo.discount;
      appliedCode = promo.code;
    }
  }
  var amountRupees = Math.round((baseTotal - discount) * 100) / 100;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Invalid email." };
  if (!amountRupees || amountRupees <= 0)        return { ok: false, message: "Invalid amount." };

  var amountPaise = Math.round(amountRupees * 100);
  var receipt = "svc_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

  var creds = getRazorpayCreds_();
  var auth = Utilities.base64Encode(creds.id + ':' + creds.secret);
  var resp = UrlFetchApp.fetch('https://api.razorpay.com/v1/orders', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Basic ' + auth },
    payload: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: receipt, payment_capture: 1 }),
    muteHttpExceptions: true
  });
  var rzpData = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() !== 200) {
    return { ok: false, message: "Razorpay order failed: " + (rzpData.error && rzpData.error.description || resp.getContentText()) };
  }

  var orderRef = Utilities.getUuid();
  var ts = fmtNow_();
  // Unified Pending Payments schema: Date, Time, Type, Reference, RzpOrderId,
  // Email, Mobile, Description, Amount, Qty, Status, Payload
  pendingPaymentsSheet_().appendRow([
    ts.date, ts.time, "service", orderRef, rzpData.id,
    email, mobile, serviceName, amountRupees, qty, "pending",
    JSON.stringify({ serviceType: serviceType, qty: qty, unitPrice: unitPrice, code: appliedCode, discount: discount })
  ]);

  // Also log payment-initiated event in All Leads (with promo code if any)
  var origin = String(p.origin || "").trim();
  var noteSuffix = appliedCode ? " | code " + appliedCode + " (-Rs." + discount.toFixed(2) + ")" : "";
  logAllLead_(serviceType, "", mobile, email, "",
              "Razorpay order " + rzpData.id + " (orderRef " + orderRef + ", qty " + qty + ")" + noteSuffix,
              serviceName, amountRupees, "payment_initiated", "service_pay_initiate", origin, "", qty, appliedCode);

  return {
    ok: true,
    orderRef: orderRef,
    appliedCode: appliedCode,
    discount: discount,
    finalAmount: amountRupees,
    razorpay: { keyId: creds.id, orderId: rzpData.id, amountPaise: amountPaise, currency: 'INR' }
  };
}

/* -------- service_pay_complete -------- */
function servicePayComplete_(p) {
  var email        = String(p.email        || "").toLowerCase().trim();
  var mobile       = String(p.mobile       || "").replace(/\D/g, "");
  var serviceType  = String(p.serviceType  || "other").toLowerCase().trim();
  var serviceName  = String(p.serviceName  || SERVICE_FRIENDLY_NAME[serviceType] || "Service");
  var qty          = Math.max(1, Math.min(10, parseInt(p.qty || "1", 10) || 1));
  var amountRupees = Number(p.servicePrice || 0);
  var orderRef     = String(p.orderRef || "");
  var paymentId    = String(p.razorpay_payment_id || "");
  var orderId      = String(p.razorpay_order_id   || "");
  var signature    = String(p.razorpay_signature  || "");

  if (!paymentId || !orderId || !signature) return { ok: false, message: "Missing Razorpay fields." };
  if (!amountRupees || amountRupees <= 0)   return { ok: false, message: "Invalid amount." };

  var originSvc = String(p.origin || "").trim();

  // Verify signature
  var creds = getRazorpayCreds_();
  var hmac = Utilities.computeHmacSha256Signature(orderId + '|' + paymentId, creds.secret);
  var expected = hmac.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  if (expected !== signature) {
    logAllLead_(serviceType, "", mobile, email, "",
                "Payment signature mismatch. Razorpay payment " + paymentId + " (order " + orderId + ")",
                serviceName, amountRupees, "payment_failed", "service_pay_complete", originSvc, "", 1);
    return { ok: false, message: "Payment signature verification failed." };
  }

  // Mark pending row as paid + read promo code from payload
  var appliedCode = "";
  try {
    var ps = pendingPaymentsSheet_();
    var pdata = ps.getDataRange().getValues();
    for (var r = 1; r < pdata.length; r++) {
      if (String(pdata[r][3]) === orderRef || String(pdata[r][4]) === orderId) {
        ps.getRange(r + 1, 11).setValue("paid");
        try {
          var pl = JSON.parse(String(pdata[r][11] || "{}"));
          appliedCode = String(pl.code || "");
        } catch (e) {}
        break;
      }
    }
  } catch (e) { Logger.log("Could not mark pending paid: " + e); }

  // Increment usage count for the promo code (if any)
  if (appliedCode) {
    try { promoIncrementUse_(appliedCode); } catch (e) { Logger.log("Promo increment failed: " + e); }
  }

  // GST split (intra-state if Delhi else inter-state)
  var subtotal = amountRupees / 1.18;     // amount entered is GST-inclusive
  var gst      = amountRupees - subtotal;
  subtotal = Math.round(subtotal * 100) / 100;
  gst      = Math.round(gst * 100) / 100;
  var customerState = ""; // we don't capture state for service leads; default to inter-state
  var isIntra = false;
  var cgst = isIntra ? Math.round((gst / 2) * 100) / 100 : 0;
  var sgst = isIntra ? Math.round((gst / 2) * 100) / 100 : 0;
  var igst = isIntra ? 0 : gst;

  // Invoice
  var invoiceNumber = "";
  try {
    invoiceNumber = generateInvoiceNumber_();
    var invoice = {
      invoiceNumber: invoiceNumber,
      date: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM yyyy'),
      customerEmail: email,
      customerMobile: mobile,
      customerState: customerState,
      customerGstName: "",
      customerGstNumber: "",
      customerGstAddress: "",
      qty: 1,
      rate: subtotal,
      subtotal: subtotal, cgst: cgst, sgst: sgst, igst: igst,
      totalTax: gst, total: amountRupees,
      razorpayPaymentId: paymentId, razorpayOrderId: orderId
    };
    // Override description on the doc to reflect the service
    invoice.descriptionOverride = serviceName;

    invoicesSheet_().appendRow([
      new Date(), invoiceNumber, email, mobile,
      "", "", "", 1, subtotal, cgst, sgst, igst, amountRupees, paymentId, orderId
    ]);
    completedPaymentsSheet_().appendRow([new Date(), email, paymentId, orderId, amountRupees, 1, invoiceNumber]);

    var pdfBlob = generateServiceInvoicePdf_(invoice, serviceName);

    // Customer email with documents needed
    var docs = SERVICE_DOC_LIST[serviceType] || ["Government ID", "Address proof", "Bank details"];
    var docHtml = '<ul style="padding-left:20px;color:#1f2328">';
    docs.forEach(function (d) { docHtml += '<li style="margin-bottom:4px">' + escHtml_(d) + '</li>'; });
    docHtml += '</ul>';

    var customerHtml =
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f6f8fa">' +
      '<div style="background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:28px">' +
      '<div style="font-size:18px;font-weight:700;color:#1f6feb;margin-bottom:8px">cursive</div>' +
      '<h2>Payment received &mdash; ' + escHtml_(serviceName) + '</h2>' +
      '<p>Hi! We received your payment of <strong>&#8377;' + amountRupees.toFixed(2) + '</strong>. Invoice <strong>' + invoiceNumber + '</strong> is attached as a PDF.</p>' +
      '<h3 style="margin-top:24px">What we need from you next</h3>' +
      '<p>Please send these documents on WhatsApp (<a href="https://wa.me/919625737475">+91 96257 37475</a>) or reply to this email with attachments:</p>' +
      docHtml +
      '<p style="margin-top:20px"><strong>Once we receive your documents, work begins immediately.</strong> You can also call us at +91 96257 37475 if you need help.</p>' +
      '<p style="color:#57606a;font-size:12px;margin-top:28px">Razorpay Payment ID: ' + paymentId + '</p>' +
      '<p style="color:#57606a;font-size:12px">T&amp;C applied. Refund policy on our website.</p>' +
      '</div></div>';

    MailApp.sendEmail({
      to: email,
      subject: "cursive - Payment confirmation + documents needed for " + serviceName,
      htmlBody: customerHtml,
      attachments: [pdfBlob],
      name: "cursive"
    });

    // Internal email to Ankit
    var internalHtml =
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f6f8fa">' +
      '<div style="background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:28px">' +
      '<div style="font-size:18px;font-weight:700;color:#10b981;margin-bottom:12px">cursive &mdash; New PAID order</div>' +
      '<table style="width:100%;font-size:14px;border-collapse:collapse">' +
      '<tr><td style="padding:6px 0;color:#57606a;width:130px">Service</td><td><strong>' + escHtml_(serviceName) + '</strong></td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Amount paid</td><td><strong>&#8377;' + amountRupees.toFixed(2) + '</strong></td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Email</td><td><a href="mailto:' + escHtml_(email) + '">' + escHtml_(email) + '</a></td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Mobile</td><td><a href="tel:' + escHtml_(mobile) + '">' + escHtml_(mobile) + '</a> &middot; <a href="https://wa.me/91' + escHtml_(mobile) + '">WhatsApp</a></td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Invoice</td><td>' + invoiceNumber + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#57606a">Payment ID</td><td>' + paymentId + '</td></tr>' +
      '</table>' +
      '<p style="margin-top:20px"><strong>Customer has been emailed the documents list.</strong> Watch for their reply with attachments.</p>' +
      '</div></div>';

    MailApp.sendEmail({
      to: "Contact@cursive.world",
      replyTo: email,
      subject: "[cursive] PAID: " + serviceName + " - " + email,
      htmlBody: internalHtml,
      name: "cursive leads"
    });
  } catch (mailErr) { Logger.log("Service payment invoice/email failed: " + mailErr.message); }

  // Log NEW row in All Leads marking the payment as completed
  logAllLead_(serviceType, "", mobile, email, "",
              "Paid. Invoice " + (invoiceNumber || "(pending)") + " | Razorpay: " + paymentId + (appliedCode ? " | code " + appliedCode : ""),
              serviceName, amountRupees, "payment_paid", "service_pay_complete", originSvc, "", qty, appliedCode);

  return {
    ok: true,
    invoiceNumber: invoiceNumber || "(emailed)",
    amount: amountRupees
  };
}

/* Service-specific PDF invoice (slight variation of generateInvoicePdf_) */
function generateServiceInvoicePdf_(inv, serviceName) {
  var doc = DocumentApp.create('Invoice ' + inv.invoiceNumber.replace(/\//g, '-'));
  var body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);
  body.appendParagraph(BIZ_NAME).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(BIZ_BRAND + ' - seller services').setItalic(true);
  body.appendParagraph(BIZ_ADDRESS);
  body.appendParagraph('GSTIN: ' + BIZ_GSTIN + '  ·  Proprietor: ' + BIZ_PROPRIETOR);
  body.appendParagraph('Email: ' + BIZ_EMAIL + '  ·  Phone: ' + BIZ_PHONE);
  body.appendHorizontalRule();
  body.appendParagraph('TAX INVOICE').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Invoice No: ' + inv.invoiceNumber);
  body.appendParagraph('Date: ' + inv.date);
  body.appendParagraph('');
  body.appendParagraph('Bill To:').setBold(true);
  body.appendParagraph(inv.customerEmail);
  if (inv.customerMobile) body.appendParagraph('Mobile: ' + inv.customerMobile);
  body.appendParagraph('');
  body.appendTable([
    ['Description', 'Qty', 'Rate (Rs.)', 'Amount (Rs.)'],
    [serviceName + ' - filing & service charges (incl. govt fees)', '1', inv.subtotal.toFixed(2), inv.subtotal.toFixed(2)]
  ]);
  body.appendParagraph('');
  body.appendParagraph('Subtotal: Rs.' + inv.subtotal.toFixed(2));
  if (inv.cgst > 0) {
    body.appendParagraph('CGST (9%): Rs.' + inv.cgst.toFixed(2));
    body.appendParagraph('SGST (9%): Rs.' + inv.sgst.toFixed(2));
  } else {
    body.appendParagraph('IGST (18%): Rs.' + inv.igst.toFixed(2));
  }
  body.appendParagraph('Total: Rs.' + inv.total.toFixed(2)).setBold(true);
  body.appendParagraph('');
  body.appendParagraph('Razorpay Payment ID: ' + inv.razorpayPaymentId);
  body.appendParagraph('');
  body.appendParagraph('Refund policy: 100% refund within 24 hours of payment if filing has not yet been submitted. Government fees are non-refundable once submitted.');
  body.appendParagraph('');
  body.appendParagraph('Thank you for your purchase.');
  doc.saveAndClose();
  var docFile = DriveApp.getFileById(doc.getId());
  var pdfBlob = docFile.getAs('application/pdf').setName('Invoice-' + inv.invoiceNumber.replace(/\//g, '-') + '.pdf');
  docFile.setTrashed(true);
  return pdfBlob;
}
