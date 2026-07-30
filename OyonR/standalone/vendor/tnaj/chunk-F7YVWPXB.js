import { fitMultinom, multinomSE } from './chunk-ZCVPZDHU.js';
import { eigenDominantLeft, designMatrix, solveLinear } from './chunk-UZZFDWDX.js';
import { pAdjust } from './chunk-ZULEKCKD.js';
import { rowNormalizeWtna, toBinaryMatrix, applyIntervalWindowing, applyWindowing, computeWtnaTransitions } from './chunk-4WEWB4WN.js';
import { isGroupTNA, groupEntries } from './chunk-PKCMUOEM.js';
import { anova, pairwiseWelch, kruskal, chisqTest, pairwiseChisq, spearmanCorr, kendallTau } from './chunk-DOMOOFBU.js';
import { Matrix, arrayQuantile, computeTransitions3D, SeededRNG, computeWeightsFrom3D, buildModel, createTNA, pearsonCorr } from './chunk-2EXGRQR6.js';

// src/analysis/centralities.ts
var AVAILABLE_MEASURES = [
  "OutStrength",
  "InStrength",
  "ClosenessIn",
  "ClosenessOut",
  "Closeness",
  "Betweenness",
  "BetweennessRSP",
  "Diffusion",
  "Clustering",
  "PageRank"
];
function centralities(model, options) {
  if (isGroupTNA(model)) {
    const allLabels = [];
    const allGroups = [];
    const allMeasures = {};
    for (const [name, m] of groupEntries(model)) {
      const result = centralities(m, options);
      for (let i = 0; i < result.labels.length; i++) {
        allLabels.push(result.labels[i]);
        allGroups.push(name);
      }
      for (const [measure, values] of Object.entries(result.measures)) {
        if (!allMeasures[measure]) allMeasures[measure] = [];
        for (let i = 0; i < values.length; i++) {
          allMeasures[measure].push(values[i]);
        }
      }
    }
    const measures2 = {};
    for (const [m, vals] of Object.entries(allMeasures)) {
      measures2[m] = new Float64Array(vals);
    }
    return { labels: allLabels, measures: measures2, groups: allGroups };
  }
  const tnaModel = model;
  const requestedMeasures = options?.measures ?? [...AVAILABLE_MEASURES];
  const loops = options?.loops ?? false;
  const normalize = options?.normalize ?? false;
  const weights = tnaModel.weights.clone();
  const n = weights.rows;
  if (!loops) {
    for (let i = 0; i < n; i++) weights.set(i, i, 0);
  }
  const measures = {};
  for (const measure of AVAILABLE_MEASURES) {
    if (!requestedMeasures.includes(measure)) continue;
    switch (measure) {
      case "OutStrength":
        measures.OutStrength = outStrength(weights);
        break;
      case "InStrength":
        measures.InStrength = inStrength(weights);
        break;
      case "ClosenessIn":
        measures.ClosenessIn = closenessIn(weights, n);
        break;
      case "ClosenessOut":
        measures.ClosenessOut = closenessOut(weights, n);
        break;
      case "Closeness":
        measures.Closeness = closenessAll(weights, n);
        break;
      case "Betweenness":
        measures.Betweenness = betweenness(weights, n);
        break;
      case "BetweennessRSP":
        measures.BetweennessRSP = betweennessRSP(weights);
        break;
      case "Diffusion":
        measures.Diffusion = diffusion(weights);
        break;
      case "Clustering":
        measures.Clustering = clustering(weights);
        break;
      case "PageRank":
        measures.PageRank = pageRank(weights);
        break;
    }
  }
  if (normalize) {
    for (const key of Object.keys(measures)) {
      const vals = measures[key];
      let min = Infinity;
      let max = -Infinity;
      let anyNaN = false;
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (Number.isNaN(v)) {
          anyNaN = true;
          break;
        }
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const spread = max - min;
      const scale = Math.max(Math.abs(min), Math.abs(max));
      const degenerate = !(spread > 1e-10 * Math.max(scale, 1e-300));
      if (anyNaN || degenerate) {
        vals.fill(NaN);
      } else {
        for (let i = 0; i < vals.length; i++) vals[i] = (vals[i] - min) / spread;
      }
    }
  }
  return {
    labels: tnaModel.labels,
    measures
  };
}
function outStrength(weights) {
  return weights.rowSums();
}
function inStrength(weights) {
  return weights.colSums();
}
function dijkstra(n, getWeight, source) {
  const dist = new Float64Array(n).fill(Infinity);
  const visited = new Uint8Array(n);
  dist[source] = 0;
  for (let step = 0; step < n; step++) {
    let u = -1;
    let minDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visited[i] && dist[i] < minDist) {
        minDist = dist[i];
        u = i;
      }
    }
    if (u === -1) break;
    visited[u] = 1;
    for (let v = 0; v < n; v++) {
      if (visited[v]) continue;
      const w = getWeight(u, v);
      if (w > 0) {
        const d = 1 / w;
        const newDist = dist[u] + d;
        if (newDist < dist[v]) {
          dist[v] = newDist;
        }
      }
    }
  }
  return dist;
}
function closenessIn(weights, n) {
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dist = dijkstra(n, (from, to) => weights.get(to, from), i);
    let totalDist = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i && isFinite(dist[j])) totalDist += dist[j];
    }
    result[i] = totalDist > 0 ? 1 / totalDist : NaN;
  }
  return result;
}
function closenessOut(weights, n) {
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dist = dijkstra(n, (from, to) => weights.get(from, to), i);
    let totalDist = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i && isFinite(dist[j])) totalDist += dist[j];
    }
    result[i] = totalDist > 0 ? 1 / totalDist : NaN;
  }
  return result;
}
function closenessAll(weights, n) {
  const symWeights = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = Math.max(weights.get(i, j), weights.get(j, i));
      symWeights.set(i, j, w);
      symWeights.set(j, i, w);
    }
  }
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dist = dijkstra(n, (from, to) => symWeights.get(from, to), i);
    let totalDist = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i && isFinite(dist[j])) totalDist += dist[j];
    }
    result[i] = totalDist > 0 ? 1 / totalDist : NaN;
  }
  return result;
}
function betweenness(weights, n) {
  const CB = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const stack = [];
    const pred = Array.from({ length: n }, () => []);
    const sigma = new Float64Array(n);
    const dist = new Float64Array(n).fill(Infinity);
    sigma[s] = 1;
    dist[s] = 0;
    const visited = new Uint8Array(n);
    for (let step = 0; step < n; step++) {
      let u = -1;
      let minDist = Infinity;
      for (let i = 0; i < n; i++) {
        if (!visited[i] && dist[i] < minDist) {
          minDist = dist[i];
          u = i;
        }
      }
      if (u === -1) break;
      visited[u] = 1;
      stack.push(u);
      for (let v = 0; v < n; v++) {
        if (visited[v]) continue;
        const w = weights.get(u, v);
        if (w <= 0) continue;
        const d = 1 / w;
        const newDist = dist[u] + d;
        if (newDist < dist[v] - 1e-15) {
          dist[v] = newDist;
          sigma[v] = sigma[u];
          pred[v] = [u];
        } else if (Math.abs(newDist - dist[v]) < 1e-15) {
          sigma[v] = sigma[v] + sigma[u];
          pred[v].push(u);
        }
      }
    }
    const delta = new Float64Array(n);
    while (stack.length > 0) {
      const w = stack.pop();
      for (const v of pred[w]) {
        const frac = sigma[v] / sigma[w] * (1 + delta[w]);
        delta[v] = delta[v] + frac;
      }
      if (w !== s) {
        CB[w] = CB[w] + delta[w];
      }
    }
  }
  return CB;
}
function solveLU(A, n) {
  const LU = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) LU[i] = A.data[i];
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;
  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(LU[k * n + k]);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(LU[i * n + k]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = i;
      }
    }
    if (maxVal < 1e-15) throw new Error("Singular matrix in solveLU");
    if (maxRow !== k) {
      for (let j = 0; j < n; j++) {
        const tmp2 = LU[k * n + j];
        LU[k * n + j] = LU[maxRow * n + j];
        LU[maxRow * n + j] = tmp2;
      }
      const tmp = piv[k];
      piv[k] = piv[maxRow];
      piv[maxRow] = tmp;
    }
    for (let i = k + 1; i < n; i++) {
      const factor = LU[i * n + k] / LU[k * n + k];
      LU[i * n + k] = factor;
      for (let j = k + 1; j < n; j++) {
        LU[i * n + j] = LU[i * n + j] - factor * LU[k * n + j];
      }
    }
  }
  const X = Matrix.zeros(n, n);
  for (let col = 0; col < n; col++) {
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = piv[i] === col ? 1 : 0;
    for (let i = 1; i < n; i++) {
      for (let j = 0; j < i; j++) {
        b[i] = b[i] - LU[i * n + j] * b[j];
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) {
        b[i] = b[i] - LU[i * n + j] * b[j];
      }
      b[i] = b[i] / LU[i * n + i];
    }
    for (let i = 0; i < n; i++) X.set(i, col, b[i]);
  }
  return X;
}
function betweennessRSP(weights, beta = 0.01) {
  const n = weights.rows;
  const mat = weights.clone();
  const D = mat.rowSums();
  for (let i = 0; i < n; i++) {
    if (D[i] === 0) return new Float64Array(n).fill(NaN);
  }
  const Pref = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      Pref.set(i, j, mat.get(i, j) / D[i]);
    }
  }
  const C = mat.map((v) => v === 0 ? 0 : 1 / v);
  const W = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      W.set(i, j, Pref.get(i, j) * Math.exp(-beta * C.get(i, j)));
    }
  }
  const IminusW = Matrix.eye(n).sub(W);
  let Z2;
  try {
    Z2 = solveLU(IminusW, n);
  } catch {
    return new Float64Array(n).fill(NaN);
  }
  const ZERO_TOL = 1e-12;
  const Zrecip = Z2.map((v) => {
    if (Math.abs(v) <= ZERO_TOL) return 0;
    const inv = 1 / v;
    return isFinite(inv) ? inv : 0;
  });
  const ZrecipDiag = Matrix.diag(Zrecip.diag());
  const inner = Zrecip.sub(ZrecipDiag.scale(n));
  const step1 = Z2.matmul(inner.transpose());
  const step2 = step1.matmul(Z2);
  const out = step2.diag();
  for (let i = 0; i < n; i++) {
    out[i] = Math.round(out[i]);
  }
  let minVal = Infinity;
  for (let i = 0; i < n; i++) {
    if (out[i] < minVal) minVal = out[i];
  }
  for (let i = 0; i < n; i++) {
    out[i] = out[i] - minVal + 1;
  }
  return out;
}
function diffusion(weights) {
  const n = weights.rows;
  let s = Matrix.zeros(n, n);
  let p = Matrix.eye(n);
  for (let i = 0; i < n; i++) {
    p = p.matmul(weights);
    s = s.add(p);
  }
  return s.rowSums();
}
function clustering(weights) {
  const mat = weights.add(weights.transpose());
  for (let i = 0; i < mat.rows; i++) mat.set(i, i, 0);
  const n = mat.rows;
  const mat2 = mat.matmul(mat);
  const mat3 = mat2.matmul(mat);
  const num = mat3.diag();
  const colSums = mat.colSums();
  const matSq = mat.map((v) => v * v);
  const colSumsSq = matSq.colSums();
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const den = colSums[i] * colSums[i] - colSumsSq[i];
    result[i] = den !== 0 ? num[i] / den : NaN;
  }
  return result;
}
function pageRank(weights, damping = 0.85, maxIter = 100, tol = 1e-8) {
  const n = weights.rows;
  const result = new Float64Array(n);
  if (n === 0) return result;
  const outDeg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) outDeg[i] += weights.get(i, j);
    }
  }
  let pr = new Float64Array(n).fill(1 / n);
  for (let iter = 0; iter < maxIter; iter++) {
    const newPr = new Float64Array(n).fill((1 - damping) / n);
    let danglingSum = 0;
    for (let i = 0; i < n; i++) {
      if (outDeg[i] <= 0) danglingSum += pr[i];
    }
    const danglingContrib = damping * danglingSum / n;
    for (let i = 0; i < n; i++) newPr[i] += danglingContrib;
    for (let j = 0; j < n; j++) {
      if (outDeg[j] <= 0) continue;
      for (let i = 0; i < n; i++) {
        if (i === j) continue;
        const w = weights.get(j, i);
        if (w > 0) {
          newPr[i] += damping * pr[j] * w / outDeg[j];
        }
      }
    }
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(newPr[i] - pr[i]);
    pr = newPr;
    if (diff < tol) break;
  }
  for (let i = 0; i < n; i++) result[i] = pr[i];
  return result;
}
function betweennessNetwork(model) {
  if (isGroupTNA(model)) {
    const result = {};
    for (const [name, m] of groupEntries(model)) {
      result[name] = betweennessNetwork(m);
    }
    return result;
  }
  const tnaModel = model;
  const weights = tnaModel.weights;
  const n = weights.rows;
  const edgeBet = Matrix.zeros(n, n);
  for (let s = 0; s < n; s++) {
    const stack = [];
    const pred = Array.from({ length: n }, () => []);
    const sigma = new Float64Array(n);
    const dist = new Float64Array(n).fill(Infinity);
    sigma[s] = 1;
    dist[s] = 0;
    const visited = new Uint8Array(n);
    for (let step = 0; step < n; step++) {
      let u = -1;
      let minDist = Infinity;
      for (let i = 0; i < n; i++) {
        if (!visited[i] && dist[i] < minDist) {
          minDist = dist[i];
          u = i;
        }
      }
      if (u === -1) break;
      visited[u] = 1;
      stack.push(u);
      for (let v = 0; v < n; v++) {
        if (visited[v]) continue;
        const w = weights.get(u, v);
        if (w <= 0) continue;
        const d = 1 / w;
        const newDist = dist[u] + d;
        if (newDist < dist[v] - 1e-15) {
          dist[v] = newDist;
          sigma[v] = sigma[u];
          pred[v] = [u];
        } else if (Math.abs(newDist - dist[v]) < 1e-15) {
          sigma[v] = sigma[v] + sigma[u];
          pred[v].push(u);
        }
      }
    }
    const delta = new Float64Array(n);
    while (stack.length > 0) {
      const w = stack.pop();
      for (const v of pred[w]) {
        const frac = sigma[v] / sigma[w] * (1 + delta[w]);
        delta[v] = delta[v] + frac;
        edgeBet.set(v, w, edgeBet.get(v, w) + sigma[v] / sigma[w] * (1 + delta[w]));
      }
    }
  }
  return {
    weights: edgeBet,
    inits: new Float64Array(tnaModel.inits),
    labels: [...tnaModel.labels],
    data: tnaModel.data,
    type: "betweenness",
    scaling: [...tnaModel.scaling]
  };
}

// src/analysis/prune.ts
var PRUNE_DEFAULT_THRESHOLD = 0.1;
var PRUNE_DEFAULT_LOWEST = 0.05;
var PRUNE_DEFAULT_LEVEL = 0.5;
function prune(model, thresholdOrOptions = PRUNE_DEFAULT_THRESHOLD) {
  if (isGroupTNA(model)) {
    const result = {};
    for (const [name, m] of groupEntries(model)) {
      result[name] = prune(m, thresholdOrOptions);
    }
    return result;
  }
  const tnaModel = model;
  const opts = typeof thresholdOrOptions === "number" ? { method: "threshold", threshold: thresholdOrOptions } : thresholdOrOptions;
  const method = opts.method ?? "threshold";
  switch (method) {
    case "threshold":
      return pruneThreshold(tnaModel, opts.threshold ?? PRUNE_DEFAULT_THRESHOLD);
    case "lowest": {
      const pos = [];
      const n = tnaModel.weights.rows;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const w = tnaModel.weights.get(i, j);
          if (w > 0) pos.push(w);
        }
      }
      if (pos.length === 0) return pruneThreshold(tnaModel, 0);
      const cutOff = arrayQuantile(Float64Array.from(pos), opts.lowest ?? PRUNE_DEFAULT_LOWEST);
      return pruneThreshold(tnaModel, cutOff);
    }
    case "disparity":
      return pruneDisparity(tnaModel, opts.level ?? opts.alpha ?? PRUNE_DEFAULT_LEVEL);
    default:
      throw new Error(
        `prune: unknown method ${JSON.stringify(method)}. Expected 'threshold', 'lowest' or 'disparity'.`
      );
  }
}
function pruneThreshold(model, threshold) {
  const n = model.weights.rows;
  const weights = model.weights.clone();
  const toRemove = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const w = weights.get(i, j);
      if (w > 0 && w <= threshold) {
        toRemove.push({ i, j, w });
      }
    }
  }
  for (const { i, j } of toRemove) {
    const prev = weights.get(i, j);
    weights.set(i, j, 0);
    if (!isWeaklyConnected(weights, n)) {
      weights.set(i, j, prev);
    }
  }
  return {
    weights,
    inits: new Float64Array(model.inits),
    labels: [...model.labels],
    data: model.data,
    type: model.type,
    scaling: [...model.scaling]
  };
}
function isWeaklyConnected(weights, n) {
  if (n <= 1) return true;
  const visited = new Uint8Array(n);
  const stack = [0];
  visited[0] = 1;
  let count = 1;
  while (stack.length > 0) {
    const u = stack.pop();
    for (let v = 0; v < n; v++) {
      if (!visited[v] && (weights.get(u, v) > 0 || weights.get(v, u) > 0)) {
        visited[v] = 1;
        count++;
        stack.push(v);
      }
    }
  }
  return count === n;
}
function pruneDisparity(model, alpha = PRUNE_DEFAULT_LEVEL) {
  const n = model.weights.rows;
  const mat = model.weights;
  const outStrength2 = new Float64Array(n);
  const outDegree = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (mat.get(i, j) > 0) {
        outStrength2[i] += mat.get(i, j);
        outDegree[i]++;
      }
    }
  }
  const inStrength2 = new Float64Array(n);
  const inDegree = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (mat.get(i, j) > 0) {
        inStrength2[j] += mat.get(i, j);
        inDegree[j]++;
      }
    }
  }
  const weights = mat.clone();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        weights.set(i, j, 0);
        continue;
      }
      const w = mat.get(i, j);
      if (w <= 0) continue;
      const outP = outStrength2[i] > 0 ? Math.pow(1 - w / outStrength2[i], Math.max(outDegree[i] - 1, 0)) : 1;
      const inP = inStrength2[j] > 0 ? Math.pow(1 - w / inStrength2[j], Math.max(inDegree[j] - 1, 0)) : 1;
      const pValue = Math.min(outP, inP);
      if (pValue >= alpha) {
        weights.set(i, j, 0);
      }
    }
  }
  return {
    weights,
    inits: new Float64Array(model.inits),
    labels: [...model.labels],
    data: model.data,
    type: model.type,
    scaling: [...model.scaling]
  };
}

// src/analysis/cliques.ts
function cliques(model, options) {
  if (isGroupTNA(model)) {
    const result = {};
    for (const [name, m] of groupEntries(model)) {
      result[name] = cliques(m, options);
    }
    return result;
  }
  const tnaModel = model;
  const size = options?.size ?? 2;
  const threshold = options?.threshold ?? 0;
  const weights = tnaModel.weights;
  const n = weights.rows;
  const upperAdj = Array.from({ length: n }, () => /* @__PURE__ */ new Set());
  const lowerAdj = Array.from({ length: n }, () => /* @__PURE__ */ new Set());
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const wij = weights.get(i, j);
      if (wij >= threshold && wij > 0) {
        upperAdj[i].add(j);
        upperAdj[j].add(i);
      }
      const wji = weights.get(j, i);
      if (wji >= threshold && wji > 0) {
        lowerAdj[i].add(j);
        lowerAdj[j].add(i);
      }
    }
  }
  const upperCliques = findAllCliques(upperAdj, n);
  const lowerCliques = findAllCliques(lowerAdj, n);
  const subsUpper = subcliquesOfSize(upperCliques, size);
  const subsLower = subcliquesOfSize(lowerCliques, size);
  const mutualCliques = [];
  for (const clique of subsUpper) {
    const key = clique.join(",");
    for (const other of subsLower) {
      if (other.join(",") === key) {
        mutualCliques.push(clique);
        break;
      }
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const uniqueCliques = [];
  for (const c of mutualCliques) {
    const key = c.join(",");
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCliques.push(c);
    }
  }
  uniqueCliques.sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  });
  const resultWeights = [];
  const resultIndices = [];
  const resultLabels = [];
  for (const idx of uniqueCliques) {
    const k = idx.length;
    const sub = Matrix.zeros(k, k);
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) {
        sub.set(r, c, weights.get(idx[r], idx[c]));
      }
    }
    resultWeights.push(sub);
    resultIndices.push(idx);
    resultLabels.push(idx.map((i) => tnaModel.labels[i]));
  }
  return {
    weights: resultWeights,
    indices: resultIndices,
    labels: resultLabels,
    size,
    threshold
  };
}
function findAllCliques(adj, n) {
  const cliques2 = [];
  function bronKerbosch(R, P, X) {
    if (P.length === 0 && X.length === 0) {
      if (R.length >= 2) cliques2.push([...R]);
      return;
    }
    let pivot = -1;
    let maxConn = -1;
    for (const u of [...P, ...X]) {
      let conn = 0;
      for (const v of P) {
        if (adj[u].has(v)) conn++;
      }
      if (conn > maxConn) {
        maxConn = conn;
        pivot = u;
      }
    }
    const candidates = pivot >= 0 ? P.filter((v) => !adj[pivot].has(v)) : [...P];
    for (const v of candidates) {
      const newR = [...R, v];
      const newP = P.filter((u) => adj[v].has(u));
      const newX = X.filter((u) => adj[v].has(u));
      bronKerbosch(newR, newP, newX);
      P = P.filter((u) => u !== v);
      X.push(v);
    }
  }
  const allNodes = Array.from({ length: n }, (_, i) => i);
  bronKerbosch([], allNodes, []);
  return cliques2;
}
function subcliquesOfSize(allCliques, k) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const clique of allCliques) {
    if (clique.length === k) {
      const sorted = [...clique].sort((a, b) => a - b);
      const key = sorted.join(",");
      if (!seen.has(key)) {
        seen.add(key);
        result.push(sorted);
      }
    } else if (clique.length > k) {
      const combos = combinations(clique.sort((a, b) => a - b), k);
      for (const combo of combos) {
        const key = combo.join(",");
        if (!seen.has(key)) {
          seen.add(key);
          result.push(combo);
        }
      }
    }
  }
  return result;
}
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const result = [];
  function recurse(start, current) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      recurse(i + 1, current);
      current.pop();
    }
  }
  recurse(0, []);
  return result;
}

