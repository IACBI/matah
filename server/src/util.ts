import { createHash, timingSafeEqual } from "node:crypto";

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

/**
 * The address a request really came from, behind `hops` trusted proxies.
 *
 * Each trusted proxy appends the address it received the connection from, so
 * the client is `hops` entries from the right; anything further left was
 * written by the client itself and is never believed. With no trusted proxy
 * the header is ignored altogether. An empty entry falls back to the socket
 * address rather than becoming a key a client can choose.
 */
export function forwardedClient(
  header: string | string[] | undefined,
  hops: number,
  socketAddress: string | undefined
): string {
  const fallback = socketAddress ?? "unknown";
  if (hops <= 0 || typeof header !== "string") return fallback;
  const entries = header.split(",");
  return entries[Math.max(0, entries.length - hops)].trim() || fallback;
}

/** SHA-256 of a secret, the form `bearerMatches` compares against. */
export function digestSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Whether an `Authorization` header carries the bearer token behind `expected`.
 * Both sides are hashed to one length first, so the comparison neither throws
 * on a length mismatch nor reveals how much of the token was right.
 */
export function bearerMatches(header: string | undefined, expected: Buffer): boolean {
  const match = /^Bearer (\S+)$/.exec(header ?? "");
  return match !== null && timingSafeEqual(digestSecret(match[1]), expected);
}

/** Strictly limits protocol identifiers to their ASCII representation. */
export function safeIdentifier(raw: unknown, maxLength: number): string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]+$/.test(raw)
    ? raw.slice(0, maxLength)
    : "";
}
