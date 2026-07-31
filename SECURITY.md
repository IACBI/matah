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
- The server validates all game actions and phase transitions. UI restrictions
  are convenience controls, not authorization boundaries.

## Deployment guidance

- Serve production traffic over HTTPS/WSS and set `PUBLIC_ORIGIN` to the exact
  public origin. Do not use a wildcard in production.
- Keep Node.js and locked dependencies current. Review Dependabot and CI
  security results before deployment.
- Run the supplied container as its non-root user and preserve the `/health`
  check.
- Matah stores active rooms only in process memory. Use one application
  instance unless shared state and a Socket.IO-compatible scaling design have
  been implemented.
- Avoid logging player answers, resume tokens, or full Socket.IO payloads.

## Data handling

The application has no database in its default configuration. Names, answers,
votes, scores, and session material exist only in server memory for the life of
a room. Browser session data is scoped to the current tab session. Operators
are responsible for any additional proxy, analytics, or platform logs enabled
in their own deployment.
