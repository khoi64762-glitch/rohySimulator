'use strict';

var chunkNXZY3JA5_cjs = require('./chunk-NXZY3JA5.cjs');
var __wbg_init = require('../wasm/pkg-web/tnaj_wasm.js');

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var __wbg_init__namespace = /*#__PURE__*/_interopNamespace(__wbg_init);

async function initWasmEngineWeb(wasmUrl) {
  if (chunkNXZY3JA5_cjs.isInitialized()) return;
  await __wbg_init__namespace.default(wasmUrl);
  const mod = __wbg_init__namespace;
  chunkNXZY3JA5_cjs.setExports({
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
}

// src/wasm/init-web.ts
var _initPromise = null;
async function initTnaw() {
  if (chunkNXZY3JA5_cjs.isInitialized()) return;
  if (_initPromise) return _initPromise;
  _initPromise = initWasmEngineWeb();
  await _initPromise;
}
function isTnawReady() {
  return chunkNXZY3JA5_cjs.isInitialized();
}

exports.initTnaw = initTnaw;
exports.isTnawReady = isTnawReady;
//# sourceMappingURL=chunk-VKILRMYU.cjs.map
//# sourceMappingURL=chunk-VKILRMYU.cjs.map