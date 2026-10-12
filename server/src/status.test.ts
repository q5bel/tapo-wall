import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCameraList } from './cameras.js';
import type { Config } from './config.js';
import {
  buildApiBaseUrl,
  buildPathsListUrl,
  deriveStatus,
  getStatus,
  parsePathItems,
  startStatusMonitor,
  stopStatusMonitor,
} from './status.js';

function testConfig(apiAddress = ':9997'): Config {
  return {
    httpPort: 3000,
    mediamtx: { hlsAddress: ':8888', apiAddress },
    cameras: [
      {
        id: 'office-front',
        name: 'Офис — вход',
        host: '192.168.1.101',
        port: 554,
        username: 'tapo',
        password: 'CHANGE_ME',
        streams: { hd: '/stream1', preview: '/stream2' },
      },
    ],
  };
}

/** Payload in the shape this module was specified against (`sourceReady`). */
function sourceReadyBody(entries: Array<[string, boolean]>): unknown {
  return {
    pageCount: 1,
    itemCount: entries.length,
    items: entries.map(([name, sourceReady]) => ({ name, sourceReady })),
  };
}

/** Payload in the shape the bundled MediaMTX 1.21 binary actually returns. */
function availableBody(entries: Array<[string, boolean]>): unknown {
  return {
    pageCount: 1,
    itemCount: entries.length,
    items: entries.map(([name, available]) => ({
      name,
      confName: name,
      // The real API reports online=true even when the source is unreachable,
      // so a correct reader must not use it.
      online: true,
      available,
      ready: available,
      source: { type: 'rtspSource', id: '' },
      readers: [],
    })),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** A `fetch`-compatible mock whose JSON body is `body`. */
function okFetch(body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async () => jsonResponse(body));
}

/** Let the immediate poll's promise chain settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  stopStatusMonitor();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('buildApiBaseUrl', () => {
  it.each([
    [':9997', 'http://localhost:9997'],
    ['0.0.0.0:9997', 'http://localhost:9997'],
    ['[::]:9997', 'http://localhost:9997'],
    ['9997', 'http://localhost:9997'],
    ['', 'http://localhost:9997'],
    [undefined, 'http://localhost:9997'],
    ['  :9997 ', 'http://localhost:9997'],
    ['not-a-port', 'http://localhost:9997'],
    ['192.168.1.5:9997', 'http://192.168.1.5:9997'],
    ['http://127.0.0.1:9998', 'http://127.0.0.1:9998'],
    ['http://localhost:9997/', 'http://localhost:9997'],
    ['https://cam.local:9443', 'https://cam.local:9443'],
    ['https://cam.local', 'https://cam.local:443'],
    ['http://0.0.0.0:9997', 'http://localhost:9997'],
  ])('normalizes %s to %s', (address, expected) => {
    expect(buildApiBaseUrl(address as string | undefined)).toBe(expected);
  });

  it('appends the path list endpoint', () => {
    expect(buildPathsListUrl(':9997')).toBe('http://localhost:9997/v3/paths/list');
  });
});

describe('parsePathItems', () => {
  it('reads sourceReady from the specified payload shape', () => {
    const paths = parsePathItems(sourceReadyBody([['cam_hd', true], ['cam_preview', false]]));

    expect(paths.get('cam_hd')).toBe(true);
    expect(paths.get('cam_preview')).toBe(false);
  });

  it('falls back to available (and the deprecated ready) for the bundled binary', () => {
    const payload = {
      items: [
        { name: 'cam_hd', online: true, available: true, ready: true },
        { name: 'cam_preview', online: true, available: false, ready: false },
        { name: 'cam_other', online: true, ready: true },
      ],
    };

    const paths = parsePathItems(payload);

    expect(paths.get('cam_hd')).toBe(true);
    expect(paths.get('cam_preview')).toBe(false);
    // No `available` at all: the deprecated alias still decides.
    expect(paths.get('cam_other')).toBe(true);
  });

  it('ignores malformed items and treats missing flags as not ready', () => {
    const paths = parsePathItems({
      items: [null, 'nope', {}, { name: '' }, { name: 'cam_hd' }],
    });

    expect(paths.size).toBe(1);
    expect(paths.get('cam_hd')).toBe(false);
  });

  it.each([[null], ['text'], [{}], [{ items: 'nope' }]])(
    'throws on a payload without an items array (%s)',
    (payload) => {
      expect(() => parsePathItems(payload)).toThrow();
    },
  );
});

describe('deriveStatus', () => {
  it.each([
    [true, true, 'online'],
    [false, false, 'offline'],
    [true, false, 'connecting'],
    [false, true, 'connecting'],
  ])('maps hd=%s preview=%s to %s', (hd, preview, expected) => {
    expect(deriveStatus(hd as boolean, preview as boolean)).toBe(expected);
  });
});

describe('getStatus', () => {
  it('defaults to connecting for an unknown camera', () => {
    expect(getStatus('never-seen')).toBe('connecting');
  });
});

describe('startStatusMonitor', () => {
  it('polls immediately and marks a camera online when both paths are ready', async () => {
    const config = testConfig();
    const fetchImpl = okFetch(availableBody([['office-front_hd', true], ['office-front_preview', true]]));

    startStatusMonitor(config, { fetchImpl: fetchImpl as unknown as typeof fetch, intervalMs: 10_000 });
    await flush();

    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:9997/v3/paths/list', expect.anything());
    expect(getStatus('office-front')).toBe('online');
    expect(buildCameraList(config, 'localhost')[0]?.status).toBe('online');
  });

  it('marks a camera offline when both paths are not ready or absent', async () => {
    const config = testConfig();

    startStatusMonitor(config, {
      fetchImpl: okFetch(availableBody([
        ['office-front_hd', false],
        ['office-front_preview', false],
      ])) as unknown as typeof fetch,
      intervalMs: 10_000,
    });
    await flush();

    expect(getStatus('office-front')).toBe('offline');
  });

  it('marks a camera connecting when only one path is ready', async () => {
    const config = testConfig();

    startStatusMonitor(config, {
      fetchImpl: okFetch(availableBody([['office-front_hd', true]])) as unknown as typeof fetch,
      intervalMs: 10_000,
    });
    await flush();

    expect(getStatus('office-front')).toBe('connecting');
  });

  it('keeps the previous statuses and logs once when the API fails', async () => {
    vi.useFakeTimers();
    const config = testConfig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () =>
      jsonResponse(availableBody([['office-front_hd', true], ['office-front_preview', true]])),
    );

    startStatusMonitor(config, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      intervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(getStatus('office-front')).toBe('online');

    fetchImpl.mockImplementation(async () => {
      throw new Error('ECONNREFUSED');
    });
    await vi.advanceTimersByTimeAsync(3_100);

    // Three failed polls later the last known status is still served...
    expect(getStatus('office-front')).toBe('online');
    // ...and the outage produced exactly one log line, not one per tick.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('MediaMTX paths API unavailable');
  });

  it('stops polling after stop()', async () => {
    vi.useFakeTimers();
    const config = testConfig();
    const fetchImpl = okFetch(sourceReadyBody([['office-front_hd', true]]));

    const monitor = startStatusMonitor(config, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      intervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(2_100);
    const callsWhileRunning = fetchImpl.mock.calls.length;

    monitor.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(callsWhileRunning).toBe(3); // immediate + 2 ticks
    expect(fetchImpl).toHaveBeenCalledTimes(callsWhileRunning);
  });

  it('is stopped by stopStatusMonitor', async () => {
    vi.useFakeTimers();
    const fetchImpl = okFetch(sourceReadyBody([]));

    startStatusMonitor(testConfig(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      intervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_100);
    stopStatusMonitor();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats a non-2xx response as a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = testConfig();

    startStatusMonitor(config, {
      fetchImpl: vi.fn(async () => jsonResponse({}, 500)) as unknown as typeof fetch,
      intervalMs: 10_000,
    });
    await flush();

    expect(getStatus('office-front')).toBe('connecting');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
