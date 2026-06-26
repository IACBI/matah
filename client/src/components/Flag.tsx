// Accurate, recognizable inline-SVG flags for every supported language, with a
// cloth "wave in the wind" effect: an animated turbulence + displacement filter
// ripples the fabric while the fly end flutters (CSS, in index.css). One <svg>
// per language keeps it crisp at any size and avoids emoji flags, which don't
// render on Windows. Reduced-motion: the ripple/flutter are dropped (static).
import { useEffect, useState } from "react";
import type { Language } from "../../../shared/src/index";

const W = 30;
const H = 20;

/** Five-pointed star centered at (cx,cy), one point up, given outer radius. */
function Star({ cx, cy, r, fill = "#fff", rot = 0 }: { cx: number; cy: number; r: number; fill?: string; rot?: number }) {
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const ao = (Math.PI / 180) * (-90 + rot + i * 72);
    pts.push(`${cx + r * Math.cos(ao)},${cy + r * Math.sin(ao)}`);
    const ai = (Math.PI / 180) * (-90 + rot + i * 72 + 36);
    pts.push(`${cx + r * 0.4 * Math.cos(ai)},${cy + r * 0.4 * Math.sin(ai)}`);
  }
  return <polygon points={pts.join(" ")} fill={fill} />;
}

/** A trigram: three short bars; `pattern` marks each bar solid (true) or broken. */
function Trigram({ cx, cy, pattern }: { cx: number; cy: number; pattern: [boolean, boolean, boolean] }) {
  const bw = 5.2, bh = 0.9, gap = 1.5, mid = 1.1;
  return (
    <g fill="#000">
      {pattern.map((solid, i) => {
        const y = cy + (i - 1) * (bh + gap) - bh / 2;
        if (solid) return <rect key={i} x={cx - bw / 2} y={y} width={bw} height={bh} rx={0.3} />;
        const half = (bw - mid) / 2;
        return (
          <g key={i}>
            <rect x={cx - bw / 2} y={y} width={half} height={bh} rx={0.3} />
            <rect x={cx + mid / 2} y={y} width={half} height={bh} rx={0.3} />
          </g>
        );
      })}
    </g>
  );
}

