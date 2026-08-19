// admin-guard.js — shared client-side gate for every admin page.
// Usage on each admin page (after supabase client is created):
//   <script src="/admin/admin-guard.js"></script>
//   <script>await AdminGuard.require(sb, "catalog");</script>
// Redirects to /home/ (with return path) if not signed in, or shows a friendly
// "no access" panel if signed in but missing the required permission.

(function () {
  const G = {};

  async function fetchPermissions(sb) {
    try {
      const { data, error } = await sb.rpc("current_admin_permissions");
      if (error) return [];
      return Array.isArray(data) ? data : [];
    } catch (_) { return []; }
  }

  function can(perms, section) {
    if (!Array.isArray(perms)) return false;
    return perms.includes("super") || perms.includes(section);
  }

  function showNoAccessPanel(section, perms) {
    document.body.innerHTML = `<div style="max-width:520px;margin:60px auto;padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,0.06);font-family:-apple-system,'Segoe UI',Roboto,sans-serif;">
      <h1 style="margin:0 0 10px;font-size:22px;color:#0f172a;">🚫 No access to <b style="color:#1f6feb;">${section}</b></h1>
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 18px;">Your admin account doesn't have permission for this section.
        Ask a super-admin to grant you <code>${section}</code> in the admin users panel.</p>
      <p style="color:#94a3b8;font-size:12px;margin:0 0 16px;">Your current permissions: <code>${perms.length ? perms.join(", ") : "(none)"}</code></p>
      <div style="display:flex;gap:8px;">
        <a href="/home/" style="flex:1;padding:10px;background:#1f6feb;color:#fff;text-decoration:none;border-radius:8px;text-align:center;font-weight:700;font-size:14px;">← Home</a>
        <button onclick="location.reload()" style="padding:10px 16px;background:#fff;color:#1f6feb;border:1px solid #1f6feb;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">Retry</button>
      </div>
    </div>`;
  }

  // Public API — call this at the top of each admin page's init
  G.require = async function (sb, section) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      const ret = encodeURIComponent(location.pathname + location.search);
      location.replace(`/home/?return=${ret}`);
      throw new Error("not signed in");
    }
    const perms = await fetchPermissions(sb);
    if (!can(perms, section)) {
      showNoAccessPanel(section, perms);
      throw new Error("no permission: " + section);
    }
    return { session, permissions: perms, is_super: perms.includes("super") };
  };

  // Softer variant: returns { ok, permissions } without redirecting (for pages that
  // want to hide certain UI but not block the whole page).
  G.check = async function (sb, section) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return { ok: false, permissions: [], reason: "not_signed_in" };
    const perms = await fetchPermissions(sb);
    return { ok: can(perms, section), permissions: perms, is_super: perms.includes("super") };
  };

  window.AdminGuard = G;
})();
