import { useEffect, useRef, useState } from "react";
import type { Reaction } from "../../../shared/src/index";
import { REACTIONS } from "../../../shared/src/index";
import { socket, emitAck } from "../socket";
import { useI18n } from "../i18n";
import type { TKey } from "../i18n/translations";
import { Avatar } from "./Avatar";
import { ReactionIcon } from "./icons";
import { playSfx } from "../sound";

interface FloatingReaction extends Reaction {
  key: number;
  left: number; // vw offset so emojis don't stack on one column
}

/** Host-screen overlay: emojis sent by players float up and fade out. */
export function ReactionOverlay() {
  const [items, setItems] = useState<FloatingReaction[]>([]);
  const nextKey = useRef(0);
  const timers = useRef<Set<number>>(new Set());

  useEffect(() => {
    const pending = timers.current;
    const onReaction = (r: Reaction) => {
      const key = nextKey.current++;
      setItems((list) => [
        ...list.slice(-30), // cap concurrent floats
        { ...r, key, left: 8 + Math.random() * 84 },
      ]);
      // Matches the float-up animation duration below. Tracked so leaving the
      // host screen during a reaction storm doesn't leave dozens of timers
      // setting state on an unmounted component.
      const handle = window.setTimeout(() => {
        pending.delete(handle);
        setItems((list) => list.filter((i) => i.key !== key));
      }, 2600);
      pending.add(handle);
    };
    socket.on("room:reaction", onReaction);
    return () => {
      socket.off("room:reaction", onReaction);
      for (const handle of pending) window.clearTimeout(handle);
      pending.clear();
    };
  }, []);

  return (
    <div className="reaction-overlay" aria-hidden="true">
      {items.map((i) => (
        <span
          key={i.key}
          className="reaction-float"
          style={{ left: `${i.left}vw` }}
        >
          <ReactionIcon id={i.emoji} className="reaction-emoji" />
          <span className="reaction-sender">
            <Avatar id={i.avatar} /> {i.name}
          </span>
        </span>
      ))}
    </div>
  );
}

const SEND_COOLDOWN_MS = 700;

const REACTION_LABELS: Record<(typeof REACTIONS)[number], TKey> = {
  laugh: "reaction_laugh",
  heart: "reaction_heart",
  fire: "reaction_fire",
  clap: "reaction_clap",
  wow: "reaction_wow",
  skull: "reaction_skull",
};

/** Player-screen bar for firing emoji reactions at the host screen. */
export function ReactionBar() {
  const { t } = useI18n();
  const [cooling, setCooling] = useState(false);
  const coolTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(coolTimer.current), []);

  const send = (emoji: string) => {
    // Show the cooldown rather than silently swallowing the tap.
    if (cooling) return;
    setCooling(true);
    coolTimer.current = window.setTimeout(() => setCooling(false), SEND_COOLDOWN_MS);
    playSfx("click");
    if (navigator.vibrate) navigator.vibrate(8);
    void emitAck("reaction:send", { emoji });
  };

  return (
    <div className="reaction-bar" role="group" aria-label={t("sendReaction")}>
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          className="reaction-btn"
          onClick={() => send(emoji)}
          disabled={cooling}
          // Each button sends a different reaction, so each needs its own name.
          aria-label={t(REACTION_LABELS[emoji])}
        >
          <ReactionIcon id={emoji} />
        </button>
      ))}
    </div>
  );
}
