// Packaging contract: every subpath in the exports map must resolve to a
// real file with real types, every export target must be covered by the files
// allowlist, and every source target must actually parse/import. The post-build
// scripts/verify-package-tarball.mjs gate separately inspects npm's real packed
// file list; ignore files can still override an allowlist.
// Catches the classic publish-time breakages: renamed file, forgotten
// `files` entry, types pointing at nothing.

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

// The nested app ignore boundary is required because its .gitignore excludes
// dist-element. Without a sibling .npmignore, npm silently drops the built
// app-element export even though package.json's files allowlist includes it.
assert.ok(
  existsSync(resolve(ROOT, 'standalone/app/.npmignore')),
  'standalone/app/.npmignore must preserve the built app-element export',
);

// npm always ships these regardless of the files allowlist.
const ALWAYS_PACKED = new Set(['package.json', 'README.md', 'LICENSE']);

const isAllowlisted = (relPath) =>
  ALWAYS_PACKED.has(relPath) ||
  pkg.files.some((entry) => relPath === entry || relPath.startsWith(`${entry}/`));

// Built artifacts are produced by prepublishOnly, not committed — existence
// is only asserted when the build output is present locally.
const BUILT_PREFIXES = ['dist/', 'standalone/app/dist-element/'];
const isBuiltArtifact = (relPath) => BUILT_PREFIXES.some((p) => relPath.startsWith(p));

let checked = 0;
for (const [subpath, target] of Object.entries(pkg.exports)) {
  const entries = typeof target === 'string' ? { default: target } : target;
  for (const [condition, relTarget] of Object.entries(entries)) {
    const rel = relTarget.replace(/^\.\//, '');
    assert.ok(isAllowlisted(rel),
      `${subpath} (${condition}) → ${rel} is not covered by the files allowlist — it would be missing from the npm tarball`);
    if (isBuiltArtifact(rel)) {
      if (existsSync(resolve(ROOT, rel))) checked += 1;
      continue;
    }
    assert.ok(existsSync(resolve(ROOT, rel)),
      `${subpath} (${condition}) → ${rel} does not exist`);
    checked += 1;
  }
}
assert.ok(checked >= 20, `suspiciously few export targets verified (${checked})`);

// Every source export target must be importable (catches syntax errors and
// broken internal imports that `node --check` per-file can miss).
const importTargets = [...new Set(
  Object.values(pkg.exports)
    .map((t) => (typeof t === 'string' ? t : t.import ?? t.default))
    .filter((t) => t && t.endsWith('.js') && t.startsWith('./src/')),
)];

// Direct bare imports in a published entry point must be represented in the
// install contract. This catches clean-install failures even when the local dev
// tree happens to provide a transitive copy of the package.
const declaredRuntimeDependencies = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);
for (const target of importTargets) {
  const source = readFileSync(resolve(ROOT, target), 'utf8');
  const imports = source.matchAll(/^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/gm);
  for (const match of imports) {
    const specifier = match[1];
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue;
    const dependency = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    assert.ok(
      declaredRuntimeDependencies.has(dependency),
      `exports target ${target} imports undeclared runtime dependency ${dependency}`,
    );
  }
}

for (const target of importTargets) {
  // React subpaths are importable only when their optional peers are present.
  // A missing package is tolerable here only when the package contract declares
  // it explicitly; otherwise a clean consumer install would fail unexpectedly.
  try {
    await import(new URL(`../${target.replace(/^\.\//, '')}`, import.meta.url).href);
  } catch (err) {
    const missing = /Cannot find package '(react|react-dom)'/.exec(String(err?.message ?? err));
    if (!missing) throw new Error(`exports target ${target} failed to import: ${err?.message ?? err}`);
    assert.ok(
      pkg.peerDependencies?.[missing[1]],
      `exports target ${target} imports undeclared peer dependency ${missing[1]}`,
    );
  }
}

