// URL-gate live test: login -> fetch ke 3 cases (invalid / fkrt hop / search link)
const BASE = 'http://localhost:3001';
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pin: '4747' }),
});
const { token } = await login.json();

const post = async (url) => {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/products/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => ({}));
  return { s: res.status, ms: Date.now() - t0, d: data };
};

let r = await post('not a url');
console.log('invalid      ->', r.s, r.d.error?.message);

r = await post('https://www.flipkart.com/search?q=phone');
console.log('search link  ->', r.s, r.d.error?.message);

r = await post('https://evil.com/x');
console.log('evil.com     ->', r.s, r.d.error?.message);

// real-ish fkrt short link — hop resolve (network, max ~60s)
r = await post('https://fkrt.it/sQzT4vR');
console.log('fkrt hop     ->', r.s, `${(r.ms / 1000).toFixed(1)}s`, JSON.stringify(r.d).slice(0, 220));