// src/analysis/communities.ts
var AVAILABLE_METHODS = [
  "fast_greedy",
  "louvain",
  "label_prop",
  "leading_eigen",
  "edge_betweenness",
  "walktrap"
];
function communities(model, options) {
  if (isGroupTNA(model)) {
    const result = {};
    for (const [name, m] of groupEntries(model)) {
      result[name] = communities(m, options);
    }
    return result;
  }
  const tnaModel = model;
  let methods = ["leading_eigen"];
  if (options?.methods) {
    methods = typeof options.methods === "string" ? [options.methods] : options.methods;
  }
  const weights = tnaModel.weights;
  const n = weights.rows;
  const sym = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = weights.get(i, j) + weights.get(j, i);
      if (w > 0) {
        sym.set(i, j, w);
        sym.set(j, i, w);
      }
    }
    const diag = weights.get(i, i);
    if (diag !== 0) sym.set(i, i, 2 * diag);
  }
  const counts = {};
  const assignments = {};
  for (const method of methods) {
    const comm = method === "walktrap" ? walktrap(sym, n) : detectCommunities(sym, n, method);
    counts[method] = new Set(comm).size;
    assignments[method] = comm;
  }
  return { counts, assignments, labels: tnaModel.labels };
}
function detectCommunities(adj, n, method) {
  switch (method) {
    case "leading_eigen":
      return leadingEigen(adj, n);
    case "louvain":
      return louvain(adj, n);
    case "fast_greedy":
      return greedyModularity(adj, n);
    case "label_prop":
      return labelPropagation(adj, n);
    case "edge_betweenness":
      return edgeBetweennessCommunities(adj, n);
    default:
      throw new Error(`Unknown community detection method: ${method}`);
  }
}
function leadingEigen(adj, n) {
  if (n <= 1) return new Array(n).fill(0);
  const k = adj.rowSums();
  let m2 = 0;
  for (let i = 0; i < n; i++) m2 += k[i];
  if (m2 === 0) return Array.from({ length: n }, (_, i) => i);
  const B = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      B.set(i, j, adj.get(i, j) - k[i] * k[j] / m2);
    }
  }
  let v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = (i * 7 + 3) % 11 / 11 - 0.5;
  for (let iter = 0; iter < 100; iter++) {
    const Bv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) {
        s += B.get(i, j) * v[j];
      }
      Bv[i] = s;
    }
    let norm = 0;
    for (let i = 0; i < n; i++) norm += Bv[i] * Bv[i];
    norm = Math.sqrt(norm);
    if (norm < 1e-15) break;
    for (let i = 0; i < n; i++) Bv[i] /= norm;
    v = Bv;
  }
  return Array.from(v, (val) => val >= 0 ? 0 : 1);
}
function louvain(adj, n) {
  const comm = Array.from({ length: n }, (_, i) => i);
  const totalWeight = adj.sum() / 2;
  if (totalWeight === 0) return comm;
  const maxIter = n * n;
  let improved = true;
  for (let pass = 0; pass < maxIter && improved; pass++) {
    improved = false;
    for (let i = 0; i < n; i++) {
      const currentComm = comm[i];
      let bestComm = currentComm;
      let bestDeltaQ = 0;
      const neighborComms = /* @__PURE__ */ new Set();
      for (let j = 0; j < n; j++) {
        if (adj.get(i, j) > 0 || adj.get(j, i) > 0) {
          neighborComms.add(comm[j]);
        }
      }
      for (const c of neighborComms) {
        if (c === currentComm) continue;
        const deltaQ = modularityDelta(adj, comm, i, c, totalWeight, n);
        if (deltaQ > bestDeltaQ) {
          bestDeltaQ = deltaQ;
          bestComm = c;
        }
      }
      if (bestComm !== currentComm) {
        comm[i] = bestComm;
        improved = true;
      }
    }
  }
  return renumberCommunities(comm);
}
function modularityDelta(adj, comm, node, targetComm, totalWeight, n) {
  const ki = adj.rowSums()[node];
  let sumIn = 0;
  let sumTot = 0;
  for (let j = 0; j < n; j++) {
    if (comm[j] === targetComm) {
      sumIn += adj.get(node, j) + adj.get(j, node);
      sumTot += adj.rowSums()[j];
    }
  }
  const m2 = totalWeight * 2;
  return sumIn / m2 - sumTot * ki / (m2 * m2) * 2;
}
function greedyModularity(adj, n) {
  const comm = Array.from({ length: n }, (_, i) => i);
  const totalWeight = adj.sum() / 2;
  if (totalWeight === 0) return comm;
  let improved = true;
  while (improved) {
    improved = false;
    const uniqueComms = [...new Set(comm)];
    let bestMerge = null;
    let bestDeltaQ = 0;
    for (let a = 0; a < uniqueComms.length; a++) {
      for (let b = a + 1; b < uniqueComms.length; b++) {
        const cA = uniqueComms[a];
        const cB = uniqueComms[b];
        let connected = false;
        for (let i = 0; i < n && !connected; i++) {
          if (comm[i] !== cA) continue;
          for (let j = 0; j < n && !connected; j++) {
            if (comm[j] === cB && (adj.get(i, j) > 0 || adj.get(j, i) > 0)) {
              connected = true;
            }
          }
        }
        if (!connected) continue;
        let eAB = 0;
        let aA = 0;
        let aB = 0;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const w = adj.get(i, j);
            if (comm[i] === cA && comm[j] === cB) eAB += w;
            if (comm[i] === cA) aA += w;
            if (comm[i] === cB) aB += w;
          }
        }
        const m2 = totalWeight * 2;
        const deltaQ = 2 * (eAB / m2 - aA * aB / (m2 * m2));
        if (deltaQ > bestDeltaQ) {
          bestDeltaQ = deltaQ;
          bestMerge = [cA, cB];
        }
      }
    }
    if (bestMerge) {
      const [keep, merge] = bestMerge;
      for (let i = 0; i < n; i++) {
        if (comm[i] === merge) comm[i] = keep;
      }
      improved = true;
    }
  }
  return renumberCommunities(comm);
}
function labelPropagation(adj, n) {
  const comm = Array.from({ length: n }, (_, i) => i);
  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = (i * 7 + iter * 13) % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const i of order) {
      const labelWeights = /* @__PURE__ */ new Map();
      for (let j = 0; j < n; j++) {
        const w = adj.get(i, j) + adj.get(j, i);
        if (w > 0) {
          labelWeights.set(comm[j], (labelWeights.get(comm[j]) ?? 0) + w);
        }
      }
      if (labelWeights.size > 0) {
        let bestLabel = comm[i];
        let bestWeight = 0;
        for (const [label, weight] of labelWeights) {
          if (weight > bestWeight) {
            bestWeight = weight;
            bestLabel = label;
          }
        }
        if (bestLabel !== comm[i]) {
          comm[i] = bestLabel;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return renumberCommunities(comm);
}
function edgeBetweennessCommunities(adj, n) {
  if (adj.count((v) => v > 0) === 0) {
    return Array.from({ length: n }, (_, i) => i);
  }
  const work = adj.clone();
  let bestPartition = Array.from({ length: n }, (_, i) => i);
  let bestMod = -1;
  for (let step = 0; step < n * n; step++) {
    const partition = connectedComponents(work, n);
    const mod = modularity(adj, partition, n);
    if (mod > bestMod) {
      bestMod = mod;
      bestPartition = partition;
    }
    let maxBet = 0;
    let maxI = -1;
    let maxJ = -1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (work.get(i, j) > 0 || work.get(j, i) > 0) {
          const bet = edgeBetweennessScore(work, n, i, j);
          if (bet > maxBet) {
            maxBet = bet;
            maxI = i;
            maxJ = j;
          }
        }
      }
    }
    if (maxI < 0) break;
    work.set(maxI, maxJ, 0);
    work.set(maxJ, maxI, 0);
  }
  return renumberCommunities(bestPartition);
}
function edgeBetweennessScore(adj, n, u, v) {
  let count = 0;
  for (let s = 0; s < n; s++) {
    for (let t = 0; t < n; t++) {
      if (s === t) continue;
      const dist = bfsDistance(adj, n, s);
      if (dist[t] < Infinity) {
        if ((dist[u] + 1 === dist[v] || dist[v] + 1 === dist[u]) && dist[s] + dist[t] === dist[t]) {
          count++;
        }
      }
    }
  }
  return count;
}
function bfsDistance(adj, n, source) {
  const dist = new Float64Array(n).fill(Infinity);
  dist[source] = 0;
  const queue = [source];
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++];
    for (let v = 0; v < n; v++) {
      if (dist[v] === Infinity && (adj.get(u, v) > 0 || adj.get(v, u) > 0)) {
        dist[v] = dist[u] + 1;
        queue.push(v);
      }
    }
  }
  return dist;
}
function connectedComponents(adj, n) {
  const comp = new Array(n).fill(-1);
  let nextComp = 0;
  for (let start = 0; start < n; start++) {
    if (comp[start] >= 0) continue;
    const queue = [start];
    let qi = 0;
    comp[start] = nextComp;
    while (qi < queue.length) {
      const u = queue[qi++];
      for (let v = 0; v < n; v++) {
        if (comp[v] < 0 && (adj.get(u, v) > 0 || adj.get(v, u) > 0)) {
          comp[v] = nextComp;
          queue.push(v);
        }
      }
    }
    nextComp++;
  }
  return comp;
}
function modularity(adj, comm, n) {
  const m2 = adj.sum();
  if (m2 === 0) return 0;
  let Q = 0;
  const k = adj.rowSums();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (comm[i] === comm[j]) {
        Q += adj.get(i, j) - k[i] * k[j] / m2;
      }
    }
  }
  return Q / m2;
}
function walktrap(directedAdj, n, t = 4) {
  if (n <= 1) return new Array(n).fill(0);
  const P = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) rowSum += directedAdj.get(i, j);
    if (rowSum > 0) {
      for (let j = 0; j < n; j++) P.set(i, j, directedAdj.get(i, j) / rowSum);
    }
  }
  let Pt = P.clone();
  for (let step = 1; step < t; step++) {
    const next = Matrix.zeros(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += Pt.get(i, k) * P.get(k, j);
        next.set(i, j, s);
      }
    }
    Pt = next;
  }
  const deg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) deg[i] += directedAdj.get(i, j);
  }
  const communityDist = [];
  for (let i = 0; i < n; i++) {
    const dist = new Float64Array(n);
    for (let k = 0; k < n; k++) dist[k] = Pt.get(i, k);
    communityDist.push(dist);
  }
  const comm = Array.from({ length: n }, (_, i) => i);
  const commSize = new Float64Array(n).fill(1);
  const sym = Matrix.zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = directedAdj.get(i, j) + directedAdj.get(j, i);
      if (w > 0) {
        sym.set(i, j, w);
        sym.set(j, i, w);
      }
    }
    const diag = directedAdj.get(i, i);
    if (diag !== 0) sym.set(i, i, 2 * diag);
  }
  let bestComm = comm.slice();
  let bestMod = modularity(sym, comm, n);
  for (let step = 0; step < n - 1; step++) {
    const activeComms = [...new Set(comm)];
    if (activeComms.length <= 1) break;
    let bestA = -1, bestB = -1;
    let bestDist = Infinity;
    for (let ai = 0; ai < activeComms.length; ai++) {
      for (let bi = ai + 1; bi < activeComms.length; bi++) {
        const cA = activeComms[ai];
        const cB = activeComms[bi];
        const sA2 = commSize[cA];
        const sB2 = commSize[cB];
        let d2 = 0;
        for (let k = 0; k < n; k++) {
          if (deg[k] === 0) continue;
          const diff = communityDist[cA][k] - communityDist[cB][k];
          d2 += diff * diff / deg[k];
        }
        const ward = sA2 * sB2 / (sA2 + sB2) * d2;
        if (ward < bestDist) {
          bestDist = ward;
          bestA = cA;
          bestB = cB;
        }
      }
    }
    if (bestA < 0) break;
    const sA = commSize[bestA];
    const sB = commSize[bestB];
    const sNew = sA + sB;
    for (let k = 0; k < n; k++) {
      communityDist[bestA][k] = (sA * communityDist[bestA][k] + sB * communityDist[bestB][k]) / sNew;
    }
    commSize[bestA] = sNew;
    for (let i = 0; i < n; i++) {
      if (comm[i] === bestB) comm[i] = bestA;
    }
    const mod = modularity(sym, comm, n);
    if (mod > bestMod) {
      bestMod = mod;
      bestComm = comm.slice();
    }
  }
  return renumberCommunities(bestComm);
}
function renumberCommunities(comm) {
  const mapping = /* @__PURE__ */ new Map();
  let nextId = 0;
  const sorted = [...new Set(comm)].sort((a, b) => {
    const aFirst = comm.indexOf(a);
    const bFirst = comm.indexOf(b);
    return aFirst - bFirst;
  });
  for (const c of sorted) {
    mapping.set(c, nextId++);
  }
  return comm.map((c) => mapping.get(c));
}

