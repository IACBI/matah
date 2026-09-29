# Changelog

Notable project changes are recorded here. Matah follows the structure of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and remains in the
`0.x` development series.

## [Unreleased]

## [0.2.0] - 2026-09-29

Bluff, pause and resume, restart persistence, session standings and custom
content packs, plus a much wider set of limits and ceilings for running on a
shared address.

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
- Ceilings on what can accumulate rather than how fast it arrives: live
  Socket.IO sessions overall (`MATAH_RL_MAX_CONNECTIONS`), one address's share
  of them (`MATAH_RL_CONNECTIONS_PER_IP`), and rooms one address holds at once
  (`MATAH_RL_ROOMS_PER_IP`).
- 27 new interface strings across all 14 languages, including reaction and
  timer labels for screen readers.
- **Bluff**, a third game mode: write a believable fake answer to a trivia
  question, then find the real one among everyone's lies. It reuses the
  trivia pool, so it works in all 14 languages.
- **Pause and resume** for the host, and for a stand-in controller. The clock
  freezes, phones show a paused overlay, and no pause counts against trivia
  answer speed.
- **Games survive a restart** when `MATAH_REDIS_URL` or `MATAH_SNAPSHOT_FILE`
  is set: rooms are snapshotted on shutdown and every few seconds, and
  players resume with the session they already had after a deploy or a
  crash.
- **Session standings**: totals and wins across every game played in a room,
  shown from the second game on.
- **End-of-game highlights**, with the most-voted answers or the most
  convincing lies, and a **share button** that sends a text recap to the
  phone's share sheet or the clipboard.
- **Custom Quiplash prompt packs**: the host pastes up to 30 prompts, played
  before the built-in ones.
- The host can move players between seats and the audience in the lobby.
- Quiplash results show who voted for each answer.
- 12 more trivia questions and 12 more Quiplash prompts in every language
  (32 questions and 40 prompts each).
- **Custom trivia packs** for Trivia and Bluff: the host loads up to 12
  questions of their own, one per line as
  `question | right answer | wrong | wrong | wrong` (a row pasted from a
  spreadsheet works too), played before the built-in ones. The editor names
  the first unusable line and holds Save back until it is fixed, using the same
  checker as the server. Answers made only of symbols (an infinity sign, a
  comparison) are kept distinct from one another, in the editor and in Bluff.
  Packs survive a restart.
- `MATAH_TRUST_PROXY_HOPS` says how many proxies sit in front of the server
  (default `1`, as before; `0` for clients that connect directly), so the
  per-address limits no longer assume one particular hosting layout. A value
  that is not a whole number from 0 to 10 stops the boot.
- `GET /stats`, off unless `MATAH_STATS_TOKEN` is set: room, player and
  connection counts, memory and the last snapshot time behind a bearer token,
  with no room code, name or address in the response.

### Changed

- **Quiplash scoring is fairer.** The point pool now scales with how many
  answers in a matchup are real, and every submitted answer earns a flat
  bonus regardless of how the vote goes — being paired with someone who ran
  out the clock no longer outscores winning a genuine head-to-head.
- **During Quiplash the host screen shows how many players have answered**
  rather than ticking each one off by name, which is what kept answer
  authorship inferable while the room was still voting. Trivia is unchanged.
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
- **Per-address limits are sized for a carrier NAT, not one household.** An
  IPv4 address can front hundreds of mobile subscribers, and after a network
  blip they all reconnect at once; the connection, action, create and rejoin
  budgets were sized for eight phones at one table. They are wider now because
  the new session and room ceilings, not the rates, are what bound abuse.
  `room:join` is the exception and stays where it was: a wrong room code is
  charged to that window and nowhere else.
- The minimum supported Node.js is now 24.15 (or 26 and up), and the Docker
  image builds and runs on the same 24.x line as CI and the Render blueprint
  instead of 25.
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
- The confirmation dialog no longer pulls focus back to "Yes" every time the
  countdown ticks, which made Enter confirm an action the host had tabbed
  away from.
- The trivia result sound plays once per question instead of again on every
  room update during the results screen.
- The lobby's start button counts only connected players, matching the
  server, instead of offering a start that is always refused.
- A Quiplash round with a single connected player closes as soon as they
  answer rather than always running out the clock.
- The browser accessibility audit waits for entrance animations to finish,
  instead of reporting half-faded text as a contrast failure.
- Names, answers and custom prompts keep a zero-width joiner or non-joiner
  that sits between two characters it can join. Stripping every formatting
  character split emoji sequences apart (👩‍💻 became 👩💻, 🏳️‍🌈 became 🏳️🌈) and
  removed the half-space Persian words need. Every other invisible or
  directional character, and a joiner with nothing to join, is still removed.
- A damaged resume hash in a restored snapshot no longer makes rejoin fail for
  every player in that room; the entry is skipped and only its owner loses the
  session.
- The social preview image listed only Quiplash and Trivia; it now shows Bluff
  too.
- The session score beside a player's name in the lobby, shown from the second
  game on, was too faint against its background (4.2:1, where 4.5:1 is the
  minimum); it now has room to spare. The browser accessibility audit had
  never looked at the lobby in that state and now does.

### Security

- Reconnect authorization is separated from public player identifiers.
- Voting payloads no longer expose answer authors before results.
- Server-side origin, payload, room, and action validation has been tightened.
- Resume tokens remain strictly single-use, with no grace window after
  rotation, closing off a possible replay window that was considered and
  rejected during this work.
- `kick` is scoped to the connected host only, even after control authority
  fails over to an elected player controller.
- Per-address limits now key on a normalized identity — IPv4-mapped addresses
  fold to their dotted form, IPv6 addresses to their /56 network — so a client
  rotating source addresses inside its own prefix can no longer buy itself a
  fresh budget on every connection.
- Rate limits are backed by ceilings on what can accumulate: the live sessions
  the server admits, each address's share of them, and the rooms one address
  holds. None of these could be expressed as a rate, and without them a client
  staying inside every published rate could still exhaust memory or the room
  registry — or, with only a global ceiling, take every remaining session slot
  by itself and leave everyone else unable to connect.
- Quiplash shuffles each matchup's answers and each round's pairing, so that
  neither the order answers are displayed in nor a matchup's position in the
  round leaks who wrote what while voting is open.
- The Redis reply parser refuses a length that is not a whole number or that
  announces more than 128 MiB, instead of buffering for as long as the peer
  keeps sending, and a TLS connection to a bare IP address no longer sends an
  SNI name (RFC 6066).
- Quiplash no longer broadcasts per-player answer and vote flags while a round
  is being written or judged. Whoever has not answered is the author of the
  canned quip on screen, and the players yet to vote on a matchup are the two
  who wrote it, so the room now receives aggregate counts instead.

## [0.1.0] - 2026-06-26

### Added

- Initial public version with Quiplash and Trivia modes.
- Real-time host/player flows, audience voting, reconnect support, and 14
  interface/content languages.
- Render, Docker, and GitHub Actions configurations.

[Unreleased]: https://github.com/IACBI/matah/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/IACBI/matah/compare/ec2fcf5cde7ea624025e6f3f7d0936d545d39b09...v0.2.0
[0.1.0]: https://github.com/IACBI/matah/tree/ec2fcf5cde7ea624025e6f3f7d0936d545d39b09
