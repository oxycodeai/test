// Product page → REAL data (title/image/price/MRP/offers/COD/stock).
// Layered: raw fetch (fast) → browser render (reliable fallback). R3 mitigation.
import { getBrowser } from '../../worker/platform.js';
import { PRODUCT, deepGet, parsePrice } from '../../shared/selectors.js';
import { config } from '../../shared/constants.js';
import { ffFetch, getProxyUrl } from './net.js';

const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36';

// Block wala honest error — proxy na set ho to fix ka hint bhi.
const blockMsg = () =>
  'Flipkart blocked/throttled this request — try again after a minute' +
  (getProxyUrl() ? '' : ' · Settings → Proxy lagao (IP block ka sure fix)');

// ── in-page extraction (browser path) ───────────────────────
// NOTE: real function pass karo page.evaluate ko (string expression evaluate hokar
// khud function ban jaata tha — undefined return hota tha). Ye fn self-contained hona chahiye.
function extractInPage() {
  const og = (p) => document.querySelector(`meta[property="${p}"]`)?.content || null;
  const out = {
    title: og('og:title') || document.title || null,
    image: og('og:image') || null,
    ld: null,
    next: null,
    strikeMrp: null,
    bigPrice: null,
    offers: [],
    bodyText: '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || location.href,
  };
  try {
    out.ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => {
        try {
          return JSON.parse(s.textContent);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    /* ignore */
  }
  try {
    const el = document.getElementById('__NEXT_DATA__');
    out.next = el ? JSON.parse(el.textContent) : null;
  } catch {
    /* ignore */
  }
  try {
    // style-based MRP (line-through) — class rotation safe
    const strikes = [...document.querySelectorAll('body *')].filter((el) => {
      if (el.children.length > 0) return false;
      const t = (el.textContent || '').trim();
      if (!/^₹\s?[\d,]+$/.test(t)) return false;
      const st = getComputedStyle(el);
      return (
        st.textDecorationLine.includes('line-through') || st.textDecoration.includes('line-through')
      );
    });
    out.strikeMrp = strikes[0]?.textContent?.trim() || null;
    // biggest ₹ number with large font = final price
    let best = null;
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || '').trim();
      if (!/^₹\s?[\d,]+$/.test(t)) continue;
      if (out.strikeMrp && t === out.strikeMrp) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (!best || fs > best.fs) best = { t, fs };
    }
    out.bigPrice = best?.t || null;
  } catch {
    /* ignore */
  }
  try {
    const seen = new Set();
    const KEY = /(\boff\b|cashback|coupon|bank|exchange|no cost emi|buy \d|save ₹|extra ₹)/i;
    for (const el of document.querySelectorAll(
      'li, .offer, [class*="offer"] span, [class*="Offer"] li'
    )) {
      const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
      if (!t || t.length > 140 || !KEY.test(t) || seen.has(t)) continue;
      if (!/₹|\d+%|\d+\b/.test(t)) continue;
      seen.add(t);
      out.offers.push(t);
      if (out.offers.length >= 6) break;
    }
  } catch {
    /* ignore */
  }
  try {
    out.bodyText = document.body.innerText.slice(0, 300000);
  } catch {
    /* ignore */
  }
  return out;
}

// ── raw-html extraction (fast path) ─────────────────────────
function extractFromHtml(html, url) {
  const ld = [];
  const ldRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html))) {
    try {
      ld.push(JSON.parse(m[1]));
    } catch {
      /* skip bad block */
    }
  }
  const og = (p) => {
    const re = new RegExp(
      `<meta[^>]*property=["']${p}["'][^>]*content=["']([^"']*)["']|<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${p}["']`,
      'i'
    );
    const r = html.match(re);
    return r ? r[1] || r[2] : null;
  };
  return normalize({
    title: og('og:title'),
    image: og('og:image'),
    ld,
    next: null,
    strikeMrp: null,
    bigPrice: null,
    offers: [],
    bodyText: html.replace(/<[^>]+>/g, ' ').slice(0, 300000),
    canonical: url,
  });
}

