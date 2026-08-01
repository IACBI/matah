# Matah architecture

Matah is a single-process, real-time party game. One Node.js service owns the
HTTP application, Socket.IO transport, room registry, timers, and game engines;
the same service serves the compiled React client in production.

## Runtime model

```text
Browser host / player controllers
               │ HTTPS + WSS
               ▼
Express + Socket.IO (one Node process)
               │
       in-memory room registry
         ┌─────┴─────┐
         ▼           ▼
 QuiplashEngine  TriviaEngine
```

The server is authoritative. Clients render `RoomState` and submit commands;
they never decide membership, phase transitions, scores, answer ownership, or
deadlines. A monotonically increasing `phaseId` makes control commands
single-use. `phaseEndsAt` and `serverNow` let browsers render smooth local
countdowns without a room-wide state broadcast every second.

This design deliberately has no database, Redis adapter, or cross-instance
coordination. Deploy exactly one instance. A process restart loses active rooms,
and horizontal replicas would diverge without shared state, sticky routing, and
a Socket.IO-compatible adapter.

## Session and room lifecycle

1. Create or join returns a public player ID and a random 32-byte resume token.
2. Only the token's SHA-256 digest is stored server-side. The browser keeps the
   raw token in session storage.
3. Rejoin accepts the token, rotates it, invalidates replay, and replaces any
   older socket bound to that player.
4. Disconnect reserves a player's seat for 120 seconds. Explicit leave removes
   the member immediately. An expired lease removes the member's answers and
   votes before releasing capacity.
5. A disconnected host gets a 10-second grace period. If necessary, the first
   connected active player in deterministic join order becomes controller; host
   authority is restored when the host resumes. The controller does not inherit
   every host power — see "Control authority" below.
6. Empty and idle rooms are disposed, including their engine timers. A room is
   reclaimed once everyone has disconnected and stayed quiet past a short
   abandoned-idle threshold, or once it has been silent past a longer hard
   limit regardless of connection state — so one forgotten browser tab cannot
   pin a room slot forever.

Socket.IO connection-state recovery can restore a transport, but application
authorization still comes from the current socket-to-player binding. Gameplay
handlers resolve that binding on every command.

State broadcasts are coalesced onto a microtask rather than sent inline with
every mutation. `Room.emit()` marks a broadcast pending and schedules
`flush()` via `queueMicrotask`; anything that mutates the room again before
the microtask runs (a kick that purges an engine's answers and votes, then
re-checks phase completion, for example) collapses into the same pending
flush. `flush()` sends at most one `room:state` per turn and increments
`phaseId` at most once — a control command bumps the revision to invalidate
in-flight commands, but a second bump in the same turn would invalidate the
caller's own next command before it could land. The socket layer calls
`room.flush()` explicitly at the end of each event handler, before invoking
the acknowledgement callback, so a client never receives an ack for a state
it has not yet seen.

## Control authority

Control commands (`start`, `advance`, `end`, `restart`, `rematch`,
`language`, `kick`) are gated by a `Capability` union shared between client
and server, not a single "is this the host" boolean. `Room.can(playerId,
capability)` is the single source of truth:

- The connected host may exercise every capability.
- When the host is gone, the room elects a deterministic stand-in (the first
  player to join) once the 10-second failover grace period lapses. The
  stand-in gets every capability **except `kick`**.

`kick` stays host-only because the election is deterministic — being first
into the lobby is public information, so if `kick` were inherited it would
hand a predictable player a reliable way to remove everyone else. Every
other capability is game flow the room can recover from (a bad restart or a
skipped round costs a few seconds; an unwanted kick costs someone their
session). `Room.controlError()` layers a `phaseId` check in front of the
capability check, so a stale command fails closed before authority is even
considered.

## Rate limiting

Every limiter reads its ceiling from the environment via `MATAH_RL_*`,
falling back to a default sized for a party sharing one NAT'd address rather
than a single visitor — after a Wi-Fi blip, every phone at the table
reconnects at once and must fit inside the same per-IP budget.

| Variable | Default | Scope | Limits |
|---|---|---|---|
| `MATAH_RL_CONN_BURST` | 60 | per IP | Socket.IO connection attempts (token bucket capacity) |
| `MATAH_RL_CONN_REFILL` | 2/s | per IP | Connection attempts refill rate |
| `MATAH_RL_ACTION_BURST` | 80 | per IP | Socket event actions (token bucket capacity) |
| `MATAH_RL_ACTION_REFILL` | 20/s | per IP | Socket event actions refill rate |
| `MATAH_RL_CREATE` | 10 | per IP / 10 min | `room:create` |
| `MATAH_RL_JOIN` | 60 | per IP / 60 s | `room:join` |
| `MATAH_RL_JOIN_ROOM` | 40 | per room code / 60 s | `room:join`, scoped to the target room so flooding one room costs the attacker rather than every other player behind the same router |
| `MATAH_RL_REJOIN` | 20 | per IP / 60 s | `room:rejoin`, which has its own ceiling because every successful rejoin fans a full room state out to up to 29 members |

Reactions have a separate, fixed (non-configurable) limit: 3 tokens refilling
at 3/s per socket, plus a 20/20 per-room bucket, since a reaction storm is a
cosmetic annoyance rather than a resource risk and does not need the same
operational tuning as the other five.

## Trust boundaries and abuse controls

- Production startup requires an exact `PUBLIC_ORIGIN`; optional additional
  origins are explicit. Handshakes without an allowed Origin fail closed.
