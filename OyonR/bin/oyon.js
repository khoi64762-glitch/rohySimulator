#!/usr/bin/env node
// Oyon CLI — install browser-side assets into a host app's public directory.
//
// Usage:
//   npx oyon install-assets <out-dir>          Copy WASM runtimes from peer deps
//   npx oyon download-models <out-dir>         Download ONNX + MediaPipe models
//   npx oyon paths                             Print resolved peer-dep asset paths
//   npx oyon host-check [public-dir]            Verify package, peers, and optional assets
//   npx oyon --help

import { mkdirSync, existsSync, cpSync, readdirSync, readFileSync, statSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildHostCheckReport } from './host-check.js';
import {
  MEDIAPIPE_TASKS_WASM_CDN,
  ONNX_RUNTIME_WASM_CDN,
  SILERO_VAD_MODEL_URL,
  SILERO_VAD_MODEL_VERSION,
} from '../src/config/cdnDefaults.js';
import {
  OYON_HOST_CONTRACT_VERSION,
  OYON_VERSION,
  OYON_WINDOW_BATCH_SCHEMA_VERSION,
} from '../src/version.js';

const require = createRequire(import.meta.url);
const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(SELF_DIR, '..');

const HELP = `oyon — install browser-side assets for the Oyon FER package.

Commands:
  install-assets <dir>     Copy MediaPipe + ONNX Runtime WASM into <dir>/oyon/vendor/
  download-models <dir>    Download ONNX model weights into <dir>/oyon/models/
  paths                    Print resolved asset locations from peer dependencies
  host-check [public-dir]  Verify package, host peers, element, and optional assets
  help                     Show this message

Examples:
  npx oyon install-assets ./public
  npx oyon download-models ./public --force
  npx oyon host-check ./public
  npx oyon host-check ./public --json
`;

