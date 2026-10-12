import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './config.js';

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
