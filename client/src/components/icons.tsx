// SVG replacements for every emoji used in the UI: reactions, medals, and the
// small interface glyphs (copy, sound, back, close, timer, …). Reaction icons
// carry their own lively animation; UI glyphs inherit `currentColor` so they
// match surrounding text. Animations live in index.css (reduced-motion aware).
import type { JSX } from "react";

/* ---------------- Reactions ---------------- */

export const REACTION_IDS = ["laugh", "heart", "fire", "clap", "wow", "skull"] as const;
export type ReactionId = (typeof REACTION_IDS)[number];

const REACTION_ART: Record<ReactionId, () => JSX.Element> = {
  laugh: () => (
    <>
      <circle cx="12" cy="12" r="10" fill="#f6bd45" />
      <path d="M7 10q1.6-2 3.2 0M13.8 10q1.6-2 3.2 0" stroke="#1d150a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M7 14q5 5 10 0z" fill="#1d150a" /><path d="M9 17q3 1.5 6 0" fill="#ff6a4d" />
    </>
  ),
  heart: () => (
    <path d="M12 21S3 14.5 3 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9 2.8C21 14.5 12 21 12 21z" fill="#ff4d6a" />
  ),
  fire: () => (
    <>
      <path d="M12 2c1 3 5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8z" fill="#ff6a4d" />
      <path d="M12 11c1.5 1 2.5 2 2.5 4a2.5 2.5 0 0 1-5 0c0-1.4 1-2.2 1.5-3 .2 1 .8 1.4 1 1.4 .2-1 0-1.6 0-2.4z" fill="#f6bd45" />
    </>
  ),
  clap: () => (
    <>
      <g stroke="#f6bd45" strokeWidth="1.4" strokeLinecap="round"><path d="M5 4l2 2M3 8h2.5M4 12l2-1" /></g>
      <path d="M10 21l-3-4q-1.5-2 .3-3.2L13 9l5 6q1.6 2-.4 3.6z" fill="#ffd08a" stroke="#d8482d" strokeWidth="1" strokeLinejoin="round" />
      <path d="M12 8l4 5M15 7l3 4" stroke="#d8482d" strokeWidth="1" strokeLinecap="round" fill="none" />
    </>
  ),
  wow: () => (
    <>
      <circle cx="12" cy="12" r="10" fill="#f6bd45" />
      <circle cx="8.5" cy="10" r="1.6" fill="#1d150a" /><circle cx="15.5" cy="10" r="1.6" fill="#1d150a" />
      <ellipse cx="12" cy="16" rx="2.6" ry="3.2" fill="#1d150a" />
    </>
  ),
  skull: () => (
    <>
      <path d="M12 3a8 8 0 0 0-8 8c0 3 1.6 4.6 3 5.4V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2.6c1.4-.8 3-2.4 3-5.4a8 8 0 0 0-8-8z" fill="#eef0f2" />
      <circle cx="8.6" cy="12" r="2.2" fill="#1d150a" /><circle cx="15.4" cy="12" r="2.2" fill="#1d150a" />
      <path d="M12 15l-1 2.4h2z" fill="#1d150a" /><path d="M9 19v2M12 19v2M15 19v2" stroke="#1d150a" strokeWidth="1" />
    </>
  ),
};

export function ReactionIcon({ id, className = "" }: { id: string; className?: string }) {
  const art = REACTION_ART[id as ReactionId] ?? REACTION_ART.laugh;
  return (
    <span className={`rx-icon rx-${id} ${className}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">{art()}</svg>
    </span>
  );
}

/* ---------------- Medals ---------------- */

const MEDAL_COLORS = ["#f6c945", "#cfd4da", "#d79256"]; // gold · silver · bronze
const MEDAL_RIM = ["#cf9621", "#9aa1aa", "#a06a36"];

export function Medal({ rank, className = "" }: { rank: number; className?: string }) {
  const c = MEDAL_COLORS[rank] ?? "#cfd4da";
  const rim = MEDAL_RIM[rank] ?? "#9aa1aa";
  return (
    <span className={`medal-icon ${className}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M8 2l3 7-3 1-3-5z" fill="#ff6a4d" /><path d="M16 2l-3 7 3 1 3-5z" fill="#2fd0bb" />
        <circle cx="12" cy="15" r="7" fill={c} stroke={rim} strokeWidth="1.4" />
        <circle cx="12" cy="15" r="4.6" fill="none" stroke={rim} strokeWidth="0.8" opacity="0.7" />
        <path d="M12 11.6l1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z" fill={rim} />
      </svg>
    </span>
  );
}

/* ---------------- UI glyphs (inherit currentColor) ---------------- */

type IconProps = { className?: string };
const wrap = (children: JSX.Element, className = "") => (
  <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconCopy = ({ className }: IconProps) => wrap(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>, className);
export const IconCheck = ({ className }: IconProps) => wrap(<path d="M5 13l4 4L19 7" />, className);
export const IconBack = ({ className }: IconProps) => wrap(<><path d="M15 5l-7 7 7 7" /><path d="M8 12h11" /></>, className);
export const IconClose = ({ className }: IconProps) => wrap(<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>, className);
export const IconArrowRight = ({ className }: IconProps) => wrap(<><path d="M5 12h13" /><path d="M12 5l7 7-7 7" /></>, className);
export const IconTimer = ({ className }: IconProps) => wrap(<><circle cx="12" cy="13" r="8" /><path d="M12 13V8" /><path d="M9 2h6" /></>, className);
export const IconTrophy = ({ className }: IconProps) => wrap(<><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" /><path d="M12 14v4M8 21h8M10 21v-3h4v3" /></>, className);
export const IconAudience = ({ className }: IconProps) => wrap(<><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="3" /></>, className);

export const IconSound = ({ on, className }: IconProps & { on: boolean }) =>
  wrap(
    on ? (
      <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8 8 0 0 1 0 12" /></>
    ) : (
      <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M22 9l-5 6M17 9l5 6" /></>
    ),
    className
  );

export const IconChevron = ({ className }: IconProps) => wrap(<path d="M6 9l6 6 6-6" />, className);

/* ---------------- Verdicts & accents (filled, animated) ---------------- */

export function VerdictRight({ className = "" }: IconProps) {
  return (
    <span className={`verdict-icon vr-right ${className}`} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill="#2fd0bb" />
        <path d="M14 25l7 7 13-15" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
export function VerdictWrong({ className = "" }: IconProps) {
  return (
    <span className={`verdict-icon vr-wrong ${className}`} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill="#ff8a3d" />
        <path d="M16 16l16 16M32 16L16 32" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** Confetti burst used to crown the game-over screen heading. */
export function PartyIcon({ className = "" }: IconProps) {
  return (
    <span className={`party-icon ${className}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M3 21l6-14 9 9z" fill="#f6bd45" stroke="#d8482d" strokeWidth="1.2" strokeLinejoin="round" />
        <g className="party-bits"><circle cx="16" cy="4" r="1.4" fill="#ff6a4d" /><circle cx="20" cy="8" r="1.4" fill="#2fd0bb" /><circle cx="21" cy="3" r="1.1" fill="#f6bd45" /><rect x="13" y="8" width="2" height="2" fill="#9b6bd6" transform="rotate(20 14 9)" /></g>
      </svg>
    </span>
  );
}
