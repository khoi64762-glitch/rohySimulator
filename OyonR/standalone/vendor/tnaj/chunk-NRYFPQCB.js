import { isInitialized, setExports } from './chunk-Y6HFV4RZ.js';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

function resolveWasmPkg() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const cand = join(dir, "wasm", "pkg", "tnaj_wasm.js");
    if (existsSync(cand)) return cand;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(dirname(fileURLToPath(import.meta.url)), "..", "wasm", "pkg", "tnaj_wasm.js");
}
async function initWasmEngine(_opts = { source: "inline" }) {
  if (isInitialized()) return;
  try {
    const mod = await import(pathToFileURL(resolveWasmPkg()).href);
    setExports({
      bootstrap_inner_wasm: mod.bootstrap_inner_wasm,
      bootstrap_tna_wasm: mod.bootstrap_tna_wasm,
      permutation_test_wasm: mod.permutation_test_wasm,
      compare_weight_matrices_wasm: mod.compare_weight_matrices_wasm,
      markov_order_test_wasm: mod.markov_order_test_wasm,
      estimate_cs_wasm: mod.estimate_cs_wasm,
      rng_next_n: mod.rng_next_n,
      centralities_wasm: mod.centralities_wasm,
      passage_time_wasm: mod.passage_time_wasm,
      markov_stability_wasm: mod.markov_stability_wasm,
      honem_wasm: mod.honem_wasm,
      path_dependence_wasm: mod.path_dependence_wasm,
      mogen_wasm: mod.mogen_wasm,
      hypa_wasm: mod.hypa_wasm,
      hon_wasm: mod.hon_wasm,
      pathways_hon_wasm: mod.pathways_hon_wasm,
      pathways_hypa_wasm: mod.pathways_hypa_wasm,
      pathways_mogen_wasm: mod.pathways_mogen_wasm,
      casedrop_reliability_wasm: mod.casedrop_reliability_wasm,
      reliability_analysis_wasm: mod.reliability_analysis_wasm,
      cluster_string_wasm: mod.cluster_string_wasm,
      cluster_from_dist_wasm: mod.cluster_from_dist_wasm,
      cluster_numeric_wasm: mod.cluster_numeric_wasm,
      mmm_wasm: mod.mmm_wasm
    });
  } catch (e) {
    throw new Error(
      `initWasmEngine: failed to load wasm pkg \u2014 has wasm-pack been run? Underlying error: ${e.message}`
    );
  }
}

// src/wasm/init.ts
var _initPromise = null;
async function initTnaw() {
  if (isInitialized()) return;
  if (_initPromise) return _initPromise;
  _initPromise = initWasmEngine();
  await _initPromise;
}
function isTnawReady() {
  return isInitialized();
}

export { initTnaw, isTnawReady };
//# sourceMappingURL=chunk-NRYFPQCB.js.map
//# sourceMappingURL=chunk-NRYFPQCB.js.map