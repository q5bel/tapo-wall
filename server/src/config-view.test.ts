import { describe, expect, it } from 'vitest';

import { DEFAULT_LAYOUT, defaultConfig, type Camera, type Config } from './config.js';
import {
  mergeConfigInput,
  toConfigView,
  type CameraInput,
  type ConfigInput,
} from './config-view.js';

const SECRET = 'SUPER_SECRET_PASSWORD';

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

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...defaultConfig(),
    cameras: [makeCamera()],
    ...overrides,
  };
}

function makeInput(overrides: Partial<CameraInput> = {}): CameraInput {
  return {
    id: 'office-front',
    name: 'Офис — вход',
    host: '192.168.1.101',
    port: 554,
    username: 'tapo',
    streams: { hd: '/stream1', preview: '/stream2' },
    ...overrides,
  };
}

describe('toConfigView', () => {
  it('never carries the camera password', () => {
    const view = toConfigView(makeConfig());

    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(Object.keys(view.cameras[0] ?? {})).not.toContain('password');
    // The username and host stay: they are not secrets the wall hides here.
    expect(view.cameras[0]?.username).toBe('tapo');
    expect(view.cameras[0]?.host).toBe('192.168.1.101');
  });

  it('reports passwordSet instead of the password', () => {
    expect(toConfigView(makeConfig()).cameras[0]?.passwordSet).toBe(true);
    expect(
      toConfigView(makeConfig({ cameras: [makeCamera({ password: '' })] })).cameras[0]
        ?.passwordSet,
    ).toBe(false);
  });

  it('reports authEnabled from the presence of a token', () => {
    expect(toConfigView(makeConfig()).authEnabled).toBe(false);
    expect(toConfigView(makeConfig({ auth: { token: 'secret' } })).authEnabled).toBe(true);
    expect(toConfigView(makeConfig({ auth: { token: '' } })).authEnabled).toBe(false);
  });

  it('copies the three mediamtx addresses, with webrtc optional', () => {
    const view = toConfigView(makeConfig());

    expect(view.mediamtx).toEqual({ hlsAddress: ':8888', apiAddress: ':9997' });
    expect(view.mediamtx.webrtcAddress).toBeUndefined();

    const withWebrtc = toConfigView(
      makeConfig({ mediamtx: { hlsAddress: ':1', apiAddress: ':2', webrtcAddress: ':3' } }),
    );
    expect(withWebrtc.mediamtx).toEqual({
      hlsAddress: ':1',
      apiAddress: ':2',
      webrtcAddress: ':3',
    });
  });

  it('always exposes a complete layout and the streams', () => {
    const view = toConfigView(makeConfig());

    expect(view.httpPort).toBe(3000);
    expect(view.cameras[0]?.layout).toEqual(DEFAULT_LAYOUT);
    expect(view.cameras[0]?.streams).toEqual({ hd: '/stream1', preview: '/stream2' });

    const custom = toConfigView(
      makeConfig({ cameras: [makeCamera({ layout: { ...DEFAULT_LAYOUT, x: 7 } })] }),
    );
    expect(custom.cameras[0]?.layout.x).toBe(7);
  });
});

