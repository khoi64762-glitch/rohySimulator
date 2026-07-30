'use strict';

var chunkT7KNIXMR_cjs = require('./chunk-T7KNIXMR.cjs');
var chunkRT5XI5AH_cjs = require('./chunk-RT5XI5AH.cjs');

// src/wasm-engine/load-shared.ts
var _exports = null;
function setExports(e) {
  _exports = e;
}
function isInitialized() {
  return _exports !== null;
}
function getExports() {
  if (_exports === null) {
    throw new Error("initWasmEngine has not been called (or threw)");
  }
  return _exports;
}

// src/wasm-engine/shim.ts
function bootstrapTnaWasm(input) {
  const exports$1 = getExports();
  const a = input.nStates;
  const aa = a * a;
  const expectedRowStartsLen = input.rowStarts.length - 1 >= 0 ? input.rowStarts.length : 1;
  if (expectedRowStartsLen < 2) {
    throw new Error("rowStarts must have at least 2 entries (one sequence)");
  }
  const typeCode = input.type === "relative" ? 0 : 1;
  const methodCode = input.method === "stability" ? 0 : 1;
  const scalingCsv = input.scaling.join(",");
  const thresholdEncoded = input.threshold === null ? -1 : input.threshold;
  const flat = exports$1.bootstrap_tna_wasm(
    input.values,
    input.rowStarts,
    a,
    typeCode,
    scalingCsv,
    input.iter,
    input.seed,
    methodCode,
    input.level,
    input.consistencyLo,
    input.consistencyHi,
    thresholdEncoded
  );
  return {
    originalWeights: flat.slice(0 * aa, 1 * aa),
    weightsMean: flat.slice(1 * aa, 2 * aa),
    weightsSd: flat.slice(2 * aa, 3 * aa),
    weightsBias: flat.slice(3 * aa, 4 * aa),
    pValues: flat.slice(4 * aa, 5 * aa),
    ciLower: flat.slice(5 * aa, 6 * aa),
    ciUpper: flat.slice(6 * aa, 7 * aa),
    inits: flat.slice(7 * aa, 7 * aa + a),
    thresholdUsed: flat[7 * aa + a]
  };
}
var RELIABILITY_METRIC_KEYS = [
  "mad",
  "median_ad",
  "rmsd",
  "max_ad",
  "rel_mad",
  "cv_ratio",
  "pearson",
  "spearman",
  "kendall",
  "dcor",
  "euclidean",
  "manhattan",
  "canberra",
  "braycurtis",
  "frobenius",
  "cosine",
  "jaccard",
  "dice",
  "overlap",
  "rv",
  "rank_agree",
  "sign_agree"
];
function estimateCsWasm(input) {
  const exports$1 = getExports();
  const nM = input.measures.length;
  const nDp = input.dropProps.length;
  const dropPropsF = new Float64Array(input.dropProps);
  const flat = exports$1.estimate_cs_wasm(
    input.values,
    input.rowStarts,
    input.nStates,
    input.type === "relative" ? 0 : 1,
    input.scaling.join(","),
    input.measures.join(","),
    input.iter,
    dropPropsF,
    input.threshold,
    input.certainty,
    input.seed,
    input.corrMethod,
    input.loops ? 1 : 0
  );
  const iter = input.iter;
  const csCoefficients = Array.from(flat.slice(0, nM));
  const meanCorrelations = [];
  for (let m = 0; m < nM; m++) {
    const start = nM + m * nDp;
    meanCorrelations.push(Array.from(flat.slice(start, start + nDp)));
  }
  const corrBase = nM + nM * nDp;
  const correlations = [];
  for (let m = 0; m < nM; m++) {
    const measureBase = corrBase + m * iter * nDp;
    const matrix = [];
    for (let it = 0; it < iter; it++) {
      const rowStart = measureBase + it * nDp;
      matrix.push(Array.from(flat.slice(rowStart, rowStart + nDp)));
    }
    correlations.push(matrix);
  }
  const sumMeanOff = corrBase + nM * iter * nDp;
  const sumSdOff = sumMeanOff + nM * nDp;
  const sumPaOff = sumSdOff + nM * nDp;
  const summary = [];
  for (let m = 0; m < nM; m++) {
    for (let j = 0; j < nDp; j++) {
      summary.push({
        measure: input.measures[m],
        dropProp: input.dropProps[j],
        meanCor: flat[sumMeanOff + m * nDp + j],
        sdCor: flat[sumSdOff + m * nDp + j],
        propAbove: flat[sumPaOff + m * nDp + j]
      });
    }
  }
  return { csCoefficients, meanCorrelations, correlations, summary };
}
function markovOrderTestWasm(input) {
  const exports$1 = getExports();
  const k1 = input.maxOrder + 1;
  const flat = exports$1.markov_order_test_wasm(
    input.values,
    input.rowStarts,
    input.maxOrder,
    input.nPerm,
    input.alpha,
    input.seed
  );
  const testTable = [];
  for (let k = 0; k < k1; k++) {
    testTable.push({
      order: k,
      loglik: flat[0 * k1 + k],
      aic: flat[1 * k1 + k],
      bic: flat[2 * k1 + k],
      df: flat[3 * k1 + k],
      g2: flat[4 * k1 + k],
      pPermutation: flat[5 * k1 + k],
      pAsymptotic: flat[6 * k1 + k],
      significant: false
      // populated below once we know the trailing offset
    });
  }
  const permBase = 7 * k1 + 3;
  const permutationNull = [];
  for (let order = 1; order <= input.maxOrder; order++) {
    const rowStart = permBase + (order - 1) * input.nPerm;
    const row = [];
    for (let p = 0; p < input.nPerm; p++) {
      const v = flat[rowStart + p];
      if (!Number.isNaN(v)) row.push(v);
    }
    permutationNull.push(row);
  }
  let cursor = permBase + input.maxOrder * input.nPerm;
  const nodesPerOrder = [];
  for (let k = 0; k < k1; k++) {
    nodesPerOrder.push(flat[cursor + k]);
  }
  cursor += k1;
  const transitionMatrices = [];
  for (let k = 0; k < k1; k++) {
    const nk = nodesPerOrder[k];
    const size = k === 0 ? nk : nk * nk;
    const buf = new Float64Array(size);
    for (let i = 0; i < size; i++) buf[i] = flat[cursor + i];
    transitionMatrices.push(buf);
    cursor += size;
  }
  const transitionNodes = [];
  for (let k = 0; k < k1; k++) {
    const nk = nodesPerOrder[k];
    const tupleLen = k === 0 ? 1 : k;
    const nodes = [];
    for (let i = 0; i < nk; i++) {
      const tup = [];
      for (let j = 0; j < tupleLen; j++) {
        tup.push(flat[cursor + i * tupleLen + j]);
      }
      nodes.push(tup);
    }
    transitionNodes.push(nodes);
    cursor += nk * tupleLen;
  }
  const nSequences = flat[cursor];
  const nObservations = flat[cursor + 1];
  cursor += 2;
  const nTuples = [];
  for (let k = 0; k < input.maxOrder; k++) {
    nTuples.push(flat[cursor + k]);
  }
  cursor += input.maxOrder;
  for (let k = 0; k < k1; k++) {
    testTable[k].significant = flat[cursor + k] === 1;
  }
  return {
    testTable,
    permutationNull,
    transitionMatrices,
    transitionNodes,
    nSequences,
    nObservations,
    nTuples,
    optimalOrder: flat[7 * k1],
    bicOrder: flat[7 * k1 + 1],
    aicOrder: flat[7 * k1 + 2]
  };
}
function compareWeightMatricesWasm(input) {
  const exports$1 = getExports();
  if (input.matA.length !== input.nStates * input.nStates) {
    throw new Error(`matA length ${input.matA.length} != n*n = ${input.nStates * input.nStates}`);
  }
  if (input.matB.length !== input.nStates * input.nStates) {
    throw new Error(`matB length ${input.matB.length} != n*n = ${input.nStates * input.nStates}`);
  }
  const flat = exports$1.compare_weight_matrices_wasm(input.matA, input.matB, input.nStates);
  const out = {};
  for (let i = 0; i < RELIABILITY_METRIC_KEYS.length; i++) {
    out[RELIABILITY_METRIC_KEYS[i]] = flat[i];
  }
  return out;
}
function permutationTestWasm(input) {
  const exports$1 = getExports();
  const a = input.nStates;
  const aa = a * a;
  const typeCode = input.type === "relative" ? 0 : 1;
  const scalingCsv = input.scaling.join(",");
  const flat = exports$1.permutation_test_wasm(
    input.valuesX,
    input.rowStartsX,
    input.valuesY,
    input.rowStartsY,
    a,
    typeCode,
    scalingCsv,
    input.iter,
    input.seed,
    input.adjust,
    input.level,
    input.paired ? 1 : 0
  );
  return {
    originalWeightsX: flat.slice(0 * aa, 1 * aa),
    originalWeightsY: flat.slice(1 * aa, 2 * aa),
    diffTrue: flat.slice(2 * aa, 3 * aa),
    diffSig: flat.slice(3 * aa, 4 * aa),
    pValues: flat.slice(4 * aa, 5 * aa),
    effectSizes: flat.slice(5 * aa, 6 * aa)
  };
}
function centralitiesWasm(input) {
  const exports$1 = getExports();
  if (input.weights.length !== input.nStates * input.nStates) {
    throw new Error(`weights length ${input.weights.length} != n*n = ${input.nStates * input.nStates}`);
  }
  const flat = exports$1.centralities_wasm(
    input.weights,
    input.nStates,
    input.measures.join(","),
    input.loops ? 1 : 0,
    input.normalize ? 1 : 0
  );
  const out = {};
  for (let m = 0; m < input.measures.length; m++) {
    out[input.measures[m]] = Array.from(flat.slice(m * input.nStates, (m + 1) * input.nStates));
  }
  return out;
}
function passageTimeWasm(input) {
  const exports$1 = getExports();
  const n = input.nStates;
  if (input.p.length !== n * n) {
    throw new Error(`p length ${input.p.length} != n*n = ${n * n}`);
  }
  const flat = exports$1.passage_time_wasm(input.p, n, input.normalize === false ? 0 : 1);
  return {
    mfpt: flat.slice(0, n * n),
    stationary: flat.slice(n * n, n * n + n),
    persistence: flat.slice(n * n + n, n * n + 2 * n)
  };
}
function markovStabilityWasm(input) {
  const exports$1 = getExports();
  const n = input.nStates;
  if (input.p.length !== n * n) {
    throw new Error(`p length ${input.p.length} != n*n = ${n * n}`);
  }
  const flat = exports$1.markov_stability_wasm(input.p, n, input.normalize === false ? 0 : 1);
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      persistence: flat[0 * n + i],
      stationaryProb: flat[1 * n + i],
      returnTime: flat[2 * n + i],
      sojournTime: flat[3 * n + i],
      avgTimeToOthers: flat[4 * n + i],
      avgTimeFromOthers: flat[5 * n + i]
    });
  }
  const tailOff = 6 * n;
  return {
    rows,
    mfpt: flat.slice(tailOff, tailOff + n * n),
    stationary: flat.slice(tailOff + n * n, tailOff + n * n + n),
    persistence: flat.slice(tailOff + n * n + n, tailOff + n * n + 2 * n)
  };
}
var METRIC_NAMES = [
  "mean_abs_dev",
  "median_abs_dev",
  "correlation",
  "max_abs_dev"
];
function casedropReliabilityWasm(input) {
  const exports$1 = getExports();
  const nProp = input.dropProps.length;
  const iter = input.iter;
  const a = nProp * iter;
  const flat = exports$1.casedrop_reliability_wasm(
    input.values,
    input.rowStarts,
    input.nStates,
    input.type === "relative" ? 0 : 1,
    input.scaling.join(","),
    iter,
    new Float64Array(input.dropProps),
    input.threshold,
    input.certainty,
    input.method,
    input.includeDiag ? 1 : 0,
    input.seed
  );
  const sliceMat = (off2) => {
    const out = [];
    for (let p = 0; p < nProp; p++) {
      const row = [];
      for (let it = 0; it < iter; it++) row.push(flat[off2 + p * iter + it]);
      out.push(row);
    }
    return out;
  };
  const meanAbsDev = sliceMat(0);
  const medianAbsDev = sliceMat(a);
  const correlation = sliceMat(2 * a);
  const maxAbsDev = sliceMat(3 * a);
  const summary = [];
  let off = 4 * a;
  for (const m of METRIC_NAMES) {
    for (let p = 0; p < nProp; p++) {
      summary.push({
        metric: m,
        dropProp: input.dropProps[p],
        mean: flat[off++],
        sd: flat[off++],
        median: flat[off++],
        mad: flat[off++],
        q025: flat[off++],
        q975: flat[off++]
      });
    }
  }
  const cs = flat[off++];
  const nEdges = flat[off++];
  const nCases = flat[off];
  return { cs, meanAbsDev, medianAbsDev, correlation, maxAbsDev, summary, nEdges, nCases };
}
function reliabilityAnalysisWasm(input) {
  const exports$1 = getExports();
  const flat = exports$1.reliability_analysis_wasm(
    input.values,
    input.rowStarts,
    input.nStates,
    input.type === "relative" ? 0 : 1,
    input.scaling.join(","),
    input.iter,
    input.split,
    input.seed
  );
  const nM = 22;
  const iter = input.iter;
  const iterations = [];
  for (let it = 0; it < iter; it++) {
    const row = [];
    for (let m = 0; m < nM; m++) row.push(flat[it * nM + m]);
    iterations.push(row);
  }
  const summary = [];
  let off = iter * nM;
  for (let m = 0; m < nM; m++) {
    summary.push({
      metricIdx: m,
      mean: flat[off++],
      sd: flat[off++],
      median: flat[off++],
      min: flat[off++],
      max: flat[off++],
      q25: flat[off++],
      q75: flat[off++],
      nValid: flat[off++]
    });
  }
  const nSequences = flat[off];
  return { iterations, summary, nSequences };
}
var CLUSTER_METHOD_CODES = {
  pam: 0,
  average: 1,
  complete: 2,
  single: 3,
  "ward.D": 4,
  "ward.D2": 5,
  mcquitty: 6,
  median: 7,
  centroid: 8
};
var CLUSTER_DISSIMILARITY_CODES = {
  hamming: 0,
  lv: 1,
  osa: 2,
  dl: 3,
  lcs: 4,
  qgram: 5,
  cosine: 6,
  jaccard: 7,
  jw: 8
};
var CLUSTER_NUMERIC_METRIC_CODES = {
  euclidean: 0,
  manhattan: 1
};
function decodeCluster(flat) {
  const n = flat[0];
  const k = flat[1];
  const silhouette = flat[2];
  const hasHier = flat[3] === 1;
  let off = 4;
  const assignments = [];
  for (let i = 0; i < n; i++) assignments.push(flat[off++]);
  const sizes = [];
  for (let i = 0; i < k; i++) sizes.push(flat[off++]);
  const distance = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) distance[i] = flat[off++];
  const result = { n, k, silhouette, assignments, sizes, distance };
  if (hasHier) {
    const nm1 = Math.max(0, n - 1);
    const merge = [];
    for (let s = 0; s < nm1; s++) {
      merge.push([flat[off], flat[off + 1]]);
      off += 2;
    }
    const heights = [];
    for (let s = 0; s < nm1; s++) heights.push(flat[off++]);
    const order = [];
    for (let i = 0; i < n; i++) order.push(flat[off++]);
    result.merge = merge;
    result.heights = heights;
    result.order = order;
  }
  return result;
}
function clusterMethodCode(method) {
  const c = CLUSTER_METHOD_CODES[method];
  if (c === void 0) throw new Error(`clusterWasm: unknown method "${method}"`);
  return c;
}
function clusterStringWasm(input) {
  const exports$1 = getExports();
  const dCode = CLUSTER_DISSIMILARITY_CODES[input.dissimilarity];
  if (dCode === void 0) {
    throw new Error(`clusterStringWasm: unknown dissimilarity "${input.dissimilarity}"`);
  }
  const flat = exports$1.cluster_string_wasm(
    input.values,
    input.rowStarts,
    input.k,
    clusterMethodCode(input.method),
    dCode,
    input.weighted ? 1 : 0,
    input.lambda
  );
  return decodeCluster(flat);
}
function clusterFromDistWasm(input) {
  const exports$1 = getExports();
  const flat = exports$1.cluster_from_dist_wasm(
    input.dist,
    input.n,
    input.k,
    clusterMethodCode(input.method)
  );
  return decodeCluster(flat);
}
function clusterNumericWasm(input) {
  const exports$1 = getExports();
  const mCode = CLUSTER_NUMERIC_METRIC_CODES[input.metric];
  if (mCode === void 0) {
    throw new Error(`clusterNumericWasm: unknown metric "${input.metric}"`);
  }
  const flat = exports$1.cluster_numeric_wasm(
    input.data,
    input.n,
    input.p,
    input.k,
    clusterMethodCode(input.method),
    mCode
  );
  return decodeCluster(flat);
}
function mmmWasm(input) {
  const exports$1 = getExports();
  const {
    values,
    rowStarts,
    nStates,
    k,
    maxIter = 200,
    tol = 1e-8,
    alpha = 0.01,
    seed = 42,
    nStarts = 1,
    initPosterior
  } = input;
  const flat = exports$1.mmm_wasm(
    values,
    rowStarts,
    nStates,
    k,
    maxIter,
    tol,
    alpha,
    seed,
    nStarts,
    initPosterior ?? new Float64Array(0)
  );
  const n = flat[0];
  const kk = flat[1];
  const s = flat[2];
  const iterations = flat[3];
  const converged = flat[4] !== 0;
  const logLik = flat[5];
  const aic = flat[6];
  const bic = flat[7];
  const icl = flat[8];
  const aveppOverall = flat[9];
  const entropy = flat[10];
  const relativeEntropy = flat[11];
  const classificationError = flat[12];
  const classEntropy = flat[13];
  let off = 14;
  const assignments = [];
  for (let i = 0; i < n; i++) assignments.push(flat[off++]);
  const responsibilities = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let m = 0; m < kk; m++) row.push(flat[off++]);
    responsibilities.push(row);
  }
  const pi = new Float64Array(kk);
  for (let m = 0; m < kk; m++) pi[m] = flat[off++];
  const avepp = new Float64Array(kk);
  for (let m = 0; m < kk; m++) avepp[m] = flat[off++];
  const delta = [];
  for (let m = 0; m < kk; m++) {
    const d = new Float64Array(s);
    for (let st = 0; st < s; st++) d[st] = flat[off++];
    delta.push(d);
  }
  const transition = [];
  for (let m = 0; m < kk; m++) {
    const a = new Float64Array(s * s);
    for (let j = 0; j < s * s; j++) a[j] = flat[off++];
    transition.push(a);
  }
  const nStartsOut = flat[off++];
  const restartLogLiks = new Float64Array(nStartsOut);
  for (let r = 0; r < nStartsOut; r++) restartLogLiks[r] = flat[off++];
  return {
    n,
    k: kk,
    s,
    iterations,
    converged,
    logLik,
    aic,
    bic,
    icl,
    quality: {
      avepp,
      aveppOverall,
      entropy,
      relativeEntropy,
      classificationError,
      classEntropy
    },
    nStarts: nStartsOut,
    restartLogLiks,
    assignments,
    responsibilities,
    pi,
    delta,
    transition
  };
}