- CSP allows scripts, connections, fonts, and images only from the application
  origin (plus inline application styles and data images where required).
- Room create and join limits use fixed, bounded IP windows. Gameplay uses a
  bounded per-socket limiter; reactions also have socket and room limits.
- Names and answers are NFC-normalized, stripped of control/bidirectional
  formatting characters, and truncated on Unicode code-point boundaries.
- Quiplash vote payloads expose random answer IDs and text only. Authorship is
  revealed after voting.
- Unexpected handler exceptions are logged with event and socket context while
  clients receive a generic typed error.

Room codes are discoverable identifiers, not secrets. Resume tokens are bearer
credentials and must never appear in logs, URLs, analytics, or screenshots.

## Game engines

Engines receive a narrow `EngineContext`: current participants, authoritative
time, phase scheduling, score awards, state emission, and scoreboard transfer.
Tests supply fake clocks and deterministic content controls through that
boundary.

Quiplash keeps answer ownership private during voting, includes connected
audience voters, and enforces a three-second minimum voting display. Trivia
shuffles each question's options server-side, accepts integer indexes only,
clamps elapsed time to the question window, and applies deterministic
streak/final multipliers. Rematches reuse settings while avoiding the
immediately previous content when the pool allows it.

### Quiplash scoring

Each matchup pays out a pool of `MATCHUP_POINT_POOL * round * humanCount /
answerCount`, split by vote share, plus a flat `SUBMIT_BONUS * round` for
every answer a player actually wrote (never for a canned safety quip). Two
rules keep the pool honest:

- **The pool scales with how many answers are real.** A matchup where one
  author timed out and got a canned safety quip pays out only half the pool
  a fully human matchup would — being paired with someone who didn't answer
  used to be the single highest-expected-value event in the game, because
  the lone human collected 100% of an unscaled pool. Now a lone human tops
  out at half the pool, however the room votes.
- **Votes for a safety quip still count in the denominator.** Vote share
  means "share of the room", not "share of the humans" — a troll vote for
  the canned line still costs its target something.

Worked example, round 2 (`MATCHUP_POINT_POOL = 1000`, `SUBMIT_BONUS = 100`):

| Matchup | Answers | Votes | Pool | Winner's points | Loser's points |
|---|---|---|---|---|---|
| Two real answers | 2 human | 3 vs 2 (5 total) | `1000 * 2 * 2/2 = 2000` | `round(3/5 * 2000) + (100*2) = 1400` | `round(2/5 * 2000) + (100*2) = 1000` |
| Human vs. safety quip, best case | 1 human, 1 quip | 5 vs 0 (5 total) | `1000 * 2 * 1/2 = 1000` | `round(5/5 * 1000) + (100*2) = 1200` | quip: `0` (safety answers never score) |

Even when every voter picks the human over the quip, the payout (1200) is
lower than the 60/40 split of a real matchup (1400) — the scaled pool caps
it. Writing nothing at all scores 0 for that matchup and forfeits the
submit bonus, so answering always beats waiting out the clock.

### Per-author prompt freshness

Each language's prompt pool is smaller than a long game consumes — eight
players over five rounds need forty prompts, and no language has that many —
so prompts repeat within a game. `pickPromptsForSlots` (in
`server/src/content/prompts.ts`) makes the repeat rule per author rather than
per room: a prompt may come up again as long as neither of its two new
authors has written for it before in this game. What stings is being asked
to answer a prompt you've already answered; a prompt reappearing with two
fresh authors is fine, and often funnier the second time.

Selection ranks candidates per slot rather than filtering them out, so a
slot is never left unfillable: prefer a prompt unused this game and unseen
by both authors, then unseen by both authors, then unseen by one, then
anything left. Pairing happens before prompt selection each round, so the
ranking can see who will actually author each matchup.

## Two things deliberately left alone

Two fixes were prototyped during the hardening pass and backed out, because
in both cases the fix was worse than the problem it solved.

- **`game:next` stays unthrottled.** A minimum dwell time and a higher token
  cost were both tried, and both broke legitimate play — a player clicking
  through a results screen the instant it appears is the button working, not
  abuse. What actually bounds `game:next` is authority: it's just another
  capability-gated control command, so only the host or the elected
  controller can call it at all. Rate isn't the right lever here.
- **Resume tokens have no grace window.** A grace period would stop a lost
  acknowledgement from stranding a session that in fact reconnected, but it
  would also mean an already-consumed token stays valid for a window after
  rotation — replayable, which is exactly what [SECURITY.md](../SECURITY.md)
  promises a resume token is not. A stranded session costs a lost game; a
  replayable credential costs the session outright. Tokens stay strictly
  single-use: `rejoin()` rotates the token on every successful use before
  returning it, and the old digest is gone from `sessionSecrets` the moment
  the new one is stored.

## Build, operations, and rollback

The build compiles shared/server TypeScript and creates lazy client chunks. The
multi-stage image prunes development dependencies, runs as the unprivileged
`node` user, and exposes `/health`. SIGTERM/SIGINT stop room timers and close the
HTTP/Socket.IO server.

`PUBLIC_ORIGIN` is also injected into canonical and social metadata by the
server when it serves the built HTML, keeping deploy metadata and the handshake
allowlist on one configuration value.

Rollback by reverting the release merge commit on `main`, then redeploying and
checking `/health`, the home page, and a host-plus-three-player game. Do not
rewrite shared history. A rollback necessarily ends active in-memory rooms.
