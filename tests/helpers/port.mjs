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

