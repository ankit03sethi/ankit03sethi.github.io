/* Cursive Analyst - "Install app" links download the LATEST Windows installer directly.
   Every <a data-install-app> on the page:
     - shows the version:  "Install app v1.7.50"
     - downloads the .exe straight away (never opens the GitHub page)
   The newest release is read from GitHub each page load; if GitHub is slow or
   rate-limited, the last-known-good build below is used, so a click always
   gives a real installer. */
(function () {
  const REPO = "ankit03sethi/cursive-analyst-releases";
  // last-known-good fallback - update when convenient, the live lookup normally wins
  let ver = "1.7.50";
  let exe = "https://github.com/" + REPO + "/releases/download/v1.7.50/Cursive-Analyst-Setup-1.7.50.exe";

  function paint() {
    document.querySelectorAll("a[data-install-app]").forEach(function (a) {
      a.href = exe;
      a.setAttribute("download", "");
      a.title = "Download Cursive Analyst v" + ver + " for Windows";
      a.textContent = (a.dataset.installLabel || "Install app") + " v" + ver;
      if (!a.dataset.installWired) {
        a.dataset.installWired = "1";
        a.addEventListener("click", function (e) {
          e.preventDefault();
          const d = document.createElement("a");
          d.href = exe; d.setAttribute("download", ""); d.rel = "noopener";
          document.body.appendChild(d); d.click(); d.remove();
        });
      }
    });
    window.CURSIVE_APP_LATEST = { version: ver, url: exe };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint); else paint();

  fetch("https://api.github.com/repos/" + REPO + "/releases/latest")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (rel) {
      if (!rel) return;
      const a = (rel.assets || []).find(function (x) { return /\.exe$/i.test(x.name); });
      if (!a || !a.browser_download_url) return;
      ver = String(rel.tag_name || rel.name || ver).replace(/^v/i, "");
      exe = a.browser_download_url;
      paint();
    })
    .catch(function () { /* fallback above still downloads */ });
})();
