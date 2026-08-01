const DEFAULT_URL = 'http://localhost:3001';

/**
 * Resolve the server these smoke scripts talk to, failing with an actionable
 * message rather than a socket timeout when nothing is listening.
 *
 * `npm run test:smoke` sets TEST_URL to a freshly spawned server. Running a
 * script on its own targets the dev server on :3001.
 */
export async function testUrl() {
  const url = process.env.TEST_URL ?? DEFAULT_URL;
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3_000) });
    if (response.ok) return url;
    throw new Error(`/health returned ${response.status}`);
  } catch (error) {
    const hint = process.env.TEST_URL
      ? `TEST_URL=${url} is not serving /health`
      : `no server on ${DEFAULT_URL} — start one with \`npm run dev\`, ` +
        'or run the whole suite with `npm run build && npm run test:smoke`';
    console.error(`${hint} (${error.message})`);
    process.exit(1);
  }
}
