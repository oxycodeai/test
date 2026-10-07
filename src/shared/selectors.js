// Flipkart DOM/JSON selectors — ek jagah central config (RISKS R3).
// Flipkart path badle to sirf yahan update karo.
//
// NOTE: JSON paths implementation ke waqt live page se VERIFY honge
// (docs/INTEGRATIONS.md B3). Content-pattern fallback class-rotation safe hai.

export const LOGIN = {
  phoneInput: 'input[type="tel"]',
  emailTabText: /email/i,
  otpInputSingle: 'input[maxlength="1"]',
  otpInputBox: 'input[inputmode="numeric"]',
  continueBtn: /^continue$/i,
  verifyBtn: /^(verify|submit)$/i,
  sendOtpBtn: /^(send otp|get otp|continue)$/i,
  loggedInMarker:
    '[data-testid="account-menu"], a[href*="/account"] img, #container img[src*="profile"]',
};

export const PRODUCT = {
  nextData: '#__NEXT_DATA__',
  jsonLd: 'script[type="application/ld+json"]',
  // __NEXT_DATA__ JSON paths (VERIFY at impl time)
  paths: {
    title: 'props.pageProps.initialState.product.title',
    price: 'props.pageProps.initialState.product.price.finalPrice',
    mrp: 'props.pageProps.initialState.product.price.mrp',
    offers: 'props.pageProps.initialState.product.offers',
  },
  fallbackPriceRegex: /₹\s?([\d,]+(?:\.\d{1,2})?)/,
  codText: /cash\s*on\s*delivery/i,
  buyNowText: /^(buy now|buy)$/i,
  // naye RN-web UI: sticky bottom CTA split-letter me render hota hai
  // ("B\\nu\\ny..."), role/name match nahi hota — no-space text se pakdo
  buyNowCompact: /^(buyat|buynow)/i,
  addToCartText: /add to cart/i,
  pincodeInput:
    'input[placeholder*="odeliver"] input, input[value*="Type"] , input[placeholder*="pin"]',
};

// Cart (viewcart, RN-web) — rules: real mouse clicks (locator.click / mouse.click),
// DOM el.click() FAIL; leaf queries me plain div include karo; DOM ready pe ~3.5s settle
// (transient stale render hota hai — precise element read, screenshot nahi).
export const CART = {
  viewcartUrl: 'https://www.flipkart.com/viewcart',
  readyText: /total amount/i,
  settleMs: 3500,
  // qty: real click Qty box → inline dropdown (plain divs 1,2,3,more)
  qtyText: /^Qty:\s*\d+$/i,
  qtyOption: (n) => new RegExp(`^${n}$`), // "3" tak direct; real click
  qtyMoreText: /^more$/i, // >3 → "Enter Quantity" dialog
  qtyInput: 'input[placeholder="Quantity"]',
  qtyApplyText: /^apply$/i, // dialog CTA (plain div, real click); Enter key KAAM NAHI
  removeText: /^remove$/i, // item container ke leaf child, scrollIntoView + real click
  // price gate: qty + offers ke BAAD final bill
  billText: /Total Amount\s*₹([\d,]+)/,
  saveBadgeText: /(\d+)% off applied/i, // qty-based offer (eg 5% off @ qty5)
  // address gate (PO grey→yellow): open sheet → saved address real click → revalidate poll
  addrOpenText: /enter delivery pincode/i, // fallback: /from saved addresses/i
  addrSheetText: /select delivery address/i,
  addrName: (name) => new RegExp(name, 'i'), // saved address row (user ke address.name se)
  poEnabledBg: 'rgb(255, 194, 0)', // yellow = click allowed
  poDisabledBg: 'rgb(184, 187, 191)', // grey = address select zaroori
  placeOrderText: /^place order$/i, // plain-div leaf; sirf yellow hone pe real click
  revalidateMs: 25000, // addr select ke baad PO yellow poll timeout
};

export const CHECKOUT = {
  addressRadio: /^deliver here$/i,
  codText: /cash on delivery/i,
  placeOrderBtn: /^(place order|pay)$/i,
  captchaImg: 'img[src*="captcha"], .captcha-img, [class*="captcha"] img',
};

// Simple deep-get: "a.b.c" path pe value nikalta hai
export function deepGet(obj, dottedPath) {
  return dottedPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// ₹ "1,29,999" → 129999
export function parsePrice(text) {
  if (text == null) return null;
  const m = String(text)
    .replace(/[^\d.,]/g, '')
    .match(/[\d,]+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}
