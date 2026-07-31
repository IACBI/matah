import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';

const scripts = [
  'e2e-test.mjs',
  'reconnect-test.mjs',
  'playagain-test.mjs',
  'csr-test.mjs',
  'disconnect-skip-test.mjs',
  'new-features-test.mjs',
  'host-tools-test.mjs',
];

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHealth(url, child, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // Server startup is asynchronous; retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server health timeout');
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('process exit timeout')), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function runScript(script) {
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server/dist/server/src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), PUBLIC_ORIGIN: url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (chunk) => { serverLog += chunk; });
  server.stderr.on('data', (chunk) => { serverLog += chunk; });

  try {
    await waitForHealth(url, server);
    const testProcess = spawn(process.execPath, [`tests/${script}`], {
      cwd: process.cwd(),
      env: { ...process.env, TEST_URL: url },
      stdio: 'inherit',
    });
    const exitCode = await waitForExit(testProcess, 180_000);
    if (exitCode !== 0) throw new Error(`${script} exited with ${exitCode}`);
  } finally {
    server.kill('SIGTERM');
    try {
      await waitForExit(server, 10_000);
    } catch {
      server.kill('SIGKILL');
    }
  }

  if (serverLog.includes('socket event failed')) {
    throw new Error(`${script} caused an unexpected server error:\n${serverLog}`);
  }
}

for (const script of scripts) {
  console.log(`\n--- ${script} ---`);
  await runScript(script);
}

console.log('\nAll isolated socket smoke tests passed.');