// src/analysis/cluster.ts
var SENTINEL = "\0__NA__";
function toTokenLists(data, naSyms = ["*", "%"]) {
  const naSet = new Set(naSyms);
  return data.map(
    (row) => row.map((val) => {
      if (val === null || val === void 0 || val === "") return SENTINEL;
      if (naSet.has(val)) return SENTINEL;
      return val;
    })
  );
}
function effectiveLength(seq) {
  let last = 0;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] !== SENTINEL) last = i + 1;
  }
  return last;
}
function hammingDistance(a, b, weighted = false, lambda_ = 1) {
  const maxLen = Math.max(a.length, b.length);
  const aPad = [...a, ...new Array(maxLen - a.length).fill(SENTINEL)];
  const bPad = [...b, ...new Array(maxLen - b.length).fill(SENTINEL)];
  let dist = 0;
  for (let i = 0; i < maxLen; i++) {
    if (aPad[i] !== bPad[i]) {
      dist += weighted ? Math.exp(-lambda_ * i) : 1;
    }
  }
  return dist;
}
function levenshteinDistance(a, b, lenA, lenB) {
  const m = lenA ?? a.length;
  const n = lenB ?? b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
function osaDistance(a, b, lenA, lenB) {
  const m = lenA ?? a.length;
  const n = lenB ?? b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}
function dlDistance(a, b, lenA, lenB) {
  const m = lenA ?? a.length;
  const n = lenB ?? b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const maxDist = m + n;
  const d = Array.from({ length: m + 2 }, () => new Array(n + 2).fill(0));
  d[0][0] = maxDist;
  for (let i = 0; i <= m; i++) {
    d[i + 1][0] = maxDist;
    d[i + 1][1] = i;
  }
  for (let j = 0; j <= n; j++) {
    d[0][j + 1] = maxDist;
    d[1][j + 1] = j;
  }
  const da = /* @__PURE__ */ new Map();
  for (let i = 1; i <= m; i++) {
    let db = 0;
    for (let j = 1; j <= n; j++) {
      const i1 = da.get(b[j - 1]) ?? 0;
      const j1 = db;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      if (cost === 0) db = j;
      d[i + 1][j + 1] = Math.min(
        d[i][j] + cost,
        // substitution
        d[i + 1][j] + 1,
        // insertion
        d[i][j + 1] + 1,
        // deletion
        d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1)
        // transposition
      );
    }
    da.set(a[i - 1], i);
  }
  return d[m + 1][n + 1];
}
function lcsDistance(a, b, lenA, lenB) {
  const m = lenA ?? a.length;
  const n = lenB ?? b.length;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, new Array(n + 1).fill(0)];
  }
  return m + n - 2 * prev[n];
}
function getQgrams(seq, len, q = 1) {
  const n = len ?? seq.length;
  const profile = /* @__PURE__ */ new Map();
  for (let i = 0; i <= n - q; i++) {
    const gram = seq.slice(i, i + q).join("\0");
    profile.set(gram, (profile.get(gram) ?? 0) + 1);
  }
  return profile;
}
function qgramDistance(a, b, lenA, lenB) {
  const pa = getQgrams(a, lenA);
  const pb = getQgrams(b, lenB);
  const allKeys = /* @__PURE__ */ new Set([...pa.keys(), ...pb.keys()]);
  let dist = 0;
  for (const key of allKeys) {
    dist += Math.abs((pa.get(key) ?? 0) - (pb.get(key) ?? 0));
  }
  return dist;
}
function cosineDistance(a, b, lenA, lenB) {
  const pa = getQgrams(a, lenA);
  const pb = getQgrams(b, lenB);
  const allKeys = /* @__PURE__ */ new Set([...pa.keys(), ...pb.keys()]);
  let dot = 0, normA = 0, normB = 0;
  for (const key of allKeys) {
    const va = pa.get(key) ?? 0;
    const vb = pb.get(key) ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 1;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
function jaccardDistance(a, b, lenA, lenB) {
  const setA = new Set(getQgrams(a, lenA).keys());
  const setB = new Set(getQgrams(b, lenB).keys());
  let intersection = 0;
  for (const key of setA) {
    if (setB.has(key)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return 1 - intersection / union;
}
function jaroWinklerDistance(a, b, p = 0, lenA, lenB) {
  const m = lenA ?? a.length;
  const n = lenB ?? b.length;
  if (m === 0 && n === 0) return 0;
  if (m === 0 || n === 0) return 1;
  const matchWindow = Math.max(0, Math.floor(Math.max(m, n) / 2) - 1);
  const aMatched = new Array(m).fill(false);
  const bMatched = new Array(n).fill(false);
  let matches = 0;
  for (let i = 0; i < m; i++) {
    const lo = Math.max(0, i - matchWindow);
    const hi = Math.min(n - 1, i + matchWindow);
    for (let j = lo; j <= hi; j++) {
      if (!bMatched[j] && a[i] === b[j]) {
        aMatched[i] = true;
        bMatched[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 1;
  let transpositions = 0;
  let bIdx = 0;
  for (let i = 0; i < m; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[bIdx]) bIdx++;
    if (a[i] !== b[bIdx]) transpositions++;
    bIdx++;
  }
  const jaroSim = (matches / m + matches / n + (matches - transpositions / 2) / matches) / 3;
  if (p === 0) return 1 - jaroSim;
  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(m, n));
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return 1 - (jaroSim + prefix * p * (1 - jaroSim));
}
var DISTANCE_FUNCS = {
  hamming: (a, b) => hammingDistance(a, b),
  lv: levenshteinDistance,
  osa: osaDistance,
  dl: dlDistance,
  lcs: lcsDistance,
  qgram: qgramDistance,
  cosine: cosineDistance,
  jaccard: jaccardDistance,
  jw: (a, b, lenA, lenB) => jaroWinklerDistance(a, b, 0, lenA, lenB)
};
function computeDistanceMatrix(sequences, dissimilarity, weighted = false, lambda_ = 1) {
  const n = sequences.length;
  const dist = Matrix.zeros(n, n);
  if (dissimilarity === "hamming") {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = hammingDistance(sequences[i], sequences[j], weighted, lambda_);
        dist.set(i, j, d);
        dist.set(j, i, d);
      }
    }
  } else {
    const func = DISTANCE_FUNCS[dissimilarity];
    if (!func) throw new Error(`Unknown dissimilarity: ${dissimilarity}`);
    const effLens = sequences.map(effectiveLength);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = func(sequences[i], sequences[j], effLens[i], effLens[j]);
        dist.set(i, j, d);
        dist.set(j, i, d);
      }
    }
  }
  return dist;
}
function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}
function manhattanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum;
}
function computeNumericDistanceMatrix(data, metric) {
  const n = data.length;
  const dist = Matrix.zeros(n, n);
  const func = metric === "manhattan" ? manhattanDistance : euclideanDistance;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = func(data[i], data[j]);
      dist.set(i, j, d);
      dist.set(j, i, d);
    }
  }
  return dist;
}
function silhouetteScore(dist, labels) {
  const n = labels.length;
  const uniqueClusters = [...new Set(labels)];
  if (uniqueClusters.length < 2) return 0;
  let totalScore = 0;
  for (let i = 0; i < n; i++) {
    const ci = labels[i];
    let sumSame = 0;
    let countSame = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i && labels[j] === ci) {
        sumSame += dist.get(i, j);
        countSame++;
      }
    }
    if (countSame === 0) continue;
    const ai = sumSame / countSame;
    let bi = Infinity;
    for (const c of uniqueClusters) {
      if (c === ci) continue;
      let sumOther = 0;
      let countOther = 0;
      for (let j = 0; j < n; j++) {
        if (labels[j] === c) {
          sumOther += dist.get(i, j);
          countOther++;
        }
      }
      if (countOther > 0) {
        bi = Math.min(bi, sumOther / countOther);
      }
    }
    const maxAB = Math.max(ai, bi);
    totalScore += maxAB > 0 ? (bi - ai) / maxAB : 0;
  }
  return totalScore / n;
}
function pam(dist, k) {
  const n = dist.rows;
  const medoids = [];
  const totalDists = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) totalDists[i] = totalDists[i] + dist.get(i, j);
  }
  let bestIdx = 0;
  for (let i = 1; i < n; i++) {
    if (totalDists[i] <= totalDists[bestIdx]) bestIdx = i;
  }
  medoids.push(bestIdx);
  const nearestDist = new Float64Array(n);
  for (let i = 0; i < n; i++) nearestDist[i] = dist.get(i, medoids[0]);
  for (let m = 1; m < k; m++) {
    let bestGain = -Infinity;
    let bestCandidate = -1;
    for (let c = 0; c < n; c++) {
      if (medoids.includes(c)) continue;
      let gain = 0;
      for (let i = 0; i < n; i++) {
        gain += Math.max(0, nearestDist[i] - dist.get(i, c));
      }
      if (gain >= bestGain) {
        bestGain = gain;
        bestCandidate = c;
      }
    }
    medoids.push(bestCandidate);
    for (let i = 0; i < n; i++) {
      nearestDist[i] = Math.min(nearestDist[i], dist.get(i, bestCandidate));
    }
  }
  const medoidsArr = [...medoids];
  for (let iter = 0; iter < 100; iter++) {
    let currentCost = 0;
    for (let i = 0; i < n; i++) {
      let minD = Infinity;
      for (const m of medoidsArr) minD = Math.min(minD, dist.get(i, m));
      currentCost += minD;
    }
    let bestChange = 0;
    let bestMIdx = -1;
    let bestSwap = -1;
    for (let mIdx = 0; mIdx < k; mIdx++) {
      for (let c = 0; c < n; c++) {
        if (medoidsArr.includes(c)) continue;
        const trial = [...medoidsArr];
        trial[mIdx] = c;
        let trialCost = 0;
        for (let i = 0; i < n; i++) {
          let minD = Infinity;
          for (const m of trial) minD = Math.min(minD, dist.get(i, m));
          trialCost += minD;
        }
        const change = trialCost - currentCost;
        if (change < bestChange) {
          bestChange = change;
          bestMIdx = mIdx;
          bestSwap = c;
        }
      }
    }
    if (bestMIdx >= 0) {
      medoidsArr[bestMIdx] = bestSwap;
    } else {
      break;
    }
  }
  const sortedMedoids = [...medoidsArr].sort((a, b) => a - b);
  return Array.from({ length: n }, (_, i) => {
    let minD = Infinity;
    let bestM = 0;
    for (let m = 0; m < k; m++) {
      const d = dist.get(i, sortedMedoids[m]);
      if (d < minD) {
        minD = d;
        bestM = m;
      }
    }
    return bestM + 1;
  });
}
function computeLeafOrder(merge, _n) {
  const order = [];
  function traverse(node) {
    if (node < 0) {
      order.push(-node - 1);
      return;
    }
    traverse(merge[node - 1][0]);
    traverse(merge[node - 1][1]);
  }
  traverse(merge.length);
  return order;
}
function cutTree(merge, n, k) {
  const cutMerges = /* @__PURE__ */ new Set();
  for (let i = merge.length - 1; i >= merge.length - (k - 1); i--) {
    cutMerges.add(i);
  }
  const labels = new Array(n).fill(0);
  let clusterIdx = 0;
  function assignCluster(node, label) {
    if (node < 0) {
      labels[-node - 1] = label;
      return;
    }
    assignCluster(merge[node - 1][0], label);
    assignCluster(merge[node - 1][1], label);
  }
  function walkAndAssign(node) {
    if (node < 0) {
      labels[-node - 1] = ++clusterIdx;
      return;
    }
    const stepIdx = node - 1;
    if (cutMerges.has(stepIdx)) {
      walkAndAssign(merge[stepIdx][0]);
      walkAndAssign(merge[stepIdx][1]);
    } else {
      ++clusterIdx;
      assignCluster(node, clusterIdx);
    }
  }
  walkAndAssign(merge.length);
  return labels;
}
function hierarchical(dist, k, method) {
  const n = dist.rows;
  const active = new Set(Array.from({ length: n }, (_, i) => i));
  const sizes = new Array(n).fill(1);
  const d = Array.from(
    { length: n },
    (_, i) => Array.from({ length: n }, (_2, j) => dist.get(i, j))
  );
  const isWardD2 = method === "ward.D2";
  if (isWardD2) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        d[i][j] *= d[i][j];
      }
    }
  }
  const clusterToNode = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    clusterToNode[i] = -(i + 1);
  }
  const merge = [];
  const heights = [];
  for (let step = 0; step < n - 1; step++) {
    let bestDist = Infinity;
    let bestI = -1;
    let bestJ = -1;
    const activeArr = [...active];
    for (let a = 0; a < activeArr.length; a++) {
      for (let b = a + 1; b < activeArr.length; b++) {
        const ci = activeArr[a];
        const cj = activeArr[b];
        if (d[ci][cj] < bestDist) {
          bestDist = d[ci][cj];
          bestI = ci;
          bestJ = cj;
        }
      }
    }
    const ni = sizes[bestI];
    const nj = sizes[bestJ];
    const dij = d[bestI][bestJ];
    let left = clusterToNode[bestI];
    let right = clusterToNode[bestJ];
    if (left > 0 && right < 0) {
      [left, right] = [right, left];
    } else if (left < 0 && right < 0) {
      if (Math.abs(left) > Math.abs(right)) {
        [left, right] = [right, left];
      }
    } else if (left > 0 && right > 0) {
      if (left > right) {
        [left, right] = [right, left];
      }
    }
    merge.push([left, right]);
    heights.push(isWardD2 ? Math.sqrt(dij) : dij);
    clusterToNode[bestI] = step + 1;
    for (const ck of active) {
      if (ck === bestI || ck === bestJ) continue;
      const nk = sizes[ck];
      const dik = d[bestI][ck];
      const djk = d[bestJ][ck];
      let newDist;
      switch (method) {
        case "single":
          newDist = Math.min(dik, djk);
          break;
        case "complete":
          newDist = Math.max(dik, djk);
          break;
        case "mcquitty":
          newDist = (dik + djk) / 2;
          break;
        case "median":
          newDist = (dik + djk) / 2 - dij / 4;
          break;
        case "centroid":
          newDist = (ni * dik + nj * djk) / (ni + nj) - ni * nj * dij / ((ni + nj) * (ni + nj));
          break;
        case "ward.D":
        case "ward.D2":
          newDist = ((ni + nk) * dik + (nj + nk) * djk - nk * dij) / (ni + nj + nk);
          break;
        default:
          newDist = (ni * dik + nj * djk) / (ni + nj);
          break;
      }
      d[bestI][ck] = newDist;
      d[ck][bestI] = newDist;
    }
    sizes[bestI] = ni + nj;
    active.delete(bestJ);
  }
  const assignments = cutTree(merge, n, k);
  const order = computeLeafOrder(merge);
  return { assignments, merge, heights, order };
}
function isNumericData(data) {
  if (!Array.isArray(data) || data.length === 0) return false;
  const firstRow = data[0];
  return Array.isArray(firstRow) && firstRow.length > 0 && typeof firstRow[0] === "number";
}
function clusterData(data, k, options) {
  const method = options?.method ?? "pam";
  if (typeof data === "object" && data !== null && "sequenceData" in data) {
    const seqData = data.sequenceData;
    return clusterStringData(seqData, k, method, options);
  }
  if (isNumericData(data)) {
    const dissimilarity = options?.dissimilarity ?? "euclidean";
    if (k < 2) throw new Error("k must be >= 2");
    if (k > data.length) throw new Error(`k=${k} exceeds number of observations (${data.length})`);
    const dist = computeNumericDistanceMatrix(data, dissimilarity);
    let assignments;
    let hResult;
    if (method === "pam") {
      assignments = pam(dist, k);
    } else {
      hResult = hierarchical(dist, k, method);
      assignments = hResult.assignments;
    }
    const sil = silhouetteScore(dist, assignments);
    const sizes = [];
    for (let c = 1; c <= k; c++) {
      sizes.push(assignments.filter((a) => a === c).length);
    }
    const seqData = data.map((row) => row.map((v) => String(v)));
    const result = {
      data: seqData,
      k,
      assignments,
      silhouette: sil,
      sizes,
      method,
      distance: dist,
      dissimilarity
    };
    if (hResult) {
      result.merge = hResult.merge;
      result.heights = hResult.heights;
      result.order = hResult.order;
    }
    return result;
  }
  return clusterStringData(data, k, method, options);
}
function clusterStringData(seqData, k, method, options) {
  const dissimilarity = options?.dissimilarity ?? "hamming";
  const naSyms = options?.naSyms ?? ["*", "%"];
  const weighted = options?.weighted ?? false;
  const lambda_ = options?.lambda ?? 1;
  if (k < 2) throw new Error("k must be >= 2");
  if (k > seqData.length) throw new Error(`k=${k} exceeds number of sequences (${seqData.length})`);
  const sequences = toTokenLists(seqData, naSyms);
  const dist = computeDistanceMatrix(sequences, dissimilarity, weighted, lambda_);
  let assignments;
  let hResult;
  if (method === "pam") {
    assignments = pam(dist, k);
  } else {
    hResult = hierarchical(dist, k, method);
    assignments = hResult.assignments;
  }
  const sil = silhouetteScore(dist, assignments);
  const sizes = [];
  for (let c = 1; c <= k; c++) {
    sizes.push(assignments.filter((a) => a === c).length);
  }
  const result = {
    data: seqData,
    k,
    assignments,
    silhouette: sil,
    sizes,
    method,
    distance: dist,
    dissimilarity
  };
  if (hResult) {
    result.merge = hResult.merge;
    result.heights = hResult.heights;
    result.order = hResult.order;
  }
  return result;
}
function computeDendrogram(dist, method = "average") {
  const result = hierarchical(dist, 1, method);
  return { merge: result.merge, heights: result.heights, order: result.order };
}
function findRepresentatives(data, options) {
  const criterion = options?.criterion ?? "medoid";
  const dissimilarity = options?.dissimilarity ?? "hamming";
  const naSyms = options?.naSyms ?? ["*", "%"];
  const k = options?.k;
  if (data.length === 0) return [];
  if (criterion === "frequency") {
    return findFrequencyRepresentatives(data, k, options?.n, dissimilarity, naSyms);
  }
  return findMedoidRepresentatives(data, k, options?.n, dissimilarity, naSyms);
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
function findMedoidRepresentatives(data, k, n, dissimilarity, naSyms) {
  const sequences = toTokenLists(data, naSyms);
  const dist = computeDistanceMatrix(sequences, dissimilarity);
  const numSeqs = data.length;
  if (k !== void 0) {
    if (k < 1) throw new Error("k must be >= 1");
    const effectiveK = Math.min(k, numSeqs);
    if (effectiveK < 2) {
      let bestIdx = 0;
      let bestSum = Infinity;
      for (let i = 0; i < numSeqs; i++) {
        let sum = 0;
        for (let j = 0; j < numSeqs; j++) sum += dist.get(i, j);
        if (sum < bestSum) {
          bestSum = sum;
          bestIdx = i;
        }
      }
      const meanDist = numSeqs > 1 ? bestSum / (numSeqs - 1) : 0;
      return [{ index: bestIdx, sequence: data[bestIdx], distance: meanDist, cluster: 1 }];
    }
    const assignments = pam(dist, effectiveK);
    const results = [];
    for (let c = 1; c <= effectiveK; c++) {
      const members = assignments.map((a, idx) => a === c ? idx : -1).filter((idx) => idx >= 0);
      if (members.length === 0) continue;
      let bestIdx = members[0];
      let bestSum = Infinity;
      for (const i of members) {
        let sum = 0;
        for (const j of members) sum += dist.get(i, j);
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
    const sequences = toTokenLists(data, naSyms);
    const dist = computeDistanceMatrix(sequences, dissimilarity);
    const effectiveK = Math.min(k, numSeqs);
    if (effectiveK < 2) {
      const freqResult = pickTopFrequent(data, 1);
      return freqResult.map((r) => ({ ...r, cluster: 1 }));
    }
    const assignments = pam(dist, effectiveK);
    const results = [];
    for (let c = 1; c <= effectiveK; c++) {
      const members = assignments.map((a, idx) => a === c ? idx : -1).filter((idx) => idx >= 0);
      if (members.length === 0) continue;
      const freqMap = /* @__PURE__ */ new Map();
      for (const idx of members) {
        const key = canonicalKey(data[idx]);
        const existing = freqMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          freqMap.set(key, { count: 1, firstIdx: idx });
        }
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
function pickTopFrequent(data, n) {
  const freqMap = /* @__PURE__ */ new Map();
  for (let i = 0; i < data.length; i++) {
    const key = canonicalKey(data[i]);
    const existing = freqMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      freqMap.set(key, { count: 1, firstIdx: i });
    }
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
function clusterSequences(data, k, options) {
  return clusterData(data, k, options);
}

// src/analysis/permutation.ts
function permutationTest(x, y, options = {}) {
  const { iter = 1e3, adjust = "none", level = 0.05, seed = 42, paired = false } = options;
  if (!Number.isInteger(iter) || iter < 1) {
    throw new Error(`permutationTest: iter must be a positive integer (got ${iter})`);
  }
  if (!x.data || !y.data) {
    throw new Error("Both TNA models must have sequence data for permutation test");
  }
  const labels = x.labels;
  const a = labels.length;
  if (a !== y.labels.length || !labels.every((l, i) => l === y.labels[i])) {
    throw new Error("Both models must have the same state labels");
  }
  const modelType = x.type;
  const modelScaling = x.scaling.length > 0 ? x.scaling : null;
  const dataX = x.data;
  const dataY = y.data;
  const nX = dataX.length;
  const nY = dataY.length;
  const combined = [...dataX, ...dataY];
  const nXY = nX + nY;
  let maxLen = 0;
  for (const seq of combined) {
    if (seq.length > maxLen) maxLen = seq.length;
  }
  const padded = combined.map((seq) => {
    if (seq.length >= maxLen) return seq;
    const pad = new Array(maxLen - seq.length).fill(null);
    return [...seq, ...pad];
  });
  const combinedTrans = computeTransitions3D(padded, labels, modelType, x.params);
  const trueDiff = new Float64Array(a * a);
  const absTrueDiff = new Float64Array(a * a);
  for (let i = 0; i < a; i++) {
    for (let j = 0; j < a; j++) {
      const idx = i * a + j;
      trueDiff[idx] = x.weights.get(i, j) - y.weights.get(i, j);
      absTrueDiff[idx] = Math.abs(trueDiff[idx]);
    }
  }
  if (paired && nX !== nY) {
    throw new Error("Paired permutation test requires equal group sizes");
  }
  const rng = new SeededRNG(seed);
  const edgePCounts = new Float64Array(a * a);
  const permDiffSums = new Float64Array(a * a);
  const permDiffSqSums = new Float64Array(a * a);
  for (let it = 0; it < iter; it++) {
    let permIdx;
    if (paired) {
      permIdx = Array.from({ length: nXY }, (_, i) => i);
      for (let p = 0; p < nX; p++) {
        if (rng.random() < 0.5) {
          [permIdx[p], permIdx[nX + p]] = [permIdx[nX + p], permIdx[p]];
        }
      }
    } else {
      permIdx = rng.permutation(nXY);
    }
    const transPermX = [];
    const transPermY = [];
    for (let i = 0; i < nX; i++) {
      transPermX.push(combinedTrans[permIdx[i]]);
    }
    for (let i = nX; i < nXY; i++) {
      transPermY.push(combinedTrans[permIdx[i]]);
    }
    const wPermX = computeWeightsFrom3D(transPermX, modelType, modelScaling);
    const wPermY = computeWeightsFrom3D(transPermY, modelType, modelScaling);
    for (let i = 0; i < a; i++) {
      for (let j = 0; j < a; j++) {
        const idx = i * a + j;
        const diff = wPermX.get(i, j) - wPermY.get(i, j);
        permDiffSums[idx] += diff;
        permDiffSqSums[idx] += diff * diff;
        if (Math.abs(diff) >= absTrueDiff[idx]) {
          edgePCounts[idx]++;
        }
      }
    }
  }
  const rawPValues = new Float64Array(a * a);
  for (let i = 0; i < a * a; i++) {
    rawPValues[i] = (edgePCounts[i] + 1) / (iter + 1);
  }
  const colMajorP = [];
  for (let j = 0; j < a; j++) {
    for (let i = 0; i < a; i++) {
      colMajorP.push(rawPValues[i * a + j]);
    }
  }
  const adjustedColMajor = pAdjust(colMajorP, adjust);
  const adjustedP = new Float64Array(a * a);
  for (let j = 0; j < a; j++) {
    for (let i = 0; i < a; i++) {
      adjustedP[i * a + j] = adjustedColMajor[j * a + i];
    }
  }
  const effectSizes = new Float64Array(a * a);
  for (let i = 0; i < a * a; i++) {
    const mean = permDiffSums[i] / iter;
    const variance = permDiffSqSums[i] / iter - mean * mean;
    const sd = iter > 1 ? Math.sqrt(variance * iter / (iter - 1)) : 0;
    effectSizes[i] = sd > 0 ? trueDiff[i] / sd : NaN;
  }
  const diffSig = new Float64Array(a * a);
  for (let i = 0; i < a * a; i++) {
    diffSig[i] = adjustedP[i] < level ? trueDiff[i] : 0;
  }
  const edgeStats = [];
  for (let j = 0; j < a; j++) {
    for (let i = 0; i < a; i++) {
      const idx = i * a + j;
      edgeStats.push({
        from: labels[i],
        to: labels[j],
        diffTrue: trueDiff[idx],
        effectSize: effectSizes[idx],
        pValue: adjustedP[idx]
      });
    }
  }
  return { edgeStats, diffTrue: trueDiff, diffSig, pValues: adjustedP, labels, nStates: a, level };
}
function permutationTestWtna(inputX, inputY, modelX, modelY, options = {}) {
  const { iter = 1e3, adjust = "none", level = 0.05, seed = 42 } = options;
  if (!Number.isInteger(iter) || iter < 1) {
    throw new Error(`permutationWtna: iter must be a positive integer (got ${iter})`);
  }
  const labels = inputX.codes;
  const a = labels.length;
  if (a !== inputY.codes.length || !labels.every((l, i) => l === inputY.codes[i])) {
    throw new Error("Both WTNA inputs must have the same state codes");
  }
  const modelType = inputX.modelType;
  const scaling = inputX.scaling || null;
  const groupsX = buildWindowedGroups(inputX);
  const groupsY = buildWindowedGroups(inputY);
  const nX = groupsX.length;
  const nY = groupsY.length;
  const combined = [...groupsX, ...groupsY];
  const nXY = nX + nY;
  const trueDiff = new Float64Array(a * a);
  const absTrueDiff = new Float64Array(a * a);
  for (let i = 0; i < a; i++) {
    for (let j = 0; j < a; j++) {
      const idx = i * a + j;
      trueDiff[idx] = modelX.weights.get(i, j) - modelY.weights.get(i, j);
      absTrueDiff[idx] = Math.abs(trueDiff[idx]);
    }
  }
  const rng = new SeededRNG(seed);
  const edgePCounts = new Float64Array(a * a);
  const permDiffSums = new Float64Array(a * a);
  const permDiffSqSums = new Float64Array(a * a);
  for (let it = 0; it < iter; it++) {
    const permIdx = rng.permutation(nXY);
    const mX = buildMatrixFromGroups(permIdx.slice(0, nX).map((i) => combined[i]), a);
    const mY = buildMatrixFromGroups(permIdx.slice(nX).map((i) => combined[i]), a);
    const matX = modelType === "tna" ? rowNormalizeWtna(mX) : mX;
    const matY = modelType === "tna" ? rowNormalizeWtna(mY) : mY;
    const wtnaType = modelType === "tna" || !!scaling ? "relative" : "frequency";
    const optsX = { type: wtnaType, labels };
    const optsY = { type: wtnaType, labels };
    if (scaling) {
      optsX.scaling = scaling;
      optsY.scaling = scaling;
    }
    const tempX = buildModel(matX, optsX);
    const tempY = buildModel(matY, optsY);
    for (let i = 0; i < a; i++) {
      for (let j = 0; j < a; j++) {
        const idx = i * a + j;
        const diff = tempX.weights.get(i, j) - tempY.weights.get(i, j);
        permDiffSums[idx] += diff;
        permDiffSqSums[idx] += diff * diff;
        if (Math.abs(diff) >= absTrueDiff[idx]) {
          edgePCounts[idx]++;
        }
      }
    }
  }
  const rawPValues = new Float64Array(a * a);
  for (let i = 0; i < a * a; i++) {
    rawPValues[i] = (edgePCounts[i] + 1) / (iter + 1);
  }
  const colMajorP = [];
  for (let j = 0; j < a; j++) {
    for (let i = 0; i < a; i++) {
      colMajorP.push(rawPValues[i * a + j]);
    }
  }
  const adjustedColMajor = pAdjust(colMajorP, adjust);
  const adjustedP = new Float64Array(a * a);
  for (let j = 0; j < a; j++) {
    for (let i = 0; i < a; i++) {
      adjustedP[i * a + j] = adjustedColMajor[j * a + i];
    }
  }
  const effectSizes = new Float64Array(a * a);
  for (let i = 0; i < a * a; i++) {
    const mean = permDiffSums[i] / iter;
    const variance = permDiffSqSums[i] / iter - mean * mean;
    const sd = iter > 1 ? Math.sqrt(variance * iter / (iter - 1)) : 0;
    effectSizes[i] = sd > 0 ? trueDiff[i] / sd : NaN;
  }
  const diffSig = new Float64Array(a * a);
  for (let i = 0; i < a * a; i++) {
    diffSig[i] = adjustedP[i] < level ? trueDiff[i] : 0;
  }
  const edgeStats = [];
  for (let j = 0; j < a; j++) {
    for (let i = 0; i < a; i++) {
      const idx = i * a + j;
      edgeStats.push({
        from: labels[i],
        to: labels[j],
        diffTrue: trueDiff[idx],
        effectSize: effectSizes[idx],
        pValue: adjustedP[idx]
      });
    }
  }
  return { edgeStats, diffTrue: trueDiff, diffSig, pValues: adjustedP, labels, nStates: a, level };
}
function buildWindowedGroups(input) {
  const { records, codes, wtnaOpts } = input;
  const actorKey = wtnaOpts.actor;
  const sessionKey = wtnaOpts.session;
  const windowSize = Math.max(1, wtnaOpts.windowSize ?? 3);
  const windowType = wtnaOpts.windowType ?? "tumbling";
  const groupMap = /* @__PURE__ */ new Map();
  for (const rec of records) {
    const actor = actorKey ? String(rec[actorKey] ?? "") : "__all__";
    if (!groupMap.has(actor)) groupMap.set(actor, []);
    groupMap.get(actor).push(rec);
  }
  const groups = [];
  for (const grp of groupMap.values()) {
    const X = toBinaryMatrix(grp, codes);
    let W;
    if (sessionKey) {
      const lbls = grp.map((rec) => String(rec[sessionKey] ?? ""));
      W = applyIntervalWindowing(X, lbls);
    } else {
      W = applyWindowing(X, windowSize, windowType);
    }
    if (W.length >= 2) groups.push(W);
  }
  return groups;
}
function buildMatrixFromGroups(groups, k) {
  const M = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const W of groups) {
    const T = computeWtnaTransitions(W);
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        M[i][j] += T[i]?.[j] ?? 0;
      }
    }
  }
  return M;
}

// src/analysis/stability.ts
function centralityCorr(a, b, method) {
  if (method === "spearman") return spearmanCorr(a, b);
  if (method === "kendall") {
    return kendallTau(Array.from(a), Array.from(b));
  }
  return pearsonCorr(a, b);
}
function hasVariance(vals) {
  const n = vals.length;
  if (n < 2) return false;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += vals[i];
  mean /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = vals[i] - mean;
    ss += d * d;
  }
  return ss > 0;
}
function estimateCS(model, options = {}) {
  const {
    measures = ["InStrength", "OutStrength", "Betweenness"],
    iter = 500,
    dropProps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    threshold = 0.7,
    certainty = 0.95,
    seed = 42,
    corrMethod = "pearson",
    loops = false,
    replayIndices
  } = options;
  if (!model.data) {
    throw new Error("TNA model must have sequence data for centrality stability");
  }
  const labels = model.labels;
  const seqData = model.data;
  const n = seqData.length;
  const modelType = model.type;
  const modelScaling = model.scaling.length > 0 ? model.scaling : null;
  const rng = new SeededRNG(seed);
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
  const origCent = centralities(model, { measures, loops });
  const validMeasures = [];
  for (const m of measures) {
    const vals = origCent.measures[m];
    if (!vals) continue;
    if (hasVariance(vals)) validMeasures.push(m);
  }
  const correlations = {};
  for (const m of measures) {
    correlations[m] = dropProps.map(
      () => new Array(iter).fill(Number.NaN)
    );
  }
  for (let j = 0; j < dropProps.length; j++) {
    const dp = dropProps[j];
    const nDrop = Math.floor(n * dp);
    const nKeep = n - nDrop;
    if (nDrop === 0 || nKeep < 2) continue;
    const replay = replayIndices?.[j];
    for (let it = 0; it < iter; it++) {
      let keepIdx;
      if (replay) {
        const entry = replay[it];
        if (!entry) {
          throw new Error(
            `estimateCS: replayIndices[${j}][${it}] missing (iter=${iter})`
          );
        }
        if (entry.length !== nKeep) {
          throw new Error(
            `estimateCS: replayIndices[${j}][${it}] length ${entry.length} != nKeep ${nKeep}`
          );
        }
        keepIdx = entry;
      } else {
        keepIdx = rng.choiceWithoutReplacement(n, nKeep);
      }
      const transSub = [];
      for (const idx of keepIdx) transSub.push(trans[idx]);
      const weightsSub = computeWeightsFrom3D(transSub, modelType, modelScaling);
      const subModel = createTNA(weightsSub, model.inits, labels, null, modelType, model.scaling);
      const subCent = centralities(subModel, { measures: validMeasures, loops });
      for (const m of validMeasures) {
        const origVals = origCent.measures[m];
        const subVals = subCent.measures[m];
        if (!hasVariance(subVals)) {
          correlations[m][j][it] = Number.NaN;
          continue;
        }
        correlations[m][j][it] = centralityCorr(origVals, subVals, corrMethod);
      }
    }
  }
  return finaliseStabilityResult(
    measures,
    validMeasures,
    correlations,
    dropProps,
    threshold,
    certainty,
    corrMethod
  );
}
function estimateCsWtna(input, originalModel, options = {}) {
  const {
    measures = ["InStrength", "OutStrength", "Betweenness"],
    iter = 500,
    dropProps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    threshold = 0.7,
    certainty = 0.95,
    seed = 42,
    corrMethod = "pearson",
    loops = false,
    replayIndices
  } = options;
  const { records, codes, wtnaOpts } = input;
  const labels = codes;
  const a = codes.length;
  const modelType = input.modelType;
  const scaling = input.scaling || null;
  const actorKey = wtnaOpts.actor;
  const sessionKey = wtnaOpts.session;
  const windowSize = Math.max(1, wtnaOpts.windowSize ?? 3);
  const windowType = wtnaOpts.windowType ?? "tumbling";
  const groupMap = /* @__PURE__ */ new Map();
  for (const rec of records) {
    const actor = actorKey ? String(rec[actorKey] ?? "") : "__all__";
    if (!groupMap.has(actor)) groupMap.set(actor, []);
    groupMap.get(actor).push(rec);
  }
  const windowedGroups = [];
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
  const n = windowedGroups.length;
  const rng = new SeededRNG(seed);
  const origCent = centralities(originalModel, { measures, loops });
  const validMeasures = [];
  for (const m of measures) {
    const vals = origCent.measures[m];
    if (!vals) continue;
    if (hasVariance(vals)) validMeasures.push(m);
  }
  const correlations = {};
  for (const m of measures) {
    correlations[m] = dropProps.map(
      () => new Array(iter).fill(Number.NaN)
    );
  }
  for (let j = 0; j < dropProps.length; j++) {
    const dp = dropProps[j];
    const nDrop = Math.floor(n * dp);
    const nKeep = n - nDrop;
    if (nDrop === 0 || nKeep < 2) continue;
    const replay = replayIndices?.[j];
    for (let it = 0; it < iter; it++) {
      let keepIdx;
      if (replay) {
        const entry = replay[it];
        if (!entry) {
          throw new Error(
            `estimateCsWtna: replayIndices[${j}][${it}] missing (iter=${iter})`
          );
        }
        if (entry.length !== nKeep) {
          throw new Error(
            `estimateCsWtna: replayIndices[${j}][${it}] length ${entry.length} != nKeep ${nKeep}`
          );
        }
        keepIdx = entry;
      } else {
        keepIdx = rng.choiceWithoutReplacement(n, nKeep);
      }
      const M = Array.from({ length: a }, () => new Array(a).fill(0));
      for (const idx of keepIdx) {
        const W = windowedGroups[idx];
        const T = computeWtnaTransitions(W);
        for (let i = 0; i < a; i++) {
          for (let jj = 0; jj < a; jj++) {
            M[i][jj] += T[i]?.[jj] ?? 0;
          }
        }
      }
      let matrix = M;
      if (modelType === "tna") matrix = rowNormalizeWtna(matrix);
      const tempType = modelType === "tna" || !!scaling ? "relative" : "frequency";
      const tempOpts = { type: tempType, labels };
      if (scaling) tempOpts.scaling = scaling;
      const subModel = buildModel(matrix, tempOpts);
      const subCent = centralities(subModel, { measures: validMeasures, loops });
      for (const m of validMeasures) {
        const origVals = origCent.measures[m];
        const subVals = subCent.measures[m];
        if (!hasVariance(subVals)) {
          correlations[m][j][it] = Number.NaN;
          continue;
        }
        correlations[m][j][it] = centralityCorr(origVals, subVals, corrMethod);
      }
    }
  }
  return finaliseStabilityResult(
    measures,
    validMeasures,
    correlations,
    dropProps,
    threshold,
    certainty,
    corrMethod
  );
}
function finaliseStabilityResult(measures, validMeasures, correlations, dropProps, threshold, certainty, method) {
  const meanCorrelations = {};
  const csCoefficients = {};
  const summary = [];
  for (const m of measures) {
    const isValid = validMeasures.includes(m);
    const means = [];
    let cs = 0;
    for (let j = 0; j < dropProps.length; j++) {
      const corrs = correlations[m][j];
      const valid = corrs.filter((c) => !isNaN(c));
      const meanCor = valid.length === 0 ? Number.NaN : valid.reduce((s, v) => s + v, 0) / valid.length;
      let sdCor;
      if (valid.length < 2) {
        sdCor = Number.NaN;
      } else {
        let ss = 0;
        for (const v of valid) ss += (v - meanCor) * (v - meanCor);
        sdCor = Math.sqrt(ss / (valid.length - 1));
      }
      const propAbove = valid.length === 0 ? Number.NaN : valid.filter((c) => c >= threshold).length / valid.length;
      means.push(meanCor);
      summary.push({
        measure: m,
        dropProp: dropProps[j],
        meanCor,
        sdCor,
        propAbove
      });
      if (isValid && valid.length > 0 && propAbove >= certainty) {
        cs = dropProps[j];
      }
    }
    meanCorrelations[m] = means;
    csCoefficients[m] = isValid ? cs : 0;
  }
  return {
    csCoefficients,
    meanCorrelations,
    correlations,
    dropProps,
    threshold,
    certainty,
    summary,
    method
  };
}
function sumStatsColumn(col) {
  const valid = col.filter((v) => Number.isFinite(v));
  if (valid.length === 0) {
    return {
      mean: NaN,
      sd: NaN,
      median: NaN,
      mad: NaN,
      q025: NaN,
      q975: NaN
    };
  }
  let sum = 0;
  for (const v of valid) sum += v;
  const mean = sum / valid.length;
  let sd = NaN;
  if (valid.length >= 2) {
    let ss = 0;
    for (const v of valid) ss += (v - mean) * (v - mean);
    sd = Math.sqrt(ss / (valid.length - 1));
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const medianAt = (s) => {
    const n = s.length;
    if (n === 0) return NaN;
    const mid = Math.floor(n / 2);
    return n % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  };
  const median = medianAt(sorted);
  const deviations = valid.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = 1.4826 * medianAt(deviations);
  const quant = (p) => {
    const n = sorted.length;
    if (n === 0) return NaN;
    const h = (n - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  };
  const q025 = quant(0.025);
  const q975 = quant(0.975);
  return { mean, sd, median, mad, q025, q975 };
}
function edgeVectorCorr(a, b, method) {
  if (method === "spearman") return spearmanCorr(a, b);
  if (method === "kendall") return kendallTau(Array.from(a), Array.from(b));
  return pearsonCorr(a, b);
}
function flattenEdges(getVal, a, includeDiag) {
  if (includeDiag) {
    const vec2 = new Float64Array(a * a);
    let k2 = 0;
    for (let j = 0; j < a; j++) {
      for (let i = 0; i < a; i++) vec2[k2++] = getVal(i, j);
    }
    return vec2;
  }
  const nEdges = a * a - a;
  const vec = new Float64Array(nEdges);
  let k = 0;
  for (let j = 0; j < a; j++) {
    for (let i = 0; i < a; i++) {
      if (i === j) continue;
      vec[k++] = getVal(i, j);
    }
  }
  return vec;
}
function casedropReliability(model, options = {}) {
  const {
    iter = 500,
    dropProps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    threshold = 0.7,
    certainty = 0.95,
    method = "spearman",
    includeDiag = false,
    seed = 42,
    replayIndices
  } = options;
  if (!model.data) {
    throw new Error(
      "casedropReliability: model does not contain data. Rebuild with build_network()."
    );
  }
  if (iter < 2) throw new Error("casedropReliability: iter must be >= 2");
  for (const dp of dropProps) {
    if (!(dp > 0 && dp < 1)) {
      throw new Error("casedropReliability: every dropProp must be in (0, 1)");
    }
  }
  const labels = model.labels;
  const a = labels.length;
  const seqData = model.data;
  const n = seqData.length;
  const modelType = model.type;
  const modelScaling = model.scaling.length > 0 ? model.scaling : null;
  let maxLen = 0;
  for (const seq of seqData) if (seq.length > maxLen) maxLen = seq.length;
  const padded = seqData.map((seq) => {
    if (seq.length >= maxLen) return seq;
    const pad = new Array(maxLen - seq.length).fill(null);
    return [...seq, ...pad];
  });
  const trans = computeTransitions3D(padded, labels, modelType, model.params);
  const origEdges = flattenEdges((i, j) => model.weights.get(i, j), a, includeDiag);
  const nEdges = origEdges.length;
  const origSd = (() => {
    let sum = 0;
    for (let k = 0; k < nEdges; k++) sum += origEdges[k];
    const mean = sum / nEdges;
    let ss = 0;
    for (let k = 0; k < nEdges; k++) ss += (origEdges[k] - mean) ** 2;
    return Math.sqrt(ss / Math.max(1, nEdges - 1));
  })();
  if (origSd === 0) {
    const emptyMat = () => dropProps.map(() => new Array(iter).fill(NaN));
    return {
      cs: 0,
      summary: [],
      metrics: {
        mean_abs_dev: emptyMat(),
        median_abs_dev: emptyMat(),
        correlation: emptyMat(),
        max_abs_dev: emptyMat()
      },
      correlations: emptyMat(),
      dropProps,
      threshold,
      certainty,
      iter,
      method,
      includeDiag,
      nCases: n,
      nEdges
    };
  }
  const rng = new SeededRNG(seed);
  const nProp = dropProps.length;
  const mean_abs_dev = dropProps.map(
    () => new Array(iter).fill(NaN)
  );
  const median_abs_dev = dropProps.map(
    () => new Array(iter).fill(NaN)
  );
  const correlation = dropProps.map(
    () => new Array(iter).fill(NaN)
  );
  const max_abs_dev = dropProps.map(
    () => new Array(iter).fill(NaN)
  );
  for (let p = 0; p < nProp; p++) {
    const dp = dropProps[p];
    const nDrop = Math.floor(n * dp);
    const nKeep = n - nDrop;
    if (nDrop === 0 || nKeep >= n || nKeep < 2) continue;
    const replay = replayIndices?.[p];
    for (let it = 0; it < iter; it++) {
      let keepIdx;
      if (replay) {
        const entry = replay[it];
        if (!entry) {
          throw new Error(
            `casedropReliability: replayIndices[${p}][${it}] missing`
          );
        }
        if (entry.length !== nKeep) {
          throw new Error(
            `casedropReliability: replayIndices[${p}][${it}] length ${entry.length} != nKeep ${nKeep}`
          );
        }
        keepIdx = entry;
      } else {
        keepIdx = rng.choiceWithoutReplacement(n, nKeep);
      }
      const transSub = [];
      for (const idx of keepIdx) transSub.push(trans[idx]);
      const weightsSub = computeWeightsFrom3D(transSub, modelType, modelScaling);
      const subEdges = flattenEdges(
        (i, j) => weightsSub.get(i, j),
        a,
        includeDiag
      );
      let sumDiff = 0;
      let maxDiff = 0;
      const diffs = new Float64Array(nEdges);
      for (let k = 0; k < nEdges; k++) {
        const d = Math.abs(origEdges[k] - subEdges[k]);
        diffs[k] = d;
        sumDiff += d;
        if (d > maxDiff) maxDiff = d;
      }
      const sortedDiffs = Array.from(diffs).sort((x, y) => x - y);
      const mid = Math.floor(sortedDiffs.length / 2);
      const medianDiff = sortedDiffs.length % 2 === 0 ? (sortedDiffs[mid - 1] + sortedDiffs[mid]) / 2 : sortedDiffs[mid];
      let subSum = 0;
      for (let k = 0; k < nEdges; k++) subSum += subEdges[k];
      const subMean = subSum / nEdges;
      let subSs = 0;
      for (let k = 0; k < nEdges; k++) subSs += (subEdges[k] - subMean) ** 2;
      const subSd = Math.sqrt(subSs / Math.max(1, nEdges - 1));
      const r = subSd > 0 ? edgeVectorCorr(origEdges, subEdges, method) : NaN;
      mean_abs_dev[p][it] = sumDiff / nEdges;
      median_abs_dev[p][it] = medianDiff;
      correlation[p][it] = r;
      max_abs_dev[p][it] = maxDiff;
    }
  }
  const summary = [];
  const metricNames = [
    "mean_abs_dev",
    "median_abs_dev",
    "correlation",
    "max_abs_dev"
  ];
  const byName = {
    mean_abs_dev,
    median_abs_dev,
    correlation,
    max_abs_dev
  };
  for (const name of metricNames) {
    const mat = byName[name];
    for (let p = 0; p < nProp; p++) {
      const stats = sumStatsColumn(mat[p]);
      summary.push({
        metric: name,
        dropProp: dropProps[p],
        ...stats
      });
    }
  }
  let cs = 0;
  for (let p = 0; p < nProp; p++) {
    const col = correlation[p];
    const valid = col.filter((v) => !Number.isNaN(v));
    if (valid.length === 0) continue;
    const propAbove = valid.filter((c) => c >= threshold).length / valid.length;
    if (propAbove >= certainty) cs = dropProps[p];
  }
  return {
    cs,
    summary,
    metrics: { mean_abs_dev, median_abs_dev, correlation, max_abs_dev },
    correlations: correlation,
    dropProps,
    threshold,
    certainty,
    iter,
    method,
    includeDiag,
    nCases: n,
    nEdges
  };
}
function estimateEdgeStability(model, options = {}) {
  const {
    iter = 500,
    dropProps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    threshold = 0.7,
    certainty = 0.95,
    seed = 42,
    corrMethod = "pearson"
  } = options;
  const method = corrMethod === "kendall" ? "kendall" : corrMethod === "spearman" ? "spearman" : "pearson";
  const full = casedropReliability(model, {
    iter,
    dropProps,
    threshold,
    certainty,
    method,
    includeDiag: true,
    seed
  });
  const meanCorrelations = full.summary.filter((r) => r.metric === "correlation").map((r) => r.mean);
  return {
    meanCorrelations,
    csCoefficient: full.cs,
    dropProps,
    threshold,
    certainty
  };
}
function estimateNetworkStability(model, options = {}) {
  const {
    iter = 500,
    dropProps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    threshold = 0.7,
    certainty = 0.95,
    seed = 42
  } = options;
  if (!model.data) {
    throw new Error("TNA model must have sequence data for network stability");
  }
  const labels = model.labels;
  const a = labels.length;
  const seqData = model.data;
  const n = seqData.length;
  const modelType = model.type;
  const modelScaling = model.scaling.length > 0 ? model.scaling : null;
  const rng = new SeededRNG(seed);
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
  const origDensity = computeDensity(model.weights, a);
  const origMeanWeight = computeMeanWeight(model.weights, a);
  const densityDiffs = dropProps.map(() => []);
  const meanWeightDiffs = dropProps.map(() => []);
  for (let dp = 0; dp < dropProps.length; dp++) {
    const nDrop = Math.floor(n * dropProps[dp]);
    const nKeep = n - nDrop;
    if (nDrop === 0 || nKeep < 2) continue;
    for (let it = 0; it < iter; it++) {
      const keepIdx = rng.choiceWithoutReplacement(n, nKeep);
      const transSub = [];
      for (const idx of keepIdx) transSub.push(trans[idx]);
      const weightsSub = computeWeightsFrom3D(transSub, modelType, modelScaling);
      const subDensity = computeDensity(weightsSub, a);
      const subMeanWeight = computeMeanWeight(weightsSub, a);
      densityDiffs[dp].push(Math.abs(subDensity - origDensity));
      meanWeightDiffs[dp].push(Math.abs(subMeanWeight - origMeanWeight));
    }
  }
  const densityCorrelations = [];
  const meanWeightCorrelations = [];
  let densityCS = 0;
  let meanWeightCS = 0;
  for (let dp = 0; dp < dropProps.length; dp++) {
    const dDiffs = densityDiffs[dp];
    const mDiffs = meanWeightDiffs[dp];
    if (dDiffs.length === 0) {
      densityCorrelations.push(NaN);
      meanWeightCorrelations.push(NaN);
      continue;
    }
    const dMean = dDiffs.reduce((s, v) => s + v, 0) / dDiffs.length;
    const mMean = mDiffs.reduce((s, v) => s + v, 0) / mDiffs.length;
    const dStability = origDensity > 0 ? 1 - dMean / origDensity : 1;
    const mStability = origMeanWeight > 0 ? 1 - mMean / origMeanWeight : 1;
    densityCorrelations.push(Math.max(0, dStability));
    meanWeightCorrelations.push(Math.max(0, mStability));
    if (Math.max(0, dStability) >= threshold) {
      const aboveThreshold = dDiffs.filter(
        (d) => origDensity > 0 ? 1 - d / origDensity >= threshold : true
      ).length / dDiffs.length;
      if (aboveThreshold >= certainty) densityCS = dropProps[dp];
    }
    if (Math.max(0, mStability) >= threshold) {
      const aboveThreshold = mDiffs.filter(
        (d) => origMeanWeight > 0 ? 1 - d / origMeanWeight >= threshold : true
      ).length / mDiffs.length;
      if (aboveThreshold >= certainty) meanWeightCS = dropProps[dp];
    }
  }
  return {
    densityCorrelations,
    meanWeightCorrelations,
    densityCS,
    meanWeightCS,
    dropProps,
    threshold,
    certainty
  };
}
function computeDensity(weights, a) {
  let nonZero = 0;
  const maxEdges = a * (a - 1);
  if (maxEdges === 0) return 0;
  for (let i = 0; i < a; i++) {
    for (let j = 0; j < a; j++) {
      if (i !== j && weights.get(i, j) > 0) nonZero++;
    }
  }
  return nonZero / maxEdges;
}
function computeMeanWeight(weights, a) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a; i++) {
    for (let j = 0; j < a; j++) {
      if (i !== j) {
        const w = weights.get(i, j);
        if (w > 0) {
          sum += w;
          count++;
        }
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

// src/analysis/simulate.ts
function simulate(model, options = {}) {
  const { n = 50, seqLength = 20, seed = 42 } = options;
  const rng = new SeededRNG(seed);
  const labels = model.labels;
  const a = labels.length;
  if (a === 0) return [];
  const [minLen, maxLen] = typeof seqLength === "number" ? [seqLength, seqLength] : seqLength;
  const initsCum = buildCumulative(model.inits, a);
  const weightsCum = [];
  for (let i = 0; i < a; i++) {
    const row = new Float64Array(a);
    for (let j = 0; j < a; j++) row[j] = model.weights.get(i, j);
    weightsCum.push(buildCumulative(row, a));
  }
  const result = [];
  for (let s = 0; s < n; s++) {
    const len = minLen === maxLen ? minLen : minLen + Math.floor(rng.random() * (maxLen - minLen + 1));
    const seq = [];
    let state = sampleCumulative(initsCum, rng);
    for (let t = 0; t < len; t++) {
      seq.push(labels[state]);
      state = sampleCumulative(weightsCum[state], rng);
    }
    result.push(seq);
  }
  return result;
}
function buildCumulative(probs, n) {
  const cum = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += probs[i];
    cum[i] = sum;
  }
  if (sum > 0) {
    for (let i = 0; i < n; i++) cum[i] /= sum;
  }
  return cum;
}
function sampleCumulative(cum, rng) {
  const u = rng.random();
  for (let i = 0; i < cum.length; i++) {
    if (u < cum[i]) return i;
  }
  return cum.length - 1;
}

// src/analysis/dfg.ts
function buildDFG(model, options) {
  if (isGroupTNA(model)) {
    const result = {};
    for (const [name, m] of groupEntries(model)) {
      result[name] = buildDFG(m, options);
    }
    return result;
  }
  const tna = model;
  const startLabel = options?.startLabel;
  const endLabel = options?.endLabel;
  if (tna.data && tna.data.length > 0) {
    return buildDFGFromSequences(tna.data, tna.labels, startLabel, endLabel);
  }
  return buildDFGFromMatrix(tna, startLabel, endLabel);
}
function buildDFGFromSequences(sequences, labels, startLabel, endLabel) {
  const totalSeq = sequences.length;
  const absFreq = /* @__PURE__ */ new Map();
  const casePresence = /* @__PURE__ */ new Map();
  for (const seq of sequences) {
    const seen = /* @__PURE__ */ new Set();
    for (const s of seq) {
      if (s === null) continue;
      absFreq.set(s, (absFreq.get(s) ?? 0) + 1);
      seen.add(s);
    }
    for (const s of seen) casePresence.set(s, (casePresence.get(s) ?? 0) + 1);
  }
  const totalOcc = [...absFreq.values()].reduce((a, b) => a + b, 0);
  const transMap = /* @__PURE__ */ new Map();
  const caseTrans = /* @__PURE__ */ new Map();
  let totalTrans = 0;
  for (const seq of sequences) {
    const seenT = /* @__PURE__ */ new Set();
    for (let i = 0; i < seq.length - 1; i++) {
      const from = seq[i], to = seq[i + 1];
      if (from === null || to === null) continue;
      const key = `${from}\0${to}`;
      transMap.set(key, (transMap.get(key) ?? 0) + 1);
      totalTrans++;
      seenT.add(key);
    }
    for (const k of seenT) caseTrans.set(k, (caseTrans.get(k) ?? 0) + 1);
  }
  const allLabels = labels ?? [...absFreq.keys()].sort();
  const nodes = allLabels.filter((id) => absFreq.has(id)).map((id) => ({
    id,
    type: id === startLabel ? "start" : id === endLabel ? "end" : "activity",
    absoluteFreq: absFreq.get(id),
    relativeFreq: totalOcc > 0 ? absFreq.get(id) / totalOcc : 0,
    caseFreq: totalSeq > 0 ? (casePresence.get(id) ?? 0) / totalSeq : 0
  }));
  const edges = [];
  for (const [key, count] of transMap) {
    const sep = key.indexOf("\0");
    const from = key.slice(0, sep);
    const to = key.slice(sep + 1);
    edges.push({
      from,
      to,
      absoluteCount: count,
      relativeCount: totalTrans > 0 ? count / totalTrans : 0,
      caseCount: totalSeq > 0 ? (caseTrans.get(key) ?? 0) / totalSeq : 0
    });
  }
  return { nodes, edges, totalSequences: totalSeq, totalTransitions: totalTrans };
}
function buildDFGFromMatrix(tna, startLabel, endLabel) {
  const n = tna.labels.length;
  const w = tna.weights;
  const isFreq = tna.type === "frequency";
  let totalWeight = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      totalWeight += w.get(i, j);
    }
  }
  const rowSums = w.rowSums();
  const colSums = w.colSums();
  const totalNodeWeight = [...rowSums].reduce((a, b) => a + b, 0);
  const nodes = tna.labels.map((id, i) => ({
    id,
    type: id === startLabel ? "start" : id === endLabel ? "end" : "activity",
    absoluteFreq: isFreq ? Math.round(rowSums[i] + colSums[i]) : rowSums[i] + colSums[i],
    relativeFreq: totalNodeWeight > 0 ? (rowSums[i] + colSums[i]) / (2 * totalNodeWeight) : 0,
    caseFreq: 0
    // Cannot compute without sequences
  }));
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const val = w.get(i, j);
      if (val > 0) {
        edges.push({
          from: tna.labels[i],
          to: tna.labels[j],
          absoluteCount: isFreq ? Math.round(val) : val,
          relativeCount: totalWeight > 0 ? val / totalWeight : 0,
          caseCount: 0
          // Cannot compute without sequences
        });
      }
    }
  }
  return { nodes, edges, totalSequences: 0, totalTransitions: isFreq ? Math.round(totalWeight) : totalWeight };
}

// src/analysis/markov.ts
function extractP(x) {
  if (x instanceof Matrix) {
    if (!x.isSquare) {
      throw new Error("passageTime: transition matrix must be square");
    }
    const n = x.rows;
    const labels2 = Array.from({ length: n }, (_, i) => `S${i + 1}`);
    return { P: x.clone(), labels: labels2 };
  }
  if (Array.isArray(x)) {
    if (x.length === 0) {
      throw new Error("passageTime: empty matrix input");
    }
    const mat = Matrix.from2D(x);
    if (!mat.isSquare) {
      throw new Error("passageTime: transition matrix must be square");
    }
    const n = mat.rows;
    const labels2 = Array.from({ length: n }, (_, i) => `S${i + 1}`);
    return { P: mat, labels: labels2 };
  }
  const model = x;
  if (!model.weights || !(model.weights instanceof Matrix)) {
    throw new Error(
      "passageTime: TNA has no numeric weight matrix. Model does not contain data. Rebuild with buildTna()."
    );
  }
  const labels = model.labels && model.labels.length === model.weights.rows ? model.labels.slice() : Array.from({ length: model.weights.rows }, (_, i) => `S${i + 1}`);
  return { P: model.weights.clone(), labels };
}
function normaliseRows(P, labels, normalize) {
  const n = P.rows;
  const rowSums = P.rowSums();
  const zeroStates = [];
  for (let i = 0; i < n; i++) {
    if (rowSums[i] <= 0) zeroStates.push(labels[i]);
  }
  if (zeroStates.length > 0) {
    throw new Error(
      `Transition matrix has zero-sum row(s) for state(s): ${zeroStates.join(", ")}. These states have no outgoing transitions, so the chain is not ergodic and mean first passage times are undefined. Remove the state(s) or supply a different transition matrix.`
    );
  }
  let needsNorm = false;
  for (let i = 0; i < n; i++) {
    if (Math.abs(rowSums[i] - 1) > 1e-6) {
      needsNorm = true;
      break;
    }
  }
  if (!needsNorm) return P;
  if (!normalize) {
    throw new Error("Transition matrix rows must sum to 1.");
  }
  const out = new Matrix(n, n);
  for (let i = 0; i < n; i++) {
    const s = rowSums[i];
    for (let j = 0; j < n; j++) {
      out.set(i, j, P.get(i, j) / s);
    }
  }
  return out;
}
function kemenySnellMfpt(P, pi) {
  const n = P.rows;
  const A = new Matrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const ident = i === j ? 1 : 0;
      A.set(i, j, ident - P.get(i, j) + pi[j]);
    }
  }
  const I = Matrix.eye(n);
  let Z2;
  try {
    Z2 = solveLinear(A, I);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Kemeny-Snell fundamental matrix is singular; chain is likely not ergodic (${msg}).`
    );
  }
  const M = new Matrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        M.set(i, j, 1 / pi[i]);
      } else {
        M.set(i, j, (Z2.get(j, j) - Z2.get(i, j)) / pi[j]);
      }
    }
  }
  return M;
}
function passageTime(x, options = {}) {
  const { normalize = true, states: stateSubset } = options;
  const { P: rawP, labels } = extractP(x);
  const P = normaliseRows(rawP, labels, normalize);
  const n = P.rows;
  let pi = eigenDominantLeft(P);
  let anyNonPositive = false;
  for (let i = 0; i < n; i++) {
    if (pi[i] <= 0) {
      anyNonPositive = true;
      break;
    }
  }
  if (anyNonPositive) {
    const EPS = Number.EPSILON;
    let sum = 0;
    const fixed = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      fixed[i] = Math.max(pi[i], EPS);
      sum += fixed[i];
    }
    for (let i = 0; i < n; i++) fixed[i] /= sum;
    pi = fixed;
  }
  const M = kemenySnellMfpt(P, pi);
  const persistence = new Float64Array(n);
  for (let i = 0; i < n; i++) persistence[i] = P.get(i, i);
  if (stateSubset && stateSubset.length > 0) {
    const unknown = stateSubset.filter((s) => !labels.includes(s));
    if (unknown.length > 0) {
      throw new Error(`Unknown states: ${unknown.join(", ")}`);
    }
    const idx = stateSubset.map((s) => labels.indexOf(s));
    const Msub = M.subMatrix(idx, idx);
    const piSub = new Float64Array(idx.length);
    const persSub = new Float64Array(idx.length);
    for (let k = 0; k < idx.length; k++) {
      piSub[k] = pi[idx[k]];
      persSub[k] = persistence[idx[k]];
    }
    return {
      matrix: Msub,
      stationary: piSub,
      persistence: persSub,
      states: stateSubset.slice()
    };
  }
  return {
    matrix: M,
    stationary: pi,
    persistence,
    states: labels
  };
}
function markovStability(x, options = {}) {
  const { normalize = true } = options;
  const { P: rawP, labels } = extractP(x);
  const P = normaliseRows(rawP, labels, normalize);
  const mpt = passageTime(P, { normalize: false });
  const n = P.rows;
  const pi = mpt.stationary;
  const M = mpt.matrix;
  const EPS = Number.EPSILON;
  const stability = [];
  for (let i = 0; i < n; i++) {
    const persistence = P.get(i, i);
    const sojourn = persistence >= 1 - EPS ? Number.POSITIVE_INFINITY : 1 / (1 - persistence);
    let sumTo = 0;
    let sumFrom = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      sumTo += M.get(i, j);
      sumFrom += M.get(j, i);
    }
    const denom = n - 1;
    const avgTo = denom > 0 ? sumTo / denom : Number.NaN;
    const avgFrom = denom > 0 ? sumFrom / denom : Number.NaN;
    stability.push({
      state: labels[i],
      persistence,
      stationaryProb: pi[i],
      returnTime: 1 / pi[i],
      sojournTime: sojourn,
      avgTimeToOthers: avgTo,
      avgTimeFromOthers: avgFrom
    });
  }
  return { stability, mpt };
}
var HON_SEP = "";
var LOG_EPS_R = Math.log(2220446049250313e-31);
function extractTrajectories(data) {
  if (data !== null && typeof data === "object" && !Array.isArray(data) && "weights" in data) {
    const model = data;
    if (!model.data) {
      throw new Error(
        "markovOrderTest: TNA model does not contain data. Rebuild with buildTna()."
      );
    }
    return sequenceDataToTrajectories(model.data);
  }
  if (!Array.isArray(data)) {
    throw new Error("markovOrderTest: data must be an array of trajectories");
  }
  return sequenceDataToTrajectories(data);
}
function sequenceDataToTrajectories(data) {
  const out = [];
  for (const rawSeq of data) {
    if (!Array.isArray(rawSeq)) continue;
    let lastNonNull = -1;
    for (let i = 0; i < rawSeq.length; i++) {
      const v = rawSeq[i];
      if (v !== null && v !== void 0 && (typeof v !== "number" || !Number.isNaN(v))) {
        lastNonNull = i;
      }
    }
    if (lastNonNull < 0) continue;
    const traj = [];
    for (let i = 0; i <= lastNonNull; i++) {
      const v = rawSeq[i];
      if (v === null || v === void 0) continue;
      traj.push(String(v));
    }
    if (traj.length >= 2) out.push(traj);
  }
  return out;
}
function kgramCounts(trajectories, k) {
  if (k < 1) throw new Error("kgramCounts: k must be >= 1");
  const nodeCounts = /* @__PURE__ */ new Map();
  const edgeCounts = /* @__PURE__ */ new Map();
  const EDGE_SEP = "";
  for (const traj of trajectories) {
    const n = traj.length;
    if (n < k) continue;
    const kgrams = [];
    for (let i = 0; i + k <= n; i++) {
      const kg = traj.slice(i, i + k).join(HON_SEP);
      kgrams.push(kg);
      nodeCounts.set(kg, (nodeCounts.get(kg) ?? 0) + 1);
    }
    for (let i = 0; i + 1 < kgrams.length; i++) {
      const key = `${kgrams[i]}${EDGE_SEP}${kgrams[i + 1]}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  const nodes = Array.from(nodeCounts.keys()).sort();
  const edges = [];
  for (const [key, weight] of edgeCounts) {
    const sepIdx = key.indexOf(EDGE_SEP);
    edges.push({
      from: key.slice(0, sepIdx),
      to: key.slice(sepIdx + 1),
      weight
    });
  }
  return { nodes, nodeCounts, edges };
}
var KGRAM_MATRIX_MAX_N = 5800;
function transitionMatrixFromKgrams(nodes, edges) {
  const n = nodes.length;
  if (n > KGRAM_MATRIX_MAX_N) {
    const mb = Math.round(n * n * 8 / (1024 * 1024));
    throw new Error(
      `transitionMatrixFromKgrams: ${n} distinct k-grams would need a ${n}\xD7${n} matrix (~${mb} MB). This usually means maxOrder is too high for the dataset. Try lowering maxOrder, or pruning rare contexts before testing.`
    );
  }
  const mat = new Matrix(n, n);
  if (n === 0) return mat;
  const idx = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) idx.set(nodes[i], i);
  for (const e of edges) {
    const r = idx.get(e.from);
    const c = idx.get(e.to);
    if (r === void 0 || c === void 0) continue;
    mat.set(r, c, mat.get(r, c) + e.weight);
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += mat.get(i, j);
    if (s > 0) {
      for (let j = 0; j < n; j++) mat.set(i, j, mat.get(i, j) / s);
    }
  }
  return mat;
}
function layerDof(mat) {
  let dof = 0;
  for (let i = 0; i < mat.rows; i++) {
    let nz = 0;
    for (let j = 0; j < mat.cols; j++) {
      if (mat.get(i, j) > 0) nz++;
    }
    dof += Math.max(nz - 1, 0);
  }
  return dof;
}
function marginalDistribution(trajectories) {
  const counts = /* @__PURE__ */ new Map();
  let total = 0;
  for (const t of trajectories) {
    for (const s of t) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
      total++;
    }
  }
  const states = Array.from(counts.keys()).sort();
  const probs = new Float64Array(states.length);
  for (let i = 0; i < states.length; i++) {
    probs[i] = (counts.get(states[i]) ?? 0) / total;
  }
  return { states, probs };
}
function logLikelihood(trajectories, k, transMats, transNodes) {
  const p0Nodes = transNodes[0];
  const p0 = transMats[0];
  const p0Idx = /* @__PURE__ */ new Map();
  for (let i = 0; i < p0Nodes.length; i++) p0Idx.set(p0Nodes[i], i);
  const rowIdx = [/* @__PURE__ */ new Map()];
  const colIdx = [/* @__PURE__ */ new Map()];
  for (let ord = 1; ord <= k; ord++) {
    const nodes = transNodes[ord];
    const mR = /* @__PURE__ */ new Map();
    const mC = /* @__PURE__ */ new Map();
    for (let i = 0; i < nodes.length; i++) {
      mR.set(nodes[i], i);
      mC.set(nodes[i], i);
    }
    rowIdx.push(mR);
    colIdx.push(mC);
  }
  let total = 0;
  for (const traj of trajectories) {
    const n = traj.length;
    if (n === 0) continue;
    const firstState = traj[0];
    const fi = p0Idx.get(firstState);
    let ll;
    if (fi !== void 0 && p0.get(0, fi) > 0) {
      ll = Math.log(p0.get(0, fi));
    } else {
      ll = LOG_EPS_R;
    }
    if (n < 2) {
      total += ll;
      continue;
    }
    for (let step = 2; step <= n; step++) {
      const orderUsed = Math.min(step - 1, k);
      if (orderUsed === 0) {
        const s = traj[step - 1];
        const si = p0Idx.get(s);
        if (si !== void 0 && p0.get(0, si) > 0) {
          ll += Math.log(p0.get(0, si));
        } else {
          ll += LOG_EPS_R;
        }
      } else {
        const srcStart = step - orderUsed;
        const srcKey = traj.slice(srcStart - 1, step - 1).join(HON_SEP);
        const tgtKey = traj.slice(srcStart, step).join(HON_SEP);
        const tm = transMats[orderUsed];
        const r = rowIdx[orderUsed].get(srcKey);
        const c = colIdx[orderUsed].get(tgtKey);
        if (r !== void 0 && c !== void 0) {
          const p = tm.get(r, c);
          ll += p > 0 ? Math.log(p) : LOG_EPS_R;
        } else {
          ll += LOG_EPS_R;
        }
      }
    }
    total += ll;
  }
  return total;
}
function extractTuples(trajectories, k) {
  if (k < 1) throw new Error("extractTuples: k must be >= 1");
  const x = [];
  const w = [];
  const s = [];
  for (const traj of trajectories) {
    const n = traj.length;
    if (n < k + 1) continue;
    const lastPos = n - k;
    for (let p = 1; p <= lastPos; p++) {
      x.push(traj[p - 1]);
      s.push(traj[p - 1 + k]);
      if (k === 1) {
        w.push("");
      } else {
        const start0 = p;
        const end0 = p + k - 1;
        w.push(traj.slice(start0, end0).join(HON_SEP));
      }
    }
  }
  const byContext = /* @__PURE__ */ new Map();
  for (let i = 0; i < w.length; i++) {
    const key = w[i];
    const arr = byContext.get(key);
    if (arr) arr.push(i);
    else byContext.set(key, [i]);
  }
  return { x, w, s, byContext };
}
function g2OneContext(xVec, sVec) {
  if (xVec.length === 0) return { stat: 0, df: 0 };
  const rowSet = /* @__PURE__ */ new Set();
  const colSet = /* @__PURE__ */ new Set();
  for (const v of xVec) rowSet.add(v);
  for (const v of sVec) colSet.add(v);
  const rowLabels = Array.from(rowSet).sort();
  const colLabels = Array.from(colSet).sort();
  const rowIdx = /* @__PURE__ */ new Map();
  const colIdx = /* @__PURE__ */ new Map();
  for (let i = 0; i < rowLabels.length; i++) rowIdx.set(rowLabels[i], i);
  for (let i = 0; i < colLabels.length; i++) colIdx.set(colLabels[i], i);
  const nR = rowLabels.length;
  const nC = colLabels.length;
  if (nR < 2 || nC < 2) return { stat: 0, df: 0 };
  const tab = new Array(nR * nC).fill(0);
  for (let i = 0; i < xVec.length; i++) {
    const r = rowIdx.get(xVec[i]);
    const c = colIdx.get(sVec[i]);
    tab[r * nC + c]++;
  }
  const rs = new Array(nR).fill(0);
  const cs = new Array(nC).fill(0);
  let total = 0;
  for (let r = 0; r < nR; r++) {
    for (let c = 0; c < nC; c++) {
      const v = tab[r * nC + c];
      rs[r] += v;
      cs[c] += v;
      total += v;
    }
  }
  if (total === 0) return { stat: 0, df: 0 };
  let sumTerms = 0;
  for (let c = 0; c < nC; c++) {
    for (let r = 0; r < nR; r++) {
      const v = tab[r * nC + c];
      if (v <= 0) continue;
      const e = rs[r] * cs[c] / total;
      if (e <= 0) continue;
      sumTerms += v * Math.log(v / e);
    }
  }
  const g2 = 2 * sumTerms;
  const df = (nR - 1) * (nC - 1);
  return { stat: g2, df };
}
function g2Statistic(tuples) {
  if (tuples.x.length === 0) return { stat: 0, df: 0 };
  let totalStat = 0;
  let totalDf = 0;
  for (const [, idxList] of tuples.byContext) {
    const xSub = new Array(idxList.length);
    const sSub = new Array(idxList.length);
    for (let i = 0; i < idxList.length; i++) {
      const ti = idxList[i];
      xSub[i] = tuples.x[ti];
      sSub[i] = tuples.s[ti];
    }
    const { stat, df } = g2OneContext(xSub, sSub);
    totalStat += stat;
    totalDf += df;
  }
  return { stat: totalStat, df: totalDf };
}
function withinWPermutation(tuples, nPerm, rng, replayFlatIndices) {
  if (tuples.x.length === 0) return [];
  const nT = tuples.s.length;
  const sOrig = tuples.s.slice();
  const out = new Array(nPerm);
  const sBuf = new Array(nT);
  for (let p = 0; p < nPerm; p++) {
    for (let i = 0; i < nT; i++) sBuf[i] = sOrig[i];
    if (replayFlatIndices && replayFlatIndices[p]) {
      const map = replayFlatIndices[p];
      for (let i = 0; i < nT; i++) {
        sBuf[i] = sOrig[map[i]];
      }
    } else {
      for (const [, idxList] of tuples.byContext) {
        if (idxList.length <= 1) continue;
        const pick = idxList.slice();
        for (let k = pick.length - 1; k > 0; k--) {
          const j = Math.floor(rng.random() * (k + 1));
          const tmp = pick[k];
          pick[k] = pick[j];
          pick[j] = tmp;
        }
        for (let i = 0; i < idxList.length; i++) {
          sBuf[idxList[i]] = sOrig[pick[i]];
        }
      }
    }
    let totalStat = 0;
    for (const [, idxList] of tuples.byContext) {
      const xSub = new Array(idxList.length);
      const sSub = new Array(idxList.length);
      for (let i = 0; i < idxList.length; i++) {
        const ti = idxList[i];
        xSub[i] = tuples.x[ti];
        sSub[i] = sBuf[ti];
      }
      totalStat += g2OneContext(xSub, sSub).stat;
    }
    out[p] = totalStat;
  }
  return out;
}
function logGamma(x) {
  const g = 7;
  const c = [
    0.9999999999998099,
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9984369578019572e-21,
    15056327351493116e-23
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function regIncGammaUpper(a, x) {
  if (x < 0 || a <= 0) return Number.NaN;
  if (x === 0) return 1;
  if (x < a + 1) {
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 1e3; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
    }
    const P = sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
    return 1 - P;
  } else {
    const FPMIN = 1e-300;
    let b = x + 1 - a;
    let c = 1 / FPMIN;
    let d = 1 / b;
    let h = d;
    for (let n = 1; n < 1e3; n++) {
      const an = -n * (n - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < 1e-16) break;
    }
    return h * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
}
function pchisqUpper(q, df) {
  if (!Number.isFinite(q) || q < 0 || df <= 0) return Number.NaN;
  if (q === 0) return 1;
  return regIncGammaUpper(df / 2, q / 2);
}
function markovOrderTest(data, options = {}) {
  const {
    maxOrder: maxOrderReq = 3,
    nPerm = 500,
    alpha = 0.05,
    seed,
    replay
  } = options;
  if (maxOrderReq < 1) throw new Error("'maxOrder' must be >= 1");
  if (nPerm < 1) throw new Error("'nPerm' must be >= 1");
  if (!(alpha > 0 && alpha < 1)) throw new Error("'alpha' must be in (0, 1)");
  const trajectories = extractTrajectories(data);
  const nSeqs = trajectories.length;
  if (nSeqs < 1) {
    const raw = Array.isArray(data) ? data : [];
    let nInput = raw.length;
    let nLen1 = 0;
    let nLen0 = 0;
    if (Array.isArray(raw)) {
      for (const s of raw) {
        if (!Array.isArray(s)) continue;
        const len = s.filter((v) => v !== null && v !== void 0 && v !== "").length;
        if (len === 0) nLen0++;
        else if (len === 1) nLen1++;
      }
    }
    throw new Error(
      `markovOrderTest: 0 usable sequences (transitions need length >= 2). Input had ${nInput} sequences (${nLen0} empty, ${nLen1} singletons). Rebuild with a larger gap, or pick a Session column that produces multi-step sessions.`
    );
  }
  const seqLens = trajectories.map((t) => t.length);
  const longest = Math.max(...seqLens);
  let maxOrder = Math.trunc(maxOrderReq);
  if (maxOrder >= longest) {
    maxOrder = longest - 1;
    console.warn(
      `max_order capped at ${maxOrder} (longest sequence = ${longest})`
    );
  }
  const { states, probs: marginalProbs } = marginalDistribution(trajectories);
  const p0Mat = new Matrix(1, states.length);
  for (let i = 0; i < states.length; i++) p0Mat.set(0, i, marginalProbs[i]);
  const transMats = [p0Mat];
  const transNodes = [states.slice()];
  const layerDofs = [Math.max(states.length - 1, 0)];
  for (let k = 1; k <= maxOrder; k++) {
    const kg = kgramCounts(trajectories, k);
    const tm = transitionMatrixFromKgrams(kg.nodes, kg.edges);
    transMats.push(tm);
    transNodes.push(kg.nodes.slice());
    layerDofs.push(layerDof(tm));
  }
  const logliks = [];
  for (let k = 0; k <= maxOrder; k++) {
    logliks.push(
      logLikelihood(
        trajectories,
        k,
        transMats.slice(0, k + 1),
        transNodes.slice(0, k + 1)
      )
    );
  }
  const rng = new SeededRNG(seed ?? 42);
  const perOrder = [];
  for (let k = 1; k <= maxOrder; k++) {
    const tuples = extractTuples(trajectories, k);
    const g2 = g2Statistic(tuples);
    let nullStats = [];
    let pPerm = Number.NaN;
    let pAsymp = Number.NaN;
    if (tuples.x.length > 0 && g2.df > 0) {
      const replayBlock = replay && replay.permIndices ? replay.permIndices[k - 1] : void 0;
      nullStats = withinWPermutation(tuples, nPerm, rng, replayBlock);
      let geCount = 0;
      for (const ns of nullStats) {
        if (ns >= g2.stat) geCount++;
      }
      pPerm = (geCount + 1) / (nullStats.length + 1);
      pAsymp = pchisqUpper(g2.stat, g2.df);
    }
    perOrder.push({
      stat: g2.stat,
      df: g2.df,
      null: nullStats,
      pPerm,
      pAsymp,
      nTuples: tuples.x.length
    });
  }
  const sigVec = perOrder.map(
    (po) => !Number.isNaN(po.pPerm) && po.pPerm < alpha
  );
  let optimalOrder = 0;
  let cont = true;
  for (let k = 1; k <= maxOrder; k++) {
    if (cont && sigVec[k - 1]) optimalOrder = k;
    else cont = false;
  }
  const cumDof = [];
  let acc = 0;
  for (const d of layerDofs) {
    acc += d;
    cumDof.push(acc);
  }
  const nObs = seqLens.reduce((a, b) => a + b, 0);
  const aicVec = logliks.map((ll, k) => 2 * cumDof[k] - 2 * ll);
  const bicVec = logliks.map((ll, k) => Math.log(nObs) * cumDof[k] - 2 * ll);
  const testTable = [];
  for (let k = 0; k <= maxOrder; k++) {
    if (k === 0) {
      testTable.push({
        order: 0,
        loglik: logliks[0],
        AIC: aicVec[0],
        BIC: bicVec[0],
        df: Number.NaN,
        g2: Number.NaN,
        pPermutation: Number.NaN,
        pAsymptotic: Number.NaN,
        significant: false
      });
    } else {
      const po = perOrder[k - 1];
      testTable.push({
        order: k,
        loglik: logliks[k],
        AIC: aicVec[k],
        BIC: bicVec[k],
        df: po.df,
        g2: po.stat,
        pPermutation: po.pPerm,
        pAsymptotic: po.pAsymp,
        significant: sigVec[k - 1]
      });
    }
  }
  let bicOrder = 0;
  let aicOrder = 0;
  for (let k = 1; k <= maxOrder; k++) {
    if (testTable[k].BIC < testTable[bicOrder].BIC) bicOrder = k;
    if (testTable[k].AIC < testTable[aicOrder].AIC) aicOrder = k;
  }
  return {
    optimalOrder,
    bicOrder,
    aicOrder,
    testTable,
    permutationNull: perOrder.map((po) => po.null),
    logliks,
    layerDofs,
    transitionMatrices: transMats,
    transitionNodes: transNodes,
    states,
    marginal: marginalProbs,
    nSequences: nSeqs,
    nObservations: nObs,
    nTuples: perOrder.map((po) => po.nTuples),
    nPerm,
    alpha,
    maxOrder
  };
}

// src/analysis/mogen.ts
var HON_SEP2 = "";
function inputToTrajectories(data) {
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
    const out = [];
    for (const row of data) {
      const cleaned = [];
      for (const v of row) if (v !== null && v !== void 0) cleaned.push(v);
      if (cleaned.length >= 2) out.push(cleaned);
    }
    return out;
  }
  return extractTrajectories(data);
}
function roundR(x, digits) {
  if (!Number.isFinite(x)) return x;
  const m = Math.pow(10, digits);
  const v = x * m;
  const r = Math.round(v);
  if (Math.abs(v - Math.trunc(v) - 0.5) < 1e-9) {
    const t = Math.trunc(v);
    const evenAdj = t % 2 === 0 ? t : t + Math.sign(v);
    return evenAdj / m;
  }
  return r / m;
}
function buildMogen(data, options = {}) {
  const { criterion = "aic", lrtAlpha = 0.01 } = options;
  let maxOrder = options.maxOrder ?? 5;
  if (!(lrtAlpha > 0 && lrtAlpha < 1)) {
    throw new Error("'lrtAlpha' must be in (0, 1)");
  }
  if (!(maxOrder >= 1)) throw new Error("'maxOrder' must be >= 1");
  const trajectories = inputToTrajectories(data);
  if (trajectories.length === 0) {
    throw new Error("No valid trajectories (each must have at least 2 states)");
  }
  const maxPathLen = trajectories.reduce((m, t) => Math.max(m, t.length), 0);
  if (maxOrder >= maxPathLen) maxOrder = maxPathLen - 1;
  const nObs = trajectories.reduce((s, t) => s + t.length, 0);
  const { states, probs } = marginalDistribution(trajectories);
  const p0Mat = new Matrix(1, states.length);
  for (let i = 0; i < states.length; i++) p0Mat.set(0, i, probs[i]);
  const transMats = new Array(maxOrder + 1);
  const countMats = new Array(maxOrder + 1);
  const transNodes = new Array(maxOrder + 1);
  const layerDofs = new Array(maxOrder + 1).fill(0);
  transMats[0] = p0Mat;
  countMats[0] = new Matrix(0, 0);
  transNodes[0] = states;
  layerDofs[0] = states.length - 1;
  for (let k = 1; k <= maxOrder; k++) {
    const kg = kgramCounts(trajectories, k);
    const tm = transitionMatrixFromKgrams(kg.nodes, kg.edges);
    const n = kg.nodes.length;
    const cm = new Matrix(n, n);
    const idx = /* @__PURE__ */ new Map();
    for (let i = 0; i < n; i++) idx.set(kg.nodes[i], i);
    for (const e of kg.edges) {
      const r = idx.get(e.from);
      const c = idx.get(e.to);
      if (r !== void 0 && c !== void 0) cm.set(r, c, e.weight);
    }
    transMats[k] = tm;
    countMats[k] = cm;
    transNodes[k] = kg.nodes;
    layerDofs[k] = layerDof(tm);
  }
  const cumDofs = new Array(maxOrder + 1);
  let acc = 0;
  for (let k = 0; k <= maxOrder; k++) {
    acc += layerDofs[k];
    cumDofs[k] = acc;
  }
  const logliks = new Array(maxOrder + 1);
  for (let k = 0; k <= maxOrder; k++) {
    logliks[k] = logLikelihood(
      trajectories,
      k,
      transMats.slice(0, k + 1),
      transNodes.slice(0, k + 1)
    );
  }
  const aics = new Array(maxOrder + 1);
  const bics = new Array(maxOrder + 1);
  const logN = Math.log(nObs);
  for (let k = 0; k <= maxOrder; k++) {
    aics[k] = 2 * cumDofs[k] - 2 * logliks[k];
    bics[k] = logN * cumDofs[k] - 2 * logliks[k];
  }
  let optimalOrder = 0;
  if (criterion === "aic") {
    let best = aics[0];
    for (let k = 1; k <= maxOrder; k++) {
      if (aics[k] < best) {
        best = aics[k];
        optimalOrder = k;
      }
    }
  } else if (criterion === "bic") {
    let best = bics[0];
    for (let k = 1; k <= maxOrder; k++) {
      if (bics[k] < best) {
        best = bics[k];
        optimalOrder = k;
      }
    }
  } else {
    optimalOrder = 0;
    for (let k = 1; k <= maxOrder; k++) {
      const x = -2 * (logliks[k - 1] - logliks[k]);
      const dfDiff = layerDofs[k];
      if (dfDiff > 0 && x > 0) {
        const p = pchisqUpper(x, dfDiff);
        if (p < lrtAlpha) optimalOrder = k;
        else break;
      } else {
        break;
      }
    }
  }
  const orders = [];
  for (let k = 0; k <= maxOrder; k++) orders.push(k);
  return {
    optimalOrder,
    criterion,
    orders,
    aic: aics,
    bic: bics,
    logLikelihood: logliks,
    dof: cumDofs,
    layerDof: layerDofs,
    transitionMatrices: transMats,
    countMatrices: countMats,
    transitionNodes: transNodes,
    states,
    nPaths: trajectories.length,
    nObservations: nObs
  };
}
function mogenTransitions(mg, options = {}) {
  const order = options.order ?? mg.optimalOrder;
  const minCount = options.minCount ?? 1;
  if (order < 1) throw new Error("'order' must be >= 1");
  if (order > mg.orders[mg.orders.length - 1]) {
    throw new Error("'order' exceeds max tested order");
  }
  const tm = mg.transitionMatrices[order];
  const cm = mg.countMatrices[order];
  const nodes = mg.transitionNodes[order];
  const rows = [];
  for (let i = 0; i < tm.rows; i++) {
    for (let j = 0; j < tm.cols; j++) {
      const c = cm.get(i, j);
      if (c < minCount) continue;
      const fromParts = nodes[i].split(HON_SEP2);
      const toParts = nodes[j].split(HON_SEP2);
      const nextState = toParts[toParts.length - 1];
      rows.push({
        path: [...fromParts, nextState].join(" -> "),
        count: c,
        probability: roundR(tm.get(i, j), 4),
        from: fromParts.join(" -> "),
        to: nextState
      });
    }
  }
  rows.sort((a, b) => b.count - a.count);
  return rows;
}
function pathCounts(data, k = 2, top) {
  if (k < 2) throw new Error("'k' must be >= 2");
  const trajectories = inputToTrajectories(data);
  const counts = /* @__PURE__ */ new Map();
  for (const traj of trajectories) {
    const n = traj.length;
    if (n < k) continue;
    for (let i = 0; i + k <= n; i++) {
      const key = traj.slice(i, i + k).join(" -> ");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);
  const rows = [];
  for (const [path, count] of counts) {
    rows.push({
      path,
      count,
      proportion: total > 0 ? roundR(count / total, 4) : 0
    });
  }
  rows.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  if (top !== void 0 && top >= 0) return rows.slice(0, top);
  return rows;
}
function stateFrequencies(data) {
  const trajectories = inputToTrajectories(data);
  const counts = /* @__PURE__ */ new Map();
  let total = 0;
  for (const traj of trajectories) {
    for (const s of traj) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
      total++;
    }
  }
  const rows = [];
  for (const [state, count] of counts) {
    rows.push({
      state,
      count,
      proportion: total > 0 ? roundR(count / total, 4) : 0
    });
  }
  rows.sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
  return rows;
}

// src/analysis/hon.ts
var HON_SEP3 = "";
function honEncode(parts) {
  return parts.join(HON_SEP3);
}
function honDecode(key) {
  return key.split(HON_SEP3);
}
function honKeyLen(key) {
  let n = 1;
  for (let i = 0; i < key.length; i++) {
    if (key.charCodeAt(i) === 1) n++;
  }
  return n;
}
function arrowNotation(seq) {
  return seq.join(" -> ");
}
function honParseInput(data, collapseRepeats) {
  let raw;
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
    raw = data.map((row) => {
      const out = [];
      for (const v of row) if (v !== null && v !== void 0) out.push(v);
      return out;
    });
  } else {
    raw = extractTrajectories(data);
  }
  if (collapseRepeats) {
    raw = raw.map((traj) => {
      if (traj.length <= 1) return traj;
      const out = [traj[0]];
      for (let i = 1; i < traj.length; i++) {
        if (traj[i] !== traj[i - 1]) out.push(traj[i]);
      }
      return out;
    });
  }
  return raw.filter((t) => t.length >= 2);
}
function honKld(a, b) {
  if (a.size === 0) return 0;
  let div = 0;
  for (const [t, pa] of a) {
    if (pa <= 0) continue;
    const pb = b.get(t) ?? 0;
    if (pb > 0) div += pa * Math.log2(pa / pb);
    else return Infinity;
  }
  return div;
}
function honKldThreshold(newOrder, extSourceKey, count) {
  const c = count.get(extSourceKey);
  let total = 0;
  if (c) for (const v of c.values()) total += v;
  return newOrder / Math.log2(1 + total);
}
function honBuildObservations(trajectories, maxOrder) {
  const count = /* @__PURE__ */ new Map();
  for (const traj of trajectories) {
    const n = traj.length;
    const maxLen = Math.min(maxOrder + 1, n);
    for (let order = 2; order <= maxLen; order++) {
      const nSubs = n - order + 1;
      for (let start = 0; start < nSubs; start++) {
        const subseq = traj.slice(start, start + order);
        const target = subseq[order - 1];
        const sourceKey = honEncode(subseq.slice(0, -1));
        let row = count.get(sourceKey);
        if (!row) {
          row = /* @__PURE__ */ new Map();
          count.set(sourceKey, row);
        }
        row.set(target, (row.get(target) ?? 0) + 1);
      }
    }
  }
  return count;
}
function honBuildDistributions(count, minFreq) {
  const distr = /* @__PURE__ */ new Map();
  for (const [sourceKey, counts] of count) {
    for (const [t, c] of [...counts]) {
      if (c < minFreq) counts.set(t, 0);
    }
    let total = 0;
    for (const c of counts.values()) total += c;
    const d = /* @__PURE__ */ new Map();
    if (total > 0) {
      for (const [t, c] of counts) if (c > 0) d.set(t, c / total);
    }
    distr.set(sourceKey, d);
  }
  return distr;
}
function honBuildSourceCache(distr) {
  const cache = /* @__PURE__ */ new Map();
  for (const sourceKey of distr.keys()) {
    const source = honDecode(sourceKey);
    const srcLen = source.length;
    if (srcLen <= 1) continue;
    const newOrder = srcLen;
    for (let start = 1; start < srcLen; start++) {
      const currKey = honEncode(source.slice(start));
      let orderMap = cache.get(currKey);
      if (!orderMap) {
        orderMap = /* @__PURE__ */ new Map();
        cache.set(currKey, orderMap);
      }
      let set = orderMap.get(newOrder);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        orderMap.set(newOrder, set);
      }
      set.add(sourceKey);
    }
  }
  return cache;
}
function honGetExtensions(currKey, newOrder, cache) {
  return [...cache.get(currKey)?.get(newOrder) ?? []];
}
function honAddToRules(sourceKey, distr, rules) {
  const source = honDecode(sourceKey);
  if (source.length === 0) return;
  if (!rules.has(sourceKey)) {
    const d = distr.get(sourceKey);
    if (d) rules.set(sourceKey, new Map(d));
  }
  if (source.length > 1) {
    honAddToRules(honEncode(source.slice(0, -1)), distr, rules);
  }
}
function honExtendRule(validKey, currKey, order, maxOrder, distr, count, cache, rules) {
  if (order >= maxOrder) {
    honAddToRules(validKey, distr, rules);
    return;
  }
  const validDistr = distr.get(validKey);
  const newOrder = order + 1;
  const extended = honGetExtensions(currKey, newOrder, cache);
  if (extended.length === 0) {
    honAddToRules(validKey, distr, rules);
    return;
  }
  for (const extKey of extended) {
    const extDistr = distr.get(extKey);
    if (extDistr && extDistr.size > 0 && honKld(extDistr, validDistr) > honKldThreshold(newOrder, extKey, count)) {
      honExtendRule(extKey, extKey, newOrder, maxOrder, distr, count, cache, rules);
    } else {
      honExtendRule(validKey, extKey, newOrder, maxOrder, distr, count, cache, rules);
    }
  }
}
function honExtractRules(trajectories, maxOrder, minFreq) {
  const count = honBuildObservations(trajectories, maxOrder);
  const distr = honBuildDistributions(count, minFreq);
  const cache = honBuildSourceCache(distr);
  const rules = /* @__PURE__ */ new Map();
  for (const sourceKey of distr.keys()) {
    if (honKeyLen(sourceKey) === 1) {
      honAddToRules(sourceKey, distr, rules);
      honExtendRule(sourceKey, sourceKey, 1, maxOrder, distr, count, cache, rules);
    }
  }
  return { rules, count };
}
function honpBuildOrder1(trajectories, minFreq) {
  const count = /* @__PURE__ */ new Map();
  const startingPoints = /* @__PURE__ */ new Map();
  for (let ti = 0; ti < trajectories.length; ti++) {
    const traj = trajectories[ti];
    for (let pos = 0; pos < traj.length - 1; pos++) {
      const sourceKey = honEncode([traj[pos]]);
      const target = traj[pos + 1];
      let row = count.get(sourceKey);
      if (!row) {
        row = /* @__PURE__ */ new Map();
        count.set(sourceKey, row);
      }
      row.set(target, (row.get(target) ?? 0) + 1);
      let sp = startingPoints.get(sourceKey);
      if (!sp) {
        sp = [];
        startingPoints.set(sourceKey, sp);
      }
      sp.push([ti, pos]);
    }
  }
  const distr = /* @__PURE__ */ new Map();
  for (const [sourceKey, counts] of count) {
    for (const [t, c] of [...counts]) if (c < minFreq) counts.set(t, 0);
    let total = 0;
    for (const c of counts.values()) total += c;
    const d = /* @__PURE__ */ new Map();
    if (total > 0) {
      for (const [t, c] of counts) if (c > 0) d.set(t, c / total);
    }
    distr.set(sourceKey, d);
  }
  return { count, distr, startingPoints, sourceToExt: /* @__PURE__ */ new Map() };
}
function honpExtendObservation(sourceKey, state, trajectories, minFreq) {
  const source = honDecode(sourceKey);
  const order = source.length;
  if (order > 1) {
    const suffixKey = honEncode(source.slice(1));
    const suffixCount = state.count.get(suffixKey);
    if (!suffixCount || suffixCount.size === 0) {
      honpExtendObservation(suffixKey, state, trajectories, minFreq);
    }
  }
  const sp = state.startingPoints.get(sourceKey);
  if (!sp || sp.length === 0) return;
  const localCount = /* @__PURE__ */ new Map();
  for (const [ti, pos] of sp) {
    const traj = trajectories[ti];
    if (pos >= 1 && pos + order < traj.length) {
      const extSource = traj.slice(pos - 1, pos + order);
      const target = traj[pos + order];
      const extKey = honEncode(extSource);
      let row = localCount.get(extKey);
      if (!row) {
        row = /* @__PURE__ */ new Map();
        localCount.set(extKey, row);
      }
      row.set(target, (row.get(target) ?? 0) + 1);
      let esp = state.startingPoints.get(extKey);
      if (!esp) {
        esp = [];
        state.startingPoints.set(extKey, esp);
      }
      esp.push([ti, pos - 1]);
    }
  }
  for (const [extKey, lc] of localCount) {
    for (const [t, c] of [...lc]) if (c < minFreq) lc.set(t, 0);
    state.count.set(extKey, lc);
    let total = 0;
    for (const v of lc.values()) total += v;
    if (total > 0) {
      const d = /* @__PURE__ */ new Map();
      for (const [t, c] of lc) if (c > 0) d.set(t, c / total);
      state.distr.set(extKey, d);
      const suffixKey = honEncode(honDecode(extKey).slice(1));
      let s2e = state.sourceToExt.get(suffixKey);
      if (!s2e) {
        s2e = /* @__PURE__ */ new Set();
        state.sourceToExt.set(suffixKey, s2e);
      }
      s2e.add(extKey);
    }
  }
}
function honpExtendSourceFast(currKey, state, trajectories, minFreq) {
  let s2e = state.sourceToExt.get(currKey);
  if (!s2e) {
    honpExtendObservation(currKey, state, trajectories, minFreq);
    s2e = state.sourceToExt.get(currKey);
    if (!s2e) return [];
  }
  return [...s2e].filter((k) => {
    const d = state.distr.get(k);
    return d !== void 0 && d.size > 0;
  });
}
function honpAddToRules(sourceKey, state, rules, trajectories, minFreq) {
  const source = honDecode(sourceKey);
  for (let ord = 1; ord <= source.length; ord++) {
    const prefix = source.slice(0, ord);
    const prefixKey = honEncode(prefix);
    const d0 = state.distr.get(prefixKey);
    if (!d0 || d0.size === 0) {
      if (ord > 1) {
        const suffixKey = honEncode(prefix.slice(1));
        honpExtendSourceFast(suffixKey, state, trajectories, minFreq);
      }
    }
    const d = state.distr.get(prefixKey);
    if (d) rules.set(prefixKey, new Map(d));
  }
}
function honpMaxDivergence(distr) {
  let minTarget = "";
  let minProb = Infinity;
  for (const [t, p] of distr) {
    if (p < minProb) {
      minProb = p;
      minTarget = t;
    }
  }
  return /* @__PURE__ */ new Map([[minTarget, 1]]);
}
function honpExtendRule(validKey, currKey, order, maxOrder, state, rules, trajectories, minFreq) {
  if (order >= maxOrder) {
    honpAddToRules(validKey, state, rules, trajectories, minFreq);
    return;
  }
  const validDistr = state.distr.get(validKey);
  const currDistr = state.distr.get(currKey);
  if (!currDistr || currDistr.size === 0) {
    honpAddToRules(validKey, state, rules, trajectories, minFreq);
    return;
  }
  const maxDiv = honpMaxDivergence(currDistr);
  if (honKld(maxDiv, validDistr) < honKldThreshold(order + 1, currKey, state.count)) {
    honpAddToRules(validKey, state, rules, trajectories, minFreq);
    return;
  }
  const newOrder = order + 1;
  const extended = honpExtendSourceFast(currKey, state, trajectories, minFreq);
  if (extended.length === 0) {
    honpAddToRules(validKey, state, rules, trajectories, minFreq);
    return;
  }
  for (const extKey of extended) {
    const extDistr = state.distr.get(extKey);
    if (extDistr && extDistr.size > 0 && honKld(extDistr, validDistr) > honKldThreshold(newOrder, extKey, state.count)) {
      honpExtendRule(extKey, extKey, newOrder, maxOrder, state, rules, trajectories, minFreq);
    } else {
      honpExtendRule(validKey, extKey, newOrder, maxOrder, state, rules, trajectories, minFreq);
    }
  }
}
function honpExtractRules(trajectories, maxOrder, minFreq) {
  const state = honpBuildOrder1(trajectories, minFreq);
  const rules = /* @__PURE__ */ new Map();
  for (const sourceKey of state.distr.keys()) {
    if (honKeyLen(sourceKey) === 1) {
      honpAddToRules(sourceKey, state, rules, trajectories, minFreq);
      honpExtendRule(sourceKey, sourceKey, 1, maxOrder, state, rules, trajectories, minFreq);
    }
  }
  return { rules, count: state.count };
}
function honBuildNetwork(rules) {
  const graph = /* @__PURE__ */ new Map();
  const sources = [...rules.keys()].sort((a, b) => {
    const da = honKeyLen(a), db = honKeyLen(b);
    return da - db || a.localeCompare(b);
  });
  for (const sourceKey of sources) {
    const ruleDistr = rules.get(sourceKey);
    if (!graph.has(sourceKey)) graph.set(sourceKey, /* @__PURE__ */ new Map());
    for (const [target, prob] of ruleDistr) {
      const targetKey = honEncode([target]);
      graph.get(sourceKey).set(targetKey, prob);
      const source = honDecode(sourceKey);
      if (source.length > 1) honRewire(graph, sourceKey);
    }
  }
  honRewireTails(graph);
  return graph;
}
function honRewire(graph, sourceKey, _targetKey) {
  const source = honDecode(sourceKey);
  const prevSourceKey = honEncode(source.slice(0, -1));
  const prevTargetKey = honEncode([source[source.length - 1]]);
  const prevGraph = graph.get(prevSourceKey);
  if (!prevGraph || prevGraph.has(sourceKey)) return;
  if (prevGraph.has(prevTargetKey)) {
    prevGraph.set(sourceKey, prevGraph.get(prevTargetKey));
    prevGraph.delete(prevTargetKey);
  }
}
function honRewireTails(graph) {
  const toAdd = [];
  const toRemove = [];
  for (const [sourceKey, sourceGraph] of graph) {
    const source = honDecode(sourceKey);
    for (const [targetKey, weight] of sourceGraph) {
      const target = honDecode(targetKey);
      if (target.length !== 1) continue;
      let newTarget = [...source, ...target];
      while (newTarget.length > 1) {
        const newTargetKey = honEncode(newTarget);
        if (graph.has(newTargetKey)) {
          toAdd.push({ source: sourceKey, target: newTargetKey, weight });
          toRemove.push({ source: sourceKey, target: targetKey });
          break;
        }
        newTarget = newTarget.slice(1);
      }
    }
  }
  for (const { source, target, weight } of toAdd) graph.get(source).set(target, weight);
  for (const { source, target } of toRemove) graph.get(source).delete(target);
}
function honGraphToEdgelist(graph, count) {
  const rows = [];
  for (const [sourceKey, sourceGraph] of graph) {
    const source = honDecode(sourceKey);
    const fromNode = arrowNotation(source);
    const fromOrder = source.length;
    for (const [targetKey, prob] of sourceGraph) {
      const target = honDecode(targetKey);
      const toOrder = target.length;
      const nextState = target[target.length - 1];
      const path = [...source, nextState].join(" -> ");
      let edgeCount = 0;
      const sc = count.get(sourceKey);
      if (sc) edgeCount = sc.get(nextState) ?? 0;
      rows.push({
        path,
        from: fromNode,
        to: nextState,
        count: edgeCount,
        probability: prob,
        fromOrder,
        toOrder
      });
    }
  }
  return rows;
}
function buildHon(data, options = {}) {
  const { maxOrder = 5, minFreq = 1, collapseRepeats = false, method = "hon+" } = options;
  if (!(maxOrder >= 1)) throw new Error("'maxOrder' must be >= 1");
  if (!(minFreq >= 1)) throw new Error("'minFreq' must be >= 1");
  if (method !== "hon" && method !== "hon+") {
    throw new Error("'method' must be 'hon' or 'hon+'");
  }
  const trajectories = honParseInput(data, collapseRepeats);
  if (trajectories.length === 0) {
    throw new Error("No valid trajectories (each must have at least 2 states)");
  }
  const { rules, count } = method === "hon+" ? honpExtractRules(trajectories, maxOrder, minFreq) : honExtractRules(trajectories, maxOrder, minFreq);
  const graph = honBuildNetwork(rules);
  const edges = honGraphToEdgelist(graph, count);
  const allNodes = /* @__PURE__ */ new Set();
  for (const [sourceKey, sourceGraph] of graph) {
    allNodes.add(arrowNotation(honDecode(sourceKey)));
    for (const targetKey of sourceGraph.keys()) {
      allNodes.add(arrowNotation(honDecode(targetKey)));
    }
  }
  const nodes = [...allNodes].sort();
  const n = nodes.length;
  const idx = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) idx.set(nodes[i], i);
  const matrix = new Matrix(n, n);
  for (const [sourceKey, sourceGraph] of graph) {
    const r = idx.get(arrowNotation(honDecode(sourceKey)));
    for (const [targetKey, w] of sourceGraph) {
      const c = idx.get(arrowNotation(honDecode(targetKey)));
      matrix.set(r, c, w);
    }
  }
  const stateSet = /* @__PURE__ */ new Set();
  for (const traj of trajectories) for (const s of traj) stateSet.add(s);
  const firstOrderStates = [...stateSet].sort();
  let maxObserved = 1;
  for (const k of rules.keys()) maxObserved = Math.max(maxObserved, honKeyLen(k));
  return {
    matrix,
    nodes,
    edges,
    nNodes: n,
    nEdges: edges.length,
    firstOrderStates,
    maxOrderRequested: maxOrder,
    maxOrderObserved: maxObserved,
    minFreq,
    nTrajectories: trajectories.length,
    directed: true,
    method
  };
}

