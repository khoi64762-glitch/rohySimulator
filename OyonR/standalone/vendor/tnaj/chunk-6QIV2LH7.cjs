'use strict';

var chunkRT5XI5AH_cjs = require('./chunk-RT5XI5AH.cjs');

// src/core/linalg.ts
function solveLinear(A, b) {
  if (!A.isSquare) {
    throw new Error("solveLinear: A must be square");
  }
  const n = A.rows;
  let B;
  if (b instanceof chunkRT5XI5AH_cjs.Matrix) {
    if (b.rows !== n) {
      throw new Error(`solveLinear: rhs rows ${b.rows} != A rows ${n}`);
    }
    B = b.clone();
  } else {
    if (b.length !== n) {
      throw new Error(`solveLinear: rhs length ${b.length} != A rows ${n}`);
    }
    B = new chunkRT5XI5AH_cjs.Matrix(n, 1);
    for (let i = 0; i < n; i++) B.set(i, 0, b[i]);
  }
  const m = B.cols;
  const LU = A.clone();
  const RHS = B;
  for (let k = 0; k < n; k++) {
    let pivot = Math.abs(LU.get(k, k));
    let pivotRow = k;
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(LU.get(i, k));
      if (v > pivot) {
        pivot = v;
        pivotRow = i;
      }
    }
    if (pivot < 1e-14) {
      throw new Error(
        `solveLinear: matrix is singular or near-singular (pivot ${pivot} at col ${k})`
      );
    }
    if (pivotRow !== k) {
      for (let j = 0; j < n; j++) {
        const tmp = LU.get(k, j);
        LU.set(k, j, LU.get(pivotRow, j));
        LU.set(pivotRow, j, tmp);
      }
      for (let j = 0; j < m; j++) {
        const tmp = RHS.get(k, j);
        RHS.set(k, j, RHS.get(pivotRow, j));
        RHS.set(pivotRow, j, tmp);
      }
    }
    const pivotVal = LU.get(k, k);
    for (let i = k + 1; i < n; i++) {
      const factor = LU.get(i, k) / pivotVal;
      if (factor !== 0) {
        LU.set(i, k, factor);
        for (let j = k + 1; j < n; j++) {
          LU.set(i, j, LU.get(i, j) - factor * LU.get(k, j));
        }
        for (let j = 0; j < m; j++) {
          RHS.set(i, j, RHS.get(i, j) - factor * RHS.get(k, j));
        }
      }
    }
  }
  const X = new chunkRT5XI5AH_cjs.Matrix(n, m);
  for (let j = 0; j < m; j++) {
    for (let i = n - 1; i >= 0; i--) {
      let sum = RHS.get(i, j);
      for (let k = i + 1; k < n; k++) {
        sum -= LU.get(i, k) * X.get(k, j);
      }
      X.set(i, j, sum / LU.get(i, i));
    }
  }
  return X;
}
function eigenDominantLeft(P) {
  if (!P.isSquare) {
    throw new Error("eigenDominantLeft: P must be square");
  }
  const n = P.rows;
  const rowSums = P.rowSums();
  for (let i = 0; i < n; i++) {
    if (rowSums[i] <= 0) {
      throw new Error(
        `eigenDominantLeft: row ${i} has sum ${rowSums[i]} \u2014 chain is not ergodic`
      );
    }
  }
  const A = new chunkRT5XI5AH_cjs.Matrix(n, n);
  const invN = 1 / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let a = i === j ? 1 : 0;
      a -= P.get(j, i);
      a += invN;
      A.set(i, j, a);
    }
  }
  const rhs = new Float64Array(n);
  for (let i = 0; i < n; i++) rhs[i] = invN;
  const sol = solveLinear(A, rhs);
  const pi = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(sol.get(i, 0));
    pi[i] = v;
    sum += v;
  }
  if (sum === 0) {
    throw new Error("eigenDominantLeft: stationary vector collapsed to zero");
  }
  for (let i = 0; i < n; i++) pi[i] /= sum;
  return pi;
}