// Flipkart CDN image URLs me {/@width}/{/@height} jaise template placeholders aate hain
// (rukminim2.flixcart.com/image/{@width}/{@height}/...) — inhe real size se bhar do.
function sanitizeImageUrl(u) {
  if (!u) return null;
  let s = String(u).trim();
  if (s.startsWith('//')) s = `https:${s}`;
  s = s
    .replace(/\{@?width\}/gi, '400')
    .replace(/\{@?height\}/gi, '400')
    .replace(/\{@?w\}/gi, '400')
    .replace(/\{@?h\}/gi, '400');
  if (/\{|\}/.test(s)) return null; // abhi bhi template hai → render nahi hoga
  try {
    const p = new URL(s);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
    return s;
  } catch {
    return null;
  }
}

// "{TITLE} - Price in India…" jaise unsubstituted templates ko real title nahi maana
const isTemplateText = (t) => /\{\s*(title|name|product)\s*\}/i.test(String(t || ''));
const cleanTitle = (t) => (isTemplateText(t) ? null : t || null);

// Fallback: URL ke product-slug se title banao
// (/himalaya-neem-face-wash/p/itm… → "Himalaya Neem Face Wash")
function titleFromUrl(u) {
  try {
    const p = new URL(String(u));
    const segs = p.pathname.split('/').filter(Boolean);
    const i = segs.indexOf('p');
    if (i <= 0) return null;
    const words = segs[i - 1].replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!words || words.length < 4) return null;
    return words
      .split(' ')
      .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ');
  } catch {
    return null;
  }
}

// ── normalize → product shape ───────────────────────────────
function flatten(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => flatten(n, out));
    return out;
  }
  out.push(node);
  if (node['@graph']) flatten(node['@graph'], out);
  Object.values(node).forEach((v) => {
    if (v && typeof v === 'object') flatten(v, out);
  });
  return out;
}

// junk/block page pe bodyText se absurd number aa sakta hai (5.6e56) — kabhi price nahi
const sane = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e7 ? n : null);

