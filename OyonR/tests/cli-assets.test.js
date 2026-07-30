import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repoRoot, 'bin', 'oyon.js');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'oyon-cli-assets-'));

const { SILERO_VAD_MODEL_URL } = await import(
  new URL('../src/config/cdnDefaults.js', import.meta.url)
);

function writeFixture(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

// Tiny local asset server so `download-models` (via OYON_ASSETS_BASE) can be
// exercised hermetically — no network, no real model bytes. Serves a
// distinguishable body per requested filename.
function startAssetServer() {
  const server = createServer((req, res) => {
    const name = req.url.split('/').pop();
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(`fixture-bytes:${name}`);
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

const assetServer = await startAssetServer();
const assetsBase = `http://127.0.0.1:${assetServer.address().port}`;

try {
  writeFixture(join(fixtureRoot, 'package.json'), '{"private":true,"type":"module"}\n');

  const mediaPipeRoot = join(fixtureRoot, 'node_modules', '@mediapipe', 'tasks-vision');
  writeFixture(join(mediaPipeRoot, 'package.json'), JSON.stringify({
    name: '@mediapipe/tasks-vision',
    version: '0.0.0-test',
    exports: { '.': './vision_bundle.cjs' },
  }));
  writeFixture(join(mediaPipeRoot, 'vision_bundle.cjs'), 'module.exports = {};\n');
  writeFixture(join(mediaPipeRoot, 'wasm', 'fixture.wasm'), 'mediapipe-fixture');

  const ortRoot = join(fixtureRoot, 'node_modules', 'onnxruntime-web');
  writeFixture(join(ortRoot, 'package.json'), JSON.stringify({
    name: 'onnxruntime-web',
    version: '0.0.0-test',
    exports: { '.': './dist/ort.node.min.js' },
  }));
  writeFixture(join(ortRoot, 'dist', 'ort.node.min.js'), 'module.exports = {};\n');
  writeFixture(join(ortRoot, 'dist', 'fixture.wasm'), 'onnx-fixture');

  const pathsOutput = execFileSync(process.execPath, [cli, 'paths'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  });
  assert.ok(pathsOutput.includes(join(mediaPipeRoot, 'wasm')));
  assert.ok(pathsOutput.includes(join(ortRoot, 'dist')));
  // The Silero VAD model URL must come from cdnDefaults.js (no drift from
  // what SileroVadAdapter fetches by default).
  assert.ok(pathsOutput.includes(SILERO_VAD_MODEL_URL));
  assert.doesNotMatch(pathsOutput, /<not installed>/);

  const outputRoot = join(fixtureRoot, 'public');
  execFileSync(process.execPath, [cli, 'install-assets', outputRoot], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  });
  assert.equal(
    readFileSync(join(outputRoot, 'oyon', 'vendor', 'mediapipe', 'wasm', 'fixture.wasm'), 'utf8'),
    'mediapipe-fixture',
  );
  assert.equal(
    readFileSync(join(outputRoot, 'oyon', 'vendor', 'onnxruntime-web', 'fixture.wasm'), 'utf8'),
    'onnx-fixture',
  );

  // download-models against the local server: every model in the list —
  // including the Silero VAD asset — must land at its documented rel path.
  // Async (not execFileSync): the asset server lives on THIS process's event
  // loop, and a synchronous child wait would deadlock it against the child's
  // pending HTTP requests.
  const { stdout: downloadOutput } = await execFileAsync(
    process.execPath,
    [cli, 'download-models', outputRoot],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, OYON_ASSETS_BASE: assetsBase },
    },
  );
  assert.ok(downloadOutput.includes('Silero VAD'));
  const modelsRoot = join(outputRoot, 'oyon', 'models');
  assert.equal(
    readFileSync(join(modelsRoot, 'vad', 'silero_vad.onnx'), 'utf8'),
    'fixture-bytes:silero_vad.onnx',
  );
  assert.equal(
    readFileSync(join(modelsRoot, 'mediapipe', 'face_landmarker.task'), 'utf8'),
    'fixture-bytes:face_landmarker.task',
  );
  assert.equal(
    readFileSync(join(modelsRoot, 'emotion', 'enet_b0_8_va_mtl.onnx'), 'utf8'),
    'fixture-bytes:enet_b0_8_va_mtl.onnx',
  );

  // Idempotence: a second run without --force skips existing files (no HTTP
  // request is made, but keep the async shape for consistency).
  const { stdout: rerunOutput } = await execFileAsync(
    process.execPath,
    [cli, 'download-models', outputRoot],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, OYON_ASSETS_BASE: assetsBase },
    },
  );
  assert.ok(rerunOutput.includes('skipped (already present)'));
  assert.doesNotMatch(rerunOutput, /failed:/);
} finally {
  assetServer.close();
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('cli-assets.test.js passed');
