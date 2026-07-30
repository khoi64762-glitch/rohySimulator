import { pAdjust } from './chunk-ZULEKCKD.js';
import { pf, pt2, anova, kruskal } from './chunk-DOMOOFBU.js';

// src/stats/ptukey.ts
function pnorm(x) {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const y = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  const erfc = x >= 0 ? y : 2 - y;
  return 1 - 0.5 * erfc;
}
function lgamma(x) {
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
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
var GL_X = [
  0.04830766568773832,
  0.1444719615827965,
  0.23928736225213706,
  0.33186860228212767,
  0.42135127613063533,
  0.5068999089322294,
  0.5877157572407623,
  0.6630442669302152,
  0.7321821187402897,
  0.7944837959679424,
  0.84936761373257,
  0.8963211557660521,
  0.9349060759377397,
  0.9647622555875064,
  0.9856115115452684,
  0.9972638618494816
];
var GL_W = [
  0.0965400885147278,
  0.09563872007927486,
  0.09384439908080457,
  0.09117387869576389,
  0.08765209300440381,
  0.08331192422694675,
  0.07819389578707031,
  0.0723457941088485,
  0.06582222277636185,
  0.058684093478535544,
  0.050998059262376175,
  0.04283589802222668,
  0.03427386291302143,
  0.02539206530926206,
  0.01627439473090567,
  0.007018610009470096
];
function gl(f, a, b, panels) {
  const h = (b - a) / panels;
  let s = 0;
  for (let p = 0; p < panels; p++) {
    const lo = a + p * h;
    const c = lo + h / 2;
    const r = h / 2;
    for (let i = 0; i < GL_X.length; i++) {
      const dx = r * GL_X[i];
      s += r * GL_W[i] * (f(c - dx) + f(c + dx));
    }
  }
  return s;
}
var IN_LO = -8;
var IN_HI = 8;
var IN_PANELS = 3;
var NODE_Z = [];
var NODE_W = [];
var NODE_PHI = [];
var NODE_PDF = [];
{
  const h = (IN_HI - IN_LO) / IN_PANELS;
  for (let p = 0; p < IN_PANELS; p++) {
    const c = IN_LO + p * h + h / 2;
    const r = h / 2;
    for (let i = 0; i < GL_X.length; i++) {
      for (const s of [-1, 1]) {
        const z = c + s * r * GL_X[i];
        NODE_Z.push(z);
        NODE_W.push(r * GL_W[i]);
      }
    }
  }
  for (let i = 0; i < NODE_Z.length; i++) {
    const z = NODE_Z[i];
    NODE_PHI.push(pnorm(z));
    NODE_PDF.push(NODE_W[i] * Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI));
  }
}
function prange(w, k) {
  if (!(w > 0)) return 0;
  if (!Number.isFinite(w)) return 1;
  const km1 = k - 1;
  let s = 0;
  for (let i = 0; i < NODE_Z.length; i++) {
    const inner = NODE_PHI[i] - pnorm(NODE_Z[i] - w);
    if (inner > 0) s += NODE_PDF[i] * Math.pow(inner, km1);
  }
  const p = k * s;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
function ptukey(q, k, df) {
  if (!(q > 0)) return 0;
  if (!Number.isFinite(q)) return 1;
  if (!(k >= 2)) return NaN;
  if (!(df > 0)) return NaN;
  if (!Number.isFinite(df) || df > 25e3) return prange(q, k);
  const h = df / 2;
  const logC = h * Math.log(df) - lgamma(h) - (h - 1) * Math.LN2;
  const dens = (u) => {
    if (!(u > 0)) return 0;
    const lg = logC + (df - 1) * Math.log(u) - df * u * u / 2;
    return lg < -745 ? 0 : Math.exp(lg);
  };
  const sd = 1 / Math.sqrt(2 * df);
  const lo = Math.max(0, 1 - 14 * sd - 0.6);
  const hi = 1 + 14 * sd + (df < 10 ? 3 : 0.8);
  const p = gl((u) => dens(u) * prange(q * u, k), lo, hi, 12);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
function ptukeyUpper(q, k, df) {
  const p = 1 - ptukey(q, k, df);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
function qtukey(p, k, df) {
  if (!(p > 0) || !(p < 1)) return NaN;
  let lo = 0;
  let hi = 12;
  while (ptukey(hi, k, df) < p && hi < 1e3) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (ptukey(mid, k, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  return (lo + hi) / 2;
}

// src/stats/posthoc.ts
function quantile7(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}
function qt(p, df) {
  let lo = -100;
  let hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const cdf = mid >= 0 ? 1 - pt2(mid, df) / 2 : pt2(mid, df) / 2;
    if (cdf < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}
function describeGroups(names, groups) {
  return groups.map((g, i) => {
    const n = g.length;
    const s = g.slice().sort((a, b) => a - b);
    const mean = g.reduce((a, b) => a + b, 0) / (n || 1);
    const sd = n > 1 ? Math.sqrt(g.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1)) : NaN;
    const se = n > 1 ? sd / Math.sqrt(n) : NaN;
    const tc = n > 1 ? qt(0.975, n - 1) : NaN;
    const q1 = quantile7(s, 0.25);
    const q3 = quantile7(s, 0.75);
    return {
      group: names[i],
      n,
      mean,
      sd,
      se,
      median: quantile7(s, 0.5),
      q1,
      q3,
      iqr: q3 - q1,
      min: s[0],
      max: s[n - 1],
      ciLower: n > 1 ? mean - tc * se : NaN,
      ciUpper: n > 1 ? mean + tc * se : NaN
    };
  });
}
function welchAnova(groups) {
  const gs = groups.filter((g) => g.length > 1);
  const k = gs.length;
  if (k < 2) return null;
  const n = gs.map((g) => g.length);
  const m = gs.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const v = gs.map((g, i) => g.reduce((a, x) => a + (x - m[i]) * (x - m[i]), 0) / (g.length - 1));
  if (v.some((x) => !(x > 0))) return null;
  const w = n.map((ni, i) => ni / v[i]);
  const sw = w.reduce((a, b) => a + b, 0);
  const mw = w.reduce((a, wi, i) => a + wi * m[i], 0) / sw;
  const A = w.reduce((a, wi, i) => a + wi * (m[i] - mw) * (m[i] - mw), 0) / (k - 1);
  const tmp = w.reduce((a, wi, i) => a + (1 - wi / sw) * (1 - wi / sw) / (n[i] - 1), 0);
  const B = 1 + 2 * (k - 2) * tmp / (k * k - 1);
  const F = A / B;
  const df2 = 1 / (3 * tmp / (k * k - 1));
  return { F, df1: k - 1, df2, p: pf(F, k - 1, df2) };
}
function effectSizes(groups, _anova, kw) {
  const gs = groups.filter((g) => g.length > 0);
  const N = gs.reduce((s, g) => s + g.length, 0);
  const k = gs.length;
  const grand = gs.flat().reduce((s, v) => s + v, 0) / N;
  const ssB = gs.reduce((s, g) => {
    const m = g.reduce((a2, b) => a2 + b, 0) / g.length;
    return s + g.length * (m - grand) * (m - grand);
  }, 0);
  const ssT = gs.flat().reduce((s, v) => s + (v - grand) * (v - grand), 0);
  const ssW = ssT - ssB;
  const msW = ssW / (N - k);
  return {
    eta2: ssT > 0 ? ssB / ssT : NaN,
    omega2: ssT + msW > 0 ? (ssB - (k - 1) * msW) / (ssT + msW) : NaN,
    epsilon2: kw && N > 1 ? kw.H / (N - 1) : null
  };
}
function hedgesG(x, y) {
  const n1 = x.length;
  const n2 = y.length;
  if (n1 < 2 || n2 < 2) return NaN;
  const m1 = x.reduce((a, b) => a + b, 0) / n1;
  const m2 = y.reduce((a, b) => a + b, 0) / n2;
  const v1 = x.reduce((a, v) => a + (v - m1) * (v - m1), 0) / (n1 - 1);
  const v2 = y.reduce((a, v) => a + (v - m2) * (v - m2), 0) / (n2 - 1);
  const sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  const d = sp > 0 ? (m1 - m2) / sp : NaN;
  const m = n1 + n2 - 2;
  const J = Math.exp(lgammaFn(m / 2) - 0.5 * Math.log(m / 2) - lgammaFn((m - 1) / 2));
  return d * J;
}
function lgammaFn(x) {
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
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgammaFn(1 - x);
  const z = x - 1;
  let a = c[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}
var pairsOf = (xs) => {
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = i + 1; j < xs.length; j++) out.push([i, j]);
  return out;
};
function tukeyHSD(names, groups, level = 0.05) {
  const N = groups.reduce((s, g) => s + g.length, 0);
  const k = groups.length;
  const dfErr = N - k;
  if (dfErr < 1) return [];
  const m = groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const ssW = groups.reduce((s, g, i) => s + g.reduce((a, v) => a + (v - m[i]) * (v - m[i]), 0), 0);
  const mse = ssW / dfErr;
  const crit = qtukey(1 - level, k, dfErr);
  const raw = pairsOf(groups).map(([i, j]) => {
    const se = Math.sqrt(mse / 2 * (1 / groups[i].length + 1 / groups[j].length));
    const diff = m[j] - m[i];
    const q = se > 0 ? Math.abs(diff) / se : NaN;
    return {
      a: names[i],
      b: names[j],
      diff,
      statistic: q,
      df: dfErr,
      p: ptukeyUpper(q, k, dfErr),
      ciLower: diff - crit * se,
      ciUpper: diff + crit * se,
      effect: hedgesG(groups[j], groups[i])
    };
  });
  return raw.map((r) => ({ ...r, pAdj: r.p }));
}
function gamesHowell(names, groups, level = 0.05) {
  const k = groups.length;
  const n = groups.map((g) => g.length);
  const m = groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const v = groups.map((g, i) => g.length > 1 ? g.reduce((a, x) => a + (x - m[i]) * (x - m[i]), 0) / (g.length - 1) : NaN);
  const raw = pairsOf(groups).map(([i, j]) => {
    const vi = v[i] / n[i];
    const vj = v[j] / n[j];
    const diff = m[j] - m[i];
    const se = Math.sqrt((vi + vj) / 2);
    const q = se > 0 ? Math.abs(diff) / se : NaN;
    const df = (vi + vj) * (vi + vj) / (vi * vi / (n[i] - 1) + vj * vj / (n[j] - 1));
    const crit = qtukey(1 - level, k, df);
    return {
      a: names[i],
      b: names[j],
      diff,
      statistic: q,
      df,
      p: ptukeyUpper(q, k, df),
      ciLower: diff - crit * se,
      ciUpper: diff + crit * se,
      effect: hedgesG(groups[j], groups[i])
    };
  });
  return raw.map((r) => ({ ...r, pAdj: r.p }));
}
function welchPairs(names, groups, adjust = "holm") {
  const raw = pairsOf(groups).map(([i, j]) => {
    const x = groups[i];
    const y = groups[j];
    const n1 = x.length;
    const n2 = y.length;
    const m1 = x.reduce((a, b) => a + b, 0) / n1;
    const m2 = y.reduce((a, b) => a + b, 0) / n2;
    const v1 = x.reduce((a, v) => a + (v - m1) * (v - m1), 0) / (n1 - 1);
    const v2 = y.reduce((a, v) => a + (v - m2) * (v - m2), 0) / (n2 - 1);
    const se2 = v1 / n1 + v2 / n2;
    const se = Math.sqrt(se2);
    const t = se > 0 ? (m2 - m1) / se : NaN;
    const df = se2 * se2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
    const tc = qt(1 - 0.05 / 2, df);
    return {
      a: names[i],
      b: names[j],
      diff: m2 - m1,
      statistic: t,
      df,
      p: pt2(t, df),
      ciLower: m2 - m1 - tc * se,
      ciUpper: m2 - m1 + tc * se,
      effect: hedgesG(y, x)
    };
  });
  const adj = Array.from(pAdjust(raw.map((r) => r.p), adjust));
  return raw.map((r, i) => ({ ...r, pAdj: adj[i] }));
}
function dunnTest(names, groups, adjust = "holm") {
  const flat = [];
  groups.forEach((g, i2) => g.forEach((v) => flat.push({ v, g: i2 })));
  const N = flat.length;
  if (N < 3) return [];
  flat.sort((a, b) => a.v - b.v);
  const rank = new Array(N);
  const tieGroups = [];
  let i = 0;
  while (i < N) {
    let j = i;
    while (j + 1 < N && flat[j + 1].v === flat[i].v) j++;
    const r = (i + j + 2) / 2;
    for (let t = i; t <= j; t++) rank[t] = r;
    if (j > i) tieGroups.push(j - i + 1);
    i = j + 1;
  }
  const n = groups.map((g) => g.length);
  const rsum = new Array(groups.length).fill(0);
  flat.forEach((e, idx) => {
    rsum[e.g] += rank[idx];
  });
  const rbar = rsum.map((s, g) => s / n[g]);
  const tieSum = tieGroups.reduce((s, t) => s + (t * t * t - t), 0);
  const sigma2 = N * (N + 1) / 12 - tieSum / (12 * (N - 1));
  const raw = pairsOf(groups).map(([a, b]) => {
    const se = Math.sqrt(sigma2 * (1 / n[a] + 1 / n[b]));
    const z = se > 0 ? (rbar[b] - rbar[a]) / se : NaN;
    return {
      a: names[a],
      b: names[b],
      diff: rbar[b] - rbar[a],
      // difference in MEAN RANK, not in means
      statistic: z,
      df: null,
      p: 2 * (1 - pnorm(Math.abs(z))),
      ciLower: null,
      ciUpper: null,
      effect: hedgesG(groups[b], groups[a])
    };
  });
  const adj = Array.from(pAdjust(raw.map((r) => r.p), adjust));
  return raw.map((r, idx) => ({ ...r, pAdj: adj[idx] }));
}
function postHoc(method, names, groups, adjust = "holm", level = 0.05) {
  switch (method) {
    case "tukey":
      return tukeyHSD(names, groups, level);
    case "gamesHowell":
      return gamesHowell(names, groups, level);
    case "dunn":
      return dunnTest(names, groups, adjust);
    default:
      return welchPairs(names, groups, adjust);
  }
}
function leveneBF(groups) {
  const gs = groups.filter((g) => g.length > 1);
  const k = gs.length;
  if (k < 2) return null;
  const z = gs.map((g) => {
    const s = g.slice().sort((a2, b) => a2 - b);
    const med = quantile7(s, 0.5);
    return g.map((v) => Math.abs(v - med));
  });
  const a = anova(z);
  return a ? { F: a.F, df1: a.df1, df2: a.df2, p: a.p } : null;
}
function analyseCovariate(covariate, names, groups, options) {
  const adjust = options?.adjust ?? "holm";
  const level = options?.level ?? 0.05;
  const gs = groups.map((g) => g.slice());
  const a = anova(gs);
  const w = welchAnova(gs);
  const kw = kruskal(gs);
  const lev = leveneBF(gs);
  const hetero = !!lev && lev.p < 0.05;
  let method = options?.method ?? "auto";
  if (method === "auto") method = hetero ? "gamesHowell" : "tukey";
  return {
    covariate,
    describe: describeGroups(names, groups),
    omnibus: { anova: a, welch: w, kruskal: kw },
    effects: effectSizes(gs, a, kw),
    postHoc: postHoc(method, names, groups, adjust, level),
    method,
    heteroscedastic: hetero
  };
}

export { analyseCovariate, describeGroups, dunnTest, effectSizes, gamesHowell, hedgesG, leveneBF, pnorm, postHoc, prange, ptukey, ptukeyUpper, qtukey, quantile7, tukeyHSD, welchAnova, welchPairs };
//# sourceMappingURL=chunk-BAZJ42T7.js.map
//# sourceMappingURL=chunk-BAZJ42T7.js.map