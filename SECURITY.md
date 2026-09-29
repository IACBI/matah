# Security Policy

Matah is a real-time party game. The server is authoritative for room
membership, phase changes, answers, votes, and scoring; clients should always
be treated as untrusted.

## Supported version

The project is currently pre-1.0. Security fixes are applied to the latest
commit on `main`. Older commits and third-party deployments are not maintained
by this project.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the
repository's **Security → Report a vulnerability** option when it is available.
If that option is unavailable, contact the repository owner privately through
their GitHub profile before sharing technical details publicly.

Include the affected commit or deployment, reproduction steps, expected impact,
and any suggested mitigation. Never include real resume tokens, personal data,
or credentials. You can expect an acknowledgement as soon as the maintainer has
reviewed the report; disclosure timing will be coordinated after a fix is ready.

## Session model

- Room codes identify rooms; they are not passwords.
- Player IDs are public identifiers and do not authorize reconnection.
- The private resume token returned by create/join is the reconnect credential.
  It is kept in browser session storage, must not be logged or shared, and is
  replaced by a newer resumed connection.
- Resume tokens are strictly single-use: a successful rejoin rotates the
  token immediately, before the client is told about it, and the previous
  token stops working. There is no grace window — a grace period would let a
  used token remain valid for a time, which would make it replayable.
- Control authority is scoped by capability, not an all-or-nothing host flag.
  If the host disconnects, an elected player controller can keep the game
  moving and may pause it, but `kick`, moving players between seats and the
  audience, and loading custom prompts are reserved to the connected host and
  are never granted to a stand-in.
- Custom prompts are host-written text shown to every player. They pass
  through the same sanitizer as names and answers (control and bidi
  characters stripped, length capped by code point) and are rendered as text,
  never as HTML.
- The server validates all game actions and phase transitions. UI restrictions
  are convenience controls, not authorization boundaries.

## Deployment guidance

- Serve production traffic over HTTPS/WSS and set `PUBLIC_ORIGIN` to the exact
  public origin. Do not use a wildcard in production.
- Keep Node.js and locked dependencies current. Review Dependabot and CI
  security results before deployment.
- Run the supplied container as its non-root user and preserve the `/health`
  check.
- In production the per-address limits and ceilings key on the right-most
  `X-Forwarded-For` entry, so the server must sit behind exactly one proxy
  that appends the real client address. With no proxy in front, a client can
  send its own header and take a fresh budget on every connection; with two,
  every visitor shares the outer proxy's address and the per-address ceilings
  apply to the whole audience at once. Check what your host's edge actually
  forwards before relying on either.
- Matah keeps active rooms in process memory. Use one application instance
  unless shared state and a Socket.IO-compatible scaling design have been
  implemented.
- `MATAH_REDIS_URL` usually carries a password. Set it as a secret in your
  platform, not in a committed file. Matah never logs it; log lines name only
  the host, port and key. Prefer `rediss://` when Redis is reached over a
  network you do not control.
- Avoid logging player answers, resume tokens, or full Socket.IO payloads.

## Data handling

The application has no database in its default configuration. Names, answers,
votes, scores, and session material exist only in server memory for the life of
a room.

When restart persistence is enabled (`MATAH_REDIS_URL` or
`MATAH_SNAPSHOT_FILE`), the same room data is also written to that store:
names, answers, votes, scores, custom prompts, and the address that created
each room. Resume credentials are written only as SHA-256 digests of random
256-bit tokens, which cannot be turned back into a working token. Snapshot
files are created with owner-only permissions (0600), and the Redis key
expires after 15 minutes. Snapshots older than that are ignored. Browser session data is scoped to the current tab session. Operators
are responsible for any additional proxy, analytics, or platform logs enabled
in their own deployment.
