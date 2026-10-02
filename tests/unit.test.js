import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, isFlipkartUrl } from '../src/server/services/pageFetch.js';
import { validIdentifier } from '../src/server/routes/accounts.js';
import { parsePrice, deepGet } from '../src/shared/selectors.js';

test('parsePrice handles ₹ formats', () => {
  assert.equal(parsePrice('₹1,29,999'), 129999);
  assert.equal(parsePrice('₹1,099.50'), 1100);
  assert.equal(parsePrice('Rs. 499'), 499);
  assert.equal(parsePrice(null), null);
  assert.equal(parsePrice('no numbers'), null);
});

test('deepGet walks paths safely', () => {
  const o = { a: { b: { c: 42 } } };
  assert.equal(deepGet(o, 'a.b.c'), 42);
  assert.equal(deepGet(o, 'x.y.z'), undefined);
});

test('isFlipkartUrl validation', () => {
  assert.ok(isFlipkartUrl('https://www.flipkart.com/apple-iphone-15/p/itm'));
  assert.ok(isFlipkartUrl('https://flipkart.com/x'));
  assert.ok(!isFlipkartUrl('https://evil.com/flipkart.com'));
  assert.ok(!isFlipkartUrl('not a url'));
});

test('normalize: JSON-LD product data', () => {
  const out = normalize({
    title: 'Fallback title',
    image: 'http://img/fb.jpg',
    ld: [
      {
        '@type': 'Product',
        name: 'Test Phone',
        image: 'http://img/1.jpg',
        offers: {
          price: '19999',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
      },
    ],
    next: null,
    strikeMrp: '₹24,999',
    bigPrice: '₹19,999',
    offers: ['Bank Offer: 10% off'],
    bodyText: 'Cash on Delivery available\nSave ₹500 on exchange',
    canonical: 'https://www.flipkart.com/x',
  });
  assert.equal(out.title, 'Test Phone');
  assert.equal(out.price, 19999);
  assert.equal(out.mrp, 24999);
  assert.equal(out.in_stock, 1);
  assert.equal(out.cod_product, 1);
  assert.equal(out.discount_pct, 20);
  assert.ok(out.offers.length >= 1);
  assert.ok(out.offers.some((o) => /Bank Offer/.test(o)));
});

test('normalize: out of stock + no COD', () => {
  const out = normalize({
    title: 'T',
    image: null,
    ld: [],
    next: null,
    strikeMrp: null,
    bigPrice: '₹999',
    offers: [],
    bodyText: 'Currently out of stock',
    canonical: 'u',
  });
  assert.equal(out.price, 999);
  assert.equal(out.in_stock, 0);
  assert.equal(out.cod_product, 0);
});

test('validIdentifier: phone/email only', () => {
  assert.ok(validIdentifier('9812345678'));
  assert.ok(validIdentifier('+919812345678'));
  assert.ok(validIdentifier('shop@mail.com'));
  assert.ok(!validIdentifier('bad'));
  assert.ok(!validIdentifier('123'));
  assert.ok(!validIdentifier(''));
  assert.ok(!validIdentifier(null));
});
