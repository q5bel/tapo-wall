import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Stream paths exposed by a single camera. */
export interface CameraStreams {
  hd: string;
  preview: string;
}

export interface Camera {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  streams: CameraStreams;
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
}

const DEFAULT_MEDIAMTX: MediaMtxConfig = {
  hlsAddress: ':8888',
  apiAddress: ':9997',
};

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

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid config at ${resolvedPath}:\n${formatIssues(result.error)}`,
    );
  }

  return result.data;
}
