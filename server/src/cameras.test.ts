import { describe, expect, it } from 'vitest';

import { buildCameraList, hostFromHeader, parseListenPort } from './cameras.js';
import { DEFAULT_LAYOUT, type Config } from './config.js';

const SECRET = 'SUPER_SECRET_PASSWORD';
const USER = 'SUPER_SECRET_USER';
const CAMERA_IP = '192.168.1.101';

function testConfig(): Config {
  return {
    httpPort: 3000,
    mediamtx: { hlsAddress: ':8888', apiAddress: ':9997' },
    cameras: [
      {
        id: 'office-front',
        name: 'Офис — вход',
        host: CAMERA_IP,
        port: 554,
        username: USER,
        password: SECRET,
        streams: { hd: '/stream1', preview: '/stream2' },
      },
    ],
  };
}

describe('buildCameraList', () => {
  it('builds HLS and WHEP URLs from the request host, without its port', () => {
    const [camera] = buildCameraList(testConfig(), 'localhost:3000');

    expect(camera?.hd).toEqual({
      hls: 'http://localhost:8888/office-front_hd/index.m3u8',
      webrtc: 'http://localhost:8889/office-front_hd/whep',
    });
    expect(camera?.preview).toEqual({
      hls: 'http://localhost:8888/office-front_preview/index.m3u8',
      webrtc: 'http://localhost:8889/office-front_preview/whep',
    });
  });

  it('reports connecting until the status monitor has polled', () => {
    const [camera] = buildCameraList(testConfig(), 'localhost:3000');

    expect(camera?.id).toBe('office-front');
    expect(camera?.name).toBe('Офис — вход');
    expect(camera?.status).toBe('connecting');
  });

  it('never exposes secrets or camera-side connection details', () => {
    const payload = JSON.stringify(buildCameraList(testConfig(), 'localhost:3000'));

    for (const leak of [
      SECRET,
      USER,
      CAMERA_IP,
      'password',
      'username',
      'rtsp://',
      '/stream1',
      '/stream2',
    ]) {
      expect(payload).not.toContain(leak);
    }

    expect(Object.keys(buildCameraList(testConfig(), 'localhost')[0] ?? {}).sort()).toEqual([
      'hd',
      'id',
      'layout',
      'name',
      'preview',
      'status',
    ]);
  });

  it('fills in DEFAULT_LAYOUT when the camera carries none', () => {
    const [camera] = buildCameraList(testConfig(), 'localhost');

    expect(camera?.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('exposes the camera layout when it carries one', () => {
    const config = testConfig();
    config.cameras[0]!.layout = {
      x: 12,
      y: 34,
      w: 640,
      h: 360,
      rotation: 90,
      scale: 2,
    };

    const [camera] = buildCameraList(config, 'localhost');

    expect(camera?.layout).toEqual({ x: 12, y: 34, w: 640, h: 360, rotation: 90, scale: 2 });
  });

  it('uses the HLS port from the config and the MediaMTX WebRTC default', () => {
    const config = testConfig();
    config.mediamtx.hlsAddress = '0.0.0.0:9000';

    const [camera] = buildCameraList(config, 'cam.local');

    expect(camera?.hd.hls).toBe('http://cam.local:9000/office-front_hd/index.m3u8');
    expect(camera?.hd.webrtc).toBe('http://cam.local:8889/office-front_hd/whep');
  });

  it('honours an explicit webrtcAddress', () => {
    const config = testConfig();
    config.mediamtx.webrtcAddress = ':8189';

    const [camera] = buildCameraList(config, 'cam.local');

    expect(camera?.hd.webrtc).toBe('http://cam.local:8189/office-front_hd/whep');
  });

  it('falls back to localhost when no host header is available', () => {
    const [camera] = buildCameraList(testConfig());

    expect(camera?.hd.hls).toBe('http://localhost:8888/office-front_hd/index.m3u8');
  });

  it('returns an empty list when there are no cameras', () => {
    const config = testConfig();
    config.cameras = [];

    expect(buildCameraList(config, 'localhost')).toEqual([]);
  });
});

/**
 * M8 contract fixture: one camera with a LAN host and single-character
 * credentials, so any leak of `host`/`username`/`password` stands out.
 */
const CONTRACT_ID = 'cam1';
const CONTRACT_HOST = '10.0.0.5';
const CONTRACT_USER = 'u';
const CONTRACT_PASSWORD = 'p';

function contractConfig(): Config {
  return {
    httpPort: 3000,
    mediamtx: { hlsAddress: ':8888', apiAddress: ':9997' },
    cameras: [
      {
        id: CONTRACT_ID,
        name: 'Camera 1',
        host: CONTRACT_HOST,
        port: 554,
        username: CONTRACT_USER,
        password: CONTRACT_PASSWORD,
        streams: { hd: '/stream1', preview: '/stream2' },
      },
    ],
  };
}

/** Collect every leaf (non-object) value of a JSON-like structure. */
function collectLeaves(value: unknown, out: unknown[] = []): unknown[] {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectLeaves(nested, out);
    }
    return out;
  }

  out.push(value);
  return out;
}

describe('buildCameraList - public camera list contract', () => {
  it('maps one camera to its id and local MediaMTX HLS URLs', () => {
    const result = buildCameraList(contractConfig(), 'localhost:3000');

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(CONTRACT_ID);
    expect(result[0]?.preview.hls).toBe(
      'http://localhost:8888/cam1_preview/index.m3u8',
    );
    expect(result[0]?.hd.hls).toBe('http://localhost:8888/cam1_hd/index.m3u8');
  });

  it('always reports a string status', () => {
    const result = buildCameraList(contractConfig(), 'localhost:3000');

    expect(typeof result[0]?.status).toBe('string');
  });

  it('never serializes the camera host, credentials or RTSP sources', () => {
    const result = buildCameraList(contractConfig(), 'localhost:3000');
    const payload = JSON.stringify(result);

    // The credentials are single characters, so a raw substring search would
    // match almost any JSON; compare whole leaf values instead.
    const leaves = collectLeaves(result).map((leaf) => String(leaf));
    expect(leaves).not.toContain(CONTRACT_PASSWORD);
    expect(leaves).not.toContain(CONTRACT_USER);
    expect(payload).not.toContain(`"${CONTRACT_PASSWORD}"`);
    expect(payload).not.toContain(`"${CONTRACT_USER}"`);

    // The host, the RTSP scheme and the source paths are unambiguous strings.
    expect(payload).not.toContain(CONTRACT_HOST);
    expect(payload).not.toContain('rtsp://');
    expect(payload).not.toContain('/stream1');
    expect(payload).not.toContain('/stream2');

    // No credential/host field may appear, even empty.
    for (const field of ['password', 'username', 'host', 'port', 'streams']) {
      expect(payload).not.toContain(`"${field}"`);
    }

    expect(Object.keys(result[0] ?? {}).sort()).toEqual([
      'hd',
      'id',
      'layout',
      'name',
      'preview',
      'status',
    ]);
  });
});

describe('parseListenPort', () => {
  it.each([
    [':8888', 8888],
    ['0.0.0.0:8888', 8888],
    ['[::]:8888', 8888],
    ['8888', 8888],
    ['', 5555],
    [undefined, 5555],
    [':not-a-port', 5555],
  ])('parses %s as %i', (address, expected) => {
    expect(parseListenPort(address as string | undefined, 5555)).toBe(expected);
  });
});

describe('hostFromHeader', () => {
  it.each([
    ['localhost:3000', 'localhost'],
    ['tapo.local', 'tapo.local'],
    ['[::1]:3000', '[::1]'],
    [' 192.168.1.50:8080 ', '192.168.1.50'],
    [undefined, 'localhost'],
    ['', 'localhost'],
  ])('reduces %s to %s', (header, expected) => {
    expect(hostFromHeader(header as string | undefined)).toBe(expected);
  });
});
