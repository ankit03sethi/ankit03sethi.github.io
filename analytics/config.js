/* ---------------------------------------------------------------
 * cursive Analytics - site configuration
 * ------------------------------------------------------------- */
window.SITE_CONFIG = {
  // Apps Script web app URL (deployed from your Google Sheet).
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbyf3idQypXbdftkUCj6y1W1jaZiZYTcnv5PoiFycwbh2PL7Ppl8MN_GCGLAdErEdHY/exec",

  // Display name for the signed-in seller in the top bar.
  // Header name from the sheet, or null to show the ID.
  displayNameColumn: null,

  // Which column holds the platform (Amazon, Firstcry, etc.).
  // Accepts a column letter ("E") or a header name ("Platform").
  // If null, the site auto-detects by header name containing
  // platform/marketplace/channel/site.
  platformColumn: null,

  // Which column holds the Product ID (was called SKU).
  // Accepts a letter or header name. Auto-detected from headers
  // containing sku/product id/asin/ean/product code/item code if null.
  productIdColumn: null,

  // Columns to hide from the table. Password is already stripped server-side.
  hiddenColumns: [],

  // Session persistence: "session" | "local" | "none"
  sessionMode: "session"
};
