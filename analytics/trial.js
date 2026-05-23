/* cursive Trial - shared client logic */
(function () {
  "use strict";

  var TRIAL_KEY    = "365avail.trial.v1";
  var ANALYTICS_SESSION_KEY = "365avail.session.v1";

  // Share the Apps Script URL with the analytics dashboard config.
  var site = window.SITE_CONFIG || {};
  var cfg  = {
    appsScriptUrl: (window.TRIAL_CONFIG && window.TRIAL_CONFIG.appsScriptUrl) || site.appsScriptUrl,
    analyticsUrl:  (window.TRIAL_CONFIG && window.TRIAL_CONFIG.analyticsUrl)  || "./"
  };

  var Trial = window.Trial = {
    cfg: cfg,
    state: function () {
      try { return JSON.parse(sessionStorage.getItem(TRIAL_KEY) || "{}"); }
      catch (e) { return {}; }
    },
    save: function (patch) {
      var s = Trial.state();
      Object.keys(patch || {}).forEach(function (k) { s[k] = patch[k]; });
      try { sessionStorage.setItem(TRIAL_KEY, JSON.stringify(s)); } catch (e) {}
      return s;
    },
    clear: function () {
      try { sessionStorage.removeItem(TRIAL_KEY); } catch (e) {}
    },

    /* Post form-encoded body to Apps Script. Avoids preflight. */
    post: function (action, params) {
      if (!cfg.appsScriptUrl) {
        return Promise.reject(new Error("Apps Script URL not set"));
      }
      var body = "action=" + encodeURIComponent(action);
      Object.keys(params || {}).forEach(function (k) {
        var v = params[k];
        if (v == null) return;
        if (typeof v === "object") v = JSON.stringify(v);
        body += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(v);
      });
      return fetch(cfg.appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body,
        redirect: "follow"
      }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
    },

    /* Require that the user has reached a given step. Otherwise bounce back. */
    requireStep: function (needs) {
      var s = Trial.state();
      var ok = true;
      (needs || []).forEach(function (k) { if (!s[k]) ok = false; });
      if (!ok) {
        location.replace("signup.html");
      }
      return s;
    },

    /* After successful upload: hand off credentials to the analytics dashboard. */
    handoffToAnalytics: function (email, password) {
      try {
        sessionStorage.setItem(
          ANALYTICS_SESSION_KEY,
          JSON.stringify({ id: email, password: password })
        );
      } catch (e) {}
      Trial.clear();
      location.replace(cfg.analyticsUrl || "/analytics/");
    },

    /* UI helpers */
    showError: function (id, msg) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = msg || "Something went wrong. Please try again.";
      el.classList.remove("hidden");
    },
    hideError: function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    },
    busy: function (btn, busy, idleText) {
      if (!btn) return;
      if (busy) {
        btn.disabled = true;
        btn.dataset.idle = btn.dataset.idle || btn.textContent;
        btn.innerHTML = '<span class="spinner"></span>Please wait...';
      } else {
        btn.disabled = false;
        btn.textContent = idleText || btn.dataset.idle || "Continue";
      }
    }
  };

  /* Quick email + mobile validators */
  Trial.isEmail = function (s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
  };
  Trial.isMobile = function (s) {
    return /^[+]?[\d\s\-()]{7,18}$/.test(String(s || "").trim());
  };
  Trial.normalizeMobile = function (s) {
    return String(s || "").replace(/[^\d]/g, "");
  };
})();
