import { existsSync } from 'node:fs';
import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  configIssuesFromMessage,
  DEFAULT_CONFIG_PATH,
  defaultConfig,
  normalizeConfig,
  type Config,
} from './config.js';

const NOT_FOUND_WARNING =
  'cameras.json not found; copy config/cameras.example.json to config/cameras.json';

/** Raised when a config is rejected by validation (schema or duplicate ids). */
export class ConfigValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

/**
 * In-memory owner of the camera config file.
 *
 * The store is the single writer: `load` reads and normalizes once, `save`
 * validates, writes atomically (backup + tmp + rename) and notifies
 * subscribers. Merging secrets or other policy decisions belong to callers.
 */
export class ConfigStore {
  private readonly listeners = new Set<(config: Config) => void>();

  private config: Config;

  private constructor(
    private readonly filePath: string,
    initial: Config,
  ) {
    this.config = initial;
  }

  /**
   * Create a store and load its file.
   *
   * @param filePath Optional path override; defaults to
   *   `<repo>/config/cameras.json`.
   */
  static async open(filePath?: string): Promise<ConfigStore> {
    const store = new ConfigStore(
      filePath ?? fileURLToPath(DEFAULT_CONFIG_PATH),
      defaultConfig(),
    );
    await store.load();
    return store;
  }

  /**
   * Read and normalize the file into memory. A missing file falls back to
   * `defaultConfig()` with a warning; a malformed or invalid file throws.
   */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(NOT_FOUND_WARNING);
        this.config = defaultConfig();
        return;
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Failed to parse config at ${this.filePath}: ${(err as Error).message}`,
      );
    }

    try {
      this.config = normalizeConfig(parsed);
    } catch (err) {
      const message = (err as Error).message;
      const detail = message
        .replace(/^Invalid config:\s*/, '')
        .trim();
      throw new Error(`Invalid config at ${this.filePath}:\n${detail}`);
    }
  }

  /** The config currently held in memory. */
  get(): Config {
    return this.config;
  }

  /**
   * Validate, persist and publish a new config.
   *
   * The previous file is copied to `<path>.bak` first (when it exists), then
   * the new contents are written to `<path>.tmp` and renamed over the target,
   * so a reader never observes a partial file.
   *
   * @throws ConfigValidationError when the schema rejects `next` or two
   *   cameras share an id.
   */
  async save(next: Config): Promise<void> {
    let normalized: Config;
    try {
      normalized = normalizeConfig(next);
    } catch (err) {
      const message = (err as Error).message;
      throw new ConfigValidationError(
        message.replace(/^Invalid config:\s*/, 'Invalid config: ').trim(),
        configIssuesFromMessage(message),
      );
    }

    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const camera of normalized.cameras) {
      if (seen.has(camera.id)) duplicates.add(camera.id);
      seen.add(camera.id);
    }
    if (duplicates.size > 0) {
      const ids = [...duplicates];
      throw new ConfigValidationError(
        `duplicate camera id(s): ${ids.join(', ')}`,
        ids.map((id) => `cameras: duplicate id "${id}"`),
      );
    }

    if (existsSync(this.filePath)) {
      await copyFile(this.filePath, `${this.filePath}.bak`);
    }

    const tmpPath = `${this.filePath}.tmp`;
    try {
      await writeFile(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      await rename(tmpPath, this.filePath);
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }

    this.config = normalized;
    for (const listener of this.listeners) {
      listener(normalized);
    }
  }

  /** Subscribe to successful saves; returns the unsubscribe function. */
  onChange(cb: (config: Config) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}