// src/wasm-engine/integerize.ts
var NA_SENTINEL = -1;
var UNKNOWN_SENTINEL = -2;
var TNAJ_NA_MARKER = "\0__NA__";
function integerize(sequences, labels, opts = {}) {
  const { naSyms = [], onUnknown = "error", emptyIsNa = true } = opts;
  const labelToIdx = /* @__PURE__ */ new Map();
  for (let i = 0; i < labels.length; i++) {
    const lbl = labels[i];
    if (labelToIdx.has(lbl)) {
      throw new Error(`integerize: duplicate label in labels[]: ${JSON.stringify(lbl)}`);
    }
    labelToIdx.set(lbl, i);
  }
  const naSet = /* @__PURE__ */ new Set([TNAJ_NA_MARKER, ...naSyms]);
  const n = sequences.length;
  const rowStarts = new Uint32Array(n + 1);
  let total = 0;
  for (let i = 0; i < n; i++) {
    rowStarts[i] = total;
    total += sequences[i].length;
  }
  rowStarts[n] = total;
  const values = new Int32Array(total);
  for (let i = 0; i < n; i++) {
    const row = sequences[i];
    const base = rowStarts[i];
    for (let j = 0; j < row.length; j++) {
      const cell = row[j];
      if (cell === null || cell === void 0) {
        if (emptyIsNa) {
          values[base + j] = NA_SENTINEL;
          continue;
        }
      }
      const s = typeof cell === "string" ? cell : String(cell);
      if (emptyIsNa && s === "") {
        values[base + j] = NA_SENTINEL;
        continue;
      }
      if (naSet.has(s)) {
        values[base + j] = NA_SENTINEL;
        continue;
      }
      const idx = labelToIdx.get(s);
      if (idx !== void 0) {
        values[base + j] = idx;
        continue;
      }
      if (onUnknown === "sentinel") {
        values[base + j] = UNKNOWN_SENTINEL;
        continue;
      }
      throw new Error(
        `integerize: sequence[${i}][${j}] = ${JSON.stringify(s)} is not in labels and not configured as NA. Pass it via naSyms or use onUnknown: "sentinel" to map to the \u22122 reserved index.`
      );
    }
  }
  return {
    values,
    rowStarts,
    labels,
    nSequences: n,
    totalLength: total
  };
}

