// Vite's ambient declarations: `*.css` and friends as side-effect-only modules,
// plus import.meta.env. TypeScript 5 quietly tolerated `import "./index.css"`
// with nothing behind it; 7 reports it as TS2882, so the reference Vite's own
// scaffold ships has to actually be here.
/// <reference types="vite/client" />