// src/analysis/hypa.ts
var HON_SEP4 = "";
function parseInput(data) {
  let raw;
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
    raw = data.map((row) => {
      const out = [];
      for (const v of row) if (v !== null && v !== void 0) out.push(v);
      return out;
    });
  } else {
    raw = extractTrajectories(data);
  }
  return raw.filter((t) => t.length >= 2);
}
function logHyperPmf(k, K, N, n) {
  if (k < 0 || k > K || k > n || n - k > N - K) return -Infinity;
  return logGamma(K + 1) - logGamma(k + 1) - logGamma(K - k + 1) + logGamma(N - K + 1) - logGamma(n - k + 1) - logGamma(N - K - n + k + 1) - logGamma(N + 1) + logGamma(n + 1) + logGamma(N - n + 1);
}
function phyperLower(x, K, N, n) {
  const xMax = Math.min(K, n);
  const xMin = Math.max(0, n + K - N);
  if (x < xMin) return 0;
  if (x >= xMax) return 1;
  let logCurr = logHyperPmf(xMin, K, N, n);
  let cdf = Math.exp(logCurr);
  for (let k = xMin; k < x; k++) {
    const num = (K - k) * (n - k);
    const denom = (k + 1) * (N - K - n + k + 1);
    if (num <= 0 || denom <= 0) break;
    logCurr += Math.log(num) - Math.log(denom);
    cdf += Math.exp(logCurr);
  }
  return Math.min(1, Math.max(0, cdf));
}
function phyperUpperInclusive(x, K, N, n) {
  const xMin = Math.max(0, n + K - N);
  if (x <= xMin) return 1;
  const xMax = Math.min(K, n);
  if (x > xMax) return 0;
  return Math.min(1, Math.max(0, 1 - phyperLower(x - 1, K, N, n)));
}
function buildHypa(data, options = {}) {
  const { k = 3, alpha = 0.05, minCount = 5, pAdjustMethod = "BH" } = options;
  if (!(k >= 1)) throw new Error("'k' must be >= 1");
  if (!(alpha > 0 && alpha < 0.5)) throw new Error("'alpha' must be in (0, 0.5)");
  if (!(minCount >= 1)) throw new Error("'minCount' must be >= 1");
  const trajectories = parseInput(data);
  if (trajectories.length === 0) {
    throw new Error("No valid trajectories (each must have at least 2 states)");
  }
  const kg = kgramCounts(trajectories, k);
  if (kg.edges.length === 0) {
    throw new Error(`No edges at order ${k} (paths too short or too few)`);
  }
  const nodes = kg.nodes;
  const n = nodes.length;
  const idx = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) idx.set(nodes[i], i);
  const adj = new Matrix(n, n);
  for (const e of kg.edges) {
    const r = idx.get(e.from);
    const c = idx.get(e.to);
    if (r !== void 0 && c !== void 0) adj.set(r, c, e.weight);
  }
  const outStrength2 = new Float64Array(n);
  const inStrength2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let outS = 0, inS = 0;
    for (let j = 0; j < n; j++) {
      outS += adj.get(i, j);
      inS += adj.get(j, i);
    }
    outStrength2[i] = outS;
    inStrength2[i] = inS;
  }
  const xi = new Matrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (adj.get(i, j) > 0) xi.set(i, j, outStrength2[i] * inStrength2[j]);
    }
  }
  let xiSum = 0;
  let nDraws = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      xiSum += xi.get(i, j);
      nDraws += adj.get(i, j);
    }
  }
  const N = Math.round(xiSum);
  const nClamp = Math.min(nDraws, N);
  const raw = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const fObs = adj.get(i, j);
      if (fObs <= 0) continue;
      let K = Math.round(xi.get(i, j));
      K = Math.max(0, Math.min(K, N));
      const fromParts = nodes[i].split(HON_SEP4);
      const toParts = nodes[j].split(HON_SEP4);
      const nextState = toParts[toParts.length - 1];
      const path = [...fromParts, nextState].join(" -> ");
      const fromArrow = fromParts.join(" -> ");
      const expected = N > 0 ? nDraws * K / N : 0;
      const ratio = expected > 0 ? fObs / expected : Infinity;
      const pUnder = phyperLower(fObs, K, N, nClamp);
      const pOver = phyperUpperInclusive(fObs, K, N, nClamp);
      raw.push({
        iIdx: i,
        jIdx: j,
        path,
        from: fromArrow,
        to: nextState,
        observed: fObs,
        expected,
        ratio,
        pUnder,
        pOver
      });
    }
  }
  const method = pAdjustMethod;
  const pUnderRaw = raw.map((r) => r.pUnder);
  const pOverRaw = raw.map((r) => r.pOver);
  const pAdjUnder = method === "none" ? pUnderRaw : pAdjust(pUnderRaw, method);
  const pAdjOver = method === "none" ? pOverRaw : pAdjust(pOverRaw, method);
  const scores = raw.map((r, i) => {
    let anomaly = "normal";
    if (r.observed >= minCount) {
      if (pAdjUnder[i] < alpha) anomaly = "under";
      else if (pAdjOver[i] < alpha) anomaly = "over";
    }
    return {
      path: r.path,
      from: r.from,
      to: r.to,
      observed: r.observed,
      expected: r.expected,
      ratio: r.ratio,
      pValue: r.pUnder,
      pUnder: r.pUnder,
      pOver: r.pOver,
      pAdjustedUnder: pAdjUnder[i],
      pAdjustedOver: pAdjOver[i],
      anomaly
    };
  });
  const over = scores.filter((s) => s.anomaly === "over").sort((a, b) => b.ratio - a.ratio);
  const under = scores.filter((s) => s.anomaly === "under").sort((a, b) => a.ratio - b.ratio);
  const normal = scores.filter((s) => s.anomaly === "normal");
  const sorted = [...over, ...under, ...normal];
  return {
    scores: sorted,
    adjacency: adj,
    adjacencyLabels: nodes,
    xi,
    k,
    alpha,
    pAdjust: method,
    nAnomalous: over.length + under.length,
    nOver: over.length,
    nUnder: under.length,
    nEdges: scores.length,
    nodes,
    directed: true
  };
}

