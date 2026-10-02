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
  addToCartText: /add to cart/i,
  pincodeInput:
    'input[placeholder*="odeliver"] input, input[value*="Type"] , input[placeholder*="pin"]',
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
