import type { Config } from './config.js';
import { buildMediamtxConfig } from './mediamtx.js';
import { startMediamtx } from './mediamtx-runner.js';
import { startStatusMonitor } from './status.js';

/**
 * Deterministic fingerprint of everything that reaches the generated
 * `mediamtx.yml`.
 *
 * `name` and `layout` are presentation-only and never make it into the
 * generated YAML, so they must not influence the fingerprint; camera order is
 * irrelevant too because MediaMTX paths are keyed by id. Paths are sorted so a
 * reordered `cameras` array still produces the same fingerprint.
 */
export function mediamtxFingerprint(config: Config): string {
  const built = buildMediamtxConfig(config);
  const paths = Object.keys(built.paths)
    .sort()
    .map((k) => [k, built.paths[k]!.source]);

  return JSON.stringify({
    hlsAddress: built.hlsAddress,
    apiAddress: built.apiAddress,
    webrtc: built.webrtc,
    webrtcAddress: built.webrtcAddress ?? null,
    paths,
  });
}

/** Outcome of one {@link applyConfig} call. */
export interface ApplyConfigResult {
  warnings: string[];
}

/** Injectable side effects; production callers rely on the defaults. */
export interface RuntimeDeps {
  startMediamtx: (config: Config) => Promise<unknown>;
  startStatusMonitor: (config: Config) => unknown;
}

/**
 * Apply a new configuration without restarting the HTTP server.
 *
 * MediaMTX and the status monitor are restarted only when the generated
 * `mediamtx.yml` would actually change; purely visual edits (`name`, `layout`)
 * leave both processes untouched. The status monitor is restarted first so it
 * already watches the new camera list when MediaMTX comes back up.
 *
 * Failures to restart MediaMTX are reported as warnings instead of being
 * thrown: the server keeps serving with the previous MediaMTX instance.
 */
export async function applyConfig(
  prev: Config,
  next: Config,
  deps: RuntimeDeps = { startMediamtx, startStatusMonitor },
): Promise<ApplyConfigResult> {
  const warnings: string[] = [];

  if (mediamtxFingerprint(prev) === mediamtxFingerprint(next)) {
    return { warnings };
  }

  deps.startStatusMonitor(next);

  try {
    await deps.startMediamtx(next);
  } catch (err) {
    warnings.push(`failed to restart mediamtx: ${(err as Error).message}`);
  }

  return { warnings };
}