// src/analysis/honem.ts
function jacobiSymmetricEigen(A, maxSweeps = 100, tol = 1e-14) {
  const n = A.rows;
  if (n !== A.cols) throw new Error("jacobiSymmetricEigen: A must be square");
  const a = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a[i * n + j] = A.get(i, j);
  }
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = a[i * n + j];
        off += v * v;
      }
    }
    if (off < tol) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = a[p * n + p];
        const aqq = a[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        let t;
        if (!Number.isFinite(theta) || Math.abs(theta) > 1e15) {
          t = 0.5 / theta;
        } else {
          t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        }
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        a[p * n + p] = app - t * apq;
        a[q * n + q] = aqq + t * apq;
        a[p * n + q] = 0;
        a[q * n + p] = 0;
        for (let i = 0; i < n; i++) {
          if (i === p || i === q) continue;
          const aip = a[i * n + p];
          const aiq = a[i * n + q];
          a[i * n + p] = c * aip - s * aiq;
          a[p * n + i] = a[i * n + p];
          a[i * n + q] = s * aip + c * aiq;
          a[q * n + i] = a[i * n + q];
        }
        for (let i = 0; i < n; i++) {
          const vip = V[i * n + p];
          const viq = V[i * n + q];
          V[i * n + p] = c * vip - s * viq;
          V[i * n + q] = s * vip + c * viq;
        }
      }
    }
  }
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = a[i * n + i];
  const vectors = new Matrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) vectors.set(i, j, V[i * n + j]);
  }
  return { values, vectors };
}
function svdSquare(S) {
  const n = S.rows;
  if (n !== S.cols) throw new Error("svdSquare: S must be square");
  const B = new Matrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let k = 0; k < n; k++) acc += S.get(k, i) * S.get(k, j);
      B.set(i, j, acc);
    }
  }
  const { values, vectors } = jacobiSymmetricEigen(B);
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => values[b] - values[a]);
  const sigma = new Float64Array(n);
  const v = new Matrix(n, n);
  for (let j = 0; j < n; j++) {
    const oj = order[j];
    sigma[j] = Math.sqrt(Math.max(0, values[oj]));
    for (let i = 0; i < n; i++) v.set(i, j, vectors.get(i, oj));
  }
  const u = new Matrix(n, n);
  for (let j = 0; j < n; j++) {
    if (sigma[j] === 0) continue;
    const inv = 1 / sigma[j];
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = 0; k < n; k++) acc += S.get(i, k) * v.get(k, j);
      u.set(i, j, acc * inv);
    }
  }
  return { u, sigma, v };
}
function rowNormalize(mat) {
  const out = new Matrix(mat.rows, mat.cols);
  for (let i = 0; i < mat.rows; i++) {
    let row = 0;
    for (let j = 0; j < mat.cols; j++) row += mat.get(i, j);
    if (row > 0) {
      for (let j = 0; j < mat.cols; j++) out.set(i, j, mat.get(i, j) / row);
    }
  }
  return out;
}
function matMul(a, b) {
  if (a.cols !== b.rows) throw new Error("matMul: shape mismatch");
  const out = new Matrix(a.rows, b.cols);
  for (let i = 0; i < a.rows; i++) {
    for (let k = 0; k < a.cols; k++) {
      const aik = a.get(i, k);
      if (aik === 0) continue;
      for (let j = 0; j < b.cols; j++) out.set(i, j, out.get(i, j) + aik * b.get(k, j));
    }
  }
  return out;
}
function honemNeighborhood(D, maxPower) {
  const n = D.rows;
  const weights = new Float64Array(maxPower + 1);
  let Z2 = 0;
  for (let k = 0; k <= maxPower; k++) {
    weights[k] = Math.exp(-k);
    Z2 += weights[k];
  }
  let Dpow = D;
  const S = new Matrix(n, n);
  for (let k = 0; k <= maxPower; k++) {
    const w = weights[k];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        S.set(i, j, S.get(i, j) + w * Dpow.get(i, j));
      }
    }
    if (k < maxPower) Dpow = matMul(Dpow, D);
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) S.set(i, j, S.get(i, j) / Z2);
  }
  return S;
}
function buildHonem(hon, options = {}) {
  let dim = options.dim ?? 32;
  const maxPower = options.maxPower ?? 10;
  if (!(dim >= 1)) throw new Error("'dim' must be >= 1");
  if (!(maxPower >= 1)) throw new Error("'maxPower' must be >= 1");
  let mat;
  let nodes;
  if (hon instanceof Matrix) {
    mat = hon;
    nodes = Array.from({ length: mat.rows }, (_, i) => `node_${i + 1}`);
  } else {
    mat = hon.matrix;
    nodes = [...hon.nodes];
  }
  const n = mat.rows;
  if (n < 2) throw new Error("Need at least 2 nodes for embedding");
  if (n !== mat.cols) throw new Error("'hon' adjacency matrix must be square");
  dim = Math.min(dim, n - 1);
  const D = rowNormalize(mat);
  const S = honemNeighborhood(D, maxPower);
  const { u, sigma } = svdSquare(S);
  const embeddings = new Matrix(n, dim);
  for (let j = 0; j < dim; j++) {
    const sqrtS = Math.sqrt(Math.max(0, sigma[j]));
    for (let i = 0; i < n; i++) embeddings.set(i, j, u.get(i, j) * sqrtS);
  }
  let totalVar = 0;
  for (let j = 0; j < n; j++) totalVar += sigma[j] * sigma[j];
  let explained = 0;
  for (let j = 0; j < dim; j++) explained += sigma[j] * sigma[j];
  const explainedVariance = totalVar > 0 ? explained / totalVar : 0;
  const singularValues = new Float64Array(dim);
  for (let j = 0; j < dim; j++) singularValues[j] = sigma[j];
  return {
    embeddings,
    nodes,
    singularValues,
    explainedVariance,
    dim,
    maxPower,
    nNodes: n
  };
}

