import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OYON_HOST_CONTRACT_VERSION,
  OYON_MODALITIES,
  OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS,
  OYON_VERSION,
  OYON_WINDOW_BATCH_SCHEMA_VERSION,
  OYON_WINDOW_KINDS,
} from '../src/version.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

assert.equal(OYON_VERSION, pkg.version, 'package.json and OYON_VERSION must match');
assert.match(OYON_HOST_CONTRACT_VERSION, /^\d+\.\d+$/);
assert.equal(OYON_WINDOW_BATCH_SCHEMA_VERSION, 'oyon-window-batch-v4');
// v4 is what Oyon emits; v3 stays accepted so hosts on the older contract keep
// working. Dropping v3 is a breaking change and must be a deliberate edit here.
assert.deepEqual(
  OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS,
  ['oyon-window-batch-v4', 'oyon-window-batch-v3'],
);
assert.equal(OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS[0], OYON_WINDOW_BATCH_SCHEMA_VERSION);
assert.equal(Object.isFrozen(OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS), true);

// Modality + window-kind enums are part of the wire contract.
assert.ok(OYON_MODALITIES.includes('emotion'));
assert.ok(OYON_MODALITIES.includes('typing'));
assert.ok(OYON_MODALITIES.includes('voice'));
assert.deepEqual(OYON_WINDOW_KINDS, ['interval', 'episode']);
assert.equal(Object.isFrozen(OYON_MODALITIES), true);
assert.equal(Object.isFrozen(OYON_WINDOW_KINDS), true);

console.log('version-contract.test.js passed');
