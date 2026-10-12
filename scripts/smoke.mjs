#!/usr/bin/env node
/**
 * Smoke test: the project must build and boot.
 *
 * Run with `npm run smoke` (or `node scripts/smoke.mjs`).
 *
 * Checks, in order:
 *   1. `npm --prefix server run build` and `npm --prefix web run build` succeed.
 *   2. The compiled server boots with MediaMTX disabled on a non-default port.
 *   3. `GET /api/health`   -> 200 and `{ ok: true }`.
 *   4. `GET /api/cameras`  -> 200 and `{ cameras: [...] }`.
 *   5. `GET /`             -> 200 and a built `index.html` (the `#root` div).
 *
 * Prints `SMOKE OK` on success, a plain-language reason otherwise, and always
 * terminates the server child before exiting with 0 or 1.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(repoRoot, 'server', 'dist', 'index.js');

const PORT = 3111;
const BASE = `http://localhost:${PORT}`;
const HEALTH_TRIES = 20;
const HEALTH_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 5_000;

let child = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reap the server child and *wait* for it to actually die before returning.
 * Calling kill() and exiting straight away is not enough: the signal is only
 * requested, so the parent can leave a live listener behind. Safe to call more
 * than once, and it escalates to SIGKILL if SIGTERM is ignored.
 */
async function stopChild() {
  const proc = child;
  child = null;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;

  const gone = new Promise((resolve) => proc.once('exit', resolve));
  const signal = (sig) => {
    try {
      // The child leads its own process group, so -pid also reaches anything it spawned.
      process.kill(-proc.pid, sig);
    } catch {
      try {
        proc.kill(sig);
      } catch {
        /* already gone */
      }
    }
  };

  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), 3000);
  await gone;
  clearTimeout(timer);
  console.log(`server stopped (pid ${proc.pid})`);
}

/** Entry point for every exit path: clean up first, then report the verdict. */
async function finish(code) {
  try {
    await stopChild();
  } catch (err) {
    console.error(`warning: could not stop server cleanly: ${err?.message ?? err}`);
  }
  process.exit(code);
}

// Last-resort synchronous sweep: if we are torn down by a signal, 'exit' still
// runs while the child pid is known. finish() has normally already reaped it.
process.on('exit', () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
});
process.on('SIGINT', () => {
  console.error('\ninterrupted');
  void finish(1);
});
process.on('SIGTERM', () => {
  void finish(1);
});

/**
 * Run one build step. On failure, replay the captured compiler output so the
 * reason is visible without rerunning anything by hand.
 */
function runStep(id, args) {
  console.log(`\n==> ${id}: npm ${args.join(' ')}`);
  const result = spawnSync('npm', args, {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (result.error) {
    throw new Error(`failed to run ${id}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (stdout.trim()) console.error(stdout.trimEnd());
    if (stderr.trim()) console.error(stderr.trimEnd());
    throw new Error(
      `${id} failed with exit code ${result.status}${result.signal ? ` (signal ${result.signal})` : ''}`,
    );
  }
}

async function waitForHealth() {
  let lastReason = 'no response';
  for (let attempt = 1; attempt <= HEALTH_TRIES; attempt += 1) {
    if (child && child.exitCode !== null) {
      throw new Error(
        `server exited early with code ${child.exitCode} before becoming healthy`,
      );
    }
    try {
      const res = await fetch(`${BASE}/api/health`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        console.log(`server ready after ${attempt} attempt(s)`);
        return;
      }
      lastReason = `GET /api/health returned ${res.status}`;
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
    }
    if (attempt < HEALTH_TRIES) await sleep(HEALTH_DELAY_MS);
  }
  throw new Error(
    `not ready after ${HEALTH_TRIES} attempts (${lastReason}); ` +
      `expected ${BASE}/api/health to answer 200`,
  );
}

async function getText(route) {
  const res = await fetch(`${BASE}${route}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: res.status, text: await res.text() };
}

async function getJson(route, expectedStatus = 200) {
  const { status, text } = await getText(route);
  if (status !== expectedStatus) {
    throw new Error(`GET ${route} expected ${expectedStatus}, got ${status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GET ${route} did not return JSON: ${text.slice(0, 200)}`);
  }
}

async function smoke() {
  // 1. Build both halves of the app.
  runStep('server build', ['--prefix', 'server', 'run', 'build']);
  runStep('web build', ['--prefix', 'web', 'run', 'build']);

  if (!existsSync(serverEntry)) {
    throw new Error(`server build produced no entry point at ${serverEntry}`);
  }

  // 2. Boot the server: no MediaMTX binary needed, RTSP left unopened.
  console.log(`\n==> starting server on port ${PORT} (MEDIAMTX_DISABLE=1)`);
  child = spawn(process.execPath, [serverEntry], {
    cwd: repoRoot,
    env: { ...process.env, MEDIAMTX_DISABLE: '1', PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.on('data', (buf) => process.stdout.write(`[server] ${buf}`));
  child.stderr.on('data', (buf) => process.stderr.write(`[server] ${buf}`));
  child.on('error', (err) => {
    console.error(`[server] failed to spawn: ${err.message}`);
  });

  // 3. Poll until the health endpoint answers.
  await waitForHealth();

  // 4. Assert the three public surfaces.
  const health = await getJson('/api/health');
  if (health.ok !== true) {
    throw new Error(`/api/health body.ok expected true, got ${JSON.stringify(health.ok)}`);
  }
  console.log('OK  /api/health      200 { ok: true }');

  const cameras = await getJson('/api/cameras');
  if (!Array.isArray(cameras.cameras)) {
    throw new Error(
      `/api/cameras body.cameras expected an array, got ${JSON.stringify(cameras.cameras)?.slice(0, 120)}`,
    );
  }
  console.log(`OK  /api/cameras     200 { cameras: [${cameras.cameras.length} item(s)] }`);

  const { status, text } = await getText('/');
  if (status !== 200) {
    throw new Error(`GET / expected 200, got ${status}: ${text.slice(0, 200)}`);
  }
  if (!/<div id="root">/.test(text)) {
    throw new Error(
      `GET / served no app shell (missing <div id="root">): ${text.slice(0, 200)}`,
    );
  }
  console.log('OK  /                200 index.html with <div id="root">');
}

try {
  await smoke();
  console.log('\nSMOKE OK');
  await finish(0);
} catch (err) {
  console.error(`\nSMOKE FAILED: ${err instanceof Error ? err.message : String(err)}`);
  await finish(1);
}