// src/analysis/pathDependence.ts
var HON_SEP5 = "";
function cellAsR(v) {
  return v === null || v === void 0 ? "NA" : v;
}
function pdKgramCounts(data, k) {
  if (data.length === 0) return /* @__PURE__ */ new Map();
  const ncols = data.reduce((m, row) => Math.max(m, row.length), 0);
  if (ncols < k) {
    throw new Error(
      `Sequences too short for order ${k - 1} (need >=${k} columns, got ${ncols}).`
    );
  }
  const counts = /* @__PURE__ */ new Map();
  for (let t = 0; t + k <= ncols; t++) {
    for (const row of data) {
      const parts = new Array(k);
      let hasNA = false;
      for (let j = 0; j < k; j++) {
        const cell = cellAsR(row[t + j]);
        if (cell === "NA") {
          hasNA = true;
          break;
        }
        parts[j] = cell;
      }
      if (hasNA) continue;
      const key = parts.join(HON_SEP5);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}
function pdSplitKgram(name, k) {
  const parts = name.split(HON_SEP5);
  const context = parts.slice(0, k - 1).join(" -> ");
  const nextState = parts[k - 1];
  return { context, nextState };
}
function pdKl(p, q, base) {
  const logBase = Math.log(base);
  let acc = 0;
  for (let i = 0; i < p.length; i++) {
    const pi = p[i];
    if (pi <= 0) continue;
    const qi = q[i];
    if (qi === 0) return Infinity;
    acc += pi * (Math.log(pi / qi) / logBase);
  }
  return acc;
}
function pdEntropy(p, base) {
  const logBase = Math.log(base);
  let acc = 0;
  for (let i = 0; i < p.length; i++) {
    const pi = p[i];
    if (pi > 0) acc -= pi * (Math.log(pi) / logBase);
  }
  return acc;
}
function argmax(p) {
  let best = 0;
  let bestV = p[0];
  for (let i = 1; i < p.length; i++) {
    if (p[i] > bestV) {
      bestV = p[i];
      best = i;
    }
  }
  return best;
}
function pathDependence(data, options = {}) {
  const order = options.order ?? 2;
  const minCount = options.minCount ?? 5;
  const base = options.base ?? 2;
  if (!(order >= 2)) throw new Error("'order' must be >= 2");
  if (!(minCount >= 1)) throw new Error("'minCount' must be >= 1");
  if (!(base > 0 && base !== 1 && Number.isFinite(base))) {
    throw new Error("'base' must be a finite positive number != 1");
  }
  const cK = pdKgramCounts(data, order + 1);
  const c1 = pdKgramCounts(data, 2);
  if (cK.size === 0) {
    throw new Error(`No complete order-${order} contexts found in data.`);
  }
  const stateSet = /* @__PURE__ */ new Set();
  for (const key of c1.keys()) {
    const parts = key.split(HON_SEP5);
    stateSet.add(parts[0]);
    stateSet.add(parts[1]);
  }
  const states = [...stateSet].sort();
  const nStates = states.length;
  const stateIdx = /* @__PURE__ */ new Map();
  states.forEach((s, i) => stateIdx.set(s, i));
  const o1Rows = /* @__PURE__ */ new Map();
  const o1Totals = /* @__PURE__ */ new Map();
  for (const [key, c] of c1) {
    const { context, nextState } = pdSplitKgram(key, 2);
    let row = o1Rows.get(context);
    if (!row) {
      row = /* @__PURE__ */ new Map();
      o1Rows.set(context, row);
    }
    row.set(nextState, (row.get(nextState) ?? 0) + c);
    o1Totals.set(context, (o1Totals.get(context) ?? 0) + c);
  }
  const p1Cache = [];
  for (const last of states) {
    const arr = new Float64Array(nStates);
    const row = o1Rows.get(last);
    const total = o1Totals.get(last);
    if (row && total) {
      for (const [nxt, c] of row) {
        const j = stateIdx.get(nxt);
        if (j !== void 0) arr[j] = c / total;
      }
    }
    p1Cache.push(arr);
  }
  const okByContext = /* @__PURE__ */ new Map();
  for (const [key, c] of cK) {
    const parts = key.split(HON_SEP5);
    const context = parts.slice(0, order).join(" -> ");
    const nextState = parts[order];
    const lastState = parts[order - 1];
    let entry = okByContext.get(context);
    if (!entry) {
      entry = { context, lastState, counts: /* @__PURE__ */ new Map(), total: 0 };
      okByContext.set(context, entry);
    }
    entry.counts.set(nextState, (entry.counts.get(nextState) ?? 0) + c);
    entry.total += c;
  }
  const rows = [];
  for (const ctx of okByContext.values()) {
    if (ctx.total < minCount) continue;
    const pK = new Float64Array(nStates);
    for (const [nxt, c] of ctx.counts) {
      const j = stateIdx.get(nxt);
      if (j !== void 0) pK[j] = c / ctx.total;
    }
    const lastIdx = stateIdx.get(ctx.lastState);
    const p1 = lastIdx !== void 0 ? p1Cache[lastIdx] : new Float64Array(nStates);
    const h1 = pdEntropy(p1, base);
    const hk = pdEntropy(pK, base);
    const kl = pdKl(pK, p1, base);
    const topO1 = states[argmax(p1)];
    const topOk = states[argmax(pK)];
    rows.push({
      context: ctx.context,
      n: ctx.total,
      hOrder1: h1,
      hOrderK: hk,
      hDrop: h1 - hk,
      kl,
      topO1,
      topOk,
      flips: topO1 !== topOk
    });
  }
  rows.sort((a, b) => {
    const ak = Number.isFinite(a.kl) ? a.kl : Infinity;
    const bk = Number.isFinite(b.kl) ? b.kl : Infinity;
    return bk - ak;
  });
  let totalN = 0;
  let klSum = 0;
  let hDropSum = 0;
  let nFlips = 0;
  for (const r of rows) {
    if (r.flips) nFlips++;
    if (Number.isFinite(r.kl)) {
      totalN += r.n;
      klSum += r.kl * r.n;
      hDropSum += r.hDrop * r.n;
    }
  }
  const klWeighted = totalN > 0 ? klSum / totalN : 0;
  const hDropWeighted = totalN > 0 ? hDropSum / totalN : 0;
  return {
    contexts: rows,
    chain: {
      klWeighted,
      hDropWeighted,
      nContexts: rows.length,
      nFlips
    },
    order,
    base,
    minCount,
    states
  };
}

// src/analysis/simplicial.ts
function extractAdjacency(x, labelsOpt) {
  if (x instanceof Matrix) {
    if (!x.isSquare) throw new Error("buildSimplicial: matrix must be square");
    const n = x.rows;
    const labels2 = labelsOpt && labelsOpt.length === n ? labelsOpt.slice() : Array.from({ length: n }, (_, i) => `V${i + 1}`);
    return { mat: x.clone(), labels: labels2 };
  }
  if (Array.isArray(x)) {
    const mat = Matrix.from2D(x);
    if (!mat.isSquare) throw new Error("buildSimplicial: matrix must be square");
    const n = mat.rows;
    const labels2 = labelsOpt && labelsOpt.length === n ? labelsOpt.slice() : Array.from({ length: n }, (_, i) => `V${i + 1}`);
    return { mat, labels: labels2 };
  }
  const tna = x;
  if (!tna.weights || !(tna.weights instanceof Matrix)) {
    throw new Error("buildSimplicial: TNA has no weight matrix");
  }
  const labels = tna.labels && tna.labels.length === tna.weights.rows ? tna.labels.slice() : Array.from({ length: tna.weights.rows }, (_, i) => `V${i + 1}`);
  return { mat: tna.weights.clone(), labels };
}
function symmetricThresholdAdjacency(mat, threshold, inclusive) {
  const n = mat.rows;
  const out = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = Math.max(Math.abs(mat.get(i, j)), Math.abs(mat.get(j, i)));
      const keep = inclusive ? w > 0 && w >= threshold : w > 0 && w > threshold;
      if (keep) {
        out[i][j] = true;
        out[j][i] = true;
      }
    }
  }
  return out;
}
function maximalCliques(adj) {
  const n = adj.length;
  const neighbors = adj.map((row) => {
    const s = /* @__PURE__ */ new Set();
    for (let j = 0; j < n; j++) if (row[j]) s.add(j);
    return s;
  });
  const result = [];
  function bk(R, P, X) {
    if (P.size === 0 && X.size === 0) {
      result.push(R.slice().sort((a, b) => a - b));
      return;
    }
    let pivot = -1;
    let best = -1;
    for (const u of [...P, ...X]) {
      let c = 0;
      const nu = neighbors[u];
      for (const v of P) if (nu.has(v)) c++;
      if (c > best) {
        best = c;
        pivot = u;
      }
    }
    const pivotNbrs = pivot >= 0 ? neighbors[pivot] : /* @__PURE__ */ new Set();
    const candidates = [];
    for (const v of P) if (!pivotNbrs.has(v)) candidates.push(v);
    for (const v of candidates) {
      const nv = neighbors[v];
      const newP = /* @__PURE__ */ new Set();
      const newX = /* @__PURE__ */ new Set();
      for (const u of P) if (nv.has(u)) newP.add(u);
      for (const u of X) if (nv.has(u)) newX.add(u);
      bk([...R, v], newP, newX);
      P.delete(v);
      X.add(v);
    }
  }
  bk([], new Set(Array.from({ length: n }, (_, i) => i)), /* @__PURE__ */ new Set());
  for (let v = 0; v < n; v++) {
    if (neighbors[v].size === 0) {
      result.push([v]);
    }
  }
  return result;
}
function combinations2(arr, k, out, buf = [], start = 0) {
  if (buf.length === k) {
    out.push(buf.slice());
    return;
  }
  for (let i = start; i <= arr.length - (k - buf.length); i++) {
    buf.push(arr[i]);
    combinations2(arr, k, out, buf, i + 1);
    buf.pop();
  }
}
function expandToFaces(maximal, maxDim) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const simplex of maximal) {
    const sorted = simplex.slice().sort((a, b) => a - b);
    const maxSize = Math.min(sorted.length, maxDim + 1);
    for (let size = 1; size <= maxSize; size++) {
      if (size === sorted.length) {
        const key = sorted.join(",");
        if (!seen.has(key)) {
          seen.add(key);
          result.push(sorted.slice());
        }
      } else {
        const combos = [];
        combinations2(sorted, size, combos);
        for (const face of combos) {
          const key = face.join(",");
          if (!seen.has(key)) {
            seen.add(key);
            result.push(face);
          }
        }
      }
    }
  }
  return result;
}
function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let res = 1;
  for (let i = 0; i < k; i++) res = res * (n - i) / (i + 1);
  return Math.round(res);
}
function makeComplex(simplicesIn, nodes, type) {
  const seen = /* @__PURE__ */ new Set();
  const simplices = [];
  for (const s of simplicesIn) {
    const sorted = s.slice().sort((a, b) => a - b);
    const key = sorted.join(",");
    if (!seen.has(key)) {
      seen.add(key);
      simplices.push(sorted);
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    if (!seen.has(String(i))) {
      seen.add(String(i));
      simplices.push([i]);
    }
  }
  const dims = simplices.map((s) => s.length - 1);
  const maxD = dims.length > 0 ? Math.max(...dims) : 0;
  const fVector = new Array(maxD + 1).fill(0);
  for (const d of dims) fVector[d]++;
  let maxPossible = 0;
  for (let d = 0; d <= maxD; d++) maxPossible += choose(nodes.length, d + 1);
  const density = maxPossible > 0 ? simplices.length / maxPossible : 0;
  const meanDim = simplices.length > 0 ? dims.reduce((a, b) => a + b, 0) / simplices.length : 0;
  return {
    simplices,
    nodes,
    nNodes: nodes.length,
    nSimplices: simplices.length,
    dimension: maxD,
    fVector,
    density,
    meanDim,
    type
  };
}
function buildSimplicial(x, options = {}) {
  const { type = "clique", threshold = 0, maxDim = 10, inclusive = true, labels } = options;
  if (type === "pathway") {
    return buildSimplicialPathway(x, options);
  }
  if (type !== "clique") {
    throw new Error(`buildSimplicial: type='${type}' not implemented`);
  }
  const { mat, labels: nodeLabels } = extractAdjacency(x, labels);
  const adj = symmetricThresholdAdjacency(mat, threshold, inclusive);
  const maximal = maximalCliques(adj);
  const faces = expandToFaces(maximal, maxDim);
  return makeComplex(faces, nodeLabels, "clique");
}
function buildSimplicialPathway(input, options = {}) {
  const { maxDim = 10, maxPathways, anomaly = "all" } = options;
  let nodes;
  let rawPaths = [];
  const i = input;
  if (i.edges && Array.isArray(i.edges)) {
    const hoEdges = i.edges.filter((e) => (e.fromOrder ?? 1) > 1);
    hoEdges.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    const capped = maxPathways != null ? hoEdges.slice(0, maxPathways) : hoEdges;
    nodes = i.firstOrderStates ?? i.nodes ?? [];
    rawPaths = capped.map((e) => e.path);
  } else if (i.scores && Array.isArray(i.scores)) {
    let filtered = i.scores;
    if (anomaly === "all") {
      filtered = filtered.filter((s) => s.anomaly !== "normal");
    } else {
      filtered = filtered.filter((s) => s.anomaly === anomaly);
    }
    if (anomaly === "under") {
      filtered.sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0));
    } else {
      filtered.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
    }
    const capped = maxPathways != null ? filtered.slice(0, maxPathways) : filtered;
    const parts = /* @__PURE__ */ new Set();
    if (i.nodes) {
      for (const lbl of i.nodes) {
        for (const part of lbl.split("").join(" -> ").split(" -> ")) {
          if (part) parts.add(part);
        }
      }
    }
    nodes = i.firstOrderStates ?? Array.from(parts).sort();
    rawPaths = capped.map((s) => s.path);
  } else if (i.transitions && Array.isArray(i.transitions)) {
    const capped = maxPathways != null ? i.transitions.slice(0, maxPathways) : i.transitions;
    nodes = i.states ?? i.nodes ?? [];
    rawPaths = capped.map((t) => t.path);
  } else if (i.paths && Array.isArray(i.paths)) {
    const capped = maxPathways != null ? i.paths.slice(0, maxPathways) : i.paths;
    nodes = i.firstOrderStates ?? i.states ?? i.nodes ?? [];
    rawPaths = capped.map((p) => p.path);
  } else {
    throw new Error(
      "buildSimplicial(type='pathway'): input must expose `edges` (HON), `scores` (HYPA), `transitions` (MOGen), or `paths` (generic)."
    );
  }
  if (nodes.length === 0) {
    throw new Error("buildSimplicial(type='pathway'): node alphabet is empty");
  }
  const nodeIdx = /* @__PURE__ */ new Map();
  nodes.forEach((s, idx) => nodeIdx.set(s, idx));
  const simplicesRaw = [];
  for (const p of rawPaths) {
    const parts = p.split("->").map((s) => s.trim());
    const seen = /* @__PURE__ */ new Set();
    const idxs = [];
    for (const part of parts) {
      if (seen.has(part)) continue;
      seen.add(part);
      const idx = nodeIdx.get(part);
      if (idx === void 0) continue;
      idxs.push(idx);
    }
    if (idxs.length >= 2) {
      idxs.sort((a, b) => a - b);
      simplicesRaw.push(idxs);
    }
  }
  const faces = expandToFaces(simplicesRaw, maxDim);
  return makeComplex(faces, nodes, "pathway");
}
function integerRank(matIn) {
  const m = matIn.length;
  if (m === 0) return 0;
  const n = matIn[0].length;
  if (n === 0) return 0;
  const A = matIn.map((row2) => row2.slice());
  let prev = 1;
  let rank = 0;
  let col = 0;
  let row = 0;
  while (row < m && col < n) {
    let p = -1;
    for (let r = row; r < m; r++) {
      if (A[r][col] !== 0) {
        p = r;
        break;
      }
    }
    if (p < 0) {
      col++;
      continue;
    }
    if (p !== row) {
      const tmp = A[row];
      A[row] = A[p];
      A[p] = tmp;
    }
    const pivot = A[row][col];
    for (let r = row + 1; r < m; r++) {
      const a = A[r][col];
      if (a !== 0) {
        for (let c = col; c < n; c++) {
          const num = pivot * A[r][c] - a * A[row][c];
          A[r][c] = num / prev;
        }
      } else {
        for (let c = col; c < n; c++) {
          A[r][c] = pivot * A[r][c] / prev;
        }
      }
    }
    prev = pivot;
    rank++;
    row++;
    col++;
  }
  return rank;
}
function bettiNumbers(sc) {
  const maxD = sc.dimension;
  const dims = sc.simplices.map((s) => s.length - 1);
  const byDim = Array.from({ length: maxD + 1 }, () => []);
  for (let i = 0; i < sc.simplices.length; i++) {
    byDim[dims[i]].push(sc.simplices[i]);
  }
  const boundaryRanks = new Array(maxD + 2).fill(0);
  for (let d = 1; d <= maxD; d++) {
    const kSimps = byDim[d];
    const km1Simps = byDim[d - 1];
    if (kSimps.length === 0 || km1Simps.length === 0) {
      boundaryRanks[d] = 0;
      continue;
    }
    const km1Idx = /* @__PURE__ */ new Map();
    for (let i = 0; i < km1Simps.length; i++) km1Idx.set(km1Simps[i].join(","), i);
    const bmat = Array.from({ length: km1Simps.length }, () => new Array(kSimps.length).fill(0));
    for (let j = 0; j < kSimps.length; j++) {
      const simplex = kSimps[j];
      for (let i = 0; i < simplex.length; i++) {
        const face = [];
        for (let q = 0; q < simplex.length; q++) if (q !== i) face.push(simplex[q]);
        const rIdx = km1Idx.get(face.join(","));
        if (rIdx !== void 0) {
          bmat[rIdx][j] = i % 2 === 0 ? 1 : -1;
        }
      }
    }
    boundaryRanks[d] = integerRank(bmat);
  }
  const betti = new Array(maxD + 1).fill(0);
  for (let d = 0; d <= maxD; d++) {
    const nK = byDim[d].length;
    const nullityK = nK - boundaryRanks[d];
    const rankKp1 = d < maxD ? boundaryRanks[d + 1] : 0;
    betti[d] = Math.max(nullityK - rankKp1, 0);
  }
  return betti;
}
function eulerCharacteristic(sc) {
  let chi = 0;
  for (let d = 0; d < sc.fVector.length; d++) {
    chi += (d % 2 === 0 ? 1 : -1) * sc.fVector[d];
  }
  return chi;
}
function simplicialDegree(sc, options = {}) {
  const { normalized = false } = options;
  const n = sc.nNodes;
  const maxD = sc.dimension;
  const mat = Array.from({ length: n }, () => new Array(maxD + 1).fill(0));
  for (const simplex of sc.simplices) {
    const d = simplex.length - 1;
    for (const v of simplex) mat[v][d]++;
  }
  if (normalized && n > 1) {
    for (let d = 0; d <= maxD; d++) {
      const denom = choose(n - 1, d);
      if (denom > 0) {
        for (let v = 0; v < n; v++) mat[v][d] = mat[v][d] / denom;
      }
    }
  }
  const rows = [];
  for (let v = 0; v < n; v++) {
    const byDim = mat[v].slice();
    let total = 0;
    for (let d = 1; d <= maxD; d++) total += byDim[d];
    rows.push({ index: v, node: sc.nodes[v], byDim, total });
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}
function countComponents(adj) {
  const n = adj.length;
  if (n === 0) return 0;
  const visited = new Array(n).fill(false);
  let components = 0;
  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;
    components++;
    const queue = [start];
    visited[start] = true;
    while (queue.length > 0) {
      const v = queue.shift();
      const row = adj[v];
      for (let u = 0; u < n; u++) {
        if (row[u] && !visited[u]) {
          visited[u] = true;
          queue.push(u);
        }
      }
    }
  }
  return components;
}
function qAnalysis(sc) {
  const simplices = sc.simplices;
  const dims = simplices.map((s) => s.length - 1);
  const structureVector = new Array(sc.nNodes).fill(-1);
  for (let i = 0; i < simplices.length; i++) {
    const d = dims[i];
    for (const v of simplices[i]) {
      if (d > structureVector[v]) structureVector[v] = d;
    }
  }
  const simplexSets = simplices.map((s) => new Set(s));
  const isMaximal = new Array(simplices.length).fill(true);
  for (let i = 0; i < simplices.length; i++) {
    const si = simplices[i];
    const di = dims[i];
    for (let j = 0; j < simplices.length; j++) {
      if (j === i) continue;
      if (dims[j] <= di) continue;
      const sj = simplexSets[j];
      let contained = true;
      for (const v of si) {
        if (!sj.has(v)) {
          contained = false;
          break;
        }
      }
      if (contained) {
        isMaximal[i] = false;
        break;
      }
    }
  }
  const maximalIdx = [];
  for (let i = 0; i < simplices.length; i++) if (isMaximal[i]) maximalIdx.push(i);
  const nMax = maximalIdx.length;
  const maxQ = nMax > 0 ? Math.max(...maximalIdx.map((i) => dims[i])) : 0;
  if (nMax <= 1) {
    const qVector2 = new Array(maxQ + 1).fill(1);
    return { qVector: qVector2, maxQ, structureVector };
  }
  const shared = Array.from({ length: nMax }, () => new Array(nMax).fill(-1));
  for (let i = 0; i < nMax - 1; i++) {
    const a = simplexSets[maximalIdx[i]];
    for (let j = i + 1; j < nMax; j++) {
      const b = simplexSets[maximalIdx[j]];
      let common = 0;
      for (const v of a) if (b.has(v)) common++;
      const dim = common - 1;
      shared[i][j] = dim;
      shared[j][i] = dim;
    }
  }
  const qVector = new Array(maxQ + 1).fill(0);
  for (let q = 0; q <= maxQ; q++) {
    const adj = Array.from({ length: nMax }, () => new Array(nMax).fill(false));
    for (let i = 0; i < nMax; i++) {
      for (let j = 0; j < nMax; j++) {
        if (i !== j && shared[i][j] >= q) adj[i][j] = true;
      }
    }
    qVector[q] = countComponents(adj);
  }
  return { qVector, maxQ, structureVector };
}
function filterCliqueComplex(mat, maxDim, nodes) {
  const n = mat.rows;
  const sym = Array.from({ length: n }, () => new Array(n).fill(0));
  let maxW = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const w = mat.get(i, j);
      sym[i][j] = w;
      if (w > maxW) maxW = w;
    }
  }
  const adj = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i !== j && sym[i][j] > 0) adj[i][j] = true;
  }
  if (!hasAnyEdge(adj)) {
    const simplices = Array.from({ length: n }, (_, i) => [i]);
    return {
      simplices,
      dim: new Array(n).fill(0),
      filtAsc: new Array(n).fill(0),
      key: simplices.map((s) => s.join(",")),
      nodes,
      maxFilt: 0,
      maxW,
      mode: "clique"
    };
  }
  const maximal = maximalCliques(adj);
  const allSimplices = expandToFaces(maximal, maxDim);
  const filt = new Array(allSimplices.length);
  const dim = new Array(allSimplices.length);
  for (let j = 0; j < allSimplices.length; j++) {
    const s = allSimplices[j];
    dim[j] = s.length - 1;
    if (s.length === 1) {
      filt[j] = 0;
      continue;
    }
    let minW = Infinity;
    for (let a = 0; a < s.length - 1; a++) {
      for (let b = a + 1; b < s.length; b++) {
        const w = sym[s[a]][s[b]];
        if (w < minW) minW = w;
      }
    }
    filt[j] = maxW - minW;
  }
  return finalizeFiltration(allSimplices, dim, filt, nodes, maxW, "clique");
}
function filterVrComplex(d, maxDim, nodes, maxScale) {
  const n = d.rows;
  const dist = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = d.get(i, j);
      const b = d.get(j, i);
      const w = Math.max(a, b);
      if (w < 0) throw new Error('persistentHomology(type="vr"): distance matrix must be non-negative');
      dist[i][j] = w;
    }
  }
  let maxFinite = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const w = dist[i][j];
    if (Number.isFinite(w) && w > maxFinite) maxFinite = w;
  }
  const cap = maxScale != null ? maxScale : maxFinite;
  if (cap < 0) throw new Error('persistentHomology(type="vr"): maxScale must be \u2265 0');
  const adj = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i !== j && Number.isFinite(dist[i][j]) && dist[i][j] >= 0 && dist[i][j] <= cap) {
      adj[i][j] = true;
    }
  }
  const maximal = maximalCliques(adj);
  const allSimplices = expandToFaces(maximal, maxDim);
  const filt = new Array(allSimplices.length);
  const dim = new Array(allSimplices.length);
  for (let j = 0; j < allSimplices.length; j++) {
    const s = allSimplices[j];
    dim[j] = s.length - 1;
    if (s.length === 1) {
      filt[j] = 0;
      continue;
    }
    let maxD = 0;
    for (let a = 0; a < s.length - 1; a++) {
      for (let b = a + 1; b < s.length; b++) {
        const w = dist[s[a]][s[b]];
        if (w > maxD) maxD = w;
      }
    }
    filt[j] = maxD;
  }
  return finalizeFiltration(allSimplices, dim, filt, nodes, cap, "vr");
}
function hasAnyEdge(adj) {
  const n = adj.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (adj[i][j]) return true;
  return false;
}
function finalizeFiltration(simplices, dim, filt, nodes, maxW, mode) {
  const ord = Array.from({ length: simplices.length }, (_, i) => i);
  ord.sort((a, b) => {
    const da = filt[a] - filt[b];
    if (da !== 0) return da;
    return dim[a] - dim[b];
  });
  const sSim = ord.map((i) => simplices[i]);
  const sDim = ord.map((i) => dim[i]);
  const sFilt = ord.map((i) => filt[i]);
  const keys = sSim.map((s) => s.join(","));
  return {
    simplices: sSim,
    dim: sDim,
    filtAsc: sFilt,
    key: keys,
    nodes,
    maxFilt: sFilt.length > 0 ? sFilt[sFilt.length - 1] : 0,
    maxW,
    mode
  };
}
function persistencePairsZ2(fc) {
  const N = fc.simplices.length;
  if (N === 0) return { pairs: [], essential: [] };
  const keyToIdx = /* @__PURE__ */ new Map();
  for (let i = 0; i < N; i++) keyToIdx.set(fc.key[i], i);
  const D = new Array(N);
  for (let j = 0; j < N; j++) {
    if (fc.dim[j] < 1) {
      D[j] = [];
      continue;
    }
    const s = fc.simplices[j];
    const faceIdx = [];
    for (let i = 0; i < s.length; i++) {
      const face = [];
      for (let q = 0; q < s.length; q++) if (q !== i) face.push(s[q]);
      face.sort((a, b) => a - b);
      const k = face.join(",");
      const idx = keyToIdx.get(k);
      if (idx !== void 0) faceIdx.push(idx);
    }
    faceIdx.sort((a, b) => a - b);
    D[j] = faceIdx;
  }
  const lowToCol = new Int32Array(N);
  const pairedB = [];
  const pairedD = [];
  for (let j = 0; j < N; j++) {
    let col = D[j];
    while (col.length > 0) {
      const l = col[col.length - 1];
      const iPlus1 = lowToCol[l];
      if (iPlus1 === 0) break;
      const i = iPlus1 - 1;
      col = symDiffSorted(col, D[i]);
    }
    D[j] = col;
    if (col.length > 0) {
      const l = col[col.length - 1];
      lowToCol[l] = j + 1;
      pairedB.push(l);
      pairedD.push(j);
    }
  }
  const pairedSet = /* @__PURE__ */ new Set([...pairedB, ...pairedD]);
  const essentialIdx = [];
  for (let i = 0; i < N; i++) if (!pairedSet.has(i)) essentialIdx.push(i);
  const pairs = [];
  for (let p = 0; p < pairedB.length; p++) {
    const b = pairedB[p];
    const d = pairedD[p];
    const persistence = fc.filtAsc[d] - fc.filtAsc[b];
    if (persistence > 0) {
      pairs.push({
        dimension: fc.dim[b],
        birth: fc.filtAsc[b],
        death: fc.filtAsc[d],
        persistence
      });
    }
  }
  const essential = essentialIdx.map((i) => ({
    dimension: fc.dim[i],
    birth: fc.filtAsc[i],
    death: Infinity,
    persistence: Infinity
  }));
  return { pairs, essential };
}
function symDiffSorted(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (a[i] < b[j]) {
      out.push(a[i]);
      i++;
    } else {
      out.push(b[j]);
      j++;
    }
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}
function bettiCurveFromPairs(persistence, thresholds, maxDim, mode) {
  const rows = [];
  for (let d = 0; d <= maxDim; d++) {
    const subset = persistence.filter((p) => p.dimension === d);
    for (const t of thresholds) {
      let alive = 0;
      if (mode === "clique") {
        for (const p of subset) if (p.birth >= t && p.death < t) alive++;
      } else {
        for (const p of subset) if (p.birth <= t && p.death > t) alive++;
      }
      rows.push({ threshold: t, dimension: d, betti: alive });
    }
  }
  return rows;
}
function persistentHomology(x, options = {}) {
  const { nSteps = 20, maxDim = 3, type = "clique", maxScale, labels } = options;
  if (!Number.isInteger(nSteps) || nSteps < 1) {
    throw new Error("persistentHomology: nSteps must be a positive integer");
  }
  if (!Number.isInteger(maxDim) || maxDim < 0) {
    throw new Error("persistentHomology: maxDim must be a non-negative integer");
  }
  const { mat, labels: nodeLabels } = extractAdjacency(x, labels);
  let fc;
  if (type === "vr") {
    fc = filterVrComplex(mat, maxDim, nodeLabels, maxScale);
    if (fc.maxW === 0 && fc.maxFilt === 0 && fc.dim.every((d) => d === 0)) {
      throw new Error('persistentHomology(type="vr"): all distances are zero or excluded; cannot build filtration');
    }
  } else {
    const n = mat.rows;
    const cMat = new Matrix(n, n);
    let nonzero = false;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const w = Math.max(Math.abs(mat.get(i, j)), Math.abs(mat.get(j, i)));
      cMat.set(i, j, w);
      if (w > 0) nonzero = true;
    }
    if (!nonzero) throw new Error('persistentHomology(type="clique"): all weights are zero; cannot build filtration');
    fc = filterCliqueComplex(cMat, maxDim, nodeLabels);
  }
  const reduced = persistencePairsZ2(fc);
  let persistence;
  let thresholds;
  if (fc.mode === "clique") {
    const maxW = fc.maxW;
    const inverted = reduced.pairs.map((p) => ({
      dimension: p.dimension,
      birth: maxW - p.birth,
      death: maxW - p.death,
      persistence: maxW - p.birth - (maxW - p.death)
    }));
    const essentialClique = reduced.essential.map((p) => ({
      dimension: p.dimension,
      birth: maxW - p.birth,
      death: 0,
      persistence: maxW - p.birth
    }));
    persistence = inverted.concat(essentialClique);
    thresholds = linspace(maxW, maxW * 0.01, nSteps);
  } else {
    persistence = reduced.pairs.concat(reduced.essential);
    const top = Math.max(fc.maxFilt, Number.EPSILON);
    thresholds = linspace(0, top, nSteps);
  }
  persistence.sort((a, b) => {
    if (a.persistence === b.persistence) return 0;
    if (a.persistence === Infinity) return -1;
    if (b.persistence === Infinity) return 1;
    return b.persistence - a.persistence;
  });
  persistence = persistence.filter((p) => p.dimension <= maxDim);
  const bettiCurve = bettiCurveFromPairs(persistence, thresholds, maxDim, fc.mode);
  return { bettiCurve, persistence, thresholds, mode: fc.mode };
}
function linspace(from, to, n) {
  if (n <= 0) return [];
  if (n === 1) return [from];
  const step = (to - from) / (n - 1);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = from + step * i;
  out[n - 1] = to;
  return out;
}
function toPairs(d) {
  if (Array.isArray(d)) return d;
  return d.persistence;
}
function isEssentialPair(p) {
  return !Number.isFinite(p.death) || p.death === 0;
}
function bottleneckFinite(p1, p2, tol) {
  const n1 = p1.length, n2 = p2.length;
  if (n1 === 0 && n2 === 0) return 0;
  if (n1 === 0) {
    let max = 0;
    for (const p of p2) {
      const v = Math.abs(p.death - p.birth) / 2;
      if (v > max) max = v;
    }
    return max;
  }
  if (n2 === 0) {
    let max = 0;
    for (const p of p1) {
      const v = Math.abs(p.death - p.birth) / 2;
      if (v > max) max = v;
    }
    return max;
  }
  const dPair = Array.from({ length: n1 }, () => new Array(n2).fill(0));
  for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
    const db = Math.abs(p1[i].birth - p2[j].birth);
    const dd = Math.abs(p1[i].death - p2[j].death);
    dPair[i][j] = Math.max(db, dd);
  }
  const dDiag1 = p1.map((p) => Math.abs(p.death - p.birth) / 2);
  const dDiag2 = p2.map((p) => Math.abs(p.death - p.birth) / 2);
  const cands = /* @__PURE__ */ new Set([0]);
  for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) cands.add(dPair[i][j]);
  for (const v of dDiag1) cands.add(v);
  for (const v of dDiag2) cands.add(v);
  const sorted = Array.from(cands).sort((a, b) => a - b);
  if (!bottleneckFeasible(p1, p2, dPair, dDiag1, dDiag2, sorted[sorted.length - 1] + tol)) {
    return Infinity;
  }
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (bottleneckFeasible(p1, p2, dPair, dDiag1, dDiag2, sorted[mid] + tol)) hi = mid;
    else lo = mid + 1;
  }
  return sorted[lo];
}
function bottleneckFeasible(p1, p2, dPair, dDiag1, dDiag2, eps) {
  const n1 = p1.length, n2 = p2.length;
  const L = n1 + n2;
  const R = n1 + n2;
  const adj = Array.from({ length: L }, () => new Array(R).fill(false));
  for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
    if (dPair[i][j] <= eps) adj[i][j] = true;
  }
  for (let i = 0; i < n1; i++) {
    if (dDiag1[i] <= eps) adj[i][n2 + i] = true;
  }
  for (let j = 0; j < n2; j++) {
    if (dDiag2[j] <= eps) adj[n1 + j][j] = true;
  }
  for (let j = 0; j < n2; j++) for (let i = 0; i < n1; i++) {
    adj[n1 + j][n2 + i] = true;
  }
  return kuhnMatchSize(adj) === L;
}
function kuhnMatchSize(adj) {
  const nL = adj.length;
  if (nL === 0) return 0;
  const nR = adj[0].length;
  if (nR === 0) return 0;
  const matchR = new Int32Array(nR).fill(-1);
  let count = 0;
  function tryAugment(u, visited) {
    const row = adj[u];
    for (let v = 0; v < nR; v++) {
      if (!row[v] || visited[v]) continue;
      visited[v] = true;
      if (matchR[v] === -1 || tryAugment(matchR[v], visited)) {
        matchR[v] = u;
        return true;
      }
    }
    return false;
  }
  for (let u = 0; u < nL; u++) {
    const visited = new Array(nR).fill(false);
    if (tryAugment(u, visited)) count++;
  }
  return count;
}
function bottleneckDistance(d1, d2, options = {}) {
  const { tol = Math.sqrt(Number.EPSILON) } = options;
  const p1 = toPairs(d1);
  const p2 = toPairs(d2);
  const dimsInDiagrams = /* @__PURE__ */ new Set();
  for (const p of p1) dimsInDiagrams.add(p.dimension);
  for (const p of p2) dimsInDiagrams.add(p.dimension);
  const dims = options.dimension ? options.dimension.map((d) => Math.floor(d)) : Array.from(dimsInDiagrams).sort((a, b) => a - b);
  const result = {};
  for (const k of dims) {
    const sub1 = p1.filter((p) => p.dimension === k);
    const sub2 = p2.filter((p) => p.dimension === k);
    const ess1 = sub1.filter(isEssentialPair);
    const ess2 = sub2.filter(isEssentialPair);
    const fin1 = sub1.filter((p) => !isEssentialPair(p));
    const fin2 = sub2.filter((p) => !isEssentialPair(p));
    let dimVal;
    if (ess1.length !== ess2.length) {
      dimVal = Infinity;
    } else {
      let essCost = 0;
      if (ess1.length > 0) {
        const b1 = ess1.map((p) => p.birth).sort((a, b) => a - b);
        const b2 = ess2.map((p) => p.birth).sort((a, b) => a - b);
        for (let i = 0; i < b1.length; i++) {
          const d = Math.abs(b1[i] - b2[i]);
          if (d > essCost) essCost = d;
        }
      }
      const finCost = bottleneckFinite(fin1, fin2, tol);
      dimVal = Math.max(essCost, finCost);
    }
    result[`dim_${k}`] = dimVal;
  }
  return result;
}
function persistenceLandscape(ph, options = {}) {
  const { kMax = 5, dimension = 1 } = options;
  if (!Number.isInteger(kMax) || kMax < 1) {
    throw new Error("persistenceLandscape: kMax must be a positive integer");
  }
  if (!Number.isInteger(dimension) || dimension < 0) {
    throw new Error("persistenceLandscape: dimension must be a non-negative integer");
  }
  const pairs = (Array.isArray(ph) ? ph : ph.persistence).filter((p) => p.dimension === dimension);
  const finite = pairs.filter((p) => Number.isFinite(p.death) && !(p.death === 0 && p.birth > 0));
  if (finite.length === 0) {
    const tGrid2 = options.tGrid ?? linspace(0, 1, 200);
    const landscape2 = [];
    for (let k = 1; k <= kMax; k++) {
      for (const t of tGrid2) landscape2.push({ k, t, value: 0 });
    }
    return { landscape: landscape2, dimension, kMax, tGrid: tGrid2 };
  }
  const bd = finite.map((p) => {
    const lo = Math.min(p.birth, p.death);
    const hi = Math.max(p.birth, p.death);
    return { lo, hi };
  });
  let tGrid;
  if (options.tGrid) {
    tGrid = options.tGrid.slice();
  } else {
    let minB = Infinity, maxD = -Infinity;
    for (const p of bd) {
      if (p.lo < minB) minB = p.lo;
      if (p.hi > maxD) maxD = p.hi;
    }
    if (!Number.isFinite(minB)) minB = 0;
    if (!Number.isFinite(maxD)) maxD = 1;
    tGrid = linspace(minB, maxD, 200);
  }
  const nT = tGrid.length;
  const nPairs = bd.length;
  const lambda = Array.from({ length: kMax }, () => new Array(nT).fill(0));
  for (let j = 0; j < nT; j++) {
    const t = tGrid[j];
    const col = new Array(nPairs);
    for (let i = 0; i < nPairs; i++) {
      const { lo, hi } = bd[i];
      col[i] = Math.max(0, Math.min(t - lo, hi - t));
    }
    col.sort((a, b) => b - a);
    for (let k = 0; k < kMax; k++) {
      lambda[k][j] = k < col.length ? col[k] : 0;
    }
  }
  const landscape = [];
  for (let k = 0; k < kMax; k++) {
    for (let j = 0; j < nT; j++) {
      landscape.push({ k: k + 1, t: tGrid[j], value: lambda[k][j] });
    }
  }
  return { landscape, dimension, kMax, tGrid };
}

