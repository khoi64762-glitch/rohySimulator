import { pearsonCorr, SeededRNG, computeTransitions3D, computeWeightsFrom3D, atna, ctna, ftna, tna } from './chunk-2EXGRQR6.js';

// src/stats/correlation.ts
function rankArray(arr) {
  const indexed = Array.from(arr, (v, i2) => ({ v, i: i2 })).sort((a, b) => a.v - b.v);
  const ranks = new Float64Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}
function rankArr(a) {
  const indexed = a.map((v, i2) => ({ v, i: i2 })).sort((x, y) => x.v - y.v);
  const ranks = new Array(a.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avg = (i + j + 1) / 2;
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avg;
    i = j;
  }
  return ranks;
}
function arrMean(a) {
  if (a.length === 0) return NaN;
  return a.reduce((s, v) => s + v, 0) / a.length;
}
function pearsonCorrArr(x, y) {
  const n = x.length;
  if (n < 2) return NaN;
  const mx = arrMean(x);
  const my = arrMean(y);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom < 1e-14 ? NaN : num / denom;
}
function spearmanCorr(a, b) {
  return pearsonCorr(rankArray(a), rankArray(b));
}
function spearmanCorrArr(x, y) {
  return pearsonCorrArr(rankArr(x), rankArr(y));
}
function kendallTau(x, y) {
  const n = x.length;
  if (n < 2) return NaN;
  let concordant = 0, discordant = 0, tx = 0, ty = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sx = Math.sign(x[i] - x[j]);
      const sy = Math.sign(y[i] - y[j]);
      if (sx === sy && sx !== 0) concordant++;
      else if (sx !== 0 && sy !== 0) discordant++;
      if (sx === 0) tx++;
      if (sy === 0) ty++;
    }
  }
  const n0 = n * (n - 1) / 2;
  const denom = Math.sqrt((n0 - tx) * (n0 - ty));
  return denom < 1e-14 ? NaN : (concordant - discordant) / denom;
}
function distanceCorr(x, y) {
  const m = x.length;
  if (m < 2) return NaN;
  const center = (vals) => {
    const d = Array.from(
      { length: m },
      (_, i) => Array.from({ length: m }, (__, j) => Math.abs(vals[i] - vals[j]))
    );
    const rowMeans = d.map((row) => arrMean(row));
    const grandMean = arrMean(rowMeans);
    return d.map(
      (row, i) => row.map((v, j) => v - rowMeans[i] - rowMeans[j] + grandMean)
    );
  };
  const A = center(x);
  const B = center(y);
  let vXY = 0, vX = 0, vY = 0;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      vXY += A[i][j] * B[i][j];
      vX += A[i][j] * A[i][j];
      vY += B[i][j] * B[i][j];
    }
  }
  const n2 = m * m;
  vXY /= n2;
  vX /= n2;
  vY /= n2;
  const denom = Math.sqrt(vX * vY);
  return denom < 1e-14 ? NaN : vXY / denom;
}
function rvCoefficient(a, b) {
  const n = a.rows;
  const colCenter = (w) => {
    const result = [];
    for (let i = 0; i < n; i++) result.push(new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      let colSum = 0;
      for (let i = 0; i < n; i++) colSum += w.get(i, j);
      const colMean = colSum / n;
      for (let i = 0; i < n; i++) result[i][j] = w.get(i, j) - colMean;
    }
    return result;
  };
  const tcrossprod = (x) => {
    const mat = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += x[i][k] * x[j][k];
        mat[i][j] = s;
      }
    }
    return mat;
  };
  const traceMul = (P, Q) => {
    let tr = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        tr += P[i][j] * Q[j][i];
    return tr;
  };
  const xc = colCenter(a);
  const yc = colCenter(b);
  const xx = tcrossprod(xc);
  const yy = tcrossprod(yc);
  const trXXYY = traceMul(xx, yy);
  const trXXXX = traceMul(xx, xx);
  const trYYYY = traceMul(yy, yy);
  const denom = Math.sqrt(trXXXX * trYYYY);
  return denom < 1e-14 ? NaN : trXXYY / denom;
}

