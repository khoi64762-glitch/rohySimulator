import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const projectManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const vendoredModule = readFileSync(new URL('../vendor/webeyetrack.js', import.meta.url), 'utf8');
const bundleStart = vendoredModule.indexOf('/*! For license information');
const bundleEnd = vendoredModule.indexOf('\nconst bundledWebEyeTrack');
const embeddedBundle = vendoredModule.slice(bundleStart, bundleEnd);

assert.equal(
  projectManifest.overrides?.webeyetrack?.mathjs,
  '15.2.0',
  'the vulnerable dev-only mathjs installation must remain pinned to the reviewed fixed version',
);
assert.equal(projectManifest.dependencies?.webeyetrack, undefined);
assert.equal(projectManifest.devDependencies?.webeyetrack, '^0.0.2');
assert.ok(bundleStart >= 0 && bundleEnd > bundleStart, 'vendored WebEyeTrack bundle markers must exist');
assert.equal(
  createHash('sha256').update(embeddedBundle).digest('hex'),
  '11075aa7e0abf971ecbba41dbca935f39d283b2d4b9169070d2d33eb94f79c18',
  'the vendored WebEyeTrack runtime bytes must match the reviewed upstream bundle',
);
assert.doesNotMatch(
  embeddedBundle,
  /require\s*\(\s*["']mathjs["']\s*\)/,
  'the WebEyeTrack runtime must remain self-contained rather than loading mathjs',
);

console.log('dependency-security.test.js passed');
