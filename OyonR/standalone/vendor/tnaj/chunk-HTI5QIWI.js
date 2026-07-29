import { isTnawReady, initTnaw } from './chunk-NRYFPQCB.js';
import { bootstrapTna, centralities, permutationTest, estimateCS, compareWeightMatrices, markovOrderTest, passageTime, markovStability, casedropReliability, reliabilityAnalysis, clusterData, clusterSequences, computeDendrogram, findRepresentatives, mmm } from './chunk-Y6HFV4RZ.js';
import { centralities as centralities$1, permutationTest as permutationTest$1, estimateCS as estimateCS$1, markovOrderTest as markovOrderTest$1, passageTime as passageTime$1, markovStability as markovStability$1, casedropReliability as casedropReliability$1, clusterData as clusterData$1, clusterSequences as clusterSequences$1, computeDendrogram as computeDendrogram$1, findRepresentatives as findRepresentatives$1 } from './chunk-F7YVWPXB.js';
import { mmm as mmm$1 } from './chunk-ZCVPZDHU.js';
import { bootstrapTna as bootstrapTna$1 } from './chunk-4WEWB4WN.js';
import { isGroupTNA } from './chunk-PKCMUOEM.js';
import { compareWeightMatrices as compareWeightMatrices$1, reliabilityAnalysis as reliabilityAnalysis$1 } from './chunk-DOMOOFBU.js';

// src/full/state.ts
var _initPromise = null;
async function initWasm() {
  if (isTnawReady()) return true;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      await initTnaw();
      return isTnawReady();
    } catch (err) {
      console.warn("[tnajw/full] WASM init failed; dispatchers will use TS fallback:", err);
      return false;
    }
  })();
  return _initPromise;
}
function isWasmEnabled() {
  return isTnawReady();
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
  if (isGroupTNA(model)) return false;
  if (!model.data) return false;
  const scaling = model.scaling ?? [];
  for (const s of scaling) {
    if (!BOOTSTRAP_SCALING_WASM.has(s)) return false;
  }
  return true;
}
function canRouteCentralities(model, options = {}) {
  if (isGroupTNA(model)) return false;
  const requested = options.measures ?? ["OutStrength", "InStrength", "Betweenness"];
  for (const m of requested) {
    if (!CENTRALITIES_WASM.has(m)) return false;
  }
  return true;
}
function canRoutePermutation(x, y) {
  if (isGroupTNA(x) || isGroupTNA(y)) return false;
  if (!x.data || !y.data) return false;
  if (x.labels.length !== y.labels.length) return false;
  return true;
}
function canRouteEstimateCS(model, options = {}) {
  if (isGroupTNA(model)) return false;
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
  if (isGroupTNA(model)) return false;
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
    return bootstrapTna(model, options);
  }
  return bootstrapTna$1(model, options);
}
function centralities3(model, options = {}) {
  if (isWasmEnabled() && canRouteCentralities(model, options)) {
    return centralities(model, options);
  }
  return centralities$1(model, options);
}
function permutationTest3(x, y, options = {}) {
  if (isWasmEnabled() && canRoutePermutation(x, y)) {
    return permutationTest(x, y, options);
  }
  return permutationTest$1(x, y, options);
}
function estimateCS3(model, options = {}) {
  if (isWasmEnabled() && canRouteEstimateCS(model, options)) {
    return estimateCS(model, options);
  }
  return estimateCS$1(model, options);
}
function compareWeightMatrices3(a, b) {
  if (isWasmEnabled() && canRouteCompareWeightMatrices(a, b)) {
    return compareWeightMatrices(a, b);
  }
  return compareWeightMatrices$1(a, b);
}
function markovOrderTest3(data, options = {}) {
  if (isWasmEnabled() && canRouteMarkovOrderTest()) {
    return markovOrderTest(data, options);
  }
  return markovOrderTest$1(data, options);
}
function passageTime3(x, options = {}) {
  if (isWasmEnabled() && canRoutePassageTime()) {
    return passageTime(x, options);
  }
  return passageTime$1(x, options);
}
function markovStability3(x, options = {}) {
  if (isWasmEnabled() && canRouteMarkovStability()) {
    return markovStability(x, options);
  }
  return markovStability$1(x, options);
}
function casedropReliability3(model, options = {}) {
  if (isWasmEnabled() && canRouteCasedropReliability(model)) {
    return casedropReliability(model, options);
  }
  return casedropReliability$1(model, options);
}
function reliabilityAnalysis3(sequenceData, modelType, opts = {}) {
  if (isWasmEnabled() && canRouteReliabilityAnalysis(sequenceData, modelType)) {
    return reliabilityAnalysis(sequenceData, modelType, opts);
  }
  return reliabilityAnalysis$1(sequenceData, modelType, opts);
}
function clusterData3(data, k, options) {
  if (isWasmEnabled() && canRouteClusterData()) {
    return clusterData(data, k, options);
  }
  return clusterData$1(data, k, options);
}
function clusterSequences3(data, k, options) {
  if (isWasmEnabled() && canRouteClusterData()) {
    return clusterSequences(
      data,
      k,
      options
    );
  }
  return clusterSequences$1(data, k, options);
}
function computeDendrogram3(dist, method = "average") {
  if (isWasmEnabled() && canRouteComputeDendrogram()) {
    return computeDendrogram(dist, method);
  }
  return computeDendrogram$1(dist, method);
}
function findRepresentatives3(data, options) {
  if (isWasmEnabled() && canRouteFindRepresentatives()) {
    return findRepresentatives(data, options);
  }
  return findRepresentatives$1(data, options);
}
function mmm3(data, options) {
  if (isWasmEnabled() && canRouteMmm()) {
    return mmm(data, options);
  }
  return mmm$1(data, options);
}

export { bootstrapTna3 as bootstrapTna, casedropReliability3 as casedropReliability, centralities3 as centralities, clusterData3 as clusterData, clusterSequences3 as clusterSequences, compareWeightMatrices3 as compareWeightMatrices, computeDendrogram3 as computeDendrogram, estimateCS3 as estimateCS, findRepresentatives3 as findRepresentatives, initWasm, isWasmEnabled, markovOrderTest3 as markovOrderTest, markovStability3 as markovStability, mmm3 as mmm, passageTime3 as passageTime, permutationTest3 as permutationTest, reliabilityAnalysis3 as reliabilityAnalysis };
//# sourceMappingURL=chunk-HTI5QIWI.js.map
//# sourceMappingURL=chunk-HTI5QIWI.js.map