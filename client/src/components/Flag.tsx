// Simplified, recognizable inline-SVG flags for every supported language, with
// a gentle pole-swing "wave" (CSS, in index.css; reduced-motion aware).
// One <svg> per language keeps it crisp at any size and avoids emoji flags,
// which don't render on Windows.
import type { Language } from "../../../shared/src/index";

const W = 30;
const H = 20;

// Each entry returns the flag's inner shapes drawn in a 30×20 viewBox.
const FLAGS: Record<Language, () => JSX.Element> = {
  tr: () => (
    <>
      <rect width={W} height={H} fill="#E30A17" />
      <circle cx="12.5" cy="10" r="5" fill="#fff" />
      <circle cx="14" cy="10" r="4" fill="#E30A17" />
      <path
        d="M17.5 10 22 8.4l-2.9 1.6.1 3.3-2-2.6-3.2 1 2-2.6-2-2.6 3.2 1 2-2.6Z"
        fill="#fff"
      />
    </>
  ),
  en: () => (
    <>
      <rect width={W} height={H} fill="#012169" />
      <path d="M0 0 30 20M30 0 0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0 30 20M30 0 0 20" stroke="#C8102E" strokeWidth="1.8" />
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
      <circle cx={W * 0.4} cy="10" r="3.2" fill="#FFE900" stroke="#DA291C" strokeWidth="0.8" />
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
      <rect x="6" y="8.6" width="18" height="1.5" rx="0.5" fill="#fff" />
      <path d="M6 8.6c-1.4 0-1.4 2.4 0 2.4" stroke="#fff" strokeWidth="1.5" fill="none" />
      <rect x="9" y="6" width="12" height="1.4" rx="0.5" fill="#fff" />
    </>
  ),
  zh: () => (
    <>
      <rect width={W} height={H} fill="#DE2910" />
      <Star cx={5} cy={5} r={3} />
      <Star cx={10.5} cy={2.5} r={1} />
      <Star cx={12} cy={5} r={1} />
      <Star cx={12} cy={8} r={1} />
      <Star cx={10.5} cy={10} r={1} />
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
      <path d="M15 6a4 4 0 0 1 0 8 4 4 0 0 0 0-8Z" fill="#CD2E3A" />
      <path d="M15 6a4 4 0 0 0 0 8 4 4 0 0 1 0-8Z" fill="#0047A0" />
      <g stroke="#000" strokeWidth="0.7">
        <path d="M5.5 5.2 7 6.2M5 6 6.5 7" />
        <path d="M23 13.8 24.5 14.8M23.5 13 25 14" />
      </g>
    </>
  ),
  hi: () => (
    <>
      <rect width={W} height={H / 3} fill="#FF9933" />
      <rect y={H / 3} width={W} height={H / 3} fill="#fff" />
      <rect y={(2 * H) / 3} width={W} height={H / 3} fill="#138808" />
      <circle cx="15" cy="10" r="2.4" fill="none" stroke="#000080" strokeWidth="0.7" />
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

function Star({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const pts = Array.from({ length: 5 }, (_, i) => {
    const a = (Math.PI / 180) * (-90 + i * 144);
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
  return <polygon points={pts} fill="#FFDE00" />;
}

export function Flag({ code, className = "" }: { code: Language; className?: string }) {
  const Inner = FLAGS[code] ?? FLAGS.en;
  return (
    <span className={`flag ${className}`} aria-hidden="true">
      <svg className="flag-wave" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id={`flag-clip-${code}`}>
            <rect width={W} height={H} rx="2.5" />
          </clipPath>
        </defs>
        <g clipPath={`url(#flag-clip-${code})`}>
          <Inner />
        </g>
        <rect
          width={W}
          height={H}
          rx="2.5"
          fill="none"
          stroke="rgba(0,0,0,0.18)"
          strokeWidth="0.8"
        />
      </svg>
    </span>
  );
}
