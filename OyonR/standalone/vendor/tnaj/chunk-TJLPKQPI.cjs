'use strict';

var chunkO5U3BFYT_cjs = require('./chunk-O5U3BFYT.cjs');
var chunkRT5XI5AH_cjs = require('./chunk-RT5XI5AH.cjs');

// src/lagdynamics/math.ts
var matrix = (r, c, value2 = 0) => Array.from({ length: r }, () => Array(c).fill(value2));
var cloneMatrix = (x) => x.map((r) => r.slice());
var rowSums = (x) => x.map((r) => r.reduce((a, b) => a + b, 0));
var colSums = (x) => Array.from({ length: x[0]?.length ?? 0 }, (_, j) => x.reduce((s, r) => s + r[j], 0));
var sum = (x) => x.reduce((a, b) => a + b, 0);
var flattenColumnMajor = (x) => {
  const out = [];
  for (let j = 0; j < (x[0]?.length ?? 0); j++) for (let i = 0; i < x.length; i++) out.push(x[i][j]);
  return out;
};
var transpose = (x) => Array.from({ length: x[0]?.length ?? 0 }, (_, j) => x.map((r) => r[j]));
var outer = (a, b, fn = (x, y) => x * y) => a.map((x) => b.map((y) => fn(x, y)));
function mean(x) {
  const v = x.filter(Number.isFinite);
  return v.length ? sum(v) / v.length : NaN;
}
function sampleSD(x) {
  const v = x.filter(Number.isFinite);
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(sum(v.map((z) => (z - m) ** 2)) / (v.length - 1));
}
function quantile7(x, p) {
  const v = x.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  if (v.length === 1) return v[0];
  const h = (v.length - 1) * p;
  const lo = Math.floor(h);
  const f = h - lo;
  return v[lo] + f * (v[Math.min(lo + 1, v.length - 1)] - v[lo]);
}
function normalP(z, alternative) {
  if (!Number.isFinite(z)) return NaN;
  const twoSided = chunkO5U3BFYT_cjs.pchisq(z * z, 1);
  if (alternative === "greater") return z >= 0 ? twoSided / 2 : 1 - twoSided / 2;
  if (alternative === "less") return z <= 0 ? twoSided / 2 : 1 - twoSided / 2;
  return twoSided;
}
var chiSquareUpper = (q, df) => df > 0 ? chunkO5U3BFYT_cjs.pchisq(q, df) : NaN;
function pearson(a, b) {
  const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 2) return NaN;
  const am = mean(pairs.map((p) => p[0])), bm = mean(pairs.map((p) => p[1]));
  let num = 0, da = 0, db = 0;
  for (const [x, y] of pairs) {
    num += (x - am) * (y - bm);
    da += (x - am) ** 2;
    db += (y - bm) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : NaN;
}
function ranks(x) {
  const order = x.map((v, i2) => ({ v, i: i2 })).sort((a, b) => a.v - b.v);
  const out = Array(x.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i + 1;
    while (j < order.length && order[j].v === order[i].v) j++;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) out[order[k].i] = rank;
    i = j;
  }
  return out;
}
var spearman = (a, b) => {
  const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  return pearson(ranks(pairs.map((p) => p[0])), ranks(pairs.map((p) => p[1])));
};
function logGamma(x) {
  const p = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9984369578019572e-21, 15056327351493116e-23];
  if (x < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = 0.9999999999998099;
  for (let i = 0; i < p.length; i++) a += p[i] / (x + i + 1);
  const t = x + p.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betaCF(a, b, x) {
  const eps = 3e-14, tiny = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}
function betaCDF(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2) ? bt * betaCF(a, b, x) / a : 1 - bt * betaCF(b, a, 1 - x) / b;
}
function betaQuantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (betaCDF(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
function binomialP(x, n, alternative) {
  if (n <= 0) return NaN;
  const logChoose = (nn, k) => logGamma(nn + 1) - logGamma(k + 1) - logGamma(nn - k + 1);
  const prob = (k) => Math.exp(logChoose(n, k) - n * Math.log(2));
  if (alternative === "greater") return Math.min(1, Array.from({ length: n - x + 1 }, (_, i) => prob(x + i)).reduce((a, b) => a + b, 0));
  if (alternative === "less") return Math.min(1, Array.from({ length: x + 1 }, (_, i) => prob(i)).reduce((a, b) => a + b, 0));
  const px = prob(x);
  return Math.min(1, Array.from({ length: n + 1 }, (_, i) => prob(i)).filter((v) => v <= px * (1 + 1e-12)).reduce((a, b) => a + b, 0));
}

// src/lagdynamics/data.ts
var missing = (v) => v == null || v === "";
var isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
function lsaData(input, labels) {
  if (typeof input === "object" && input !== null && "source" in input && "nStates" in input) return input;
  if (!Array.isArray(input) || input.length === 0) throw new Error("Input must contain at least one usable sequence.");
  const nested = Array.isArray(input[0]);
  if (nested) {
    const rows = input;
    const squareNumeric = rows.length >= 2 && rows.every((r) => r.length === rows.length && r.every(isFiniteNumber));
    if (squareNumeric) return lsaDataFromMatrix(rows, labels);
    return lsaDataFromSequences(rows, labels);
  }
  return lsaDataFromSequences([input], labels);
}
function lsaDataFromMatrix(observed, labels) {
  const n = observed.length;
  if (n < 2 || observed.some((r) => r.length !== n)) throw new Error("Transition matrix must be square and at least 2 x 2.");
  if (observed.flat().some((v) => !Number.isFinite(v) || v < 0)) throw new Error("Transition matrix must contain finite non-negative counts.");
  const resolved = labels?.slice() ?? Array.from({ length: n }, (_, i) => `Code ${i + 1}`);
  if (resolved.length !== n || new Set(resolved).size !== n) throw new Error("labels must contain one unique name per state.");
  return {
    events: null,
    seqId: null,
    labels: resolved,
    nStates: n,
    nSequences: NaN,
    nEvents: NaN,
    transitionsPerSequence: [],
    source: "transitions",
    observedInput: cloneMatrix(observed),
    sequences: null
  };
}
function lsaDataFromSequences(raw, labels) {
  const seqs = raw.map((s) => s.filter((v) => !missing(v))).filter((s) => s.length > 0);
  if (!seqs.length) throw new Error("No usable sequences in input after missing values were removed.");
  const flat = seqs.flat();
  let resolvedLabels;
  let mapValue;
  if (labels) {
    resolvedLabels = labels.map(String);
    if (new Set(resolvedLabels).size !== resolvedLabels.length) throw new Error("labels must be unique.");
    mapValue = (v) => {
      if (typeof v === "number") {
        if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1 || v > resolvedLabels.length) throw new Error("Numeric event codes must be finite whole numbers within labels.");
        return v - 1;
      }
      const i = resolvedLabels.indexOf(String(v));
      if (i < 0) throw new Error(`Event '${String(v)}' is not in labels.`);
      return i;
    };
  } else if (flat.every((v) => typeof v === "number" || typeof v === "boolean")) {
    const ints = flat.map(Number);
    if (ints.some((v) => !Number.isFinite(v) || !Number.isInteger(v) || v < 1)) throw new Error("Numeric event codes must be finite whole numbers >= 1.");
    const k = Math.max(...ints);
    resolvedLabels = Array.from({ length: k }, (_, i) => `Code ${i + 1}`);
    mapValue = (v) => Number(v) - 1;
  } else {
    resolvedLabels = [...new Set(flat.map(String))].sort();
    mapValue = (v) => resolvedLabels.indexOf(String(v));
  }
  const sequences2 = seqs.map((s) => s.map(mapValue));
  const events = sequences2.flat();
  const seqId = sequences2.flatMap((s, i) => Array(s.length).fill(i));
  return {
    events,
    seqId,
    labels: resolvedLabels,
    nStates: resolvedLabels.length,
    nSequences: sequences2.length,
    nEvents: events.length,
    transitionsPerSequence: sequences2.map((s) => Math.max(0, s.length - 1)),
    source: "events",
    observedInput: null,
    sequences: sequences2
  };
}
function lsaTransitions(input, lag = 1) {
  if (!Number.isFinite(lag) || !Number.isInteger(lag)) throw new Error("lag must be a finite whole number.");
  const d = lsaData(input);
  let observed;
  if (d.source === "transitions") {
    if (lag !== 1) throw new Error("Pre-computed transition matrices only support lag = 1.");
    observed = cloneMatrix(d.observedInput);
  } else {
    observed = matrix(d.nStates, d.nStates);
    for (const sequence of d.sequences) {
      if (lag >= 0) for (let i = 0; i + lag < sequence.length; i++) observed[sequence[i]][sequence[i + lag]]++;
      else for (let i = -lag; i < sequence.length; i++) observed[sequence[i]][sequence[i + lag]]++;
    }
  }
  const rt = rowSums(observed), ct = colSums(observed), total = sum(rt);
  const edges = [];
  for (let j = 0; j < d.nStates; j++) for (let i = 0; i < d.nStates; i++) edges.push({
    from: d.labels[i],
    to: d.labels[j],
    lag,
    count: observed[i][j],
    rowTotal: rt[i],
    colTotal: ct[j],
    nTransitions: total
  });
  return { observed, rowTotals: rt, colTotals: ct, nTransitions: total, lag, labels: d.labels.slice(), edges };
}
function prepareLong(rows, options) {
  if (!Array.isArray(rows)) throw new Error("Long-format input must be an array of row objects.");
  const { actor, action, time, order, session, group } = options;
  const threshold = options.timeThreshold ?? 900;
  for (const col of [actor, action, time, order, session, group].filter(Boolean)) if (rows.some((r) => !(col in r))) throw new Error(`Column '${col}' was not found.`);
  const div = options.unixTimeUnit === "milliseconds" ? 1e3 : options.unixTimeUnit === "microseconds" ? 1e6 : 1;
  const timeValue = (v) => {
    if (typeof v === "number") return v / div;
    const t = Date.parse(String(v)) / 1e3;
    if (!Number.isFinite(t)) throw new Error(`Could not parse time '${String(v)}'.`);
    return t;
  };
  const buckets = /* @__PURE__ */ new Map();
  rows.forEach((r, i) => {
    const key = `${actor ? String(r[actor]) : ""}\0${session ? String(r[session]) : ""}`;
    const b = buckets.get(key) ?? [];
    b.push(i);
    buckets.set(key, b);
  });
  const sequences2 = [], groups = [];
  for (const indices of buckets.values()) {
    indices.sort((a, b) => order ? Number(rows[a][order]) - Number(rows[b][order]) : time ? timeValue(rows[a][time]) - timeValue(rows[b][time]) : a - b);
    if (group) {
      const gs = [...new Set(indices.map((i) => String(rows[i][group])))];
      if (gs.length !== 1) throw new Error(`Group column '${group}' must be constant within every recovered sequence.`);
    }
    let current = [], previous = NaN;
    for (const i of indices) {
      const t = time ? timeValue(rows[i][time]) : NaN;
      if (!session && time && current.length && t - previous > threshold) {
        sequences2.push(current);
        if (group) groups.push(String(rows[indices[0]][group]));
        current = [];
      }
      current.push(String(rows[i][action]));
      previous = t;
    }
    if (current.length) {
      sequences2.push(current);
      if (group) groups.push(String(rows[indices[0]][group]));
    }
  }
  return group ? { sequences: sequences2, groups } : { sequences: sequences2 };
}

// src/lagdynamics/engines.ts
function validateSquare(x) {
  const k = x.length;
  if (k < 2 || x.some((r) => r.length !== k)) throw new Error("Expected a square matrix at least 2 x 2.");
  return k;
}
function lsaIPF(observed, options = {}) {
  const k = validateSquare(observed);
  if (observed.flat().some((v) => !Number.isFinite(v) || v < 0)) throw new Error("observed must contain finite non-negative counts.");
  const structure = options.structure ? cloneMatrix(options.structure) : matrix(k, k, 1);
  if (structure.length !== k || structure.some((r) => r.length !== k || r.some((v) => v !== 0 && v !== 1))) throw new Error("structure must be a conformable 0/1 matrix.");
  const rt = rowSums(observed), ct = colSums(observed);
  if (rt.some((v, i) => v > 0 && sum(structure[i]) === 0)) throw new Error("IPF is infeasible: positive row with no estimable cells.");
  const sc = colSums(structure);
  if (ct.some((v, j) => v > 0 && sc[j] === 0)) throw new Error("IPF is infeasible: positive column with no estimable cells.");
  let fit = cloneMatrix(structure), iterations = 0, converged = false, maxMarginDifference = Infinity;
  const tolerance = options.tolerance ?? 1e-8, maxIterations = options.maxIterations ?? 200;
  while (iterations++ < maxIterations) {
    const rs = rowSums(fit);
    fit = fit.map((r, i) => r.map((v) => v * (rs[i] > 0 ? rt[i] / rs[i] : 0)));
    const cs = colSums(fit);
    fit = fit.map((r) => r.map((v, j) => v * (cs[j] > 0 ? ct[j] / cs[j] : 0)));
    maxMarginDifference = Math.max(...rowSums(fit).map((v, i) => Math.abs(v - rt[i])), ...colSums(fit).map((v, j) => Math.abs(v - ct[j])));
    if (maxMarginDifference < tolerance) {
      converged = true;
      break;
    }
  }
  return { fit, iterations, converged, maxMarginDifference };
}
var rowNormalize = (x) => {
  const r = rowSums(x);
  return x.map((row, i) => row.map((v) => r[i] > 0 ? v / r[i] : NaN));
};
function yulesQ(obs) {
  const rt = rowSums(obs), ct = colSums(obs), n = sum(rt);
  return obs.map((row, i) => row.map((a, j) => {
    const b = rt[i] - a, c = ct[j] - a, d = n - rt[i] - ct[j] + a, den = a * d + b * c;
    return den > 0 ? (a * d - b * c) / den : NaN;
  }));
}
function naMatrix(k) {
  return matrix(k, k, NaN);
}
function expectedIndependence(obs) {
  const rt = rowSums(obs), ct = colSums(obs), n = sum(rt);
  return outer(rt, ct, (a, b) => a * b / n);
}
function adjustedResiduals(obs, expected, structure) {
  const k = obs.length, rt = rowSums(obs), ct = colSums(obs), n = sum(rt);
  if (!structure) return obs.map((row, i) => row.map((o, j) => {
    const d = expected[i][j] * (1 - rt[i] / n) * (1 - ct[j] / n);
    return Number.isFinite(d) && d > 0 ? (o - expected[i][j]) / Math.sqrt(d) : NaN;
  }));
  const cells = [];
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) if (structure[i][j] === 1) cells.push([i, j]);
  if (!cells.length) return naMatrix(k);
  const p = 1 + (k - 1) * 2;
  const X = cells.map(([i, j]) => [1, ...Array.from({ length: k - 1 }, (_, q) => i === q + 1 ? 1 : 0), ...Array.from({ length: k - 1 }, (_, q) => j === q + 1 ? 1 : 0)]);
  const A = matrix(p, p);
  for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) for (let r = 0; r < cells.length; r++) A[a][b] += X[r][a] * expected[cells[r][0]][cells[r][1]] * X[r][b];
  let inv;
  try {
    inv = inverse(A);
  } catch {
    return adjustedResiduals(obs, expected, null);
  }
  const z = naMatrix(k);
  cells.forEach(([i, j], r) => {
    let h = 0;
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) h += X[r][a] * inv[a][b] * X[r][b] * expected[i][j];
    const d = expected[i][j] * (1 - h);
    if (Number.isFinite(d) && d > 0) z[i][j] = (obs[i][j] - expected[i][j]) / Math.sqrt(d);
  });
  return z;
}
function inverse(a) {
  const n = a.length, aug = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(aug[r][c]) > Math.abs(aug[p][c])) p = r;
    if (Math.abs(aug[p][c]) < 1e-12) throw new Error("singular");
    [aug[c], aug[p]] = [aug[p], aug[c]];
    const q = aug[c][c];
    aug[c] = aug[c].map((v) => v / q);
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = aug[r][c];
      aug[r] = aug[r].map((v, j) => v - f * aug[c][j]);
    }
  }
  return aug.map((r) => r.slice(n));
}
function matrixRank(a, tolerance = 1e-10) {
  const x = cloneMatrix(a);
  let rank = 0;
  for (let c = 0; c < (x[0]?.length ?? 0) && rank < x.length; c++) {
    let p = rank;
    for (let r = rank + 1; r < x.length; r++) if (Math.abs(x[r][c]) > Math.abs(x[p][c])) p = r;
    if (Math.abs(x[p][c]) <= tolerance) continue;
    [x[rank], x[p]] = [x[p], x[rank]];
    for (let r = rank + 1; r < x.length; r++) {
      const f = x[r][c] / x[rank][c];
      for (let j = c; j < x[r].length; j++) x[r][j] -= f * x[rank][j];
    }
    rank++;
  }
  return rank;
}
function likelihoodRatio(obs, expected, structure) {
  let statistic = 0;
  for (let i = 0; i < obs.length; i++) for (let j = 0; j < obs.length; j++) if (obs[i][j] > 0 && expected[i][j] > 0) statistic += 2 * obs[i][j] * Math.log(obs[i][j] / expected[i][j]);
  let df;
  if (!structure) df = (obs.length - 1) ** 2;
  else {
    const cells = [];
    for (let i = 0; i < obs.length; i++) for (let j = 0; j < obs.length; j++) if (structure[i][j] === 1) cells.push([i, j]);
    const x = cells.map(([i, j]) => [1, ...Array.from({ length: obs.length - 1 }, (_, q) => i === q + 1 ? 1 : 0), ...Array.from({ length: obs.length - 1 }, (_, q) => j === q + 1 ? 1 : 0)]);
    df = cells.length - matrixRank(x);
  }
  return { statistic, df, p: df > 0 ? chiSquareUpper(statistic, df) : NaN };
}
var classical = (ctx) => {
  const obs = cloneMatrix(ctx.transitions.observed), k = obs.length, n = ctx.transitions.nTransitions;
  if (!n) throw new Error("No transitions in input.");
  const ipf = ctx.structuralZeros ? lsaIPF(obs, { structure: ctx.structuralZeros }) : null;
  const expected = ipf?.fit ?? expectedIndependence(obs);
  const z = adjustedResiduals(obs, expected, ctx.structuralZeros), p = z.map((r) => r.map((v) => normalP(v, ctx.alternative)));
  const totals = ctx.eventTotals ?? rowSums(obs).map((v, i) => Math.max(v, colSums(obs)[i]));
  const ne = ctx.nEvents ?? sum(totals);
  const et = outer(totals, totals, (a, b) => a * b / ne), kap = naMatrix(k), kz = naMatrix(k);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const num = obs[i][j] - et[i][j], den = num >= 0 ? Math.min(totals[i], totals[j]) - et[i][j] : et[i][j];
    if (den) kap[i][j] = num / den;
    const v = totals[i] * totals[j] * (ne - totals[i]) * (ne - totals[j]) / (ne ** 2 * (ne - 1));
    if (v > 0) kz[i][j] = num / Math.sqrt(v);
  }
  return { observed: obs, expected, probability: rowNormalize(obs), adjustedResiduals: z, pValues: p, yulesQ: yulesQ(obs), kappa: kap, kappaZ: kz, kappaP: kz.map((r) => r.map((v) => normalP(v, ctx.alternative))), likelihoodRatio: likelihoodRatio(obs, expected, ctx.structuralZeros), ipf: ipf ? { iterations: ipf.iterations, converged: ipf.converged, maxMarginDifference: ipf.maxMarginDifference } : null, extra: {} };
};
var twoCell = (ctx) => {
  if (ctx.structuralZeros) throw new Error("Engine 'two_cell' does not support structural zeros.");
  const obs = cloneMatrix(ctx.transitions.observed), k = obs.length, n = ctx.transitions.nTransitions, continuity = Number(ctx.params.continuity ?? 0.5);
  if (!n) throw new Error("No transitions in input.");
  const rt = rowSums(obs), ct = colSums(obs), expected = expectedIndependence(obs), or = matrix(k, k), logor = matrix(k, k), se = matrix(k, k), z = matrix(k, k);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    let a = obs[i][j], b = rt[i] - a, c = ct[j] - a, d = n - rt[i] - ct[j] + a;
    if (a === 0 || b === 0 || c === 0 || d === 0) {
      a += continuity;
      b += continuity;
      c += continuity;
      d += continuity;
    }
    or[i][j] = a * d / (b * c);
    logor[i][j] = Math.log(or[i][j]);
    se[i][j] = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
    z[i][j] = Number.isFinite(logor[i][j] / se[i][j]) ? logor[i][j] / se[i][j] : NaN;
  }
  return baseResult(obs, expected, z, ctx, { odds_ratio: or, log_or: logor, log_or_se: se, continuity });
};
var bidirectional = (ctx) => {
  noStructural(ctx, "bidirectional");
  const obs = cloneMatrix(ctx.transitions.observed), k = obs.length;
  if (!ctx.transitions.nTransitions) throw new Error("No transitions in input.");
  const tr = transpose(obs), w = obs.map((r, i) => r.map((v, j) => v + tr[i][j])), rt = rowSums(w), n = sum(rt), expected = outer(rt, rt, (a, b) => a * b / n), z = matrix(k, k, NaN);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const d = expected[i][j] * (1 - rt[i] / n) * (1 - rt[j] / n);
    if (d > 0) z[i][j] = (w[i][j] - expected[i][j]) / Math.sqrt(d);
  }
  return baseResult(obs, expected, z, ctx, { symmetric_obs: w, symmetric_exp: expected, marginals: rt }, yulesQ(w));
};
var parallel = (ctx) => dominance(ctx, true);
var nonparallel = (ctx) => dominance(ctx, false);
function dominance(ctx, useExpected) {
  noStructural(ctx, useExpected ? "parallel_dominance" : "nonparallel_dominance");
  const obs = cloneMatrix(ctx.transitions.observed), k = obs.length, n = ctx.transitions.nTransitions;
  if (!n) throw new Error("No transitions in input.");
  const expected = expectedIndependence(obs), z = matrix(k, k, NaN), dom = matrix(k, k), pair = matrix(k, k), bin = matrix(k, k, NaN);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    dom[i][j] = obs[i][j] - obs[j][i];
    pair[i][j] = obs[i][j] + obs[j][i];
    const vv = useExpected ? expected[i][j] + expected[j][i] : pair[i][j];
    if (vv > 0) z[i][j] = dom[i][j] / Math.sqrt(vv);
    if (i === j) z[i][j] = 0;
    if (!useExpected && i !== j && pair[i][j] > 0) bin[i][j] = binomialP(obs[i][j], pair[i][j], ctx.alternative);
  }
  return baseResult(obs, expected, z, ctx, useExpected ? { dominance: dom, dominance_se: pair.map((r, i) => r.map((_, j) => Math.sqrt(expected[i][j] + expected[j][i]))) } : { dominance: dom, pair_totals: pair, binomial_p: bin });
}
function noStructural(ctx, name) {
  if (ctx.structuralZeros) throw new Error(`Engine '${name}' does not support structural zeros.`);
}
function baseResult(obs, expected, z, ctx, extra, q = yulesQ(obs)) {
  const k = obs.length, na = naMatrix(k);
  return { observed: obs, expected, probability: rowNormalize(obs), adjustedResiduals: z, pValues: z.map((r) => r.map((v) => normalP(v, ctx.alternative))), yulesQ: q, kappa: na, kappaZ: cloneMatrix(na), kappaP: cloneMatrix(na), likelihoodRatio: null, ipf: null, extra };
}
var registry = /* @__PURE__ */ new Map();
function registerLSAEngine(name, fn, description, requires = []) {
  if (!name || typeof fn !== "function") throw new Error("A name and engine function are required.");
  registry.set(name, { name, fn, description, requires: [...requires] });
  return name;
}
function getLSAEngine(name) {
  const e = registry.get(name);
  if (!e) throw new Error(`Engine '${name}' is not registered. Available engines: ${[...registry.keys()].join(", ")}`);
  return e;
}
function listLSAEngines() {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name)).map(({ fn: _, ...e }) => e);
}
function unregisterLSAEngine(name) {
  if (!registry.delete(name)) throw new Error(`Engine '${name}' is not registered.`);
}
registerLSAEngine("classical", classical, "Classical adjusted-residual lag sequential analysis");
registerLSAEngine("two_cell", twoCell, "Per-cell 2 x 2 odds-ratio tests");
registerLSAEngine("bidirectional", bidirectional, "Symmetric matched-pair analysis");
registerLSAEngine("parallel_dominance", parallel, "Expected-count directional dominance");
registerLSAEngine("nonparallel_dominance", nonparallel, "Observed-pair directional dominance");

