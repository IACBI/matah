import { useEffect, useRef, useState } from "react";
import type { Reaction } from "../../../shared/src/index";
import { REACTIONS } from "../../../shared/src/index";
import { socket, emitAck } from "../socket";
import { useI18n } from "../i18n";
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

  useEffect(() => {
    const onReaction = (r: Reaction) => {
      const key = nextKey.current++;
      setItems((list) => [
        ...list.slice(-30), // cap concurrent floats
        { ...r, key, left: 8 + Math.random() * 84 },
      ]);
      // Matches the float-up animation duration below.
      setTimeout(
        () => setItems((list) => list.filter((i) => i.key !== key)),
        2600
      );
    };
    socket.on("room:reaction", onReaction);
    return () => {
      socket.off("room:reaction", onReaction);
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

/** Player-screen bar for firing emoji reactions at the host screen. */
export function ReactionBar() {
  const { t } = useI18n();
  const lastSent = useRef(0);

  const send = (emoji: string) => {
    const now = Date.now();
    if (now - lastSent.current < SEND_COOLDOWN_MS) return;
    lastSent.current = now;
    playSfx("click");
    void emitAck("reaction:send", { emoji });
  };

  return (
    <div className="reaction-bar" role="group" aria-label={t("sendReaction")}>
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          className="reaction-btn"
          onClick={() => send(emoji)}
          aria-label={t("sendReaction")}
        >
          <ReactionIcon id={emoji} />
        </button>
      ))}
    </div>
  );
}
