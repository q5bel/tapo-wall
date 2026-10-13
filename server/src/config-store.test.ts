import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LAYOUT, defaultConfig, type Camera, type Config } from './config.js';
import { ConfigStore, ConfigValidationError } from './config-store.js';

let tempDir: string | undefined;

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'mactapo-store-'));
  return tempDir;
}

function makeCamera(overrides: Partial<Camera> = {}): Camera {
  return {
    id: 'office-front',
    name: 'Офис — вход',
    host: '192.168.1.101',
    port: 554,
    username: 'tapo',
    password: 'secret',
    streams: { hd: '/stream1', preview: '/stream2' },
    ...overrides,
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...defaultConfig(),
    cameras: [makeCamera()],
    ...overrides,
  };
}

// Opening a store on a missing file is an expected case here; keep its warning
// out of the test output while still asserting on the spy where relevant.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('ConfigStore.load', () => {
  it('falls back to defaultConfig() when the file does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = await makeTempDir();

    const store = await ConfigStore.open(join(dir, 'cameras.json'));

    expect(store.get().cameras).toEqual([]);
    expect(store.get().httpPort).toBe(3000);
    expect(store.get().mediamtx).toEqual({ hlsAddress: ':8888', apiAddress: ':9997' });
    expect(warn).toHaveBeenCalledWith(
      'cameras.json not found; copy config/cameras.example.json to config/cameras.json',
    );
  });

  it('loads a valid file and gives every camera a layout', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'cameras.json');
    await writeFile(
      filePath,
      JSON.stringify({ httpPort: 4000, cameras: [makeCamera({ layout: { x: 5, y: 6 } })] }),
      'utf8',
    );

    const store = await ConfigStore.open(filePath);

    expect(store.get().httpPort).toBe(4000);
    expect(store.get().cameras).toHaveLength(1);
    expect(store.get().cameras[0]?.layout).toEqual({ ...DEFAULT_LAYOUT, x: 5, y: 6 });
  });
});

describe('ConfigStore.empty', () => {
  it('returns defaultConfig() in memory without reading or creating the file', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'cameras.json');

    const store = ConfigStore.empty(filePath);

    expect(store.get()).toEqual(defaultConfig());
    expect(store.get().cameras).toEqual([]);
    expect(existsSync(filePath)).toBe(false);
  });

  it('keeps the given path, so a later save persists there', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'cameras.json');

    const store = ConfigStore.empty(filePath);
    await store.save(makeConfig({ httpPort: 4500 }));

    const written = JSON.parse(await readFile(filePath, 'utf8')) as Config;
    expect(written.httpPort).toBe(4500);
    expect(store.get()).toEqual(written);
  });
});

describe('ConfigStore.save', () => {
  it('writes the file and keeps a .bak copy of the previous contents', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'cameras.json');
    const original = makeConfig({ httpPort: 3000 });
    await writeFile(filePath, JSON.stringify(original), 'utf8');

    const store = await ConfigStore.open(filePath);
    const next = makeConfig({ httpPort: 4100, cameras: [makeCamera({ name: 'New name' })] });
    await store.save(next);

    const written = JSON.parse(await readFile(filePath, 'utf8')) as Config;
    expect(written.httpPort).toBe(4100);
    expect(written.cameras[0]?.name).toBe('New name');
    expect(store.get()).toEqual(written);

    expect(existsSync(`${filePath}.bak`)).toBe(true);
    const backup = JSON.parse(await readFile(`${filePath}.bak`, 'utf8')) as Config;
    expect(backup).toEqual(original);
  });

  it('rejects duplicate camera ids with ConfigValidationError', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'cameras.json');
    const store = await ConfigStore.open(filePath);

    const next = makeConfig({
      cameras: [makeCamera({ id: 'dup' }), makeCamera({ id: 'dup', name: 'Second' })],
    });

    await expect(store.save(next)).rejects.toThrow(ConfigValidationError);
    await expect(store.save(next)).rejects.toThrow(/dup/);
  });

  it('rejects a config that fails schema validation', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'cameras.json');
    const store = await ConfigStore.open(filePath);

    const invalid = {
      ...makeConfig(),
      httpPort: '3000',
    } as unknown as Config;

    await expect(store.save(invalid)).rejects.toThrow(ConfigValidationError);
  });

  it('leaves no .tmp file behind', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'cameras.json');
    const store = await ConfigStore.open(filePath);

    await store.save(makeConfig({ httpPort: 4200 }));

    const entries = await readdir(dir);
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
    expect(entries).toContain('cameras.json');
  });
});

describe('ConfigStore.onChange', () => {
  it('notifies subscribers after save and stops after unsubscribe', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'cameras.json');
    const store = await ConfigStore.open(filePath);

    const seen: Config[] = [];
    const unsubscribe = store.onChange((config) => {
      seen.push(config);
    });

    await store.save(makeConfig({ httpPort: 4300 }));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.httpPort).toBe(4300);

    unsubscribe();
    await store.save(makeConfig({ httpPort: 4400 }));
    expect(seen).toHaveLength(1);
  });
});
