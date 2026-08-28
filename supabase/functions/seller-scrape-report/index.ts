// seller-scrape-report v1 — the Cursive Analyst desktop app posting back the raw
// HTML it fetched. All extraction happens here, exactly as in PD Tracker's
// pdworker-report: the client parses nothing, so a selector fix is a function
// deploy rather than an app release.
//
// The parsers below are PD Tracker's, unchanged. Only the tables differ:
// seller_listing_jobs / seller_listing_stats / seller_listing_snapshots instead
// of pdworker_jobs / analytics_products / analytics_snapshots.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

interface ParseResult { price?: number | null; rating?: number | null; review_count?: number | null; in_stock?: boolean | null; title?: string | null; seller?: string | null; anti_bot?: boolean; resolved_url?: string | null; multi_product?: boolean; not_found?: boolean; }
function hostOf(u: string): string { try { return new URL(u).hostname; } catch { return ""; } }
function platformFrom(url: string): string {
  const h = hostOf(url).toLowerCase();
  if (h.includes("amazon"))   return "amazon";
  if (h.includes("flipkart")) return "flipkart";
  if (h.includes("meesho"))   return "meesho";
  if (h.includes("myntra"))   return "myntra";
  if (h.includes("firstcry")) return "firstcry";
  return "other";
}

