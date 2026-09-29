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

/**
 * Pick `count` items, preferring ones not in `excluded`.
 *
 * Content pools are finite, so once the fresh items run out this falls back to
 * the whole pool rather than returning fewer items than asked for.
 */
export function sampleAvoiding<T>(
  pool: readonly T[],
  count: number,
  excluded: ReadonlySet<string>,
  keyOf: (item: T) => string
): T[] {
  const fresh = pool.filter((item) => !excluded.has(keyOf(item)));
  const candidates =
    fresh.length >= count
      ? fresh
      : [...fresh, ...pool.filter((item) => excluded.has(keyOf(item)))];
  return sample(candidates, count);
}

const JOINABLE = String.raw`[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}]`;

/**
 * Every control and format character (bidi overrides, zero-width spaces, tag
 * characters) except a joiner sitting between two characters it can join.
 * ZWJ holds an emoji sequence (a family, a rainbow flag) together and ZWNJ is
 * part of how Persian and some Indic words are spelled, so dropping them
 * rewrites what people typed. A joiner with nothing to join would only make an
 * invisible name.
 */
const INVISIBLE = new RegExp(
  String.raw`((?<=${JOINABLE})[\u200C\u200D](?=${JOINABLE}))|[\p{Cc}\p{Cf}]`,
  "gu"
);

/** Normalizes one-line user text and limits Unicode code points, not UTF-16 units. */
export function sanitizeUserText(raw: unknown, maxCodePoints: number): string {
  if (typeof raw !== "string") return "";
  const normalized = raw
    .normalize("NFC")
    .replace(INVISIBLE, (_match, joiner?: string) => joiner ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  // Cutting a sequence short can strand a joiner that used to have a neighbour.
  return Array.from(normalized)
    .slice(0, maxCodePoints)
    .join("")
    .replace(/[\u200C\u200D]+$/u, "");
}

/** Strictly limits protocol identifiers to their ASCII representation. */
export function safeIdentifier(raw: unknown, maxLength: number): string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]+$/.test(raw)
    ? raw.slice(0, maxLength)
    : "";
}