// src/analysis/reliability.ts
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
function arrMean2(a) {
  if (a.length === 0) return NaN;
  return a.reduce((s, v) => s + v, 0) / a.length;
}
function arrStd(a, ddof = 1) {
  if (a.length < ddof + 1) return NaN;
  const m = arrMean2(a);
  const variance = a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - ddof);
  return Math.sqrt(variance);
}
function arrMedian(a) {
  if (a.length === 0) return NaN;
  const sorted = [...a].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function arrQuantile(a, p) {
  if (a.length === 0) return NaN;
  const sorted = [...a].sort((x, y) => x - y);
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo);
}
function pearsonCorrArr2(x, y) {
  const n = x.length;
  if (n < 2) return NaN;
  const mx = arrMean2(x);
  const my = arrMean2(y);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom < 1e-14 ? NaN : num / denom;
}
function flattenColMajor(w) {
  const n = w.rows;
  const out = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      out.push(w.get(i, j));
    }
  }
  return out;
}
function compareWeightMatrices(a, b) {
  const nanResult = {};
  for (const m of RELIABILITY_METRICS) nanResult[m.key] = NaN;
  if (a.labels.length !== b.labels.length) return nanResult;
  const n = a.labels.length;
  if (n === 0) return nanResult;
  const xv = flattenColMajor(a.weights);
  const yv = flattenColMajor(b.weights);
  const m2 = xv.length;
  const absX = xv.map((v) => Math.abs(v));
  const absY = yv.map((v) => Math.abs(v));
  const absDiff = xv.map((v, i) => Math.abs(v - yv[i]));
  const meanX = arrMean2(xv);
  const meanY = arrMean2(yv);
  const stdX = arrStd(xv);
  const stdY = arrStd(yv);
  const meanAY = arrMean2(absY);
  const mad = arrMean2(absDiff);
  const median_ad = arrMedian(absDiff);
  const rmsd = Math.sqrt(arrMean2(absDiff.map((d) => d * d)));
  const max_ad = Math.max(...absDiff);
  const rel_mad = meanAY > 1e-14 ? mad / meanAY : NaN;
  const cv_ratio = Math.abs(meanX) > 1e-14 && Math.abs(stdY) > 1e-14 ? stdX * meanY / (meanX * stdY) : NaN;
  const pearson = pearsonCorrArr2(xv, yv);
  const spearman = spearmanCorrArr(xv, yv);
  const kendall = kendallTau(xv, yv);
  const dcor = distanceCorr(xv, yv);
  const euclidean = Math.sqrt(absDiff.reduce((s, d) => s + d * d, 0));
  const manhattan = absDiff.reduce((s, d) => s + d, 0);
  let canberraSum = 0;
  for (let i = 0; i < m2; i++) {
    if (absX[i] > 0 && absY[i] > 0) {
      canberraSum += absDiff[i] / (absX[i] + absY[i]);
    }
  }
  const canberra = canberraSum;
  const sumAbsXY = absX.reduce((s, v, i) => s + v + absY[i], 0);
  const braycurtis = sumAbsXY > 1e-14 ? manhattan / sumAbsXY : 0;
  const frobenius = Math.sqrt(n / 2) > 1e-14 ? euclidean / Math.sqrt(n / 2) : NaN;
  let dotXY = 0, dotXX = 0, dotYY = 0;
  for (let i = 0; i < m2; i++) {
    dotXY += xv[i] * yv[i];
    dotXX += xv[i] * xv[i];
    dotYY += yv[i] * yv[i];
  }
  const cosine = Math.sqrt(dotXX * dotYY) > 1e-14 ? dotXY / Math.sqrt(dotXX * dotYY) : NaN;
  let minSum = 0, maxSum = 0, sumAbsX = 0, sumAbsY = 0;
  for (let i = 0; i < m2; i++) {
    minSum += Math.min(absX[i], absY[i]);
    maxSum += Math.max(absX[i], absY[i]);
    sumAbsX += absX[i];
    sumAbsY += absY[i];
  }
  const jaccard = maxSum > 1e-14 ? minSum / maxSum : NaN;
  const dice = sumAbsX + sumAbsY > 1e-14 ? 2 * minSum / (sumAbsX + sumAbsY) : NaN;
  const overlap = Math.min(sumAbsX, sumAbsY) > 1e-14 ? minSum / Math.min(sumAbsX, sumAbsY) : NaN;
  const rv = rvCoefficient(a.weights, b.weights);
  let matchCount = 0, totalDiff = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n; j++) {
      const dA = a.weights.get(i + 1, j) - a.weights.get(i, j);
      const dB = b.weights.get(i + 1, j) - b.weights.get(i, j);
      if (Math.sign(dA) === Math.sign(dB)) matchCount++;
      totalDiff++;
    }
  }
  const rank_agree = totalDiff > 0 ? matchCount / totalDiff : NaN;
  const sameSign = xv.filter((v, i) => Math.sign(v) === Math.sign(yv[i])).length;
  const sign_agree = m2 > 0 ? sameSign / m2 : NaN;
  return {
    mad,
    median_ad,
    rmsd,
    max_ad,
    rel_mad,
    cv_ratio,
    pearson,
    spearman,
    kendall,
    dcor,
    euclidean,
    manhattan,
    canberra,
    braycurtis,
    frobenius,
    cosine,
    jaccard,
    dice,
    overlap,
    rv,
    rank_agree,
    sign_agree
  };
}
var BUILDERS = {
  tna: (d, o) => tna(d, o),
  ftna: (d, o) => ftna(d, o),
  ctna: (d, o) => ctna(d, o),
  atna: (d, o) => atna(d, o)
};
function rRound(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}
function scaleVector(vec, method) {
  if (method === "none") return vec;
  const n = vec.length;
  if (n === 0) return vec;
  if (method === "minmax") {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = vec[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === max) return vec;
    const span = max - min;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = (vec[i] - min) / span;
    return out;
  }
  if (method === "standardize") {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += vec[i];
    const mean2 = sum / n;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const d = vec[i] - mean2;
      ss += d * d;
    }
    const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
    if (sd === 0) return vec;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = (vec[i] - mean2) / sd;
    return out;
  }
  if (method === "proportion") {
    let total = 0;
    for (let i = 0; i < n; i++) total += vec[i];
    if (total === 0) return vec;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = vec[i] / total;
    return out;
  }
  return vec;
}
function splitHalfMetrics(vecA, vecB) {
  const n = vecA.length;
  const diffs = new Float64Array(n);
  let maxD = 0;
  let sumD = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(vecA[i] - vecB[i]);
    diffs[i] = d;
    if (d > maxD) maxD = d;
    sumD += d;
  }
  const mean_dev = n > 0 ? sumD / n : NaN;
  const median_dev = medianF64(diffs);
  const sdA = sdF64(vecA);
  const sdB = sdF64(vecB);
  let cor;
  if (sdA === 0 || sdB === 0) {
    cor = Number.NaN;
  } else {
    let mA = 0;
    let mB = 0;
    for (let i = 0; i < n; i++) {
      mA += vecA[i];
      mB += vecB[i];
    }
    mA /= n;
    mB /= n;
    let num = 0;
    let dx2 = 0;
    let dy2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = vecA[i] - mA;
      const dy = vecB[i] - mB;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    cor = denom < 1e-14 ? Number.NaN : num / denom;
  }
  return { mean_dev, median_dev, cor, max_dev: maxD };
}
function medianF64(arr) {
  if (arr.length === 0) return NaN;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function sdF64(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += arr[i];
  const mean2 = sum / n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = arr[i] - mean2;
    ss += d * d;
  }
  return Math.sqrt(ss / (n - 1));
}
function flattenColMajorF64(m) {
  const n = m.rows;
  const out = new Float64Array(n * n);
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      out[k++] = m.get(i, j);
    }
  }
  return out;
}
function singleModelReliability(model, iter, split, scale, rng, replayIndices) {
  if (!model.data) {
    throw new Error(
      "networkReliability: model does not contain $data. Rebuild with build_network()."
    );
  }
  const seqData = model.data;
  const n = seqData.length;
  if (n < 2) {
    throw new Error("networkReliability: need at least 2 sequences");
  }
  const nA = Math.max(1, rRound(n * split));
  if (nA < 1 || n - nA < 1) {
    throw new Error(
      `networkReliability: each split half must have at least 1 sequence (n=${n}, nA=${nA})`
    );
  }
  let maxLen = 0;
  for (const seq of seqData) if (seq.length > maxLen) maxLen = seq.length;
  const padded = seqData.map((seq) => {
    if (seq.length >= maxLen) return seq;
    const pad = new Array(maxLen - seq.length).fill(null);
    return [...seq, ...pad];
  });
  const trans = computeTransitions3D(padded, model.labels, model.type, model.params);
  const modelScaling = model.scaling.length > 0 ? model.scaling : null;
  const out = {
    mean_dev: new Array(iter),
    median_dev: new Array(iter),
    cor: new Array(iter),
    max_dev: new Array(iter)
  };
  for (let it = 0; it < iter; it++) {
    let idxA;
    if (replayIndices) {
      const replay = replayIndices[it];
      if (!replay) {
        throw new Error(
          `networkReliability: replayIndices[${it}] missing (iter=${iter}, have=${replayIndices.length})`
        );
      }
      if (replay.length !== nA) {
        throw new Error(
          `networkReliability: replayIndices[${it}] has length ${replay.length}, expected ${nA}`
        );
      }
      idxA = replay;
    } else {
      idxA = rng.choiceWithoutReplacement(n, nA);
    }
    const setA = new Set(idxA);
    const idxB = [];
    for (let k = 0; k < n; k++) if (!setA.has(k)) idxB.push(k);
    try {
      const transA = idxA.map((i) => trans[i]);
      const transB = idxB.map((i) => trans[i]);
      const matA = computeWeightsFrom3D(transA, model.type, modelScaling);
      const matB = computeWeightsFrom3D(transB, model.type, modelScaling);
      let vecA = flattenColMajorF64(matA);
      let vecB = flattenColMajorF64(matB);
      vecA = scaleVector(vecA, scale);
      vecB = scaleVector(vecB, scale);
      const m = splitHalfMetrics(vecA, vecB);
      out.mean_dev[it] = m.mean_dev;
      out.median_dev[it] = m.median_dev;
      out.cor[it] = m.cor;
      out.max_dev[it] = m.max_dev;
    } catch {
      out.mean_dev[it] = NaN;
      out.median_dev[it] = NaN;
      out.cor[it] = NaN;
      out.max_dev[it] = NaN;
    }
  }
  return out;
}
function summaryMeanSd(vals) {
  const filtered = vals.filter((v) => Number.isFinite(v));
  if (filtered.length === 0) return { mean: NaN, sd: NaN };
  let s = 0;
  for (const v of filtered) s += v;
  const mean2 = s / filtered.length;
  if (filtered.length < 2) return { mean: mean2, sd: NaN };
  let ss = 0;
  for (const v of filtered) ss += (v - mean2) * (v - mean2);
  return { mean: mean2, sd: Math.sqrt(ss / (filtered.length - 1)) };
}
function makeUnique(names) {
  const seen = {};
  return names.map((nm) => {
    if (seen[nm] === void 0) {
      seen[nm] = 0;
      return nm;
    }
    seen[nm]++;
    return `${nm}_${seen[nm]}`;
  });
}
function networkReliability(models, options = {}) {
  const {
    iter = 1e3,
    split = 0.5,
    scale = "none",
    seed = 42,
    replayIndices
  } = options;
  if (iter < 2) throw new Error("networkReliability: iter must be >= 2");
  if (!(split > 0 && split < 1)) {
    throw new Error("networkReliability: split must be in (0, 1)");
  }
  let modelMap;
  let modelOrder;
  if (Array.isArray(models)) {
    const names = models.map((m) => m.type);
    const unique = makeUnique(names);
    modelMap = {};
    for (let i = 0; i < models.length; i++) modelMap[unique[i]] = models[i];
    modelOrder = unique;
  } else if (models && typeof models === "object" && !models.weights) {
    modelMap = models;
    modelOrder = Object.keys(modelMap);
  } else {
    const m = models;
    modelMap = { [m.type]: m };
    modelOrder = [m.type];
  }
  if (modelOrder.length === 0) {
    throw new Error("networkReliability: at least one model required");
  }
  const rng = new SeededRNG(seed);
  const iterations = {};
  const summaryRows = [];
  for (const modelName of modelOrder) {
    const model = modelMap[modelName];
    let modelReplay = null;
    if (replayIndices) {
      if (Array.isArray(replayIndices)) {
        if (modelOrder.length > 1) {
          throw new Error(
            "networkReliability: replayIndices as array requires single-model call; use Record<string, number[][]>"
          );
        }
        modelReplay = replayIndices;
      } else {
        modelReplay = replayIndices[modelName] ?? null;
        if (!modelReplay) {
          throw new Error(
            `networkReliability: replayIndices missing for model '${modelName}'`
          );
        }
      }
    }
    const itsRes = singleModelReliability(
      model,
      iter,
      split,
      scale,
      rng,
      modelReplay
    );
    iterations[modelName] = itsRes;
    for (const metric of ["mean_dev", "median_dev", "cor", "max_dev"]) {
      const { mean: mean2, sd } = summaryMeanSd(itsRes[metric]);
      summaryRows.push({ model: modelName, metric, mean: mean2, sd });
    }
  }
  return {
    iterations,
    summary: summaryRows,
    models: modelOrder,
    iter,
    split,
    scale
  };
}
function reliabilityAnalysis(sequenceData, modelType, opts = {}) {
  if (sequenceData.length < 4) {
    throw new Error("Need at least 4 sequences for reliability analysis");
  }
  const {
    iter = 100,
    split = 0.5,
    atnaBeta = 0.1,
    seed = 42,
    scaling,
    addStartState,
    startStateLabel,
    addEndState,
    endStateLabel
  } = opts;
  const n = sequenceData.length;
  const nA = Math.floor(n * split);
  if (nA < 2 || n - nA < 2) {
    throw new Error("Each split half must have at least 2 sequences");
  }
  const applyStartEnd = (seqs) => {
    if (!addStartState && !addEndState) return seqs;
    return seqs.map((seq) => {
      let last = seq.length - 1;
      while (last >= 0 && seq[last] === null) last--;
      const trimmed = seq.slice(0, last + 1);
      if (addStartState) trimmed.unshift(startStateLabel || "Start");
      if (addEndState) trimmed.push(endStateLabel || "End");
      return trimmed;
    });
  };
  const rng = new SeededRNG(seed);
  const builder = BUILDERS[modelType];
  const buildOpts = {};
  if (scaling) buildOpts.scaling = scaling;
  if (modelType === "atna") buildOpts.beta = atnaBeta;
  const iterations = {};
  for (const m of RELIABILITY_METRICS) iterations[m.key] = [];
  for (let it = 0; it < iter; it++) {
    const indicesA = rng.choiceWithoutReplacement(n, nA);
    const setA = new Set(indicesA);
    const indicesB = Array.from({ length: n }, (_, i) => i).filter((i) => !setA.has(i));
    const seqA = applyStartEnd(indicesA.map((i) => sequenceData[i]));
    const seqB = applyStartEnd(indicesB.map((i) => sequenceData[i]));
    try {
      const modelA = builder(seqA, buildOpts);
      const modelB = builder(seqB, buildOpts);
      const metrics = compareWeightMatrices(modelA, modelB);
      for (const m of RELIABILITY_METRICS) {
        iterations[m.key].push(metrics[m.key]);
      }
    } catch {
      for (const m of RELIABILITY_METRICS) {
        iterations[m.key].push(NaN);
      }
    }
  }
  const summary = RELIABILITY_METRICS.map((metDef) => {
    const raw = iterations[metDef.key] ?? [];
    const vals = raw.filter((v) => isFinite(v));
    return {
      metric: metDef.label,
      category: metDef.category,
      mean: arrMean2(vals),
      sd: arrStd(vals),
      median: arrMedian(vals),
      min: vals.length > 0 ? Math.min(...vals) : NaN,
      max: vals.length > 0 ? Math.max(...vals) : NaN,
      q25: arrQuantile(vals, 0.25),
      q75: arrQuantile(vals, 0.75)
    };
  });
  return { iterations, summary, iter, split, modelType };
}

