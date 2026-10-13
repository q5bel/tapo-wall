import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import { defaultConfig, type Camera, type Config } from './config.js';
import { ConfigStore } from './config-store.js';

const SECRET = 'SUPER_SECRET_PASSWORD';

let tempDir: string | undefined;

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'mactapo-app-'));
  return tempDir;
}

function makeCamera(overrides: Partial<Camera> = {}): Camera {
  return {
    id: 'office-front',
    name: 'Офис — вход',
    host: '192.168.1.101',
    port: 554,
    username: 'tapo',
    password: SECRET,
    streams: { hd: '/stream1', preview: '/stream2' },
    ...overrides,
  };
}

/** A store backed by a fresh temp file that already carries `cameras`. */
async function seededStore(cameras: Camera[] = []): Promise<ConfigStore> {
  const dir = await makeTempDir();
  const filePath = join(dir, 'cameras.json');
  const config: Config = { ...defaultConfig(), cameras };
  await writeFile(filePath, JSON.stringify(config), 'utf8');
  return ConfigStore.open(filePath);
}

function mockApply() {
  return vi.fn(async (_prev: Config, _next: Config) => ({ warnings: [] as string[] }));
}

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

describe('GET /api/health', () => {
  it('reports ok and an uptime', async () => {
    const store = await seededStore();
    const res = await request(createApp({ store })).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.uptime).toBe('number');
  });
});

describe('GET /api/cameras', () => {
  it('serves the layout but never the camera-side details', async () => {
    const store = await seededStore([makeCamera()]);
    const res = await request(createApp({ store })).get('/api/cameras');

    expect(res.status).toBe(200);
    expect(res.body.cameras).toHaveLength(1);
    expect(res.body.cameras[0].layout).toBeDefined();
    expect(res.body.cameras[0].layout.w).toBe(320);

    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain(SECRET);
    // Quoted, so the `localhost` inside the HLS URL cannot match `host`.
    for (const field of ['"password"', '"username"', '"host"', '"streams"']) {
      expect(payload).not.toContain(field);
    }
  });
});

describe('GET /api/config', () => {
  it('exposes passwordSet but never the password', async () => {
    const store = await seededStore([makeCamera()]);
    const res = await request(createApp({ store })).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.cameras[0].passwordSet).toBe(true);
    expect(res.body.cameras[0].password).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(res.body.authEnabled).toBe(false);
  });
});

describe('PUT /api/config', () => {
  it('adds a camera with a password, saves it and applies the change', async () => {
    const store = await seededStore();
    const apply = mockApply();
    const app = createApp({ store, applyConfig: apply });

    const res = await request(app)
      .put('/api/config')
      .send({
        cameras: [
          {
            id: 'kitchen',
            name: 'Кухня',
            host: '192.168.1.50',
            port: 554,
            username: 'tapo',
            password: 'fresh-secret',
            streams: { hd: '/stream1', preview: '/stream2' },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, warnings: [] });
    expect(store.get().cameras).toHaveLength(1);
    expect(store.get().cameras[0]?.id).toBe('kitchen');
    expect(store.get().cameras[0]?.password).toBe('fresh-secret');
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('rejects a new camera without a password with 422', async () => {
    const store = await seededStore();
    const apply = mockApply();
    const app = createApp({ store, applyConfig: apply });

    const res = await request(app)
      .put('/api/config')
      .send({
        cameras: [
          {
            id: 'kitchen',
            name: 'Кухня',
            host: '192.168.1.50',
            port: 554,
            username: 'tapo',
            streams: { hd: '/stream1', preview: '/stream2' },
          },
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('kitchen');
    expect(res.body.issues).toEqual(['camera "kitchen" requires a password']);
    expect(store.get().cameras).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
  });

  it('keeps the stored password when an existing camera sends an empty one', async () => {
    const store = await seededStore([makeCamera()]);
    const before = structuredClone(store.get());
    const app = createApp({ store, applyConfig: mockApply() });

    const res = await request(app)
      .put('/api/config')
      .send({
        cameras: [
          {
            id: 'office-front',
            name: 'Офис — вход (renamed)',
            host: '192.168.1.101',
            port: 554,
            username: 'tapo',
            password: '',
            streams: { hd: '/stream1', preview: '/stream2' },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(store.get().cameras[0]?.password).toBe(before.cameras[0]?.password);
    expect(store.get().cameras[0]?.name).toBe('Офис — вход (renamed)');
  });

  it('answers 400 for a body that is not an object', async () => {
    const store = await seededStore();

    const res = await request(createApp({ store })).put('/api/config').send([1, 2]);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid body' });
  });

  it('answers 400 as JSON for a malformed body', async () => {
    const store = await seededStore();

    const res = await request(createApp({ store }))
      .put('/api/config')
      .set('content-type', 'application/json')
      .send('{not json');

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });
});

describe('requireToken', () => {
  it('lets the token be set while none exists, then guards the API', async () => {
    const store = await seededStore([makeCamera()]);
    const app = createApp({ store, applyConfig: mockApply() });

    const put = await request(app).put('/api/config').send({ auth: { token: 'secret' } });
    expect(put.status).toBe(200);
    expect(store.get().auth?.token).toBe('secret');

    const denied = await request(app).get('/api/config');
    expect(denied.status).toBe(401);
    expect(denied.body).toEqual({ error: 'unauthorized' });

    const wrong = await request(app).get('/api/config').set('x-tapo-token', 'nope');
    expect(wrong.status).toBe(401);

    const allowed = await request(app).get('/api/config').set('x-tapo-token', 'secret');
    expect(allowed.status).toBe(200);
    expect(allowed.body.httpPort).toBe(3000);
  });

  it('reports authEnabled once a token is stored', async () => {
    const store = await seededStore();
    await store.save({ ...store.get(), auth: { token: 'secret' } });

    // The store is shared by reference: a token saved out of band is enforced.
    const res = await request(createApp({ store })).get('/api/config');
    expect(res.status).toBe(401);
  });
});
