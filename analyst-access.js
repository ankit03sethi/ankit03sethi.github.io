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
      { key: "skuwise.sku_master", label: "SKU Master (view = see page; edit = change cells)", levels: ["view", "edit"] },
      { key: "skuwise.orders",   label: "Orders",   levels: ["view"] },
      { key: "skuwise.returns",  label: "Returns",  levels: ["view"] },
      { key: "skuwise.payments", label: "Payments", levels: ["view"] },
      { key: "skuwise.stock",    label: "Stock", levels: ["view"] },
      { key: "skuwise.financial", label: "Financial data (cost, margin, revenue, settlement, profit columns; Payments tab)", levels: ["view"] },
      { key: "skuwise.uploads",  label: "Uploads tab", levels: ["view"] },
    ]},
    // Every column of the SKU-wise page (SKU Master view), one by one. A column left
    // blank (nothing ticked) follows the rules above, exactly as before: visible with
    // SKU Master view, financial ones only with Financial data. Ticking None / View /
    // Edit overrides that for the column. Edit is offered only on typed columns.
    // Keep in step with SKU_COLS in skuwisedata/index.html (a column missing here
    // simply keeps the default rule).
    { page: "skuwise_cols", label: "SKU-wise data · columns (blank = as before)", inherit: true, items: [
      { key: "skuwise.col.S.NO", label: "S.NO", levels: ["view"] },
      { key: "skuwise.col.Date", label: "Date", levels: ["view"] },
      { key: "skuwise.col.Listed By", label: "Listed By", levels: ["view"] },
      { key: "skuwise.col.Company", label: "Company", levels: ["view"] },
      { key: "skuwise.col.Platform", label: "Platform", levels: ["view"] },
      { key: "skuwise.col.Platform Seller", label: "Platform Seller", levels: ["view"] },
      { key: "skuwise.col.Brand", label: "Brand", levels: ["view"] },
      { key: "skuwise.col.Vertical", label: "Vertical", levels: ["view"] },
      { key: "skuwise.col.Return Type", label: "Return Type", levels: ["view"] },
      { key: "skuwise.col.Type", label: "Type", levels: ["view"] },
      { key: "skuwise.col.Category", label: "Category", levels: ["view"] },
      { key: "skuwise.col.Sub Category", label: "Sub Category", levels: ["view"] },
      { key: "skuwise.col.Others", label: "Others", levels: ["view", "edit"] },
      { key: "skuwise.col.Product", label: "Product", levels: ["view"] },
      { key: "skuwise.col.Color", label: "Color", levels: ["view"] },
      { key: "skuwise.col.Mapped", label: "Mapped", levels: ["view"] },
      { key: "skuwise.col.Parent/Child", label: "Parent/Child", levels: ["view"] },
      { key: "skuwise.col.MOQ", label: "MOQ", levels: ["view", "edit"] },
      { key: "skuwise.col.MOQ AP", label: "MOQ AP", levels: ["view"] },
      { key: "skuwise.col.Variation", label: "Variation", levels: ["view", "edit"] },
      { key: "skuwise.col.ASIN", label: "ASIN", levels: ["view"] },
      { key: "skuwise.col.Other Listing Id", label: "Other Listing Id", levels: ["view"] },
      { key: "skuwise.col.SKU", label: "SKU", levels: ["view"] },
      { key: "skuwise.col.Master Sku", label: "Master Sku", levels: ["view"] },
      { key: "skuwise.col.W Qty", label: "W Qty", levels: ["view"] },
      { key: "skuwise.col.P Qty", label: "P Qty", levels: ["view"] },
      { key: "skuwise.col.Qty", label: "Qty", levels: ["view"] },
      { key: "skuwise.col.COP", label: "COP", levels: ["view"] },
      { key: "skuwise.col.HSN", label: "HSN", levels: ["view"] },
      { key: "skuwise.col.Margin", label: "Margin", levels: ["view", "edit"] },
      { key: "skuwise.col.Auto Margin", label: "Auto Margin", levels: ["view", "edit"] },
      { key: "skuwise.col.Auto %", label: "Auto %", levels: ["view", "edit"] },
      { key: "skuwise.col.Return Cost/Order", label: "Return Cost/Order", levels: ["view"] },
      { key: "skuwise.col.Packaging", label: "Packaging", levels: ["view", "edit"] },
      { key: "skuwise.col.Tax %", label: "Tax %", levels: ["view", "edit"] },
      { key: "skuwise.col.Promotion %", label: "Promotion %", levels: ["view", "edit"] },
      { key: "skuwise.col.Auto Settlement", label: "Auto Settlement", levels: ["view"] },
      { key: "skuwise.col.Manual Settlement", label: "Manual Settlement", levels: ["view", "edit"] },
      { key: "skuwise.col.Expected Settlement", label: "Expected Settlement", levels: ["view", "edit"] },
      { key: "skuwise.col.Suggested Settlement", label: "Suggested Settlement", levels: ["view"] },
      { key: "skuwise.col.Expected Profit", label: "Expected Profit", levels: ["view"] },
      { key: "skuwise.col.Suggested Profit", label: "Suggested Profit", levels: ["view"] },
      { key: "skuwise.col.Amazon Add Rs", label: "Amazon Add Rs", levels: ["view", "edit"] },
      { key: "skuwise.col.Max Step %", label: "Max Step %", levels: ["view", "edit"] },
      { key: "skuwise.col.Selling Price", label: "Selling Price", levels: ["view"] },
      { key: "skuwise.col.Suggested Price", label: "Suggested Price", levels: ["view"] },
      { key: "skuwise.col.Site Price", label: "Site Price", levels: ["view"] },
      { key: "skuwise.col.Ratings", label: "Ratings", levels: ["view"] },
      { key: "skuwise.col.Count", label: "Count", levels: ["view"] },
      { key: "skuwise.col.Count Target", label: "Count Target", levels: ["view", "edit"] },
      { key: "skuwise.col.Rating Target", label: "Rating Target", levels: ["view", "edit"] },
      { key: "skuwise.col.5\u2605 Needed", label: "5\u2605 Needed", levels: ["view"] },
      { key: "skuwise.col.Grouping", label: "Grouping", levels: ["view", "edit"] },
      { key: "skuwise.col.Group Rating", label: "Group Rating", levels: ["view"] },
      { key: "skuwise.col.Group Count", label: "Group Count", levels: ["view"] },
      { key: "skuwise.col.Seller", label: "Seller", levels: ["view"] },
      { key: "skuwise.col.Title", label: "Title", levels: ["view"] },
      { key: "skuwise.col.Images", label: "Images", levels: ["view"] },
      { key: "skuwise.col.Video", label: "Video", levels: ["view"] },
      { key: "skuwise.col.Variations", label: "Variations", levels: ["view"] },
      { key: "skuwise.col.Other Price", label: "Other Price", levels: ["view"] },
      { key: "skuwise.col.Other Seller", label: "Other Seller", levels: ["view"] },
      { key: "skuwise.col.Other Assured", label: "Other Assured", levels: ["view"] },
      { key: "skuwise.col.Our Price", label: "Our Price", levels: ["view"] },
      { key: "skuwise.col.Our Assured", label: "Our Assured", levels: ["view"] },
      { key: "skuwise.col.Suppressed", label: "Suppressed", levels: ["view"] },
      { key: "skuwise.col.Last updated", label: "Last updated", levels: ["view"] },
      { key: "skuwise.col.Link", label: "Link", levels: ["view"] },
      { key: "skuwise.col.Stop Selling", label: "Stop Selling", levels: ["view", "edit"] },
      { key: "skuwise.col.Peak 30d", label: "Peak 30d", levels: ["view"] },
      { key: "skuwise.col.Sold", label: "Sold", levels: ["view"] },
      { key: "skuwise.col.Units kept", label: "Units kept", levels: ["view"] },
      { key: "skuwise.col.Returns", label: "Returns", levels: ["view"] },
      { key: "skuwise.col.Return %", label: "Return %", levels: ["view"] },
      { key: "skuwise.col.RTO", label: "RTO", levels: ["view"] },
      { key: "skuwise.col.RTO %", label: "RTO %", levels: ["view"] },
      { key: "skuwise.col.Buyer returns", label: "Buyer returns", levels: ["view"] },
      { key: "skuwise.col.Buyer return %", label: "Buyer return %", levels: ["view"] },
      { key: "skuwise.col.Total revenue", label: "Total revenue", levels: ["view"] },
      { key: "skuwise.col.Courier total", label: "Courier total", levels: ["view"] },
      { key: "skuwise.col.Settlement", label: "Settlement", levels: ["view"] },
      { key: "skuwise.col.Return cost", label: "Return cost", levels: ["view"] },
      { key: "skuwise.col.Tax paid", label: "Tax paid", levels: ["view"] },
      { key: "skuwise.col.Packaging cost", label: "Packaging cost", levels: ["view"] },
      { key: "skuwise.col.Product cost", label: "Product cost", levels: ["view"] },
      { key: "skuwise.col.Net profit", label: "Net profit", levels: ["view"] },
      { key: "skuwise.col.Profit % rev", label: "Profit % rev", levels: ["view"] },
      { key: "skuwise.col.Profit % cost", label: "Profit % cost", levels: ["view"] },
      { key: "skuwise.col.Rev per order", label: "Rev per order", levels: ["view"] },
      { key: "skuwise.col.Courier per order", label: "Courier per order", levels: ["view"] },
      { key: "skuwise.col.Settled per order", label: "Settled per order", levels: ["view"] },
      { key: "skuwise.col.Last Settled Order", label: "Last Settled Order", levels: ["view"] },
      { key: "skuwise.col.Return per order", label: "Return per order", levels: ["view"] },
      { key: "skuwise.col.Last Return Order", label: "Last Return Order", levels: ["view"] },
      { key: "skuwise.col.Tax per order", label: "Tax per order", levels: ["view"] },
      { key: "skuwise.col.Pack per order", label: "Pack per order", levels: ["view"] },
      { key: "skuwise.col.Profit per order", label: "Profit per order", levels: ["view"] },
      { key: "skuwise.col.Focus", label: "Focus", levels: ["view"] },
      { key: "skuwise.col.Advertising", label: "Advertising", levels: ["view", "edit"] },
      { key: "skuwise.col.Priority", label: "Priority", levels: ["view", "edit"] },
      { key: "skuwise.col.Row Color", label: "Row Color", levels: ["view"] }
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
    // Exact key only — an option the owner never ticked is "none" (same rule as has_perm in the database)
    const perms = access.perms || {};
    return perms[key] || "";
  }
  function can(key, level) {
    if (!access) return false;
    if (access.is_owner) return true;
    // edit must be ticked on the exact item; a page-level setting only grants view (same rule as has_perm in the database)
    if (level === "edit") return (access.perms || {})[key] === "edit";
    const l = levelOf(key);
    return l === "view" || l === "edit";
  }
  // SKU-wise column permission: "edit" for owners; for employees the explicit
  // choice ("", "view", "edit") or null when the owner never set that column.
  function colPerm(col) {
    if (!access) return null;
    if (access.is_owner) return "edit";
    const p = access.perms || {}, k = "skuwise.col." + col;
    return Object.prototype.hasOwnProperty.call(p, k) ? (p[k] || "") : null;
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

  window.CA = { CATALOG, load, can, levelOf, anyOn, apply, who, colPerm, get access() { return access; }, ownerId: () => (access ? access.owner_id : null) };
})();
