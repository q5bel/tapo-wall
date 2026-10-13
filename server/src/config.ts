import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Stream paths exposed by a single camera. */
export interface CameraStreams {
  hd: string;
  preview: string;
}

/** Placement of one camera tile inside the wall, in CSS pixels and degrees. */
export interface CameraLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  scale: number;
}

/** Layout applied to any camera that does not carry its own. */
export const DEFAULT_LAYOUT: CameraLayout = {
  x: 0,
  y: 0,
  w: 320,
  h: 180,
  rotation: 0,
  scale: 1,
};

export interface Camera {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  streams: CameraStreams;
  layout?: CameraLayout;
}

export interface AuthConfig {
  token?: string;
}

export interface MediaMtxConfig {
  hlsAddress: string;
  apiAddress: string;
  /** WebRTC/WHEP listen address; MediaMTX uses `:8889` when this is absent. */
  webrtcAddress?: string;
}

export interface Config {
  httpPort: number;
  mediamtx: MediaMtxConfig;
  cameras: Camera[];
  auth?: AuthConfig;
}

const DEFAULT_MEDIAMTX: MediaMtxConfig = {
  hlsAddress: ':8888',
  apiAddress: ':9997',
};

/** Lower/upper bounds enforced on every camera layout. */
export const MIN_LAYOUT_WIDTH = 160;
export const MIN_LAYOUT_HEIGHT = 90;
export const MIN_LAYOUT_SCALE = 0.25;
export const MAX_LAYOUT_SCALE = 4;

/**
 * Every layout field is optional and defaults to `DEFAULT_LAYOUT`, so a camera
 * may carry a partial layout (or none at all) and still end up complete.
 */
const layoutSchema = z.object({
  x: z.number({ error: 'layout.x must be a number' }).optional().default(DEFAULT_LAYOUT.x),
  y: z.number({ error: 'layout.y must be a number' }).optional().default(DEFAULT_LAYOUT.y),
  w: z.number({ error: 'layout.w must be a number' }).optional().default(DEFAULT_LAYOUT.w),
  h: z.number({ error: 'layout.h must be a number' }).optional().default(DEFAULT_LAYOUT.h),
  rotation: z
    .number({ error: 'layout.rotation must be a number' })
    .optional()
    .default(DEFAULT_LAYOUT.rotation),
  scale: z
    .number({ error: 'layout.scale must be a number' })
    .optional()
    .default(DEFAULT_LAYOUT.scale),
});

const authSchema = z.object({
  token: z.string({ error: 'auth.token must be a string' }).optional(),
});

const streamsSchema = z.object({
  hd: z.string({ error: 'streams.hd must be a string' }),
  preview: z.string({ error: 'streams.preview must be a string' }),
});

const cameraSchema = z.object({
  id: z.string({ error: 'id must be a string' }).min(1, 'id must not be empty'),
  name: z.string({ error: 'name must be a string' }),
  host: z.string({ error: 'host must be a string' }),
  port: z
    .number({ error: 'port must be a number' })
    .int('port must be an integer'),
  username: z.string({ error: 'username must be a string' }),
  password: z.string({ error: 'password must be a string' }),
  streams: streamsSchema,
  layout: layoutSchema.optional(),
});

const configSchema = z.object({
  httpPort: z
    .number({ error: 'httpPort must be a number' })
    .int('httpPort must be an integer')
    .positive('httpPort must be positive')
    .default(3000),
  mediamtx: z
    .object({
      hlsAddress: z
        .string({ error: 'hlsAddress must be a string' })
        .default(DEFAULT_MEDIAMTX.hlsAddress),
      apiAddress: z
        .string({ error: 'apiAddress must be a string' })
        .default(DEFAULT_MEDIAMTX.apiAddress),
      webrtcAddress: z
        .string({ error: 'webrtcAddress must be a string' })
        .optional(),
    })
    .default(DEFAULT_MEDIAMTX),
  cameras: z.array(cameraSchema).default([]),
  auth: authSchema.optional(),
});

/** Default config used when config/cameras.json is absent. */
export const DEFAULT_CONFIG_PATH = new URL('../../config/cameras.json', import.meta.url);

/** Fallback config: default ports and no cameras. */
export function defaultConfig(): Config {
  return configSchema.parse({});
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `  - ${field}: ${issue.message}`;
    })
    .join('\n');
}

const INVALID_CONFIG_PREFIX = 'Invalid config:';

/** Strip `formatIssues` output down to one issue per line. */
export function configIssuesFromMessage(message: string): string[] {
  return message
    .split('\n')
    .slice(1)
    .map((line) => line.trim().replace(/^-\s*/, ''))
    .filter((line) => line.length > 0);
}

/** Clamp a single layout into the supported ranges. */
function normalizeLayout(layout: CameraLayout): CameraLayout {
  return {
    x: layout.x,
    y: layout.y,
    w: Math.max(MIN_LAYOUT_WIDTH, layout.w),
    h: Math.max(MIN_LAYOUT_HEIGHT, layout.h),
    rotation: ((layout.rotation % 360) + 360) % 360,
    scale: Math.min(MAX_LAYOUT_SCALE, Math.max(MIN_LAYOUT_SCALE, layout.scale)),
  };
}

/**
 * Validate and normalize an arbitrary value into a `Config`.
 *
 * Validation is strict (a bad `port` throws); out-of-range layout values are
 * clamped instead of rejected. Every camera in the result carries a complete
 * `layout`, even when the input omitted it.
 *
 * @throws Error with a per-field issue list when validation fails.
 */
export function normalizeConfig(input: unknown): Config {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`${INVALID_CONFIG_PREFIX}\n${formatIssues(result.error)}`);
  }

  const parsed = result.data;
  return {
    ...parsed,
    cameras: parsed.cameras.map((camera) => ({
      ...camera,
      layout: normalizeLayout(camera.layout ?? DEFAULT_LAYOUT),
    })),
  };
}

/**
 * Load and validate the camera configuration.
 *
 * @param filePath Optional path override (used by tests). Defaults to
 *   `<repo>/config/cameras.json`, where `<repo>` is two levels above `server/src`.
 */
export async function loadConfig(filePath?: string): Promise<Config> {
  const resolvedPath = filePath ?? fileURLToPath(DEFAULT_CONFIG_PATH);

  let raw: string;
  try {
    raw = await readFile(resolvedPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(
        'cameras.json not found; copy config/cameras.example.json to config/cameras.json',
      );
      return defaultConfig();
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse config at ${resolvedPath}: ${(err as Error).message}`,
    );
  }

  try {
    return normalizeConfig(parsed);
  } catch (err) {
    const message = (err as Error).message;
    const detail = message.startsWith(INVALID_CONFIG_PREFIX)
      ? message.slice(INVALID_CONFIG_PREFIX.length).replace(/^\n/, '')
      : message;
    throw new Error(`Invalid config at ${resolvedPath}:\n${detail}`);
  }
}