// src/analysis/compare.ts
function stdResiduals(counts) {
  const nRows = counts.length;
  const nCols = nRows > 0 ? counts[0].length : 0;
  if (nRows === 0 || nCols === 0) return [];
  const rowSums = counts.map((row) => row.reduce((s, v) => s + v, 0));
  const colSums = Array.from({ length: nCols }, (_, j) => counts.reduce((s, row) => s + row[j], 0));
  const total = rowSums.reduce((s, v) => s + v, 0);
  if (total === 0) return counts.map((row) => row.map(() => 0));
  return counts.map(
    (row, i) => row.map((observed, j) => {
      const expected = rowSums[i] * colSums[j] / total;
      const variance = expected * (1 - rowSums[i] / total) * (1 - colSums[j] / total);
      return variance > 0 ? (observed - expected) / Math.sqrt(variance) : 0;
    })
  );
}
function compareSequences(x, options) {
  const groupNames = Object.keys(x.models);
  if (groupNames.length < 2) {
    throw new Error("compare_sequences requires at least 2 groups");
  }
  const { data, group } = combineData(x, groupNames);
  const nCols = data[0]?.length ?? 0;
  let sub = options?.sub ?? Array.from({ length: Math.min(5, nCols) }, (_, i) => i + 1);
  sub = sub.filter((s) => s <= nCols);
  if (sub.length === 0) throw new Error("No valid subsequence lengths");
  const minFreq = options?.minFreq ?? 5;
  const test = options?.test ?? false;
  const iter = options?.iter ?? 1e3;
  const adjust = options?.adjust ?? "bonferroni";
  const patternMatrices = extractPatterns(data, sub);
  const { freq, patternLabels } = factorizePatterns(patternMatrices, group, groupNames);
  const nPatterns = patternLabels.length;
  const nGroups = groupNames.length;
  const props = new Float64Array(nPatterns * nGroups);
  for (const length of sub) {
    for (let p = 0; p < nPatterns; p++) {
      const pLen = patternLabels[p].split("->").length;
      if (pLen !== length) continue;
      for (let g = 0; g < nGroups; g++) {
        let total = 0;
        for (let pp = 0; pp < nPatterns; pp++) {
          if (patternLabels[pp].split("->").length === length) {
            total += freq[pp * nGroups + g];
          }
        }
        if (total > 0) {
          props[p * nGroups + g] = freq[p * nGroups + g] / total;
        }
      }
    }
  }
  let effectSizes = null;
  let pValues = null;
  if (test) {
    const rng = new SeededRNG(options?.seed ?? 42);
    const result = permutationTestPatterns(
      data,
      group,
      groupNames,
      sub,
      freq,
      patternLabels,
      iter,
      adjust,
      rng
    );
    effectSizes = result.effectSize;
    pValues = result.pValue;
  }
  const resid = stdResiduals(
    Array.from(
      { length: nPatterns },
      (_, p) => Array.from({ length: nGroups }, (_2, g) => freq[p * nGroups + g])
    )
  );
  const keep = [];
  for (let p = 0; p < nPatterns; p++) {
    let minCount = Infinity;
    for (let g = 0; g < nGroups; g++) {
      const count = freq[p * nGroups + g];
      if (count < minCount) minCount = count;
    }
    keep.push(minCount >= minFreq);
  }
  const rows = [];
  for (let p = 0; p < nPatterns; p++) {
    if (!keep[p]) continue;
    const frequencies = {};
    const proportions = {};
    const residuals = {};
    for (let g = 0; g < nGroups; g++) {
      frequencies[groupNames[g]] = freq[p * nGroups + g];
      proportions[groupNames[g]] = props[p * nGroups + g];
      residuals[groupNames[g]] = resid[p][g];
    }
    const row = {
      pattern: patternLabels[p],
      frequencies,
      proportions,
      residuals
    };
    if (test && effectSizes && pValues) {
      row.effectSize = effectSizes[p];
      row.pValue = pValues[p];
    }
    rows.push(row);
  }
  rows.sort((a, b) => {
    const lenA = a.pattern.split("->").length;
    const lenB = b.pattern.split("->").length;
    if (lenA !== lenB) return lenA - lenB;
    return a.pattern.localeCompare(b.pattern);
  });
  if (test) {
    rows.sort((a, b) => (a.pValue ?? 1) - (b.pValue ?? 1));
  }
  return rows;
}
function combineData(g, groupNames) {
  const data = [];
  const group = [];
  let maxCols = 0;
  for (const name of groupNames) {
    const model = g.models[name];
    if (!model.data) {
      throw new Error(`Group '${name}' has no sequence data`);
    }
    for (const row of model.data) {
      if (row.length > maxCols) maxCols = row.length;
    }
  }
  for (const name of groupNames) {
    const model = g.models[name];
    for (const row of model.data) {
      const padded = [...row];
      while (padded.length < maxCols) padded.push(null);
      data.push(padded);
      group.push(name);
    }
  }
  return { data, group };
}
function extractPatterns(data, lengths) {
  const allPatterns = [];
  const nRows = data.length;
  const nCols = data[0]?.length ?? 0;
  for (const length of lengths) {
    if (length > nCols) break;
    const nPositions = nCols - length + 1;
    const patterns = new Array(nRows * nPositions).fill(null);
    for (let i = 0; i < nRows; i++) {
      for (let j = 0; j < nPositions; j++) {
        const subseq = data[i].slice(j, j + length);
        if (subseq.some((s) => s === null || s === void 0)) continue;
        patterns[i * nPositions + j] = subseq.join("->");
      }
    }
    allPatterns.push(patterns);
  }
  return allPatterns;
}
function factorizePatterns(patternMatrices, group, groupNames) {
  const patternToIdx = /* @__PURE__ */ new Map();
  const allPatterns = [];
  for (const pm of patternMatrices) {
    for (const val of pm) {
      if (val !== null && !patternToIdx.has(val)) {
        patternToIdx.set(val, allPatterns.length);
        allPatterns.push(val);
      }
    }
  }
  const nPatterns = allPatterns.length;
  const nGroups = groupNames.length;
  const groupToIdx = /* @__PURE__ */ new Map();
  groupNames.forEach((g, i) => groupToIdx.set(g, i));
  const freq = new Float64Array(nPatterns * nGroups);
  const nRows = group.length;
  for (const pm of patternMatrices) {
    const nPositions = pm.length / nRows;
    for (let i = 0; i < nRows; i++) {
      const gIdx = groupToIdx.get(group[i]);
      for (let j = 0; j < nPositions; j++) {
        const val = pm[i * nPositions + j];
        if (val !== null && val !== void 0) {
          const idx = patternToIdx.get(val) * nGroups + gIdx;
          freq[idx] = freq[idx] + 1;
        }
      }
    }
  }
  return { freq, patternLabels: allPatterns };
}
function patternStatistic(freq, nPatterns, nGroups) {
  const stat = new Float64Array(nPatterns);
  const rowSums = new Float64Array(nPatterns);
  const colSums = new Float64Array(nGroups);
  let total = 0;
  for (let p = 0; p < nPatterns; p++) {
    for (let g = 0; g < nGroups; g++) {
      const v = freq[p * nGroups + g];
      rowSums[p] = rowSums[p] + v;
      colSums[g] = colSums[g] + v;
      total += v;
    }
  }
  if (total === 0) return stat;
  for (let p = 0; p < nPatterns; p++) {
    let sumSq = 0;
    for (let g = 0; g < nGroups; g++) {
      const expected = rowSums[p] * colSums[g] / total;
      const diff = freq[p * nGroups + g] - expected;
      sumSq += diff * diff;
    }
    stat[p] = Math.sqrt(sumSq);
  }
  return stat;
}
function permutationTestPatterns(data, group, groupNames, lengths, freq, patternLabels, iter, adjust, rng) {
  const nPatterns = patternLabels.length;
  const nGroups = groupNames.length;
  const groupToIdx = /* @__PURE__ */ new Map();
  groupNames.forEach((g, i) => groupToIdx.set(g, i));
  const trueStat = patternStatistic(freq, nPatterns, nGroups);
  const nRows = group.length;
  const patternToIdx = /* @__PURE__ */ new Map();
  patternLabels.forEach((p, i) => patternToIdx.set(p, i));
  const rowPatterns = [];
  const nCols = data[0]?.length ?? 0;
  for (let i = 0; i < nRows; i++) {
    const pats = [];
    for (const length of lengths) {
      if (length > nCols) break;
      const nPositions = nCols - length + 1;
      for (let j = 0; j < nPositions; j++) {
        const subseq = data[i].slice(j, j + length);
        if (subseq.some((s) => s === null || s === void 0)) continue;
        const pat = subseq.join("->");
        const idx = patternToIdx.get(pat);
        if (idx !== void 0) pats.push(idx);
      }
    }
    rowPatterns.push(pats);
  }
  const groupIndices = group.map((g) => groupToIdx.get(g));
  const permMean = new Float64Array(nPatterns);
  const permM2 = new Float64Array(nPatterns);
  const countGe = new Float64Array(nPatterns);
  for (let it = 0; it < iter; it++) {
    const permGroupIdx = [...groupIndices];
    rng.shuffle(permGroupIdx);
    const permFreq = new Float64Array(nPatterns * nGroups);
    for (let i = 0; i < nRows; i++) {
      const gIdx = permGroupIdx[i];
      for (const patIdx of rowPatterns[i]) {
        const idx = patIdx * nGroups + gIdx;
        permFreq[idx] = permFreq[idx] + 1;
      }
    }
    const permStat = patternStatistic(permFreq, nPatterns, nGroups);
    for (let p = 0; p < nPatterns; p++) {
      const delta = permStat[p] - permMean[p];
      permMean[p] = permMean[p] + delta / (it + 1);
      permM2[p] = permM2[p] + delta * (permStat[p] - permMean[p]);
      if (permStat[p] >= trueStat[p]) countGe[p] = countGe[p] + 1;
    }
  }
  const effectSize = new Float64Array(nPatterns);
  for (let p = 0; p < nPatterns; p++) {
    const sd = iter > 1 ? Math.sqrt(permM2[p] / iter) : 0;
    effectSize[p] = sd > 0 ? (trueStat[p] - permMean[p]) / sd : 0;
  }
  const rawP = new Float64Array(nPatterns);
  for (let p = 0; p < nPatterns; p++) {
    rawP[p] = (countGe[p] + 1) / (iter + 1);
  }
  const patternLength = patternLabels.map((p) => p.split("->").length);
  const pValue = new Float64Array(nPatterns).fill(1);
  for (const length of lengths) {
    const indices = [];
    for (let p = 0; p < nPatterns; p++) {
      if (patternLength[p] === length) indices.push(p);
    }
    if (indices.length > 0) {
      const subP = new Float64Array(indices.length);
      for (let i = 0; i < indices.length; i++) subP[i] = rawP[indices[i]];
      const adjusted = pAdjust(subP, adjust);
      for (let i = 0; i < indices.length; i++) pValue[indices[i]] = adjusted[i];
    }
  }
  return { effectSize, pValue };
}
function pAdjust(p, method) {
  const n = p.length;
  if (n === 0) return new Float64Array(0);
  if (method === "none") return new Float64Array(p);
  if (method === "bonferroni") {
    return new Float64Array(p.map((v) => Math.min(v * n, 1)));
  }
  if (method === "holm") {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => p[a] - p[b]);
    const adjusted = new Float64Array(n);
    let cummax = 0;
    for (let i = 0; i < n; i++) {
      const val = p[order[i]] * (n - i);
      cummax = Math.max(cummax, val);
      adjusted[order[i]] = Math.min(cummax, 1);
    }
    return adjusted;
  }
  if (method === "fdr" || method === "BH") {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => p[b] - p[a]);
    const adjusted = new Float64Array(n);
    let cummin = 1;
    for (let i = 0; i < n; i++) {
      const val = p[order[i]] * n / (n - i);
      cummin = Math.min(cummin, val);
      adjusted[order[i]] = Math.min(cummin, 1);
    }
    return adjusted;
  }
  throw new Error(`Unknown p-value adjustment method: ${method}`);
}
function compareModels(a, b) {
  return compareWeightMatrices(a, b);
}

