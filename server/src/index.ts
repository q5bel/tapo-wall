import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { buildCameraList } from './cameras.js';
import { defaultConfig, loadConfig, type Config } from './config.js';
import { startMediamtx } from './mediamtx-runner.js';
import { startStatusMonitor } from './status.js';

const app = express();
const startedAt = Date.now();

/**
 * Load the config once at startup and keep it in memory for the process
 * lifetime: request handlers never touch the filesystem, and the camera
 * credentials stay server-side.
 */
async function loadStartupConfig(): Promise<Config> {
  try {
    return await loadConfig();
  } catch (err) {
    // Serving an empty camera list beats refusing to boot; the operator sees
    // the reason in the log.
    console.error(`failed to load config: ${(err as Error).message}`);
    return defaultConfig();
  }
}

const config = await loadStartupConfig();

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: Math.round((Date.now() - startedAt) / 1000),
  });
});

// Registered before any static-file middleware so a built SPA can never
// shadow the API route.
app.get('/api/cameras', (req, res) => {
  res.json({ cameras: buildCameraList(config, req.headers.host) });
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

// `PORT` wins when set (that is what `scripts/start.mjs` and containers use);
// otherwise fall back to the configured `httpPort` (default 3000).
const port = Number(process.env.PORT) || config.httpPort;

app.listen(port, async () => {
  console.log(`tapo-wall-server listening on http://localhost:${port}`);

  if (process.env.MEDIAMTX_DISABLE === '1') {
    console.log('mediamtx disabled');
    return;
  }

  // Status polling is independent of the spawn below: it keeps reporting
  // `connecting` (never stale values) if MediaMTX cannot be started at all.
  startStatusMonitor(config);

  try {
    await startMediamtx(config);
  } catch (err) {
    // The UI must stay usable even when MediaMTX cannot start.
    console.error(`failed to start mediamtx: ${(err as Error).message}`);
  }
});