// src/core/prepare-long.ts
function parseTimeValue(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  const d = new Date(String(raw));
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}
function mode(vals) {
  const freq = /* @__PURE__ */ new Map();
  for (const v of vals) freq.set(v, (freq.get(v) ?? 0) + 1);
  let best = vals[0], bestN = 0;
  for (const [v, n] of freq) if (n > bestN) {
    best = v;
    bestN = n;
  }
  return best;
}
function isNumericColumn(vals) {
  const seen = vals.filter((v) => v != null && v !== "");
  if (seen.length === 0) return false;
  return seen.every((v) => Number.isFinite(Number(v)));
}
function aggregate(vals, numericAgg, categoricalAgg) {
  if (vals.length === 0) return "";
  const first = vals[0];
  const last = vals[vals.length - 1];
  const present = vals.filter((v) => v !== "");
  if (isNumericColumn(vals)) {
    switch (numericAgg) {
      case "first":
        return first;
      case "last":
        return last;
      case "mode":
        return present.length ? mode(present) : "";
      case "sum":
      default: {
        if (present.length === 0) return "";
        const nums = present.map(Number);
        const total = nums.reduce((a, b) => a + b, 0);
        return String(numericAgg === "sum" ? total : total / nums.length);
      }
    }
  }
  switch (categoricalAgg) {
    case "first":
      return first;
    case "last":
      return last;
    default:
      return present.length ? mode(present) : "";
  }
}
function prepareLong(rows, headers, options) {
  const colIdx = (c) => {
    if (c == null) return -1;
    if (typeof c === "number") return c;
    return headers.indexOf(c);
  };
  const actorI = colIdx(options.actor);
  const actionI = colIdx(options.action);
  const timeI = colIdx(options.time);
  const orderI = colIdx(options.order);
  if (actorI < 0) throw new Error("prepareLong: actor column not found");
  if (actionI < 0) throw new Error("prepareLong: action column not found");
  const numericAgg = options.numericAgg ?? "mean";
  const categoricalAgg = options.categoricalAgg ?? "mode";
  const threshold = options.timeThreshold ?? 0;
  const cell = (r, i) => i < 0 || r[i] == null ? "" : String(r[i]).trim();
  const byActor = /* @__PURE__ */ new Map();
  const actorOrder = [];
  rows.forEach((r, i) => {
    const act = cell(r, actionI);
    if (act === "") return;
    const a = cell(r, actorI);
    if (a === "") return;
    if (!byActor.has(a)) {
      byActor.set(a, []);
      actorOrder.push(a);
    }
    byActor.get(a).push({
      row: i,
      t: timeI >= 0 ? parseTimeValue(r[timeI]) : null,
      ord: orderI >= 0 ? parseTimeValue(r[orderI]) : null
    });
  });
  const ids = [];
  const actors = [];
  const sessionNr = [];
  const seqRowIndices = [];
  const times = [];
  let sessionsFromGap = 0;
  for (const a of actorOrder) {
    const evs = byActor.get(a);
    evs.sort((x, y) => {
      if (x.t != null && y.t != null && x.t !== y.t) return x.t - y.t;
      if (x.ord != null && y.ord != null && x.ord !== y.ord) return x.ord - y.ord;
      return x.row - y.row;
    });
    let part = [];
    const parts = [];
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (part.length > 0 && threshold > 0 && e.t != null) {
        const prev = part[part.length - 1].t;
        if (prev != null && e.t - prev > threshold) {
          parts.push(part);
          part = [];
          sessionsFromGap++;
        }
      }
      part.push(e);
    }
    if (part.length) parts.push(part);
    parts.forEach((p, k) => {
      ids.push(a + " session" + (k + 1));
      actors.push(a);
      sessionNr.push(k + 1);
      seqRowIndices.push(p.map((e) => e.row));
      times.push(p.map((e) => e.t).filter((t) => t != null));
    });
  }
  const sequences = seqRowIndices.map((idxs) => idxs.map((i) => cell(rows[i], actionI)));
  const metaCols = headers.map((_, i) => i).filter((i) => i !== actionI);
  const columns = [".session_id", ...metaCols.map((i) => headers[i]), ".session_nr"];
  const varying = [];
  const perCol = metaCols.map(() => []);
  metaCols.forEach((ci, c) => {
    const agg = ci === timeI ? "first" : numericAgg;
    let nVary = 0;
    seqRowIndices.forEach((idxs) => {
      const vals = idxs.map((i) => cell(rows[i], ci));
      if (new Set(vals.filter((v) => v !== "")).size > 1) nVary++;
      perCol[c].push(aggregate(vals, agg, categoricalAgg));
    });
    if (nVary > 0 && ci !== timeI) varying.push({ column: headers[ci], nSessions: nVary });
  });
  const types = ["categorical"];
  metaCols.forEach((_ci, c) => types.push(isNumericColumn(perCol[c]) ? "numeric" : "categorical"));
  types.push("numeric");
  const metaRows = ids.map((id, r) => {
    const row = [id];
    metaCols.forEach((_ci, c) => {
      const v = perCol[c][r];
      row.push(types[c + 1] === "numeric" ? v === "" ? null : Number(v) : v === "" ? null : v);
    });
    row.push(sessionNr[r]);
    return row;
  });
  const lens = sequences.map((s) => s.length);
  const totalActions = lens.reduce((a, b) => a + b, 0);
  return {
    sequences,
    ids,
    actors,
    sessionNr,
    seqRowIndices,
    times,
    meta: { columns, rows: metaRows, types, varying },
    statistics: {
      totalSessions: ids.length,
      totalActions,
      maxSequenceLength: lens.length ? Math.max(...lens) : 0,
      meanSequenceLength: lens.length ? totalActions / lens.length : 0,
      uniqueActors: actorOrder.length,
      sessionsPerActor: actorOrder.map((a) => ({
        actor: a,
        nSessions: actors.filter((x) => x === a).length
      })),
      actionsPerSession: ids.map((id, i) => ({ id, nActions: lens[i] })),
      sessionsFromGap
    }
  };
}
function designMatrix(meta, terms, options) {
  const idxOf = (t) => meta.columns.indexOf(t);
  const names = [];
  const reference = {};
  const cols = [];
  for (const t of terms) {
    const ci = idxOf(t);
    if (ci < 0) throw new Error(`designMatrix: no metadata column named "${t}"`);
    const vals = meta.rows.map((r) => r[ci]);
    if (meta.types[ci] === "numeric") {
      names.push(t);
      cols.push(vals.map((v) => v == null ? null : Number(v)));
      continue;
    }
    const levels = Array.from(new Set(vals.filter((v) => v != null).map(String))).sort();
    if (levels.length < 2) throw new Error(`designMatrix: "${t}" has fewer than 2 levels \u2014 it is a constant, not a covariate`);
    const ref = options?.reference?.[t] ?? levels[0];
    if (!levels.includes(ref)) throw new Error(`designMatrix: reference level "${ref}" not found in "${t}"`);
    reference[t] = ref;
    for (const L of levels) {
      if (L === ref) continue;
      names.push(t + "=" + L);
      cols.push(vals.map((v) => v == null ? null : String(v) === L ? 1 : 0));
    }
  }
  const dropped = [];
  const X = [];
  for (let r = 0; r < meta.rows.length; r++) {
    const row = cols.map((c) => c[r]);
    if (row.some((v) => v == null || !Number.isFinite(v))) {
      dropped.push(r);
      continue;
    }
    X.push(row);
  }
  return { X, names, reference, dropped };
}

exports.designMatrix = designMatrix;
exports.eigenDominantLeft = eigenDominantLeft;
exports.isNumericColumn = isNumericColumn;
exports.parseTimeValue = parseTimeValue;
exports.prepareLong = prepareLong;
exports.solveLinear = solveLinear;
//# sourceMappingURL=chunk-6QIV2LH7.cjs.map
//# sourceMappingURL=chunk-6QIV2LH7.cjs.map