describe('mergeConfigInput', () => {
  it('ignores httpPort', () => {
    const { config } = mergeConfigInput(makeConfig({ httpPort: 3000 }), { httpPort: 9999 });

    expect(config.httpPort).toBe(3000);
  });

  it('keeps current cameras when the input omits them', () => {
    const { config, errors } = mergeConfigInput(makeConfig(), {});

    expect(config.cameras).toEqual(makeConfig().cameras);
    expect(errors).toEqual([]);
  });

  it('keeps an existing password when the input sends none', () => {
    const current = makeConfig();
    const { config, errors } = mergeConfigInput(current, {
      cameras: [makeInput({ name: 'Renamed' })],
    });

    expect(errors).toEqual([]);
    expect(config.cameras[0]?.password).toBe(SECRET);
    expect(config.cameras[0]?.name).toBe('Renamed');
  });

  it('treats an empty password on an existing camera as "keep"', () => {
    const { config, errors } = mergeConfigInput(makeConfig(), {
      cameras: [makeInput({ password: '' })],
    });

    expect(errors).toEqual([]);
    expect(config.cameras[0]?.password).toBe(SECRET);
  });

  it('replaces the password when a new one is sent', () => {
    const { config } = mergeConfigInput(makeConfig(), {
      cameras: [makeInput({ password: 'new-secret' })],
    });

    expect(config.cameras[0]?.password).toBe('new-secret');
  });

  it('rejects a brand-new camera without a password', () => {
    const { config, errors } = mergeConfigInput(makeConfig(), {
      cameras: [makeInput({ id: 'kitchen' })],
    });

    expect(errors).toEqual(['camera "kitchen" requires a password']);
    expect(config.cameras).toHaveLength(1);
    expect(config.cameras[0]?.id).toBe('kitchen');
    expect(config.cameras[0]?.password).toBe('');
  });

  it('accepts a brand-new camera with a password', () => {
    const { config, errors } = mergeConfigInput(makeConfig(), {
      cameras: [makeInput({ id: 'kitchen', password: 'fresh' })],
    });

    expect(errors).toEqual([]);
    expect(config.cameras[0]?.id).toBe('kitchen');
    expect(config.cameras[0]?.password).toBe('fresh');
  });

  it('takes the layout from the input, else keeps the existing one', () => {
    const current = makeConfig({
      cameras: [makeCamera({ layout: { ...DEFAULT_LAYOUT, w: 640 } })],
    });

    const kept = mergeConfigInput(current, { cameras: [makeInput()] });
    expect(kept.config.cameras[0]?.layout).toEqual({ ...DEFAULT_LAYOUT, w: 640 });

    const replaced = mergeConfigInput(current, {
      cameras: [makeInput({ layout: { ...DEFAULT_LAYOUT, y: 42 } })],
    });
    expect(replaced.config.cameras[0]?.layout).toEqual({ ...DEFAULT_LAYOUT, y: 42 });

    const missing = mergeConfigInput(current, {
      cameras: [makeInput({ id: 'new', password: 'p' })],
    });
    expect(missing.config.cameras[0]?.layout).toBeUndefined();
  });

  it('sets a token when one is provided', () => {
    const { config } = mergeConfigInput(makeConfig(), { auth: { token: 'secret' } });

    expect(config.auth).toEqual({ token: 'secret' });
  });

  it('clears the token on null or an empty string', () => {
    const current = makeConfig({ auth: { token: 'secret' } });

    expect(mergeConfigInput(current, { auth: { token: null } }).config.auth).toBeUndefined();
    expect(mergeConfigInput(current, { auth: { token: '' } }).config.auth).toBeUndefined();
  });

  it('keeps the current auth when the input omits it', () => {
    const current = makeConfig({ auth: { token: 'secret' } });

    expect(mergeConfigInput(current, {}).config.auth).toEqual({ token: 'secret' });
  });

  it('clears the token when an auth object is sent without one', () => {
    const current = makeConfig({ auth: { token: 'secret' } });

    // Per spec an auth object always replaces the section, so `{}` clears.
    expect(mergeConfigInput(current, { auth: {} }).config.auth).toBeUndefined();
  });

  it('merges mediamtx field by field and keeps it when omitted', () => {
    const current = makeConfig({
      mediamtx: { hlsAddress: ':8888', apiAddress: ':9997', webrtcAddress: ':8889' },
    });

    const merged = mergeConfigInput(current, { mediamtx: { hlsAddress: ':9000' } });
    expect(merged.config.mediamtx).toEqual({
      hlsAddress: ':9000',
      apiAddress: ':9997',
      webrtcAddress: ':8889',
    });

    expect(mergeConfigInput(current, {}).config.mediamtx).toEqual(current.mediamtx);
  });

  it('does not mutate the current config', () => {
    const current = makeConfig({ auth: { token: 'secret' } });
    const before = structuredClone(current);

    mergeConfigInput(current, {
      auth: { token: 'other' },
      mediamtx: { hlsAddress: ':1' },
      cameras: [makeInput({ name: 'Changed' })],
    });

    expect(current).toEqual(before);
  });

  it('reports one error per password-less new camera', () => {
    const input: ConfigInput = {
      cameras: [
        makeInput({ id: 'a' }),
        makeInput({ id: 'b' }),
        makeInput({ id: 'c', password: 'ok' }),
      ],
    };

    const { errors } = mergeConfigInput(makeConfig(), input);

    expect(errors).toEqual([
      'camera "a" requires a password',
      'camera "b" requires a password',
    ]);
  });
});
