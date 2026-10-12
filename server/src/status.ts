import type { Config } from './config.js';

/**
 * Live status of one camera, derived from the MediaMTX paths API.
 *
 * - `online`     — both `${id}_hd` and `${id}_preview` have a connected source.
 * - `offline`    — neither path is connected (or the paths do not exist).
 * - `connecting` — exactly one of the two paths is connected.
 */
export type CameraStatus = 'online' | 'offline' | 'connecting';

/** MediaMTX API port used when `apiAddress` is empty or carries no port. */
const DEFAULT_API_PORT = 9997;

/** How often `GET /v3/paths/list` is polled. */
export const POLL_INTERVAL_MS = 5_000;

/** Per-request cap: a hung MediaMTX must never stall the poll loop. */
const REQUEST_TIMEOUT_MS = 2_000;

/**
 * Hosts that only mean "listen on every interface" and are therefore queried
 * on loopback. `apiAddress` is a *listen* address, not a client address.
 */
const WILDCARD_HOSTS = new Set(['', '*', '0.0.0.0', '::', '[::]']);

/** A relative URL for `apiAddress` (e.g. `:9997`): host is optional. */
function isRelativeAddress(raw: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
}

/** Parse the port from a listen address; `fallback` when unusable. */
function parsePort(address: string, fallback: number): number {
  const tail = address.slice(address.lastIndexOf(':') + 1).trim();
  const port = Number.parseInt(tail, 10);

  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : fallback;
}

/** Reduce a listen address to a host that is reachable from the server. */
function normalizeHost(host: string): string {
  const trimmed = host.trim();
  return WILDCARD_HOSTS.has(trimmed.toLowerCase()) ? 'localhost' : trimmed;
}

/** Host part of a relative listen address (`:9997` → `localhost`). */
function hostFromAddress(address: string): string {
  const colon = address.lastIndexOf(':');
  return normalizeHost(colon === -1 ? '' : address.slice(0, colon));
}

/**
 * Normalize `config.mediamtx.apiAddress` to an HTTP base URL.
 *
 * Accepts both the listen-address form MediaMTX uses (`:9997`, `0.0.0.0:9997`,
 * `[::]:9997`, a bare `9997`) and a full URL (`http://127.0.0.1:9997`). A
 * wildcard host means "every interface", so those are queried on loopback; an
 * explicit host is preserved.
 */
export function buildApiBaseUrl(apiAddress?: string): string {
  const raw = (apiAddress ?? '').trim();

  if (raw === '') {
    return `http://localhost:${DEFAULT_API_PORT}`;
  }

  if (!isRelativeAddress(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return `http://localhost:${DEFAULT_API_PORT}`;
    }

    const host = normalizeHost(url.hostname);
    const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80';

    return `${url.protocol}//${host}:${port}`;
  }

  return `http://${hostFromAddress(raw)}:${parsePort(raw, DEFAULT_API_PORT)}`;
}

/** Full URL of the MediaMTX path list endpoint. */
export function buildPathsListUrl(apiAddress?: string): string {
  return `${buildApiBaseUrl(apiAddress)}/v3/paths/list`;
}

/**
 * Decide whether one MediaMTX path currently has a connected source.
 *
 * The API shape has changed across MediaMTX releases, so field by field:
 *
 * - `sourceReady` — the name used by the API at the time this module was
 *   specified; honoured first when present.
 * - `available`   — the current name (MediaMTX 1.21, the binary in `bin/`);
 *   verified against it: it is `false` while the RTSP source is unreachable
 *   and flips to `true` once the source connects and tracks appear.
 * - `ready`       — the deprecated alias of `available`, still emitted by the
 *   binary, kept as a fallback for older releases.
 *
 * `online` is deliberately *not* used: the probe showed it is already `true`
 * for a configured-but-unreachable RTSP source, so it says nothing about the
 * source connection.
 */
function isSourceReady(item: Record<string, unknown>): boolean {
  if (typeof item.sourceReady === 'boolean') {
    return item.sourceReady;
  }
  if (typeof item.available === 'boolean') {
    return item.available;
  }
  if (typeof item.ready === 'boolean') {
    return item.ready;
  }

  return false;
}

