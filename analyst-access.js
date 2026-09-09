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
      { key: "uploads.warehouse",   label: "Warehouse stock file" },
      { key: "uploads.companies",   label: "Companies" },
      { key: "uploads.checklist",   label: "Today's checklist", levels: ["view"] },
    ]},
    { page: "master", label: "Master SKU file", items: [
      { key: "uploads.master.sample",  label: "1 · Download sample file (blank template)", levels: ["view"] },
      { key: "uploads.master",         label: "2 · Download existing data", levels: ["view"] },
      { key: "uploads.master.upload",  label: "3 · Upload file", levels: ["edit"] },
      { key: "uploads.master.replace", label: "4 · Delete old data (replace everything)", levels: ["edit"] },
      { key: "uploads.master.update",  label: "5 · Edit old rows", levels: ["edit"] },
      { key: "uploads.master.append",  label: "6 · Add new rows", levels: ["edit"] },
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
      { key: "skuwise.sku_master", label: "SKU Master (edit = tags, seller names)" },
      { key: "skuwise.delete",     label: "Delete data button (clear site price / ratings / seller for shown rows)", levels: ["edit"] },
      { key: "skuwise.orders",   label: "Orders",   levels: ["view"] },
      { key: "skuwise.returns",  label: "Returns",  levels: ["view"] },
      { key: "skuwise.payments", label: "Payments", levels: ["view"] },
      { key: "skuwise.stock",    label: "Stock" },
      { key: "skuwise.financial", label: "Financial data (cost, margin, revenue, settlement, profit columns; Payments tab)", levels: ["view"] },
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

  // Until we know who is signed in, keep every permission-gated element invisible so an
  // employee never sees tabs flash and then vanish.
  try {
    const st = document.createElement("style");
    st.textContent = "html.ca-pending [data-perm], html.ca-pending [data-perm-page], html.ca-pending [data-owner-only] { visibility: hidden !important; }";
    (document.head || document.documentElement).appendChild(st);
    document.documentElement.classList.add("ca-pending");
  } catch (e) { /* ignore */ }
  const reveal = () => document.documentElement.classList.remove("ca-pending");

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
    if (!access) return false;
    if (access.is_owner) return true;
    // edit must be ticked on the exact item; a page-level setting only grants view (same rule as has_perm in the database)
    if (level === "edit") return (access.perms || {})[key] === "edit";
    const l = levelOf(key);
    return l === "view" || l === "edit";
  }
  // Does the employee have any access at all on a page?
  function anyOn(page) {
    if (!access) return false;
    if (access.is_owner) return true;
    const g = CATALOG.find(x => x.page === page);
    if (!g) return can(page, "view");
    if (g.items.some(it => can(it.key, "view"))) return true;
    // the Master SKU file lives on the Uploads page
    return page === "uploads" ? anyOn("master") : false;
  }

  async function load(sb) {
    try { await sb.rpc("analyst_member_claim"); } catch (e) { /* first sign-in link only */ }
    const { data, error } = await sb.rpc("my_access");
    if (error) throw error;
    access = data || {};
    window.CA_ACCESS = access;
    if (access.is_owner) reveal();      // owners see everything; employees are revealed by apply()
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
        if (el.hasAttribute("data-hide")) { el.style.display = "none"; return; }
        el.disabled = true; el.style.opacity = ".45"; el.style.pointerEvents = "none";
        el.title = "View only — ask the account owner for edit access";
      }
    });
    if (access && !access.is_owner) root.querySelectorAll("[data-owner-only]").forEach(el => { el.style.display = "none"; });
    reveal();
  }

  // Small badge text for headers: "Employee of owner@x.com"
  function who() {
    if (!access) return "";
    return access.is_owner ? (access.email || "") : `${access.email || ""} · employee of ${access.owner_email || "owner"}`;
  }

  window.CA = { CATALOG, load, can, levelOf, anyOn, apply, who, get access() { return access; }, ownerId: () => (access ? access.owner_id : null) };
})();
