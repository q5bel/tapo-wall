#!/usr/bin/env node
/**
 * fetch-mediamtx.mjs — downloads the released MediaMTX binary for the current
 * OS/arch into bin/mediamtx and makes it executable.
 *
 * Pure Node ESM, zero dependencies: uses the built-in global fetch (Node 18+),
 * node:zlib for gunzip and a minimal inline tar reader.
 *
 * Usage: node scripts/fetch-mediamtx.mjs
 */

import { constants, existsSync, mkdirSync, statSync } from 'node:fs';
import { access, chmod, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BIN_DIR = join(ROOT, 'bin');
const TARGET = join(BIN_DIR, 'mediamtx');

const REPO = 'bluenviron/mediamtx';

/* ------------------------------------------------------------------ logging */

const log = (...args) => console.log('[fetch-mediamtx]', ...args);
const warn = (...args) => console.warn('[fetch-mediamtx]', ...args);

function fail(message, hint) {
  console.error(`\n[fetch-mediamtx] ERROR: ${message}`);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

/* --------------------------------------------------------- platform mapping */

/** Map process.platform -> MediaMTX release OS tag. */
function resolveOs() {
  switch (process.platform) {
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    default:
      fail(
        `unsupported platform "${process.platform}" (detected OS: ${process.platform}).`,
        manualInstructions(),
      );
  }
}

/** Map process.arch -> MediaMTX release ARCH tag. */
function resolveArch() {
  switch (process.arch) {
    case 'x64':
      return 'amd64';
    case 'arm64':
      return 'arm64';
    default:
      fail(
        `unsupported architecture "${process.arch}". MediaMTX releases only ship amd64 (x64) and arm64 builds.`,
        manualInstructions(),
      );
  }
}

function manualInstructions(os, arch) {
  const osTag = os ?? '<os>';
  const archTag = arch ?? '<arch>';
  return [
    'Manual installation:',
    `  1. Open https://github.com/${REPO}/releases/latest`,
    `  2. Download the asset named "mediamtx_<version>_${osTag}_${archTag}.tar.gz"`,
    '     (macOS arm64: mediamtx_v1.21.2_darwin_arm64.tar.gz, Linux x64: mediamtx_v1.21.2_linux_amd64.tar.gz, ...)',
    '  3. Unpack it and copy the "mediamtx" binary to:',
    `       ${TARGET}`,
    `  4. Make it executable:  chmod +x ${TARGET}`,
    '  5. Verify:              bin/mediamtx --version',
    '',
    'If you are behind a proxy, set HTTPS_PROXY / HTTP_PROXY and re-run this script.',
  ].join('\n');
}

/* ------------------------------------------------------------ tar extraction */

/**
 * Minimal ustar reader: locate the entry whose basename is `wanted` and return
 * its bytes.
 *
 * tar layout:
 *   - 512-byte header per entry
 *   - name    : bytes 0..100   (NUL-terminated)
 *   - size    : bytes 124..136 (NUL/space-terminated octal ASCII)
 *   - typeflag: byte 156       ('0'/NUL = regular file, '5' = directory)
 *   - prefix  : bytes 345..500 (ustar, prepended to name)
 *   - file data follows, padded up to the next 512-byte boundary
 *   - archive ends with two all-zero blocks
 */
function extractFromTar(tar, wanted = 'mediamtx') {
  const BLOCK = 512;
  let offset = 0;

  const readString = (buf, start, len) => {
    const slice = buf.subarray(start, start + len);
    const end = slice.indexOf(0);
    return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8').trim();
  };

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);

    // Two consecutive zero blocks mark the end of the archive.
    if (header.every((byte) => byte === 0)) break;

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;

    const rawSize = readString(header, 124, 12);
    const size = rawSize === '' ? 0 : parseInt(rawSize, 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`corrupt tar header: unreadable size "${rawSize}" for entry "${fullName}"`);
    }

    const typeFlag = String.fromCharCode(header[156] || 0x30); // NUL == '0'
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    const padded = Math.ceil(size / BLOCK) * BLOCK;

    const base = fullName.split('/').pop();
    const isRegularFile = typeFlag === '0' || typeFlag === '\0' || typeFlag === '';
    if (isRegularFile && base === wanted) {
      return Buffer.from(tar.subarray(dataStart, dataEnd));
    }

    offset = dataStart + padded;
  }

  const names = [];
  let scan = 0;
  while (scan + BLOCK <= tar.length && names.length < 25) {
    const header = tar.subarray(scan, scan + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const name = readString(header, 0, 100);
    if (name) names.push(name);
    const size = parseInt(readString(header, 124, 12) || '0', 8) || 0;
    scan += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }

  throw new Error(
    `"${wanted}" not found in archive. Entries: ${names.length ? names.join(', ') : '(none)'}`,
  );
}

/* -------------------------------------------------------------- asset lookup */

/**
 * MediaMTX names its release assets with the version baked in, e.g.
 *   mediamtx_v1.21.2_darwin_arm64.tar.gz
 * so there is no stable unversioned URL. Resolve the latest tag first.
 *
 * Strategy:
 *   1. GitHub REST API (authoritative, gives the exact tag).
 *   2. Fallback: follow the /releases/latest redirect and read the Location.
 * Returns null when neither works (offline / rate limited).
 */
