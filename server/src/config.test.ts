import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LAYOUT, loadConfig, normalizeConfig } from './config.js';

const EXAMPLE_CONFIG = new URL('../../config/cameras.example.json', import.meta.url);

let tempDir: string | undefined;

async function writeTempConfig(contents: unknown): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'mactapo-config-'));
  const filePath = join(tempDir, 'cameras.json');
  await writeFile(
    filePath,
    typeof contents === 'string' ? contents : JSON.stringify(contents),
    'utf8',
  );
  return filePath;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('loadConfig', () => {
  it('parses config/cameras.example.json', async () => {
    const config = await loadConfig(EXAMPLE_CONFIG.pathname);

    expect(config.cameras).toHaveLength(2);
    expect(config.cameras[0]?.id).toBe('office-front');
    expect(config.cameras[1]?.host).toBe('192.168.1.102');
    expect(config.cameras[0]?.streams.hd).toBe('/stream1');
    expect(config.httpPort).toBe(3000);
    expect(config.mediamtx).toEqual({ hlsAddress: ':8888', apiAddress: ':9997' });
    // The example file carries no layout, so every camera gets the default one.
    expect(config.cameras[0]?.layout).toEqual(DEFAULT_LAYOUT);
    expect(config.cameras[1]?.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('returns an empty camera list when the file does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = join(tmpdir(), `mactapo-missing-${Date.now()}-${process.pid}.json`);

    const config = await loadConfig(missing);

    expect(config.cameras).toEqual([]);
    expect(config.httpPort).toBe(3000);
    expect(config.mediamtx).toEqual({ hlsAddress: ':8888', apiAddress: ':9997' });
    expect(warn).toHaveBeenCalledWith(
      'cameras.json not found; copy config/cameras.example.json to config/cameras.json',
    );
  });

  it('throws a descriptive error when a field fails validation', async () => {
    const filePath = await writeTempConfig({
      cameras: [
        {
          id: 'office-front',
          name: 'Офис — вход',
          host: '192.168.1.101',
          port: '554',
          username: 'tapo',
          password: 'secret',
          streams: { hd: '/stream1', preview: '/stream2' },
        },
      ],
    });

    await expect(loadConfig(filePath)).rejects.toThrow(/Invalid config/);
    await expect(loadConfig(filePath)).rejects.toThrow('cameras.0.port');
  });

  it('throws when the file contains malformed JSON', async () => {
    const filePath = await writeTempConfig('{ "httpPort": 3000,');

    await expect(loadConfig(filePath)).rejects.toThrow(/Failed to parse config/);
  });
});

describe('normalizeConfig', () => {
  const camera = {
    id: 'office-front',
    name: 'Офис — вход',
    host: '192.168.1.101',
    port: 554,
    username: 'tapo',
    password: 'secret',
    streams: { hd: '/stream1', preview: '/stream2' },
  };

  it('fills in DEFAULT_LAYOUT for a camera without a layout', () => {
    const config = normalizeConfig({ cameras: [camera] });

    expect(config.cameras).toHaveLength(1);
    expect(config.cameras[0]?.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps an explicit layout but fills the fields it omits', () => {
    const config = normalizeConfig({ cameras: [{ ...camera, layout: { x: 10, y: 20 } }] });

    expect(config.cameras[0]?.layout).toEqual({ ...DEFAULT_LAYOUT, x: 10, y: 20 });
  });

  it('wraps rotation into [0, 360)', () => {
    const config = normalizeConfig({
      cameras: [
        { ...camera, layout: { rotation: 400 } },
        { ...camera, id: 'cam-2', layout: { rotation: -30 } },
      ],
    });

    expect(config.cameras[0]?.layout.rotation).toBe(40);
    expect(config.cameras[1]?.layout.rotation).toBe(330);
  });

  it('clamps scale into [0.25, 4]', () => {
    const config = normalizeConfig({
      cameras: [
        { ...camera, layout: { scale: 10 } },
        { ...camera, id: 'cam-2', layout: { scale: 0.01 } },
      ],
    });

    expect(config.cameras[0]?.layout.scale).toBe(4);
    expect(config.cameras[1]?.layout.scale).toBe(0.25);
  });

  it('clamps w to at least 160 and h to at least 90', () => {
    const config = normalizeConfig({
      cameras: [
        { ...camera, layout: { w: 100, h: 10 } },
        { ...camera, id: 'cam-2', layout: { w: 321, h: 181 } },
      ],
    });

    expect(config.cameras[0]?.layout.w).toBe(160);
    expect(config.cameras[0]?.layout.h).toBe(90);
    expect(config.cameras[1]?.layout.w).toBe(321);
    expect(config.cameras[1]?.layout.h).toBe(181);
  });

  it('accepts a valid auth token', () => {
    const config = normalizeConfig({ auth: { token: 's3cret' } });

    expect(config.auth).toEqual({ token: 's3cret' });
  });

  it('accepts a missing auth section', () => {
    const config = normalizeConfig({});

    expect(config.auth).toBeUndefined();
    expect(config.cameras).toEqual([]);
  });

  it('throws a descriptive error when port is a string', () => {
    expect(() => normalizeConfig({ cameras: [{ ...camera, port: '554' }] })).toThrow(
      /cameras\.0\.port/,
    );
  });
});
