/* Cursive Analyst — who is signed in and what they may see or change.
   Owners see everything of their own account. Employees see the owner's data,
   limited to the permissions and companies the owner ticked on the Uploads page.
   Usage (after supabase client `sb` exists and the session is known):
     const access = await CA.load(sb);   // {owner_id, is_owner, perms, companies, active, ...}
     CA.can("stock.A", "edit")           // true / false
     CA.apply()                          // hides [data-perm] / disables [data-perm-edit] elements
*/
(function () {
  const CATALOG = [
    { page: "uploads", label: "Uploads", items: [
      { key: "uploads.orders",      label: "CSV file (orders)" },
      { key: "uploads.manifest",    label: "Manifest file" },
      { key: "uploads.orders_file", label: "Orders file" },
      { key: "uploads.returns",     label: "Returns file" },
      { key: "uploads.inventory",   label: "Inventory file" },
      { key: "uploads.payments",    label: "Payments file" },
      { key: "uploads.master",      label: "Master SKU file (see / download)" },
      { key: "uploads.master.replace", label: "Master SKU: delete old data + save file", levels: ["edit"] },
      { key: "uploads.master.append",  label: "Master SKU: only add new / update edited rows", levels: ["edit"] },
      { key: "uploads.warehouse",   label: "Warehouse stock file" },
      { key: "uploads.companies",   label: "Companies" },
      { key: "uploads.checklist",   label: "Today's checklist", levels: ["view"] },
      { key: "uploads.skuwise",     label: "SKU wise data panel", levels: ["view"] },
    ]},
    { page: "scanner", label: "Scanner", items: [
      { key: "scanner", label: "Scanner (edit = can scan)" },
    ]},
    { page: "reports", label: "Reports", items: [
      { key: "reports.orders",   label: "Orders",   levels: ["view"] },
      { key: "reports.payments", label: "Payments", levels: ["view"] },
      { key: "reports.returns",  label: "Returns",  levels: ["view"] },
      { key: "reports.missings", label: "Missings", levels: ["view"] },
    ]},
    { page: "skuwise", label: "SKU-wise data", items: [
      { key: "skuwise.sku_master", label: "SKU Master (edit = tags, seller names, reset listings)" },
      { key: "skuwise.orders",   label: "Orders",   levels: ["view"] },
      { key: "skuwise.returns",  label: "Returns",  levels: ["view"] },
      { key: "skuwise.payments", label: "Payments", levels: ["view"] },
      { key: "skuwise.stock",    label: "Stock" },
      { key: "skuwise.uploads",  label: "Uploads tab", levels: ["view"] },
    ]},
    { page: "settings", label: "Settings", items: [
      { key: "settings", label: "Print sorting settings" },
    ]},
    { page: "stock", label: "Stock In/Out", items: [
      { key: "stock.A", label: "A · Loose items (edit = 0/200 + Deleted)" },
      { key: "stock.B", label: "B · Made items", levels: ["view"] },
      { key: "stock.C", label: "C · Kits", levels: ["view"] },
      { key: "stock.M", label: "Movements", levels: ["view"] },
      { key: "stock.download", label: "Download workbook", levels: ["view"] },
    ]},
  ];

  let access = null;

  function levelOf(key) {
    if (!access) return "";
    if (access.is_owner) return "edit";
    const perms = access.perms || {};
    let k = key;
    for (;;) {
      if (perms[k] !== undefined && perms[k] !== null) return perms[k];   // "" = explicitly none (same rule as has_perm in the database)
      const i = k.lastIndexOf(".");
      if (i < 0) return "";
      k = k.slice(0, i);
    }
  }
  function can(key, level) {
    const l = levelOf(key);
    if (level === "edit") return l === "edit";
    return l === "view" || l === "edit";
  }
  // Does the employee have any access at all on a page?
  function anyOn(page) {
    if (!access) return false;
    if (access.is_owner) return true;
    const g = CATALOG.find(x => x.page === page);
    if (!g) return can(page, "view");
    return g.items.some(it => can(it.key, "view"));
  }

  async function load(sb) {
    try { await sb.rpc("analyst_member_claim"); } catch (e) { /* first sign-in link only */ }
    const { data, error } = await sb.rpc("my_access");
    if (error) throw error;
    access = data || {};
    window.CA_ACCESS = access;
    return access;
  }

  // data-perm="key"            → element removed (display:none) unless view
  // data-perm-edit="key"       → element disabled (and dimmed) unless edit
  // data-perm-page="page"      → hidden unless any item of that page is allowed
  // data-owner-only            → hidden for employees
  function apply(root) {
    root = root || document;
    root.querySelectorAll("[data-perm]").forEach(el => { if (!can(el.dataset.perm, "view")) el.style.display = "none"; });
    root.querySelectorAll("[data-perm-page]").forEach(el => { if (!anyOn(el.dataset.permPage)) el.style.display = "none"; });
    root.querySelectorAll("[data-perm-edit]").forEach(el => {
      if (!can(el.dataset.permEdit, "edit")) {
        el.disabled = true; el.style.opacity = ".45"; el.style.pointerEvents = "none";
        el.title = "View only — ask the account owner for edit access";
      }
    });
    if (access && !access.is_owner) root.querySelectorAll("[data-owner-only]").forEach(el => { el.style.display = "none"; });
  }

  // Small badge text for headers: "Employee of owner@x.com"
  function who() {
    if (!access) return "";
    return access.is_owner ? (access.email || "") : `${access.email || ""} · employee of ${access.owner_email || "owner"}`;
  }

  window.CA = { CATALOG, load, can, levelOf, anyOn, apply, who, get access() { return access; }, ownerId: () => (access ? access.owner_id : null) };
})();
