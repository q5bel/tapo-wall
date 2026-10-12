import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import type { Config } from './config.js';
import { generateMediamtxYaml } from './mediamtx.js';

/**
 * Paths are derived from `import.meta.url` so they resolve identically whether
 * the module is run from `server/src` (tsx / vitest) or `server/dist` (build):
 * both live two levels below the repository root.
 */

/** Repository root; also the working directory of the MediaMTX process. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** MediaMTX binary bundled by `npm run fetch:mediamtx` (`<repo>/bin/mediamtx`). */
export const DEFAULT_MEDIAMTX_BIN = fileURLToPath(
  new URL('../../bin/mediamtx', import.meta.url),
);

/** Runtime state directory (`server/.run`, git-ignored). */
export const MEDIAMTX_RUN_DIR = fileURLToPath(new URL('../.run/', import.meta.url));

/** Generated MediaMTX config consumed by the child process. */
export const MEDIAMTX_CONFIG_PATH = fileURLToPath(
  new URL('../.run/mediamtx.yml', import.meta.url),
);

/** How long to wait for SIGTERM before escalating to SIGKILL. */
const STOP_TIMEOUT_MS = 5000;

/** How long to wait for SIGKILL; the process is unkillable past this point. */
const KILL_TIMEOUT_MS = 2000;

/** Running MediaMTX process, or `null` when nothing is running. */
let currentHandle: MediamtxHandle | null = null;

/** Handle to a running MediaMTX child process. */
export interface MediamtxHandle {
  /** Process id of the child, or `undefined` if it never spawned. */
  readonly pid: number | undefined;
  /** Absolute path of the generated YAML the child was started with. */
  readonly configPath: string;
  /** Terminate the child (SIGTERM, then SIGKILL after a timeout). Idempotent. */
  stop(): Promise<void>;
}

/** The currently running MediaMTX handle, or `null`. */
export function getMediamtxHandle(): MediamtxHandle | null {
  return currentHandle;
}

/** Stop the current MediaMTX process, if any. */
export async function stopMediamtx(): Promise<void> {
  const handle = currentHandle;
  if (handle) {
    await handle.stop();
  }
}

/**
 * Resolve the MediaMTX binary: `MEDIAMTX_BIN` when set, otherwise the bundled
 * `<repo>/bin/mediamtx`.
 */
export function resolveMediamtxBin(): string {
  const override = process.env.MEDIAMTX_BIN?.trim();
  return override && override.length > 0 ? override : DEFAULT_MEDIAMTX_BIN;
}

/** True once the child has exited (normally or by signal). */
function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Resolve `true` when the child exits within `ms`, `false` on timeout. */
function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (hasExited(child)) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout;
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, ms);
    child.once('exit', onExit);
  });
}

/** Forward a child stream to the console, one `[mediamtx]` line per line. */
function pipeToConsole(
  stream: NodeJS.ReadableStream | null,
  streamName: 'stdout' | 'stderr',
): () => void {
  if (!stream) {
    return () => {};
  }

  const reader = createInterface({ input: stream });
  reader.on('line', (line) => {
    console.log(`[mediamtx] ${line}`);
  });
  stream.on('error', (err: Error) => {
    console.error(`[mediamtx] failed to read ${streamName}: ${err.message}`);
  });

  return () => reader.close();
}

/**
 * Start MediaMTX for the given application config.
 *
 * Writes the generated YAML to `server/.run/mediamtx.yml`, spawns the binary
 * with that file as its only argument, and pipes its output to the console with
 * a `[mediamtx]` prefix. Any previously started process is stopped first so a
 * single runner instance owns the MediaMTX ports.
 *
 * @throws When the binary is missing, or the process cannot be spawned.
 */
export async function startMediamtx(config: Config): Promise<MediamtxHandle> {
  const binPath = resolveMediamtxBin();
  if (!existsSync(binPath)) {
    throw new Error(
      `bin/mediamtx not found; run: npm run fetch:mediamtx (looked for ${binPath})`,
    );
  }

  const configPath = MEDIAMTX_CONFIG_PATH;
  await mkdir(MEDIAMTX_RUN_DIR, { recursive: true });
  await writeFile(configPath, generateMediamtxYaml(config), 'utf8');

  // Release the ports before the replacement starts.
  await stopMediamtx();

  const child = spawn(binPath, [configPath], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const onSpawn = (): void => {
      child.off('error', onError);
      resolve();
    };
    const onError = (err: Error): void => {
      child.off('spawn', onSpawn);
      reject(new Error(`failed to start MediaMTX (${binPath}): ${err.message}`));
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });

  console.log(`[mediamtx] started pid=${child.pid} config=${configPath}`);

  const closeStdout = pipeToConsole(child.stdout, 'stdout');
  const closeStderr = pipeToConsole(child.stderr, 'stderr');

  child.on('exit', (code, signal) => {
    console.log(`[mediamtx] exited code=${code ?? 'null'} signal=${signal ?? 'none'}`);
    // Nothing left to protect: keeping the handlers installed would make this
    // process ignore SIGINT/SIGTERM from now on.
    detachSignals();
    if (currentHandle === handle) {
      currentHandle = null;
    }
  });

  let stopPromise: Promise<void> | null = null;

  /** Kill the child and release the process-level listeners we installed. */
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      try {
        if (!hasExited(child)) {
          child.kill('SIGTERM');
          if (!(await waitForExit(child, STOP_TIMEOUT_MS))) {
            console.warn('[mediamtx] no exit after SIGTERM; sending SIGKILL');
            child.kill('SIGKILL');
            await waitForExit(child, KILL_TIMEOUT_MS);
          }
        }
      } finally {
        // Detach only once the child is reaped: while shutdown is in flight a
        // second SIGINT/SIGTERM must not kill this process and orphan the child.
        detachSignals();
        closeStdout();
        closeStderr();
        if (currentHandle === handle) {
          currentHandle = null;
        }
      }
    })();

    return stopPromise;
  };

  const handle: MediamtxHandle = {
    get pid() {
      return child.pid;
    },
    configPath,
    stop,
  };

  // `exit` cannot await anything, so the child is killed synchronously there.
  const onProcessExit = (): void => {
    if (!hasExited(child)) {
      child.kill('SIGKILL');
    }
  };

  const onSignal = (signal: NodeJS.Signals): void => {
    void stop().then(() => {
      // Re-raise only when no other handler owns the signal; otherwise the
      // server's own shutdown logic stays in charge of the process.
      if (process.listenerCount(signal) === 0) {
        process.kill(process.pid, signal);
      }
    });
  };

  const onSigint = (): void => onSignal('SIGINT');
  const onSigterm = (): void => onSignal('SIGTERM');

  function detachSignals(): void {
    process.off('exit', onProcessExit);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }

  process.on('exit', onProcessExit);
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  currentHandle = handle;
  return handle;
}
