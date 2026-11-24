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
      // one row per report card (reports/index.html REPORTS ids) + the Pricing section
      { key: "reports.r.notinfile", label: "Orders · Orders not in Order file", levels: ["view"] },
      { key: "reports.r.notincsv",  label: "Orders · Orders not in CSV", levels: ["view"] },
      { key: "reports.r.unpaid",    label: "Payments · Payment not received", levels: ["view"] },
      { key: "reports.r.belowexp",  label: "Payments · Receiving less than Expected", levels: ["view"] },
      { key: "reports.r.paid",      label: "Payments · Orders paid successfully", levels: ["view"] },
      { key: "reports.r.retlost",   label: "Returns · Returned, goods never arrived", levels: ["view"] },
      { key: "reports.r.missing",   label: "Missings · Missing data (Master SKU file, inventory files, A07)", levels: ["view"] },
      { key: "reports.r.skunocop",  label: "Missings · Selling with no cost price", levels: ["view"] },
      { key: "reports.r.nocop",     label: "Missings · Cost price not available", levels: ["view"] },
      { key: "reports.pricing",     label: "Pricing · Price update file", levels: ["view"] },
    ]},
    // Every column of the SKU-wise page (SKU Master view), one by one. A column left
    // blank (nothing ticked) follows the rules above, exactly as before: visible with
    // SKU Master view, financial ones only with Financial data. Ticking None / View /
    // Edit overrides that for the column. Edit is offered only on typed columns.
    // Keep in step with SKU_COLS in skuwisedata/index.html (a column missing here
    // simply keeps the default rule).
    { page: "skuwise_cols", label: "SKU-wise data · SKU Master columns", inherit: true, items: [
      { key: "skuwise.col.S.NO", label: "A \u00b7 S.NO", levels: ["view"] },
      { key: "skuwise.col.Date", label: "B \u00b7 Date", levels: ["view"] },
      { key: "skuwise.col.Listed By", label: "C \u00b7 Listed By", levels: ["view"] },
      { key: "skuwise.col.Company", label: "D \u00b7 Company", levels: ["view"] },
      { key: "skuwise.col.Platform", label: "E \u00b7 Platform", levels: ["view"] },
      { key: "skuwise.col.Platform Seller", label: "F \u00b7 Platform Seller", levels: ["view"] },
      { key: "skuwise.col.Brand", label: "G \u00b7 Brand", levels: ["view"] },
      { key: "skuwise.col.Vertical", label: "H \u00b7 Vertical", levels: ["view"] },
      { key: "skuwise.col.Return Type", label: "I \u00b7 Return Type", levels: ["view"] },
      { key: "skuwise.col.Type", label: "J \u00b7 Type", levels: ["view"] },
      { key: "skuwise.col.Category", label: "K \u00b7 Category", levels: ["view"] },
      { key: "skuwise.col.Sub Category", label: "L \u00b7 Sub Category", levels: ["view"] },
      { key: "skuwise.col.Others", label: "M \u00b7 Others", levels: ["view", "edit"] },
      { key: "skuwise.col.Product", label: "N \u00b7 Product", levels: ["view"] },
      { key: "skuwise.col.Color", label: "O \u00b7 Color", levels: ["view"] },
      { key: "skuwise.col.Mapped", label: "P \u00b7 Mapped", levels: ["view"] },
      { key: "skuwise.col.Parent/Child", label: "Q \u00b7 Parent/Child", levels: ["view"] },
      { key: "skuwise.col.MOQ", label: "R \u00b7 MOQ", levels: ["view", "edit"] },
      { key: "skuwise.col.MOQ AP", label: "S \u00b7 MOQ AP", levels: ["view"] },
      { key: "skuwise.col.Variation", label: "T \u00b7 Variation", levels: ["view", "edit"] },
      { key: "skuwise.col.ASIN", label: "U \u00b7 ASIN", levels: ["view"] },
      { key: "skuwise.col.Other Listing Id", label: "V \u00b7 Other Listing Id", levels: ["view"] },
      { key: "skuwise.col.SKU", label: "W \u00b7 SKU", levels: ["view"] },
      { key: "skuwise.col.Master Sku", label: "X \u00b7 Master Sku", levels: ["view"] },
      { key: "skuwise.col.W Qty", label: "Y \u00b7 Warehouse Stock Status (W Qty)", levels: ["view"] },
      { key: "skuwise.col.P Qty", label: "Z \u00b7 Platform Status (P Qty)", levels: ["view"] },
      { key: "skuwise.col.Qty", label: "AA \u00b7 Qty", levels: ["view"] },
      { key: "skuwise.col.COP", label: "AB \u00b7 COP", levels: ["view"] },
      { key: "skuwise.col.HSN", label: "AC \u00b7 HSN", levels: ["view"] },
      { key: "skuwise.col.Margin", label: "AD \u00b7 Margin", levels: ["view", "edit"] },
      { key: "skuwise.col.Auto Margin", label: "AE \u00b7 Auto Margin", levels: ["view", "edit"] },
      { key: "skuwise.col.Auto %", label: "AF \u00b7 Auto %", levels: ["view", "edit"] },
      { key: "skuwise.col.Return Cost/Order", label: "AG \u00b7 Return Cost/Order", levels: ["view"] },
      { key: "skuwise.col.Packaging", label: "AH \u00b7 Packaging", levels: ["view", "edit"] },
      { key: "skuwise.col.Tax %", label: "AI \u00b7 Tax %", levels: ["view", "edit"] },
      { key: "skuwise.col.Promotion %", label: "AJ \u00b7 Promotion %", levels: ["view", "edit"] },
      { key: "skuwise.col.Auto Settlement", label: "AK \u00b7 Auto Settlement", levels: ["view"] },
      { key: "skuwise.col.Manual Settlement", label: "AL \u00b7 Manual Settlement", levels: ["view", "edit"] },
      { key: "skuwise.col.Expected Settlement", label: "AM \u00b7 Expected Settlement", levels: ["view", "edit"] },
      { key: "skuwise.col.Suggested Settlement", label: "AN \u00b7 Suggested Settlement", levels: ["view"] },
      { key: "skuwise.col.Expected Profit", label: "AO \u00b7 Expected Profit", levels: ["view"] },
      { key: "skuwise.col.Suggested Profit", label: "AP \u00b7 Suggested Profit", levels: ["view"] },
      { key: "skuwise.col.Amazon Add Rs", label: "AQ \u00b7 Courier Add On (Amazon Add Rs)", levels: ["view", "edit"] },
      { key: "skuwise.col.Max Step %", label: "AR \u00b7 Max Step %", levels: ["view", "edit"] },
      { key: "skuwise.col.Selling Price", label: "AS \u00b7 Selling Price", levels: ["view"] },
      { key: "skuwise.col.Suggested Price", label: "AT \u00b7 Suggested Price", levels: ["view"] },
      { key: "skuwise.col.Site Price", label: "AU \u00b7 Site Price", levels: ["view"] },
      { key: "skuwise.col.Ratings", label: "AV \u00b7 Ratings", levels: ["view"] },
      { key: "skuwise.col.Count", label: "AW \u00b7 Count", levels: ["view"] },
      { key: "skuwise.col.Count Target", label: "AX \u00b7 Count Target", levels: ["view", "edit"] },
      { key: "skuwise.col.Rating Target", label: "AY \u00b7 Rating Target", levels: ["view", "edit"] },
      { key: "skuwise.col.5\u2605 Needed", label: "AZ \u00b7 5\u2605 Needed", levels: ["view"] },
      { key: "skuwise.col.Grouping", label: "BA \u00b7 Grouping", levels: ["view", "edit"] },
      { key: "skuwise.col.Group Rating", label: "BB \u00b7 Group Rating", levels: ["view"] },
      { key: "skuwise.col.Group Count", label: "BC \u00b7 Group Count", levels: ["view"] },
      { key: "skuwise.col.Seller", label: "BD \u00b7 Seller", levels: ["view"] },
      { key: "skuwise.col.Title", label: "BE \u00b7 Title", levels: ["view"] },
      { key: "skuwise.col.Images", label: "BF \u00b7 Images", levels: ["view"] },
      { key: "skuwise.col.Video", label: "BG \u00b7 Video", levels: ["view"] },
      { key: "skuwise.col.Variations", label: "BH \u00b7 Variations", levels: ["view"] },
      { key: "skuwise.col.Other Price", label: "BI \u00b7 Other Price", levels: ["view"] },
      { key: "skuwise.col.Other Seller", label: "BJ \u00b7 Other Seller", levels: ["view"] },
      { key: "skuwise.col.Other Assured", label: "BK \u00b7 Other Assured", levels: ["view"] },
      { key: "skuwise.col.Our Price", label: "BL \u00b7 Our Price", levels: ["view"] },
      { key: "skuwise.col.Our Assured", label: "BM \u00b7 Our Assured", levels: ["view"] },
      { key: "skuwise.col.Suppressed", label: "BN \u00b7 Suppressed", levels: ["view"] },
      { key: "skuwise.col.Last updated", label: "BO \u00b7 Last updated", levels: ["view"] },
      { key: "skuwise.col.Link", label: "BP \u00b7 Link", levels: ["view"] },
      { key: "skuwise.col.Stop Selling", label: "BQ \u00b7 Stop Selling", levels: ["view", "edit"] },
      { key: "skuwise.col.Peak 30d", label: "BR \u00b7 Peak 30d", levels: ["view"] },
      { key: "skuwise.col.Sold", label: "BS \u00b7 Sold", levels: ["view"] },
      { key: "skuwise.col.Units kept", label: "BT \u00b7 Units kept", levels: ["view"] },
      { key: "skuwise.col.Returns", label: "BU \u00b7 Returns", levels: ["view"] },
      { key: "skuwise.col.Return %", label: "BV \u00b7 Return %", levels: ["view"] },
      { key: "skuwise.col.RTO", label: "BW \u00b7 RTO", levels: ["view"] },
      { key: "skuwise.col.RTO %", label: "BX \u00b7 RTO %", levels: ["view"] },
      { key: "skuwise.col.Buyer returns", label: "BY \u00b7 Buyer returns", levels: ["view"] },
      { key: "skuwise.col.Buyer return %", label: "BZ \u00b7 Buyer return %", levels: ["view"] },
      { key: "skuwise.col.Total revenue", label: "CA \u00b7 Total revenue", levels: ["view"] },
      { key: "skuwise.col.Courier total", label: "CB \u00b7 Courier total", levels: ["view"] },
      { key: "skuwise.col.Settlement", label: "CC \u00b7 Settlement", levels: ["view"] },
      { key: "skuwise.col.Return cost", label: "CD \u00b7 Return cost", levels: ["view"] },
      { key: "skuwise.col.Tax paid", label: "CE \u00b7 Tax paid", levels: ["view"] },
      { key: "skuwise.col.Packaging cost", label: "CF \u00b7 Packaging cost", levels: ["view"] },
      { key: "skuwise.col.Product cost", label: "CG \u00b7 Product cost", levels: ["view"] },
      { key: "skuwise.col.Net profit", label: "CH \u00b7 Net profit", levels: ["view"] },
      { key: "skuwise.col.Profit % rev", label: "CI \u00b7 Profit % rev", levels: ["view"] },
      { key: "skuwise.col.Profit % cost", label: "CJ \u00b7 Profit % cost", levels: ["view"] },
      { key: "skuwise.col.Rev per order", label: "CK \u00b7 Rev per order", levels: ["view"] },
      { key: "skuwise.col.Courier per order", label: "CL \u00b7 Courier per order", levels: ["view"] },
      { key: "skuwise.col.Settled per order", label: "CM \u00b7 Settled per order", levels: ["view"] },
      { key: "skuwise.col.Last Settled Order", label: "CN \u00b7 Last Settled Order", levels: ["view"] },
      { key: "skuwise.col.Return per order", label: "CO \u00b7 Return per order", levels: ["view"] },
      { key: "skuwise.col.Last Return Order", label: "CP \u00b7 Last Return Order", levels: ["view"] },
      { key: "skuwise.col.Tax per order", label: "CQ \u00b7 Tax per order", levels: ["view"] },
      { key: "skuwise.col.Pack per order", label: "CR \u00b7 Pack per order", levels: ["view"] },
      { key: "skuwise.col.Profit per order", label: "CS \u00b7 Profit per order", levels: ["view"] },
      { key: "skuwise.col.Focus", label: "CT \u00b7 Focus", levels: ["view"] },
      { key: "skuwise.col.Advertising", label: "CU \u00b7 Advertising", levels: ["view", "edit"] },
      { key: "skuwise.col.Priority", label: "CV \u00b7 Ad Sets (Priority)", levels: ["view", "edit"] },
      { key: "skuwise.col.Row Color", label: "CW \u00b7 Row Color", levels: ["view"] }
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
  // Any SKU Master column the employee may see? (opens the SKU Master tab / page)
  function anyCol() {
    if (!access) return false;
    if (access.is_owner) return true;
    const p = access.perms || {};
    if (Object.keys(p).some(k => k.startsWith("skuwise.col.") && (p[k] === "view" || p[k] === "edit"))) return true;
    return p["skuwise.sku_master"] === "view" || p["skuwise.sku_master"] === "edit";   // employees saved before 2026-11-24
  }
  // Does the employee have any access at all on a page?
  function anyOn(page) {
    if (!access) return false;
    if (access.is_owner) return true;
    // SKU-wise page: opens when any SKU Master column is View / Edit
    if (page === "skuwise") return anyCol();
    const g = CATALOG.find(x => x.page === page);
    if (!g) return can(page, "view");
    if (g.items.some(it => can(it.key, "view"))) return true;
    if (page === "skuwise" && anyCol()) return true;
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

  window.CA = { CATALOG, load, can, levelOf, anyOn, apply, who, colPerm, anyCol, get access() { return access; }, ownerId: () => (access ? access.owner_id : null) };
})();
