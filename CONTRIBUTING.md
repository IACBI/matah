# Contributing to Matah

Thanks for helping make Matah more reliable and more fun to play. Small,
focused pull requests are easiest to review and safest to ship.

## Development setup

Use Node.js 24.15 or newer (or 26 and up — the test runner does not support
the 25.x line) and the npm version declared in `package.json`.

```bash
npm ci
npm run dev
```

The development server runs on port `3001`; Vite runs on `5173` and proxies
Socket.IO traffic to the server. Use the network URL printed by Vite when
testing with phones on the same local network.

## Where things live

| Path | What is there |
|------|---------------|
| `shared/src/index.ts` | Types, Socket.IO event contracts, limits, and the small pure checks the client and server share |
| `server/src/index.ts` | HTTP, Socket.IO handlers, rate limits, persistence wiring |
| `server/src/room.ts` | One room: membership, timers, control authority, snapshot and restore |
| `server/src/engines/` | One engine per game mode, behind `GameEngine` in `engine.ts` |
| `server/src/content/` | The built-in Quiplash prompts and trivia questions, per language |
| `client/src/views/`, `client/src/components/` | The host and player screens and the pieces they share |
| `client/src/i18n/translations.ts` | Every interface string, in all 14 languages |
| `tests/` | `unit/` and `integration/` (`node:test`), plus the smoke, browser and load scripts |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how these fit together
and why the odd-looking parts are the way they are. Read it before touching
timers, resume tokens or the rate limits.

## Adding content, a language or a game mode

- **A prompt or a trivia question.** Add it to `server/src/content/` for the
  language it is written in. `tests/unit/content.test.mjs` checks that every
  language stays well-formed and above its minimum, and that a trivia
  question's options stay distinct once case, accents and punctuation are
  ignored, since Bluff has to tell the truth from a lie.
- **An interface string.** Add the key to every language in
  `translations.ts`. `translations.test.ts` fails on a missing key or a
  `{placeholder}` that differs from English.
- **A language.** Add it to `LANGUAGES` in `shared/`; TypeScript then lists
  each table that still needs an entry (the labels, the flag, the interface
  strings, the prompts, the safety quips, the trivia questions and the
  fallback player name). Add it to `RTL_LANGS` in `client/src/i18n/index.tsx`
  if it reads right to left.
- **A game mode.** Implement `GameEngine`, register it in `GAME_TYPES` and in
  `Room.startGame`, and add its views, strings and tests. Engines talk to the
  room only through `EngineContext`, which is what lets tests drive them with
  a fake clock.

## Making a change

1. Create a branch from the latest `main`.
2. Keep the change scoped; avoid unrelated formatting, dependency, or generated
   file updates.
3. Add or update tests for behavior changes. Prefer event-driven waits over
   fixed sleeps in multiplayer tests.
4. Update user-facing text, translations, screenshots, and documentation when
   behavior changes.
5. Run the relevant checks before opening a pull request.

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:smoke
```

`npm test` runs the unit, integration, and client suites and needs nothing
built first — it's the one that should pass on a fresh clone. The Redis
persistence tests skip themselves unless `MATAH_TEST_REDIS_URL` points at a
disposable Redis; CI runs one as a service container, and locally
`docker run --rm -p 127.0.0.1:6379:6379 redis:7-alpine` plus
`MATAH_TEST_REDIS_URL=redis://127.0.0.1:6379` is enough. `npm run
test:smoke` and `npm run test:browser` drive the compiled server, so they
need `npm run build` to have run first; both probe `/health` and point you at
`npm run build` if the bundle is missing.

For UI work, also check a desktop host view and a narrow mobile player view.
Verify keyboard use, visible focus, reduced motion, and an RTL language, and
run `npm run test:browser` for multiplayer, responsive, RTL, rematch, and
accessibility checks in real Chromium. For deployment work, build the Docker
image and confirm that `/health` becomes healthy before exercising a short
game.

## Pull requests

Explain the problem, the chosen solution, user-visible effects, and validation
performed. Call out security, compatibility, deployment, or rollback concerns.
Do not claim a check passed unless you ran it. Never commit secrets, local
environment files, resume tokens, or private player data.

Bug reports should contain concise reproduction steps and environment details.
Security reports must follow [SECURITY.md](SECURITY.md), not a public issue.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
