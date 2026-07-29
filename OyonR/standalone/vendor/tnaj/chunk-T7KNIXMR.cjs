'use strict';

var chunkRT5XI5AH_cjs = require('./chunk-RT5XI5AH.cjs');

// src/analysis/multinom.ts
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    if (piv !== c) {
      const t = M[piv];
      M[piv] = M[c];
      M[c] = t;
    }
    const d = M[c][c];
    for (let j = c; j <= n; j++) M[c][j] = M[c][j] / d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let j = c; j <= n; j++) M[r][j] = M[r][j] - f * M[c][j];
    }
  }
  return M.map((r) => r[n]);
}
function invertMatrix(A) {
  const n = A.length;
  const inv = [];
  for (let c = 0; c < n; c++) {
    const e = new Array(n).fill(0);
    e[c] = 1;
    const col = solveLinear(A, e);
    if (!col) return null;
    inv.push(col);
  }
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_2, j) => inv[j][i]));
}
function priorsOf(eta, refIdx, k) {
  const full = new Array(k);
  let maxE = 0;
  let e = 0;
  for (let c = 0; c < k; c++) {
    if (c === refIdx) {
      full[c] = 0;
      continue;
    }
    const v = eta[e++];
    full[c] = v;
    if (v > maxE) maxE = v;
  }
  let sum = 0;
  for (let c = 0; c < k; c++) {
    full[c] = Math.exp(full[c] - maxE);
    sum += full[c];
  }
  for (let c = 0; c < k; c++) full[c] = full[c] / sum;
  return full;
}
function logDetInfo(X, beta, refIdx, k, nonRef, p1, ridge) {
  const km1 = k - 1;
  const dim = km1 * p1;
  const I = Array.from({ length: dim }, () => new Array(dim).fill(0));
  for (let i = 0; i < X.length; i++) {
    const xi = X[i];
    const eta = new Array(km1);
    for (let m = 0; m < km1; m++) {
      let acc = 0;
      for (let j = 0; j < p1; j++) acc += xi[j] * beta[m][j];
      eta[m] = acc;
    }
    const pr = priorsOf(eta, refIdx, k);
    for (let m = 0; m < km1; m++) {
      const pm = pr[nonRef[m]];
      for (let l = 0; l < km1; l++) {
        const w = pm * ((m === l ? 1 : 0) - pr[nonRef[l]]);
        if (w === 0) continue;
        for (let j = 0; j < p1; j++) {
          const xw = xi[j] * w;
          for (let q = 0; q < p1; q++) I[m * p1 + j][l * p1 + q] = I[m * p1 + j][l * p1 + q] + xw * xi[q];
        }
      }
    }
  }
  for (let d = 0; d < dim; d++) I[d][d] = I[d][d] + ridge;
  let logDet = 0;
  const M = I.map((r) => r.slice());
  for (let c = 0; c < dim; c++) {
    let piv = c;
    for (let r = c + 1; r < dim; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-300) return -Infinity;
    if (piv !== c) {
      const t = M[piv];
      M[piv] = M[c];
      M[c] = t;
    }
    logDet += Math.log(Math.abs(M[c][c]));
    for (let r = c + 1; r < dim; r++) {
      const f = M[r][c] / M[c][c];
      for (let j = c; j < dim; j++) M[r][j] = M[r][j] - f * M[c][j];
    }
  }
  return logDet;
}
function fitMultinom(X, R, refIdx, beta0, opts) {
  const n = X.length;
  const p1 = n > 0 ? X[0].length : 0;
  const k = n > 0 ? R[0].length : 0;
  const km1 = k - 1;
  const maxIter = opts?.maxIter ?? 100;
  const tol = opts?.tol ?? 1e-10;
  const ridge = opts?.ridge ?? 1e-9;
  const nonRef = [];
  for (let c = 0; c < k; c++) if (c !== refIdx) nonRef.push(c);
  const beta = beta0 ? beta0.map((r) => r.slice()) : Array.from({ length: km1 }, () => new Array(p1).fill(0));
  const dim = km1 * p1;
  const priors = new Array(n);
  let logLik = -Infinity;
  let iterations = 0;
  let converged = false;
  for (let it = 1; it <= maxIter; it++) {
    iterations = it;
    let ll = 0;
    for (let i = 0; i < n; i++) {
      const eta = new Array(km1);
      for (let m = 0; m < km1; m++) {
        let acc = 0;
        for (let j = 0; j < p1; j++) acc += X[i][j] * beta[m][j];
        eta[m] = acc;
      }
      const pr = priorsOf(eta, refIdx, k);
      priors[i] = pr;
      for (let c = 0; c < k; c++) {
        const r = R[i][c];
        if (r > 0) ll += r * Math.log(Math.max(pr[c], 1e-300));
      }
    }
    const g = new Array(dim).fill(0);
    const I = Array.from({ length: dim }, () => new Array(dim).fill(0));
    for (let i = 0; i < n; i++) {
      const xi = X[i], pr = priors[i];
      for (let m = 0; m < km1; m++) {
        const cm = nonRef[m];
        const resid = R[i][cm] - pr[cm];
        for (let j = 0; j < p1; j++) g[m * p1 + j] = g[m * p1 + j] + xi[j] * resid;
      }
      for (let m = 0; m < km1; m++) {
        const pm = pr[nonRef[m]];
        for (let l = 0; l < km1; l++) {
          const pl = pr[nonRef[l]];
          const w = pm * ((m === l ? 1 : 0) - pl);
          if (w === 0) continue;
          for (let j = 0; j < p1; j++) {
            const xw = xi[j] * w;
            for (let q = 0; q < p1; q++) {
              I[m * p1 + j][l * p1 + q] = I[m * p1 + j][l * p1 + q] + xw * xi[q];
            }
          }
        }
      }
    }
    for (let d = 0; d < dim; d++) I[d][d] = I[d][d] + ridge;
    if (opts?.firth) {
      const h = 1e-5;
      for (let d = 0; d < dim; d++) {
        const m = Math.floor(d / p1), j = d % p1;
        const b0 = beta[m][j];
        beta[m][j] = b0 + h;
        const up = logDetInfo(X, beta, refIdx, k, nonRef, p1, ridge);
        beta[m][j] = b0 - h;
        const dn = logDetInfo(X, beta, refIdx, k, nonRef, p1, ridge);
        beta[m][j] = b0;
        if (Number.isFinite(up) && Number.isFinite(dn)) g[d] = g[d] + 0.5 * (up - dn) / (2 * h);
      }
    }
    const step = solveLinear(I, g);
    if (!step) break;
    let maxStep = 0;
    for (let m = 0; m < km1; m++) {
      for (let j = 0; j < p1; j++) {
        const d = step[m * p1 + j];
        beta[m][j] = beta[m][j] + d;
        if (Math.abs(d) > maxStep) maxStep = Math.abs(d);
      }
    }
    logLik = ll;
    if (maxStep < tol) {
      converged = true;
      break;
    }
  }
  for (let i = 0; i < n; i++) {
    const eta = new Array(km1);
    for (let m = 0; m < km1; m++) {
      let acc = 0;
      for (let j = 0; j < p1; j++) acc += X[i][j] * beta[m][j];
      eta[m] = acc;
    }
    priors[i] = priorsOf(eta, refIdx, k);
  }
  return { beta, priors, logLik, iterations, converged };
}
function multinomSE(X, R, priors, refIdx) {
  const n = X.length;
  const p1 = n > 0 ? X[0].length : 0;
  const k = n > 0 ? R[0].length : 0;
  const km1 = k - 1;
  const nonRef = [];
  for (let c = 0; c < k; c++) if (c !== refIdx) nonRef.push(c);
  const dim = km1 * p1;
  const I = Array.from({ length: dim }, () => new Array(dim).fill(0));
  for (let i = 0; i < n; i++) {
    const xi = X[i], pr = priors[i], ri = R[i];
    for (let m = 0; m < km1; m++) {
      const cm = nonRef[m];
      for (let l = 0; l < km1; l++) {
        const cl = nonRef[l];
        const d = m === l ? 1 : 0;
        const complete = pr[cm] * (d - pr[cl]);
        const missing = ri[cm] * (d - ri[cl]);
        const w = complete - missing;
        if (w === 0) continue;
        for (let j = 0; j < p1; j++) {
          const xw = xi[j] * w;
          for (let q = 0; q < p1; q++) {
            I[m * p1 + j][l * p1 + q] = I[m * p1 + j][l * p1 + q] + xw * xi[q];
          }
        }
      }
    }
  }
  const inv = invertMatrix(I);
  const se = Array.from({ length: km1 }, () => new Array(p1).fill(NaN));
  if (!inv) return { se, ok: false };
  let ok = true;
  for (let m = 0; m < km1; m++) {
    for (let j = 0; j < p1; j++) {
      const v = inv[m * p1 + j][m * p1 + j];
      if (!(v > 0)) {
        ok = false;
        se[m][j] = NaN;
      } else se[m][j] = Math.sqrt(v);
    }
  }
  return { se, ok };
}