// src/analysis/diagnostics.ts
function extractTransitionMatrix(x) {
  if (x instanceof Matrix) {
    if (!x.isSquare) throw new Error("transitionMatrix: must be square");
    const n = x.rows;
    return { P: x.clone(), labels: Array.from({ length: n }, (_, i) => `S${i + 1}`) };
  }
  if (Array.isArray(x)) {
    const P = Matrix.from2D(x);
    if (!P.isSquare) throw new Error("transitionMatrix: must be square");
    const n = P.rows;
    return { P, labels: Array.from({ length: n }, (_, i) => `S${i + 1}`) };
  }
  const tna = x;
  if (!tna.weights || !(tna.weights instanceof Matrix)) {
    throw new Error("transitionMatrix: TNA has no weight matrix");
  }
  const labels = tna.labels && tna.labels.length === tna.weights.rows ? tna.labels.slice() : Array.from({ length: tna.weights.rows }, (_, i) => `S${i + 1}`);
  return { P: tna.weights.clone(), labels };
}
function normalizeRows(P, labels, normalize) {
  const n = P.rows;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += P.get(i, j);
    if (sum <= 0) {
      throw new Error(
        `Transition matrix has zero-sum row(s) for state(s): ${labels[i]}. These states have no outgoing transitions, so the chain is not ergodic.`
      );
    }
    if (Math.abs(sum - 1) > 1e-6) {
      if (!normalize) throw new Error("Transition matrix rows must sum to 1.");
      for (let j = 0; j < n; j++) P.set(i, j, P.get(i, j) / sum);
    }
  }
  return P;
}
function entropyOfRow(row, base) {
  let h = 0;
  for (const p of row) {
    if (p > 0) h -= p * Math.log(p) / Math.log(base);
  }
  return h;
}
function stationaryReducibleFallback(P, n) {
  const adj = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (P.get(i, j) > 0) adj[i][j] = true;
  }
  let R = adj.map((row) => row.slice());
  for (let k2 = 0; k2 < n - 1; k2++) {
    const next = Array.from({ length: n }, () => new Array(n).fill(false));
    let changed = false;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let v = R[i][j];
        if (!v) {
          for (let m = 0; m < n; m++) {
            if (R[i][m] && adj[m][j]) {
              v = true;
              break;
            }
          }
        }
        if (v && !R[i][j]) changed = true;
        next[i][j] = v;
      }
    }
    R = next;
    if (!changed) break;
  }
  for (let i = 0; i < n; i++) R[i][i] = true;
  const used = new Array(n).fill(false);
  const sccs = [];
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const cls = [];
    for (let j = 0; j < n; j++) {
      if (!used[j] && R[i][j] && R[j][i]) {
        cls.push(j);
        used[j] = true;
      }
    }
    if (cls.length > 0) sccs.push(cls);
  }
  const closed = sccs.filter((cls) => {
    const inCls = new Set(cls);
    for (const i of cls) {
      for (let j = 0; j < n; j++) {
        if (!inCls.has(j) && adj[i][j]) return false;
      }
    }
    return true;
  });
  closed.sort((a, b) => Math.min(...a) - Math.min(...b));
  const block = closed[0] ?? sccs[0];
  const k = block.length;
  const A = new Matrix(k, k);
  const invK = 1 / k;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    A.set(i, j, (i === j ? 1 : 0) - P.get(block[j], block[i]) + invK);
  }
  const rhs = new Float64Array(k);
  for (let i = 0; i < k; i++) rhs[i] = invK;
  let piSub;
  try {
    const sol = solveLinear(A, rhs);
    piSub = new Array(k);
    let sum = 0;
    for (let i = 0; i < k; i++) {
      const v = Math.abs(sol.get(i, 0));
      piSub[i] = v;
      sum += v;
    }
    for (let i = 0; i < k; i++) piSub[i] = piSub[i] / sum;
  } catch (_e) {
    piSub = new Array(k).fill(1 / k);
  }
  const pi = new Array(n).fill(0);
  for (let i = 0; i < k; i++) pi[block[i]] = piSub[i];
  return pi;
}
function transitionEntropy(x, options = {}) {
  const { base = 2, normalize = true } = options;
  if (!Number.isFinite(base) || base <= 0 || base === 1) {
    throw new Error("transitionEntropy: base must be positive and != 1");
  }
  const { P: P0, labels } = extractTransitionMatrix(x);
  const P = normalizeRows(P0, labels, normalize);
  const n = P.rows;
  let pi;
  try {
    pi = Array.from(eigenDominantLeft(P));
  } catch (_e) {
    pi = stationaryReducibleFallback(P, n);
  }
  let needsRenorm = false;
  for (let i = 0; i < n; i++) {
    if (pi[i] <= 0) {
      pi[i] = Number.EPSILON;
      needsRenorm = true;
    }
  }
  if (needsRenorm) {
    const s = pi.reduce((a, b) => a + b, 0);
    for (let i = 0; i < n; i++) pi[i] /= s;
  }
  const rowEntropy = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) row.push(P.get(i, j));
    rowEntropy[i] = entropyOfRow(row, base);
  }
  const stationaryEntropy = entropyOfRow(pi, base);
  let entropyRate = 0;
  for (let i = 0; i < n; i++) entropyRate += pi[i] * rowEntropy[i];
  const maxEntropy = n > 0 ? Math.log(n) / Math.log(base) : 0;
  const norm = (v) => maxEntropy > 0 ? v / maxEntropy : 0;
  const rowEntropyNorm = rowEntropy.map(norm);
  const stationaryEntropyNorm = norm(stationaryEntropy);
  const entropyRateNorm = norm(entropyRate);
  const redundancy = stationaryEntropy - entropyRate;
  const redundancyNorm = stationaryEntropy > 0 ? redundancy / stationaryEntropy : 0;
  return {
    rowEntropy,
    rowEntropyNorm,
    stationary: pi,
    stationaryEntropy,
    stationaryEntropyNorm,
    entropyRate,
    entropyRateNorm,
    redundancy,
    redundancyNorm,
    maxEntropy,
    base,
    states: labels
  };
}
function supportGraph(P, tol) {
  const n = P.rows;
  const adj = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (P.get(i, j) > tol) adj[i][j] = true;
  }
  return adj;
}
function reachability(adj) {
  const n = adj.length;
  let R = adj.map((row) => row.slice());
  for (let k = 0; k < n - 1; k++) {
    const next = Array.from({ length: n }, () => new Array(n).fill(false));
    let changed = false;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (R[i][j]) {
          next[i][j] = true;
          continue;
        }
        let v = false;
        for (let m = 0; m < n; m++) {
          if (R[i][m] && adj[m][j]) {
            v = true;
            break;
          }
        }
        if (v) {
          next[i][j] = true;
          changed = true;
        } else if (R[i][j]) {
          next[i][j] = true;
        }
      }
    }
    if (!changed) {
      R = next;
      break;
    }
    R = next;
  }
  return R;
}
function stronglyConnectedComponents(adj) {
  const n = adj.length;
  if (n === 0) return [];
  const R = reachability(adj);
  for (let i = 0; i < n; i++) R[i][i] = true;
  const sameClass = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (R[i][j] && R[j][i]) sameClass[i][j] = true;
  }
  const keyToIdx = /* @__PURE__ */ new Map();
  const classes = [];
  for (let i = 0; i < n; i++) {
    let key = "";
    for (let j = 0; j < n; j++) key += sameClass[i][j] ? "1" : "0";
    let idx = keyToIdx.get(key);
    if (idx === void 0) {
      idx = classes.length;
      classes.push([]);
      keyToIdx.set(key, idx);
    }
    classes[idx].push(i);
  }
  return classes;
}
function gcdAll(values) {
  const xs = values.filter((v) => v > 0);
  if (xs.length === 0) return NaN;
  const gcd2 = (a, b) => {
    while (b !== 0) {
      const t = a % b;
      a = b;
      b = t;
    }
    return a;
  };
  let g = xs[0];
  for (let i = 1; i < xs.length; i++) {
    g = gcd2(g, xs[i]);
    if (g === 1) return 1;
  }
  return g;
}
function classPeriod(adjSub) {
  const n = adjSub.length;
  if (n === 0) return NaN;
  if (n === 1) return adjSub[0][0] ? 1 : NaN;
  const bmul = (A, B) => {
    const out = Array.from({ length: n }, () => new Array(n).fill(false));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        if (A[i][k] && B[k][j]) {
          out[i][j] = true;
          break;
        }
      }
    }
    return out;
  };
  let running = adjSub.map((row) => row.slice());
  const cycleLengths = [];
  let anyDiag = false;
  for (let i = 0; i < n; i++) if (running[i][i]) {
    anyDiag = true;
    break;
  }
  if (anyDiag) cycleLengths.push(1);
  for (let k = 2; k <= 2 * n; k++) {
    running = bmul(running, adjSub);
    anyDiag = false;
    for (let i = 0; i < n; i++) if (running[i][i]) {
      anyDiag = true;
      break;
    }
    if (anyDiag) {
      cycleLengths.push(k);
      if (cycleLengths.length >= 3 && gcdAll(cycleLengths) === 1) break;
    }
  }
  return gcdAll(cycleLengths);
}
function hittingProbabilities(P, reach) {
  const n = P.rows;
  const H = new Matrix(n, n);
  for (let j = 0; j < n; j++) {
    if (n === 1) {
      H.set(0, 0, P.get(0, 0) > 0 ? 1 : 0);
      continue;
    }
    const canReach = [];
    for (let i = 0; i < n; i++) {
      if (i !== j && reach[i][j]) canReach.push(i);
    }
    if (canReach.length === 0) continue;
    const sz = canReach.length;
    const A = new Matrix(sz, sz);
    const b = new Float64Array(sz);
    for (let a = 0; a < sz; a++) {
      for (let bIdx = 0; bIdx < sz; bIdx++) {
        const i = canReach[a], k = canReach[bIdx];
        A.set(a, bIdx, (a === bIdx ? 1 : 0) - P.get(i, k));
      }
      b[a] = P.get(canReach[a], j);
    }
    try {
      const sol = solveLinear(A, b);
      for (let a = 0; a < sz; a++) H.set(canReach[a], j, sol.get(a, 0));
    } catch (_e) {
    }
  }
  for (let j = 0; j < n; j++) {
    let v = P.get(j, j);
    for (let k = 0; k < n; k++) if (k !== j) v += P.get(j, k) * H.get(k, j);
    H.set(j, j, v);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = H.get(i, j);
    if (Number.isFinite(v)) H.set(i, j, Math.min(Math.max(v, 0), 1));
  }
  return H;
}
function absorptionAnalysis(P, transientIdx, absorbingIdx, labels) {
  if (absorbingIdx.length === 0 || transientIdx.length === 0) {
    return { probabilities: null, meanTime: null };
  }
  const t = transientIdx.length, a = absorbingIdx.length;
  const IQ = new Matrix(t, t);
  for (let i = 0; i < t; i++) for (let j = 0; j < t; j++) {
    IQ.set(i, j, (i === j ? 1 : 0) - P.get(transientIdx[i], transientIdx[j]));
  }
  const R = new Matrix(t, a);
  for (let i = 0; i < t; i++) for (let j = 0; j < a; j++) {
    R.set(i, j, P.get(transientIdx[i], absorbingIdx[j]));
  }
  let probabilities;
  let meanTime;
  try {
    const I = new Matrix(t, t);
    for (let i = 0; i < t; i++) I.set(i, i, 1);
    const N = solveLinear(IQ, I);
    probabilities = new Matrix(t, a);
    for (let i = 0; i < t; i++) for (let j = 0; j < a; j++) {
      let s = 0;
      for (let k = 0; k < t; k++) s += N.get(i, k) * R.get(k, j);
      probabilities.set(i, j, s);
    }
    meanTime = new Array(t);
    for (let i = 0; i < t; i++) {
      let s = 0;
      for (let k = 0; k < t; k++) s += N.get(i, k);
      meanTime[i] = s;
    }
  } catch (_e) {
    return { probabilities: null, meanTime: null };
  }
  return { probabilities, meanTime };
}
function chainStructure(x, options = {}) {
  const { normalize = true, tol = 1e-10 } = options;
  const { P: P0, labels } = extractTransitionMatrix(x);
  const P = normalizeRows(P0, labels, normalize);
  const n = P.rows;
  const adj = supportGraph(P, tol);
  const classes = stronglyConnectedComponents(adj);
  const isClosed = classes.map((cls) => {
    if (cls.length === n) return true;
    const inCls = new Set(cls);
    for (const i of cls) {
      for (let j = 0; j < n; j++) {
        if (!inCls.has(j) && adj[i][j]) return false;
      }
    }
    return true;
  });
  const recurrentClasses = classes.filter((_, i) => isClosed[i]);
  const transientClasses = classes.filter((_, i) => !isClosed[i]);
  const recurrentIdx = recurrentClasses.flat().sort((a, b) => a - b);
  const transientIdx = transientClasses.flat().sort((a, b) => a - b);
  const absorbingTol = Math.sqrt(Number.EPSILON);
  const absorbingIdx = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(P.get(i, i) - 1) < absorbingTol) absorbingIdx.push(i);
  }
  const classification = new Array(n);
  for (const i of recurrentIdx) classification[i] = "recurrent";
  for (const i of transientIdx) classification[i] = "transient";
  for (const i of absorbingIdx) classification[i] = "absorbing";
  const period = new Array(n).fill(null);
  for (const cls of recurrentClasses) {
    const sz = cls.length;
    const sub = Array.from({ length: sz }, () => new Array(sz).fill(false));
    for (let a = 0; a < sz; a++) for (let b = 0; b < sz; b++) sub[a][b] = adj[cls[a]][cls[b]];
    const p = classPeriod(sub);
    for (const i of cls) period[i] = Number.isFinite(p) ? p : null;
  }
  const isIrreducible = classes.length === 1;
  const isAperiodic = recurrentClasses.length > 0 && recurrentIdx.every((i) => period[i] === 1);
  const isRegular = isIrreducible && isAperiodic;
  let isReversible = null;
  if (isIrreducible) {
    try {
      const pi = eigenDominantLeft(P);
      let maxDev = 0, maxAbs = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const f = pi[i] * P.get(i, j);
        const g = pi[j] * P.get(j, i);
        const d = Math.abs(f - g);
        if (d > maxDev) maxDev = d;
        if (Math.abs(f) > maxAbs) maxAbs = Math.abs(f);
      }
      isReversible = maxDev < tol * Math.max(maxAbs, 1);
    } catch (_e) {
      isReversible = null;
    }
  }
  const reach = reachability(adj);
  for (let i = 0; i < n; i++) reach[i][i] = true;
  const H = hittingProbabilities(P, reach);
  const abs = absorptionAnalysis(P, transientIdx, absorbingIdx);
  return {
    states: labels,
    classification,
    communicatingClasses: classes.map((cls) => cls.map((i) => labels[i])),
    recurrentClasses: recurrentClasses.map((cls) => cls.map((i) => labels[i])),
    transientClasses: transientClasses.map((cls) => cls.map((i) => labels[i])),
    absorbingStates: absorbingIdx.map((i) => labels[i]),
    period,
    isIrreducible,
    isAperiodic,
    isRegular,
    isReversible,
    hittingProbabilities: H,
    absorptionProbabilities: abs.probabilities,
    meanAbsorptionTime: abs.meanTime,
    P
  };
}
function stateDistribution(x) {
  const { P, labels } = extractTransitionMatrix(x);
  const n = P.rows;
  let total = 0;
  const col = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = P.get(i, j);
    col[j] += v;
    total += v;
  }
  return labels.map((state, j) => ({
    state,
    proportion: total > 0 ? col[j] / total : 0
  }));
}

