import { test } from 'node:test';
import assert from 'node:assert/strict';

const { assertLoginRate, setPendingOtp, takePendingOtp } = await import(
  '../src/worker/otp-store.js'
);

test('rate limiter: 10 allowed, 11th → 429 noRetry', () => {
  for (let i = 0; i < 10; i++) assertLoginRate(); // 10 within window
  assert.throws(
    () => assertLoginRate(),
    (e) => e.status === 429 && e.noRetry === true && /rate limit/i.test(e.message)
  );
});

test('pending OTP: set + consume-once', () => {
  setPendingOtp(1, '482913');
  assert.equal(takePendingOtp(1), '482913');
  assert.equal(takePendingOtp(1), null, 'doosri baar nahi milna chahiye');
  assert.equal(takePendingOtp(999), null, 'unset account → null');
});
