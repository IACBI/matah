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