// src/stats/group-tests.ts
function logGamma(x) {
  const c = [
    76.18009172947146,
    -86.50532032941678,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -5395239384953e-18
  ];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310007 * ser / x);
}
function betacf(a, b, x) {
  const FPMIN = 1e-300, EPS = 3e-16;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function ibeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
function pf(f, df1, df2) {
  if (!(f > 0) || !isFinite(f)) return 1;
  return ibeta(df2 / 2, df1 / 2, df2 / (df2 + df1 * f));
}
function pt2(t, df) {
  if (!isFinite(t) || !(df > 0)) return 1;
  return ibeta(df / 2, 0.5, df / (df + t * t));
}
function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 3e-16) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}
function pchisq(q, df) {
  if (!(q > 0) || !(df > 0)) return 1;
  return 1 - gammaP(df / 2, q / 2);
}
var mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
var varOf = (a) => {
  const m = mean(a);
  return a.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, a.length - 1);
};
function anova(groups) {
  const gs = groups.filter((g) => g.length > 0);
  const k = gs.length;
  const all = gs.flat();
  const N = all.length;
  if (k < 2 || N <= k) return null;
  const grand = mean(all);
  const ssb = gs.reduce((s, g) => {
    const d = mean(g) - grand;
    return s + g.length * d * d;
  }, 0);
  const ssw = gs.reduce((s, g) => {
    const m = mean(g);
    return s + g.reduce((t, v) => t + (v - m) * (v - m), 0);
  }, 0);
  const df1 = k - 1, df2 = N - k;
  const msb = ssb / df1, msw = ssw / df2;
  const F = msw > 0 ? msb / msw : Infinity;
  const sst = ssb + ssw;
  return { F, df1, df2, p: pf(F, df1, df2), eta2: sst > 0 ? ssb / sst : 0 };
}
function kruskal(groups) {
  const gs = groups.filter((g) => g.length > 0);
  const k = gs.length;
  if (k < 2) return null;
  const all = [];
  gs.forEach((g, gi) => g.forEach((v) => all.push({ v, gi })));
  const N = all.length;
  if (N <= k) return null;
  all.sort((a, b) => a.v - b.v);
  const ranks = new Array(N);
  let ties = 0;
  for (let i = 0; i < N; ) {
    let j = i;
    while (j + 1 < N && all[j + 1].v === all[i].v) j++;
    const r = (i + j + 2) / 2;
    for (let t = i; t <= j; t++) ranks[t] = r;
    const m = j - i + 1;
    if (m > 1) ties += m * m * m - m;
    i = j + 1;
  }
  const sums = new Array(k).fill(0), ns = new Array(k).fill(0);
  all.forEach((o, i) => {
    sums[o.gi] += ranks[i];
    ns[o.gi]++;
  });
  let H = 0;
  for (let g = 0; g < k; g++) H += sums[g] * sums[g] / ns[g];
  H = 12 / (N * (N + 1)) * H - 3 * (N + 1);
  const corr = 1 - ties / (N * N * N - N);
  if (corr > 0) H /= corr;
  const df = k - 1;
  return { H, df, p: pchisq(H, df) };
}
function chisqTest(table, stdres = stdResiduals) {
  if (!table.length || !table[0].length) return null;
  const keepR = table.map((r) => r.reduce((s, v) => s + v, 0) > 0);
  const keepC = table[0].map((_, j) => table.reduce((s, r) => s + r[j], 0) > 0);
  const t = table.filter((_, i) => keepR[i]).map((r) => r.filter((_, j) => keepC[j]));
  const rows = t.length, cols = rows ? t[0].length : 0;
  if (rows < 2 || cols < 2) return null;
  const rowT = t.map((r) => r.reduce((s, v) => s + v, 0));
  const colT = Array.from({ length: cols }, (_, j) => t.reduce((s, r) => s + r[j], 0));
  const N = rowT.reduce((s, v) => s + v, 0);
  if (!N) return null;
  let X2 = 0, expectedMin = Infinity;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const e = rowT[i] * colT[j] / N;
      if (e < expectedMin) expectedMin = e;
      const d = t[i][j] - e;
      X2 += d * d / e;
    }
  }
  const df = (rows - 1) * (cols - 1);
  const V = Math.sqrt(X2 / (N * (Math.min(rows, cols) - 1)));
  return { X2, df, p: pchisq(X2, df), cramerV: V, n: N, expectedMin, residuals: stdres(t), dropped: cols !== table[0].length || rows !== table.length };
}
function pairwiseWelch(names, groups, adjust, pAdjust2) {
  const out = [];
  for (let i = 0; i < groups.length - 1; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const x = groups[i], y = groups[j];
      if (x.length < 2 || y.length < 2) continue;
      const vx = varOf(x) / x.length, vy = varOf(y) / y.length;
      const se = Math.sqrt(vx + vy);
      const t = se > 0 ? (mean(x) - mean(y)) / se : 0;
      const df = se > 0 ? (vx + vy) * (vx + vy) / (vx * vx / (x.length - 1) + vy * vy / (y.length - 1)) : 1;
      out.push({ a: names[i], b: names[j], diff: mean(x) - mean(y), t, df, p: pt2(t, df) });
    }
  }
  const adj = pAdjust2(out.map((r) => r.p), adjust || "holm");
  out.forEach((r, i) => {
    r.pAdj = adj[i];
  });
  return out;
}
function pairwiseChisq(names, table, adjust, pAdjust2, stdres = stdResiduals) {
  const out = [];
  for (let i = 0; i < table.length - 1; i++) {
    for (let j = i + 1; j < table.length; j++) {
      const sub = chisqTest([table[i], table[j]], stdres);
      if (!sub) continue;
      out.push({ a: names[i], b: names[j], X2: sub.X2, df: sub.df, p: sub.p, cramerV: sub.cramerV });
    }
  }
  const adj = pAdjust2(out.map((r) => r.p), adjust || "BH");
  out.forEach((r, i) => {
    r.pAdj = adj[i];
  });
  return out;
}

export { RELIABILITY_METRICS, anova, chisqTest, compareModels, compareSequences, compareWeightMatrices, distanceCorr, kendallTau, kruskal, networkReliability, pairwiseChisq, pairwiseWelch, pchisq, pf, pt2, rankArray, reliabilityAnalysis, rvCoefficient, spearmanCorr, spearmanCorrArr, stdResiduals };
//# sourceMappingURL=chunk-DOMOOFBU.js.map
//# sourceMappingURL=chunk-DOMOOFBU.js.map