import { createApp } from './app.js';
import { ConfigStore } from './config-store.js';
import { startMediamtx } from './mediamtx-runner.js';
import { applyConfig } from './runtime.js';
import { startStatusMonitor } from './status.js';

/**
 * Open the config store, degrading to an empty in-memory config when the file
 * cannot be used: serving an empty camera list beats refusing to boot, and the
 * operator sees the reason in the log. A later `PUT /api/config` still persists
 * to the default path.
 */
async function openStore(): Promise<ConfigStore> {
  try {
    return await ConfigStore.open();
  } catch (err) {
    console.error(`failed to load config: ${(err as Error).message}`);
    return ConfigStore.empty();
  }
}

const store = await openStore();
const app = createApp({ store, applyConfig });

// `PORT` wins when set (that is what `scripts/start.mjs` and containers use);
// otherwise fall back to the configured `httpPort` (default 3000).
const port = Number(process.env.PORT) || store.get().httpPort;

app.listen(port, () => {
  console.log(`tapo-wall-server listening on http://localhost:${port}`);

  if (process.env.MEDIAMTX_DISABLE === '1') {
    console.log('mediamtx disabled');
    return;
  }

  // Status polling is independent of the spawn below: it keeps reporting
  // `connecting` (never stale values) if MediaMTX cannot be started at all.
  startStatusMonitor(store.get());

  startMediamtx(store.get()).catch((err: unknown) => {
    // The UI must stay usable even when MediaMTX cannot start.
    console.error(`failed to start mediamtx: ${(err as Error).message}`);
  });
});
