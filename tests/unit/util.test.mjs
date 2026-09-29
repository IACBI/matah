import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BoundedRateLimiter,
  BoundedWindowRateLimiter,
  TokenBucket,
} from '../../server/src/rateLimiter.ts';
import {
  bearerMatches,
  digestSecret,
  forwardedClient,
  safeIdentifier,
  sanitizeUserText,
} from '../../server/src/util.ts';

test('sanitizeUserText normalizes Unicode, strips controls, and counts code points', () => {
  assert.equal(sanitizeUserText('  Cafe\u0301\u202e\n  test  ', 9), 'Café test');
  assert.equal(sanitizeUserText('😀😀😀', 2), '😀😀');
  assert.equal(sanitizeUserText(42, 10), '');
});

test('sanitizeUserText keeps the joiners that emoji sequences and Persian/Indic words need', () => {
  const sequences = {
    'woman technologist': '\u{1F469}\u200D\u{1F4BB}',
    'with a skin tone': '\u{1F469}\u{1F3FD}\u200D\u{1F4BB}',
    'rainbow flag': '\u{1F3F3}️\u200D\u{1F308}',
    'heart on fire': '❤️\u200D\u{1F525}',
    'family of four': '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}',
    'Persian half-space (ZWNJ)': 'می\u200Cخواهم',
    'Devanagari conjunct (ZWJ)': 'र्\u200Dय',
  };
  for (const [label, text] of Object.entries(sequences)) {
    assert.equal(sanitizeUserText(text, 16), text, `${label} was rewritten`);
  }
});

test('sanitizeUserText still removes invisible and directional characters', () => {
  assert.equal(sanitizeUserText('Al\u200Bi', 16), 'Ali', 'zero-width space');
  assert.equal(sanitizeUserText('a\u2060b', 16), 'ab', 'word joiner');
  assert.equal(sanitizeUserText('\uFEFFab', 16), 'ab', 'byte order mark');
  assert.equal(sanitizeUserText('a\u00ADb', 16), 'ab', 'soft hyphen');
  assert.equal(sanitizeUserText('a\u202Eb', 16), 'ab', 'bidi override');
  assert.equal(sanitizeUserText('a\u2066b\u2069', 16), 'ab', 'bidi isolates');
  assert.equal(
    sanitizeUserText('\u{1F3F4}\u{E0067}\u{E0062}\u{E007F}', 16),
    '\u{1F3F4}',
    'tag characters'
  );
});

test('sanitizeUserText drops a joiner that has nothing to join', () => {
  // Left in, these would make a name that is blank on screen yet not empty.
  assert.equal(sanitizeUserText('\u200D\u200C\u200D', 16), '');
  assert.equal(sanitizeUserText('\u200Dab', 16), 'ab', 'leading');
  assert.equal(sanitizeUserText('ab\u200D', 16), 'ab', 'trailing');
  assert.equal(sanitizeUserText('a \u200D b', 16), 'a b', 'beside spaces');
  assert.equal(sanitizeUserText('a\u200D\u200Db', 16), 'ab', 'doubled');
  assert.equal(sanitizeUserText('a\u200B\u200Db', 16), 'ab', 'behind another invisible');
});

test('sanitizeUserText leaves no stranded joiner when it cuts a sequence short', () => {
  // Five code points: man, joiner, woman, joiner, girl.
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  assert.equal(sanitizeUserText(family, 5), family);
  assert.equal(sanitizeUserText(family, 4), '\u{1F468}\u200D\u{1F469}', 'cut right after a joiner');
  assert.equal(sanitizeUserText(family, 3), '\u{1F468}\u200D\u{1F469}');
  assert.equal(sanitizeUserText(family, 2), '\u{1F468}', 'cut right after the first joiner');
  const once = sanitizeUserText(`ab${family}`, 5);
  assert.equal(sanitizeUserText(once, 5), once, 'sanitizing twice must change nothing');
});

test('forwardedClient counts trusted proxies from the right', () => {
  const header = 'forged, 203.0.113.9, 10.0.0.1';
  assert.equal(forwardedClient(header, 1, '127.0.0.1'), '10.0.0.1');
  assert.equal(forwardedClient(header, 2, '127.0.0.1'), '203.0.113.9');
  assert.equal(forwardedClient(header, 3, '127.0.0.1'), 'forged');
  assert.equal(forwardedClient(header, 9, '127.0.0.1'), 'forged', 'a short header is not over-read');
});

test('forwardedClient ignores the header when no proxy is trusted or none was sent', () => {
  assert.equal(forwardedClient('198.51.100.1', 0, '127.0.0.1'), '127.0.0.1');
  assert.equal(forwardedClient(undefined, 1, '127.0.0.1'), '127.0.0.1');
  assert.equal(forwardedClient(['a', 'b'], 1, '127.0.0.1'), '127.0.0.1', 'repeated headers are not parsed');
  assert.equal(forwardedClient(undefined, 1, undefined), 'unknown');
});

test('forwardedClient never lets an empty entry become the identity', () => {
  assert.equal(forwardedClient('203.0.113.9,', 1, '127.0.0.1'), '127.0.0.1');
  assert.equal(forwardedClient(' , ', 1, '127.0.0.1'), '127.0.0.1');
  assert.equal(forwardedClient('  203.0.113.9  ', 1, '127.0.0.1'), '203.0.113.9');
});

test('bearerMatches accepts exactly the configured token and nothing near it', () => {
  const expected = digestSecret('a-long-enough-secret-token');
  assert.equal(bearerMatches('Bearer a-long-enough-secret-token', expected), true);
  assert.equal(bearerMatches('Bearer a-long-enough-secret-toke', expected), false, 'a prefix');
  assert.equal(bearerMatches('Bearer a-long-enough-secret-tokenn', expected), false, 'longer');
  assert.equal(bearerMatches('bearer a-long-enough-secret-token', expected), false, 'scheme is case-sensitive');
  assert.equal(bearerMatches('Bearer  a-long-enough-secret-token', expected), false, 'extra space');
  assert.equal(bearerMatches('a-long-enough-secret-token', expected), false, 'no scheme');
  assert.equal(bearerMatches('', expected), false);
  assert.equal(bearerMatches(undefined, expected), false);
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
