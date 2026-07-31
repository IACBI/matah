import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BoundedRateLimiter,
  BoundedWindowRateLimiter,
  TokenBucket,
} from '../../server/src/rateLimiter.ts';
import { safeIdentifier, sanitizeUserText } from '../../server/src/util.ts';

test('sanitizeUserText normalizes Unicode, strips controls, and counts code points', () => {
  assert.equal(sanitizeUserText('  Cafe\u0301\u202e\n  test  ', 9), 'Café test');
  assert.equal(sanitizeUserText('😀😀😀', 2), '😀😀');
  assert.equal(sanitizeUserText(42, 10), '');
});

test('safeIdentifier rejects punctuation instead of partially accepting it', () => {
  assert.equal(safeIdentifier('valid_ID-7', 32), 'valid_ID-7');
  assert.equal(safeIdentifier('../room', 32), '');
  assert.equal(safeIdentifier(null, 32), '');
});

test('TokenBucket enforces capacity and refills over time', () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    const bucket = new TokenBucket(2, 1);
    assert.equal(bucket.take(), true);
    assert.equal(bucket.take(), true);
    assert.equal(bucket.take(), false);
    now += 1_000;
    assert.equal(bucket.take(), true);
  } finally {
    Date.now = originalNow;
  }
});

test('BoundedRateLimiter evicts old keys without growing unbounded', () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    const limiter = new BoundedRateLimiter(1, 0, 2, 500);
    assert.equal(limiter.take('a'), true);
    assert.equal(limiter.take('a'), false);
    assert.equal(limiter.take('b'), true);
    assert.equal(limiter.take('c'), true);
    assert.equal(limiter.take('a'), true, 'oldest key should have been evicted');
    now += 1_000;
    assert.equal(limiter.take('fresh'), true);
  } finally {
    Date.now = originalNow;
  }
});

test('BoundedWindowRateLimiter enforces an exact limit and resets at the window', () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    const limiter = new BoundedWindowRateLimiter(2, 10_000, 10);
    assert.equal(limiter.take('ip'), true);
    assert.equal(limiter.take('ip'), true);
    assert.equal(limiter.take('ip'), false);
    now += 9_999;
    assert.equal(limiter.take('ip'), false);
    now += 1;
    assert.equal(limiter.take('ip'), true);
  } finally {
    Date.now = originalNow;
  }
});
