import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import { buildCameraList } from './cameras.js';
import type { Config } from './config.js';
import { ConfigValidationError, type ConfigStore } from './config-store.js';
import { mergeConfigInput, toConfigView, type ConfigInput } from './config-view.js';
import { applyConfig } from './runtime.js';

/** Everything `createApp` needs; tests inject a stub `applyConfig`. */
export interface AppDeps {
  store: ConfigStore;
  applyConfig?: typeof applyConfig;
}

/** True for a plain object: the only shape a config patch may have. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** HTTP status carried by an error, when it looks usable. */
function errorStatus(err: unknown): number {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 600 ? status : 500;
}

/**
 * Build the HTTP application around a config store.
 *
 * The store is read per request, so a `PUT /api/config` is visible to every
 * later request without a restart. Every `/api` route is registered before the
 * static files and the SPA fallback, so a built client can never shadow the
 * API.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();
  const startedAt = Date.now();

  app.use(express.json());

  /**
   * Reject requests that do not carry the configured token.
   *
   * With no token configured the API stays open (the default for a LAN
   * install); once `auth.token` is set, `x-tapo-token` must match it. The token
   * is read from the store per request so enabling it takes effect immediately.
   */
  const requireToken = (req: Request, res: Response, next: NextFunction): void => {
    const token = deps.store.get().auth?.token;

    if (!token) {
      next();
      return;
    }

    if (req.header('x-tapo-token') !== token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    next();
  };

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      uptime: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  app.get('/api/cameras', (req, res) => {
    res.json({ cameras: buildCameraList(deps.store.get(), req.headers.host) });
  });

  app.get('/api/config', requireToken, (_req, res) => {
    res.json(toConfigView(deps.store.get()));
  });

  app.put('/api/config', requireToken, async (req, res, next) => {
    const body: unknown = req.body;
    if (!isPlainObject(body)) {
      res.status(400).json({ error: 'invalid body' });
      return;
    }

    const { config, errors } = mergeConfigInput(deps.store.get(), body as ConfigInput);
    if (errors.length > 0) {
      res.status(422).json({ error: errors.join('; '), issues: errors });
      return;
    }

    const prev = deps.store.get();
    try {
      await deps.store.save(config);
    } catch (err) {
      if (err instanceof ConfigValidationError) {
        res.status(422).json({ error: err.message, issues: err.issues });
        return;
      }
      next(err);
      return;
    }

    const apply = deps.applyConfig ?? applyConfig;

    try {
      const { warnings } = await apply(prev, deps.store.get());
      res.json({ ok: true, warnings });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Built SPA location. From this module the path is always
   * `<repo>/web/dist`, whether we run from `server/src` (tsx) or
   * `server/dist` (compiled), because both sit two levels below the root.
   */
  const webDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));
  const webIndexFile = path.join(webDistDir, 'index.html');
  const webBuilt = existsSync(webIndexFile);

  // Everything below is registered AFTER every /api route, so static files and
  // the SPA fallback can never take precedence over the API.
  if (webBuilt) {
    app.use(express.static(webDistDir));
  } else {
    console.warn('web/dist not found; run: npm run build:web');
  }

  // SPA fallback: client-side routes (e.g. /cameras/kitchen) must return
  // index.html instead of a 404. Explicitly skipped for /api so an unknown API
  // path stays a 404 rather than silently returning HTML.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }

    if (!webBuilt) {
      res
        .status(404)
        .type('text/plain')
        .send('web/dist not found; run: npm run build:web');
      return;
    }

    res.sendFile(webIndexFile, (err) => {
      if (err) next(err);
    });
  });

  // The API answers JSON even for unexpected failures: a malformed JSON body
  // (400 from `express.json`) or any other thrown error.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = errorStatus(err);
    const message = err instanceof Error ? err.message : 'internal error';

    if (!res.headersSent) {
      res.status(status).json({ error: message });
    }
  });

  return app;
}
