# Changelog

Notable project changes are recorded here. Matah follows the structure of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and remains in the
`0.x` development series.

## [Unreleased]

### Added

- Private resume-token sessions with explicit replacement of stale sockets.
- Unit and integration test entry points alongside the multiplayer smoke suite.
- Production deployment, security, contribution, and rollback documentation.
- Non-root multi-stage Docker image with an application health check.
- Live vote tally on the host screen during Quiplash voting.
- A styled, accessible confirmation dialog for ending a game or leaving a
  room, replacing the browser's native confirm prompt.
- Configurable rate limits (`MATAH_RL_*` environment variables) for
  connections, gameplay actions, room creation, joins, and rejoins.
- 27 new interface strings across all 14 languages, including reaction and
  timer labels for screen readers.

### Changed

- **Quiplash scoring is fairer.** The point pool now scales with how many
  answers in a matchup are real, and every submitted answer earns a flat
  bonus regardless of how the vote goes — being paired with someone who ran
  out the clock no longer outscores winning a genuine head-to-head.
- **A game now ends to the scoreboard if the room drops below three players
  mid-round**, instead of continuing with a matchup nobody present can vote
  on.
- Quiplash prompts can repeat within a game, but never for a player who has
  already written for that prompt.
- Reconnecting no longer restarts the screen: a dropped connection now
  resumes in place, with a pending vote, an in-progress answer, and the
  host's game settings intact.
- Control authority is now capability-based. The player who takes over after
  the host disconnects can run the game, but cannot kick — that stays
  reserved to the connected host.
- Production now runs the compiled server instead of executing TypeScript at
  runtime.
- Phase timing uses server deadlines, reducing repeated full-state broadcasts.
- Render installs from the lockfile and restricts Socket.IO to the public
  deployment origin.
- Accessibility: contrast, touch target sizing, avatar grid layout on narrow
  screens, and a visible focus ring on the language selector.

### Fixed

- Rejoining your own full room no longer demotes you to the audience.
- Late joiners are seated as players — not left spectating indefinitely — on
  the next game start, rematch, or restart.
- A reconnecting voter's vote buttons now reflect whether their vote already
  landed, instead of failing every tap until the round moved on.
- A rejoin failure while in a room now shows a notice with a retry, instead
  of leaving the player on frozen pre-disconnect state.

### Security

- Reconnect authorization is separated from public player identifiers.
- Voting payloads no longer expose answer authors before results.
- Server-side origin, payload, room, and action validation has been tightened.
- Resume tokens remain strictly single-use, with no grace window after
  rotation, closing off a possible replay window that was considered and
  rejected during this work.
- `kick` is scoped to the connected host only, even after control authority
  fails over to an elected player controller.

## [0.1.0] - 2026-06-26

### Added

- Initial public version with Quiplash and Trivia modes.
- Real-time host/player flows, audience voting, reconnect support, and 14
  interface/content languages.
- Render, Docker, and GitHub Actions configurations.

[Unreleased]: https://github.com/IACBI/matah/compare/ec2fcf5cde7ea624025e6f3f7d0936d545d39b09...HEAD
[0.1.0]: https://github.com/IACBI/matah/tree/ec2fcf5cde7ea624025e6f3f7d0936d545d39b09