// src/analysis/mmm.ts
var EPS = 1e-300;
function isTNA(x) {
  return !Array.isArray(x) && typeof x === "object" && "labels" in x && "weights" in x;
}
function deriveLabels(rows) {
  const set = /* @__PURE__ */ new Set();
  for (const row of rows) {
    for (const v of row) {
      if (v === null || v === void 0 || v === "") continue;
      set.add(v);
    }
  }
  return [...set].sort();
}
function validateMmmOptions(o) {
  const whole = (x) => Number.isFinite(x) && Number.isInteger(x);
  if (!whole(o.k) || o.k < 2) {
    throw new Error("mmm: k must be a whole finite number >= 2");
  }
  if (!whole(o.maxIter) || o.maxIter < 1) {
    throw new Error("mmm: maxIter must be a positive whole finite number");
  }
  if (!Number.isFinite(o.tol) || o.tol <= 0) {
    throw new Error("mmm: tol must be a finite positive number");
  }
  if (!Number.isFinite(o.alpha) || o.alpha < 0) {
    throw new Error("mmm: alpha (Laplace smoothing) must be a finite non-negative number");
  }
  if (!whole(o.nStarts) || o.nStarts < 1) {
    throw new Error("mmm: nStarts must be a positive whole finite number");
  }
  if (!whole(o.seed) || o.seed < 0) {
    throw new Error("mmm: seed must be a non-negative whole finite number");
  }
}
function mmm(data, options) {
  const { k } = options;
  const maxIter = options.maxIter ?? 200;
  const tol = options.tol ?? 1e-8;
  const alpha = options.alpha ?? 0.01;
  const seed = options.seed ?? 42;
  const nStartsOpt = options.nStarts ?? 1;
  validateMmmOptions({ k, maxIter, tol, alpha, seed, nStarts: nStartsOpt });
  let rows;
  let labels;
  if (isTNA(data)) {
    if (!data.data) throw new Error("mmm: TNA model missing data");
    rows = data.data;
    labels = data.labels.slice();
  } else {
    rows = data;
    labels = deriveLabels(rows);
  }
  if (labels.length < 2) throw new Error("mmm: need at least 2 states");
  const n = rows.length;
  if (k > n) throw new Error(`mmm: k=${k} exceeds number of sequences (${n})`);
  const s = labels.length;
  const s2 = s * s;
  const labelIdx = /* @__PURE__ */ new Map();
  for (let i = 0; i < s; i++) labelIdx.set(labels[i], i);
  const counts = new Float64Array(n * s2);
  const initState = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const row = rows[i];
    const first = row.length > 0 ? row[0] : null;
    const fi = first == null || first === "" ? void 0 : labelIdx.get(first);
    initState[i] = fi === void 0 ? -1 : fi;
    const base = i * s2;
    for (let t = 0; t + 1 < row.length; t++) {
      const a = row[t];
      const b = row[t + 1];
      if (a == null || a === "" || b == null || b === "") continue;
      const fa = labelIdx.get(a);
      const fb = labelIdx.get(b);
      if (fa === void 0 || fb === void 0) continue;
      counts[base + fa * s + fb] = counts[base + fa * s + fb] + 1;
    }
  }
  const covRaw = options.covariates;
  let design = null;
  let refIdx = 0;
  if (covRaw) {
    if (covRaw.length !== n) {
      throw new Error(`mmm: covariates must have one row per sequence (got ${covRaw.length}, need ${n})`);
    }
    const p = covRaw[0]?.length ?? 0;
    design = covRaw.map((r, i) => {
      if (r.length !== p) throw new Error(`mmm: covariate row ${i} has ${r.length} columns, expected ${p}`);
      for (const v of r) if (!Number.isFinite(v)) throw new Error(`mmm: covariate row ${i} contains a non-finite value`);
      return [1, ...r];
    });
    const rc = options.refCluster ?? 1;
    if (!Number.isInteger(rc) || rc < 1 || rc > k) throw new Error(`mmm: refCluster must be in 1..${k}`);
    refIdx = rc - 1;
  }
  function runEm(post0) {
    const post2 = post0;
    const pAll2 = new Float64Array(s2 * k);
    const initAll2 = new Float64Array(s * k);
    const pi2 = new Float64Array(k);
    const logLikRow = new Float64Array(n * k);
    const logPriors = new Float64Array(n * k);
    let mn = null;
    let ll2 = -Infinity;
    let llPrev = -Infinity;
    let converged2 = false;
    let iterations2 = 0;
    for (let iter = 1; iter <= maxIter; iter++) {
      iterations2 = iter;
      pAll2.fill(alpha);
      for (let i = 0; i < n; i++) {
        const cb = i * s2;
        const pb = i * k;
        for (let pair0 = 0; pair0 < s2; pair0++) {
          const c = counts[cb + pair0];
          if (c !== 0) {
            const base = pair0 * k;
            for (let m = 0; m < k; m++) pAll2[base + m] = pAll2[base + m] + c * post2[pb + m];
          }
        }
      }
      for (let from = 0; from < s; from++) {
        for (let m = 0; m < k; m++) {
          let fsum = 0;
          for (let to = 0; to < s; to++) fsum += pAll2[(from * s + to) * k + m];
          if (fsum === 0) fsum = 1;
          for (let to = 0; to < s; to++) {
            pAll2[(from * s + to) * k + m] = pAll2[(from * s + to) * k + m] / fsum;
          }
        }
      }
      initAll2.fill(alpha);
      for (let i = 0; i < n; i++) {
        const st = initState[i];
        if (st >= 0) {
          const pb = i * k;
          const ib = st * k;
          for (let m = 0; m < k; m++) initAll2[ib + m] = initAll2[ib + m] + post2[pb + m];
        }
      }
      for (let m = 0; m < k; m++) {
        let isum = 0;
        for (let st = 0; st < s; st++) isum += initAll2[st * k + m];
        if (isum === 0) isum = 1;
        for (let st = 0; st < s; st++) initAll2[st * k + m] = initAll2[st * k + m] / isum;
      }
      for (let m = 0; m < k; m++) {
        let acc = 0;
        for (let i = 0; i < n; i++) acc += post2[i * k + m];
        pi2[m] = acc / n;
      }
      if (design) {
        const R = new Array(n);
        for (let i = 0; i < n; i++) {
          const r = new Array(k);
          for (let m = 0; m < k; m++) r[m] = post2[i * k + m];
          R[i] = r;
        }
        mn = fitMultinom(design, R, refIdx, mn ? mn.beta : void 0);
        for (let i = 0; i < n; i++) {
          for (let m = 0; m < k; m++) logPriors[i * k + m] = Math.log(mn.priors[i][m] + EPS);
        }
      } else {
        for (let i = 0; i < n; i++) {
          for (let m = 0; m < k; m++) logPriors[i * k + m] = Math.log(pi2[m] + EPS);
        }
      }
      for (let i = 0; i < n; i++) {
        const cb = i * s2;
        const lb = i * k;
        const st = initState[i] < 0 ? 0 : initState[i];
        for (let m = 0; m < k; m++) {
          let acc = 0;
          for (let pair0 = 0; pair0 < s2; pair0++) {
            const c = counts[cb + pair0];
            if (c !== 0) acc += c * Math.log(pAll2[pair0 * k + m] + EPS);
          }
          acc += Math.log(initAll2[st * k + m] + EPS);
          acc += logPriors[lb + m];
          logLikRow[lb + m] = acc;
        }
      }
      ll2 = 0;
      for (let i = 0; i < n; i++) {
        const lb = i * k;
        let logMax = -Infinity;
        for (let m = 0; m < k; m++) {
          const v = logLikRow[lb + m];
          if (v > logMax) logMax = v;
        }
        let rowSum = 0;
        for (let m = 0; m < k; m++) {
          const e = Math.exp(logLikRow[lb + m] - logMax);
          post2[lb + m] = e;
          rowSum += e;
        }
        if (rowSum === 0) rowSum = EPS;
        for (let m = 0; m < k; m++) post2[lb + m] = post2[lb + m] / rowSum;
        ll2 += logMax + Math.log(rowSum);
      }
      if (Math.abs(ll2 - llPrev) < tol) {
        converged2 = true;
        break;
      }
      llPrev = ll2;
    }
    return { post: post2, pAll: pAll2, initAll: initAll2, pi: pi2, ll: ll2, iterations: iterations2, converged: converged2, mn };
  }
  let nStarts = Math.max(1, Math.floor(options.nStarts ?? 1));
  const explicitInit = options.initPosterior != null;
  if (explicitInit) {
    const ip = options.initPosterior;
    if (ip.length !== n * k) {
      throw new Error(`mmm: initPosterior must have length n*k (${n * k})`);
    }
    nStarts = 1;
  }
  const restartLogLiks = new Float64Array(nStarts);
  let best = null;
  for (let r = 0; r < nStarts; r++) {
    const post0 = new Float64Array(n * k);
    if (explicitInit) {
      const ip = options.initPosterior;
      for (let idx = 0; idx < n * k; idx++) post0[idx] = ip[idx];
    } else {
      const rng = new chunkRT5XI5AH_cjs.SeededRNG(seed + r >>> 0);
      for (let i = 0; i < n; i++) {
        let rsum = 0;
        for (let m = 0; m < k; m++) {
          const v = rng.random();
          post0[i * k + m] = v;
          rsum += v;
        }
        if (rsum === 0) rsum = 1;
        for (let m = 0; m < k; m++) post0[i * k + m] = post0[i * k + m] / rsum;
      }
    }
    const fit = runEm(post0);
    restartLogLiks[r] = fit.ll;
    if (best === null || fit.ll > best.ll) best = fit;
  }
  const { post, pAll, initAll, pi, ll, iterations, converged } = best;
  const assignments = new Array(n);
  for (let i = 0; i < n; i++) {
    const lb = i * k;
    let best2 = 0;
    let bestV = post[lb];
    for (let m = 1; m < k; m++) {
      if (post[lb + m] > bestV) {
        bestV = post[lb + m];
        best2 = m;
      }
    }
    assignments[i] = best2 + 1;
  }
  const avepp = new Float64Array(k).fill(NaN);
  {
    const sumM = new Float64Array(k);
    const cntM = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const m = assignments[i] - 1;
      sumM[m] = sumM[m] + post[i * k + m];
      cntM[m] = cntM[m] + 1;
    }
    for (let m = 0; m < k; m++) if (cntM[m] > 0) avepp[m] = sumM[m] / cntM[m];
  }
  let aveppOverall = 0;
  let classificationError = 0;
  let classEntropy = 0;
  let entRaw = 0;
  for (let i = 0; i < n; i++) {
    const lb = i * k;
    let mx = post[lb];
    for (let m = 1; m < k; m++) if (post[lb + m] > mx) mx = post[lb + m];
    aveppOverall += mx;
    if (mx < 0.5) classificationError += 1;
    classEntropy -= Math.log(post[lb + (assignments[i] - 1)] + EPS);
    for (let m = 0; m < k; m++) {
      const v = post[lb + m];
      entRaw -= v * Math.log(v + EPS);
    }
  }
  aveppOverall /= n;
  classificationError /= n;
  const entMax = n * Math.log(k);
  const entropy = entMax > 0 ? entRaw / entMax : 0;
  const relativeEntropy = 1 - entropy;
  const nMixParams = design ? (k - 1) * design[0].length : k - 1;
  const nParams = k * s * (s - 1) + k * (s - 1) + nMixParams;
  const bic = -2 * ll + nParams * Math.log(n);
  const aic = -2 * ll + 2 * nParams;
  const icl = bic + 2 * classEntropy;
  const responsibilities = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = new Array(k);
    for (let m = 0; m < k; m++) r[m] = post[i * k + m];
    responsibilities[i] = r;
  }
  const delta = new Array(k);
  const transition = new Array(k);
  for (let m = 0; m < k; m++) {
    const d = new Float64Array(s);
    for (let st = 0; st < s; st++) d[st] = initAll[st * k + m];
    delta[m] = d;
    const M = chunkRT5XI5AH_cjs.Matrix.zeros(s, s);
    for (let from = 0; from < s; from++) {
      for (let to = 0; to < s; to++) M.set(from, to, pAll[(from * s + to) * k + m]);
    }
    transition[m] = M;
  }
  return {
    k,
    assignments,
    responsibilities,
    pi,
    delta,
    transition,
    logLik: ll,
    df: nParams,
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
    iterations,
    converged,
    nStarts,
    restartLogLiks,
    labels,
    nSequences: n,
    covariateModel: buildCovariateModel()
  };
  function buildCovariateModel() {
    if (!design || !best || !best.mn) return void 0;
    const mnFit = best.mn;
    const p1 = design[0].length;
    const names = options.covariateNames && options.covariateNames.length === p1 - 1 ? options.covariateNames.slice() : Array.from({ length: p1 - 1 }, (_, j) => "X" + (j + 1));
    const terms = ["(Intercept)", ...names];
    const R = new Array(n);
    for (let i = 0; i < n; i++) {
      const r = new Array(k);
      for (let m = 0; m < k; m++) r[m] = best.post[i * k + m];
      R[i] = r;
    }
    const { se, ok } = multinomSE(design, R, mnFit.priors, refIdx);
    const clusters = [];
    for (let c = 0; c < k; c++) if (c !== refIdx) clusters.push(c + 1);
    const z = mnFit.beta.map((row, m) => row.map((b, j) => b / se[m][j]));
    const pValues = z.map((row) => row.map((v) => Number.isFinite(v) ? 2 * (1 - normalCdf(Math.abs(v))) : NaN));
    return {
      terms,
      refCluster: refIdx + 1,
      clusters,
      coefficients: mnFit.beta.map((r) => r.slice()),
      oddsRatios: mnFit.beta.map((r) => r.map((b) => Math.exp(b))),
      se,
      z,
      pValues,
      priors: mnFit.priors.map((r) => r.slice()),
      seOk: ok
    };
  }
}
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const pr = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - pr : pr;
}
function clusterMmm(data, options) {
  const fit = mmm(data, options);
  let rows;
  if (isTNA(data)) {
    rows = data.data ?? [];
  } else {
    rows = data.map((r) => r.slice());
  }
  const models = {};
  for (let m = 0; m < fit.k; m++) {
    const memberRows = [];
    for (let i = 0; i < fit.assignments.length; i++) {
      if (fit.assignments[i] === m + 1) memberRows.push(rows[i] ?? []);
    }
    models[`Cluster ${m + 1}`] = chunkRT5XI5AH_cjs.createTNA(
      fit.transition[m],
      fit.delta[m],
      fit.labels.slice(),
      memberRows,
      "relative",
      []
    );
  }
  const clustering = {
    k: fit.k,
    assignments: fit.assignments,
    responsibilities: fit.responsibilities,
    mixing: fit.pi,
    quality: fit.quality,
    logLik: fit.logLik,
    df: fit.df,
    aic: fit.aic,
    bic: fit.bic,
    icl: fit.icl,
    iterations: fit.iterations,
    converged: fit.converged,
    covariateModel: fit.covariateModel,
    nStarts: fit.nStarts,
    restartLogLiks: fit.restartLogLiks,
    labels: fit.labels,
    nSequences: fit.nSequences,
    data: rows
  };
  return { models, clustering };
}
function mmmAssign(data, params) {
  const rows = isTNA(data) ? data.data ?? [] : data;
  const { labels, transition } = params;
  const k = transition.length;
  const s = labels.length;
  if (k < 1) throw new Error("mmmAssign: need at least 1 component");
  if (params.delta.length !== k) throw new Error(`mmmAssign: delta has ${params.delta.length} entries, expected k=${k}`);
  if (params.pi.length !== k) throw new Error(`mmmAssign: pi has ${params.pi.length} entries, expected k=${k}`);
  const labelIdx = /* @__PURE__ */ new Map();
  for (let i = 0; i < s; i++) labelIdx.set(labels[i], i);
  const logPi = new Float64Array(k);
  const logDelta = new Float64Array(k * s);
  const logP = new Float64Array(k * s * s);
  for (let m = 0; m < k; m++) {
    logPi[m] = Math.log((params.pi[m] ?? 0) + EPS);
    const dm = params.delta[m];
    if (dm.length !== s) throw new Error(`mmmAssign: delta[${m}] has ${dm.length} states, expected ${s}`);
    const tm = transition[m];
    if (tm.rows !== s || tm.cols !== s) throw new Error(`mmmAssign: transition[${m}] is ${tm.rows}\xD7${tm.cols}, expected ${s}\xD7${s}`);
    for (let st = 0; st < s; st++) logDelta[m * s + st] = Math.log((dm[st] ?? 0) + EPS);
    for (let a = 0; a < s; a++) {
      for (let b = 0; b < s; b++) logP[(m * s + a) * s + b] = Math.log(tm.get(a, b) + EPS);
    }
  }
  const n = rows.length;
  const assignments = new Array(n);
  const avepp = new Float64Array(n);
  const counts = new Array(k).fill(0);
  const score = new Float64Array(k);
  let aveppSum = 0;
  for (let i = 0; i < n; i++) {
    const row = rows[i] ?? [];
    const first = row.length > 0 ? row[0] : null;
    const fi = first == null || first === "" ? void 0 : labelIdx.get(first);
    const st0 = fi === void 0 ? 0 : fi;
    for (let m = 0; m < k; m++) score[m] = logPi[m] + logDelta[m * s + st0];
    for (let t = 0; t + 1 < row.length; t++) {
      const a = row[t];
      const b = row[t + 1];
      if (a == null || a === "" || b == null || b === "") continue;
      const fa = labelIdx.get(a);
      const fb = labelIdx.get(b);
      if (fa === void 0 || fb === void 0) continue;
      for (let m = 0; m < k; m++) score[m] = score[m] + logP[(m * s + fa) * s + fb];
    }
    let best = 0;
    for (let m = 1; m < k; m++) if (score[m] > score[best]) best = m;
    let denom = 0;
    for (let m = 0; m < k; m++) denom += Math.exp(score[m] - score[best]);
    assignments[i] = best + 1;
    avepp[i] = 1 / denom;
    aveppSum += avepp[i];
    counts[best] = counts[best] + 1;
  }
  return { assignments, avepp, aveppOverall: n ? aveppSum / n : NaN, counts, nSequences: n };
}

exports.clusterMmm = clusterMmm;
exports.fitMultinom = fitMultinom;
exports.invertMatrix = invertMatrix;
exports.mmm = mmm;
exports.mmmAssign = mmmAssign;
exports.multinomSE = multinomSE;
exports.solveLinear = solveLinear;
exports.validateMmmOptions = validateMmmOptions;
//# sourceMappingURL=chunk-T7KNIXMR.cjs.map
//# sourceMappingURL=chunk-T7KNIXMR.cjs.map