async function resolveLatestTag() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'tapo-wall/fetch-mediamtx',
      },
      redirect: 'follow',
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.tag_name) return String(data.tag_name);
      warn(`GitHub API returned no tag_name (HTTP ${res.status}); trying redirect fallback.`);
    } else {
      warn(`GitHub API responded HTTP ${res.status}; trying redirect fallback.`);
    }
  } catch (err) {
    warn(`GitHub API unreachable (${err?.message ?? err}); trying redirect fallback.`);
  }

  try {
    const res = await fetch(`https://github.com/${REPO}/releases/latest`, {
      redirect: 'manual',
      headers: { 'user-agent': 'tapo-wall/fetch-mediamtx' },
    });
    const location = res.headers.get('location') ?? '';
    const match = location.match(/\/releases\/tag\/(.+)$/);
    if (match) return decodeURIComponent(match[1]);
  } catch (err) {
    warn(`redirect fallback failed: ${err?.message ?? err}`);
  }

  return null;
}

/** Candidate asset URLs, most likely first. */
function candidateUrls(tag, os, arch) {
  const urls = [];
  if (tag) {
    urls.push(
      `https://github.com/${REPO}/releases/download/${tag}/mediamtx_${tag}_${os}_${arch}.tar.gz`,
      `https://github.com/${REPO}/releases/download/${tag}/mediamtx_${os}_${arch}.tar.gz`,
    );
  }
  // Last resort: the unversioned "latest" alias (works only if upstream ever
  // publishes unversioned asset names).
  urls.push(`https://github.com/${REPO}/releases/latest/download/mediamtx_${os}_${arch}.tar.gz`);
  urls.push(
    `https://github.com/${REPO}/releases/latest/download/mediamtx_latest_${os}_${arch}.tar.gz`,
  );
  return [...new Set(urls)];
}

/** Download the first candidate URL that responds OK. */
async function downloadTarball(tag, os, arch) {
  const urls = candidateUrls(tag, os, arch);
  let lastStatus = null;
  let networkError = null;

  for (const url of urls) {
    log(`trying: ${url}`);
    let res;
    try {
      res = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'tapo-wall/fetch-mediamtx' },
      });
    } catch (err) {
      networkError = err;
      warn(`  request failed: ${err?.message ?? err}`);
      continue;
    }

    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { buffer: buf, url };
    }

    lastStatus = `${res.status} ${res.statusText}`;
    warn(`  HTTP ${lastStatus}`);
    if (res.status === 403 || res.status === 429) {
      warn('  (looks like GitHub rate limiting — retry later or install manually)');
    }
  }

  if (networkError && !lastStatus) {
    fail(
      `network request to GitHub failed: ${networkError?.message ?? networkError}`,
      `The GitHub release could not be reached. Check your internet connection, VPN, proxy or firewall and try again.\n\n${manualInstructions(os, arch)}`,
    );
  }

  fail(
    `no downloadable asset found (last response: ${lastStatus ?? 'unknown'})`,
    `None of the expected asset names exist for ${tag ?? 'the latest release'}.\n\n${manualInstructions(os, arch)}`,
  );
}

/* ------------------------------------------------------------------- helpers */

async function isExecutable(path) {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const humanSize = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB (${bytes} bytes)`
    : `${(bytes / 1024).toFixed(1)} KiB (${bytes} bytes)`;

/* ---------------------------------------------------------------------- main */

async function main() {
  // 1. Idempotency: an existing executable binary means there is nothing to do.
  if (existsSync(TARGET) && (await isExecutable(TARGET))) {
    log('mediamtx already present');
    log(`path: ${TARGET}`);
    process.exit(0);
  }

  // 2. Platform / architecture detection.
  log(`platform: ${process.platform} (${process.arch})`);
  const os = resolveOs();
  const arch = resolveArch();
  log(`release target: ${os}/${arch}`);

  // 3. Resolve the latest release tag, then download the matching tarball.
  log('resolving latest release...');
  const tag = await resolveLatestTag();
  if (tag) {
    log(`latest release: ${tag}`);
  } else {
    warn('could not resolve the latest release tag; falling back to unversioned asset URLs.');
  }

  log('downloading...');
  const { buffer: tarball, url } = await downloadTarball(tag, os, arch);
  log(`downloaded ${humanSize(tarball.length)} from ${url}`);

  // 4. gunzip + tar parse.
  log('extracting mediamtx from tar.gz...');
  let binary;
  try {
    const tar = gunzipSync(tarball);
    binary = extractFromTar(tar, 'mediamtx');
  } catch (err) {
    fail(`could not extract "mediamtx" from the downloaded archive: ${err?.message ?? err}`);
  }

  if (!binary || binary.length === 0) {
    fail('extracted mediamtx binary is empty — the download may be truncated.');
  }
  log(`extracted binary: ${humanSize(binary.length)}`);

  // 5. Write it out and mark it executable.
  mkdirSync(BIN_DIR, { recursive: true });
  await writeFile(TARGET, binary, { mode: 0o755 });
  await chmod(TARGET, 0o755);

  log(`wrote ${TARGET}`);
  if (tag) log(`version: ${tag}`);
  log(`size: ${binary.length} bytes`);
  log('done. Verify with: bin/mediamtx --version');
}

await main();