// The bin entry must exist, be executable source, and stay allowlisted.
for (const [name, rel] of Object.entries(pkg.bin)) {
  const clean = rel.replace(/^\.\//, '');
  assert.ok(existsSync(resolve(ROOT, clean)), `bin ${name} → ${clean} missing`);
  assert.ok(isAllowlisted(clean), `bin ${name} → ${clean} not in files allowlist`);
}

// Types referenced by export conditions must exist.
for (const [subpath, target] of Object.entries(pkg.exports)) {
  if (subpath !== './package.json') {
    assert.equal(
      typeof target === 'object' && typeof target.types === 'string',
      true,
      `${subpath} is executable but has no TypeScript declaration target`,
    );
  }
  if (typeof target === 'string') continue;
  if (!target.types) continue;
  const rel = target.types.replace(/^\.\//, '');
  assert.ok(existsSync(resolve(ROOT, rel)), `${subpath} types → ${rel} missing`);
}

const reactGazeTypes = readFileSync(resolve(ROOT, 'types/react-gaze-calibration.d.ts'), 'utf8');
assert.match(
  reactGazeTypes,
  /export const GazeCalibrationPanel\b/,
  'oyon/react/gaze-calibration types must declare its JavaScript named export',
);


/*
 * Barrel parity: every pipeline collaborator must be reachable from the public
 * entry point AND declared in the hand-written types.
 *
 * Respiration and illumination shipped fully wired into the runtime but absent
 * from src/index.js, so a host could not import or subclass them at all — the
 * "every collaborator is swappable" contract held in the runtime and broke at
 * the package boundary. Nothing caught it: the exports-map checks above only
 * verify that declared subpaths resolve, not that new modules were declared.
 */
{
  const barrel = readFileSync(resolve(ROOT, 'src/index.js'), 'utf8');
  const dts = readFileSync(resolve(ROOT, 'types/index.d.ts'), 'utf8');
  const required = [
    // estimator / extractor        aggregator
    ['HeartRateEstimator', 'HeartRateAggregator'],
    ['RespirationEstimator', 'RespirationAggregator'],
    ['IlluminationEstimator', 'IlluminationAggregator'],
    ['extractFacialSignals', 'FacialSignalAggregator'],
    ['extractPostureFeatures', 'PostureAggregator'],
    ['extractEyeFeatures', 'EngagementAggregator'],
  ];
  for (const pair of required) {
    for (const name of pair) {
      assert.ok(
        new RegExp(`\\b${name}\\b`).test(barrel),
        `src/index.js must export ${name} — a pipeline that is wired into the runtime but not exported cannot be swapped or tested by a host`,
      );
      assert.ok(
        new RegExp(`\\b${name}\\b`).test(dts),
        `types/index.d.ts must declare ${name}`,
      );
    }
  }
}

/**
 * Every VALUE declared in a subpath's .d.ts must actually exist at runtime.
 *
 * Caught in review: `types/typing.d.ts` declared `createTypingComposerAdapter`
 * while `oyon/typing` resolved to TypingAggregator.js, which does not export it.
 * A TypeScript host would compile clean and get `undefined` at run time — the
 * worst kind of packaging bug, because the type system actively vouches for it.
 *
 * One .d.ts may back several subpaths (gaze does this, typing now does too), so
 * a symbol counts as present if ANY runtime target sharing that .d.ts exports it.
 */
{
  const targetsByDts = new Map();
  for (const [subpath, entry] of Object.entries(pkg.exports)) {
    if (!entry || typeof entry !== 'object' || !entry.types) continue;
    const runtime = entry.import || entry.default;
    if (!runtime || !runtime.endsWith('.js')) continue;
    if (!existsSync(resolve(ROOT, runtime))) continue; // built artifact, checked above
    if (!targetsByDts.has(entry.types)) targetsByDts.set(entry.types, []);
    targetsByDts.get(entry.types).push({ subpath, runtime });
  }

  // `export declare function x` / `export class X` / `export const X` are values.
  // `export interface` / `export type` are erased and must NOT be required.
  const VALUE_DECL = /^export\s+(?:declare\s+)?(?:function|class|const)\s+([A-Za-z_$][\w$]*)/gm;
  const RUNTIME_DECL = /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

  for (const [dtsPath, targets] of targetsByDts) {
    const dtsSource = readFileSync(resolve(ROOT, dtsPath), 'utf8');
    const declared = [...dtsSource.matchAll(VALUE_DECL)].map((match) => match[1]);
    if (declared.length === 0) continue;

    const available = new Set();
    for (const { runtime } of targets) {
      const source = readFileSync(resolve(ROOT, runtime), 'utf8');
      for (const match of source.matchAll(RUNTIME_DECL)) available.add(match[1]);
      for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const part of match[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop();
          if (name) available.add(name.trim());
        }
      }
    }

    for (const name of declared) {
      assert.ok(
        available.has(name),
        `${dtsPath} declares the value \`${name}\`, but none of its runtime targets `
        + `(${targets.map((t) => t.runtime).join(', ')}) export it. Either add a subpath `
        + `whose runtime target exports it, or drop the declaration.`,
      );
    }
  }
}

console.log(`exports-map.test.js passed (${checked} targets verified)`);