/**
 * Read `items` out of a `/v3/paths/list` payload into a `name → source ready`
 * map.
 *
 * @throws When the payload is not an object carrying an `items` array; the
 *   caller treats that as a poll failure and keeps the previous statuses.
 */
export function parsePathItems(payload: unknown): Map<string, boolean> {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('MediaMTX paths response is not an object');
  }

  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    throw new Error('MediaMTX paths response has no items array');
  }

  const paths = new Map<string, boolean>();
  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const name = record.name;
    if (typeof name !== 'string' || name.length === 0) {
      continue;
    }

    paths.set(name, isSourceReady(record));
  }

  return paths;
}

/** Combine the two per-stream signals into one camera status. */
export function deriveStatus(hdReady: boolean, previewReady: boolean): CameraStatus {
  if (hdReady && previewReady) {
    return 'online';
  }
  if (!hdReady && !previewReady) {
    return 'offline';
  }

  return 'connecting';
}

/** Latest known status per camera id. */
const statuses = new Map<string, CameraStatus>();

/** Current status of a camera; `connecting` until the first successful poll. */
export function getStatus(cameraId: string): CameraStatus {
  return statuses.get(cameraId) ?? 'connecting';
}

/** Handle returned by {@link startStatusMonitor}. */
export interface StatusMonitorHandle {
  /** Stop polling and release the timer. Idempotent. */
  stop(): void;
}

/** Injectable knobs; production callers rely on the defaults. */
export interface StatusMonitorOptions {
  /** Poll period in milliseconds. */
  intervalMs?: number;
  /** `fetch` implementation; overridden by tests. */
  fetchImpl?: typeof fetch;
}

/** The running monitor, if any; a second start replaces the first. */
let activeMonitor: StatusMonitorHandle | null = null;

/** Stop the active monitor, if any. */
export function stopStatusMonitor(): void {
  activeMonitor?.stop();
}

/** Recompute the whole map from one successful poll. */
function applyStatuses(config: Config, paths: Map<string, boolean>): void {
  for (const camera of config.cameras) {
    statuses.set(
      camera.id,
      deriveStatus(
        paths.get(`${camera.id}_hd`) === true,
        paths.get(`${camera.id}_preview`) === true,
      ),
    );
  }
}

/**
 * Poll the MediaMTX paths API every {@link POLL_INTERVAL_MS} and keep
 * {@link getStatus} up to date.
 *
 * The first poll runs immediately so the API has data before the first
 * `/api/cameras` request. Fetch and parse failures are logged once per outage
 * (never once per tick) and leave the previous statuses untouched. The returned
 * handle must be used to stop the monitor; the timer is `unref`ed so it never
 * keeps the process alive on its own.
 */
export function startStatusMonitor(
  config: Config,
  options: StatusMonitorOptions = {},
): StatusMonitorHandle {
  activeMonitor?.stop();
  // A fresh monitor starts from scratch: stale statuses of a previous run must
  // not survive, and `connecting` is the honest state until the first poll.
  statuses.clear();

  const url = buildPathsListUrl(config.mediamtx.apiAddress);
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let inFlight = false;
  let failureLogged = false;

  const poll = async (): Promise<void> => {
    // A slow API must not stack requests behind the interval.
    if (stopped || inFlight) {
      return;
    }
    inFlight = true;

    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      applyStatuses(config, parsePathItems(await response.json()));
      // A later outage gets its own single line instead of staying silent.
      failureLogged = false;
    } catch (err) {
      if (!failureLogged) {
        failureLogged = true;
        console.warn(
          `[status] MediaMTX paths API unavailable (${url}): ${(err as Error).message}`,
        );
      }
    } finally {
      inFlight = false;
    }
  };

  const handle: StatusMonitorHandle = {
    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (activeMonitor === handle) {
        activeMonitor = null;
      }
    },
  };

  void poll();
  timer = setInterval(() => {
    void poll();
  }, intervalMs);
  timer.unref?.();

  activeMonitor = handle;
  return handle;
}
