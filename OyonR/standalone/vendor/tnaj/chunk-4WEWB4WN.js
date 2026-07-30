import { computeTransitions3D, computeWeightsFrom3D, SeededRNG, arrayQuantile, createTNA, buildModel } from './chunk-2EXGRQR6.js';

// src/analysis/wtna.ts
function toBinaryMatrix(records, codes) {
  return records.map(
    (rec) => codes.map((c) => {
      const v = rec[c];
      return typeof v === "number" ? v > 0 ? 1 : 0 : parseInt(String(v), 10) > 0 ? 1 : 0;
    })
  );
}
function applyWindowing(X, windowSize, mode) {
  const n = X.length;
  const k = X[0]?.length ?? 0;
  if (windowSize <= 1) return X;
  if (mode === "tumbling") {
    const nBlocks = Math.ceil(n / windowSize);
    const result = Array.from({ length: nBlocks }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      const block = Math.floor(i / windowSize);
      for (let j = 0; j < k; j++) {
        result[block][j] = result[block][j] | (X[i]?.[j] ?? 0);
      }
    }
    return result;
  } else {
    const nWindows = Math.max(0, n - windowSize + 1);
    const result = Array.from({ length: nWindows }, () => new Array(k).fill(0));
    for (let i = 0; i < nWindows; i++) {
      for (let t = i; t < i + windowSize; t++) {
        for (let j = 0; j < k; j++) {
          result[i][j] = result[i][j] | (X[t]?.[j] ?? 0);
        }
      }
    }
    return result;
  }
}
function applyIntervalWindowing(X, labels) {
  const k = X[0]?.length ?? 0;
  const result = [];
  let prevLabel = null;
  for (let i = 0; i < X.length; i++) {
    const lbl = labels[i] ?? "";
    if (lbl !== prevLabel) {
      result.push(new Array(k).fill(0));
      prevLabel = lbl;
    }
    const win = result[result.length - 1];
    for (let j = 0; j < k; j++) {
      win[j] |= X[i]?.[j] ?? 0;
    }
  }
  return result;
}
function computeWtnaTransitions(W) {
  const n = W.length;
  const k = W[0]?.length ?? 0;
  const T = Array.from({ length: k }, () => new Array(k).fill(0));
  if (n < 2) return T;
  for (let t = 0; t < n - 1; t++) {
    const rowT = W[t];
    const rowT1 = W[t + 1];
    for (let i = 0; i < k; i++) {
      if (!rowT[i]) continue;
      for (let j = 0; j < k; j++) {
        T[i][j] += rowT[i] * rowT1[j];
      }
    }
  }
  return T;
}
function computeWithinWindow(W) {
  const n = W.length;
  const k = W[0]?.length ?? 0;
  const C = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let t = 0; t < n; t++) {
    const row = W[t];
    for (let i = 0; i < k; i++) {
      if (!row[i]) continue;
      for (let j = 0; j < k; j++) {
        if (i !== j && row[j]) C[i][j]++;
      }
    }
  }
  return C;
}
function addMatrix(A, B) {
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < (A[i]?.length ?? 0); j++) {
      A[i][j] += B[i]?.[j] ?? 0;
    }
  }
}
function rowNormalizeWtna(M) {
  return M.map((row) => {
    const s = row.reduce((a, b) => a + b, 0);
    return s > 0 ? row.map((v) => v / s) : row.slice();
  });
}
function buildWtnaMatrix(records, codes, opts = {}) {
  const windowSize = Math.max(1, opts.windowSize ?? 3);
  const windowType = opts.windowType ?? "tumbling";
  const type = opts.type ?? "frequency";
  const actorKey = opts.actor;
  const sessionKey = opts.session;
  const k = codes.length;
  const M = Array.from({ length: k }, () => new Array(k).fill(0));
  const Mc = Array.from({ length: k }, () => new Array(k).fill(0));
  const groups = /* @__PURE__ */ new Map();
  for (const rec of records) {
    const actor = actorKey ? String(rec[actorKey] ?? "") : "__all__";
    if (!groups.has(actor)) groups.set(actor, []);
    groups.get(actor).push(rec);
  }
  for (const grp of groups.values()) {
    const X = toBinaryMatrix(grp, codes);
    let W;
    if (sessionKey) {
      const labels = grp.map((rec) => String(rec[sessionKey] ?? ""));
      W = applyIntervalWindowing(X, labels);
    } else {
      W = applyWindowing(X, windowSize, windowType);
    }
    const T = computeWtnaTransitions(W);
    const Cw = computeWithinWindow(W);
    addMatrix(M, T);
    addMatrix(Mc, Cw);
  }
  const matrix = type === "relative" ? rowNormalizeWtna(M) : M;
  return { matrix, withinMatrix: Mc, labels: codes };
}

