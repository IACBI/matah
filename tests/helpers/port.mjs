import { createServer } from 'node:net';

/**
 * Ask the OS for a free TCP port on the loopback interface.
 *
 * The probe has to close before the caller can bind, so another process can
 * always steal the port in between. Callers pass their own bind attempt as
 * `tryBind` and we retry on EADDRINUSE instead of failing the whole suite.
 */
export function probePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

const isPortTaken = (error) =>
  error?.code === 'EADDRINUSE' || error?.code === 'EACCES';

/**
 * Bind to a free port, retrying when another process wins the race.
 *
 * @param {(port: number) => Promise<T>} tryBind resolves once bound to `port`
 * @param {number} attempts how many ports to try before giving up
 * @returns {Promise<{ port: number, result: T }>}
 * @template T
 */
export async function bindAvailablePort(tryBind, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = await probePort();
    try {
      return { port, result: await tryBind(port) };
    } catch (error) {
      if (!isPortTaken(error)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error('could not find a free port');
}
