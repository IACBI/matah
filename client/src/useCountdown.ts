import { useEffect, useRef, useState } from "react";
import type { RoomState } from "../../shared/src/index";

const TICK_MS = 250;
/** Only re-sync the clock when the drift is larger than a tick is worth. */
const DRIFT_TOLERANCE_MS = 1_000;

/** Derives a smooth countdown from a server deadline without per-second broadcasts. */
export function useCountdown(state: RoomState | null): number | null {
  const phaseEndsAt = state?.phaseEndsAt ?? null;
  const serverNow = state?.serverNow;
  const [seconds, setSeconds] = useState<number | null>(null);
  // Refs, not a memo: serverNow changes on every broadcast, and deriving the
  // offset through the dependency array tore down and rebuilt the interval
  // each time — during quiplash voting that is once per vote cast.
  const offset = useRef(0);
  const lastSample = useRef<number | undefined>(undefined);

  // Only a *new* sample says anything about the offset. Re-measuring against
  // an old one just reads back however much wall time has passed since.
  if (serverNow !== undefined && serverNow !== lastSample.current) {
    lastSample.current = serverNow;
    const measured = serverNow - Date.now();
    if (Math.abs(measured - offset.current) > DRIFT_TOLERANCE_MS) {
      offset.current = measured;
    }
  }

  useEffect(() => {
    if (phaseEndsAt === null) {
      setSeconds(null);
      return undefined;
    }

    const remainingNow = () =>
      Math.max(0, Math.ceil((phaseEndsAt - (Date.now() + offset.current)) / 1_000));

    let handle = 0;
    const update = () => {
      const remaining = remainingNow();
      setSeconds(remaining);
      // Stop ticking once the deadline passes; the next phase restarts us.
      if (remaining === 0 && handle) {
        window.clearInterval(handle);
        handle = 0;
      }
    };

    setSeconds(remainingNow());
    if (remainingNow() > 0) handle = window.setInterval(update, TICK_MS);
    return () => {
      if (handle) window.clearInterval(handle);
    };
  }, [phaseEndsAt]);

  return seconds;
}
