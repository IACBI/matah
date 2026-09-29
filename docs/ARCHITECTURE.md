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
       in-memory room registry ──── snapshot ───▶ file or Redis (optional)
      ┌────────┼────────┐
      ▼        ▼        ▼
 Quiplash   Trivia    Bluff
```

The server is authoritative. Clients render `RoomState` and submit commands;
they never decide membership, phase transitions, scores, answer ownership, or
deadlines. A monotonically increasing `phaseId` makes control commands
single-use. `phaseEndsAt` and `serverNow` let browsers render smooth local
countdowns without a room-wide state broadcast every second.

This design deliberately has no database, Redis adapter, or cross-instance
coordination. Deploy exactly one instance: horizontal replicas would diverge
without shared state, sticky routing, and a Socket.IO-compatible adapter. A
restart no longer has to end every game, though — see "Surviving a restart".

## Surviving a restart

With `MATAH_REDIS_URL` or `MATAH_SNAPSHOT_FILE` set, the server writes the
whole room registry to one snapshot: on SIGTERM/SIGINT, and every
`MATAH_SNAPSHOT_INTERVAL_MS` (default 15 s, minimum 1 s) while rooms are
changing. An unchanged registry is not re-saved. At boot the snapshot is read
back, so a deploy or a crash costs at most the last few seconds of play.

- **What is saved.** Each `Room.toSnapshot()` is plain JSON: members, phase,
  time left on the phase clock (running or paused), session standings, custom
  prompts, and the engine's own `snapshot()`. Resume credentials are stored
  only as the SHA-256 digests the room already keeps, never as tokens.
- **What comes back.** Every socket died with the old process, so everyone is
  restored disconnected, on the usual 120-second lease. Clients reconnect
  with the resume token they already hold. `phaseId` is bumped so no command
  composed before the restart can land, and a running phase gets 15 extra
  seconds for the room to reconnect.
- **Timers.** Phase timers are closures and cannot be saved. Each engine
  implements `timeoutHandler()`, which returns the callback for whatever phase
  it is in, and the room re-arms it with the time that was left.
- **Limits.** A snapshot older than 15 minutes is ignored. A room that fails
  to restore is skipped and logged, not fatal. The Redis key expires after 15
  minutes. It is still one process: two instances sharing a key would
  overwrite each other.

The Redis store speaks the few RESP2 commands it needs (AUTH, SELECT, GET,
SET with EX) over a short-lived connection per save, supporting `rediss://`
for TLS. With saves every few seconds at most, a pooled client library would
add a dependency and a reconnect state machine for no measurable gain.

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
falling back to a default sized for a shared address rather than a single
visitor. One IPv4 address can be an entire carrier NAT — mobile operators put
hundreds of subscribers behind one — and after a network blip all of them come
back at once running socket.io's retry ladder, so a budget sized for a single
household's phones would turn that into a queue. IPv6 folds to a /56, which
really is one household, but a default has to suit the worse case.

| Variable | Default | Scope | Limits |
|---|---|---|---|
| `MATAH_RL_CONN_BURST` | 120 | per IP | Socket.IO connection attempts (token bucket capacity) |
| `MATAH_RL_CONN_REFILL` | 8/s | per IP | Connection attempts refill rate |
| `MATAH_RL_ACTION_BURST` | 400 | per IP | Socket event actions (token bucket capacity); each socket also has its own 20/10-per-s bucket |
| `MATAH_RL_ACTION_REFILL` | 100/s | per IP | Socket event actions refill rate |
| `MATAH_RL_CREATE` | 30 | per IP / 10 min | `room:create`, with `MATAH_RL_ROOMS_PER_IP` below as the actual brake on saturation |
| `MATAH_RL_JOIN` | 60 | per IP / 60 s | `room:join`; deliberately not widened with the rest, since a wrong room code is charged here and nowhere else |
| `MATAH_RL_JOIN_ROOM` | 40 | per room code / 60 s | `room:join`, scoped to the target room so flooding one room costs the attacker rather than every other player behind the same router |
| `MATAH_RL_REJOIN` | 120 | per IP / 60 s | `room:rejoin`, which has its own ceiling because every successful rejoin fans a full room state out to up to 29 members |
| `MATAH_RL_MAX_CONNECTIONS` | 5000 | whole server | live Socket.IO sessions, refused at the handshake |
| `MATAH_RL_CONNECTIONS_PER_IP` | 250 | per IP | one address's share of those live sessions |
| `MATAH_RL_ROOMS_PER_IP` | 20 | per IP | rooms one address may own at the same time |

"Per IP" means per rate-limit identity rather than per address as received: an
IPv4-mapped IPv6 address folds to its dotted form and a native IPv6 address
folds to its /56 network, which is what the HTTP limiter in front of them all
keys on too. A client holding an IPv6 prefix can source every connection from
a different address inside it for free — SLAAC privacy extensions do exactly
that unprompted — so keying on the address itself would hand each connection
a brand-new budget and void every ceiling in the table.

The last three entries are counts rather than rates, because a rate says
nothing about accumulation. A session that answers engine.io's pings is never
reclaimed and a room whose creator stays connected is never swept, so a client
staying inside every rate above can still pile up sessions until the one
process hosting every room runs out of heap, or hold all 500 registry slots
until `room:create` returns `server_busy` to everyone else. Both ceilings are
checked before engine.io allocates the socket and never touch sessions that
already exist, so shedding new load leaves running games alone; the room quota
counts only rooms still owned, so releasing one hands the slot back.

