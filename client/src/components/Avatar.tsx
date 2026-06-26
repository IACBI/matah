// Animated SVG avatars — a cohesive set that replaces the old emoji avatars
// (which render inconsistently across platforms). Each is drawn in a 40×40
// viewBox on a soft rounded badge and bobs gently (CSS, in index.css;
// reduced-motion aware). Identified by a stable id stored in player state.
import type { JSX } from "react";

export const AVATAR_IDS = [
  "cool", "fox", "cat", "frog", "unicorn", "ghost", "robot", "panda",
  "octopus", "lion", "pizza", "rocket", "cactus", "cupcake", "dragon", "ninja",
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

export const DEFAULT_AVATAR_ID = "smiley";
export const HOST_AVATAR_ID = "tv";

type Art = { bg: string; eyes?: boolean; draw: () => JSX.Element };

const eyes = (
  <g fill="#1d150a">
    <circle cx="15.5" cy="20" r="2.2" />
    <circle cx="24.5" cy="20" r="2.2" />
    <circle className="av-shine" cx="16.2" cy="19.2" r="0.7" fill="#fff" />
    <circle className="av-shine" cx="25.2" cy="19.2" r="0.7" fill="#fff" />
  </g>
);

const ART: Record<string, Art> = {
  smiley: { bg: "#f6bd45", draw: () => (<>{eyes}<path d="M14 26q6 5 12 0" stroke="#1d150a" strokeWidth="2" fill="none" strokeLinecap="round" /></>) },
  cool: {
    bg: "#f6bd45", draw: () => (<>
      <rect x="11" y="17" width="18" height="6" rx="3" fill="#1d150a" />
      <rect x="12.5" y="18.2" width="5.5" height="3.6" rx="1.8" fill="#2fd0bb" />
      <rect x="22" y="18.2" width="5.5" height="3.6" rx="1.8" fill="#2fd0bb" />
      <path d="M15 27q5 4 10 0" stroke="#1d150a" strokeWidth="2" fill="none" strokeLinecap="round" />
    </>),
  },
  fox: {
    bg: "#ff8a3d", draw: () => (<>
      <path d="M8 9l4 7-6-1z" fill="#ff8a3d" /><path d="M32 9l-4 7 6-1z" fill="#ff8a3d" />
      <path d="M12 18q8 9 16 0 0 10-8 12-8-2-8-12z" fill="#fff" />
      {eyes}<path d="M20 25l-2 2h4z" fill="#1d150a" />
    </>),
  },
  cat: {
    bg: "#b9a7d6", draw: () => (<>
      <path d="M9 8l3 8-7-1z" fill="#b9a7d6" /><path d="M31 8l-3 8 7-1z" fill="#b9a7d6" />
      {eyes}<path d="M19 24h2l-1 1.5z" fill="#1d150a" />
      <g stroke="#1d150a" strokeWidth="1" strokeLinecap="round"><path d="M6 22h6M6 25h6M34 22h-6M34 25h-6" /></g>
    </>),
  },
  frog: {
    bg: "#5bbf4a", draw: () => (<>
      <circle cx="13" cy="13" r="5" fill="#5bbf4a" stroke="#fff" strokeWidth="1.5" />
      <circle cx="27" cy="13" r="5" fill="#5bbf4a" stroke="#fff" strokeWidth="1.5" />
      <circle cx="13" cy="13" r="2" fill="#1d150a" /><circle cx="27" cy="13" r="2" fill="#1d150a" />
      <path d="M13 25q7 5 14 0" stroke="#1d150a" strokeWidth="2" fill="none" strokeLinecap="round" />
    </>),
  },
  unicorn: {
    bg: "#ffb3d1", draw: () => (<>
      <path d="M20 4l2.4 7h-4.8z" fill="#f6bd45" />
      <path d="M11 12q3-3 6 0M23 12q3-3 6 0" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {eyes}<path d="M16 27q4 3 8 0" stroke="#1d150a" strokeWidth="2" fill="none" strokeLinecap="round" />
    </>),
  },
  ghost: {
    bg: "#7d8aa5", draw: () => (<>
      <path d="M11 22q0-9 9-9t9 9v9l-3-2-3 2-3-2-3 2-3-2z" fill="#fff" />
      <circle cx="16.5" cy="20" r="1.8" fill="#1d150a" /><circle cx="23.5" cy="20" r="1.8" fill="#1d150a" />
    </>),
  },
  robot: {
    bg: "#7fb3c9", draw: () => (<>
      <line x1="20" y1="6" x2="20" y2="11" stroke="#1d150a" strokeWidth="1.6" /><circle cx="20" cy="6" r="1.8" fill="#ff6a4d" />
      <rect x="11" y="12" width="18" height="16" rx="3" fill="#e7eef2" stroke="#1d150a" strokeWidth="1.4" />
      <rect x="14" y="17" width="4.5" height="4.5" rx="1" fill="#2fd0bb" /><rect x="21.5" y="17" width="4.5" height="4.5" rx="1" fill="#2fd0bb" />
      <rect x="15" y="24" width="10" height="1.6" rx="0.8" fill="#1d150a" />
    </>),
  },
  panda: {
    bg: "#cfd8dc", draw: () => (<>
      <circle cx="11" cy="12" r="4" fill="#1d150a" /><circle cx="29" cy="12" r="4" fill="#1d150a" />
      <ellipse cx="14.5" cy="20" rx="3.4" ry="4" fill="#1d150a" /><ellipse cx="25.5" cy="20" rx="3.4" ry="4" fill="#1d150a" />
      <circle cx="15" cy="20.5" r="1.5" fill="#fff" /><circle cx="25" cy="20.5" r="1.5" fill="#fff" />
      <path d="M17 26q3 2 6 0" stroke="#1d150a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </>),
  },
  octopus: {
    bg: "#9b6bd6", draw: () => (<>
      <path d="M11 22q0-9 9-9t9 9v3h-18z" fill="#c79bf0" />
      <path d="M11 25q-2 5-4 4M16 26v5M20 26v5.5M24 26v5M29 25q2 5 4 4" stroke="#c79bf0" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="16.5" cy="20" r="1.8" fill="#1d150a" /><circle cx="23.5" cy="20" r="1.8" fill="#1d150a" />
    </>),
  },
  lion: {
    bg: "#e0a32e", draw: () => (<>
      {Array.from({ length: 12 }, (_, i) => { const a = (Math.PI / 6) * i; return <circle key={i} cx={20 + 12 * Math.cos(a)} cy={20 + 12 * Math.sin(a)} r="3.4" fill="#b9781b" />; })}
      <circle cx="20" cy="20" r="9" fill="#f6bd45" />{eyes}
      <path d="M17 25q3 2 6 0" stroke="#1d150a" strokeWidth="1.6" fill="none" strokeLinecap="round" /><circle cx="20" cy="23" r="1.4" fill="#1d150a" />
    </>),
  },
  pizza: {
    bg: "#ffd66b", draw: () => (<>
      <path d="M20 7l12 24H8z" fill="#f6bd45" stroke="#d8482d" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M20 7l11 22H9z" fill="#ffce8a" /><circle cx="17" cy="20" r="2" fill="#d8482d" /><circle cx="24" cy="19" r="2" fill="#d8482d" /><circle cx="20" cy="26" r="2" fill="#d8482d" />
    </>),
  },
  rocket: {
    bg: "#6f9bd1", draw: () => (<>
      <path d="M20 6q6 5 6 14l-3 5h-6l-3-5q0-9 6-14z" fill="#eef3f8" stroke="#1d150a" strokeWidth="1.2" />
      <circle cx="20" cy="16" r="2.6" fill="#2fd0bb" /><path d="M14 22l-3 4 5-1zM26 22l3 4-5-1z" fill="#ff6a4d" />
      <path d="M17 30q3 4 6 0z" fill="#f6bd45" />
    </>),
  },
  cactus: {
    bg: "#79c98a", draw: () => (<>
      <rect x="17" y="12" width="6" height="20" rx="3" fill="#3f9d54" />
      <path d="M17 20h-3a3 3 0 0 1-3-3v-2M23 23h3a3 3 0 0 0 3-3v-3" stroke="#3f9d54" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <circle cx="20" cy="20" r="1.5" fill="#1d150a" /><circle cx="20" cy="20" r="1.5" fill="#1d150a" transform="translate(0,4)" />
    </>),
  },
  cupcake: {
    bg: "#ffc0cb", draw: () => (<>
      <path d="M12 22h16l-2 9H14z" fill="#f6bd45" /><path d="M12 22h16v-1H12z" fill="#d8482d" />
      <path d="M13 22q1-8 7-8t7 8z" fill="#ff8fb0" /><circle cx="20" cy="11" r="1.8" fill="#d8482d" />
    </>),
  },
  dragon: {
    bg: "#6cc59a", draw: () => (<>
      <path d="M10 9l3 6-6 0z" fill="#3f9d6e" /><path d="M30 9l-3 6 6 0z" fill="#3f9d6e" />
      <path d="M12 22q0-9 8-9t8 9v4h-16z" fill="#7fd6ab" />{eyes}
      <path d="M16 27h8" stroke="#1d150a" strokeWidth="1.8" strokeLinecap="round" /><path d="M18 27v2M22 27v2" stroke="#fff" strokeWidth="1.2" />
    </>),
  },
  ninja: {
    bg: "#586074", draw: () => (<>
      <path d="M9 18q0-7 11-7t11 7q0 3-2 4H11q-2-1-2-4z" fill="#2b3040" />
      <rect x="9" y="18" width="22" height="5" fill="#1d150a" />
      <rect x="14" y="19.4" width="5" height="2.2" rx="1.1" fill="#fff" /><rect x="21" y="19.4" width="5" height="2.2" rx="1.1" fill="#fff" />
      <path d="M11 23q9 6 18 0v3q-9 6-18 0z" fill="#2b3040" />
    </>),
  },
};

export function Avatar({ id, className = "" }: { id: string; className?: string }) {
  const art = ART[id] ?? ART[DEFAULT_AVATAR_ID];
  return (
    <span className={`avatar-svg ${className}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" className="avatar-bob">
        <rect width="40" height="40" rx="11" fill={art.bg} />
        <g className="avatar-face">{art.draw()}</g>
      </svg>
    </span>
  );
}

/** The host (TV) screen's badge. */
export function HostAvatar({ className = "" }: { className?: string }) {
  return (
    <span className={`avatar-svg ${className}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" className="avatar-bob">
        <rect width="40" height="40" rx="11" fill="#251d13" />
        <rect x="8" y="11" width="24" height="16" rx="2.5" fill="#1d150a" stroke="#f6bd45" strokeWidth="1.6" />
        <rect x="10.5" y="13.5" width="19" height="11" rx="1" fill="#2fd0bb" opacity="0.85" />
        <path d="M16 31l4-4 4 4" stroke="#f6bd45" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="av-shine" cx="13" cy="16.5" r="1.2" fill="#fff" opacity="0.7" />
      </svg>
    </span>
  );
}