// src/lagdynamics/fit.ts
var defaults = { lag: 1, engine: "classical", alternative: "two.sided", alpha: 0.05, loops: true };
function structuralZeros(value2, loops, k) {
  if (!value2 && loops) return null;
  const out = value2 ? cloneMatrix(value2) : matrix(k, k, 1);
  if (out.length !== k || out.some((r) => r.length !== k || r.some((v) => v !== 0 && v !== 1))) throw new Error(`structuralZeros must be a ${k} x ${k} 0/1 matrix.`);
  if (!loops) for (let i = 0; i < k; i++) out[i][i] = 0;
  return out;
}
function lsa(input, options = {}) {
  const o = { ...defaults, ...options, engine: String(options.engine ?? defaults.engine), params: options.params ?? {} };
  if (!(o.alpha > 0 && o.alpha < 1)) throw new Error("alpha must be between 0 and 1.");
  let preparedInput = input;
  let longGroups;
  if (o.action) {
    const prepared = prepareLong(input, { actor: o.actor, action: o.action, time: o.time, order: o.order, session: o.session, group: typeof o.group === "string" ? o.group : void 0, timeThreshold: o.timeThreshold, unixTimeUnit: o.unixTimeUnit });
    preparedInput = prepared.sequences;
    longGroups = prepared.groups;
  }
  const data = lsaData(preparedInput, o.labels);
  const group = longGroups ?? (Array.isArray(o.group) ? o.group : null);
  if (group) return grouped(data, group, o);
  if (typeof o.group === "string" && !o.action) throw new Error("A string group name is only valid with long-format action input.");
  return fitOne(data, o);
}
function grouped(data, group, options) {
  if (data.source !== "events") throw new Error("Grouped LSA requires event-level sequence data.");
  if (group.length !== data.nSequences) throw new Error("group must have one value per sequence.");
  const levels = [...new Set(group.map(String))], groups = {}, groupSizes = [];
  for (const level of levels) {
    const seqs = data.sequences.filter((_, i) => String(group[i]) === level).map((s) => s.map((v) => v + 1));
    groupSizes.push(seqs.length);
    groups[level] = fitOne(lsaDataFromSequences(seqs, data.labels), { ...options});
  }
  return { kind: "lsa_group", groups, levels, groupSizes, labels: [...data.labels], engine: String(options.engine) };
}
function fitOne(data, options) {
  const sz = structuralZeros(options.structuralZeros, options.loops, data.nStates), tx = lsaTransitions(data, options.lag), eventTotals = data.events ? Array.from({ length: data.nStates }, (_, i) => data.events.filter((v) => v === i).length) : null;
  const result = getLSAEngine(String(options.engine)).fn({ transitions: tx, structuralZeros: sz, alternative: options.alternative, nEvents: data.source === "events" ? data.nEvents : null, eventTotals, params: options.params ?? {} });
  const obs = result.observed, exp = result.expected, prob = result.probability, z = result.adjustedResiduals, p = result.pValues, k = data.nStates, ct = colSums(obs), rt = rowSums(obs);
  const probCol = obs.map((r) => r.map((v, j) => ct[j] > 0 ? v / ct[j] : NaN));
  const edges = [];
  const extraVectors = {};
  for (const [name, value2] of Object.entries(result.extra)) if (Array.isArray(value2) && Array.isArray(value2[0])) extraVectors[name] = flattenColumnMajor(value2);
  let q = 0;
  for (let j = 0; j < k; j++) for (let i = 0; i < k; i++, q++) {
    const count = obs[i][j], expected = exp[i][j], edge = { from: data.labels[i], to: data.labels[j], fromId: i + 1, toId: j + 1, lag: options.lag, count, expected, prob: prob[i][j], probCol: probCol[i][j], adjRes: z[i][j], p: p[i][j], yulesQ: result.yulesQ[i][j], kappa: result.kappa[i][j], kappaZ: result.kappaZ[i][j], kappaP: result.kappaP[i][j], lift: Number.isFinite(expected) && expected > 0 ? count / expected : NaN, sign: count > expected ? "over" : count < expected ? "under" : "expected", significant: Number.isFinite(p[i][j]) && p[i][j] < options.alpha, weight: count };
    for (const [name, v] of Object.entries(extraVectors)) edge[camel(name)] = v[q];
    edges.push(edge);
  }
  const lr = result.likelihoodRatio, pearson2 = lr ? pearsonTest(obs, exp, lr.df) : null;
  let initialProbabilities = null;
  if (data.sequences) {
    const first = data.sequences.map((s) => s[0]);
    initialProbabilities = Array.from({ length: k }, (_, i) => first.filter((v) => v === i).length / first.length);
  }
  return { kind: "lsa", observed: obs, expected: exp, probability: prob, probabilityColumn: probCol, adjustedResiduals: z, pValues: p, yulesQ: result.yulesQ, kappa: result.kappa, kappaZ: result.kappaZ, kappaP: result.kappaP, likelihoodRatio: lr, pearsonChiSquare: pearson2, weights: cloneMatrix(obs), nodes: data.labels.map((label, i) => ({ id: i + 1, label, name: label, outgoing: rt[i], incoming: ct[i] })), edges, directed: options.engine !== "bidirectional", method: String(options.engine), initialProbabilities, data, params: { lag: options.lag, engine: String(options.engine), alternative: options.alternative, alpha: options.alpha, loops: options.loops, structuralZeros: sz, params: options.params ?? {} }, meta: { source: data.source, ipf: result.ipf, nEventsUsed: data.source === "events" ? data.nEvents : null, extra: result.extra } };
}
function pearsonTest(obs, exp, df) {
  let statistic = 0;
  for (let i = 0; i < obs.length; i++) for (let j = 0; j < obs.length; j++) if (exp[i][j] > 0) statistic += (obs[i][j] - exp[i][j]) ** 2 / exp[i][j];
  return { statistic, df, p: df > 0 ? chiSquareUpper(statistic, df) : NaN };
}
var camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
var lsaClassical = (data, options = {}) => lsa(data, { ...options, engine: "classical" });
var lsaTwoCell = (data, options = {}) => lsa(data, { ...options, engine: "two_cell" });
var lsaBidirectional = (data, options = {}) => lsa(data, { ...options, engine: "bidirectional" });
var lsaParallelDominance = (data, options = {}) => lsa(data, { ...options, engine: "parallel_dominance" });
var lsaNonparallelDominance = (data, options = {}) => lsa(data, { ...options, engine: "nonparallel_dominance" });
function transitions(x, options = {}) {
  if ("kind" in x && x.kind === "lsa_lags") return x.fits.flatMap((f) => transitions(f, options));
  if ("kind" in x && x.kind === "lsa_group") return x.levels.flatMap((g) => transitions(x.groups[g], options).map((r) => ({ group: g, ...r })));
  let e = x.edges.map((r) => ({ ...r }));
  if ("kind" in x && x.kind === "lsa") {
    const f = x, alpha = options.alpha ?? f.params.alpha, dir = options.direction ?? "any";
    e = e.filter((r) => !options.significant && dir === "any" || Number.isFinite(r.p) && Number(r.p) < alpha);
    if (dir === "over") e = e.filter((r) => Number(r.adjRes) > 0);
    if (dir === "under") e = e.filter((r) => Number(r.adjRes) < 0);
    if (options.minCount != null) e = e.filter((r) => Number(r.count) >= options.minCount);
    const remove = ["fromId", "toId", "weight"];
    e = e.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !remove.includes(k))));
    const sort = options.sort ?? "none";
    if (sort !== "none") e.sort((a, b) => {
      const key = sort === "strength" ? "adjRes" : sort;
      return Math.abs(Number(b[key])) - Math.abs(Number(a[key]));
    });
  } else {
    if (options.significant) e = e.filter((r) => Boolean(r.significant ?? r.stable ?? r.adjResStable));
    if ((options.sort ?? "none") === "strength") e.sort((a, b) => {
      const strength = (r) => Math.abs(Number(r.diff ?? r.observedAdjRes ?? r.adjResMean ?? r.probMean ?? r.stability ?? 0));
      return strength(b) - strength(a);
    });
  }
  return e;
}
function nodes(x) {
  if (x.kind === "lsa_group") return x.levels.flatMap((g) => nodes(x.groups[g]).map((r) => ({ group: g, ...r })));
  return x.nodes.map((n) => ({ state: n.label, outgoing: n.outgoing, incoming: n.incoming }));
}
function tests(x) {
  if (x.kind === "lsa_group") return x.levels.flatMap((g) => tests(x.groups[g]).map((r) => ({ group: g, ...r })));
  return [["lrx2", x.likelihoodRatio], ["x2", x.pearsonChiSquare]].filter(([, v]) => v).map(([test, v]) => ({ test, ...v }));
}
function transitionProbabilities(x) {
  if (x.kind === "lsa_group") return Object.fromEntries(x.levels.map((g) => [g, transitionProbabilities(x.groups[g])]));
  return cleanWeight(x, "prob");
}
function initial(x) {
  if (x.kind === "lsa_group") return x.levels.flatMap((g) => initial(x.groups[g]).map((r) => ({ group: g, ...r })));
  return x.initialProbabilities ? x.data.labels.map((state, i) => ({ state, initProb: x.initialProbabilities[i] })) : [];
}
function lsaLags(data, lags = [1, 2, 3], options = {}) {
  if (!lags.length || lags.some((l) => !Number.isInteger(l))) throw new Error("lags must contain whole numbers.");
  return { kind: "lsa_lags", lags: [...lags], fits: lags.map((l) => lsa(data, { ...options, lag: l })) };
}
function lagProfile(input, from, to, lags = [1, 2, 3], options = {}) {
  const x = input.kind === "lsa_lags" ? input : lsaLags(input, lags, options);
  return x.fits.map((f) => f.edges.find((e) => e.from === from && e.to === to)).filter(Boolean).map((e) => ({ lag: e.lag, from: e.from, to: e.to, count: e.count, prob: e.prob, adjRes: e.adjRes, p: e.p, significant: e.significant }));
}
function cleanWeight(fit, weights, positive = false) {
  let w;
  if (weights === "prob") w = cloneMatrix(fit.probability);
  else if (weights === "count") w = cloneMatrix(fit.observed);
  else if (weights === "adj_res") w = cloneMatrix(fit.adjustedResiduals);
  else if (weights === "yules_q") w = cloneMatrix(fit.yulesQ);
  else {
    w = matrix(fit.data.nStates, fit.data.nStates);
    for (const e of fit.edges) w[e.fromId - 1][e.toId - 1] = e.lift;
  }
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) if (!Number.isFinite(w[i][j]) || positive && w[i][j] < 0 || fit.params.structuralZeros?.[i]?.[j] === 0) w[i][j] = 0;
  return w;
}
function lsaToTNA(x, weights = "prob") {
  if (x.kind === "lsa_group") return Object.fromEntries(x.levels.map((g) => [g, lsaToTNA(x.groups[g], weights)]));
  const resampleable = weights === "prob" || weights === "count";
  return { weights: cleanWeight(x, weights, weights === "adj_res"), inits: resampleable ? x.initialProbabilities ?? [] : [], labels: [...x.data.labels], data: resampleable ? x.data.sequences?.map((s) => s.map((v) => v + 1)) ?? [] : [], type: weights === "count" ? "frequency" : "relative" };
}

