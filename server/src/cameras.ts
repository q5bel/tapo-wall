import type { Camera, Config } from './config.js';
import { getStatus, type CameraStatus } from './status.js';

export type { CameraStatus };

/**
 * Playback endpoints for one stream of one camera.
 *
 * Both URLs are plain HTTP addresses of the local MediaMTX instance; they never
 * carry camera credentials (MediaMTX holds the RTSP source URLs server-side).
 */
export interface CameraEndpoints {
  /** HLS playlist URL. */
  hls: string;
  /** WebRTC (WHEP) endpoint URL. */
  webrtc: string;
}

/**
 * Sanitized, secret-free view of a camera.
 *
 * This is the only camera shape that may leave the server: it deliberately
 * omits `host`, `port`, `username`, `password` and `streams` (which would leak
 * `rtsp://` source URLs).
 */
export interface CameraInfo {
  id: string;
  name: string;
  status: CameraStatus;
  preview: CameraEndpoints;
  hd: CameraEndpoints;
}

/** Stream variants exposed per camera, matching the MediaMTX path suffixes. */
type StreamName = 'hd' | 'preview';

/** MediaMTX defaults, used when the config does not specify an address. */
const DEFAULT_HLS_PORT = 8888;
const DEFAULT_WEBRTC_PORT = 8889;

/** Host used when the request carries no usable `Host` header. */
const FALLBACK_HOST = 'localhost';

/**
 * Extract a port from a listen address.
 *
 * Accepts the forms MediaMTX uses: `:8888`, `0.0.0.0:8888`, `[::]:8888` and a
 * bare `8888`. Anything unparseable falls back to `fallback`.
 */
export function parseListenPort(address: string | undefined, fallback: number): number {
  if (!address) {
    return fallback;
  }

  const tail = address.slice(address.lastIndexOf(':') + 1).trim();
  const port = Number.parseInt(tail, 10);

  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

/**
 * Reduce a `Host` header value to a bare hostname without its port.
 *
 * `localhost:3000` becomes `localhost`; IPv6 literals keep their brackets
 * (`[::1]:3000` becomes `[::1]`) so the result stays valid inside a URL.
 */
export function hostFromHeader(header: string | undefined): string {
  const raw = header?.trim() ?? '';

  if (raw.length === 0) {
    return FALLBACK_HOST;
  }

  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end === -1 ? raw : raw.slice(0, end + 1);
  }

  const colon = raw.indexOf(':');
  const host = colon === -1 ? raw : raw.slice(0, colon);

  return host.length > 0 ? host : FALLBACK_HOST;
}

/** Build the HLS + WHEP URLs of one `${id}_${stream}` MediaMTX path. */
function buildEndpoints(
  camera: Camera,
  stream: StreamName,
  host: string,
  hlsPort: number,
  webrtcPort: number,
): CameraEndpoints {
  const path = `${camera.id}_${stream}`;

  return {
    hls: `http://${host}:${hlsPort}/${path}/index.m3u8`,
    webrtc: `http://${host}:${webrtcPort}/${path}/whep`,
  };
}

/**
 * Build the sanitized camera list served by `GET /api/cameras`.
 *
 * Camera secrets never appear in the result: the client only learns the ids,
 * names, live statuses and local MediaMTX playback URLs. The status is read
 * from the status monitor (see `status.ts`); it stays `connecting` until the
 * monitor has completed its first successful poll.
 *
 * @param config Application config (loaded once at startup).
 * @param reqHost Raw `Host` header of the incoming request; its port is
 *   stripped and it defaults to `localhost` when absent.
 */
export function buildCameraList(config: Config, reqHost?: string): CameraInfo[] {
  const host = hostFromHeader(reqHost);
  const hlsPort = parseListenPort(config.mediamtx.hlsAddress, DEFAULT_HLS_PORT);
  const webrtcPort = parseListenPort(config.mediamtx.webrtcAddress, DEFAULT_WEBRTC_PORT);

  return config.cameras.map(
    (camera): CameraInfo => ({
      id: camera.id,
      name: camera.name,
      status: getStatus(camera.id),
      preview: buildEndpoints(camera, 'preview', host, hlsPort, webrtcPort),
      hd: buildEndpoints(camera, 'hd', host, hlsPort, webrtcPort),
    }),
  );
}