function findPackageDir(entryPath, packageName) {
  let current = dirname(entryPath);
  while (true) {
    const manifestPath = join(current, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.name === packageName) return current;
      } catch {
        // Keep walking: an unrelated or malformed parent manifest is not a match.
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolvePeerPackage(packageName, cwd = process.cwd(), allowPackageFallback = true) {
  // Try the host's node_modules first, then fall back to Oyon's own.
  const bases = allowPackageFallback && cwd !== PKG_ROOT ? [cwd, PKG_ROOT] : [cwd];
  for (const base of bases) {
    const localRequire = createRequire(join(base, 'package.json'));
    try {
      return dirname(localRequire.resolve(`${packageName}/package.json`));
    } catch {
      // Modern packages may intentionally hide package.json via "exports".
      // Resolve their public entry and walk back to the matching package root.
      try {
        const packageDir = findPackageDir(localRequire.resolve(packageName), packageName);
        if (packageDir) return packageDir;
      } catch {
        // fall through
      }
    }
  }
  return null;
}

function mediapipeWasmDir() {
  const pkgDir = resolvePeerPackage('@mediapipe/tasks-vision');
  if (!pkgDir) return null;
  const candidate = join(pkgDir, 'wasm');
  return existsSync(candidate) ? candidate : null;
}

function ortWasmDir() {
  const pkgDir = resolvePeerPackage('onnxruntime-web');
  if (!pkgDir) return null;
  const candidate = join(pkgDir, 'dist');
  return existsSync(candidate) ? candidate : null;
}

function copyWasmAssets(outRoot) {
  const targetDir = join(outRoot, 'oyon', 'vendor');
  mkdirSync(targetDir, { recursive: true });

  const mp = mediapipeWasmDir();
  const ort = ortWasmDir();
  const report = [];

  if (mp) {
    const dest = join(targetDir, 'mediapipe', 'wasm');
    cpSync(mp, dest, { recursive: true });
    report.push({ name: 'mediapipe/tasks-vision', src: mp, dest });
  } else {
    report.push({ name: 'mediapipe/tasks-vision', src: null, error: 'peer dep not installed' });
  }

  if (ort) {
    const dest = join(targetDir, 'onnxruntime-web');
    cpSync(ort, dest, { recursive: true });
    report.push({ name: 'onnxruntime-web', src: ort, dest });
  } else {
    report.push({ name: 'onnxruntime-web', src: null, error: 'peer dep not installed' });
  }

  return { targetDir, report };
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    total += stat.isDirectory() ? dirSize(full) : stat.size;
  }
  return total;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// Default to upstream sources. To pull from the self-hosted assets-v1
// release instead, set OYON_ASSETS_BASE in the environment, e.g.
//   OYON_ASSETS_BASE=https://github.com/mohsaqr/Oyon/releases/download/assets-v1 \
//     npx oyon download-models ./public
// (Self-hosted release works only after the repo is public.)
const ASSETS_BASE = process.env.OYON_ASSETS_BASE || null;

const MODELS = ASSETS_BASE ? [
  { label: 'MediaPipe Face Landmarker (float16)', url: `${ASSETS_BASE}/face_landmarker.task`, rel: 'mediapipe/face_landmarker.task' },
  { label: 'EmotiEffLib MobileViT MTL',           url: `${ASSETS_BASE}/mobilevit_va_mtl.onnx`, rel: 'emotion/mobilevit_va_mtl.onnx' },
  { label: 'EmotiEffLib MobileFaceNet MTL',       url: `${ASSETS_BASE}/mbf_va_mtl.onnx`,       rel: 'emotion/mbf_va_mtl.onnx' },
  { label: 'HSEmotion EfficientNet-B0 MTL',       url: `${ASSETS_BASE}/enet_b0_8_va_mtl.onnx`, rel: 'emotion/enet_b0_8_va_mtl.onnx' },
  { label: `Silero VAD (${SILERO_VAD_MODEL_VERSION})`, url: `${ASSETS_BASE}/silero_vad.onnx`,  rel: 'vad/silero_vad.onnx' },
] : [
  {
    label: 'MediaPipe Face Landmarker (float16)',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    rel: 'mediapipe/face_landmarker.task',
  },
  {
    label: 'EmotiEffLib MobileViT MTL',
    url: 'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/mobilevit_va_mtl.onnx',
    rel: 'emotion/mobilevit_va_mtl.onnx',
  },
  {
    label: 'EmotiEffLib MobileFaceNet MTL',
    url: 'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/mbf_va_mtl.onnx',
    rel: 'emotion/mbf_va_mtl.onnx',
  },
  {
    label: 'HSEmotion EfficientNet-B0 MTL',
    url: 'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/enet_b0_8_va_mtl.onnx',
    rel: 'emotion/enet_b0_8_va_mtl.onnx',
  },
  {
    // Imported from src/config/cdnDefaults.js so the CLI can never drift
    // from the URL the runtime's SileroVadAdapter fetches by default.
    label: `Silero VAD (${SILERO_VAD_MODEL_VERSION})`,
    url: SILERO_VAD_MODEL_URL,
    rel: 'vad/silero_vad.onnx',
  },
];

async function downloadOne(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function downloadModels(outRoot, { force = false } = {}) {
  const targetDir = join(outRoot, 'oyon', 'models');
  mkdirSync(targetDir, { recursive: true });
  const results = [];
  for (const m of MODELS) {
    const dest = join(targetDir, m.rel);
    if (existsSync(dest) && statSync(dest).size > 0 && !force) {
      results.push({ ...m, dest, status: 'skipped (already present)' });
      continue;
    }
    process.stdout.write(`→ ${m.label}\n  ↓ ${m.url}\n`);
    try {
      await downloadOne(m.url, dest);
      results.push({ ...m, dest, status: 'downloaded' });
    } catch (err) {
      results.push({ ...m, dest, status: `failed: ${err.message}` });
    }
  }
  return { targetDir, results };
}

function tryRunShellScript(outRoot, force) {
  const sh = join(PKG_ROOT, 'scripts', 'download-models.sh');
  if (!existsSync(sh)) return false;
  if (process.platform === 'win32') return false;
  // The bundled shell script targets PKG_ROOT/standalone — only useful when
  // the host wants assets in that exact layout. Skip in favour of fetch().
  return false;
}

function printPaths() {
  const mp = mediapipeWasmDir();
  const ort = ortWasmDir();
  console.log('Resolved peer-dep asset directories:');
  console.log(`  @mediapipe/tasks-vision/wasm:   ${mp ?? '<not installed>'}`);
  console.log(`  onnxruntime-web/dist:           ${ort ?? '<not installed>'}`);
  console.log('');
  console.log('Public CDN URLs (default in oyon runtime):');
  // Imported from src/config/cdnDefaults.js so this output can never drift
  // from what the runtime actually fetches.
  console.log(`  ${MEDIAPIPE_TASKS_WASM_CDN}`);
  console.log(`  ${ONNX_RUNTIME_WASM_CDN}`);
  console.log('');
  console.log(`Default model URLs (voice pipeline, ${SILERO_VAD_MODEL_VERSION}):`);
  console.log(`  ${SILERO_VAD_MODEL_URL}`);
  console.log('');
  console.log('Self-hosted alternative (requires the Oyon repo to be public):');
  console.log('  https://github.com/mohsaqr/Oyon/releases/download/assets-v1/');
  console.log('  Set OYON_ASSETS_BASE=<url> to make the CLI download from there.');
}

function printHostCheck(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(
    `Oyon ${report.version} · host contract ${report.hostContractVersion} · ` +
      `batch ${report.batchSchemaVersion}`,
  );
  for (const entry of report.checks) {
    const mark = entry.status === 'pass' ? '✓' : entry.status === 'warn' ? '!' : '✗';
    console.log(`  ${mark} ${entry.id}: ${entry.detail}`);
  }
  console.log(report.ok ? '\nHost check passed.' : '\nHost check failed.');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }

  if (cmd === 'paths') {
    printPaths();
    return;
  }

  if (cmd === 'host-check') {
    const publicArg = rest.find((arg) => !arg.startsWith('--')) ?? null;
    const report = buildHostCheckReport({
      packageRoot: PKG_ROOT,
      publicRoot: publicArg ? resolve(process.cwd(), publicArg) : null,
      peerRoots: {
        '@mediapipe/tasks-vision': resolvePeerPackage(
          '@mediapipe/tasks-vision',
          process.cwd(),
          false,
        ),
        'onnxruntime-web': resolvePeerPackage('onnxruntime-web', process.cwd(), false),
      },
      expectedVersion: OYON_VERSION,
      hostContractVersion: OYON_HOST_CONTRACT_VERSION,
      batchSchemaVersion: OYON_WINDOW_BATCH_SCHEMA_VERSION,
    });
    printHostCheck(report, rest.includes('--json'));
    if (!report.ok) process.exit(1);
    return;
  }

  if (cmd === 'install-assets') {
    const outDir = rest[0];
    if (!outDir) {
      console.error('error: missing output directory.\n');
      console.error(HELP);
      process.exit(2);
    }
    const out = resolve(process.cwd(), outDir);
    const { targetDir, report } = copyWasmAssets(out);
    for (const r of report) {
      if (r.error) {
        console.error(`  ✗ ${r.name}: ${r.error}`);
      } else {
        console.log(`  ✓ ${r.name} → ${r.dest} (${fmtBytes(dirSize(r.dest))})`);
      }
    }
    const failed = report.some(r => r.error);
    if (failed) {
      console.error('\nInstall peer deps in your host app and re-run:');
      console.error('  npm install @mediapipe/tasks-vision onnxruntime-web');
      process.exit(1);
    }
    console.log(`\nDone. Configure Oyon runtime to load assets from your /oyon/vendor/ URL.`);
    return;
  }

  if (cmd === 'download-models') {
    const outDir = rest[0];
    if (!outDir) {
      console.error('error: missing output directory.\n');
      console.error(HELP);
      process.exit(2);
    }
    const force = rest.includes('--force');
    const out = resolve(process.cwd(), outDir);
    const { targetDir, results } = await downloadModels(out, { force });
    for (const r of results) {
      const ok = r.status.startsWith('downloaded') || r.status.startsWith('skipped');
      const mark = ok ? '✓' : '✗';
      console.log(`  ${mark} ${r.label}: ${r.status}`);
    }
    const anyFailed = results.some(r => r.status.startsWith('failed'));
    if (anyFailed) process.exit(1);
    console.log(`\nDone. Models live under ${targetDir}.`);
    return;
  }

  console.error(`unknown command: ${cmd}\n`);
  console.error(HELP);
  process.exit(2);
}

main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
