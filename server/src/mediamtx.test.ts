import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import type { Config } from './config.js';
import { generateMediamtxYaml } from './mediamtx.js';

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

describe('generateMediamtxYaml', () => {
  it('emits two RTSP paths per camera with the expected addresses', () => {
    const parsed = parse(generateMediamtxYaml(minimalConfig()));

    expect(parsed.paths['cam1_hd'].source).toBe('rtsp://user:pass@10.0.0.5:554/stream1');
    expect(parsed.paths['cam1_preview'].source).toBe(
      'rtsp://user:pass@10.0.0.5:554/stream2',
    );
    expect(parsed.hlsAddress).toBe(':8888');
  });

  it('includes logging, HLS and API settings', () => {
    const parsed = parse(generateMediamtxYaml(minimalConfig()));

    expect(parsed.logLevel).toBe('info');
    // The path list endpoint the status monitor polls only exists when the API
    // is enabled, so it must be requested explicitly.
    expect(parsed.api).toBe(true);
    expect(parsed.apiAddress).toBe(':9997');
  });

  it('produces exactly two paths per camera', () => {
    const config = minimalConfig();
    config.cameras.push({
      id: 'cam2',
      name: 'Camera 2',
      host: '10.0.0.6',
      port: 8554,
      username: 'admin',
      password: 'p@ss:word',
      streams: { hd: '/s1', preview: '/s2' },
    });

    const parsed = parse(generateMediamtxYaml(config));

    expect(Object.keys(parsed.paths).sort()).toEqual([
      'cam1_hd',
      'cam1_preview',
      'cam2_hd',
      'cam2_preview',
    ]);
    expect(parsed.paths['cam2_preview'].source).toBe(
      'rtsp://admin:p@ss:word@10.0.0.6:8554/s2',
    );
  });

  it('produces an empty paths map when there are no cameras', () => {
    const config = minimalConfig();
    config.cameras = [];

    const parsed = parse(generateMediamtxYaml(config));

    expect(parsed.paths).toEqual({});
  });
});