// src/wasm/assert.ts
function assertReady() {
  if (!isInitialized()) {
    throw new Error(
      "tnaw: WASM engine not initialized. Call `await initTnaw()` before any tnaw function."
    );
  }
}

// src/wasm/model.ts
function integerizeModel(model) {
  if (!model.data) {
    throw new Error(
      "tnaw: TNA model has no `data` attached. Call `model.data = sequences` before bootstrap/permutation/stability."
    );
  }
  const seqs = model.data;
  const ig = integerize(seqs, model.labels);
  return {
    values: ig.values,
    rowStarts: ig.rowStarts,
    labels: ig.labels,
    nStates: ig.labels.length
  };
}
function flattenWeights(model) {
  const n = model.labels.length;
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out[i * n + j] = model.weights.get(i, j);
    }
  }
  return out;
}

// src/wasm/bootstrap.ts
function bootstrapTna(model, options = {}) {
  assertReady();
  const {
    iter = 1e3,
    level = 0.05,
    method = "stability",
    // The pure-TS interface accepts `consistencyRange: [lo, hi]`. Keep parity.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    consistencyRange = [0.75, 1.25],
    threshold,
    seed = 42
  } = options;
  const ig = integerizeModel(model);
  const r = bootstrapTnaWasm({
    values: ig.values,
    rowStarts: ig.rowStarts,
    nStates: ig.nStates,
    type: model.type === "frequency" ? "frequency" : "relative",
    scaling: model.scaling ?? [],
    iter,
    seed,
    method,
    level,
    consistencyLo: consistencyRange[0],
    consistencyHi: consistencyRange[1],
    threshold: threshold ?? null
  });
  const n = ig.nStates;
  const edges = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = i * n + j;
      const w = r.originalWeights[idx];
      if (w <= 0) continue;
      edges.push({
        from: ig.labels[i],
        to: ig.labels[j],
        weight: w,
        bootstrapMean: r.weightsMean[idx],
        bias: r.weightsBias[idx],
        pValue: r.pValues[idx],
        significant: r.pValues[idx] < level,
        crLower: w * consistencyRange[0],
        crUpper: w * consistencyRange[1],
        ciLower: r.ciLower[idx],
        ciUpper: r.ciUpper[idx]
      });
    }
  }
  return {
    edges,
    model,
    labels: [...model.labels],
    method,
    iter,
    level,
    weightsMean: r.weightsMean,
    weightsSd: r.weightsSd,
    weightsBias: r.weightsBias
  };
}

