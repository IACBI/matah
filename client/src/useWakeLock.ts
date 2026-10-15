import { useEffect } from "react";

/**
 * Keeps the screen on while `active`. The host view is a TV or laptop that
 * nobody touches mid-game, so the display would otherwise sleep during a long
 * answering phase. Unsupported browsers, a denied request (low battery, hidden
 * tab) and a lock the browser drops on tab switch are all non-events: the
 * lock is simply requested again when the page becomes visible.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (sentinel && !sentinel.released) return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release().catch(() => undefined);
        else sentinel = next;
      } catch {
        // Refused: the screen may sleep, which is the status quo.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
