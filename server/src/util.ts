/** Returns up to `count` items chosen uniformly at random, without bias. */
export function sample<T>(pool: readonly T[], count: number): T[] {
  // Fisher–Yates over a copy: unbiased, unlike Array.sort with a random
  // comparator (which is non-uniform and engine-dependent).
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

/** Normalizes one-line user text and limits Unicode code points, not UTF-16 units. */
export function sanitizeUserText(raw: unknown, maxCodePoints: number): string {
  if (typeof raw !== "string") return "";
  const normalized = raw
    .normalize("NFC")
    // Strip control and formatting characters, including bidi overrides.
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(normalized).slice(0, maxCodePoints).join("");
}

/** Strictly limits protocol identifiers to their ASCII representation. */
export function safeIdentifier(raw: unknown, maxLength: number): string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]+$/.test(raw)
    ? raw.slice(0, maxLength)
    : "";
}
