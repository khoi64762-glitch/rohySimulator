'use strict';

var chunkVP4KFTHM_cjs = require('./chunk-VP4KFTHM.cjs');
var chunkNXZY3JA5_cjs = require('./chunk-NXZY3JA5.cjs');
var chunkPSLEWOXL_cjs = require('./chunk-PSLEWOXL.cjs');
var chunkT7KNIXMR_cjs = require('./chunk-T7KNIXMR.cjs');
var chunkQ2XZ4DYY_cjs = require('./chunk-Q2XZ4DYY.cjs');
var chunkOLUSGFBH_cjs = require('./chunk-OLUSGFBH.cjs');
var chunkO5U3BFYT_cjs = require('./chunk-O5U3BFYT.cjs');

// src/full/state.ts
var _initPromise = null;
async function initWasm() {
  if (chunkVP4KFTHM_cjs.isTnawReady()) return true;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      await chunkVP4KFTHM_cjs.initTnaw();
      return chunkVP4KFTHM_cjs.isTnawReady();
    } catch (err) {
      console.warn("[tnajw/full] WASM init failed; dispatchers will use TS fallback:", err);
      return false;
    }
  })();
  return _initPromise;
}
function isWasmEnabled() {
  return chunkVP4KFTHM_cjs.isTnawReady();
}

// src/full/can-route.ts
var CENTRALITIES_WASM = /* @__PURE__ */ new Set([
  "OutStrength",
  "InStrength",
  "Betweenness",
  "PageRank",
  "Diffusion",
  "ClosenessIn",
  "ClosenessOut",
  "Closeness",
  "Clustering",
  "BetweennessRSP"
]);
var ESTIMATE_CS_WASM = /* @__PURE__ */ new Set([
  "OutStrength",
  "InStrength",
  "Betweenness"
]);
var BOOTSTRAP_SCALING_WASM = /* @__PURE__ */ new Set(["max", "rank", "minmax"]);
function canRouteBootstrap(model, _options = {}) {
  if (chunkOLUSGFBH_cjs.isGroupTNA(model)) return false;
  if (!model.data) return false;
  const scaling = model.scaling ?? [];
  for (const s of scaling) {
    if (!BOOTSTRAP_SCALING_WASM.has(s)) return false;
  }
  return true;
}
function canRouteCentralities(model, options = {}) {
  if (chunkOLUSGFBH_cjs.isGroupTNA(model)) return false;
  const requested = options.measures ?? ["OutStrength", "InStrength", "Betweenness"];
  for (const m of requested) {
    if (!CENTRALITIES_WASM.has(m)) return false;
  }
  return true;
}
function canRoutePermutation(x, y) {
  if (chunkOLUSGFBH_cjs.isGroupTNA(x) || chunkOLUSGFBH_cjs.isGroupTNA(y)) return false;
  if (!x.data || !y.data) return false;
  if (x.labels.length !== y.labels.length) return false;
  return true;
}
function canRouteEstimateCS(model, options = {}) {
  if (chunkOLUSGFBH_cjs.isGroupTNA(model)) return false;
  if (!model.data) return false;
  const measures = options.measures ?? ["InStrength", "OutStrength", "Betweenness"];
  for (const m of measures) {
    if (!ESTIMATE_CS_WASM.has(m)) return false;
  }
  return true;
}
function canRouteCompareWeightMatrices(a, b) {
  return a.labels.length === b.labels.length && a.labels.length > 0;
}
function canRouteMarkovOrderTest(_data) {
  return true;
}
function canRoutePassageTime(_x) {
  return true;
}
function canRouteMarkovStability(_x) {
  return true;
}
function canRouteCasedropReliability(model) {
  if (chunkOLUSGFBH_cjs.isGroupTNA(model)) return false;
  if (!model.data) return false;
  return true;
}
function canRouteReliabilityAnalysis(_sequenceData, modelType) {
  return modelType === "tna" || modelType === "ftna";
}
function canRouteClusterData(_data) {
  return true;
}
function canRouteComputeDendrogram(_dist) {
  return true;
}
function canRouteFindRepresentatives(_data) {
  return true;
}
function canRouteMmm(_data) {
  return true;
}

