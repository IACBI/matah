# Contributing to Matah

Thanks for helping make Matah more reliable and more fun to play. Small,
focused pull requests are easiest to review and safest to ship.

## Development setup

Use Node.js 24 or newer and the npm version declared in `package.json`.

```bash
npm ci
npm run dev
```

The development server runs on port `3001`; Vite runs on `5173` and proxies
Socket.IO traffic to the server. Use the network URL printed by Vite when
testing with phones on the same local network.

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
built first — it's the one that should pass on a fresh clone. `npm run
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
