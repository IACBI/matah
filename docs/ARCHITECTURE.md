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
   authority is restored when the host resumes.
6. Empty and idle rooms are disposed, including their engine timers.

Socket.IO connection-state recovery can restore a transport, but application
authorization still comes from the current socket-to-player binding. Gameplay
handlers resolve that binding on every command.

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
audience voters, enforces a three-second minimum voting display, and divides a
fixed per-matchup point pool among human answers. Trivia shuffles each question's
options server-side, accepts integer indexes only, clamps elapsed time to the
question window, and applies deterministic streak/final multipliers. Rematches
reuse settings while avoiding the immediately previous content when the pool
allows it.

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
