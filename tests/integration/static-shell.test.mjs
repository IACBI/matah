import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { probePort } from '../helpers/port.mjs';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
// The shell only exists once the client is built; without it the server is
// API-only and there is nothing to substitute.
const clientBuilt = existsSync(path.join(repoRoot, 'client/dist/index.html'));

// PUBLIC_ORIGIN is read once at module load and must match the listening port,
// so this suite owns its own process and cannot retry onto another port.
const port = await probePort();
const url = `http://127.0.0.1:${port}`;
process.env.NODE_ENV = 'production';
process.env.PUBLIC_ORIGIN = url;
// Served directly with no proxy in front, so the shell does not depend on
// which forwarded headers are trusted.
process.env.MATAH_TRUST_PROXY_HOPS = '0';
const { startServer, stopServer } = await import('../../server/src/index.ts');

before(() => startServer(port));
after(() => stopServer());

for (const route of ['/', '/index.html']) {
  test(`GET ${route} serves the shell with the public origin substituted`, {
    skip: clientBuilt ? false : 'run `npm run build` to exercise static serving',
  }, async () => {
    const response = await fetch(`${url}${route}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /html/);
    const html = await response.text();
    assert.ok(html.includes(url), `the shell should name ${url}`);
    assert.doesNotMatch(html, /__PUBLIC_ORIGIN__/);
  });
}
