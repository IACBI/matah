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

### Changed

- Production now runs the compiled server instead of executing TypeScript at
  runtime.
- Phase timing uses server deadlines, reducing repeated full-state broadcasts.
- Render installs from the lockfile and restricts Socket.IO to the public
  deployment origin.

### Security

- Reconnect authorization is separated from public player identifiers.
- Voting payloads no longer expose answer authors before results.
- Server-side origin, payload, room, and action validation has been tightened.

## [0.1.0] - 2026-06-26

### Added

- Initial public version with Quiplash and Trivia modes.
- Real-time host/player flows, audience voting, reconnect support, and 14
  interface/content languages.
- Render, Docker, and GitHub Actions configurations.

[Unreleased]: https://github.com/IACBI/matah/compare/ec2fcf5cde7ea624025e6f3f7d0936d545d39b09...HEAD
[0.1.0]: https://github.com/IACBI/matah/tree/ec2fcf5cde7ea624025e6f3f7d0936d545d39b09
