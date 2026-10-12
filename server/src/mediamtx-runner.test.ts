import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Config } from './config.js';
import { MEDIAMTX_CONFIG_PATH, startMediamtx } from './mediamtx-runner.js';

const originalBin = process.env.MEDIAMTX_BIN;
const tempDirs: string[] = [];

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

/** True while the pid is alive (or a not-yet-reaped zombie). */
function isAlive(pid: number | undefined): boolean {
  if (pid === undefined) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A stand-in for the real binary: stays up until it receives SIGTERM. */
async function fakeMediamtxBin(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mediamtx-runner-'));
  tempDirs.push(dir);
  const path = join(dir, 'mediamtx');
  await writeFile(path, '#!/bin/sh\ntrap "exit 0" TERM\nwhile true; do sleep 0.2; done\n');
  await chmod(path, 0o755);
  return path;
}

afterEach(async () => {
  if (originalBin === undefined) {
    delete process.env.MEDIAMTX_BIN;
  } else {
    process.env.MEDIAMTX_BIN = originalBin;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('startMediamtx', () => {
  it('fails with a helpful message when the binary is missing', async () => {
    process.env.MEDIAMTX_BIN = join(tmpdir(), 'mediamtx-does-not-exist');

    await expect(startMediamtx(minimalConfig())).rejects.toThrow(
      /bin\/mediamtx not found; run: npm run fetch:mediamtx/,
    );
  });

  it.skipIf(process.platform === 'win32')(
    'writes the generated YAML, runs the binary and stops it',
    async () => {
      process.env.MEDIAMTX_BIN = await fakeMediamtxBin();

      const handle = await startMediamtx(minimalConfig());

      expect(handle.pid).toBeGreaterThan(0);
      expect(isAlive(handle.pid)).toBe(true);
      expect(handle.configPath).toBe(MEDIAMTX_CONFIG_PATH);

      const yaml = await readFile(MEDIAMTX_CONFIG_PATH, 'utf8');
      expect(yaml).toContain('hlsAddress: :8888');
      expect(yaml).toContain('rtsp://user:pass@10.0.0.5:554/stream1');

      await handle.stop();
      expect(isAlive(handle.pid)).toBe(false);

      // stop() is idempotent.
      await expect(handle.stop()).resolves.toBeUndefined();
    },
  );

  it.skipIf(process.platform === 'win32')(
    'stops the previous process when started again',
    async () => {
      process.env.MEDIAMTX_BIN = await fakeMediamtxBin();

      const first = await startMediamtx(minimalConfig());
      const second = await startMediamtx(minimalConfig());

      expect(isAlive(first.pid)).toBe(false);
      expect(isAlive(second.pid)).toBe(true);

      await second.stop();
    },
  );
});
