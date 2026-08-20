// login-redirect.js
// Shared helper: given a whoami-ish payload (permissions[], roles[]),
// returns the "primary dashboard" path for the user, or null if no redirect
// should happen. Callers on individual dashboards can use this to auto-route
// employees to their own home page after login.
//
// Priority:
//   super/leads perm  -> null   (managers pick their own page, don't redirect)
//   roles has 'processing' AND NOT 'sales' -> '/processing/'
//   roles has 'sales'                       -> '/leads01/'
//   roles has 'renewal'                     -> '/leads01/'   (dedicated /renewal/ coming)
//   roles has 'backend'                     -> '/leads01/'   (dedicated /backend/ coming)
//   else -> null
(function () {
  function primaryDashboardFor(info) {
    if (!info) return null;
    const perms = Array.isArray(info.permissions) ? info.permissions : [];
    const roles = Array.isArray(info.roles) ? info.roles : [];
    if (perms.includes("super") || perms.includes("leads")) return null;
    if (roles.includes("processing") && !roles.includes("sales")) return "/processing/";
    if (roles.includes("sales")) return "/leads01/";
    if (roles.includes("renewal")) return "/leads01/";
    if (roles.includes("backend")) return "/leads01/";
    return null;
  }

  // Convenience: given whoami info + the current pathname, returns the target
  // dashboard iff we should redirect. Otherwise null.
  function targetIfShouldRedirect(info, currentPath) {
    const target = primaryDashboardFor(info);
    if (!target) return null;
    const cur = String(currentPath || "").replace(/\/+$/, "/") || "/";
    const t   = target.replace(/\/+$/, "/") || "/";
    if (cur === t) return null;
    // Only redirect between our known dashboard paths
    const known = ["/leads01/", "/processing/"];
    if (!known.some((k) => cur.startsWith(k))) return null;
    return target;
  }

  window.CursiveLoginRedirect = { primaryDashboardFor, targetIfShouldRedirect };
})();
