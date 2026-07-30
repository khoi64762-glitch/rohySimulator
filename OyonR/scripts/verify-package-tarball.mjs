import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const cache = mkdtempSync(join(tmpdir(), 'oyon-pack-verify-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

try {
  // --ignore-scripts prevents npm pack from recursively invoking
  // prepublishOnly while this verifier itself runs at the end of that gate.
  const stdout = execFileSync(
    npm,
    ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: cache },
    },
  );
  // npm lifecycle hooks are expected to keep stdout clean, but third-party npm
  // versions have historically prefixed diagnostics to `npm pack --json`.
  // Locate the final JSON array so the release gate remains deterministic
  // without weakening any validation of the manifest itself.
  const jsonStart = stdout.lastIndexOf('\n[') + 1;
  const firstArray = stdout.indexOf('[');
  const start = jsonStart > 0 ? jsonStart : firstArray;
  assert.ok(start >= 0, 'npm pack did not return a JSON manifest');
  const report = JSON.parse(stdout.slice(start));
  assert.equal(report.length, 1, 'npm pack must describe exactly one package');

  const packed = new Set(report[0].files.map((file) => file.path));
  const required = new Set([
    'package.json',
    'vendor/webeyetrack.js',
    'vendor/webeyetrack.LICENSE.txt',
  ]);

  for (const target of Object.values(pkg.exports)) {
    const conditions = typeof target === 'string' ? { default: target } : target;
    for (const relTarget of Object.values(conditions)) {
      required.add(relTarget.replace(/^\.\//, ''));
    }
  }
  for (const relTarget of Object.values(pkg.bin ?? {})) {
    required.add(relTarget.replace(/^\.\//, ''));
  }

  for (const relPath of required) {
    assert.ok(packed.has(relPath), `published tarball is missing required target: ${relPath}`);
  }

  console.log(
    `verify-package-tarball: ${required.size} required targets present in ${report[0].entryCount} packed files`,
  );
} finally {
  rmSync(cache, { recursive: true, force: true });
}