// src/lagdynamics/inference.ts
var rngFor = (seed) => new chunkRT5XI5AH_cjs.SeededRNG(seed ?? Date.now() & 4294967295);
function refit(fit, sequences2) {
  return lsa(sequences2.map((s) => s.map((v) => v + 1)), { ...fit.params, labels: fit.data.labels, group: null });
}
function columns(x) {
  if (!x.length) return [];
  return Array.from({ length: x[0].length }, (_, j) => x.map((r) => r[j]));
}
function validateIterations(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error("iterations must be a positive whole number.");
  return n;
}
function bootstrapLSA(fit, options = {}) {
  if (fit.data.source !== "events") throw new Error("bootstrapLSA requires event-level input.");
  const iterations = validateIterations(options.iterations ?? 1e3), confidenceLevel = options.confidenceLevel ?? 0.95, rng = rngFor(options.seed), seqs = fit.data.sequences, level = options.level === "event" || options.level !== "sequence" && seqs.length < 2 ? "event" : "sequence";
  let indices;
  if (options.indices) {
    indices = options.indices.slice(0, iterations).map((r) => r.slice());
    if (indices.length < iterations) throw new Error("indices must contain one row per iteration.");
    const width = level === "sequence" ? seqs.length : fit.data.nEvents, hi = width;
    if (indices.some((r) => r.length !== width || r.some((v) => !Number.isInteger(v) || v < 0 || v >= hi))) throw new Error(`indices rows must contain exactly ${width} zero-based valid indices.`);
  } else if (level === "sequence") indices = Array.from({ length: iterations }, () => rng.choice(seqs.length, seqs.length));
  else {
    const T = fit.data.nEvents, block = Math.floor(options.blockLength ?? Math.ceil(Math.sqrt(T))), p = 1 / block;
    indices = Array.from({ length: iterations }, () => {
      const out = [];
      while (out.length < T) {
        const start = rng.randInt(T), u = Math.max(Number.MIN_VALUE, rng.random()), len = 1 + Math.floor(Math.log(u) / Math.log(1 - p));
        for (let q = 0; q < len && out.length < T; q++) out.push((start + q) % T);
      }
      return out;
    });
  }
  const observedRows = [], residualRows = [], probRows = [], qRows = [];
  for (const idx of indices) {
    const sampled = level === "sequence" ? idx.map((i) => seqs[i].slice()) : [idx.map((i) => fit.data.events[i])];
    const f = refit(fit, sampled);
    observedRows.push(flattenColumnMajor(f.observed));
    residualRows.push(flattenColumnMajor(f.adjustedResiduals));
    probRows.push(flattenColumnMajor(f.probability));
    qRows.push(flattenColumnMajor(f.yulesQ));
  }
  const edges = summarizeBootstrap(fit, observedRows, residualRows, probRows, qRows, confidenceLevel);
  return { kind: "lsa_bootstrap", edges, bootObserved: observedRows, bootAdjustedResiduals: residualRows, bootProbability: probRows, bootYulesQ: qRows, iterations, level, confidenceLevel, indicesUsed: indices, fit };
}
function summarizeBootstrap(fit, obs, res, prob, q, level) {
  const lo = (1 - level) / 2, source = [columns(obs), columns(res), columns(prob), columns(q)], original = [flattenColumnMajor(fit.observed), flattenColumnMajor(fit.adjustedResiduals), flattenColumnMajor(fit.probability), flattenColumnMajor(fit.yulesQ)];
  return fit.edges.map((e, i) => {
    const oc = source[0][i], ar = source[1][i], pr = source[2][i], yq = source[3][i], o0 = original[0][i], a0 = original[1][i], p0 = original[2][i], q0 = original[3][i];
    const low = (x) => quantile7(x, lo), high = (x) => quantile7(x, 1 - lo), finite = ar.filter(Number.isFinite), pboot = finite.length ? 2 * Math.min(finite.filter((v) => v <= 0).length / finite.length, finite.filter((v) => v >= 0).length / finite.length) : NaN, al = low(ar), ah = high(ar);
    return { from: e.from, to: e.to, observed: o0, countMean: mean(oc), countSE: sampleSD(oc), countCILow: low(oc), countCIHigh: high(oc), adjResObserved: a0, adjResMean: mean(ar), adjResSE: sampleSD(ar), adjResCILow: al, adjResCIHigh: ah, adjResPBootstrap: pboot, adjResStable: Number.isFinite(al) && Number.isFinite(ah) && Math.sign(al) === Math.sign(ah) && al !== 0 && ah !== 0, probObserved: p0, probMean: mean(pr), probCILow: low(pr), probCIHigh: high(pr), yulesQObserved: q0, yulesQMean: mean(yq), yulesQCILow: low(yq), yulesQCIHigh: high(yq) };
  });
}
function certaintyLSA(fit, options = {}) {
  if (fit.kind === "lsa_group") return Object.fromEntries(fit.levels.map((g) => [g, certaintyLSA(fit.groups[g], options)]));
  const prior = options.prior ?? 0.5, confidenceLevel = options.confidenceLevel ?? 0.95, inference = options.inference ?? "stability", range = options.consistencyRange ?? [0.75, 1.25], tail = (1 - confidenceLevel) / 2, threshold = options.edgeThreshold ?? quantile7(flattenColumnMajor(fit.probability).filter((v) => Number.isFinite(v) && v > 0), 0.1);
  const edges = fit.edges.map((e) => {
    const i = e.fromId - 1, j = e.toId - 1, a = fit.observed[i][j] + prior, rowA = fit.observed[i].reduce((s, v) => s + v + prior, 0), b = rowA - a, pm = a / rowA, se = Math.sqrt(a * b / (rowA ** 2 * (rowA + 1))), low = betaQuantile(tail, a, b), high = betaQuantile(1 - tail, a, b), p = inference === "stability" ? betaCDF(Math.min(e.prob * range[0], e.prob * range[1]), a, b) + 1 - betaCDF(Math.max(e.prob * range[0], e.prob * range[1]), a, b) : betaCDF(threshold, a, b), valid = Number.isFinite(e.prob) && fit.params.structuralZeros?.[i]?.[j] !== 0, stable = valid && e.prob > 0 && p < 1 - confidenceLevel;
    return { from: e.from, to: e.to, observed: e.count, probObserved: e.prob, probMean: valid ? pm : NaN, probSE: valid ? se : NaN, probCILow: valid ? low : NaN, probCIHigh: valid ? high : NaN, pValue: valid ? p : NaN, stable, adjResObserved: e.adjRes, adjResStable: stable };
  });
  return { kind: "lsa_certainty", edges, prior, confidenceLevel, inference, fit };
}
function permuteLSA(fit, options = {}) {
  if (fit.data.source !== "events") throw new Error("permuteLSA requires event-level input.");
  const iterations = validateIterations(options.iterations ?? 1e3), within = options.withinSequence ?? true, rng = rngFor(options.seed), seqs = fit.data.sequences, T = fit.data.nEvents;
  let shuffles = options.shuffles;
  if (shuffles) {
    if (shuffles.length < iterations || shuffles.slice(0, iterations).some((p) => p.length !== T || new Set(p).size !== T || p.some((v) => !Number.isInteger(v) || v < 0 || v >= T))) throw new Error(`Every shuffle must be a zero-based permutation of 0..${T - 1}.`);
  }
  const rows = [];
  for (let b = 0; b < iterations; b++) {
    let sampled;
    if (shuffles) {
      const events = shuffles[b].map((i) => fit.data.events[i]);
      sampled = [];
      let q = 0;
      for (const s of seqs) sampled.push(events.slice(q, q += s.length));
    } else sampled = within ? seqs.map((s) => rng.shuffle(s.slice())) : [rng.shuffle(fit.data.events.slice())];
    rows.push(flattenColumnMajor(refit(fit, sampled).adjustedResiduals));
  }
  const observed = flattenColumnMajor(fit.adjustedResiduals), edges = fit.edges.map((e, i) => {
    const nulls = rows.map((r) => r[i]).filter(Number.isFinite), p = Number.isFinite(observed[i]) && nulls.length ? (1 + nulls.filter((v) => Math.abs(v) >= Math.abs(observed[i])).length) / (1 + nulls.length) : NaN;
    return { from: e.from, to: e.to, observedCount: e.count, observedAdjRes: e.adjRes, pPermutation: p, significant: Number.isFinite(p) && p < fit.params.alpha };
  });
  return { kind: "lsa_permutation", edges, permutationAdjustedResiduals: rows, iterations, withinSequence: within, fit };
}
function stabilityLSA(fit, options = {}) {
  if (fit.data.source !== "events") throw new Error("stabilityLSA requires event-level input.");
  const iterations = validateIterations(options.iterations ?? options.subsamples?.length ?? 500), proportion = options.proportion ?? 0.8, minStable = options.minStable ?? 0.95, rng = rngFor(options.seed), seqs = fit.data.sequences, rows = [];
  if (options.subsamples && (options.subsamples.length < iterations || options.subsamples.some((s) => !s.length || s.some((i) => !Number.isInteger(i) || i < 0 || i >= seqs.length)))) throw new Error("subsamples must contain valid zero-based sequence indices.");
  for (let b = 0; b < iterations; b++) {
    let sampled;
    if (options.subsamples) sampled = options.subsamples[b].map((i) => seqs[i]);
    else if (seqs.length >= 2) sampled = rng.choiceWithoutReplacement(seqs.length, Math.max(1, Math.round(seqs.length * proportion))).map((i) => seqs[i]);
    else {
      const m = Math.max(2, Math.round(seqs[0].length * proportion)), start = rng.randInt(seqs[0].length - m + 1);
      sampled = [seqs[0].slice(start, start + m)];
    }
    try {
      rows.push(flattenColumnMajor(refit(fit, sampled).pValues).map((p) => Number.isFinite(p) && p < fit.params.alpha));
    } catch {
      rows.push(Array(fit.edges.length).fill(false));
    }
  }
  const edges = fit.edges.map((e, i) => {
    const stability = rows.filter((r) => r[i]).length / iterations;
    return { from: e.from, to: e.to, observedSignificant: e.significant, stability, stable: stability >= minStable };
  });
  return { kind: "lsa_stability", edges, stabilityMatrix: rows, iterations, proportion, minStable, fit };
}
function reliabilityLSA(fit, options = {}) {
  if (fit.kind === "lsa_group") return Object.fromEntries(fit.levels.map((g) => [g, reliabilityLSA(fit.groups[g], options)]));
  if (fit.data.source !== "events" || fit.data.nSequences < 2) throw new Error("reliabilityLSA requires at least two event sequences.");
  const iterations = validateIterations(options.iterations ?? options.splits?.length ?? 100), weights = options.weights ?? "prob", method = options.method ?? "pearson", rng = rngFor(options.seed), seqs = fit.data.sequences, cors = [];
  if (options.splits && (options.splits.length < iterations || options.splits.some((s) => !s.length || s.length >= seqs.length || new Set(s).size !== s.length || s.some((i) => !Number.isInteger(i) || i < 0 || i >= seqs.length)))) throw new Error("splits must contain unique valid zero-based indices for a non-empty first half.");
  const pull = (f) => flattenColumnMajor(weights === "prob" ? f.probability : weights === "count" ? f.observed : f.adjustedResiduals);
  for (let b = 0; b < iterations; b++) {
    const a = options.splits?.[b]?.slice() ?? rng.choiceWithoutReplacement(seqs.length, Math.max(1, Math.floor(seqs.length / 2))), set = new Set(a), bb = seqs.map((_, i) => i).filter((i) => !set.has(i));
    try {
      const x = pull(refit(fit, a.map((i) => seqs[i]))), y = pull(refit(fit, bb.map((i) => seqs[i])));
      cors.push(method === "pearson" ? pearson(x, y) : spearman(x, y));
    } catch {
      cors.push(NaN);
    }
  }
  const finite = cors.filter(Number.isFinite);
  return { kind: "lsa_reliability", correlations: cors, mean: mean(finite), sd: sampleSD(finite), ciLow: quantile7(finite, 0.025), ciHigh: quantile7(finite, 0.975), iterations, weights, method, nSequences: seqs.length, fit };
}