export function normalize(raw) {
  const nodes = flatten(raw.ld || []);
  const prod =
    nodes.find((n) => n['@type'] === 'Product' && (n.offers || n.name)) ||
    nodes.find((n) => n['@type'] === 'Product') ||
    null;

  const offersLd = prod?.offers ? (Array.isArray(prod.offers) ? prod.offers : [prod.offers]) : [];
  const ldPrice = parsePrice(offersLd[0]?.price ?? offersLd[0]?.lowPrice ?? null);

  // __NEXT_DATA__ paths (verified later — undefined fine, layered fallback)
  const nextPrice = parsePrice(deepGet(raw.next, PRODUCT.paths.price));
  const nextMrp = parsePrice(deepGet(raw.next, PRODUCT.paths.mrp));

  const price = sane(ldPrice ?? nextPrice ?? parsePrice(raw.bigPrice) ?? parsePrice(raw.bodyText));
  const mrp = sane(nextMrp ?? parsePrice(raw.strikeMrp));
  const availability = String(offersLd[0]?.availability || '');
  const inStock = availability
    ? /instock/i.test(availability)
    : !/currently out of stock|out of stock/i.test(raw.bodyText || '');

  const offerSet = [];
  const seen = new Set();
  const push = (t) => {
    const s = String(t || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (s && !seen.has(s)) {
      seen.add(s);
      offerSet.push(s);
    }
  };
  (raw.offers || []).forEach(push);
  // content-pattern offers from page text (real lines, class-rotation safe)
  for (const line of (raw.bodyText || '').split('\n')) {
    const t = line.trim();
    if (t.length < 8 || t.length > 140) continue;
    if (
      /(₹\s?[\d,]+|\d+%)\s*(off|cashback)|coupon|bank offer|no cost emi|exchange bonus/i.test(t)
    ) {
      push(t);
    }
    if (offerSet.length >= 6) break;
  }

  const discount_pct =
    mrp && price && mrp > price ? Math.round(((mrp - price) / mrp) * 1000) / 10 : null;

  return {
    title:
      cleanTitle(prod?.name) || cleanTitle(raw.title) || titleFromUrl(raw.canonical),
    image:
      sanitizeImageUrl(Array.isArray(prod?.image) ? prod.image[0] : prod?.image) ||
      sanitizeImageUrl(raw.image),
    mrp,
    price,
    special_price: price,
    discount_pct,
    in_stock: inStock ? 1 : 0,
    cod_product: PRODUCT.codText.test(raw.bodyText || '') ? 1 : 0,
    offers: offerSet.slice(0, 6),
    source_url: raw.canonical,
  };
}

// Flipkart load-shed / interstitial page (rate-limit) — isko product samajhna nahi
const BLOCKED_RE =
  /looks like all of india|hang in there, the offers|retry in \d+|access denied|request blocked/i;

function looksBlocked(text) {
  return BLOCKED_RE.test(String(text || '').slice(0, 50000));
}

// Throttle pe Flipkart homepage (ya error shell) serve karta hai — status 500/200
// dono, URL bhi /p/ hi rehta hai. Title se pakadte hain.
const HOMEPAGE_RE = /Online Shopping India Mobile, Cameras, Lifestyle/i;
const isProductUrl = (u) => /\/p\//.test(String(u || ''));

// Junk = blocked/interstitial/homepage/empty/template-title — real product page nahi
function isJunkPage(raw, finalUrl) {
  if (!raw) return true;
  if (looksBlocked(raw.bodyText)) return true;
  if (HOMEPAGE_RE.test(raw.title || '')) return true;
  if (!isProductUrl(finalUrl)) return true;
  if (isTemplateText(raw.title) && !raw.next) return true;
  return !raw.title && !raw.next;
}

// ── public API ──────────────────────────────────────────────
export async function fetchProductPage(url) {
  // 1) fast raw fetch
  try {
    const res = await ffFetch(url, {
      headers: { 'user-agent': UA, 'accept-language': 'en-IN,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const html = await res.text();
      if (!looksBlocked(html) && isProductUrl(res.url)) {
        const data = extractFromHtml(html, res.url); // final URL — slug/canonical sahi mile
        if (data.price && data.title && !HOMEPAGE_RE.test(data.title)) {
          return { ...data, method: 'fetch' };
        }
      }
    }
  } catch {
    /* fall through to browser */
  }

  // 2) browser render (Akamai-proof) — blocked page pe backoff retry
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-IN' });
  const page = await ctx.newPage();
  try {
    let raw = null;
    let data = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500); // SSR JSON settle
      raw = (await page.evaluate(extractInPage)) || null;
      data = raw ? normalize(raw) : null;
      // junk/block/interstitial + bina price/__NEXT_DATA__ ke = product page nahi
      if (!data || isJunkPage(raw, page.url()) || (data.price == null && !raw.next)) {
        if (attempt < 3) {
          await page.waitForTimeout(3000 * attempt); // backoff
          continue;
        }
        const e = new Error(blockMsg());
        e.status = 429;
        throw e;
      }
      break;
    }
    return { ...data, method: 'browser' };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export function isFlipkartUrl(u) {
  try {
    const p = new URL(u);
    return /(^|\.)flipkart\.com$/i.test(p.hostname);
  } catch {
    return false;
  }
}

// ── affiliate platform detect + redirect resolver ──────────────
// Koi bhi valid http(s) link chalega (Cuelinks/admitad/fkrt/app-link/…):
// resolve karke Flipkart product par land hona chahiye. Sirf invalid URL reject.
export function detectPlatform(u) {
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
    const h = p.hostname.toLowerCase();
    if (/(^|\.)flipkart\.com$/.test(h)) return 'flipkart';
    if (/(^|\.)(cashkaro\.com|cashkaro\.in|ckr\.me)$/.test(h)) return 'cashkaro';
    if (/(^|\.)(earnkaro\.com|earnkaro\.in)$/.test(h)) return 'earnkaro';
    if (/(^|\.)(fkrt\.it|flipkart\.app\.link)$/.test(h)) return 'fkrt';
    return 'affiliate'; // koi bhi aur link — hop-follow karke dekhenge
  } catch {
    return null;
  }
}

export function isSupportedAffiliateUrl(u) {
  return detectPlatform(u) !== null;
}

/**
 * Affiliate/short link → final Flipkart product URL.
 * - Direct flipkart product link → no-op.
 * - CashKaro/EarnKaro/fkrt/app-link/koi bhi network link → HTTP hops (≤10)
 *   → zarurat pade to Playwright (JS/meta redirect) → flipkart /p/ land karna chahiye.
 * Returns { platform, affiliateUrl, url } — affiliateUrl = user ki original link
 * (checkout me wahi use hoti hai, attribution bachi rahe).
 */
// redirector params (dl/url/dest/…) me seedha flipkart /p/ link ho toh
const REDIR_PARAM = /^(dl|url|dest|target|u|link|redirect|redirect_url|goto|out|next)$/i;
function pickFlipkartProductParam(rawUrl) {
  try {
    const p = new URL(String(rawUrl));
    for (const [k, v] of p.searchParams) {
      if (!REDIR_PARAM.test(k)) continue;
      let val = v;
      try {
        val = decodeURIComponent(v);
      } catch {
        /* pehle se decoded */
      }
      if (isFlipkartUrl(val) && isProductUrl(val)) return val;
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

export async function resolveAffiliateUrl(u) {
  const platform = detectPlatform(u);
  if (!platform) {
    const e = new Error('Valid http(s) product link required');
    e.status = 400;
    throw e;
  }
  if (platform === 'flipkart') {
    if (!isProductUrl(u)) {
      const e = new Error(
        'Product page ka link chahiye (jisme /p/ ho) — search/home link nahi, product kholo aur wahi URL copy karo'
      );
      e.status = 400;
      throw e;
    }
    return { platform, affiliateUrl: null, url: u };
  }

  let cur = u;
  for (let hop = 0; hop < 10; hop++) {
    let res;
    try {
      res = await ffFetch(cur, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': UA, 'accept-language': 'en-IN,en;q=0.9' },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      break;
    }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      cur = new URL(loc, cur).toString();
      if (isProductUrl(cur)) break;
      continue;
    }
    break; // 200 / no location — meta/JS redirect ho sakta hai
  }

  // JS/meta redirect → browser fallback (HAMESHA jab tak /p/ na mile —
  // unknown redirectors (fktr.in → trackingv3.linkredirect.in) bhi JS se
  // aage forward karte hain, HTTP Location ke bina)
  if (!isProductUrl(cur)) {
    try {
      const browser = await getBrowser();
      const ctx = await browser.newContext({ userAgent: UA, locale: 'en-IN' });
      const page = await ctx.newPage();
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // flipkart /p/ land hone tak wait (fixed sleep se reliable)
      await page
        .waitForURL((url) => isFlipkartUrl(url.href) && isProductUrl(url.href), {
          timeout: 15000,
        })
        .catch(() => {});
      cur = page.url();
      await ctx.close().catch(() => {});
    } catch {
      /* jo mila wo rakho */
    }
  }

  // last resort: param (dl/url/…) me seedha flipkart /p/ link
  if (!isProductUrl(cur)) {
    const p = pickFlipkartProductParam(cur) || pickFlipkartProductParam(u);
    if (p) cur = p;
  }

  if (!isProductUrl(cur) || !isFlipkartUrl(cur)) {
    const landed = String(cur).slice(0, 160);
    const e = new Error(
      'Ye link kisi Flipkart product page par land nahi hua — network ka login-wala affiliate link ya seedha flipkart product link paste karo (landed: ' +
        landed +
        ')'
    );
    e.status = 422;
    throw e;
  }
  return { platform, affiliateUrl: u, url: cur };
}

/**
 * Session ke saath product page → real personalized price (quote step).
 * Har account ka price alag ho sakta hai (Flipkart logged-in pricing).
 */
export async function fetchProductWithSession(storageState, url) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ storageState, userAgent: UA, locale: 'en-IN' });
  const page = await ctx.newPage();
  try {
    let raw = null;
    let data = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
      raw = (await page.evaluate(extractInPage)) || null;
      data = raw ? normalize(raw) : null;
      if (!data || isJunkPage(raw, page.url()) || (data.price == null && !raw.next)) {
        if (attempt < 3) {
          await page.waitForTimeout(3000 * attempt);
          continue;
        }
        const e = new Error(blockMsg());
        e.status = 429;
        throw e;
      }
      break;
    }
    return data;
  } finally {
    await ctx.close().catch(() => {});
  }
}

export const fetchTimeoutMs = config.nodeEnv === 'development' ? 45000 : 35000;
