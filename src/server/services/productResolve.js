import { getDb } from '../../db/index.js';
import { now } from '../../shared/constants.js';
import { fetchProductPage, isSupportedAffiliateUrl, resolveAffiliateUrl } from './pageFetch.js';
import { convertLink, isConfigured } from '../integrations/cuelinks.js';
import { sendEvent } from '../routes/stream.js';

const CACHE_MS = 15 * 60 * 1000;

export function productShape(row) {
  return {
    ...row,
    offers: row.offers_json ? JSON.parse(row.offers_json) : [],
    offers_json: undefined,
    age_min: Math.max(0, Math.round((now() - row.fetched_at) / 60000)),
  };
}

/**
 * URL → product row (cache <15 min). Fetch route aur booking-create (url mode,
 * "fetch ke bina Start") dono isi ko call karte hain.
 * Fail pe HTTP-ish plain object throw: { status, code, message }.
 */
export async function resolveProduct(urlRaw) {
  const url = String(urlRaw || '').trim();
  if (!url || !isSupportedAffiliateUrl(url)) {
    throw {
      status: 400,
      code: 'invalid_url',
      message: 'Valid http(s) link do — Flipkart / CashKaro / EarnKaro / koi bhi affiliate link chalega',
    };
  }
  const db = getDb();

  sendEvent('fetch_step', { stage: 'resolving' });
  const resolved = await resolveAffiliateUrl(url);
  const canonical = resolved.url;

  const cached = db
    .prepare('SELECT * FROM products WHERE url = ? ORDER BY fetched_at DESC LIMIT 1')
    .get(canonical);
  if (cached && now() - cached.fetched_at < CACHE_MS) {
    const affUrl = resolved.affiliateUrl || cached.affiliate_url;
    const aff = affUrl
      ? { url: affUrl, mode: resolved.platform || cached.platform || 'flipkart', native: true, converted: false }
      : await convertLink(cached.url);
    return {
      row: cached,
      cached: true,
      affiliate: { ...aff, configured: isConfigured() },
      method: null,
    };
  }

  const aff = resolved.affiliateUrl
    ? { url: resolved.affiliateUrl, mode: resolved.platform, native: true, converted: false }
    : await convertLink(canonical);

  sendEvent('fetch_step', { stage: 'loading' });
  const data = await fetchProductPage(canonical);
  if (!data.title && !data.price) {
    throw {
      status: 502,
      code: 'fetch_failed',
      message: 'Could not extract product data (page changed or blocked)',
    };
  }

  const info = db
    .prepare(
      `INSERT INTO products (url, platform, affiliate_url, pid, title, image, mrp, price, special_price, discount_pct,
                             in_stock, cod_product, offers_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      canonical,
      resolved.platform,
      resolved.affiliateUrl,
      new URL(canonical).searchParams.get('pid'),
      data.title,
      data.image,
      data.mrp,
      data.price,
      data.special_price,
      data.discount_pct,
      data.in_stock,
      data.cod_product,
      JSON.stringify(data.offers || []),
      now()
    );
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  sendEvent('product_fetched', { id: row.id, title: row.title });
  return { row, cached: false, affiliate: { ...aff, configured: isConfigured() }, method: data.method };
}
