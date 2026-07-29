#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const oyonRoot = path.join(repoRoot, 'OyonR');
const problems = [];
let checked = 0;

const modelHashes = {
  'standalone/models/mediapipe/face_landmarker.task':
    '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  'standalone/models/emotion/mobilevit_va_mtl.onnx':
    '93a2bee1f2e0b04e313c695078e9351c75e8fb4c457af4268a1716cb35601b0c',
  'standalone/models/emotion/mbf_va_mtl.onnx':
    '0323ace52ea6dbe9aa4a909d20933f7b8629c3fb41249e338f4316abf2a4828c',
  'standalone/models/emotion/enet_b0_8_va_mtl.onnx':
    'c43e056ad388d4a8dc911832b8291435b2af537f967e5870ebd731574ec7e812',
  'standalone/models/vad/silero_vad.onnx':
    '2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f',
};

const ortFiles = [
  'ort.min.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function requireFile(file, label = path.relative(repoRoot, file), expectedHash = null) {
  checked += 1;
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
    problems.push(`${label}: missing or empty`);
    return false;
  }
  if (expectedHash && digest(file) !== expectedHash) {
    problems.push(`${label}: checksum mismatch`);
    return false;
  }
  return true;
}

function requireSame(source, target, label) {
  if (!requireFile(source, `${label} source`)) return;
  if (!requireFile(target, label)) return;
  if (statSync(source).size !== statSync(target).size || digest(source) !== digest(target)) {
    problems.push(`${label}: does not match the installed peer dependency`);
  }
}

function resolveFromNodeModules(relativePath) {
  for (const root of [
    path.join(repoRoot, 'node_modules'),
    path.join(oyonRoot, 'node_modules'),
    path.join(path.dirname(repoRoot), 'node_modules'),
  ]) {
    const candidate = path.join(root, relativePath);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

for (const [relativePath, expectedHash] of Object.entries(modelHashes)) {
  requireFile(path.join(oyonRoot, relativePath), relativePath, expectedHash);
}

const ortSource = resolveFromNodeModules('onnxruntime-web/dist');
if (!ortSource) {
  problems.push('onnxruntime-web: installed peer dependency not found');
} else {
  for (const file of ortFiles) {
    requireSame(
      path.join(ortSource, file),
      path.join(oyonRoot, 'standalone/vendor/onnxruntime-web', file),
      `standalone/vendor/onnxruntime-web/${file}`,
    );
  }
}

const mediaPipeSource = resolveFromNodeModules('@mediapipe/tasks-vision');
if (!mediaPipeSource) {
  problems.push('@mediapipe/tasks-vision: installed peer dependency not found');
} else {
  requireSame(
    path.join(mediaPipeSource, 'vision_bundle.mjs'),
    path.join(oyonRoot, 'standalone/vendor/mediapipe/vision_bundle.mjs'),
    'standalone/vendor/mediapipe/vision_bundle.mjs',
  );
  const wasmSource = path.join(mediaPipeSource, 'wasm');
  if (!existsSync(wasmSource)) {
    problems.push('@mediapipe/tasks-vision/wasm: source directory missing');
  } else {
    for (const file of readdirSync(wasmSource)) {
      const source = path.join(wasmSource, file);
      if (!statSync(source).isFile()) continue;
      requireSame(
        source,
        path.join(oyonRoot, 'standalone/vendor/mediapipe/wasm', file),
        `standalone/vendor/mediapipe/wasm/${file}`,
      );
    }
  }
}

const elementDir = path.join(oyonRoot, 'standalone/app/dist-element');
const elementFile = path.join(elementDir, 'oyon-app.element.js');
if (requireFile(elementFile, 'standalone/app/dist-element/oyon-app.element.js')) {
  const source = readFileSync(elementFile, 'utf8');
  const references = new Set(source.match(/assets\/[A-Za-z0-9._-]+/g) ?? []);
  for (const reference of references) {
    requireFile(path.join(elementDir, reference), `standalone/app/dist-element/${reference}`);
  }
}

const elementAssets = path.join(elementDir, 'assets');
const requiredElementAssets = [
  /^voiceAnalysisWorker-.*\.js$/,
  /^voiceFrameWorklet-.*\.js$/,
  /^ort\.bundle\.min-.*\.js$/,
  /^ort\.webgpu\.bundle\.min-.*\.js$/,
  /^ort-wasm-simd-threaded\.asyncify-.*\.wasm$/,
  /^ort-wasm-simd-threaded\.jsep-.*\.wasm$/,
];
const builtAssets = existsSync(elementAssets) ? readdirSync(elementAssets) : [];
for (const pattern of requiredElementAssets) {
  checked += 1;
  if (!builtAssets.some((file) => pattern.test(file))) {
    problems.push(`standalone/app/dist-element/assets: missing ${pattern}`);
  }
}

for (const [overlay, installed] of [
  ['scripts/oyon-overlay/scripts/download-models.sh', 'OyonR/scripts/download-models.sh'],
  ['scripts/oyon-overlay/standalone/app/.gitignore', 'OyonR/standalone/app/.gitignore'],
]) {
  const overlayPath = path.join(repoRoot, overlay);
  const installedPath = path.join(repoRoot, installed);
  if (requireFile(overlayPath, overlay) && requireFile(installedPath, installed)) {
    if (digest(overlayPath) !== digest(installedPath)) {
      problems.push(`${installed}: Rohy overlay was not applied`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Oyon install verification failed (${problems.length} issue(s)):`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('Run: npm run setup:oyon');
  process.exit(1);
}

console.log(`Oyon install verified (${checked} files and artifact rules).`);