// src/wasm/centralities.ts
var WASM_MEASURES = /* @__PURE__ */ new Set([
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
function centralities(model, options = {}) {
  assertReady();
  if (model.__group) {
    throw new Error("tnaw.centralities: GroupTNA not supported. Use tnaj.centralities for grouped models.");
  }
  const { loops = false, normalize = false } = options;
  const requested = options.measures ?? ["OutStrength", "InStrength", "Betweenness"];
  const unsupported = requested.filter((m) => !WASM_MEASURES.has(m));
  if (unsupported.length > 0) {
    throw new Error(
      `tnaw.centralities: measure(s) [${unsupported.join(", ")}] not in WASM kernel. Supported: [${[...WASM_MEASURES].join(", ")}]. Use tnaj.centralities for unsupported measures.`
    );
  }
  const W = flattenWeights(model);
  const r = centralitiesWasm({
    weights: W,
    nStates: model.labels.length,
    measures: requested,
    loops,
    normalize
  });
  const measuresOut = {};
  for (const k of requested) measuresOut[k] = new Float64Array(r[k]);
  return {
    labels: [...model.labels],
    measures: measuresOut
  };
}

// src/wasm/permutation.ts
function permutationTest(x, y, options = {}) {
  assertReady();
  if (!x.data || !y.data) {
    throw new Error("Both TNA models must have sequence data for permutation test");
  }
  const { iter = 1e3, adjust = "none", level = 0.05, seed = 42, paired = false } = options;
  const igX = integerizeModel(x);
  const igY = integerizeModel(y);
  if (igX.nStates !== igY.nStates) {
    throw new Error(`permutationTest: state-set mismatch (${igX.nStates} vs ${igY.nStates})`);
  }
  const r = permutationTestWasm({
    valuesX: igX.values,
    rowStartsX: igX.rowStarts,
    valuesY: igY.values,
    rowStartsY: igY.rowStarts,
    nStates: igX.nStates,
    type: x.type === "frequency" ? "frequency" : "relative",
    scaling: x.scaling ?? [],
    iter,
    seed,
    adjust,
    level,
    paired
  });
  const n = igX.nStates;
  const edgeStats = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = i * n + j;
      const wx = r.originalWeightsX[idx];
      const wy = r.originalWeightsY[idx];
      if (wx === 0 && wy === 0) continue;
      edgeStats.push({
        from: igX.labels[i],
        to: igX.labels[j],
        diffTrue: r.diffTrue[idx],
        effectSize: r.effectSizes[idx],
        pValue: r.pValues[idx]
      });
    }
  }
  return {
    edgeStats,
    diffTrue: r.diffTrue,
    diffSig: r.diffSig,
    pValues: r.pValues,
    labels: [...igX.labels],
    nStates: n,
    level
  };
}

