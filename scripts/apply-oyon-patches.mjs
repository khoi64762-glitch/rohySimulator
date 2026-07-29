#!/usr/bin/env node
/*
 * Re-apply Rohy-specific overlays on top of vendored OyonR/.
 *
 * Why this exists:
 *   `npm run oyon:update` runs `rsync --delete` from upstream Oyon, which
 *   wipes anything we've added or modified in OyonR/. The integration depends
 *   on a handful of small but load-bearing patches (Rohy mode in the
 *   standalone, an importmap, a GPU delegate option). Storing the patched
 *   files as overlays in scripts/oyon-overlay/ and copying them back after
 *   every sync is the simplest contract that survives upstream churn:
 *
 *     - Idempotent: running it twice is a no-op.
 *     - Self-documenting: anyone wondering "what did Rohy add?" can list
 *       scripts/oyon-overlay/.
 *     - Fail-loud: if upstream restructures and an overlay's destination
 *       directory disappears, we exit non-zero so CI catches it.
 *
 * Downloaded models and runtime bundles (mediapipe, onnxruntime-web) are NOT
 * overlaid here — targeted rsync excludes in scripts/update-oyonr.sh preserve
 * them. Versioned source vendors still refresh from upstream Oyon.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const overlayRoot = path.join(repoRoot, 'scripts', 'oyon-overlay');
const oyonRoot = path.join(repoRoot, 'OyonR');

if (!fs.existsSync(oyonRoot)) {
  console.error('OyonR/ does not exist. Run scripts/update-oyonr.sh first.');
  process.exit(1);
}
if (!fs.existsSync(overlayRoot)) {
  // Rohy carries no Oyon source patches: the <oyon-app> element covers the
  // integration through host attributes. An absent overlay tree is expected.
  console.log('[overlay] no overlay tree — nothing to apply');
  process.exit(0);
}

let copied = 0;
let unchanged = 0;
let missingParent = 0;

function walk(dir, rel = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    const sourcePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(sourcePath, childRel);
      continue;
    }
    if (!entry.isFile()) continue;
    const targetPath = path.join(oyonRoot, childRel);
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      console.error(`[overlay] missing target dir for ${childRel} — upstream may have restructured: ${targetDir}`);
      missingParent += 1;
      continue;
    }
    if (fs.existsSync(targetPath)) {
      const a = fs.readFileSync(sourcePath);
      const b = fs.readFileSync(targetPath);
      if (a.equals(b)) {
        unchanged += 1;
        continue;
      }
    }
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`[overlay] applied ${childRel}`);
    copied += 1;
  }
}

walk(overlayRoot);

// Oyon 3.3.2 renamed the analytics navigation label to "Dynamics", while its
// own E2E assertion still expects the older "Affect dynamics" label. Keep the
// vendored release test aligned with the immutable tagged UI after each sync.
const standaloneE2e = path.join(oyonRoot, 'tests', 'e2e', 'standalone-app.spec.ts');
if (fs.existsSync(standaloneE2e)) {
  const source = fs.readFileSync(standaloneE2e, 'utf8');
  const stale = "await page.getByRole('link', { name: 'Affect dynamics' }).click();";
  const current = "await page.getByRole('link', { name: 'Dynamics', exact: true }).click();";
  if (source.includes(stale)) {
    fs.writeFileSync(
      standaloneE2e,
      source
        .replace(
          '// (Tab relabeled "Affect dynamics"; route id stays /analyze/sequence.)',
          '// The route id remains /analyze/sequence.',
        )
        .replace(stale, current),
    );
    console.log('[overlay] patched tests/e2e/standalone-app.spec.ts navigation label');
    copied += 1;
  } else if (source.includes(current)) {
    unchanged += 1;
  } else {
    console.error('[overlay] Oyon standalone navigation assertion changed upstream');
    missingParent += 1;
  }
}

console.log(`[overlay] ${copied} copied, ${unchanged} unchanged, ${missingParent} missing-parent`);
if (missingParent > 0) process.exit(2);
