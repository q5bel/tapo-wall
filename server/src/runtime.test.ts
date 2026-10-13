import { describe, expect, it, vi } from 'vitest';

import type { Config } from './config.js';
import { applyConfig, mediamtxFingerprint, type RuntimeDeps } from './runtime.js';

function minimalConfig(): Config {
  return {
    httpPort: 3000,
    mediamtx: { hlsAddress: ':8888', apiAddress: ':9997' },
    cameras: [
      {
        id: 'cam1',
        name: 'Camera 1',
        host: '10.0.0.5',
        port: 554,
        username: 'user',
        password: 'pass',
        streams: { hd: '/stream1', preview: '/stream2' },
      },
    ],
  };
}

/** Deps stub recording calls, with an optional failure for `startMediamtx`. */
function makeDeps(error?: Error): {
  deps: RuntimeDeps;
  startMediamtx: ReturnType<typeof vi.fn>;
  startStatusMonitor: ReturnType<typeof vi.fn>;
} {
  const startMediamtx = vi.fn(async (_config: Config) => {
    if (error) {
      throw error;
    }
    return {};
  });
  const startStatusMonitor = vi.fn((_config: Config) => ({
    stop: () => {},
  }));

  return {
    deps: { startMediamtx, startStatusMonitor },
    startMediamtx,
    startStatusMonitor,
  };
}

describe('mediamtxFingerprint', () => {
  it('is stable for the same config', () => {
    const config = minimalConfig();

    expect(mediamtxFingerprint(config)).toBe(mediamtxFingerprint(minimalConfig()));
  });

  it('ignores camera order', () => {
    const first = minimalConfig();
    const second = minimalConfig();
    second.cameras.push({
      id: 'cam2',
      name: 'Camera 2',
      host: '10.0.0.6',
      port: 554,
      username: 'user',
      password: 'pass',
      streams: { hd: '/s1', preview: '/s2' },
    });
    first.cameras = [second.cameras[1]!, second.cameras[0]!];

    expect(mediamtxFingerprint(first)).toBe(mediamtxFingerprint(second));
  });

  it('ignores name and layout changes', () => {
    const baseline = minimalConfig();
    const renamed = minimalConfig();
    renamed.cameras[0]!.name = 'Renamed';
    renamed.cameras[0]!.layout = {
      x: 10,
      y: 20,
      w: 640,
      h: 360,
      rotation: 90,
      scale: 2,
    };

    expect(mediamtxFingerprint(renamed)).toBe(mediamtxFingerprint(baseline));
  });

  it('changes when host changes', () => {
    const baseline = minimalConfig();
    const changed = minimalConfig();
    changed.cameras[0]!.host = '10.0.0.9';

    expect(mediamtxFingerprint(changed)).not.toBe(mediamtxFingerprint(baseline));
  });

  it('changes when a camera is added', () => {
    const baseline = minimalConfig();
    const added = minimalConfig();
    added.cameras.push({
      id: 'cam2',
      name: 'Camera 2',
      host: '10.0.0.6',
      port: 554,
      username: 'user',
      password: 'pass',
      streams: { hd: '/s1', preview: '/s2' },
    });

    expect(mediamtxFingerprint(added)).not.toBe(mediamtxFingerprint(baseline));
  });

  it('changes when hlsAddress changes', () => {
    const baseline = minimalConfig();
    const changed = minimalConfig();
    changed.mediamtx.hlsAddress = ':9999';

    expect(mediamtxFingerprint(changed)).not.toBe(mediamtxFingerprint(baseline));
  });

  it('distinguishes an absent webrtcAddress from a present one', () => {
    const baseline = minimalConfig();
    const changed = minimalConfig();
    changed.mediamtx.webrtcAddress = ':8189';

    expect(mediamtxFingerprint(changed)).not.toBe(mediamtxFingerprint(baseline));
  });
});

describe('applyConfig', () => {
  it('does nothing when only name and layout changed', async () => {
    const prev = minimalConfig();
    const next = minimalConfig();
    next.cameras[0]!.name = 'Renamed';
    next.cameras[0]!.layout = {
      x: 10,
      y: 20,
      w: 640,
      h: 360,
      rotation: 90,
      scale: 2,
    };
    const { deps, startMediamtx, startStatusMonitor } = makeDeps();

    const result = await applyConfig(prev, next, deps);

    expect(startMediamtx).not.toHaveBeenCalled();
    expect(startStatusMonitor).not.toHaveBeenCalled();
    expect(result).toEqual({ warnings: [] });
  });

  it('restarts both once when host changed', async () => {
    const prev = minimalConfig();
    const next = minimalConfig();
    next.cameras[0]!.host = '10.0.0.9';
    const { deps, startMediamtx, startStatusMonitor } = makeDeps();

    const result = await applyConfig(prev, next, deps);

    expect(startStatusMonitor).toHaveBeenCalledTimes(1);
    expect(startStatusMonitor).toHaveBeenCalledWith(next);
    expect(startMediamtx).toHaveBeenCalledTimes(1);
    expect(startMediamtx).toHaveBeenCalledWith(next);
    expect(result).toEqual({ warnings: [] });
  });

  it('reports a mediamtx failure as a warning instead of throwing', async () => {
    const prev = minimalConfig();
    const next = minimalConfig();
    next.cameras[0]!.host = '10.0.0.9';
    const { deps, startStatusMonitor } = makeDeps(new Error('boom'));

    const result = await applyConfig(prev, next, deps);

    expect(result).toEqual({ warnings: ['failed to restart mediamtx: boom'] });
    expect(startStatusMonitor).toHaveBeenCalledTimes(1);
  });
});