// src/wasm/stability.ts
var WASM_OK = /* @__PURE__ */ new Set(["OutStrength", "InStrength", "Betweenness"]);
function estimateCS(model, options = {}) {
  assertReady();
  const {
    measures = ["InStrength", "OutStrength", "Betweenness"],
    iter = 500,
    dropProps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    threshold = 0.7,
    certainty = 0.95,
    method = "pearson",
    seed = 42,
    loops = false
  } = options;
  const unsupported = measures.filter((m) => !WASM_OK.has(m));
  if (unsupported.length > 0) {
    throw new Error(
      `tnaw.estimateCS: measure(s) [${unsupported.join(", ")}] not in WASM kernel. Supported: [OutStrength, InStrength, Betweenness]. Use tnaj.estimateCS for unsupported measures.`
    );
  }
  const ig = integerizeModel(model);
  const r = estimateCsWasm({
    values: ig.values,
    rowStarts: ig.rowStarts,
    nStates: ig.nStates,
    type: model.type === "frequency" ? "frequency" : "relative",
    scaling: model.scaling ?? [],
    measures,
    iter,
    dropProps,
    threshold,
    certainty,
    seed,
    corrMethod: method,
    loops
  });
  const csCoefficients = {};
  const meanCorrelations = {};
  const correlations = {};
  const summary = [];
  for (let m = 0; m < measures.length; m++) {
    const key = measures[m];
    csCoefficients[key] = r.csCoefficients[m];
    meanCorrelations[key] = r.meanCorrelations[m];
    correlations[key] = r.correlations[m];
  }
  for (const row of r.summary) {
    summary.push({
      measure: measures[row.measure]?.toString() ?? row.measure,
      dropProp: row.dropProp,
      meanCor: row.meanCor,
      sdCor: row.sdCor,
      propAbove: row.propAbove
    });
  }
  return {
    csCoefficients,
    meanCorrelations,
    dropProps: [...dropProps],
    threshold,
    certainty,
    correlations,
    summary,
    method
  };
}

// src/wasm/reliability.ts
function compareWeightMatrices(a, b) {
  assertReady();
  if (a.labels.length !== b.labels.length || a.labels.length === 0) {
    const out = {};
    for (const k of RELIABILITY_METRIC_KEYS) out[k] = NaN;
    return out;
  }
  const matA = flattenWeights(a);
  const matB = flattenWeights(b);
  return compareWeightMatricesWasm({ matA, matB, nStates: a.labels.length });
}

// src/wasm/markov.ts
function extractMatrixFromInput(x) {
  if (x instanceof chunkRT5XI5AH_cjs.Matrix) {
    const n2 = x.rows;
    const mat2 = new Float64Array(n2 * n2);
    for (let i = 0; i < n2; i++) for (let j = 0; j < n2; j++) mat2[i * n2 + j] = x.get(i, j);
    return { mat: mat2, labels: Array.from({ length: n2 }, (_, i) => `S${i}`), n: n2 };
  }
  if (Array.isArray(x)) {
    const n2 = x.length;
    const mat2 = new Float64Array(n2 * n2);
    for (let i = 0; i < n2; i++) for (let j = 0; j < n2; j++) mat2[i * n2 + j] = x[i][j];
    return { mat: mat2, labels: Array.from({ length: n2 }, (_, i) => `S${i}`), n: n2 };
  }
  const t = x;
  const n = t.labels.length;
  const mat = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) mat[i * n + j] = t.weights.get(i, j);
  return { mat, labels: [...t.labels], n };
}
function passageTime(x, options = {}) {
  assertReady();
  const { normalize = true } = options;
  const { mat, labels, n } = extractMatrixFromInput(x);
  const r = passageTimeWasm({ p: mat, nStates: n, normalize });
  const M = chunkRT5XI5AH_cjs.Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M.set(i, j, r.mfpt[i * n + j]);
  if (options.states) {
    const idx = options.states.map((s) => {
      const k = labels.indexOf(s);
      if (k < 0) throw new Error(`passageTime: state ${s} not in labels`);
      return k;
    });
    const sub = chunkRT5XI5AH_cjs.Matrix.zeros(idx.length, idx.length);
    const stationary = new Float64Array(idx.length);
    const persistence = new Float64Array(idx.length);
    for (let a = 0; a < idx.length; a++) {
      stationary[a] = r.stationary[idx[a]];
      persistence[a] = r.persistence[idx[a]];
      for (let b = 0; b < idx.length; b++) sub.set(a, b, M.get(idx[a], idx[b]));
    }
    return { matrix: sub, stationary, persistence, states: options.states };
  }
  return { matrix: M, stationary: r.stationary, persistence: r.persistence, states: labels };
}
function markovStability(x, options = {}) {
  assertReady();
  const { normalize = true } = options;
  const { mat, labels, n } = extractMatrixFromInput(x);
  const r = markovStabilityWasm({ p: mat, nStates: n, normalize });
  const M = chunkRT5XI5AH_cjs.Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M.set(i, j, r.mfpt[i * n + j]);
  const stability = r.rows.map((row, i) => ({
    state: labels[i],
    persistence: row.persistence,
    stationaryProb: row.stationaryProb,
    returnTime: row.returnTime,
    sojournTime: row.sojournTime,
    avgTimeToOthers: row.avgTimeToOthers,
    avgTimeFromOthers: row.avgTimeFromOthers
  }));
  return { stability, mpt: { matrix: M, stationary: r.stationary, persistence: r.persistence, states: labels } };
}
function markovOrderTest(data, options = {}) {
  assertReady();
  const { maxOrder = 3, nPerm = 500, alpha = 0.05, seed = 42 } = options;
  let values;
  let rowStarts;
  let labels;
  if (Array.isArray(data)) {
    const seqs = data;
    const labelSet = /* @__PURE__ */ new Set();
    for (const seq of seqs) for (const v of seq) if (v != null) labelSet.add(v);
    labels = [...labelSet].sort();
    const ig = integerize(seqs, labels);
    values = ig.values;
    rowStarts = ig.rowStarts;
  } else {
    const tna = data;
    if (!tna.data) throw new Error("markovOrderTest: TNA model missing data");
    const seqs = tna.data;
    labels = tna.labels;
    const ig = integerize(seqs, labels);
    values = ig.values;
    rowStarts = ig.rowStarts;
  }
  const r = markovOrderTestWasm({ values, rowStarts, maxOrder, nPerm, alpha, seed });
  const testTable = r.testTable.map((t) => ({
    order: t.order,
    loglik: t.loglik,
    AIC: t.aic,
    BIC: t.bic,
    df: t.df,
    g2: t.g2,
    pPermutation: t.pPermutation,
    pAsymptotic: t.pAsymptotic,
    significant: t.significant
  }));
  const HON_SEP = "";
  const transitionMatrices = r.transitionMatrices.map((buf, k) => {
    const nk = r.transitionNodes[k].length;
    if (k === 0) {
      const m2 = chunkRT5XI5AH_cjs.Matrix.zeros(1, nk);
      for (let j = 0; j < nk; j++) m2.set(0, j, buf[j]);
      return m2;
    }
    const m = chunkRT5XI5AH_cjs.Matrix.zeros(nk, nk);
    for (let i = 0; i < nk; i++) {
      for (let j = 0; j < nk; j++) {
        m.set(i, j, buf[i * nk + j]);
      }
    }
    return m;
  });
  const transitionNodes = r.transitionNodes.map(
    (nodesAtOrder, k) => nodesAtOrder.map((tup) => {
      const parts = tup.map((idx) => {
        const s = labels[idx];
        if (s === void 0) {
          throw new Error(
            `markovOrderTest: kernel emitted unknown state index ${idx} at order ${k}`
          );
        }
        return s;
      });
      return k === 0 ? parts[0] : parts.join(HON_SEP);
    })
  );
  const states = transitionNodes[0].slice();
  const marginal = new Float64Array(r.transitionMatrices[0]);
  const result = {
    optimalOrder: r.optimalOrder,
    bicOrder: r.bicOrder,
    aicOrder: r.aicOrder,
    testTable,
    permutationNull: r.permutationNull,
    logliks: testTable.map((t) => t.loglik),
    layerDofs: testTable.map((t) => t.df),
    transitionMatrices,
    transitionNodes,
    states,
    marginal,
    nSequences: r.nSequences,
    nObservations: r.nObservations,
    nTuples: r.nTuples,
    nPerm,
    alpha,
    maxOrder
  };
  return result;
}