function extractInjectedSeller(html: string): string | null {
  const m = html.match(/<script[^>]+type=["']application\/x-cursive-scrape["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { const obj = JSON.parse(m[1]); return (obj && (obj.seller || obj.apiSeller)) ? String(obj.seller || obj.apiSeller).slice(0, 200) : null; }
  catch { return null; }
}

function isAmazonAntiBot(html: string): boolean {
  if (html.length < 20000 && (/captcha/i.test(html) || /Enter the characters you see below/i.test(html) ||
    /Sorry, we just need to make sure/i.test(html) || /api-services-support@amazon\.com/i.test(html))) return true;
  return false;
}

function extractFromAggregateRating(html: string): { rating: number | null; review_count: number | null } {
  const block = html.match(/"[Aa]ggregate[Rr]ating"\s*:\s*\{([^}]+)\}/);
  if (!block) return { rating: null, review_count: null };
  const inner = block[1];
  const rv = inner.match(/"ratingValue"\s*:\s*"?([\d.]+)"?/i);
  const rating = rv ? Math.round(Number(rv[1]) * 10) / 10 : null;
  const rcCount = inner.match(/"ratingCount"\s*:\s*"?(\d+)"?/i);
  const rvCount = inner.match(/"reviewCount"\s*:\s*"?(\d+)"?/i);
  let review_count: number | null = null;
  if (rcCount)      review_count = Number(rcCount[1]);
  else if (rvCount) review_count = Number(rvCount[1]);
  return { rating, review_count };
}

function parseAmazon(html: string): ParseResult {
  if (isAmazonAntiBot(html)) return { price: null, anti_bot: true };
  let price: number | null = null;
  const cvp = html.match(/customerVisiblePrice[^"']*["'][^>]*value=["']([\d.]+)["']/i);
  if (cvp) { const n = Number(cvp[1]); if (n > 0) price = n; }
  const t = html.match(/id=["']productTitle["'][^>]*>([^<]+)</i);
  const title = t ? t[1].trim() : null;
  let rating: number | null = null;
  const rMain = html.match(/id=["']acrPopover["'][^>]*title=["']([\d.]+)\s*out of 5 stars["']/i);
  if (rMain) rating = Number(rMain[1]);
  let review_count: number | null = null;
  const rc1 = html.match(/id=["']acrCustomerReviewText["'][^>]*aria-label=["']([\d,]+)\s*[Rr]atings?["']/i);
  const rc2 = html.match(/id=["']acrCustomerReviewText["'][^>]*aria-label=["']([\d,]+)\s*[Rr]eviews?["']/i);
  const rc3 = html.match(/id=["']acrCustomerReviewText["'][^>]*>\(?([\d,]+)\)?</);
  const rcMatch = rc1 || rc2 || rc3;
  if (rcMatch) review_count = Number(rcMatch[1].replace(/,/g, ""));
  const sm = html.match(/id=["']sellerProfileTriggerId["'][^>]*>([^<]+)</i);
  const seller = sm ? sm[1].trim() : null;
  if (price === null && /Looking for something\?|Page Not Found|404/i.test(html) && html.length < 100000) {
    return { price: null, not_found: true };
  }
  return { price, title, rating, review_count, seller, in_stock: price !== null };
}

function parseFlipkart(url: string, html: string): ParseResult {
  const isShortcut = /\/product\/p\/itme\?pid=/i.test(url);
  const pidMatch = url.match(/[?&]pid=([A-Z0-9]+)/);
  const pid = pidMatch ? pidMatch[1] : null;
  if (isShortcut && pid) {
    const itmMatch = html.match(/itm[a-f0-9]{10,20}/);
    if (itmMatch) return { price: null, resolved_url: `https://www.flipkart.com/x/p/${itmMatch[0]}?pid=${pid}` };
    return { price: null, not_found: true };
  }
  let price: number | null = null;
  const p1 = html.match(/"price"\s*:\s*(\d+(?:\.\d+)?)\s*,\s*"priceCurrency"\s*:\s*"INR"/);
  if (p1) price = Number(p1[1]);
  const t = html.match(/<title>([^<]+)<\/title>/i);
  const title = t ? t[1].replace(/\s*\|\s*Flipkart\.com.*$/i, "").trim() : null;
  const { rating, review_count } = extractFromAggregateRating(html);
  if (price === null && (/Flipkart\.com\s*<\/title>/i.test(html) || /Sorry! We couldn/i.test(html))) {
    return { price: null, not_found: true };
  }
  return { price, title, rating, review_count, in_stock: price !== null };
}

function parseMeesho(url: string, html: string): ParseResult {
  const qMatch = url.match(/[?&]q=(\d+)/);
  if (!qMatch) return { price: null };
  const productId = Number(qMatch[1]);
  const targetCode = productId.toString(36);
  const linkRe = /href=["'](\/(?!search)[a-z0-9\-]{3,200}\/p\/([a-z0-9]{4,15}))["']/gi;
  const uniqueCodes = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) { uniqueCodes.add(m[2]); if (uniqueCodes.size > 30) break; }
  const hasExactMatch = uniqueCodes.has(targetCode);
  if (!hasExactMatch) {
    if (uniqueCodes.size === 0) return { price: null, not_found: true };
    return { price: null, multi_product: true };
  }
  const cardRe = new RegExp(`href=["']\\/[a-z0-9\\-]{3,200}\\/p\\/${targetCode}["'][\\s\\S]{0,10000}?(?=<a\\s+href=["']\\/|$)`, "i");
  const cardMatch = html.match(cardRe);
  const card = cardMatch ? cardMatch[0] : null;
  let price: number | null = null;
  let rating: number | null = null;
  let review_count: number | null = null;
  const src = card || html;
  const p1 = src.match(/₹\s*([\d,]+)/); if (p1) price = Number(p1[1].replace(/,/g, ""));
  const r1 = src.match(/>\s*(\d\.\d)\s*</); if (r1) rating = Number(r1[1]);
  const rc = src.match(/([\d,]+)\s*(?:Reviews?|Ratings?)/); if (rc) review_count = Number(rc[1].replace(/,/g, ""));
  const t = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  const title = t ? t[1].replace(/\s*-\s*Meesho.*$/i, "").trim() : null;
  return { price, title, rating, review_count, in_stock: price !== null };
}

function parseMyntra(html: string): ParseResult {
  let price: number | null = null;
  const disc = html.match(/"discountedPrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/i);
  if (disc) price = Number(disc[1]);
  if (price === null) { const sp = html.match(/"sellingPrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/i); if (sp) price = Number(sp[1]); }
  if (price === null) { const jl = html.match(/"@type"\s*:\s*"Offer"[^}]*"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/); if (jl) price = Number(jl[1]); }
  if (price === null) { const all = Array.from(html.matchAll(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/g)).map(m => Number(m[1])).filter(n => n > 10); if (all.length > 0) price = Math.min(...all); }
  const t = html.match(/<title>([^<]+)<\/title>/i);
  const title = t ? t[1].replace(/\s*\|\s*Myntra.*$/i, "").trim() : null;
  let rating: number | null = null;
  let review_count: number | null = null;
  const avgM = html.match(/"averageRating"\s*:\s*(\d+(?:\.\d+)?)/); if (avgM) rating = Math.round(Number(avgM[1]) * 10) / 10;
  const totalM = html.match(/"totalCount"\s*:\s*(\d+)/); if (totalM) review_count = Number(totalM[1]);
  if (rating === null || review_count === null) {
    const jsonld = extractFromAggregateRating(html);
    if (rating === null) rating = jsonld.rating;
    if (review_count === null) review_count = jsonld.review_count;
  }
  return { price, title, rating, review_count, in_stock: price !== null };
}

function parseFirstCry(html: string): ParseResult {
  let price: number | null = null;
  const p1 = html.match(/"price"\s*:\s*"([\d.]+)"\s*,\s*"priceValidUntil"/); if (p1) price = Number(p1[1]);
  if (price === null) { const p2 = html.match(/"@type"\s*:\s*"Offer"[^}]*"price"\s*:\s*"?([\d.]+)"?/); if (p2) price = Number(p2[1]); }
  if (price === null) { const p3 = html.match(/"price"\s*:\s*"?([\d.]+)"?\s*,\s*"priceCurrency"\s*:\s*"INR"/); if (p3) price = Number(p3[1]); }
  if (price === null) { const p5 = html.match(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([\d.]+)["']/i); if (p5) price = Number(p5[1]); }
  const t = html.match(/<title>([^<]+)<\/title>/i);
  const title = t ? t[1].replace(/\s*-\s*FirstCry.*$/i, "").trim() : null;
  let rating: number | null = null;
  let review_count: number | null = null;
  const rMatch = html.match(/class=["']rate["']\s*>([\d.]+)</i); if (rMatch) rating = Number(rMatch[1]);
  const cMatch = html.match(/class=["']ratingcount[^"']*["']\s*>([\d,]+)</i); if (cMatch) review_count = Number(cMatch[1].replace(/,/g, ""));
  if (rating === null || review_count === null) {
    const jsonld = extractFromAggregateRating(html);
    if (rating === null) rating = jsonld.rating;
    if (review_count === null) review_count = jsonld.review_count;
  }
  return { price, title, rating, review_count, in_stock: price !== null };
}

function parse(url: string, html: string): ParseResult {
  const p = platformFrom(url);
  let result: ParseResult;
  if (p === "amazon")        result = parseAmazon(html);
  else if (p === "flipkart") result = parseFlipkart(url, html);
  else if (p === "meesho")   result = parseMeesho(url, html);
  else if (p === "myntra")   result = parseMyntra(html);
  else if (p === "firstcry") result = parseFirstCry(html);
  else                       result = { price: null };
  if (!result.seller) {
    const injected = extractInjectedSeller(html);
    if (injected) result.seller = injected;
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return j({ ok: false, error: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const jobId = body.job_id;
    const html = String(body.html || "");
    const finalUrl = String(body.final_url || "");
    const tookMs = Number(body.took_ms || 0);
    const err = body.error ? String(body.error) : null;

    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data: job } = await admin.from("seller_listing_jobs").select("id, url, stat_id, user_id").eq("id", jobId).maybeSingle();
    if (!job) return j({ ok: false, error: "unknown job" }, 404);

    await admin.from("seller_worker_heartbeats").upsert({
      user_id: job.user_id, last_ping_at: new Date().toISOString(),
      app_version: "analyst-report", platform_os: "windows",
    }, { onConflict: "user_id" });

    if (err) {
      await admin.from("seller_listing_jobs").update({ status: "failed", error: err.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", jobId);
      return j({ ok: true, parsed: false });
    }

    const statId = job.stat_id;
    const userId = job.user_id;
    const parseUrl = (finalUrl && finalUrl.length > 0) ? finalUrl : job.url;
    const parsed = parse(parseUrl, html);

    // Flipkart's /product/p/itme?pid= shortcut is a redirect stub: it carries the
    // real item path but no price. Store the resolved URL and queue that instead.
    if (parsed.resolved_url && statId) {
      await admin.from("seller_listing_stats").update({ resolved_url: parsed.resolved_url }).eq("id", statId);
      await admin.from("seller_listing_jobs").insert({ user_id: userId, stat_id: statId, url: parsed.resolved_url, wait_ms: 6000, priority: 250, status: "pending" });
      await admin.from("seller_listing_jobs").update({ status: "done", finished_at: new Date().toISOString(), final_url: finalUrl || null, took_ms: tookMs || null, html_bytes: html.length }).eq("id", jobId);
      return j({ ok: true, resolved: true, new_url: parsed.resolved_url });
    }

    let checkStatus: string;
    if (parsed.anti_bot) checkStatus = "amazon_captcha";
    else if (parsed.multi_product) checkStatus = "multi_product";
    else if (parsed.not_found) checkStatus = "not_found";
    else if (parsed.price !== null && parsed.price !== undefined) checkStatus = "ok";
    else checkStatus = "parse_failed";

    await admin.from("seller_listing_jobs").update({ status: "done", finished_at: new Date().toISOString(), final_url: finalUrl || null, took_ms: tookMs || null, html_bytes: html.length }).eq("id", jobId);

    const priceInt  = (parsed.price !== null && parsed.price !== undefined) ? Math.round(Number(parsed.price)) : null;
    const rcInt     = (parsed.review_count !== null && parsed.review_count !== undefined) ? Math.round(Number(parsed.review_count)) : null;
    const ratingNum = (parsed.rating !== null && parsed.rating !== undefined) ? Math.round(Number(parsed.rating) * 10) / 10 : null;
    const sellerVal = parsed.seller ?? null;

    // Snapshot only when something actually changed since the last one, and at
    // least once a day for chart continuity — PD Tracker's rule, which keeps the
    // history table from filling up with identical rows.
    let snapshotInserted = false;
    let skippedDup = false;
    if (statId && checkStatus === "ok") {
      const { data: prevArr } = await admin.from("seller_listing_snapshots")
        .select("price, rating, review_count, seller, fetched_at")
        .eq("stat_id", statId).order("fetched_at", { ascending: false }).limit(1);
      const prev = prevArr && prevArr[0];
      const same = prev
        && prev.price === priceInt
        && Number(prev.rating) === ratingNum
        && prev.review_count === rcInt
        && (prev.seller || null) === sellerVal;
      const prevDay = prev ? new Date(prev.fetched_at).toISOString().slice(0, 10) : null;
      const today   = new Date().toISOString().slice(0, 10);
      if (same && prevDay === today) {
        skippedDup = true;
      } else {
        const ins = await admin.from("seller_listing_snapshots").insert({
          stat_id: statId, user_id: userId,
          price: priceInt, rating: ratingNum, review_count: rcInt,
          seller: sellerVal, source: "analyst", fetched_at: new Date().toISOString(),
        });
        if (!ins.error) snapshotInserted = true;
      }
    }

    if (statId) {
      const patch: Record<string, unknown> = {
        last_checked_at: new Date().toISOString(),
        last_check_status: checkStatus,
      };
      // Only overwrite the known-good values on a good scrape. A captcha or a
      // parse failure must not wipe yesterday's price off the SKU table.
      if (checkStatus === "ok") {
        patch.last_scraped_at   = new Date().toISOString();
        patch.last_price        = priceInt;
        patch.last_rating       = ratingNum;
        patch.last_review_count = rcInt;
        patch.last_seller       = sellerVal;
        patch.last_title        = parsed.title ?? null;
        patch.last_in_stock     = parsed.in_stock ?? null;
      }
      await admin.from("seller_listing_stats").update(patch).eq("id", statId);
    }

    return j({ ok: true, parsed: true, status: checkStatus, price: parsed.price, rating: parsed.rating, review_count: parsed.review_count, seller: parsed.seller, stat_id: statId, snapshot_inserted: snapshotInserted, skipped_dup: skippedDup });
  } catch (e) {
    return j({ ok: false, error: (e as Error).message }, 500);
  }
});