// src/lagdynamics/compare.ts
function resolve(x, y) {
  if (x.kind === "lsa_group") {
    if (y) throw new Error("Do not supply y with an LSA group.");
    if (x.levels.length < 2) throw new Error("At least two groups are required.");
    return { fits: x.levels.map((g) => x.groups[g]), names: x.levels };
  }
  if (!y) throw new Error("Supply either an LSA group or two LSA fits.");
  return { fits: [x, y], names: ["a", "b"] };
}
function validate(fits) {
  const a = fits[0];
  for (const f of fits) {
    if (f.data.source !== "events") throw new Error("Comparison requires event-level fits.");
    if (f.method !== a.method || f.params.lag !== a.params.lag || f.data.labels.join("\0") !== a.data.labels.join("\0")) throw new Error("Compared fits must share engine, lag, and labels.");
  }
}
function refit2(base, seqs) {
  return lsa(seqs.map((s) => s.map((v) => v + 1)), { ...base.params, labels: base.data.labels, group: null });
}
function logOR(f) {
  const o = f.observed, k = o.length, rt = o.map((r) => r.reduce((s, v) => s + v, 0)), ct = Array.from({ length: k }, (_, j) => o.reduce((s, r) => s + r[j], 0)), n = rt.reduce((s, v) => s + v, 0), out = matrix(k, k, NaN);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    if (!Number.isFinite(f.adjustedResiduals[i][j])) continue;
    let a = o[i][j], b = rt[i] - a, c = ct[j] - a, d = n - rt[i] - ct[j] + a;
    if (a === 0 || b === 0 || c === 0 || d === 0) {
      a += 0.5;
      b += 0.5;
      c += 0.5;
      d += 0.5;
    }
    out[i][j] = Math.log(a * d / (b * c));
  }
  return out;
}
function measure(f, m) {
  if (m === "prob") return f.probability;
  if (m === "adj_res") return f.adjustedResiduals;
  if (m === "yules_q") return f.yulesQ;
  if (m === "count") return f.observed;
  if (m === "log_or") return logOR(f);
  return f.observed.map((r, i) => r.map((v, j) => f.expected[i][j] > 0 ? v / f.expected[i][j] : NaN));
}
function adjustP(values, method) {
  const out = values.slice(), idx = values.map((p, i) => ({ p, i })).filter((x) => Number.isFinite(x.p));
  const n = idx.length;
  if (method === "none") return out;
  if (method === "bonferroni") {
    for (const x of idx) out[x.i] = Math.min(1, x.p * n);
    return out;
  }
  idx.sort((a, b) => a.p - b.p);
  if (method === "holm") {
    let mx = 0;
    idx.forEach((x, k) => {
      mx = Math.max(mx, x.p * (n - k));
      out[x.i] = Math.min(1, mx);
    });
    return out;
  }
  const c = method === "BY" ? Array.from({ length: n }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b, 0) : 1;
  let mn = 1;
  for (let k = n - 1; k >= 0; k--) {
    const x = idx[k];
    mn = Math.min(mn, x.p * n * c / (k + 1));
    out[x.i] = Math.min(1, mn);
  }
  return out;
}
function compareLSA(x, y, options = {}) {
  const r = resolve(x, y);
  validate(r.fits);
  if (r.fits.length === 2) return compareTwo(r.fits[0], r.fits[1], [r.names[0], r.names[1]], options);
  const comparisons = {}, edges = [];
  for (let i = 0; i < r.fits.length; i++) for (let j = i + 1; j < r.fits.length; j++) {
    const c = compareTwo(r.fits[i], r.fits[j], [r.names[i], r.names[j]], { ...options, adjust: "none" }), key = `${r.names[i]}_vs_${r.names[j]}`;
    comparisons[key] = c;
    edges.push(...c.edges.map((e) => ({ ...e, groupA: r.names[i], groupB: r.names[j] })));
  }
  const adj = adjustP(edges.map((e) => e.p), options.adjust ?? "none");
  edges.forEach((e, i) => {
    e.pAdjusted = adj[i];
    e.significant = Number.isFinite(adj[i]) && adj[i] < r.fits[0].params.alpha;
  });
  return { kind: "lsa_comparison_pairwise", comparisons, edges };
}
function compareTwo(a, b, names, options) {
  const iterations = options.iterations ?? 1e3, m = options.measure ?? "log_or", minCount = options.minCount ?? 5, rng = new chunkRT5XI5AH_cjs.SeededRNG(options.seed ?? Date.now() & 4294967295), sa = a.data.sequences, sb = b.data.sequences, pooled = [...sa, ...sb], nA = sa.length, ma = flattenColumnMajor(measure(a, m)), mb = flattenColumnMajor(measure(b, m)), observed = ma.map((v, i) => v - mb[i]), nulls = Array.from({ length: iterations }, () => {
    const p2 = rng.permutation(pooled.length), fa = refit2(a, p2.slice(0, nA).map((i) => pooled[i])), fb = refit2(a, p2.slice(nA).map((i) => pooled[i])), aa = flattenColumnMajor(measure(fa, m)), bb = flattenColumnMajor(measure(fb, m));
    return aa.map((v, i) => v - bb[i]);
  });
  const counts = flattenColumnMajor(a.observed).map((v, i) => v + flattenColumnMajor(b.observed)[i]), p = observed.map((v, i) => {
    if (!Number.isFinite(v) || counts[i] < minCount) return NaN;
    const z = nulls.map((r) => r[i]).filter(Number.isFinite);
    return z.length ? (1 + z.filter((x) => Math.abs(x) >= Math.abs(v)).length) / (1 + z.length) : NaN;
  }), padj = adjustP(p, options.adjust ?? "none"), edges = a.edges.map((e, i) => ({ from: e.from, to: e.to, valueA: ma[i], valueB: mb[i], diff: observed[i], p: p[i], pAdjusted: padj[i], significant: Number.isFinite(padj[i]) && padj[i] < a.params.alpha }));
  return { kind: "lsa_comparison", edges, fits: [a, b], groups: names, iterations, measure: m };
}
function normal(rng) {
  const u = Math.max(Number.MIN_VALUE, rng.random()), v = rng.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function gamma(shape, rng) {
  if (shape < 1) return gamma(shape + 1, rng) * rng.random() ** (1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x = normal(rng), v = 1 + c * x;
    if (v <= 0) continue;
    v = v ** 3;
    const u = rng.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
var beta = (a, b, rng) => {
  const x = gamma(a, rng), y = gamma(b, rng);
  return x / (x + y);
};
function bayesCompareLSA(x, y, options = {}) {
  const r = resolve(x, y);
  validate(r.fits);
  if (r.fits.length === 2) return bayesTwo(r.fits[0], r.fits[1], [r.names[0], r.names[1]], options);
  const comparisons = {}, edges = [];
  for (let i = 0; i < r.fits.length; i++) for (let j = i + 1; j < r.fits.length; j++) {
    const c = bayesTwo(r.fits[i], r.fits[j], [r.names[i], r.names[j]], options);
    comparisons[`${r.names[i]}_vs_${r.names[j]}`] = c;
    edges.push(...c.edges.map((e) => ({ ...e, groupA: r.names[i], groupB: r.names[j] })));
  }
  const adj = adjustP(edges.map((e) => e.p), options.adjust ?? "none");
  edges.forEach((e, i) => e.pAdjusted = adj[i]);
  return { kind: "lsa_bayes_pairwise", comparisons, edges, draws: options.draws ?? 1e4, prior: options.prior ?? 0.5 };
}
function bayesTwo(a, b, names, options) {
  const prior = options.prior ?? 0.5, draws = options.draws ?? 1e4, ci = options.confidenceLevel ?? 0.95, meanThreshold = options.meanThreshold ?? 0.01, boundThreshold = options.boundThreshold ?? 1e-3, rng = new chunkRT5XI5AH_cjs.SeededRNG(options.seed ?? Date.now() & 4294967295), tail = (1 - ci) / 2, rawP = [], temp = [];
  a.edges.forEach((e, idx) => {
    const i = e.fromId - 1, j = e.toId - 1, aa = a.observed[i][j] + prior, ab = b.observed[i][j] + prior, ta = a.observed[i].reduce((s, v) => s + v + prior, 0), tb = b.observed[i].reduce((s, v) => s + v + prior, 0), pa = aa / ta, pb = ab / tb, dd = Array.from({ length: draws }, () => beta(aa, ta - aa, rng) - beta(ab, tb - ab, rng)), diff = pa - pb, low = quantile7(dd, tail), high = quantile7(dd, 1 - tail), pos = dd.filter((v) => v > 0).length / draws, pd = Math.max(pos, 1 - pos), p = 2 * (1 - pd), sd = Math.sqrt(Math.max(0, mean(dd.map((v) => v * v)) - mean(dd) ** 2)), valid = Number.isFinite(e.prob) && Number.isFinite(b.edges[idx].prob) && a.params.structuralZeros?.[i]?.[j] !== 0, sig = valid && (low > 0 || high < 0) && Math.abs(diff) > meanThreshold && Math.min(Math.abs(low), Math.abs(high)) > boundThreshold;
    rawP.push(valid ? p : NaN);
    temp.push({ from: e.from, to: e.to, valueA: pa, valueB: pb, diff, p: valid ? p : NaN, pAdjusted: NaN, significant: sig, ciLow: low, ciHigh: high, pd, effectSize: Number.isFinite(diff / sd) ? diff / sd : 0 });
  });
  const adj = adjustP(rawP, options.adjust ?? "none");
  temp.forEach((e, i) => e.pAdjusted = adj[i]);
  return { kind: "lsa_bayes", edges: temp, fits: [a, b], groups: names, draws, prior };
}

// src/lagdynamics/transferEntropy.ts
var sequences = (x) => Array.isArray(x[0]) ? x : [x];
var entropy = (...cols) => {
  const n = cols[0]?.length ?? 0;
  if (!n) return NaN;
  const counts = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const key = cols.map((c) => c[i]).join("\0");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let h = 0;
  for (const c of counts.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
};
function triples(source, target, lag, history) {
  const out = [];
  for (let t = history - 1; t + lag < target.length; t++) {
    const f = target[t + lag], s = source[t], hist = Array.from({ length: history }, (_, d) => target[t - d]);
    if (f == null || f === "" || s == null || s === "" || hist.some((v) => v == null || v === "")) continue;
    out.push({ future: String(f), history: hist.map(String).join("|"), source: String(s) });
  }
  return out;
}
function value(rows) {
  const f = rows.map((r) => r.future), h = rows.map((r) => r.history), s = rows.map((r) => r.source), leftover = entropy(f, h) - entropy(h), conditional = entropy(f, s, h) - entropy(s, h);
  return { te: leftover - conditional, leftover };
}
function one(source, target, options, rng) {
  const rows = source.flatMap((s, i) => triples(s, target[i], options.lag, options.history));
  if (!rows.length) return { te: NaN, teEffective: NaN, teNormalized: NaN, p: NaN, n: 0 };
  const v = value(rows);
  if (options.test === "none") return { te: v.te, teNormalized: v.leftover > 0 ? v.te / v.leftover : NaN, n: rows.length };
  const sur = Array.from({ length: options.iterations }, () => {
    const src = rng.shuffle(rows.map((r) => r.source).slice());
    return value(rows.map((r, i) => ({ ...r, source: src[i] }))).te;
  });
  return { te: v.te, teEffective: v.te - sur.reduce((a, b) => a + b, 0) / sur.length, teNormalized: v.leftover > 0 ? v.te / v.leftover : NaN, p: (1 + sur.filter((x) => x >= v.te).length) / (1 + sur.length), n: rows.length };
}
function transferEntropy(x, y, options = {}) {
  const lag = options.lag ?? 1, history = options.history ?? 1, iterations = options.iterations ?? 199, test = options.test ?? "surrogate";
  if (!Number.isInteger(lag) || lag < 1 || !Number.isInteger(history) || history < 1 || !Number.isInteger(iterations) || iterations < 1) throw new Error("lag, history, and iterations must be positive whole numbers.");
  const rng = new chunkRT5XI5AH_cjs.SeededRNG(options.seed ?? Date.now() & 4294967295), xs = sequences(x), opts = { lag, history, iterations, test }, out = [];
  if (y) {
    const ys = sequences(y);
    if (xs.length !== ys.length || xs.some((s, i) => s.length !== ys[i].length)) throw new Error("x and y must contain aligned sequences of equal lengths.");
    out.push({ from: options.xLabel ?? "x", to: options.yLabel ?? "y", ...one(xs, ys, opts, rng) }, { from: options.yLabel ?? "y", to: options.xLabel ?? "x", ...one(ys, xs, opts, rng) });
  } else {
    const states = [...new Set(xs.flat().filter((v) => v != null && v !== "").map(String))].sort();
    const indicator = (s) => xs.map((seq) => seq.map((v) => v == null || v === "" ? null : String(v) === s ? "1" : "0"));
    for (const from of states) for (const to of states) if (from !== to) out.push({ from, to, ...one(indicator(from), indicator(to), opts, rng) });
  }
  if (options.normalize === false) for (const r of out) delete r.teNormalized;
  if (test === "none") for (const r of out) {
    delete r.teEffective;
    delete r.p;
  }
  return out.sort((a, b) => b.te - a.te);
}

// src/lagdynamics/visualize.ts
var DIV_LOW = "#2166AC";
var DIV_MID = "#F7F7F7";
var DIV_HIGH = "#B2182B";
var SEQ_LOW = "#DEEBF7";
var SEQ_HIGH = "#08519C";
var CMP_LOW = "#D33F6A";
var CMP_MID = "#F7F7F7";
var CMP_HIGH = "#4A6FE3";
var GREY_85 = "#D9D9D9";
var TNA_COLORS = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f"
];
var CHORD_COLORS = [
  "#E53935",
  "#8E24AA",
  "#1E88E5",
  "#00897B",
  "#43A047",
  "#FFB300",
  "#F4511E",
  "#00ACC1",
  "#6D4C41",
  "#D81B60",
  "#3949AB",
  "#7CB342"
];
var esc = (value2) => String(value2).replace(
  /[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
);
var clamp = (value2, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value2));
var fmt = (value2, digits = 2) => Number.isFinite(value2) ? value2.toFixed(digits) : "";
var sum2 = (values) => values.reduce((total, value2) => total + value2, 0);
function parseHex(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
}
function mix(a, b, t) {
  const x = parseHex(a), y = parseHex(b), u = clamp(t);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * u).toString(16).padStart(2, "0")).join("")}`;
}
function divergingColor(value2, limit, low = DIV_LOW, mid = DIV_MID, high = DIV_HIGH) {
  if (!Number.isFinite(value2)) return GREY_85;
  const z = clamp(value2 / (limit || 1), -1, 1);
  return z < 0 ? mix(mid, low, -z) : mix(mid, high, z);
}
function sequentialColor(value2, min, max) {
  if (!Number.isFinite(value2)) return GREY_85;
  return mix(SEQ_LOW, SEQ_HIGH, (value2 - min) / (max - min || 1));
}
var svgCounter = 0;
function frame(body, options, title, subtitle = "", centered = false) {
  const width = options.width ?? 760;
  const height = options.height ?? 560;
  const x = centered ? width / 2 : 28;
  const anchor = centered ? "middle" : "start";
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(options.title ?? title)}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="${options.background ?? "#ffffff"}"/>
<style>
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;fill:#333}
.title{font-size:18px;font-weight:700}.subtitle{font-size:10px;fill:#666}.axis{font-size:11px;fill:#333}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.small{font-size:9px}.tiny{font-size:8px}.halo{paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}
</style>
<text class="title" x="${x}" y="28" text-anchor="${anchor}">${esc(options.title ?? title)}</text>
${options.subtitle ?? subtitle ? `<text class="subtitle" x="${x}" y="46" text-anchor="${anchor}">${esc(options.subtitle ?? subtitle)}</text>` : ""}
${body}</svg>`;
}
function colorLegend(id, x, y, height, label, min, max, diverging, low = DIV_LOW, high = DIV_HIGH) {
  const mid = diverging ? DIV_MID : mix(low, high, 0.5);
  return `<defs><linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${low}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${high}"/></linearGradient></defs>
<rect x="${x}" y="${y}" width="12" height="${height}" rx="1" fill="url(#${id})"/>
<text class="tiny" x="${x + 18}" y="${y + 4}">${fmt(max, 1)}</text><text class="tiny" x="${x + 18}" y="${y + height}">${fmt(min, 1)}</text>
<text class="small" x="${x - 2}" y="${y - 8}">${esc(label)}</text>`;
}
function arcPath(cx, cy, inner, outer2, start, end) {
  const p = (radius, angle) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  const a = p(outer2, start), b = p(outer2, end), c = p(inner, end), d = p(inner, start);
  const large = Math.abs(end - start) > Math.PI ? 1 : 0;
  const sweep = end >= start ? 1 : 0;
  return `M${a[0]} ${a[1]} A${outer2} ${outer2} 0 ${large} ${sweep} ${b[0]} ${b[1]} L${c[0]} ${c[1]} A${inner} ${inner} 0 ${large} ${sweep ? 0 : 1} ${d[0]} ${d[1]} Z`;
}
function tangential(angle) {
  const degrees = (angle * 180 / Math.PI % 360 + 360) % 360;
  const rotation = degrees + 90;
  return degrees > 90 && degrees < 270 ? rotation + 180 : rotation;
}
function plotLSAHeatmap(fit, options = {}) {
  const which = options.which ?? "residuals";
  const matrix2 = which === "residuals" ? fit.adjustedResiduals : which === "prob" ? fit.probability : which === "count" ? fit.observed : fit.expected;
  const width = options.width ?? 760, height = options.height ?? 560;
  const left = 138, top = 72, right = 112, bottom = 92;
  const n = fit.data.nStates;
  const cell = Math.min((width - left - right) / n, (height - top - bottom) / n);
  const plotWidth = cell * n, plotHeight = cell * n;
  const outgoing = fit.observed.map((row) => sum2(row));
  const rowOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => outgoing[b] - outgoing[a]);
  const finite = matrix2.flat().filter(Number.isFinite);
  const limit = Math.max(1e-12, ...finite.map((v) => which === "residuals" ? Math.abs(v) : v));
  const min = which === "prob" ? 0 : Math.min(0, ...finite);
  const title = { residuals: "Adjusted residuals", prob: "Transition probabilities", count: "Observed counts", expected: "Expected counts" }[which];
  const caption = which === "residuals" ? "warm over-represented, cool avoided; significant cells bold" : which === "prob" ? "P(to | from); modal next state bold" : "modal next state bold";
  const subtitle = `${fit.method} engine, lag ${fit.params.lag} \xB7 ${sum2(fit.observed.flat())} transitions \xB7 ${caption}`;
  const id = `ld-heat-${++svgCounter}`;
  let body = "";
  for (let row = 0; row < n; row++) {
    const i = rowOrder[row];
    const rank = matrix2[i].map((v, j) => fit.observed[i][j] === 0 || !Number.isFinite(v) ? -Infinity : which === "residuals" ? Math.abs(v) : v);
    const salient = rank.indexOf(Math.max(...rank));
    body += `<text class="axis mono" text-anchor="end" x="${left - 9}" y="${top + (row + 0.62) * cell}">${esc(fit.data.labels[i])}</text>`;
    for (let j = 0; j < n; j++) {
      const raw = matrix2[i][j];
      const present = fit.observed[i][j] > 0 && Number.isFinite(raw);
      const value2 = present ? raw : NaN;
      const fill = which === "residuals" ? divergingColor(value2, limit) : sequentialColor(value2, min, which === "prob" ? 1 : limit);
      const bold = present && j === salient && (which !== "residuals" || fit.edges.find((e) => e.fromId === i + 1 && e.toId === j + 1)?.significant);
      const x = left + j * cell, y = top + row * cell;
      body += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${fill}" stroke="#fff" stroke-width="1"/>`;
      if (present) {
        body += `<text class="small" text-anchor="middle" x="${x + cell / 2}" y="${y + cell / 2 + 3}" fill="${bold ? "#fff" : "#333"}" font-weight="${bold ? "700" : "400"}">${fmt(raw, which === "count" ? 0 : 2)}</text>`;
      }
    }
  }
  for (let j = 0; j < n; j++) {
    const x = left + (j + 0.55) * cell, y = top + plotHeight + 12;
    body += `<text class="axis" text-anchor="end" transform="translate(${x},${y}) rotate(-45)">${esc(fit.data.labels[j])}</text>`;
  }
  body += `<text class="axis" text-anchor="middle" x="${left + plotWidth / 2}" y="${height - 20}">Next state</text>`;
  body += colorLegend(id, left + plotWidth + 30, top + 18, Math.max(90, plotHeight - 36), which === "residuals" ? "z" : which === "prob" ? "P(to | from)" : which, which === "residuals" ? -limit : min, which === "prob" ? 1 : limit, which === "residuals");
  return frame(body, options, title, subtitle);
}
function networkPath(source, target, nodeRadius, curvature) {
  const dx = target.x - source.x, dy = target.y - source.y, length = Math.hypot(dx, dy) || 1;
  const ux = dx / length, uy = dy / length, px = -uy, py = ux;
  const mx = (source.x + target.x) / 2 + px * curvature;
  const my = (source.y + target.y) / 2 + py * curvature;
  const sdx = mx - source.x, sdy = my - source.y, sl = Math.hypot(sdx, sdy) || 1;
  const edx = target.x - mx, edy = target.y - my, el = Math.hypot(edx, edy) || 1;
  const sx = source.x + sdx / sl * nodeRadius, sy = source.y + sdy / sl * nodeRadius;
  const tx = target.x - edx / el * (nodeRadius + 8), ty = target.y - edy / el * (nodeRadius + 8);
  const t = 0.52;
  const lx = (1 - t) ** 2 * sx + 2 * (1 - t) * t * mx + t ** 2 * tx;
  const ly = (1 - t) ** 2 * sy + 2 * (1 - t) * t * my + t ** 2 * ty;
  return { path: `M${sx} ${sy} Q${mx} ${my} ${tx} ${ty}`, lx, ly };
}
function cographSelfLoop(x, y, nodeRadius, rotation) {
  const loopRadius = nodeRadius * 0.8;
  const loopDistance = nodeRadius;
  const anchorRadius = nodeRadius;
  const loopX = x + loopDistance * Math.cos(rotation);
  const loopY = y + loopDistance * Math.sin(rotation);
  const cosine = clamp(
    (loopDistance ** 2 + loopRadius ** 2 - anchorRadius ** 2) / (2 * loopDistance * loopRadius),
    -1,
    1
  );
  const alpha = Math.acos(cosine);
  const start = rotation + Math.PI + alpha;
  const end = rotation + Math.PI - alpha + 2 * Math.PI;
  const startX = loopX + loopRadius * Math.cos(start);
  const startY = loopY + loopRadius * Math.sin(start);
  const endX = loopX + loopRadius * Math.cos(end);
  const endY = loopY + loopRadius * Math.sin(end);
  return {
    path: `M${startX} ${startY} A${loopRadius} ${loopRadius} 0 1 1 ${endX} ${endY}`,
    labelX: x + nodeRadius * 2.5 * Math.cos(rotation),
    labelY: y + nodeRadius * 2.5 * Math.sin(rotation)
  };
}
function plotTransitions(fit, options = {}) {
  const key = options.weights ?? "residuals";
  const metric = key === "residuals" ? "adj_res" : key === "tna" || key === "relative" ? "prob" : key;
  const matrix2 = cleanWeight(fit, metric);
  const tnaStyled = metric === "prob" || metric === "count";
  const signed = metric === "adj_res" || metric === "yules_q";
  const cutoff = options.edgeCutoff ?? (metric === "prob" ? 0.05 : 0);
  const edges = [];
  for (let i = 0; i < matrix2.length; i++) for (let j = 0; j < matrix2.length; j++) {
    const value2 = matrix2[i][j];
    if (!Number.isFinite(value2) || Math.abs(value2) <= cutoff) continue;
    if (options.significant && !(fit.pValues[i][j] < fit.params.alpha)) continue;
    edges.push({ i, j, value: value2 });
  }
  if (options.top !== void 0) {
    const keep = options.top < 1 ? Math.ceil(edges.length * options.top) : Math.min(edges.length, Math.floor(options.top));
    edges.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).splice(keep);
  }
  const width = options.width ?? 760, height = options.height ?? 560;
  const cx = width / 2, cy = height / 2 + 12, radius = Math.min(width, height) * 0.31, nodeRadius = 23;
  const visibleNodeRadius = tnaStyled ? nodeRadius + 6.5 : nodeRadius;
  const positions = fit.data.labels.map((_, i) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * i / fit.data.nStates;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  const pairSet = new Set(edges.map((e) => `${e.i}-${e.j}`));
  const max = Math.max(1e-12, ...edges.map((e) => Math.abs(e.value)));
  const edgeWidthMin = Math.max(0.1, options.edgeWidthMin ?? 0.55);
  const edgeWidthMax = Math.max(edgeWidthMin, options.edgeWidthMax ?? 2.8);
  const arrowScale = Math.max(0.25, options.arrowScale ?? 1);
  const marker = `ld-arrow-${++svgCounter}`;
  let body = "<defs>";
  for (let level = 0; level < 4; level++) {
    const markerSize = (3.8 + level * 0.75) * arrowScale;
    body += `<marker id="${marker}-${level}" viewBox="0 0 7 6" refX="6.3" refY="3" markerWidth="${markerSize}" markerHeight="${markerSize * 0.86}" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L7 3 L0 6 Z" fill="context-stroke"/></marker>`;
  }
  body += "</defs>";
  for (const edge of edges.slice().sort((a, b) => Math.abs(a.value) - Math.abs(b.value))) {
    const source = positions[edge.i], target = positions[edge.j];
    const positiveColor = tnaStyled ? "#2B4C7E" : signed ? CMP_HIGH : "#4A6FA5";
    const color = edge.value < 0 && signed ? CMP_LOW : positiveColor;
    const strength = Math.sqrt(clamp(Math.abs(edge.value) / max));
    const strokeWidth = edgeWidthMin + (edgeWidthMax - edgeWidthMin) * strength;
    const markerLevel = Math.min(3, Math.floor(strength * 4));
    const markerUrl = `url(#${marker}-${markerLevel})`;
    const dash = edge.value < 0 && signed ? ' stroke-dasharray="7 5"' : "";
    const halo = edge.value < 0 && signed ? Math.abs(edge.value) / max : 0;
    if (edge.i === edge.j) {
      const rotation = Math.atan2(source.y - cy, source.x - cx);
      const loop = cographSelfLoop(source.x, source.y, visibleNodeRadius, rotation);
      if (halo) body += `<path d="${loop.path}" fill="none" stroke="${CMP_LOW}" stroke-width="${strokeWidth + 2.6 * strength}" stroke-opacity=".13"/>`;
      body += `<path d="${loop.path}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity=".82" stroke-linecap="round"${dash} marker-end="${markerUrl}"/>`;
      if (options.edgeLabels !== false) body += `<text class="small halo" text-anchor="middle" x="${loop.labelX}" y="${loop.labelY + 3}">${fmt(edge.value, options.decimals ?? 1)}</text>`;
      continue;
    }
    const reverse = pairSet.has(`${edge.j}-${edge.i}`);
    const geometry = networkPath(source, target, visibleNodeRadius, reverse ? 23 : 0);
    if (halo) body += `<path d="${geometry.path}" fill="none" stroke="${CMP_LOW}" stroke-width="${strokeWidth + 2.6 * strength}" stroke-opacity=".13"/>`;
    body += `<path d="${geometry.path}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity=".78" stroke-linecap="round"${dash} marker-end="${markerUrl}"><title>${esc(fit.data.labels[edge.i])} \u2192 ${esc(fit.data.labels[edge.j])}: ${fmt(edge.value, options.decimals ?? 2)}</title></path>`;
    if (options.edgeLabels !== false) body += `<text class="small halo" text-anchor="middle" x="${geometry.lx}" y="${geometry.ly - 3}">${fmt(edge.value, options.decimals ?? 1)}</text>`;
  }
  const palette = options.colors ?? TNA_COLORS;
  positions.forEach((position, i) => {
    const fill = options.nodeFill ?? (tnaStyled ? palette[i % palette.length] : "#fff");
    if (tnaStyled) {
      const init = clamp(fit.initialProbabilities?.[i] ?? 0);
      const circumference = 2 * Math.PI * (nodeRadius + 4);
      body += `<circle cx="${position.x}" cy="${position.y}" r="${nodeRadius + 4}" fill="none" stroke="#e5e7eb" stroke-width="5"/>`;
      body += `<circle cx="${position.x}" cy="${position.y}" r="${nodeRadius + 4}" fill="none" stroke="${palette[i % palette.length]}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${circumference * init} ${circumference}" transform="rotate(-90 ${position.x} ${position.y})"/>`;
    }
    body += `<circle cx="${position.x}" cy="${position.y}" r="${nodeRadius}" fill="${fill}" stroke="${tnaStyled ? "#999" : "steelblue"}" stroke-width="${tnaStyled ? 1.5 : 1.1}"/>`;
    body += `<text class="axis halo" font-weight="600" text-anchor="middle" x="${position.x}" y="${position.y + 4}">${esc(fit.data.labels[i])}</text>`;
  });
  const legend = tnaStyled ? `${metric === "prob" ? "TNA probability network \xB7 edges below 0.05 omitted" : "frequency transition network"} \xB7 node ring = initial-state probability` : signed ? "blue solid = over-represented \xB7 red dashed + halo = avoided" : "edge width = lift";
  body += `<text class="subtitle" text-anchor="middle" x="${cx}" y="${height - 18}">${esc(legend)}</text>`;
  return frame(body, options, tnaStyled ? "Transition network" : signed ? "Residual network" : "Lift network");
}
function chordRibbon(cx, cy, radius, ribbon) {
  const p = (angle) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  const a = p(ribbon.fs), b = p(ribbon.fe), c = p(ribbon.ts), d = p(ribbon.te);
  return `M${a[0]} ${a[1]} A${radius} ${radius} 0 0 1 ${b[0]} ${b[1]} Q${cx} ${cy} ${c[0]} ${c[1]} A${radius} ${radius} 0 0 1 ${d[0]} ${d[1]} Q${cx} ${cy} ${a[0]} ${a[1]} Z`;
}
function plotChords(fit, options = {}) {
  const widthMetric = options.widthMetric ?? "count";
  const colorMetric = options.colorMetric ?? "residuals";
  const widths = cleanWeight(fit, widthMetric);
  const colorKey = colorMetric === "residuals" ? "adj_res" : colorMetric;
  const colors = cleanWeight(fit, colorKey);
  const compare = options.compare ? cleanWeight(options.compare, colorKey) : null;
  const n = fit.data.nStates;
  if (options.significant && !compare) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (!(fit.pValues[i][j] < fit.params.alpha)) widths[i][j] = 0;
  }
  if (options.selfLoops === false) for (let i = 0; i < n; i++) widths[i][i] = 0;
  const outgoing = widths.map((row) => sum2(row.map(Math.abs)));
  const incoming = Array.from({ length: n }, (_, j) => sum2(widths.map((row) => Math.abs(row[j]))));
  const flows = outgoing.map((value2, i) => value2 + incoming[i] - Math.abs(widths[i][i]));
  const totalFlow = sum2(flows) || n;
  const pad = 0.02, available = 2 * Math.PI - n * pad;
  let cursor = -Math.PI / 2;
  const segments = flows.map((flow) => {
    const span = available * (flow || totalFlow * 0.01 / n) / totalFlow;
    const segment = { start: cursor, end: cursor + span, mid: cursor + span / 2, flow };
    cursor += span + pad;
    return segment;
  });
  const outCursor = segments.map((s) => s.start);
  const inCursor = segments.map((s) => s.start + (s.end - s.start) / 2);
  const ribbons = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const weight = Math.abs(widths[i][j]);
    if (!(weight > 0)) continue;
    const sourceSpan = (segments[i].end - segments[i].start) / 2 * weight / (outgoing[i] || 1);
    const targetSpan = (segments[j].end - segments[j].start) / 2 * weight / (incoming[j] || 1);
    const fs = outCursor[i], fe = fs + sourceSpan, ts = inCursor[j], te = ts + targetSpan;
    outCursor[i] = fe;
    inCursor[j] = te;
    ribbons.push({ i, j, fs, fe, ts, te, weight, colorValue: colors[i][j] - (compare?.[i]?.[j] ?? 0) });
  }
  const width = options.width ?? 760, height = options.height ?? 560, cx = width / 2, cy = height / 2 + 16;
  const outer2 = Math.min(width, height) * 0.34, inner = outer2 * 0.9;
  const diverging = colorMetric === "residuals" || Boolean(compare);
  const values = ribbons.map((r) => r.colorValue).filter(Number.isFinite);
  const limit = Math.max(1e-12, ...values.map(Math.abs));
  const min = Math.min(...values, 0), max = Math.max(...values, 1e-12);
  let body = "";
  for (const ribbon of ribbons.slice().sort((a, b) => b.weight - a.weight)) {
    const fill = diverging ? divergingColor(ribbon.colorValue, limit) : sequentialColor(ribbon.colorValue, min, max);
    body += `<path d="${chordRibbon(cx, cy, inner, ribbon)}" fill="${fill}" fill-opacity="${options.alpha ?? 0.6}"><title>${esc(fit.data.labels[ribbon.i])} \u2192 ${esc(fit.data.labels[ribbon.j])}: ${fmt(ribbon.weight)}</title></path>`;
  }
  segments.forEach((segment, i) => {
    body += `<path d="${arcPath(cx, cy, inner, outer2, segment.start, segment.end)}" fill="${(options.colors ?? CHORD_COLORS)[i % (options.colors ?? CHORD_COLORS).length]}" stroke="#fff" stroke-width="1"/>`;
    const r = outer2 + 20, x = cx + r * Math.cos(segment.mid), y = cy + r * Math.sin(segment.mid);
    body += `<text class="axis" text-anchor="middle" x="${x}" y="${y + 4}">${esc(fit.data.labels[i])}</text>`;
  });
  const id = `ld-chord-${++svgCounter}`;
  body += colorLegend(id, width - 72, 92, 92, colorMetric === "residuals" ? "z" : compare ? "difference" : colorMetric, diverging ? -limit : min, diverging ? limit : max, diverging);
  const subtitle = `ribbon width = ${widthMetric} \xB7 fill = ${compare ? `${colorMetric} difference` : colorMetric}`;
  return frame(body, options, "Transition chord diagram", subtitle, true);
}
function plotPolar(fit, options = {}) {
  const style = options.style ?? "rose", fillKey = options.fill ?? "residuals", sizeKey = options.size ?? "count";
  const labelMode = options.labels ?? (style === "rose" ? "all" : "auto");
  const fills = cleanWeight(fit, fillKey === "residuals" ? "adj_res" : fillKey);
  const sizes = cleanWeight(fit, sizeKey);
  const n = fit.data.nStates, width = options.width ?? 760, height = options.height ?? 560;
  const cx = width / 2 - 20, cy = height / 2 + 18, radius = Math.min(width, height) * 0.31;
  const srcIn = radius * 0.34, srcOut = radius * 0.5, ring0 = radius * 0.54, ring1 = radius;
  const values = fills.flat().filter(Number.isFinite);
  const diverging = fillKey === "residuals", limit = Math.max(1e-12, ...values.map(Math.abs));
  const min = Math.min(0, ...values), max = Math.max(1e-12, ...values);
  const color = (value2) => diverging ? divergingColor(value2, limit) : sequentialColor(value2, min, max);
  const gap = 0.05;
  let body = `<circle cx="${cx}" cy="${cy}" r="${ring0}" fill="none" stroke="#e0e0e0"/><circle cx="${cx}" cy="${cy}" r="${ring1}" fill="none" stroke="#e0e0e0"/>`;
  const sourceMid = [];
  if (style === "rose") {
    const sector = (2 * Math.PI - gap * n) / n;
    const globalMax = Math.max(1e-12, ...sizes.flat().filter((v) => Number.isFinite(v) && v > 0));
    for (let i = 0; i < n; i++) {
      const start = -Math.PI / 2 + i * (sector + gap), end = start + sector;
      sourceMid.push((start + end) / 2);
      body += `<path d="${arcPath(cx, cy, srcIn, srcOut, start, end)}" fill="#ebebeb" stroke="#fff"/>`;
      const pad = sector * 0.04, slot = (sector - 2 * pad) / n;
      const modal = sizes[i].indexOf(Math.max(...sizes[i]));
      for (let j = 0; j < n; j++) {
        const amount = sizes[i][j];
        if (!(amount > 0) || !Number.isFinite(amount)) continue;
        const angle = start + pad + (j + 0.5) * slot;
        const outer2 = ring0 + Math.sqrt(clamp(amount / globalMax)) * (ring1 - ring0);
        const value2 = options.significant && !(fit.pValues[i][j] < fit.params.alpha) ? NaN : fills[i][j];
        body += `<path d="${arcPath(cx, cy, ring0, outer2, angle - slot * 0.42, angle + slot * 0.42)}" fill="${color(value2)}" stroke="#fff" stroke-width=".5"><title>${esc(fit.data.labels[i])} \u2192 ${esc(fit.data.labels[j])}: ${fmt(amount)}</title></path>`;
        if (labelMode === "all" || labelMode === "auto" && j === modal) body += polarLabel(cx, cy, ring1 + 10, angle, fit.data.labels[j]);
      }
    }
  } else {
    const outgoing = fit.observed.map((row) => sum2(row.map((v) => Number.isFinite(v) && v > 0 ? v : 0)));
    const total = sum2(outgoing) || 1;
    let cursor = -Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const sector = outgoing[i] / total * (2 * Math.PI - gap * n), start = cursor, end = start + sector;
      cursor = end + gap;
      sourceMid.push((start + end) / 2);
      body += `<path d="${arcPath(cx, cy, srcIn, srcOut, start, end)}" fill="#ebebeb" stroke="#fff"/>`;
      const row = fit.observed[i], rowTotal = sum2(row), keep = row.map((v, j) => ({ j, share: rowTotal ? v / rowTotal : 0 })).filter((d) => d.share >= (options.minShow ?? 0.01) && d.share > 0);
      const keepTotal = sum2(keep.map((d) => d.share)) || 1;
      let wedgeCursor = start + sector * 0.02;
      for (const entry of keep) {
        const wedge = entry.share / keepTotal * sector * 0.96, a0 = wedgeCursor, a1 = a0 + wedge;
        wedgeCursor = a1;
        const value2 = options.significant && !(fit.pValues[i][entry.j] < fit.params.alpha) ? NaN : fills[i][entry.j];
        body += `<path d="${arcPath(cx, cy, ring0, ring1, a0, a1)}" fill="${color(value2)}" stroke="#fff" stroke-width=".5"><title>${esc(fit.data.labels[i])} \u2192 ${esc(fit.data.labels[entry.j])}: ${fmt(entry.share)}</title></path>`;
        if (labelMode === "all" || labelMode === "auto" && wedge >= 0.05) body += polarLabel(cx, cy, ring1 + 10, (a0 + a1) / 2, fit.data.labels[entry.j]);
      }
    }
  }
  sourceMid.forEach((angle, i) => {
    const r = (srcIn + srcOut) / 2, x = cx + r * Math.cos(angle), y = cy + r * Math.sin(angle);
    body += `<text class="small" font-weight="700" text-anchor="middle" transform="translate(${x} ${y}) rotate(${tangential(angle)})">${esc(fit.data.labels[i])}</text>`;
  });
  const id = `ld-polar-${++svgCounter}`;
  body += colorLegend(id, width - 70, 100, 92, fillKey === "residuals" ? "z" : fillKey === "prob" ? "P(to | from)" : "lift", diverging ? -limit : min, diverging ? limit : max, diverging);
  const subtitle = style === "rose" ? `${fit.method} engine, lag ${fit.params.lag} \xB7 equal slots \xB7 bar height = ${sizeKey}, fill = ${fillKey === "residuals" ? "z" : fillKey}` : `${fit.method} engine, lag ${fit.params.lag} \xB7 sector = source volume, wedge width = frequency, fill = ${fillKey === "residuals" ? "z" : fillKey}`;
  return frame(body, options, `Transition sunburst - ${fillKey === "residuals" ? "adjusted residuals" : fillKey}`, subtitle, true);
}
function polarLabel(cx, cy, radius, angle, label) {
  const x = cx + radius * Math.cos(angle), y = cy + radius * Math.sin(angle);
  const left = Math.cos(angle) < 0, rotation = angle * 180 / Math.PI + (left ? 180 : 0);
  return `<text class="tiny" fill="#555" text-anchor="${left ? "end" : "start"}" transform="translate(${x} ${y}) rotate(${rotation})">${esc(label)}</text>`;
}
function plotForest(result, options = {}) {
  const metric = options.metric ?? (result.kind === "lsa_certainty" ? "prob" : "residuals");
  let rows = result.edges.map((edge) => {
    if (result.kind === "lsa_certainty") {
      const e2 = edge;
      return { edge: `${e2.from} \u2192 ${e2.to}`, estimate: e2.probObserved, low: e2.probCILow, high: e2.probCIHigh, stable: e2.stable, direction: e2.adjResObserved };
    }
    const e = edge;
    if (metric === "count") return { edge: `${e.from} \u2192 ${e.to}`, estimate: e.observed, low: e.countCILow, high: e.countCIHigh, stable: e.adjResStable, direction: e.adjResObserved };
    if (metric === "prob") return { edge: `${e.from} \u2192 ${e.to}`, estimate: e.probObserved, low: e.probCILow, high: e.probCIHigh, stable: e.adjResStable, direction: e.adjResObserved };
    if (metric === "yules_q") return { edge: `${e.from} \u2192 ${e.to}`, estimate: e.yulesQObserved, low: e.yulesQCILow, high: e.yulesQCIHigh, stable: e.adjResStable, direction: e.adjResObserved };
    return { edge: `${e.from} \u2192 ${e.to}`, estimate: e.adjResObserved, low: e.adjResCILow, high: e.adjResCIHigh, stable: e.adjResStable, direction: e.adjResObserved };
  }).filter((row) => Number.isFinite(row.estimate) && Number.isFinite(row.low) && Number.isFinite(row.high));
  if (options.showNonsignificant === false) rows = rows.filter((row) => row.stable);
  rows.sort((a, b) => a.edge.localeCompare(b.edge));
  if (options.top !== void 0) {
    const selected = rows.slice().sort((a, b) => Math.abs(b.estimate) - Math.abs(a.estimate)).slice(0, options.top);
    const keep = new Set(selected.map((row) => row.edge));
    rows = rows.filter((row) => keep.has(row.edge));
  }
  const width = options.width ?? 760, height = options.height ?? 560, cx = width / 2 - 18, cy = height / 2 + 15;
  const outer2 = Math.min(width, height) * 0.29, inner = outer2 * 0.55;
  const minValue = Math.min(0, ...rows.map((row) => row.low)), maxValue = Math.max(0, ...rows.map((row) => row.high)) * 1.02;
  const toRadius = (value2) => inner + clamp((value2 - minValue) / (maxValue - minValue || 1)) * (outer2 - inner);
  const nullRadius = toRadius(0);
  let body = `<circle cx="${cx}" cy="${cy}" r="${inner}" fill="none" stroke="#d9d9d9"/><circle cx="${cx}" cy="${cy}" r="${outer2}" fill="none" stroke="#d9d9d9"/><circle cx="${cx}" cy="${cy}" r="${nullRadius}" fill="none" stroke="#888" stroke-dasharray="5 4"/>`;
  rows.forEach((row, i) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, rows.length);
    const point = (radius) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    const start = point(inner), end = point(outer2), low = point(toRadius(row.low)), high = point(toRadius(row.high)), estimate = point(toRadius(row.estimate));
    const color = !row.stable ? "#b3b3b3" : row.direction > 0 ? DIV_HIGH : DIV_LOW;
    body += `<line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke="#ebebeb"/>`;
    body += `<line x1="${low[0]}" y1="${low[1]}" x2="${high[0]}" y2="${high[1]}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
    body += `<rect x="${estimate[0] - 3}" y="${estimate[1] - 3}" width="6" height="6" fill="${color}"/>`;
    const label = point(outer2 + 12), left = Math.cos(angle) < 0, rotation = angle * 180 / Math.PI + (left ? 180 : 0);
    body += `<text class="tiny" fill="${color}" text-anchor="${left ? "end" : "start"}" transform="translate(${label[0]} ${label[1]}) rotate(${rotation})">${esc(row.edge)}</text>`;
  });
  body += `<g transform="translate(${width - 145} ${height - 74})"><rect width="10" height="10" fill="${DIV_HIGH}"/><text class="small" x="15" y="9">over-represented</text><rect y="18" width="10" height="10" fill="${DIV_LOW}"/><text class="small" x="15" y="27">avoided</text><rect y="36" width="10" height="10" fill="#b3b3b3"/><text class="small" x="15" y="45">n.s.</text></g>`;
  const resamples = result.kind === "lsa_bootstrap" ? `${result.iterations} resamples` : "analytic posterior";
  const subtitle = `${resamples} \xB7 spoke = ${Math.round(result.confidenceLevel * 100)}% CI, square = estimate, dashed ring = null`;
  const metricTitle = { residuals: "adjusted residuals", count: "counts", prob: "probabilities", yules_q: "Yule's Q" }[metric];
  return frame(body, options, `${result.kind === "lsa_bootstrap" ? "Bootstrap" : "Analytic"} forest - ${metricTitle}`, subtitle, true);
}
function logOdds(fit) {
  const observed = fit.observed, n = observed.length;
  const rowTotals = observed.map(sum2), colTotals = Array.from({ length: n }, (_, j) => sum2(observed.map((row) => row[j]))), total = sum2(rowTotals);
  return observed.map((row, i) => row.map((cell, j) => {
    if (!Number.isFinite(fit.adjustedResiduals[i][j])) return NaN;
    let a = cell, b = rowTotals[i] - a, c = colTotals[j] - a, d = total - rowTotals[i] - colTotals[j] + a;
    if (a === 0 || b === 0 || c === 0 || d === 0) {
      a += 0.5;
      b += 0.5;
      c += 0.5;
      d += 0.5;
    }
    return Math.log(a * d / (b * c));
  }));
}
function comparisonHeatmap(result, options) {
  const width = options.width ?? 760, height = options.height ?? 560, labels = result.fits[0].data.labels, n = labels.length;
  const left = 138, top = 82, right = 112, bottom = 90, cell = Math.min((width - left - right) / n, (height - top - bottom) / n);
  const limit = Math.max(1e-12, ...result.edges.map((edge) => Math.abs(edge.diff)).filter(Number.isFinite));
  const lookup = new Map(result.edges.map((edge) => [`${edge.from}\0${edge.to}`, edge]));
  let body = "";
  for (let i = 0; i < n; i++) {
    body += `<text class="axis mono" text-anchor="end" x="${left - 9}" y="${top + (i + 0.62) * cell}">${esc(labels[i])}</text>`;
    for (let j = 0; j < n; j++) {
      const edge = lookup.get(`${labels[i]}\0${labels[j]}`), value2 = edge?.diff ?? NaN, x = left + j * cell, y = top + i * cell;
      body += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${divergingColor(value2, limit, CMP_LOW, CMP_MID, CMP_HIGH)}" stroke="#fff"/>`;
      if (Number.isFinite(value2)) body += `<text class="small" text-anchor="middle" x="${x + cell / 2}" y="${y + cell / 2 + 3}" font-weight="${edge?.significant ? "700" : "400"}">${fmt(value2, 2)}</text>`;
    }
  }
  for (let j = 0; j < n; j++) body += `<text class="axis" text-anchor="end" transform="translate(${left + (j + 0.55) * cell},${top + n * cell + 12}) rotate(-45)">${esc(labels[j])}</text>`;
  const id = `ld-cmp-${++svgCounter}`;
  body += colorLegend(id, left + n * cell + 30, top + 18, Math.max(90, n * cell - 36), "diff", -limit, limit, true, CMP_LOW, CMP_HIGH);
  body += `<text class="axis" text-anchor="middle" x="${left + n * cell / 2}" y="${height - 20}">Next state</text>`;
  const significant = result.edges.filter((edge) => edge.significant).length;
  const count = result.kind === "lsa_comparison" ? `${result.iterations} permutations` : `${result.draws} posterior draws`;
  const subtitle = `${result.kind === "lsa_comparison" ? result.measure : "probability"} difference \xB7 ${count} \xB7 ${significant} significant edges \xB7 blue = ${result.groups[0]} higher, red = ${result.groups[1]} higher`;
  return frame(body, options, `Group difference: ${result.groups[0]} vs ${result.groups[1]}`, subtitle);
}
function plotComparison(result, options = {}) {
  if (result.kind === "lsa_comparison_pairwise" || result.kind === "lsa_bayes_pairwise") {
    return Object.fromEntries(Object.entries(result.comparisons).map(([key, value3]) => [key, plotComparison(value3, options)]));
  }
  if ((options.style ?? "barrel") === "heatmap") return comparisonHeatmap(result, options);
  const fitA = result.fits[0], fitB = result.fits[1], value2 = options.value ?? "prob", rank = options.rank ?? "frequency";
  const labels = fitA.data.labels, index = new Map(labels.map((label, i) => [label, i]));
  const logA = logOdds(fitA), logB = logOdds(fitB);
  const rows = result.edges.map((edge) => {
    const i = index.get(edge.from), j = index.get(edge.to);
    const frequency = fitA.observed[i][j] + fitB.observed[i][j];
    const effect = Math.max(Math.abs(logA[i][j]), Math.abs(logB[i][j]));
    return { edge, i, j, frequency, effect };
  }).sort((a, b) => rank === "frequency" ? b.frequency - a.frequency : b.effect - a.effect).slice(0, options.top ?? 12);
  const width = options.width ?? 760, height = Math.max(options.height ?? 560, 142 + rows.length * 30);
  const labelX = 170, center = width / 2 + 55, right = width - 75, top = 96, rowGap = 30;
  const lengths = rows.flatMap((row) => value2 === "prob" ? [fitA.probability[row.i][row.j], fitB.probability[row.i][row.j]] : [fitA.observed[row.i][row.j], fitB.observed[row.i][row.j]]);
  const maxLength = Math.max(1e-12, ...lengths), halfWidth = Math.min(center - labelX - 35, right - center), scale = halfWidth / maxLength, gutter = Math.max(7, maxLength * scale * 0.06);
  const maxDiff = Math.max(1e-12, ...rows.map((row) => Math.abs(row.edge.diff)));
  let body = `<line x1="${center}" x2="${center}" y1="${top - 26}" y2="${top + rows.length * rowGap}" stroke="#bdbdbd"/>`;
  body += `<text class="small" text-anchor="end" x="${center - 18}" y="${top - 32}">${esc(result.groups[0])}  \xAB</text><text class="small" x="${center + 18}" y="${top - 32}">\xBB  ${esc(result.groups[1])}</text>`;
  rows.forEach((row, rowIndex) => {
    const y = top + rowIndex * rowGap, lenA = lengths[rowIndex * 2] * scale, lenB = lengths[rowIndex * 2 + 1] * scale;
    const colorA = divergingColor(clamp(logA[row.i][row.j], -3, 3), 3, CMP_LOW, CMP_MID, CMP_HIGH);
    const colorB = divergingColor(clamp(logB[row.i][row.j], -3, 3), 3, CMP_LOW, CMP_MID, CMP_HIGH);
    const darkness = Math.round(255 * (1 - 0.85 * Math.abs(row.edge.diff) / maxDiff)), winner = `rgb(${darkness},${darkness},${darkness})`;
    body += `<line x1="${labelX}" x2="${right}" y1="${y + 9}" y2="${y + 9}" stroke="#ebebeb"/>`;
    body += `<text class="tiny mono" text-anchor="end" x="${labelX - 8}" y="${y + 3}">${esc(row.edge.from)} \u2192 ${esc(row.edge.to)}</text>`;
    body += `<rect x="${center - gutter - lenA}" y="${y - 7}" width="${lenA}" height="14" fill="${colorA}" stroke="${row.edge.diff > 0 ? winner : "#fff"}" stroke-width="${row.edge.diff > 0 ? 1.2 : 0.4}"/>`;
    body += `<rect x="${center + gutter}" y="${y - 7}" width="${lenB}" height="14" fill="${colorB}" stroke="${row.edge.diff < 0 ? winner : "#fff"}" stroke-width="${row.edge.diff < 0 ? 1.2 : 0.4}"/>`;
    body += `<text class="tiny" fill="#666" text-anchor="end" x="${center - gutter - lenA - 4}" y="${y + 3}">${fmt(fitA.observed[row.i][row.j], 0)}</text><text class="tiny" fill="#666" x="${center + gutter + lenB + 4}" y="${y + 3}">${fmt(fitB.observed[row.i][row.j], 0)}</text>`;
    const p = row.edge.pAdjusted, pText = !Number.isFinite(p) ? "\u2013" : p < 1e-3 ? "<.001" : fmt(p, 3);
    body += `<rect x="${center - 19}" y="${y - 8}" width="38" height="16" rx="3" fill="#fff" stroke="#d4d4d4"/><text class="tiny" font-weight="${row.edge.significant ? "700" : "400"}" text-anchor="middle" x="${center}" y="${y + 3}">${pText}${row.edge.significant ? "*" : ""}</text>`;
  });
  const id = `ld-barrel-${++svgCounter}`;
  body += colorLegend(id, width - 56, height - 118, 72, "log OR", -3, 3, true, CMP_LOW, CMP_HIGH);
  body += `<text class="axis" text-anchor="middle" x="${center}" y="${height - 18}">${value2 === "prob" ? "P(to | from)" : "count"}</text>`;
  const significant = rows.filter((row) => row.edge.significant).length;
  const subtitle = `bar length = ${value2 === "prob" ? "P(to | from)" : "count"} \xB7 fill = log odds ratio \xB7 centre = difference p \xB7 ${significant} of ${rows.length} shown significant \xB7 rows by ${rank}`;
  return frame(body, { ...options, height }, `Transition comparison: ${result.groups[0]} vs ${result.groups[1]}`, subtitle, true);
}
function plotLSA(input, type = "heatmap", options = {}) {
  if (input.kind === "lsa_group") {
    return Object.fromEntries(input.levels.map((group) => [group, plotLSA(input.groups[group], type, { ...options, title: options.title ?? group })]));
  }
  if (type === "network") return plotTransitions(input, options);
  if (type === "chord") return plotChords(input, options);
  if (type === "sunburst") return plotPolar(input, options);
  return plotLSAHeatmap(input, options);
}