// src/wasm/casedrop.ts
function transpose(mat, nProp, iter) {
  const out = Array.from({ length: iter }, () => new Array(nProp).fill(NaN));
  for (let p = 0; p < nProp; p++) {
    for (let it = 0; it < iter; it++) {
      out[it][p] = mat[p][it];
    }
  }
  return out;
}
function casedropReliability(model, options = {}) {
  assertReady();
  const {
    iter = 500,
    dropProps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    threshold = 0.7,
    certainty = 0.95,
    method = "spearman",
    includeDiag = false,
    seed = 42
  } = options;
  const ig = integerizeModel(model);
  const r = casedropReliabilityWasm({
    values: ig.values,
    rowStarts: ig.rowStarts,
    nStates: ig.nStates,
    type: model.type === "frequency" ? "frequency" : "relative",
    scaling: model.scaling ?? [],
    iter,
    dropProps,
    threshold,
    certainty,
    method,
    includeDiag,
    seed
  });
  const nProp = dropProps.length;
  const summary = r.summary.map((row) => ({
    metric: row.metric,
    dropProp: row.dropProp,
    mean: row.mean,
    sd: row.sd,
    median: row.median,
    mad: row.mad,
    q025: row.q025,
    q975: row.q975
  }));
  return {
    cs: r.cs,
    summary,
    metrics: {
      mean_abs_dev: transpose(r.meanAbsDev, nProp, iter),
      median_abs_dev: transpose(r.medianAbsDev, nProp, iter),
      correlation: transpose(r.correlation, nProp, iter),
      max_abs_dev: transpose(r.maxAbsDev, nProp, iter)
    },
    correlations: transpose(r.correlation, nProp, iter),
    dropProps: [...dropProps],
    threshold,
    certainty,
    iter,
    method,
    includeDiag,
    nCases: r.nCases,
    nEdges: r.nEdges
  };
}

// src/wasm/reliability-analysis.ts
var RELIABILITY_METRICS = [
  { key: "mad", label: "Mean Abs. Diff.", category: "Deviations" },
  { key: "median_ad", label: "Median Abs. Diff.", category: "Deviations" },
  { key: "rmsd", label: "RMS Diff.", category: "Deviations" },
  { key: "max_ad", label: "Max Abs. Diff.", category: "Deviations" },
  { key: "rel_mad", label: "Rel. MAD", category: "Deviations" },
  { key: "cv_ratio", label: "CV Ratio", category: "Deviations" },
  { key: "pearson", label: "Pearson", category: "Correlations" },
  { key: "spearman", label: "Spearman", category: "Correlations" },
  { key: "kendall", label: "Kendall", category: "Correlations" },
  { key: "dcor", label: "Distance Corr.", category: "Correlations" },
  { key: "euclidean", label: "Euclidean", category: "Dissimilarities" },
  { key: "manhattan", label: "Manhattan", category: "Dissimilarities" },
  { key: "canberra", label: "Canberra", category: "Dissimilarities" },
  { key: "braycurtis", label: "Bray-Curtis", category: "Dissimilarities" },
  { key: "frobenius", label: "Frobenius", category: "Dissimilarities" },
  { key: "cosine", label: "Cosine", category: "Similarities" },
  { key: "jaccard", label: "Jaccard", category: "Similarities" },
  { key: "dice", label: "Dice", category: "Similarities" },
  { key: "overlap", label: "Overlap", category: "Similarities" },
  { key: "rv", label: "RV", category: "Similarities" },
  { key: "rank_agree", label: "Rank Agreement", category: "Pattern" },
  { key: "sign_agree", label: "Sign Agreement", category: "Pattern" }
];
function reliabilityAnalysis(sequenceData, modelType, opts = {}) {
  assertReady();
  if (modelType !== "tna" && modelType !== "ftna") {
    throw new Error(
      `tnaw.reliabilityAnalysis: modelType '${modelType}' not in WASM kernel. Supported: ['tna', 'ftna']. Use tnaj.reliabilityAnalysis for atna / ctna.`
    );
  }
  if (sequenceData.length < 4) {
    throw new Error("Need at least 4 sequences for reliability analysis");
  }
  const {
    iter = 100,
    split = 0.5,
    seed = 42,
    scaling,
    addStartState,
    startStateLabel,
    addEndState,
    endStateLabel
  } = opts;
  let prepared = sequenceData;
  if (addStartState || addEndState) {
    prepared = sequenceData.map((seq) => {
      let last = seq.length - 1;
      while (last >= 0 && seq[last] === null) last--;
      const trimmed = seq.slice(0, last + 1);
      if (addStartState) trimmed.unshift(startStateLabel || "Start");
      if (addEndState) trimmed.push(endStateLabel || "End");
      return trimmed;
    });
  }
  const labelSet = /* @__PURE__ */ new Set();
  for (const seq of prepared) for (const v of seq) if (v != null) labelSet.add(v);
  const labels = [...labelSet].sort();
  const ig = integerize(
    prepared,
    labels
  );
  const r = reliabilityAnalysisWasm({
    values: ig.values,
    rowStarts: ig.rowStarts,
    nStates: labels.length,
    type: modelType === "tna" ? "relative" : "frequency",
    scaling: scaling ? [scaling] : [],
    iter,
    split,
    seed
  });
  const iterations = {};
  for (let m = 0; m < RELIABILITY_METRIC_KEYS.length; m++) {
    const key = RELIABILITY_METRIC_KEYS[m];
    iterations[key] = r.iterations.map((row) => row[m]);
  }
  const summary = RELIABILITY_METRICS.map((metDef, idx) => {
    const s = r.summary[idx];
    return {
      metric: metDef.label,
      category: metDef.category,
      mean: s.mean,
      sd: s.sd,
      median: s.median,
      min: s.min,
      max: s.max,
      q25: s.q25,
      q75: s.q75
    };
  });
  return {
    iterations,
    summary,
    iter,
    split,
    modelType
  };
}

