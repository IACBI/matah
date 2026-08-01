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

/** A controllable stand-in for the limiters' monotonic clock. */
function fakeClock(start = 1_000) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms) => { now += ms; };
  return clock;
}

test('TokenBucket enforces capacity and refills over time', () => {
  const clock = fakeClock();
  const bucket = new TokenBucket(2, 1, clock);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false);
  clock.advance(1_000);
  assert.equal(bucket.take(), true);
});

test('TokenBucket survives a backwards clock step without locking out', () => {
  const clock = fakeClock();
  const bucket = new TokenBucket(2, 1, clock);
  assert.equal(bucket.take(), true);
  // A monotonic source never goes backwards, but assert the arithmetic is safe
  // anyway: elapsed time must never subtract from the bucket.
  clock.advance(-5_000);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false);
});

test('BoundedRateLimiter evicts old keys without growing unbounded', () => {
  const clock = fakeClock();
  const limiter = new BoundedRateLimiter(1, 0, 2, 500, clock);
  assert.equal(limiter.take('a'), true);
  assert.equal(limiter.take('a'), false);
  assert.equal(limiter.take('b'), true);
  assert.equal(limiter.take('c'), true);
  assert.equal(limiter.take('a'), true, 'oldest key should have been evicted');
  clock.advance(1_000);
  assert.equal(limiter.take('fresh'), true);
});

test('BoundedWindowRateLimiter enforces an exact limit and resets at the window', () => {
  const clock = fakeClock();
  const limiter = new BoundedWindowRateLimiter(2, 10_000, 10, 20_000, clock);
  assert.equal(limiter.take('ip'), true);
  assert.equal(limiter.take('ip'), true);
  assert.equal(limiter.take('ip'), false);
  clock.advance(9_999);
  assert.equal(limiter.take('ip'), false);
  clock.advance(1);
  assert.equal(limiter.take('ip'), true);
});
