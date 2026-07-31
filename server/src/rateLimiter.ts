/**
 * Tiny per-socket token bucket. Prevents a single connection from flooding
 * the server with events. Refills continuously up to `capacity`.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private capacity: number,
    private refillPerSec: number
  ) {
    this.tokens = capacity;
    this.last = Date.now();
  }

  /** Returns true if an action is allowed (and consumes a token). */
  take(cost = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.last) / 1000) * this.refillPerSec
    );
    this.last = now;
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }
}

/**
 * A bounded collection of token buckets for IP-, room-, or account-scoped
 * limits. Old entries expire and the oldest entry is evicted at capacity.
 */
export class BoundedRateLimiter {
  private entries = new Map<string, { bucket: TokenBucket; lastSeen: number }>();

  constructor(
    private capacity: number,
    private refillPerSec: number,
    private maxEntries: number,
    private ttlMs: number
  ) {}

  take(key: string, cost = 1): boolean {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry) {
      this.prune(now);
      if (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next().value as string | undefined;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      entry = {
        bucket: new TokenBucket(this.capacity, this.refillPerSec),
        lastSeen: now,
      };
      this.entries.set(key, entry);
    } else {
      // Refresh insertion order so bounded eviction approximates LRU.
      this.entries.delete(key);
      entry.lastSeen = now;
      this.entries.set(key, entry);
    }
    return entry.bucket.take(cost);
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.lastSeen <= this.ttlMs) break;
      this.entries.delete(key);
    }
  }
}

/** Fixed-window limiter for policy limits expressed as N actions per window. */
export class BoundedWindowRateLimiter {
  private entries = new Map<
    string,
    { count: number; windowStartedAt: number; lastSeen: number }
  >();

  constructor(
    private limit: number,
    private windowMs: number,
    private maxEntries: number,
    private ttlMs = windowMs * 2,
  ) {}

  take(key: string): boolean {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry || now - entry.windowStartedAt >= this.windowMs) {
      if (entry) this.entries.delete(key);
      this.prune(now);
      if (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next().value as string | undefined;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      entry = { count: 0, windowStartedAt: now, lastSeen: now };
    } else {
      this.entries.delete(key);
      entry.lastSeen = now;
    }
    this.entries.set(key, entry);
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.lastSeen <= this.ttlMs) break;
      this.entries.delete(key);
    }
  }
}
