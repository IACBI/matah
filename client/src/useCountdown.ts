import { useEffect, useMemo, useState } from "react";
import type { RoomState } from "../../shared/src/index";

/** Derives a smooth countdown from a server deadline without per-second broadcasts. */
export function useCountdown(state: RoomState | null): number | null {
  const phaseEndsAt = state?.phaseEndsAt ?? null;
  const serverNow = state?.serverNow;
  const clockOffset = useMemo(
    () => (serverNow === undefined ? 0 : serverNow - Date.now()),
    [serverNow]
  );
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (phaseEndsAt === null) {
      setSeconds(null);
      return;
    }

    const update = () => {
      const serverNow = Date.now() + clockOffset;
      setSeconds(Math.max(0, Math.ceil((phaseEndsAt - serverNow) / 1_000)));
    };
    update();
    const handle = window.setInterval(update, 250);
    return () => window.clearInterval(handle);
  }, [phaseEndsAt, clockOffset]);

  return seconds;
}
