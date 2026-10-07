// Order checkout ke live steps — worker emit karta hai (order_step SSE),
// UI stepper yahi order dikhata hai. Single source of truth.
// Naya ordering model (Phase 2): cart flow — affiliate → cart → qty → price
// → address (cart gate) → checkout payment → captcha → place.
export const ORDER_STEPS = [
  { key: 'login', label: 'Login / OTP' },
  { key: 'affiliate', label: 'Affiliate redirect' },
  { key: 'cart', label: 'Cart + cleanup' },
  { key: 'qty', label: 'Qty set' },
  { key: 'price', label: 'Bill check' },
  { key: 'address', label: 'Address (cart)' },
  { key: 'payment', label: 'COD' },
  { key: 'captcha', label: 'CAPTCHA' },
  { key: 'place', label: 'Place Order' },
  { key: 'done', label: 'Placed ✓' },
];

export function stepIndex(step) {
  return ORDER_STEPS.findIndex((s) => s.key === step);
}

export function stepLabel(step) {
  return ORDER_STEPS.find((s) => s.key === step)?.label || step || '';
}

// Product fetch ke stages — products/fetch route emit karta hai (fetch_step SSE).
export const FETCH_STAGES = [
  { key: 'resolving', label: 'Affiliate link resolve ho raha hai…' },
  { key: 'loading', label: 'Product page load + parse ho raha hai…' },
];

export function fetchStageLabel(stage) {
  return FETCH_STAGES.find((s) => s.key === stage)?.label || '';
}
