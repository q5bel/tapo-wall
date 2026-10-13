import { stringify } from 'yaml';

import type { Camera, Config } from './config.js';

/** A single MediaMTX path definition. */
export interface MediamtxPath {
  source: string;
}

/** MediaMTX config document produced by {@link buildMediamtxConfig}. */
export interface MediamtxConfig {
  logLevel: 'info';
  hlsAddress: string;
  /**
   * Enable the HTTP API. It has to be set explicitly: the bundled binary
   * (v1.21.2) defaults it to off, and without it the status monitor has no
   * endpoint to poll.
   */
  api: true;
  apiAddress: string;
  /**
   * Enable WebRTC/WHEP. Written explicitly so the WHEP URLs that the API
   * advertises always have a live listener behind them, independent of the
   * MediaMTX build's defaults.
   */
  webrtc: true;
  /** WebRTC/WHEP listen address; MediaMTX uses `:8889` when this is omitted. */
  webrtcAddress?: string;
  paths: Record<string, MediamtxPath>;
}

/** Build the RTSP source URL for one stream path of a camera. */
function buildSourceUrl(camera: Camera, streamPath: string): string {
  return `rtsp://${camera.username}:${camera.password}@${camera.host}:${camera.port}${streamPath}`;
}

/**
 * Build the MediaMTX config object: one `_hd` and one `_preview` path per
 * camera, both proxying the camera's RTSP streams.
 */
export function buildMediamtxConfig(config: Config): MediamtxConfig {
  const paths: Record<string, MediamtxPath> = {};

  for (const camera of config.cameras) {
    paths[`${camera.id}_hd`] = { source: buildSourceUrl(camera, camera.streams.hd) };
    paths[`${camera.id}_preview`] = {
      source: buildSourceUrl(camera, camera.streams.preview),
    };
  }

  const mediamtx: MediamtxConfig = {
    logLevel: 'info',
    hlsAddress: config.mediamtx.hlsAddress,
    api: true,
    apiAddress: config.mediamtx.apiAddress,
    webrtc: true,
    paths,
  };

  // Only pin the address when the operator configured one: otherwise leave it
  // out so MediaMTX's own default (:8889) matches the WHEP URLs from cameras.ts.
  if (config.mediamtx.webrtcAddress) {
    mediamtx.webrtcAddress = config.mediamtx.webrtcAddress;
  }

  return mediamtx;
}

/**
 * Serialize the MediaMTX config for the given application config as YAML.
 *
 * The object is rendered with `yaml.stringify`, so quoting and escaping of
 * credentials in RTSP URLs stays valid YAML.
 */
export function generateMediamtxYaml(config: Config): string {
  return stringify(buildMediamtxConfig(config));
}
