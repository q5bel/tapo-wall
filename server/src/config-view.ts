import { DEFAULT_LAYOUT, type Camera, type CameraLayout, type Config } from './config.js';

/**
 * Client-facing view of one camera.
 *
 * It is NOT the secret-free shape served by `GET /api/cameras` (see
 * `cameras.ts`): the config editor legitimately needs the RTSP host, port,
 * username and stream paths, but the password is replaced by `passwordSet`.
 */
export interface CameraView {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  passwordSet: boolean;
  streams: { hd: string; preview: string };
  layout: CameraLayout;
}

/** Client-facing view of the whole config; never carries a secret. */
export interface ConfigView {
  httpPort: number;
  authEnabled: boolean;
  mediamtx: { hlsAddress: string; apiAddress: string; webrtcAddress?: string };
  cameras: CameraView[];
}

/**
 * One camera as accepted by `PUT /api/config`.
 *
 * `password` is optional on purpose: an omitted or empty password means
 * "keep the stored one" for an existing camera, and is an error for a new one.
 */
export interface CameraInput {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  streams: { hd: string; preview: string };
  layout?: CameraLayout;
}

/**
 * A partial config patch. Every field is optional; an omitted field means
 * "keep the current value". `httpPort` is accepted but ignored: the listen
 * port is fixed at boot.
 */
export interface ConfigInput {
  httpPort?: number;
  auth?: { token?: string | null };
  mediamtx?: { hlsAddress?: string; apiAddress?: string; webrtcAddress?: string };
  cameras?: CameraInput[];
}

/** Project a `Config` into its secret-free, client-facing view. */
export function toConfigView(config: Config): ConfigView {
  return {
    httpPort: config.httpPort,
    authEnabled: Boolean(config.auth?.token),
    mediamtx: {
      hlsAddress: config.mediamtx.hlsAddress,
      apiAddress: config.mediamtx.apiAddress,
      webrtcAddress: config.mediamtx.webrtcAddress,
    },
    cameras: config.cameras.map((camera) => ({
      id: camera.id,
      name: camera.name,
      host: camera.host,
      port: camera.port,
      username: camera.username,
      passwordSet: camera.password.length > 0,
      streams: { hd: camera.streams.hd, preview: camera.streams.preview },
      layout: camera.layout ?? DEFAULT_LAYOUT,
    })),
  };
}

/** Outcome of {@link mergeConfigInput}. */
export interface MergeResult {
  config: Config;
  errors: string[];
}

/** True for a string that carries something; `null`/`undefined` are empty. */
function isFilled(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Merge a client patch into the current config.
 *
 * Policy:
 * - `httpPort` is ignored; the listen port is decided at boot.
 * - `mediamtx` is merged field by field; an omitted field keeps its value.
 * - `auth` replaces the whole section: a non-empty token installs it, an empty
 *   token or `null` removes it. An omitted `auth` keeps the current one.
 * - `cameras` replaces the whole list when present. A camera's password is
 *   only overwritten by a non-empty input password; an empty one keeps the
 *   stored password of the camera with the same id. A new camera without a
 *   password is reported in `errors` and gets an empty password.
 *
 * The result is a fresh object graph: `current` is never mutated. It is not
 * validated here — `ConfigStore.save` owns schema and duplicate-id checks.
 */
export function mergeConfigInput(current: Config, input: ConfigInput): MergeResult {
  const errors: string[] = [];

  const mediamtx: Config['mediamtx'] = input.mediamtx
    ? {
        hlsAddress: input.mediamtx.hlsAddress ?? current.mediamtx.hlsAddress,
        apiAddress: input.mediamtx.apiAddress ?? current.mediamtx.apiAddress,
        webrtcAddress: input.mediamtx.webrtcAddress ?? current.mediamtx.webrtcAddress,
      }
    : current.mediamtx;

  let auth: Config['auth'];
  if (input.auth) {
    auth = isFilled(input.auth.token) ? { token: input.auth.token } : undefined;
  } else {
    auth = current.auth;
  }

  let cameras: Camera[] = current.cameras;
  if (input.cameras) {
    cameras = input.cameras.map((camera) => {
      const existing = current.cameras.find((candidate) => candidate.id === camera.id);

      let password = '';
      if (isFilled(camera.password)) {
        password = camera.password;
      } else if (existing) {
        password = existing.password;
      } else {
        errors.push(`camera "${camera.id}" requires a password`);
      }

      return {
        id: camera.id,
        name: camera.name,
        host: camera.host,
        port: camera.port,
        username: camera.username,
        password,
        streams: { hd: camera.streams.hd, preview: camera.streams.preview },
        layout: camera.layout ?? existing?.layout,
      };
    });
  }

  return {
    config: {
      httpPort: current.httpPort,
      mediamtx,
      cameras,
      auth,
    },
    errors,
  };
}