The rates above are generous because they are no longer the only brake. A
create rate was once the only thing between one client and all 500 registry
slots; now the quota is, so the rate can suit a carrier NAT without reopening
that. The two per-address counts are each a small share of their global
ceiling — 5 % of the sessions, 4 % of the registry — so filling either still
takes 20-odd distinct addresses. They do not stop someone with a delegated
prefix to spend (a /48 holds 256 distinct /56 keys); they stop the single
client, which is the attack the reference deployments actually face.

The global ceiling on its own would keep the process alive without keeping it
useful — one client can reach it unaided and every other player is then turned
away — so `MATAH_RL_CONNECTIONS_PER_IP` is each address's share of it. Live
sessions are counted at the engine.io layer rather than on `io.on("connection")`,
so a handshake that never sends a CONNECT frame still costs its address the
socket it is holding. `MATAH_RL_MAX_CONNECTIONS` sits above what a full
registry implies (500 rooms of up to 8 players, 20 audience and a host) and far
below the heap the process has, so reaching it is a refusal rather than a
crash.

In front of all of those sits one HTTP limiter of 120 requests per IP per
minute, covering the health endpoint and the SPA shell. It deliberately does
not count `/assets/`: those bundles are fingerprinted and served
`immutable` for a year, so a client fetches each exactly once, and charging a
dozen of them to every page load would let a household spend the whole budget
just by opening the app. So that the exemption cannot become an unmetered
source of HTML, a miss under `/assets/` returns 404 rather than falling
through to the shell.

Reactions have a separate, fixed (non-configurable) limit: 3 tokens refilling
at 3/s per socket, plus a 20/20 per-room bucket, since a reaction storm is a
cosmetic annoyance rather than a resource risk and does not need the same
operational tuning as the limits above.

## Trust boundaries and abuse controls

- Production startup requires an exact `PUBLIC_ORIGIN`; optional additional
  origins are explicit. Handshakes without an allowed Origin fail closed.
- CSP allows scripts, connections, fonts, and images only from the application
  origin (plus inline application styles and data images where required).
- Room create and join limits use fixed, bounded IP windows. Gameplay uses a
  bounded per-socket limiter; reactions also have socket and room limits.
- Names and answers are NFC-normalized, stripped of control/bidirectional
  formatting characters, and truncated on Unicode code-point boundaries. The
  one exception is a zero-width joiner or non-joiner between two characters it
  can join, which is kept: emoji sequences (👩‍💻, 🏳️‍🌈) and Persian or Indic
  words depend on it. A joiner with nothing on either side is dropped like any
  other invisible character.
- Quiplash vote payloads expose random answer IDs and text only, in an order
  shuffled once per matchup so that neither submission order nor the canned
  safety quips sitting last identifies an author. Round pairings are shuffled
  too, so a matchup's index cannot be read against the broadcast roster.
  Authorship is revealed after voting.
- While quiplash is answering or voting, per-player `hasSubmitted` and
  `hasVoted` are replaced by the aggregate counts in `RoomState.progress`:
  whoever has not answered wrote the canned quip on screen, and the connected
  players who have not voted on a matchup are exactly its two authors. Audience
  vote flags stay public — the audience writes nothing — and a reconnecting
  player recovers their own vote state from their private assignment. Trivia
  keeps the per-player flags; it has no anonymous authorship to protect.
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
audience voters, and enforces a three-second minimum voting display. Once a
round's voting is over, its results name who voted for each answer. Trivia
shuffles each question's options server-side, accepts integer indexes only,
clamps elapsed time to the question window, and applies deterministic
streak/final multipliers. Rematches reuse settings while avoiding the
immediately previous content when the pool allows it.

Bluff reuses the trivia pool, so every language gets the mode without content
of its own. Players write a fake answer to a question, then pick the real one
from the truth and everyone's lies, shuffled. Answers are compared loosely
(case, accents, spacing and punctuation ignored): writing the truth is refused
with `answer_is_truth`, and identical lies merge into one option credited to
every author. When too few lies arrive, the question's own wrong trivia
options fill in as house decoys. A player can never pick their own lie; the
private assignment tells each phone which option that is. Finding the truth
scores 500, and each player fooled scores 250 for every author of that lie,
both doubled on the final question.

### Pausing

`game:pause` freezes the phase clock. The room keeps the time left and the
timer's callback, and engines read a game clock with every pause cut out, so
trivia speed scoring and the Quiplash minimum voting display never count a
pause against anyone. Gameplay submissions are refused with `game_paused`, so
nothing can complete a phase behind a frozen clock. `game:resume` re-arms the
timer and re-checks completion for anyone who dropped while it was frozen. Any
phase change, including a skip, starts the next phase on a live clock.

### Session standings, highlights, seats and prompt packs

Every game that reaches the scoreboard, including one ended early, banks each
player's score into `sessionScore` and credits a win to the top score (ties
share it). The scoreboard also shows the game's highlights: the most-voted
Quiplash answers or the Bluff lies that fooled the most players. In the lobby
the host can move a player to the audience and back. Someone sent to the
audience stays there across games, rather than being promoted straight back
at the next start. The host can also load up to 30 Quiplash prompts of their
own (90 code points each). These are sanitized like any user text and played
before the built-in prompts, without breaking the per-author rule below.
`maxHttpBufferSize` is 16 KiB so a full multi-byte pack fits in one frame.

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
HTTP/Socket.IO server, saving a room snapshot first when persistence is
configured.

`PUBLIC_ORIGIN` is also injected into canonical and social metadata by the
server when it serves the built HTML, keeping deploy metadata and the handshake
allowlist on one configuration value.

Rollback by reverting the release merge commit on `main`, then redeploying and
checking `/health`, the home page, and a host-plus-three-player game. Do not
rewrite shared history. Without persistence a rollback ends active rooms. With
it, rooms survive only if the older release reads the same snapshot version;
otherwise they are ignored and start fresh.