// src/wasm/cluster.ts
var DEFAULT_NA_SYMS = ["*", "%"];
var CLUSTER_PEAK_BYTES_BUDGET = 15e8;
function assertClusterableSize(n, what) {
  const peakBytes = 16 * n * n;
  if (peakBytes > CLUSTER_PEAK_BYTES_BUDGET) {
    const nMax = Math.floor(Math.sqrt(CLUSTER_PEAK_BYTES_BUDGET / 16));
    throw new Error(
      `${what}: n=${n} sequences needs a dense ${(8 * n * n / 1e9).toFixed(1)} GB distance matrix (~${(peakBytes / 1e9).toFixed(1)} GB peak in WASM, which hard-caps at 4 GB). PAM/hierarchical are O(n\xB2) memory; the safe limit here is ~${nMax} sequences. For larger data, cluster a representative subsample then assign, or use findRepresentatives.`
    );
  }
}
function deriveLabels(seqData, naSyms) {
  const naSet = new Set(naSyms);
  const set = /* @__PURE__ */ new Set();
  for (const row of seqData) {
    for (const v of row) {
      if (v === null || v === void 0 || v === "") continue;
      if (naSet.has(v)) continue;
      set.add(v);
    }
  }
  return [...set].sort();
}
function toMatrix(flat, n) {
  const m = chunkRT5XI5AH_cjs.Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) m.set(i, j, flat[i * n + j]);
  }
  return m;
}
function isNumericData(data) {
  if (!Array.isArray(data) || data.length === 0) return false;
  const firstRow = data[0];
  return Array.isArray(firstRow) && firstRow.length > 0 && typeof firstRow[0] === "number";
}
function clusterStringData(seqData, k, method, options) {
  const dissimilarity = options?.dissimilarity ?? "hamming";
  const naSyms = options?.naSyms ?? DEFAULT_NA_SYMS;
  const weighted = options?.weighted ?? false;
  const lambda = options?.lambda ?? 1;
  if (k < 2) throw new Error("k must be >= 2");
  if (k > seqData.length) {
    throw new Error(`k=${k} exceeds number of sequences (${seqData.length})`);
  }
  assertClusterableSize(seqData.length, "clusterData");
  const labels = deriveLabels(seqData, naSyms);
  const ig = integerize(seqData, labels, { naSyms });
  const r = clusterStringWasm({
    values: ig.values,
    rowStarts: ig.rowStarts,
    k,
    method,
    dissimilarity,
    weighted,
    lambda
  });
  const result = {
    data: seqData,
    k,
    assignments: r.assignments,
    silhouette: r.silhouette,
    sizes: r.sizes,
    method,
    distance: toMatrix(r.distance, r.n),
    dissimilarity
  };
  if (r.merge) {
    result.merge = r.merge;
    result.heights = r.heights;
    result.order = r.order;
  }
  return result;
}
function clusterData(data, k, options) {
  assertReady();
  const method = options?.method ?? "pam";
  if (typeof data === "object" && data !== null && "sequenceData" in data) {
    return clusterStringData(data.sequenceData, k, method, options);
  }
  if (isNumericData(data)) {
    const dissimilarity = options?.dissimilarity ?? "euclidean";
    if (k < 2) throw new Error("k must be >= 2");
    if (k > data.length) {
      throw new Error(`k=${k} exceeds number of observations (${data.length})`);
    }
    assertClusterableSize(data.length, "clusterData");
    const n = data.length;
    const p = data[0].length;
    const flat = new Float64Array(n * p);
    for (let i = 0; i < n; i++) {
      const row = data[i];
      for (let j = 0; j < p; j++) flat[i * p + j] = row[j];
    }
    const r = clusterNumericWasm({
      data: flat,
      n,
      p,
      k,
      method,
      metric: dissimilarity === "manhattan" ? "manhattan" : "euclidean"
    });
    const seqData = data.map((row) => row.map((v) => String(v)));
    const result = {
      data: seqData,
      k,
      assignments: r.assignments,
      silhouette: r.silhouette,
      sizes: r.sizes,
      method,
      distance: toMatrix(r.distance, r.n),
      dissimilarity
    };
    if (r.merge) {
      result.merge = r.merge;
      result.heights = r.heights;
      result.order = r.order;
    }
    return result;
  }
  return clusterStringData(data, k, method, options);
}
function clusterSequences(data, k, options) {
  return clusterData(data, k, options);
}
function computeDendrogram(dist, method = "average") {
  assertReady();
  const n = dist.rows;
  assertClusterableSize(n, "computeDendrogram");
  const flat = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) flat[i * n + j] = dist.get(i, j);
  }
  const r = clusterFromDistWasm({ dist: flat, n, k: 1, method });
  return { merge: r.merge, heights: r.heights, order: r.order };
}
function canonicalKey(seq) {
  let last = -1;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (seq[i] !== null && seq[i] !== void 0) {
      last = i;
      break;
    }
  }
  return seq.slice(0, last + 1).map((v) => v ?? "\0NULL").join("");
}
function wasmStringDistance(data, dissimilarity, naSyms, k) {
  assertClusterableSize(data.length, "findRepresentatives");
  const labels = deriveLabels(data, naSyms);
  const ig = integerize(data, labels, { naSyms });
  const r = clusterStringWasm({
    values: ig.values,
    rowStarts: ig.rowStarts,
    k,
    method: "pam",
    dissimilarity,
    weighted: false,
    lambda: 1
  });
  return { dist: toMatrix(r.distance, r.n), assignments: r.assignments };
}
function pickTopFrequent(data, n) {
  const freqMap = /* @__PURE__ */ new Map();
  for (let i = 0; i < data.length; i++) {
    const key = canonicalKey(data[i]);
    const existing = freqMap.get(key);
    if (existing) existing.count++;
    else freqMap.set(key, { count: 1, firstIdx: i });
  }
  const sorted = [...freqMap.values()].sort(
    (a, b) => b.count - a.count || a.firstIdx - b.firstIdx
  );
  return sorted.slice(0, n).map(({ firstIdx }) => ({
    index: firstIdx,
    sequence: data[firstIdx],
    distance: 0
  }));
}
function findMedoidRepresentatives(data, k, n, dissimilarity, naSyms) {
  const numSeqs = data.length;
  if (k !== void 0) {
    if (k < 1) throw new Error("k must be >= 1");
    const effectiveK = Math.min(k, numSeqs);
    if (effectiveK < 2) {
      const { dist: dist3 } = wasmStringDistance(
        data,
        dissimilarity,
        naSyms,
        Math.min(2, numSeqs)
      );
      let bestIdx = 0;
      let bestSum = Infinity;
      for (let i = 0; i < numSeqs; i++) {
        let sum = 0;
        for (let j = 0; j < numSeqs; j++) sum += dist3.get(i, j);
        if (sum < bestSum) {
          bestSum = sum;
          bestIdx = i;
        }
      }
      const meanDist = numSeqs > 1 ? bestSum / (numSeqs - 1) : 0;
      return [{ index: bestIdx, sequence: data[bestIdx], distance: meanDist, cluster: 1 }];
    }
    const { dist: dist2, assignments } = wasmStringDistance(
      data,
      dissimilarity,
      naSyms,
      effectiveK
    );
    const results = [];
    for (let c = 1; c <= effectiveK; c++) {
      const members = assignments.map((a, idx) => a === c ? idx : -1).filter((idx) => idx >= 0);
      if (members.length === 0) continue;
      let bestIdx = members[0];
      let bestSum = Infinity;
      for (const i of members) {
        let sum = 0;
        for (const j of members) sum += dist2.get(i, j);
        if (sum < bestSum) {
          bestSum = sum;
          bestIdx = i;
        }
      }
      const meanDist = members.length > 1 ? bestSum / (members.length - 1) : 0;
      results.push({ index: bestIdx, sequence: data[bestIdx], distance: meanDist, cluster: c });
    }
    return results;
  }
  const count = Math.min(n ?? 5, numSeqs);
  const { dist } = wasmStringDistance(data, dissimilarity, naSyms, Math.min(2, numSeqs));
  const totalDists = [];
  for (let i = 0; i < numSeqs; i++) {
    let sum = 0;
    for (let j = 0; j < numSeqs; j++) sum += dist.get(i, j);
    totalDists.push({ index: i, totalDist: sum });
  }
  totalDists.sort((a, b) => a.totalDist - b.totalDist);
  return totalDists.slice(0, count).map(({ index, totalDist }) => ({
    index,
    sequence: data[index],
    distance: numSeqs > 1 ? totalDist / (numSeqs - 1) : 0
  }));
}
function findFrequencyRepresentatives(data, k, n, dissimilarity, naSyms) {
  const numSeqs = data.length;
  if (k !== void 0) {
    const effectiveK = Math.min(k, numSeqs);
    if (effectiveK < 2) {
      const freqResult = pickTopFrequent(data, 1);
      return freqResult.map((r) => ({ ...r, cluster: 1 }));
    }
    const { assignments } = wasmStringDistance(data, dissimilarity, naSyms, effectiveK);
    const results = [];
    for (let c = 1; c <= effectiveK; c++) {
      const members = assignments.map((a, idx) => a === c ? idx : -1).filter((idx) => idx >= 0);
      if (members.length === 0) continue;
      const freqMap = /* @__PURE__ */ new Map();
      for (const idx of members) {
        const key = canonicalKey(data[idx]);
        const existing = freqMap.get(key);
        if (existing) existing.count++;
        else freqMap.set(key, { count: 1, firstIdx: idx });
      }
      let bestCount = -1;
      let bestIdx = -1;
      for (const [, { count: count2, firstIdx }] of freqMap) {
        if (count2 > bestCount) {
          bestCount = count2;
          bestIdx = firstIdx;
        }
      }
      results.push({ index: bestIdx, sequence: data[bestIdx], distance: 0, cluster: c });
    }
    return results;
  }
  const count = Math.min(n ?? 5, numSeqs);
  return pickTopFrequent(data, count);
}
function findRepresentatives(data, options) {
  assertReady();
  const criterion = options?.criterion ?? "medoid";
  const dissimilarity = options?.dissimilarity ?? "hamming";
  const naSyms = options?.naSyms ?? DEFAULT_NA_SYMS;
  const k = options?.k;
  if (data.length === 0) return [];
  if (criterion === "frequency") {
    return findFrequencyRepresentatives(data, k, options?.n, dissimilarity, naSyms);
  }
  return findMedoidRepresentatives(data, k, options?.n, dissimilarity, naSyms);
}