exports.bayesCompareLSA = bayesCompareLSA;
exports.bootstrapLSA = bootstrapLSA;
exports.certaintyLSA = certaintyLSA;
exports.compareLSA = compareLSA;
exports.getLSAEngine = getLSAEngine;
exports.initial = initial;
exports.lagProfile = lagProfile;
exports.listLSAEngines = listLSAEngines;
exports.lsa = lsa;
exports.lsaBidirectional = lsaBidirectional;
exports.lsaClassical = lsaClassical;
exports.lsaData = lsaData;
exports.lsaDataFromMatrix = lsaDataFromMatrix;
exports.lsaDataFromSequences = lsaDataFromSequences;
exports.lsaIPF = lsaIPF;
exports.lsaLags = lsaLags;
exports.lsaNonparallelDominance = lsaNonparallelDominance;
exports.lsaParallelDominance = lsaParallelDominance;
exports.lsaToTNA = lsaToTNA;
exports.lsaTransitions = lsaTransitions;
exports.lsaTwoCell = lsaTwoCell;
exports.nodes = nodes;
exports.permuteLSA = permuteLSA;
exports.plotChords = plotChords;
exports.plotComparison = plotComparison;
exports.plotForest = plotForest;
exports.plotLSA = plotLSA;
exports.plotLSAHeatmap = plotLSAHeatmap;
exports.plotPolar = plotPolar;
exports.plotTransitions = plotTransitions;
exports.prepareLong = prepareLong;
exports.registerLSAEngine = registerLSAEngine;
exports.reliabilityLSA = reliabilityLSA;
exports.stabilityLSA = stabilityLSA;
exports.tests = tests;
exports.transferEntropy = transferEntropy;
exports.transitionProbabilities = transitionProbabilities;
exports.transitions = transitions;
exports.unregisterLSAEngine = unregisterLSAEngine;
//# sourceMappingURL=chunk-TJLPKQPI.cjs.map
//# sourceMappingURL=chunk-TJLPKQPI.cjs.map