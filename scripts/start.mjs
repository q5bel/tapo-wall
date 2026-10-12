#!/usr/bin/env node
/**
 * start.mjs — one-command launcher for tapo-wall.
 *
 * Pure Node ESM, zero dependencies. Runs three steps in order:
 *
 *   1. MediaMTX binary   — `bin/mediamtx` must exist; otherwise try
 *                          `scripts/fetch-mediamtx.mjs` (in-process import),
 *                          and if that cannot produce the binary, print the
 *                          manual instruction and exit non-zero.
 *   2. Web frontend      — `web/dist/index.html` must exist; otherwise build
 *                          it with `npm --prefix web run build`.
 *   3. Server            — hand the terminal over to `npm --prefix server run
 *                          start` (stdio inherited) and forward
 *                          SIGINT/SIGTERM/SIGHUP to the child so Ctrl-C stops
 *                          the server cleanly.
 *
 * Usage: npm start   (or: node scripts/start.mjs)
 *
 * Env:
 *   PORT                 passed through to the server (default 3000)
 *   SKIP_FETCH_MEDIAMTX  =1 to never auto-download, only report the problem
 *   SKIP_WEB_BUILD       =1 to never auto-build the frontend
 *   FORCE_WEB_BUILD      =1 to rebuild the frontend even when web/dist exists
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------- paths */

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');

const MEDIAMTX_BIN = join(ROOT, 'bin', 'mediamtx');
const FETCH_SCRIPT = join(SCRIPT_DIR, 'fetch-mediamtx.mjs');
const WEB_DIR = join(ROOT, 'web');
const WEB_INDEX = join(WEB_DIR, 'dist', 'index.html');
const SERVER_DIR = join(ROOT, 'server');

/** Paths printed relative to the repo root: shorter and copy-pasteable. */
const rel = (p) => relative(ROOT, p) || '.';

/* ----------------------------------------------------------------- logging */

const log = (...a) => console.log('[start]', ...a);
const warn = (...a) => console.warn('[start]', ...a);

/** Print the failure, the manual command, and exit with a non-zero code. */
function fail(message, hint) {
  console.error(`\n[start] ERROR: ${message}`);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

/* --------------------------------------------------------- step 1: mediamtx */

/** A usable binary: exists and is a non-empty regular file. */
function isUsableBinary(p) {
  try {
    const st = statSync(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

const MEDIAMTX_HINT =
  'Download it manually with:\n' +
  '  npm run fetch:mediamtx\n' +
  'or place the MediaMTX release binary at bin/mediamtx yourself.';

/**
 * Try `scripts/fetch-mediamtx.mjs`. It is a self-contained ESM entry point
 * that calls process.exit(1) on failure, so it runs in a child process: that
 * keeps its exit code and its stdout/stderr without risking this process.
 * Returns true when the binary is present afterwards.
 */
function tryFetchMediamtx() {
  if (!existsSync(FETCH_SCRIPT)) {
    warn(`missing ${rel(FETCH_SCRIPT)}; cannot download MediaMTX automatically.`);
    return false;
  }

  log(`bin/mediamtx not found — running ${rel(FETCH_SCRIPT)} ...`);
  const res = spawnSync(process.execPath, [FETCH_SCRIPT], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  if (res.error) {
    warn(`could not run ${rel(FETCH_SCRIPT)}: ${res.error.message}`);
    return false;
  }
  if (res.status !== 0) {
    warn(`${rel(FETCH_SCRIPT)} exited with code ${res.status ?? 'unknown'}.`);
    return false;
  }
  if (!isUsableBinary(MEDIAMTX_BIN)) {
    warn(`${rel(FETCH_SCRIPT)} reported success but ${rel(MEDIAMTX_BIN)} is missing.`);
    return false;
  }

  log(`MediaMTX ready: ${rel(MEDIAMTX_BIN)}`);
  return true;
}

function ensureMediamtx() {
  if (isUsableBinary(MEDIAMTX_BIN)) {
    log(`MediaMTX present: ${rel(MEDIAMTX_BIN)}`);
    return;
  }

  if (process.env.SKIP_FETCH_MEDIAMTX === '1') {
    fail(
      `${rel(MEDIAMTX_BIN)} is missing (auto-download disabled by SKIP_FETCH_MEDIAMTX=1).`,
      MEDIAMTX_HINT,
    );
  }

  if (tryFetchMediamtx()) return;

  fail(`could not obtain the MediaMTX binary at ${rel(MEDIAMTX_BIN)}.`, MEDIAMTX_HINT);
}

/* -------------------------------------------------------------- step 2: web */

function ensureWebBuild() {
  const forced = process.env.FORCE_WEB_BUILD === '1';

  if (!forced && existsSync(WEB_INDEX)) {
    log(`web build present: ${rel(WEB_INDEX)}`);
    return;
  }

  if (process.env.SKIP_WEB_BUILD === '1') {
    fail(
      `${rel(WEB_INDEX)} is missing (auto-build disabled by SKIP_WEB_BUILD=1).`,
      'Build the frontend manually with:\n  npm run build:web',
    );
  }

  // FORCE_WEB_BUILD with an existing dist is the only case where a failure
  // must NOT abort: the previous build still serves, so we warn and continue.
  const hadBuild = existsSync(WEB_INDEX);
  log(forced ? 'FORCE_WEB_BUILD=1 — rebuilding the frontend ...' : 'building frontend ...');

  const res = spawnSync('npm', ['--prefix', WEB_DIR, 'run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  if (res.error) {
    if (hadBuild) {
      warn(`frontend rebuild failed (${res.error.message}); using the existing build.`);
      return;
    }
    fail(
      `could not start the frontend build: ${res.error.message}`,
      'Build the frontend manually with:\n  npm run build:web',
    );
  }

  if (res.status !== 0 || !existsSync(WEB_INDEX)) {
    if (hadBuild) {
      warn(`frontend rebuild failed (exit ${res.status ?? 'unknown'}); using the existing build.`);
      return;
    }
    fail(
      `frontend build failed (exit ${res.status ?? 'unknown'}) — ${rel(WEB_INDEX)} was not produced.`,
      'Try building it directly to see the full error:\n  npm run build:web',
    );
  }

  log(`frontend built: ${rel(WEB_INDEX)}`);
}

/* ----------------------------------------------------------- step 3: server */

function startServer() {
  log('starting server (Ctrl-C to stop) ...');

  // stdio: 'inherit' hands the child the real terminal (logs and Ctrl-C).
  // On POSIX the child stays in our process group, so a terminal SIGINT
  // reaches it directly; the explicit forwarding below covers `kill <pid>`
  // and the Windows case, where signals are not delivered to children.
  const child = spawn('npm', ['--prefix', SERVER_DIR, 'run', 'start'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  let stopping = false;

  const forward = (signal) => {
    if (stopping) return;
    stopping = true;
    log(`received ${signal} — stopping server ...`);
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => forward(signal));
  }

  child.on('error', (err) => {
    fail(`could not start the server: ${err.message}`, 'Start it directly with:\n  npm --prefix server run start');
  });

  // Mirror the child's exit status, and mirror its terminating signal when
  // the shell convention allows it (128 + signal number).
  child.on('exit', (code, signal) => {
    if (signal) {
      const numbers = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
      const n = numbers[signal];
      process.exit(n ? 128 + n : 1);
    }
    process.exit(code ?? 0);
  });
}

/* --------------------------------------------------------------------- main */

function main() {
  log(`repo: ${ROOT}`);
  ensureMediamtx();
  ensureWebBuild();
  startServer();
}

main();