// src/full/dispatch.ts
function bootstrapTna3(model, options = {}) {
  if (isWasmEnabled() && canRouteBootstrap(model, options)) {
    return chunkNXZY3JA5_cjs.bootstrapTna(model, options);
  }
  return chunkQ2XZ4DYY_cjs.bootstrapTna(model, options);
}
function centralities3(model, options = {}) {
  if (isWasmEnabled() && canRouteCentralities(model, options)) {
    return chunkNXZY3JA5_cjs.centralities(model, options);
  }
  return chunkPSLEWOXL_cjs.centralities(model, options);
}
function permutationTest3(x, y, options = {}) {
  if (isWasmEnabled() && canRoutePermutation(x, y)) {
    return chunkNXZY3JA5_cjs.permutationTest(x, y, options);
  }
  return chunkPSLEWOXL_cjs.permutationTest(x, y, options);
}
function estimateCS3(model, options = {}) {
  if (isWasmEnabled() && canRouteEstimateCS(model, options)) {
    return chunkNXZY3JA5_cjs.estimateCS(model, options);
  }
  return chunkPSLEWOXL_cjs.estimateCS(model, options);
}
function compareWeightMatrices3(a, b) {
  if (isWasmEnabled() && canRouteCompareWeightMatrices(a, b)) {
    return chunkNXZY3JA5_cjs.compareWeightMatrices(a, b);
  }
  return chunkO5U3BFYT_cjs.compareWeightMatrices(a, b);
}
function markovOrderTest3(data, options = {}) {
  if (isWasmEnabled() && canRouteMarkovOrderTest()) {
    return chunkNXZY3JA5_cjs.markovOrderTest(data, options);
  }
  return chunkPSLEWOXL_cjs.markovOrderTest(data, options);
}
function passageTime3(x, options = {}) {
  if (isWasmEnabled() && canRoutePassageTime()) {
    return chunkNXZY3JA5_cjs.passageTime(x, options);
  }
  return chunkPSLEWOXL_cjs.passageTime(x, options);
}
function markovStability3(x, options = {}) {
  if (isWasmEnabled() && canRouteMarkovStability()) {
    return chunkNXZY3JA5_cjs.markovStability(x, options);
  }
  return chunkPSLEWOXL_cjs.markovStability(x, options);
}
function casedropReliability3(model, options = {}) {
  if (isWasmEnabled() && canRouteCasedropReliability(model)) {
    return chunkNXZY3JA5_cjs.casedropReliability(model, options);
  }
  return chunkPSLEWOXL_cjs.casedropReliability(model, options);
}
function reliabilityAnalysis3(sequenceData, modelType, opts = {}) {
  if (isWasmEnabled() && canRouteReliabilityAnalysis(sequenceData, modelType)) {
    return chunkNXZY3JA5_cjs.reliabilityAnalysis(sequenceData, modelType, opts);
  }
  return chunkO5U3BFYT_cjs.reliabilityAnalysis(sequenceData, modelType, opts);
}
function clusterData3(data, k, options) {
  if (isWasmEnabled() && canRouteClusterData()) {
    return chunkNXZY3JA5_cjs.clusterData(data, k, options);
  }
  return chunkPSLEWOXL_cjs.clusterData(data, k, options);
}
function clusterSequences3(data, k, options) {
  if (isWasmEnabled() && canRouteClusterData()) {
    return chunkNXZY3JA5_cjs.clusterSequences(
      data,
      k,
      options
    );
  }
  return chunkPSLEWOXL_cjs.clusterSequences(data, k, options);
}
function computeDendrogram3(dist, method = "average") {
  if (isWasmEnabled() && canRouteComputeDendrogram()) {
    return chunkNXZY3JA5_cjs.computeDendrogram(dist, method);
  }
  return chunkPSLEWOXL_cjs.computeDendrogram(dist, method);
}
function findRepresentatives3(data, options) {
  if (isWasmEnabled() && canRouteFindRepresentatives()) {
    return chunkNXZY3JA5_cjs.findRepresentatives(data, options);
  }
  return chunkPSLEWOXL_cjs.findRepresentatives(data, options);
}
function mmm3(data, options) {
  if (isWasmEnabled() && canRouteMmm()) {
    return chunkNXZY3JA5_cjs.mmm(data, options);
  }
  return chunkT7KNIXMR_cjs.mmm(data, options);
}

exports.bootstrapTna = bootstrapTna3;
exports.casedropReliability = casedropReliability3;
exports.centralities = centralities3;
exports.clusterData = clusterData3;
exports.clusterSequences = clusterSequences3;
exports.compareWeightMatrices = compareWeightMatrices3;
exports.computeDendrogram = computeDendrogram3;
exports.estimateCS = estimateCS3;
exports.findRepresentatives = findRepresentatives3;
exports.initWasm = initWasm;
exports.isWasmEnabled = isWasmEnabled;
exports.markovOrderTest = markovOrderTest3;
exports.markovStability = markovStability3;
exports.mmm = mmm3;
exports.passageTime = passageTime3;
exports.permutationTest = permutationTest3;
exports.reliabilityAnalysis = reliabilityAnalysis3;
//# sourceMappingURL=chunk-ZGOWXN6R.cjs.map
//# sourceMappingURL=chunk-ZGOWXN6R.cjs.map