// src/analysis/bootstrap.ts
function bootstrapTna(model, options = {}) {
  const {
    iter = 1e3,
    level = 0.05,
    method = "stability",
    consistencyRange = [0.75, 1.25],
    seed = 42
  } = options;
  if (!Number.isInteger(iter) || iter < 1) {
    throw new Error(`bootstrapTna: iter must be a positive integer (got ${iter})`);
  }
  if (!model.data) {
    throw new Error("TNA model must have sequence data for bootstrap");
  }
  const labels = model.labels;
  const a = labels.length;
  const seqData = model.data;
  const n = seqData.length;
  const modelType = model.type;
  const modelScaling = model.scaling.length > 0 ? model.scaling : null;
  let maxLen = 0;
  for (const seq of seqData) {
    if (seq.length > maxLen) maxLen = seq.length;
  }
  const padded = seqData.map((seq) => {
    if (seq.length >= maxLen) return seq;
    const pad = new Array(maxLen - seq.length).fill(null);
    return [...seq, ...pad];
  });
  const trans = computeTransitions3D(padded, labels, modelType, model.params);
  const weights = computeWeightsFrom3D(trans, modelType, modelScaling);
  let threshold = options.threshold;
  if (threshold === void 0) {
    const allW = [];
    for (let i = 0; i < a; i++) {
      for (let j = 0; j < a; j++) {
        allW.push(weights.get(i, j));
      }
    }
    allW.sort((x, y) => x - y);
    const p10Idx = Math.floor(allW.length * 0.1);
    threshold = allW[p10Idx] ?? 0;
  }
  const rng = new SeededRNG(seed);
  const seqRowTotals = new Float64Array(n * a);
  for (let seqIdx = 0; seqIdx < n; seqIdx++) {
    const t = trans[seqIdx];
    for (let i = 0; i < a; i++) {
      let rowSum = 0;
      for (let j = 0; j < a; j++) rowSum += t.get(i, j);
      seqRowTotals[seqIdx * a + i] = rowSum;
    }
  }
  const pCounts = new Float64Array(a * a);
  const bootSums = new Float64Array(a * a);
  const bootSqSums = new Float64Array(a * a);
  const bootWeights = [];
  for (let i = 0; i < a * a; i++) {
    bootWeights.push(new Float64Array(iter));
  }
  for (let it = 0; it < iter; it++) {
    const bootIdx = rng.choice(n, n);
    const transBoot = [];
    for (let i = 0; i < n; i++) {
      transBoot.push(trans[bootIdx[i]]);
    }
    const wBoot = computeWeightsFrom3D(transBoot, modelType, modelScaling);
    const bootRowTotals = new Float64Array(a);
    for (let k = 0; k < n; k++) {
      const seqIdx = bootIdx[k];
      for (let i = 0; i < a; i++) {
        bootRowTotals[i] += seqRowTotals[seqIdx * a + i];
      }
    }
    for (let i = 0; i < a; i++) {
      for (let j = 0; j < a; j++) {
        const idx = i * a + j;
        const wb = wBoot.get(i, j);
        const wo = weights.get(i, j);
        bootWeights[idx][it] = wb;
        bootSums[idx] += wb;
        bootSqSums[idx] += wb * wb;
        if (method === "stability") {
          if (bootRowTotals[i] === 0) continue;
          if (wb <= wo * consistencyRange[0] || wb >= wo * consistencyRange[1]) {
            pCounts[idx]++;
          }
        } else {
          if (wb < threshold) {
            pCounts[idx]++;
          }
        }
      }
    }
  }
  const pValues = new Float64Array(a * a);
  for (let i = 0; i < a * a; i++) {
    pValues[i] = (pCounts[i] + 1) / (iter + 1);
  }
  const ciLower = new Float64Array(a * a);
  const ciUpper = new Float64Array(a * a);
  const halfLevel = level / 2;
  for (let idx = 0; idx < a * a; idx++) {
    ciLower[idx] = arrayQuantile(bootWeights[idx], halfLevel);
    ciUpper[idx] = arrayQuantile(bootWeights[idx], 1 - halfLevel);
  }
  const weightsMean = new Float64Array(a * a);
  const weightsSd = new Float64Array(a * a);
  for (let i = 0; i < a * a; i++) {
    const mean = bootSums[i] / iter;
    weightsMean[i] = mean;
    const variance = bootSqSums[i] / iter - mean * mean;
    weightsSd[i] = iter > 1 ? Math.sqrt(variance * iter / (iter - 1)) : 0;
  }
  const weightsBias = new Float64Array(a * a);
  for (let i = 0; i < a; i++)
    for (let j = 0; j < a; j++) {
      const idx = i * a + j;
      weightsBias[idx] = weightsMean[idx] - weights.get(i, j);
    }
  const edges = [];
  for (let j = 0; j < a; j++) {
    for (let i = 0; i < a; i++) {
      const idx = i * a + j;
      const w = weights.get(i, j);
      if (w <= 0) continue;
      edges.push({
        from: labels[i],
        to: labels[j],
        weight: w,
        bootstrapMean: weightsMean[idx],
        bias: weightsBias[idx],
        pValue: pValues[idx],
        significant: pValues[idx] < level,
        crLower: w * consistencyRange[0],
        crUpper: w * consistencyRange[1],
        ciLower: ciLower[idx],
        ciUpper: ciUpper[idx]
      });
    }
  }
  const sigModel = createTNA(weights, model.inits, labels, model.data, model.type, model.scaling);
  for (let i = 0; i < a; i++) {
    for (let j = 0; j < a; j++) {
      const idx = i * a + j;
      sigModel.weights.set(i, j, pValues[idx] < level ? weights.get(i, j) : 0);
    }
  }
  return { edges, model: sigModel, labels, method, iter, level, weightsMean, weightsSd, weightsBias };
}
function bootstrapWtna(input, options = {}) {
  const { originalModel, records, codes, wtnaOpts, modelType, scaling } = input;
  const {
    iter = 1e3,
    level = 0.05,
    method = "stability",
    consistencyRange = [0.75, 1.25],
    seed = 42
  } = options;
  if (!Number.isInteger(iter) || iter < 1) {
    throw new Error(`bootstrapWtna: iter must be a positive integer (got ${iter})`);
  }
  const labels = codes;
  const a = codes.length;
  const actorKey = wtnaOpts.actor;
  const sessionKey = wtnaOpts.session;
  const windowSize = Math.max(1, wtnaOpts.windowSize ?? 3);
  const windowType = wtnaOpts.windowType ?? "tumbling";
  const windowedGroups = [];
  {
    const groupMap = /* @__PURE__ */ new Map();
    for (const rec of records) {
      const actor = actorKey ? String(rec[actorKey] ?? "") : "__all__";
      if (!groupMap.has(actor)) groupMap.set(actor, []);
      groupMap.get(actor).push(rec);
    }
    if (actorKey) {
      for (const grp of groupMap.values()) {
        const X = toBinaryMatrix(grp, codes);
        let W;
        if (sessionKey) {
          const lbls = grp.map((rec) => String(rec[sessionKey] ?? ""));
          W = applyIntervalWindowing(X, lbls);
        } else {
          W = applyWindowing(X, windowSize, windowType);
        }
        if (W.length >= 2) windowedGroups.push(W);
      }
    } else {
      const allRecs = groupMap.get("__all__") ?? [];
      const X = toBinaryMatrix(allRecs, codes);
      let W;
      if (sessionKey) {
        const lbls = allRecs.map((rec) => String(rec[sessionKey] ?? ""));
        W = applyIntervalWindowing(X, lbls);
      } else {
        W = applyWindowing(X, windowSize, windowType);
      }
      for (let t = 0; t < W.length - 1; t++) {
        windowedGroups.push([W[t], W[t + 1]]);
      }
    }
  }
  const n = windowedGroups.length;
  const rng = new SeededRNG(seed);
  let threshold = options.threshold;
  if (threshold === void 0) {
    const allW = [];
    for (let i = 0; i < a; i++) {
      for (let j = 0; j < a; j++) {
        const w = originalModel.weights.get(i, j);
        if (w > 0) allW.push(w);
      }
    }
    allW.sort((x, y) => x - y);
    threshold = allW[Math.floor(allW.length * 0.1)] ?? 0;
  }
  const pCounts = new Float64Array(a * a);
  const bootSums = new Float64Array(a * a);
  const bootSqSums = new Float64Array(a * a);
  const bootWeightsArr = [];
  for (let i = 0; i < a * a; i++) bootWeightsArr.push(new Float64Array(iter));
  for (let it = 0; it < iter; it++) {
    const bootIdx = rng.choice(n, n);
    const M = Array.from({ length: a }, () => new Array(a).fill(0));
    for (let k = 0; k < n; k++) {
      const W = windowedGroups[bootIdx[k]];
      const T = computeWtnaTransitions(W);
      for (let i = 0; i < a; i++) {
        for (let j = 0; j < a; j++) {
          M[i][j] += T[i]?.[j] ?? 0;
        }
      }
    }
    let matrix = M;
    if (modelType === "tna") matrix = rowNormalizeWtna(matrix);
    const tempType = modelType === "tna" ? "relative" : "frequency";
    const tempOpts = { type: tempType, labels };
    if (scaling) tempOpts.scaling = scaling;
    const tempModel = buildModel(matrix, tempOpts);
    for (let i = 0; i < a; i++) {
      for (let j = 0; j < a; j++) {
        const idx = i * a + j;
        const wb = tempModel.weights.get(i, j);
        const wo = originalModel.weights.get(i, j);
        bootWeightsArr[idx][it] = wb;
        bootSums[idx] += wb;
        bootSqSums[idx] += wb * wb;
        if (method === "stability") {
          if (wb <= wo * consistencyRange[0] || wb >= wo * consistencyRange[1]) pCounts[idx]++;
        } else {
          if (wb < threshold) pCounts[idx]++;
        }
      }
    }
  }
  const pValues = new Float64Array(a * a);
  for (let i = 0; i < a * a; i++) pValues[i] = (pCounts[i] + 1) / (iter + 1);
  const ciLower = new Float64Array(a * a);
  const ciUpper = new Float64Array(a * a);
  const halfLevel = level / 2;
  for (let idx = 0; idx < a * a; idx++) {
    ciLower[idx] = arrayQuantile(bootWeightsArr[idx], halfLevel);
    ciUpper[idx] = arrayQuantile(bootWeightsArr[idx], 1 - halfLevel);
  }
  const weightsMean = new Float64Array(a * a);
  const weightsSd = new Float64Array(a * a);
  for (let i = 0; i < a * a; i++) {
    const mean = bootSums[i] / iter;
    weightsMean[i] = mean;
    const variance = bootSqSums[i] / iter - mean * mean;
    weightsSd[i] = iter > 1 ? Math.sqrt(variance * iter / (iter - 1)) : 0;
  }
  const weightsBias = new Float64Array(a * a);
  for (let i = 0; i < a; i++)
    for (let j = 0; j < a; j++) {
      const idx = i * a + j;
      weightsBias[idx] = weightsMean[idx] - originalModel.weights.get(i, j);
    }
  const edges = [];
  for (let j = 0; j < a; j++) {
    for (let i = 0; i < a; i++) {
      const idx = i * a + j;
      const w = originalModel.weights.get(i, j);
      if (w <= 0) continue;
      edges.push({
        from: labels[i],
        to: labels[j],
        weight: w,
        bootstrapMean: weightsMean[idx],
        bias: weightsBias[idx],
        pValue: pValues[idx],
        significant: pValues[idx] < level,
        crLower: w * consistencyRange[0],
        crUpper: w * consistencyRange[1],
        ciLower: ciLower[idx],
        ciUpper: ciUpper[idx]
      });
    }
  }
  const sigWeights2D = [];
  for (let i = 0; i < a; i++) {
    const row = [];
    for (let j = 0; j < a; j++) {
      row.push(pValues[i * a + j] < level ? originalModel.weights.get(i, j) : 0);
    }
    sigWeights2D.push(row);
  }
  const sigModel = buildModel(sigWeights2D, { type: originalModel.type, labels });
  return { edges, model: sigModel, labels, method, iter, level, weightsMean, weightsSd, weightsBias };
}

export { applyIntervalWindowing, applyWindowing, bootstrapTna, bootstrapWtna, buildWtnaMatrix, computeWithinWindow, computeWtnaTransitions, rowNormalizeWtna, toBinaryMatrix };
//# sourceMappingURL=chunk-4WEWB4WN.js.map
//# sourceMappingURL=chunk-4WEWB4WN.js.map