// src/wasm/mmm.ts
function deriveLabels2(seqData) {
  const set = /* @__PURE__ */ new Set();
  for (const row of seqData) {
    for (const v of row) {
      if (v === null || v === void 0 || v === "") continue;
      set.add(v);
    }
  }
  return [...set].sort();
}
function mmm(data, options) {
  assertReady();
  const {
    k,
    maxIter = 200,
    tol = 1e-8,
    alpha = 0.01,
    seed = 42,
    nStarts = 1,
    initPosterior
  } = options;
  chunkT7KNIXMR_cjs.validateMmmOptions({ k, maxIter, tol, alpha, seed, nStarts });
  let seqData;
  let labels;
  if (Array.isArray(data)) {
    seqData = data;
    labels = deriveLabels2(seqData);
  } else {
    const tna = data;
    if (!tna.data) throw new Error("mmm: TNA model missing data");
    seqData = tna.data;
    labels = [...tna.labels];
  }
  if (labels.length < 2) throw new Error("mmm: need at least 2 states");
  if (k > seqData.length) {
    throw new Error(`mmm: k=${k} exceeds number of sequences (${seqData.length})`);
  }
  const ip = initPosterior == null ? void 0 : initPosterior instanceof Float64Array ? initPosterior : new Float64Array(initPosterior);
  const ig = integerize(seqData, labels);
  const r = mmmWasm({
    values: ig.values,
    rowStarts: ig.rowStarts,
    nStates: labels.length,
    k,
    maxIter,
    tol,
    alpha,
    seed,
    nStarts,
    initPosterior: ip
  });
  const s = r.s;
  const transition = r.transition.map((flat) => {
    const m = chunkRT5XI5AH_cjs.Matrix.zeros(s, s);
    for (let i = 0; i < s; i++) {
      for (let j = 0; j < s; j++) m.set(i, j, flat[i * s + j]);
    }
    return m;
  });
  return {
    k: r.k,
    assignments: r.assignments,
    responsibilities: r.responsibilities,
    pi: r.pi,
    delta: r.delta,
    transition,
    logLik: r.logLik,
    // Derived from AIC rather than recomputed: aic = -2·logLik + 2·df, so df = (aic + 2·logLik)/2.
    // Re-deriving the parameter count here would be a SECOND formula for it, free to drift from
    // the TS one — and the WASM kernel has no covariate path, so its df is the plain-MMM count
    // by construction. Rounded because it is an integer that arrived through floating point.
    df: Math.round((r.aic + 2 * r.logLik) / 2),
    aic: r.aic,
    bic: r.bic,
    icl: r.icl,
    quality: r.quality,
    iterations: r.iterations,
    converged: r.converged,
    nStarts: r.nStarts,
    restartLogLiks: r.restartLogLiks,
    labels,
    nSequences: r.n
  };
}

exports.bootstrapTna = bootstrapTna;
exports.casedropReliability = casedropReliability;
exports.centralities = centralities;
exports.clusterData = clusterData;
exports.clusterSequences = clusterSequences;
exports.compareWeightMatrices = compareWeightMatrices;
exports.computeDendrogram = computeDendrogram;
exports.estimateCS = estimateCS;
exports.findRepresentatives = findRepresentatives;
exports.isInitialized = isInitialized;
exports.markovOrderTest = markovOrderTest;
exports.markovStability = markovStability;
exports.mmm = mmm;
exports.passageTime = passageTime;
exports.permutationTest = permutationTest;
exports.reliabilityAnalysis = reliabilityAnalysis;
exports.setExports = setExports;
//# sourceMappingURL=chunk-NXZY3JA5.cjs.map
//# sourceMappingURL=chunk-NXZY3JA5.cjs.map