// src/analysis/hypergraph.ts
function buildHypergraph(net, options = {}) {
  const {
    p = 1,
    method = "clique",
    includePairwise = true,
    maxSize = 3,
    threshold = 0,
    seed = 42,
    labels
  } = options;
  if (method !== "clique") throw new Error(`buildHypergraph: method='${method}' not implemented`);
  if (!(p >= 0 && p <= 1)) throw new Error("buildHypergraph: p must be in [0, 1]");
  if (!Number.isInteger(maxSize) || maxSize < 2) throw new Error("buildHypergraph: maxSize must be an integer \u2265 2");
  let simplices;
  let nodes;
  if (net.simplices !== void 0 && net.nodes !== void 0) {
    const sc = net;
    simplices = sc.simplices.map((s) => s.slice());
    nodes = sc.nodes.slice();
  } else {
    const sc = buildSimplicial(net, {
      type: "clique",
      threshold,
      maxDim: maxSize - 1,
      labels
    });
    simplices = sc.simplices.map((s) => s.slice());
    nodes = sc.nodes.slice();
  }
  const sizes = simplices.map((s) => s.length);
  const edges2 = simplices.filter((_, i) => sizes[i] === 2);
  const hiSimps = simplices.filter((_, i) => sizes[i] >= 3 && sizes[i] <= maxSize);
  let sampledHi;
  if (hiSimps.length === 0 || p <= 0) {
    sampledHi = [];
  } else if (p >= 1) {
    sampledHi = hiSimps;
  } else {
    const rng = new SeededRNG(seed);
    sampledHi = hiSimps.filter(() => rng.random() < p);
  }
  const hyperedges = includePairwise ? edges2.concat(sampledHi) : sampledHi;
  const m = hyperedges.length;
  const n = nodes.length;
  const incidence = new Matrix(n, m);
  for (let j = 0; j < m; j++) {
    for (const v of hyperedges[j]) incidence.set(v, j, 1);
  }
  const sizeDistribution = {};
  for (const he of hyperedges) {
    const k = he.length;
    const key = `size_${k}`;
    sizeDistribution[key] = (sizeDistribution[key] ?? 0) + 1;
  }
  return {
    hyperedges,
    incidence,
    nodes,
    nNodes: n,
    nHyperedges: m,
    sizeDistribution,
    params: { method, p, includePairwise, maxSize, threshold, seed }
  };
}
function bipartiteGroups(data, player, group, options = {}) {
  const { weight } = options;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("bipartiteGroups: data must be a non-empty array");
  }
  const rows = data.filter(
    (r) => r[player] != null && r[player] !== "" && r[group] != null && r[group] !== "" && (!weight || r[weight] != null && r[weight] !== "")
  );
  if (rows.length === 0) {
    throw new Error("bipartiteGroups: no complete observations after dropping NAs");
  }
  const playerVals = rows.map((r) => String(r[player]));
  const groupVals = rows.map((r) => String(r[group]));
  const playerLevels = Array.from(new Set(playerVals)).sort();
  const groupLevels = Array.from(new Set(groupVals)).sort();
  const playerIdx = new Map(playerLevels.map((v, i) => [v, i]));
  const groupIdx = new Map(groupLevels.map((v, i) => [v, i]));
  const nP = playerLevels.length;
  const nG = groupLevels.length;
  const inc = new Matrix(nP, nG);
  if (!weight) {
    for (let i = 0; i < rows.length; i++) {
      const pi = playerIdx.get(playerVals[i]);
      const gj = groupIdx.get(groupVals[i]);
      if (inc.get(pi, gj) === 0) inc.set(pi, gj, 1);
    }
  } else {
    for (let i = 0; i < rows.length; i++) {
      const pi = playerIdx.get(playerVals[i]);
      const gj = groupIdx.get(groupVals[i]);
      const w = Number(rows[i][weight]);
      inc.set(pi, gj, inc.get(pi, gj) + (Number.isFinite(w) ? w : 0));
    }
  }
  const keep = [];
  for (let j = 0; j < nG; j++) {
    let any = false;
    for (let i = 0; i < nP; i++) if (inc.get(i, j) > 0) {
      any = true;
      break;
    }
    if (any) keep.push(j);
  }
  const trimmedNG = keep.length;
  const trimmedInc = new Matrix(nP, trimmedNG);
  const trimmedGroups = [];
  for (let nj = 0; nj < trimmedNG; nj++) {
    const oj = keep[nj];
    trimmedGroups.push(groupLevels[oj]);
    for (let i = 0; i < nP; i++) trimmedInc.set(i, nj, inc.get(i, oj));
  }
  const hyperedges = [];
  for (let j = 0; j < trimmedNG; j++) {
    const he = [];
    for (let i = 0; i < nP; i++) if (trimmedInc.get(i, j) > 0) he.push(i);
    hyperedges.push(he);
  }
  const sizeDistribution = {};
  for (const he of hyperedges) {
    const k = he.length;
    const key = `size_${k}`;
    sizeDistribution[key] = (sizeDistribution[key] ?? 0) + 1;
  }
  return {
    hyperedges,
    incidence: trimmedInc,
    nodes: playerLevels,
    nNodes: nP,
    nHyperedges: trimmedNG,
    sizeDistribution,
    params: {
      source: "bipartiteGroups",
      player,
      group,
      weight: weight ?? null,
      nObservations: rows.length
    }
  };
}
function cliqueExpansion(hg, options = {}) {
  const { weighted = true } = options;
  const n = hg.nNodes;
  const m = hg.nHyperedges;
  const W = new Matrix(n, n);
  if (m > 0) {
    const B = hg.incidence;
    for (let i = 0; i < n; i++) {
      for (let k = i; k < n; k++) {
        let s = 0;
        for (let j = 0; j < m; j++) {
          const a = weighted ? B.get(i, j) : B.get(i, j) > 0 ? 1 : 0;
          const b = weighted ? B.get(k, j) : B.get(k, j) > 0 ? 1 : 0;
          s += a * b;
        }
        if (i === k) continue;
        W.set(i, k, s);
        W.set(k, i, s);
      }
    }
  }
  return {
    weights: W,
    nodes: hg.nodes.slice(),
    params: {
      source: "cliqueExpansion",
      weighted,
      nHyperedges: m,
      hypergraphSizeDistribution: hg.sizeDistribution
    }
  };
}
function choose2(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let res = 1;
  for (let i = 0; i < k; i++) res = res * (n - i) / (i + 1);
  return Math.round(res);
}
function hypergraphMeasures(hg) {
  const n = hg.nNodes;
  const m = hg.nHyperedges;
  if (m === 0) {
    return {
      hyperdegree: new Array(n).fill(0),
      nodeStrength: new Array(n).fill(0),
      maxEdgeSize: new Array(n).fill(0),
      coDegree: new Matrix(n, n),
      edgeSizes: [],
      edgePairwiseOverlap: new Matrix(0, 0),
      overlapCoefficient: new Matrix(0, 0),
      jaccard: new Matrix(0, 0),
      density: 0,
      avgEdgeSize: 0,
      sizeDistribution: hg.sizeDistribution,
      intersectionProfile: {},
      pairwiseParticipation: 0,
      nNodes: n,
      nHyperedges: 0
    };
  }
  const B = hg.incidence;
  const Bb = new Matrix(n, m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) Bb.set(i, j, B.get(i, j) > 0 ? 1 : 0);
  const edgeSizes = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Bb.get(i, j);
    edgeSizes[j] = s;
  }
  const hyperdegree = new Array(n).fill(0);
  const nodeStrength = new Array(n).fill(0);
  const maxEdgeSize = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (Bb.get(i, j) > 0) {
        hyperdegree[i]++;
        nodeStrength[i] += edgeSizes[j];
        if (edgeSizes[j] > maxEdgeSize[i]) maxEdgeSize[i] = edgeSizes[j];
      }
    }
  }
  const coDegree = new Matrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let k = i + 1; k < n; k++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += Bb.get(i, j) * Bb.get(k, j);
      coDegree.set(i, k, s);
      coDegree.set(k, i, s);
    }
  }
  const edgePairwiseOverlap = new Matrix(m, m);
  for (let j = 0; j < m; j++) {
    for (let l = j + 1; l < m; l++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += Bb.get(i, j) * Bb.get(i, l);
      edgePairwiseOverlap.set(j, l, s);
      edgePairwiseOverlap.set(l, j, s);
    }
  }
  const overlapCoefficient = new Matrix(m, m);
  const jaccard = new Matrix(m, m);
  for (let j = 0; j < m; j++) {
    for (let l = 0; l < m; l++) {
      if (j === l) continue;
      const ov = edgePairwiseOverlap.get(j, l);
      const sMin = Math.min(edgeSizes[j], edgeSizes[l]);
      const sUnion = edgeSizes[j] + edgeSizes[l] - ov;
      overlapCoefficient.set(j, l, sMin > 0 ? ov / sMin : 0);
      jaccard.set(j, l, sUnion > 0 ? ov / sUnion : 0);
    }
  }
  const uniqSizes = new Set(edgeSizes);
  let density;
  if (uniqSizes.size === 1) {
    const k = edgeSizes[0];
    density = k > n ? 0 : m / choose2(n, k);
  } else {
    let sumK = 0;
    for (const k of edgeSizes) sumK += k;
    density = sumK / (n * m);
  }
  const avgEdgeSize = edgeSizes.reduce((a, b) => a + b, 0) / m;
  const intersectionProfile = {};
  if (m >= 2) {
    for (let j = 0; j < m; j++) for (let l = j + 1; l < m; l++) {
      const k = edgePairwiseOverlap.get(j, l);
      const key = `overlap_${k}`;
      intersectionProfile[key] = (intersectionProfile[key] ?? 0) + 1;
    }
  }
  let pairwiseParticipation = 0;
  if (n >= 2) {
    let pos = 0;
    for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) {
      if (coDegree.get(i, k) > 0) pos++;
    }
    pairwiseParticipation = pos / choose2(n, 2);
  }
  return {
    hyperdegree,
    nodeStrength,
    maxEdgeSize,
    coDegree,
    edgeSizes,
    edgePairwiseOverlap,
    overlapCoefficient,
    jaccard,
    density,
    avgEdgeSize,
    sizeDistribution: hg.sizeDistribution,
    intersectionProfile,
    pairwiseParticipation,
    nNodes: n,
    nHyperedges: m
  };
}
function tensorPowerIter(hyperedges, edgeSizes, n, exponent, maxIter, tol, x0, normalize, shift = 1) {
  let x = x0.slice();
  for (let iter = 0; iter < maxIter; iter++) {
    const y = new Array(n).fill(0);
    for (let eIdx = 0; eIdx < hyperedges.length; eIdx++) {
      const e = hyperedges[eIdx];
      const ke = edgeSizes[eIdx];
      if (ke < 2) continue;
      const xe = e.map((v) => x[v]);
      let total = 1;
      let zeros = 0;
      for (let i = 0; i < ke; i++) {
        if (xe[i] === 0) {
          zeros++;
        } else {
          total *= xe[i];
        }
      }
      if (zeros === 0) {
        for (let i = 0; i < ke; i++) y[e[i]] += total / xe[i];
      } else if (zeros === 1) {
        let zeroIdx = -1;
        let prodNz = 1;
        for (let i = 0; i < ke; i++) {
          if (xe[i] === 0) zeroIdx = i;
          else prodNz *= xe[i];
        }
        if (zeroIdx >= 0) y[e[zeroIdx]] += prodNz;
      }
    }
    let yArr = y;
    if (exponent > 1) {
      yArr = yArr.map((v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / exponent));
    }
    for (let i = 0; i < n; i++) yArr[i] = yArr[i] + shift * x[i];
    let nrm = 0;
    for (const v of yArr) nrm += v * v;
    nrm = Math.sqrt(nrm);
    if (nrm === 0) {
      x = yArr;
      break;
    }
    for (let i = 0; i < n; i++) yArr[i] = yArr[i] / nrm;
    let l1 = 0;
    for (let i = 0; i < n; i++) l1 += Math.abs(yArr[i] - x[i]);
    if (l1 < tol) {
      x = yArr;
      break;
    }
    x = yArr;
  }
  let anyNonZero = false;
  for (const v of x) if (v !== 0) {
    anyNonZero = true;
    break;
  }
  if (anyNonZero) {
    let sum = 0;
    for (const v of x) sum += v;
    if (sum < 0) for (let i = 0; i < n; i++) x[i] = -x[i];
    if (!normalize) {
      let maxAbs = 0;
      for (const v of x) if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
      if (maxAbs > 0) for (let i = 0; i < n; i++) x[i] = x[i] / maxAbs;
    }
  }
  return x;
}
function hypergraphCentrality(hg, options = {}) {
  const { type = ["clique", "Z", "H"], maxIter = 1e3, tol = 1e-8, normalize = true } = options;
  const n = hg.nNodes;
  const m = hg.nHyperedges;
  const out = {};
  if (n === 0) {
    for (const t of type) out[t] = [];
    return out;
  }
  if (m === 0) {
    for (const t of type) out[t] = new Array(n).fill(0);
    return out;
  }
  const x0 = new Array(n).fill(1 / Math.sqrt(n));
  const edgeSizes = hg.hyperedges.map((e) => e.length);
  const kMax = Math.max(...edgeSizes, 0);
  if (type.includes("clique")) {
    const Bb = new Matrix(n, m);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) Bb.set(i, j, hg.incidence.get(i, j) > 0 ? 1 : 0);
    const W = new Matrix(n, n);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
      if (i === k) continue;
      let s = 0;
      for (let j = 0; j < m; j++) s += Bb.get(i, j) * Bb.get(k, j);
      W.set(i, k, s);
    }
    let x = x0.slice();
    for (let iter = 0; iter < maxIter; iter++) {
      const y = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) y[i] += W.get(i, k) * x[k];
      let nrm = 0;
      for (const v of y) nrm += v * v;
      nrm = Math.sqrt(nrm);
      if (nrm === 0) {
        x = y;
        break;
      }
      for (let i = 0; i < n; i++) y[i] = y[i] / nrm;
      let l1 = 0;
      for (let i = 0; i < n; i++) l1 += Math.abs(y[i] - x[i]);
      if (l1 < tol) {
        x = y;
        break;
      }
      x = y;
    }
    let sum = 0;
    for (const v of x) sum += v;
    if (sum < 0) for (let i = 0; i < n; i++) x[i] = -x[i];
    if (!normalize) {
      let maxAbs = 0;
      for (const v of x) if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
      if (maxAbs > 0) for (let i = 0; i < n; i++) x[i] = x[i] / maxAbs;
    }
    out.clique = x;
  }
  if (type.includes("Z")) {
    out.Z = tensorPowerIter(hg.hyperedges, edgeSizes, n, 1, maxIter, tol, x0, normalize);
  }
  if (type.includes("H")) {
    out.H = tensorPowerIter(hg.hyperedges, edgeSizes, n, Math.max(1, kMax - 1), maxIter, tol, x0, normalize);
  }
  return out;
}

// src/analysis/pathways.ts
function arrowToSimplicial(path) {
  const parts = path.split("->").map((s) => s.trim());
  if (parts.length < 2) return path;
  const sources = parts.slice(0, -1).join(" ");
  const target = parts[parts.length - 1];
  return `${sources} -> ${target}`;
}
function pathwaysHon(hon, options = {}) {
  const { minCount = 1, minProb = 0, top, order } = options;
  let edges = hon.edges.filter((e) => e.fromOrder > 1);
  if (order !== void 0) edges = edges.filter((e) => e.fromOrder === order);
  if (minCount > 1) edges = edges.filter((e) => e.count >= minCount);
  if (minProb > 0) edges = edges.filter((e) => e.probability >= minProb);
  edges.sort((a, b) => b.count - a.count);
  if (top !== void 0 && edges.length > top) edges = edges.slice(0, top);
  return edges.map((e) => arrowToSimplicial(e.path));
}
function pathwaysHypa(hypa, options = {}) {
  const type = options.type ?? "all";
  let rows;
  if (type === "all") {
    rows = hypa.scores.filter((s) => s.anomaly === "over" || s.anomaly === "under");
  } else {
    rows = hypa.scores.filter((s) => s.anomaly === type);
  }
  if (type === "all") {
    const over = rows.filter((r) => r.anomaly === "over").sort((a, b) => b.ratio - a.ratio);
    const under = rows.filter((r) => r.anomaly === "under").sort((a, b) => a.ratio - b.ratio);
    rows = [...over, ...under];
  } else if (type === "over") {
    rows.sort((a, b) => b.ratio - a.ratio);
  } else {
    rows.sort((a, b) => a.ratio - b.ratio);
  }
  return rows.map((r) => arrowToSimplicial(r.path));
}
function pathwaysMogen(mogen, options = {}) {
  const order = options.order ?? mogen.optimalOrder;
  const { minCount = 1, minProb = 0, top } = options;
  if (order < 1) return [];
  let trans = mogenTransitions(mogen, { order, minCount });
  if (minProb > 0) trans = trans.filter((t) => t.probability >= minProb);
  trans.sort((a, b) => b.count - a.count);
  if (top !== void 0 && trans.length > top) trans = trans.slice(0, top);
  return trans.map((t) => arrowToSimplicial(t.path));
}

// src/analysis/covariates.ts
var Z = (level) => {
  const p = 1 - level / 2;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
};
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const dd = 0.3989422804014327 * Math.exp(-x * x / 2);
  const pr = dd * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - pr : pr;
}
function clusterCovariates(assignments, meta, options) {
  if (assignments.length !== meta.rows.length) {
    throw new Error(`clusterCovariates: ${assignments.length} assignments but ${meta.rows.length} metadata rows`);
  }
  const k = Math.max(...assignments);
  const clusters = options?.clusterNames ?? Array.from({ length: k }, (_, i) => "Cluster " + (i + 1));
  const adjust = options?.adjust ?? "holm";
  const level = options?.level ?? 0.05;
  const skip = /* @__PURE__ */ new Set([".session_id", ".session_nr"]);
  const terms = options?.terms ?? meta.columns.filter((c) => !skip.has(c));
  const padj = (ps, m) => Array.from(pAdjust(ps, m));
  const profile = terms.map((term) => {
    const ci = meta.columns.indexOf(term);
    if (ci < 0) return { covariate: term, kind: "skipped", reason: "no such metadata column" };
    const perCluster = clusters.map(() => []);
    assignments.forEach((a, i) => {
      const v = meta.rows[i][ci];
      if (v != null && v !== "") perCluster[a - 1].push(v);
    });
    if (perCluster.some((g) => g.length === 0)) {
      return { covariate: term, kind: "skipped", reason: "a cluster has no values for it" };
    }
    if (meta.types[ci] === "numeric") {
      const groups = perCluster.map((g) => g.map(Number));
      const a = anova(groups);
      if (!a) return { covariate: term, kind: "skipped", reason: "too few observations" };
      const byCluster = groups.map((g, i) => {
        const m = g.reduce((s, v) => s + v, 0) / g.length;
        const sd = Math.sqrt(g.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, g.length - 1));
        return { cluster: clusters[i], n: g.length, mean: m, sd };
      });
      return {
        covariate: term,
        kind: "numeric",
        byCluster,
        anova: a,
        kruskal: kruskal(groups) ?? void 0,
        postHocNumeric: pairwiseWelch(clusters, groups, adjust, padj)
      };
    }
    const levels = Array.from(new Set(perCluster.flat().map(String))).sort();
    if (levels.length < 2) return { covariate: term, kind: "skipped", reason: "only one level \u2014 a constant, not a covariate" };
    const table = perCluster.map((g) => levels.map((L) => g.filter((v) => String(v) === L).length));
    const cs = chisqTest(table);
    if (!cs) return { covariate: term, kind: "skipped", reason: "degenerate contingency table" };
    return {
      covariate: term,
      kind: "categorical",
      levels,
      byCluster: table.map((row, i) => ({ cluster: clusters[i], n: row.reduce((s, v) => s + v, 0), counts: row })),
      chisq: cs,
      postHocCategorical: pairwiseChisq(clusters, table, adjust, padj)
    };
  });
  let membership;
  const usable = profile.filter((p) => p.kind !== "skipped").map((p) => p.covariate);
  if ((options?.membership ?? true) && usable.length > 0 && k >= 2) {
    const dm = designMatrix(meta, usable);
    const dropped = new Set(dm.dropped);
    const X = [];
    const R = [];
    assignments.forEach((a, i) => {
      if (dropped.has(i)) return;
      X.push([1, ...dm.X[X.length]]);
      const r = new Array(k).fill(0);
      r[a - 1] = 1;
      R.push(r);
    });
    const refName = options?.refCluster ?? clusters[0];
    const refIdx = Math.max(0, clusters.indexOf(refName));
    const SEPARATION_SE = 1e3;
    const absurd = (s) => !s.every((row) => row.every((v) => Number.isFinite(v) && Math.abs(v) < SEPARATION_SE));
    const thin = profile.some((p) => p.kind === "categorical" && p.byCluster.some((b) => b.counts.some((c) => c === 0)));
    let firth = thin;
    let fit = fitMultinom(X, R, refIdx, void 0, firth ? { firth: true } : void 0);
    let { se, ok } = multinomSE(X, R, fit.priors, refIdx);
    if (!firth && (!ok || absurd(se))) {
      firth = true;
      fit = fitMultinom(X, R, refIdx, void 0, { firth: true });
      ({ se, ok } = multinomSE(X, R, fit.priors, refIdx));
    }
    const seUsable = ok && !absurd(se);
    const zc = Z(level);
    const nonRef = clusters.filter((_, i) => i !== refIdx);
    const coefficients = fit.beta.map((r) => r.slice());
    const zStat = coefficients.map((row, m) => row.map((b, j) => b / se[m][j]));
    membership = {
      terms: ["(Intercept)", ...dm.names],
      refCluster: clusters[refIdx],
      clusters: nonRef,
      coefficients,
      se,
      z: zStat,
      pValues: zStat.map((row) => row.map((v) => Number.isFinite(v) ? 2 * (1 - normalCdf(Math.abs(v))) : NaN)),
      oddsRatios: coefficients.map((row) => row.map((b) => Math.exp(b))),
      ciLower: coefficients.map((row, m) => row.map((b, j) => b - zc * se[m][j])),
      ciUpper: coefficients.map((row, m) => row.map((b, j) => b + zc * se[m][j])),
      reference: dm.reference,
      dropped: dm.dropped.length,
      seOk: seUsable,
      firth
    };
  }
  return { clusters, profile, membership };
}

export { AVAILABLE_MEASURES, AVAILABLE_METHODS, bettiNumbers, betweennessNetwork, bipartiteGroups, bottleneckDistance, buildDFG, buildDFGFromSequences, buildHon, buildHonem, buildHypa, buildHypergraph, buildMogen, buildSimplicial, buildSimplicialPathway, casedropReliability, centralities, chainStructure, cliqueExpansion, cliques, clusterCovariates, clusterData, clusterSequences, communities, computeDendrogram, estimateCS, estimateCsWtna, estimateEdgeStability, estimateNetworkStability, eulerCharacteristic, extractTrajectories, extractTuples, findRepresentatives, g2Statistic, hypergraphCentrality, hypergraphMeasures, kgramCounts, layerDof, logLikelihood, marginalDistribution, markovOrderTest, markovStability, mogenTransitions, passageTime, pathCounts, pathDependence, pathwaysHon, pathwaysHypa, pathwaysMogen, pchisqUpper, permutationTest, permutationTestWtna, persistenceLandscape, persistentHomology, prune, pruneDisparity, qAnalysis, simplicialDegree, simulate, stateDistribution, stateFrequencies, transitionEntropy, transitionMatrixFromKgrams, withinWPermutation };
//# sourceMappingURL=chunk-F7YVWPXB.js.map
//# sourceMappingURL=chunk-F7YVWPXB.js.map