// Each entry returns the flag's inner shapes drawn in a 30×20 viewBox.
const FLAGS: Record<Language, () => JSX.Element> = {
  tr: () => (
    <>
      <rect width={W} height={H} fill="#E30A17" />
      {/* crescent: white disc minus an offset red disc, opening toward the star */}
      <circle cx="11.5" cy="10" r="4.6" fill="#fff" />
      <circle cx="13.2" cy="10" r="3.7" fill="#E30A17" />
      <Star cx={18.2} cy={10} r={2.7} />
    </>
  ),
  en: () => (
    <>
      <rect width={W} height={H} fill="#012169" />
      <path d="M0 0 30 20M30 0 0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0 30 20M30 0 0 20" stroke="#C8102E" strokeWidth="2" />
      <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0v20M0 10h30" stroke="#C8102E" strokeWidth="3.4" />
    </>
  ),
  de: () => (
    <>
      <rect width={W} height={H / 3} fill="#000" />
      <rect y={H / 3} width={W} height={H / 3} fill="#DD0000" />
      <rect y={(2 * H) / 3} width={W} height={H / 3} fill="#FFCE00" />
    </>
  ),
  es: () => (
    <>
      <rect width={W} height={H} fill="#AA151B" />
      <rect y="5" width={W} height="10" fill="#F1BF00" />
    </>
  ),
  fr: () => (
    <>
      <rect width={W} height={H} fill="#fff" />
      <rect width={W / 3} height={H} fill="#0055A4" />
      <rect x={(2 * W) / 3} width={W / 3} height={H} fill="#EF4135" />
    </>
  ),
  it: () => (
    <>
      <rect width={W} height={H} fill="#fff" />
      <rect width={W / 3} height={H} fill="#008C45" />
      <rect x={(2 * W) / 3} width={W / 3} height={H} fill="#CD212A" />
    </>
  ),
  pt: () => (
    <>
      <rect width={W} height={H} fill="#DA291C" />
      <rect width={W * 0.4} height={H} fill="#046A38" />
      <circle cx={W * 0.4} cy="10" r="3" fill="#FFE900" stroke="#fff" strokeWidth="0.5" />
      <circle cx={W * 0.4} cy="10" r="1.6" fill="#DA291C" stroke="#fff" strokeWidth="0.5" />
    </>
  ),
  ru: () => (
    <>
      <rect width={W} height={H} fill="#fff" />
      <rect y={H / 3} width={W} height={H / 3} fill="#0039A6" />
      <rect y={(2 * H) / 3} width={W} height={H / 3} fill="#D52B1E" />
    </>
  ),
  ar: () => (
    <>
      <rect width={W} height={H} fill="#006C35" />
      {/* stylized shahada script (two lines) above the sword */}
      <g fill="none" stroke="#fff" strokeWidth="1.1" strokeLinecap="round">
        <path d="M8 7.2h2.2M11.5 7.2q1 0 1 1M14 7.2h1.6M17 7.2q1 0 1-1M19.5 7.2h2.5" />
        <path d="M9 9.4h3M13.5 9.4q1.2 0 1.2 1M16.5 9.4h4.5" />
      </g>
      <g fill="#fff">
        <rect x="7.5" y="12.4" width="14" height="0.9" rx="0.45" />
        <path d="M21.5 12.85 L24 12 l0 1.7 Z" />
      </g>
    </>
  ),
  zh: () => (
    <>
      <rect width={W} height={H} fill="#DE2910" />
      <Star cx={5} cy={5} r={3.2} fill="#FFDE00" />
      <Star cx={10.2} cy={2.4} r={1.05} fill="#FFDE00" rot={22} />
      <Star cx={12.4} cy={4.6} r={1.05} fill="#FFDE00" rot={45} />
      <Star cx={12.4} cy={7.7} r={1.05} fill="#FFDE00" rot={68} />
      <Star cx={10.2} cy={9.9} r={1.05} fill="#FFDE00" rot={90} />
    </>
  ),
  ja: () => (
    <>
      <rect width={W} height={H} fill="#fff" />
      <circle cx="15" cy="10" r="5.2" fill="#BC002D" />
    </>
  ),
  ko: () => (
    <>
      <rect width={W} height={H} fill="#fff" />
      {/* taegeuk: red over blue, joined by an S-curve */}
      <g transform="rotate(-33 15 10)">
        <path d="M11 10a4 4 0 0 1 8 0 2 2 0 0 1-4 0 2 2 0 0 0-4 0Z" fill="#CD2E3A" />
        <path d="M11 10a4 4 0 0 0 8 0 2 2 0 0 0-4 0 2 2 0 0 1-4 0Z" fill="#0047A0" />
      </g>
      <Trigram cx={6.2} cy={5} pattern={[true, true, true]} />
      <Trigram cx={23.8} cy={5} pattern={[false, true, false]} />
      <Trigram cx={6.2} cy={15} pattern={[true, false, true]} />
      <Trigram cx={23.8} cy={15} pattern={[false, false, false]} />
    </>
  ),
  hi: () => (
    <>
      <rect width={W} height={H / 3} fill="#FF9933" />
      <rect y={H / 3} width={W} height={H / 3} fill="#fff" />
      <rect y={(2 * H) / 3} width={W} height={H / 3} fill="#138808" />
      <g stroke="#000080" strokeWidth="0.45">
        <circle cx="15" cy="10" r="2.5" fill="none" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (Math.PI / 6) * i;
          return <line key={i} x1="15" y1="10" x2={15 + 2.5 * Math.cos(a)} y2={10 + 2.5 * Math.sin(a)} />;
        })}
      </g>
      <circle cx="15" cy="10" r="0.5" fill="#000080" />
    </>
  ),
  nl: () => (
    <>
      <rect width={W} height={H / 3} fill="#AE1C28" />
      <rect y={H / 3} width={W} height={H / 3} fill="#fff" />
      <rect y={(2 * H) / 3} width={W} height={H / 3} fill="#21468B" />
    </>
  ),
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function Flag({ code, className = "" }: { code: Language; className?: string }) {
  const Inner = FLAGS[code] ?? FLAGS.en;
  const [animate, setAnimate] = useState(false);
  // Enable the ripple only when motion is allowed (and after mount, so SSR/static
  // renders stay calm).
  useEffect(() => setAnimate(!prefersReducedMotion()), []);

  const fid = `wave-${code}`;
  return (
    <span className={`flag ${animate ? "flag-anim" : ""} ${className}`} aria-hidden="true">
      <svg className="flag-wave" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id={`flag-clip-${code}`}>
            <rect width={W} height={H} rx="2.5" />
          </clipPath>
          {animate && (
            <filter id={fid} x="-15%" y="-15%" width="130%" height="130%">
              <feTurbulence type="fractalNoise" baseFrequency="0.018 0.05" numOctaves="2" seed="7" result="n">
                <animate
                  attributeName="baseFrequency"
                  dur="3.6s"
                  values="0.016 0.045;0.022 0.06;0.016 0.045"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="n" scale="1.7" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          )}
        </defs>
        <g clipPath={`url(#flag-clip-${code})`} filter={animate ? `url(#${fid})` : undefined}>
          <Inner />
        </g>
        <rect width={W} height={H} rx="2.5" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="0.8" />
      </svg>
    </span>
  );
}
