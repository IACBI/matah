// Hand-drawn, animated SVG icons for the two game modes. Soft palette colours,
// smooth GPU-friendly (transform/opacity) animations defined in index.css.
// All motion is gated behind prefers-reduced-motion there.

/** Quiplash: a speech bubble with a quill writing a witty line. */
export function QuiplashIcon() {
  return (
    <svg
      className="game-svg qi"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="qiBubble" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd98a" />
          <stop offset="100%" stopColor="#ff9d7a" />
        </linearGradient>
      </defs>
      {/* speech bubble */}
      <g className="qi-bubble">
        <path
          d="M12 12h40a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H28l-12 9 2-9h-6a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6Z"
          fill="url(#qiBubble)"
          opacity="0.18"
        />
        <path
          d="M12 12h40a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H28l-12 9 2-9h-6a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6Z"
          stroke="url(#qiBubble)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </g>
      {/* the "written" line being drawn */}
      <path
        className="qi-line"
        d="M19 26c4-3 8 3 12 0s8-3 13-1"
        stroke="#f8f1e2"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* second, shorter line */}
      <path
        className="qi-line2"
        d="M19 34c5 0 9 0 16 0"
        stroke="#f8f1e2"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* quill */}
      <g className="qi-pen">
        <path
          d="M46 18 36 36l4 2L52 22Z"
          fill="#2fd0bb"
          stroke="#14110c"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path d="m36 36 4 2-3 3Z" fill="#14110c" />
      </g>
    </svg>
  );
}

/** Trivia: a glowing lightbulb of ideas with twinkling rays. */
export function TriviaIcon() {
  return (
    <svg
      className="game-svg ti"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="tiGlow" cx="50%" cy="42%" r="55%">
          <stop offset="0%" stopColor="#8ff0e3" />
          <stop offset="100%" stopColor="#2fd0bb" />
        </radialGradient>
      </defs>
      {/* twinkling rays */}
      <g className="ti-rays" stroke="#f6bd45" strokeWidth="2.5" strokeLinecap="round">
        <path d="M32 4v6" />
        <path d="M12 12l4 4" />
        <path d="M52 12l-4 4" />
        <path d="M6 32h6" />
        <path d="M52 32h6" />
      </g>
      {/* bulb */}
      <g className="ti-bulb">
        <path
          d="M32 14a16 16 0 0 1 10 28c-1.6 1.4-2 2.6-2 4v1H24v-1c0-1.4-.4-2.6-2-4a16 16 0 0 1 10-28Z"
          fill="url(#tiGlow)"
          opacity="0.22"
        />
        <path
          d="M32 14a16 16 0 0 1 10 28c-1.6 1.4-2 2.6-2 4v1H24v-1c0-1.4-.4-2.6-2-4a16 16 0 0 1 10-28Z"
          stroke="url(#tiGlow)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {/* filament shaped like a question mark */}
        <path
          className="ti-filament"
          d="M28 28a4 4 0 0 1 7-1c1 2-2 3-3 5"
          stroke="#f6bd45"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle className="ti-filament" cx="32" cy="38" r="1.4" fill="#f6bd45" />
      </g>
      {/* base */}
      <g stroke="#f8f1e2" strokeWidth="2.5" strokeLinecap="round" opacity="0.8">
        <path d="M26 52h12" />
        <path d="M28 56h8" />
      </g>
    </svg>
  );
}
