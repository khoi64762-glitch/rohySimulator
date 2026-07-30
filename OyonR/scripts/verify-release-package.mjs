import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expected = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const tarballArg = process.argv[2];

if (!tarballArg) {
  throw new Error('usage: node scripts/verify-release-package.mjs <package.tgz>');
}

const tarball = resolve(ROOT, tarballArg);
const consumer = mkdtempSync(join(tmpdir(), 'oyon-release-consumer-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const node = process.execPath;

const run = (command, args) => execFileSync(command, args, {
  cwd: consumer,
  encoding: 'utf8',
  env: { ...process.env, npm_config_cache: resolve(consumer, '.npm-cache') },
  stdio: ['ignore', 'pipe', 'inherit'],
});

try {
  writeFileSync(resolve(consumer, 'package.json'), JSON.stringify({
    name: 'oyon-release-consumer',
    private: true,
    type: 'module',
  }, null, 2));

  run(npm, [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    tarball,
    '@mediapipe/tasks-vision@0.10.35',
    'onnxruntime-web@1.25.1',
    'react@19.2.3',
    'react-dom@19.2.3',
  ]);

  const installed = JSON.parse(
    readFileSync(resolve(consumer, 'node_modules/oyon/package.json'), 'utf8'),
  );
  assert.equal(installed.version, expected.version, 'installed version must match package.json');

  run(node, ['--input-type=module', '-e', [
    "await import('oyon');",
    "await import('oyon/validation');",
    "await import('oyon/server');",
    "await import('oyon/react');",
  ].join('')]);

  const paths = run(node, ['node_modules/oyon/bin/oyon.js', 'paths']);
  assert.match(paths, /@mediapipe\/tasks-vision\/wasm:/,
    'CLI must report MediaPipe assets');
  assert.match(paths, /onnxruntime-web\/dist:/,
    'CLI must report ONNX Runtime assets');
  assert.doesNotMatch(paths, /@mediapipe\/tasks-vision\/wasm:\s+<not installed>/,
    'CLI must resolve installed MediaPipe assets');
  assert.doesNotMatch(paths, /onnxruntime-web\/dist:\s+<not installed>/,
    'CLI must resolve installed ONNX Runtime assets');

  const dependencyTree = JSON.parse(run(npm, ['ls', '--all', '--json']));
  const serializedTree = JSON.stringify(dependencyTree);
  assert.ok(!serializedTree.includes('mathjs'), 'release dependency tree must not include mathjs');
  assert.ok(!serializedTree.includes('webeyetrack'), 'release dependency tree must not include webeyetrack');

  run(npm, ['audit', '--omit=dev', '--audit-level=high']);
  console.log(`verify-release-package: oyon@${installed.version} passed isolated installation`);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
