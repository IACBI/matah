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
