import { networkSelfLoopGeometry, networkEdgeGeometry, networkArrowPolygon } from './chunk-HICX3NUZ.js';
import { bootstrapTna } from './chunk-4WEWB4WN.js';
import { isHtna } from './chunk-PKCMUOEM.js';
import { buildModel, Matrix } from './chunk-2EXGRQR6.js';

// src/htna/build.ts
function htna(data, options) {
  const { nodeGroups, actorLevels: actorLevelsOpt, ...buildOpts } = options;
  validateNodeGroups(nodeGroups);
  const actorLevels = actorLevelsOpt ?? Object.keys(nodeGroups);
  for (const a of actorLevels) {
    if (!(a in nodeGroups)) {
      throw new Error(`htna(): actorLevels entry "${a}" not present in nodeGroups.`);
    }
  }
  const codeToActor = buildCodeToActor(nodeGroups, actorLevels);
  const model = buildModel(data, buildOpts);
  const partition = model.labels.map((label) => {
    const actor = codeToActor.get(label);
    if (actor === void 0) {
      throw new Error(
        `htna(): code "${label}" in data is not assigned to any actor in nodeGroups. Add it to nodeGroups or filter it out of the input data.`
      );
    }
    return actor;
  });
  model.partition = partition;
  model.actorLevels = actorLevels;
  return model;
}
function htnaFromLong(rows, options) {
  if (rows.length === 0) {
    throw new Error("htnaFromLong(): rows is empty.");
  }
  const { nodeGroups, actorLevels: actorLevelsOpt, disambiguate = false, ...buildOpts } = options;
  const haveRowActor = rows.every((r) => typeof r.actor === "string" && r.actor.length > 0);
  if (!haveRowActor && !nodeGroups) {
    throw new Error(
      "htnaFromLong(): supply either per-row `actor` tags on every row, or a `nodeGroups` lookup."
    );
  }
  let actorVec;
  if (haveRowActor) {
    actorVec = rows.map((r) => r.actor);
  } else {
    const codeToActor = buildCodeToActor(nodeGroups, actorLevelsOpt ?? Object.keys(nodeGroups));
    actorVec = rows.map((r) => {
      const a = codeToActor.get(r.code);
      if (a === void 0) {
        throw new Error(
          `htnaFromLong(): code "${r.code}" not present in nodeGroups (row session=${String(r.session)}, order=${r.order}).`
        );
      }
      return a;
    });
  }
  const actorLevels = actorLevelsOpt ?? uniqueInOrder(actorVec);
  const codesByActor = {};
  for (const a of actorLevels) codesByActor[a] = /* @__PURE__ */ new Set();
  for (let i = 0; i < rows.length; i++) {
    const a = actorVec[i];
    if (!(a in codesByActor)) {
      throw new Error(
        `htnaFromLong(): actor "${a}" appears in data but is not in actorLevels [${actorLevels.join(", ")}].`
      );
    }
    codesByActor[a].add(rows[i].code);
  }
  const overlap = computeOverlap(codesByActor, actorLevels);
  if (overlap.length > 0 && !disambiguate) {
    throw new Error(
      `htnaFromLong(): code(s) appear in more than one actor group: ${overlap.join(", ")}. Pass disambiguate: true to prefix codes with the actor label.`
    );
  }
  let workingCodes;
  if (disambiguate) {
    workingCodes = rows.map((r, i) => `${actorVec[i]}:${r.code}`);
    for (const a of actorLevels) codesByActor[a] = /* @__PURE__ */ new Set();
    for (let i = 0; i < rows.length; i++) {
      codesByActor[actorVec[i]].add(workingCodes[i]);
    }
  } else {
    workingCodes = rows.map((r) => r.code);
  }
  const sessionKeys = uniqueInOrder(rows.map((r) => String(r.session)));
  const sessionIndex = new Map(sessionKeys.map((k, i) => [k, i]));
  const sessions = sessionKeys.map(() => []);
  for (let i = 0; i < rows.length; i++) {
    const si = sessionIndex.get(String(rows[i].session));
    sessions[si].push({ order: rows[i].order, code: workingCodes[i] });
  }
  for (const s of sessions) s.sort((a, b) => a.order - b.order);
  const data = sessions.map((events) => events.map((e) => e.code));
  const model = buildModel(data, buildOpts);
  const labelToActor = /* @__PURE__ */ new Map();
  for (const a of actorLevels) {
    for (const c of codesByActor[a]) labelToActor.set(c, a);
  }
  const partition = model.labels.map((label) => {
    const a = labelToActor.get(label);
    if (a === void 0) {
      throw new Error(`htnaFromLong(): internal error \u2014 label "${label}" has no actor mapping.`);
    }
    return a;
  });
  model.partition = partition;
  model.actorLevels = actorLevels;
  return model;
}
function validateNodeGroups(nodeGroups) {
  const actors = Object.keys(nodeGroups);
  if (actors.length < 2) {
    throw new Error("htna(): `nodeGroups` must have at least two actor groups.");
  }
  for (const a of actors) {
    if (!Array.isArray(nodeGroups[a])) {
      throw new Error(`htna(): nodeGroups["${a}"] must be an array of code strings.`);
    }
  }
}
function buildCodeToActor(nodeGroups, actorLevels) {
  const codeToActor = /* @__PURE__ */ new Map();
  const collisions = /* @__PURE__ */ new Set();
  for (const actor of actorLevels) {
    const seen = /* @__PURE__ */ new Set();
    for (const code of nodeGroups[actor] ?? []) {
      if (seen.has(code)) continue;
      seen.add(code);
      if (codeToActor.has(code) && codeToActor.get(code) !== actor) {
        collisions.add(code);
      } else {
        codeToActor.set(code, actor);
      }
    }
  }
  if (collisions.size > 0) {
    throw new Error(
      `htna(): code(s) appear in more than one actor group in nodeGroups: ${[...collisions].join(", ")}. Use htnaFromLong() with disambiguate=true to allow this.`
    );
  }
  return codeToActor;
}
function computeOverlap(codesByActor, actorLevels) {
  const counts = /* @__PURE__ */ new Map();
  for (const a of actorLevels) {
    for (const c of codesByActor[a] ?? /* @__PURE__ */ new Set()) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([c]) => c);
}
function uniqueInOrder(arr) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// src/htna/bootstrap.ts
function bootstrapHtna(model, options = {}) {
  if (!isHtna(model)) {
    throw new Error(
      "bootstrapHtna(): input must be an HTNA model produced by htna() or htnaFromLong() \u2014 it must have `partition` populated."
    );
  }
  const result = bootstrapTna(model, options);
  result.model.partition = [...model.partition];
  result.model.actorLevels = model.actorLevels ? [...model.actorLevels] : void 0;
  return result;
}

// src/htna/metaPaths.ts
function extractMetaPaths(model, options = {}) {
  if (!isHtna(model)) {
    throw new Error("extractMetaPaths(): input must be an HTNA model (partition required).");
  }
  if (!model.data || model.data.length === 0) {
    throw new Error("extractMetaPaths(): model has no sequence data (`model.data` is empty).");
  }
  const {
    length: lengths = [2, 3, 4],
    schema,
    type = "contiguous",
    gap = 1,
    minCount = 1,
    minSupport = 0,
    minLift = 0,
    start,
    end,
    contain
  } = options;
  const alphabet = model.actorLevels ?? uniqueInOrder2(model.partition);
  const T = alphabet.length;
  const codeToActorIdx = /* @__PURE__ */ new Map();
  for (let i = 0; i < model.labels.length; i++) {
    const actor = model.partition[i];
    const aIdx = alphabet.indexOf(actor);
    if (aIdx < 0) {
      throw new Error(
        `extractMetaPaths(): partition tag "${actor}" not in actorLevels [${alphabet.join(", ")}].`
      );
    }
    codeToActorIdx.set(model.labels[i], aIdx);
  }
  const intSeqs = [];
  for (const session of model.data) {
    const buf = [];
    for (const code of session) {
      if (code === null || code === void 0 || code === "") continue;
      const aIdx = codeToActorIdx.get(code);
      if (aIdx === void 0) continue;
      buf.push(aIdx);
    }
    intSeqs.push(Int32Array.from(buf));
  }
  const nSeq = intSeqs.length;
  const margP = marginalFreq(intSeqs, T);
  let gapVals;
  if (type === "contiguous") {
    gapVals = [0];
  } else {
    const gArr = Array.isArray(gap) ? gap : [gap];
    if (gArr.length === 0 || gArr.some((g) => !Number.isInteger(g) || g < 0)) {
      throw new Error("extractMetaPaths(): `gap` must be one or more non-negative integers.");
    }
    gapVals = [...new Set(gArr)].sort((a, b) => a - b);
    if (gapVals.length === 1 && gapVals[0] === 0) gapVals = [1];
  }
  const lenVals = [...new Set(lengths)].sort((a, b) => a - b);
  if (lenVals.length === 0 || lenVals.some((k) => !Number.isInteger(k) || k < 2)) {
    throw new Error("extractMetaPaths(): `length` must be one or more integers \u2265 2.");
  }
  const raw = [];
  if (schema !== void 0) {
    const partsIdx = parsePattern(schema, alphabet);
    const k = partsIdx.length;
    for (const g of gapVals) {
      const rows2 = searchPattern(intSeqs, partsIdx, T, g, alphabet, margP);
      for (const r of rows2) {
        raw.push({ ...r, length: k, gap: g });
      }
    }
  } else {
    for (const g of gapVals) {
      for (const k of lenVals) {
        const rows2 = enumeratePaths(intSeqs, T, k, g, alphabet, margP);
        for (const r of rows2) {
          raw.push({ ...r, length: k, gap: g });
        }
      }
    }
  }
  if (raw.length === 0) return [];
  const groupSums = /* @__PURE__ */ new Map();
  for (const r of raw) {
    const key = `${r.length}|${r.gap}`;
    groupSums.set(key, (groupSums.get(key) ?? 0) + r.count);
  }
  const rows = raw.map((r) => {
    const expectedCount = r.expectedP * r.totalWindows;
    const lift = expectedCount > 0 ? r.count / expectedCount : NaN;
    const support = r.nSequences / nSeq;
    const groupSum = groupSums.get(`${r.length}|${r.gap}`) ?? 0;
    const frequency = groupSum > 0 ? r.count / groupSum : 0;
    return {
      schema: r.schema,
      length: r.length,
      gap: r.gap,
      count: r.count,
      nSequences: r.nSequences,
      support,
      frequency,
      lift
    };
  });
  const filtered = rows.filter((r) => {
    if (r.count < minCount) return false;
    if (r.support < minSupport) return false;
    if (minLift > 0 && (Number.isNaN(r.lift) || r.lift < minLift)) return false;
    if (start) {
      const first = r.schema.split("->")[0];
      if (!start.includes(first)) return false;
    }
    if (end) {
      const parts = r.schema.split("->");
      const last = parts[parts.length - 1];
      if (!end.includes(last)) return false;
    }
    if (contain) {
      const parts = r.schema.split("->");
      for (const c of contain) {
        if (!parts.includes(c)) return false;
      }
    }
    return true;
  });
  filtered.sort((a, b) => a.length - b.length || a.gap - b.gap || b.count - a.count);
  return filtered;
}
function uniqueInOrder2(arr) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
function marginalFreq(intSeqs, T) {
  let total = 0;
  const tab = new Float64Array(T);
  for (const s of intSeqs) {
    total += s.length;
    for (let i = 0; i < s.length; i++) {
      const idx = s[i];
      tab[idx] = (tab[idx] ?? 0) + 1;
    }
  }
  if (total === 0) {
    for (let i = 0; i < T; i++) tab[i] = 1 / T;
  } else {
    for (let i = 0; i < T; i++) tab[i] /= total;
  }
  return tab;
}
function totalWindows(intSeqs, k, gap) {
  const span = (k - 1) * (gap + 1);
  let sum = 0;
  for (const s of intSeqs) sum += Math.max(0, s.length - span);
  return sum;
}
function windowCodes(v, k, gap, T) {
  const span = (k - 1) * (gap + 1);
  const nValid = v.length - span;
  if (nValid < 1) return new Int32Array(0);
  const out = new Int32Array(nValid);
  const stride = gap + 1;
  for (let j = 0; j < k; j++) {
    const factor = Math.pow(T, j);
    const startIdx = j * stride;
    for (let i = 0; i < nValid; i++) {
      out[i] += factor * v[startIdx + i];
    }
  }
  return out;
}
function decodeCodes(codes, k, T) {
  const digits = codes.map(() => new Array(k));
  for (let i = 0; i < codes.length; i++) {
    let rem = codes[i];
    for (let j = 0; j < k; j++) {
      digits[i][j] = rem % T;
      rem = Math.floor(rem / T);
    }
  }
  return digits;
}
function parsePattern(pattern, alphabet) {
  const cleaned = pattern.replace(/\s+/g, "");
  const parts = cleaned.split("->");
  if (parts.length < 2) {
    throw new Error("extractMetaPaths(): `schema` must have at least two elements separated by '->'.");
  }
  return parts.map((p) => {
    if (p === "*") return Array.from({ length: alphabet.length }, (_, i) => i);
    const idx = alphabet.indexOf(p);
    if (idx < 0) {
      throw new Error(
        `extractMetaPaths(): unknown alphabet element in schema: "${p}". Known: ${alphabet.join(", ")}.`
      );
    }
    return [idx];
  });
}
function cartesian(partsIdx) {
  let out = [[]];
  for (const part of partsIdx) {
    const next = [];
    for (const prefix of out) {
      for (const v of part) next.push([...prefix, v]);
    }
    out = next;
  }
  return out;
}
function searchPattern(intSeqs, partsIdx, T, gap, alphabet, margP) {
  const k = partsIdx.length;
  const expanded = cartesian(partsIdx);
  const targets = expanded.map((digits) => digitsToCode(digits, T));
  const targetIdx = /* @__PURE__ */ new Map();
  targets.forEach((c, i) => targetIdx.set(c, i));
  const total = new Int32Array(targets.length);
  const inSeq = new Int32Array(targets.length);
  for (const s of intSeqs) {
    const codes = windowCodes(s, k, gap, T);
    if (codes.length === 0) continue;
    const seenInThisSeq = /* @__PURE__ */ new Set();
    for (let i = 0; i < codes.length; i++) {
      const idx = targetIdx.get(codes[i]);
      if (idx === void 0) continue;
      total[idx]++;
      seenInThisSeq.add(idx);
    }
    for (const idx of seenInThisSeq) inSeq[idx]++;
  }
  const totalWins = totalWindows(intSeqs, k, gap);
  const rows = [];
  for (let i = 0; i < targets.length; i++) {
    if (total[i] === 0) continue;
    const digits = expanded[i];
    let expP = 1;
    for (const d of digits) expP *= margP[d];
    rows.push({
      schema: digits.map((d) => alphabet[d]).join("->"),
      count: total[i],
      nSequences: inSeq[i],
      expectedP: expP,
      totalWindows: totalWins
    });
  }
  return rows;
}
function enumeratePaths(intSeqs, T, k, gap, alphabet, margP) {
  const nCodes = Math.pow(T, k);
  const total = new Int32Array(nCodes);
  const inSeq = new Int32Array(nCodes);
  for (const s of intSeqs) {
    const codes = windowCodes(s, k, gap, T);
    if (codes.length === 0) continue;
    const seenInThisSeq = /* @__PURE__ */ new Set();
    for (let i = 0; i < codes.length; i++) {
      total[codes[i]]++;
      seenInThisSeq.add(codes[i]);
    }
    for (const c of seenInThisSeq) inSeq[c]++;
  }
  const keptCodes = [];
  for (let c = 0; c < nCodes; c++) {
    if (total[c] > 0) keptCodes.push(c);
  }
  if (keptCodes.length === 0) return [];
  const digits = decodeCodes(keptCodes, k, T);
  const totalWins = totalWindows(intSeqs, k, gap);
  return keptCodes.map((c, i) => {
    const d = digits[i];
    let expP = 1;
    for (const di of d) expP *= margP[di];
    return {
      schema: d.map((di) => alphabet[di]).join("->"),
      count: total[c],
      nSequences: inSeq[c],
      expectedP: expP,
      totalWindows: totalWins
    };
  });
}
function digitsToCode(digits, T) {
  let c = 0;
  for (let j = 0; j < digits.length; j++) c += Math.pow(T, j) * digits[j];
  return c;
}

// src/htna/formatPaths.ts
var HEADERS = {
  meta: "Meta-paths (type-level)",
  state: "Patterns (state-level)",
  paths: "Paths"
};
var COL_NAMES = ["schema", "length", "gap", "count", "n_seq", "support", "frequency", "lift"];
function formatPaths(rows, options = {}) {
  const { n = 10, nSequences, level = "meta" } = options;
  const lines = [];
  const nSeqStr = nSequences !== void 0 ? String(nSequences) : "NA";
  lines.push(`${HEADERS[level]} over ${nSeqStr} sequences`);
  if (rows.length === 0) {
    lines.push("(no rows met the filters)");
    return lines.join("\n");
  }
  const uniqLen = [...new Set(rows.map((r) => r.length))].sort((a, b) => a - b);
  const uniqGap = [...new Set(rows.map((r) => r.gap))].sort((a, b) => a - b);
  lines.push(
    `Rows: ${rows.length} | Lengths: ${uniqLen.join(", ")} | Gaps: ${uniqGap.join(", ")}`
  );
  const shown = rows.slice(0, n);
  const cells = [
    [...COL_NAMES],
    ...shown.map((r) => [
      r.schema,
      String(r.length),
      String(r.gap),
      String(r.count),
      String(r.nSequences),
      r.support.toFixed(3),
      r.frequency.toFixed(3),
      Number.isFinite(r.lift) ? r.lift.toFixed(2) : "NA"
    ])
  ];
  const nCols = COL_NAMES.length;
  const widths = new Array(nCols).fill(0);
  for (const row of cells) {
    for (let c = 0; c < nCols; c++) {
      if (row[c].length > widths[c]) widths[c] = row[c].length;
    }
  }
  for (let c = 0; c < nCols; c++) widths[c] += 1;
  for (const row of cells) {
    const parts = row.map((cell, c) => cell.padStart(widths[c]));
    lines.push(parts.join(""));
  }
  if (rows.length > n) {
    lines.push(`... (${rows.length - n} more)`);
  }
  return lines.join("\n");
}

// src/htna/diff.ts
function diffNetworks(a, b) {
  if (a.labels.length !== b.labels.length) {
    throw new Error(
      `diffNetworks(): label-count mismatch \u2014 A has ${a.labels.length} labels, B has ${b.labels.length}.`
    );
  }
  const aLabelSet = new Set(a.labels);
  for (const l of b.labels) {
    if (!aLabelSet.has(l)) {
      throw new Error(`diffNetworks(): label "${l}" in B not present in A.`);
    }
  }
  const bIdx = new Map(b.labels.map((l, i) => [l, i]));
  let partition;
  let actorLevels;
  if (a.partition && b.partition) {
    const aPart = new Map(a.labels.map((l, i) => [l, a.partition[i]]));
    for (let bi = 0; bi < b.labels.length; bi++) {
      const aTag = aPart.get(b.labels[bi]);
      const bTag = b.partition[bi];
      if (aTag !== bTag) {
        throw new Error(
          `diffNetworks(): partition mismatch for "${b.labels[bi]}" \u2014 A="${aTag}" vs B="${bTag}".`
        );
      }
    }
    partition = [...a.partition];
    actorLevels = a.actorLevels ? [...a.actorLevels] : void 0;
  }
  const n = a.labels.length;
  const edges = [];
  const counts = {
    added: 0,
    removed: 0,
    increased: 0,
    decreased: 0,
    unchanged: 0
  };
  for (let i = 0; i < n; i++) {
    const fromLabel = a.labels[i];
    const bi = bIdx.get(fromLabel);
    for (let j = 0; j < n; j++) {
      const toLabel = a.labels[j];
      const bj = bIdx.get(toLabel);
      const wa = a.weights.get(i, j);
      const wb = b.weights.get(bi, bj);
      if (wa === 0 && wb === 0) continue;
      const mag = wb - wa;
      let kind;
      if (wa === 0) kind = "added";
      else if (wb === 0) kind = "removed";
      else if (mag > 0) kind = "increased";
      else if (mag < 0) kind = "decreased";
      else kind = "unchanged";
      edges.push({ from: fromLabel, to: toLabel, weightA: wa, weightB: wb, magnitude: mag, kind });
      counts[kind]++;
    }
  }
  return { labels: [...a.labels], partition, actorLevels, edges, counts };
}

// src/htna/sequencePlot.ts
function sequencePlotHtnaData(model, options = {}) {
  if (!isHtna(model)) {
    throw new Error("sequencePlotHtnaData(): input must be an HTNA model (partition required).");
  }
  if (!model.data || model.data.length === 0) {
    throw new Error("sequencePlotHtnaData(): model has no sequence data.");
  }
  const { by = "state" } = options;
  const typeMap = /* @__PURE__ */ new Map();
  for (let i = 0; i < model.labels.length; i++) {
    typeMap.set(model.labels[i], model.partition[i]);
  }
  const actors = options.actorLevels ? [...options.actorLevels] : [...new Set(model.partition)].sort();
  if (by === "group") {
    const maxLen = model.data.reduce((m, s) => Math.max(m, s.length), 0);
    const data2 = model.data.map((session) => {
      const row = new Array(maxLen).fill(null);
      for (let j = 0; j < session.length; j++) {
        const code = session[j];
        if (code === null || code === void 0 || code === "") continue;
        const actor = typeMap.get(code);
        row[j] = actor ?? null;
      }
      return row;
    });
    return { by: "group", actors, data: data2, group: [] };
  }
  const pieces = {};
  for (const a of actors) pieces[a] = [];
  for (const session of model.data) {
    const perActor = {};
    for (const a of actors) perActor[a] = [];
    for (const code of session) {
      if (code === null || code === void 0 || code === "") continue;
      const a = typeMap.get(code);
      if (a !== void 0 && perActor[a] !== void 0) perActor[a].push(code);
    }
    for (const a of actors) {
      if (perActor[a].length > 0) {
        pieces[a].push(perActor[a]);
      }
    }
  }
  const perActorMaxLen = {};
  for (const a of actors) {
    perActorMaxLen[a] = pieces[a].reduce((m, r) => Math.max(m, r.length), 0);
  }
  const globalMaxLen = Math.max(0, ...Object.values(perActorMaxLen));
  const paddedPieces = {};
  for (const a of actors) {
    paddedPieces[a] = pieces[a].map((row) => {
      if (row.length >= globalMaxLen) return [...row];
      const padded = [...row];
      while (padded.length < globalMaxLen) padded.push(null);
      return padded;
    });
  }
  const data = [];
  const group = [];
  for (const a of actors) {
    for (const row of paddedPieces[a]) {
      data.push(row);
      group.push(a);
    }
  }
  return { by: "state", actors, data, group, pieces: paddedPieces };
}

// src/htna/plot.ts
var HTNA_COLOR_PALETTE = [
  "#4FC3F7",
  "#fbb550",
  "#7eb5d6",
  "#98d4a2",
  "#f4a582",
  "#92c5de",
  "#d6c1de",
  "#b8e186",
  "#fdcdac",
  "#cbd5e8",
  "#f4cae4",
  "#e6f5c9"
];
var HTNA_SHAPE_PALETTE = [
  "circle",
  "square",
  "diamond",
  "triangle",
  "pentagon",
  "hexagon",
  "star",
  "cross"
];
function htnaPlotData(model, options = {}) {
  if (!isHtna(model)) {
    throw new Error("htnaPlotData(): input must be an HTNA model (partition required).");
  }
  const {
    layout = "bipartite-arcs",
    width = 1080,
    height = 840,
    edgeThreshold = 0,
    curvature = 0.4,
    bipartiteGapHalf = 40,
    bipartiteArcSpan = Math.PI * 0.45
  } = options;
  const actorLevels = model.actorLevels ?? [...new Set(model.partition)];
  const groupColors = {};
  const groupShapes = {};
  for (let i = 0; i < actorLevels.length; i++) {
    const a = actorLevels[i];
    groupColors[a] = options.groupColors?.[a] ?? HTNA_COLOR_PALETTE[i % HTNA_COLOR_PALETTE.length];
    groupShapes[a] = options.groupShapes?.[a] ?? HTNA_SHAPE_PALETTE[i % HTNA_SHAPE_PALETTE.length];
  }
  const positions = computePositions(
    model.labels,
    model.partition,
    actorLevels,
    layout,
    width,
    height,
    { gapHalf: bipartiteGapHalf, arcSpan: bipartiteArcSpan, radius: options.bipartiteRadius }
  );
  const nodes = model.labels.map((label, i) => ({
    id: label,
    label,
    partition: model.partition[i],
    x: positions[i].x,
    y: positions[i].y,
    shape: groupShapes[model.partition[i]],
    color: groupColors[model.partition[i]],
    initProb: model.inits[i] ?? 0
  }));
  const edges = [];
  const n = model.labels.length;
  for (let i = 0; i < n; i++) {
    const srcActor = model.partition[i];
    for (let j = 0; j < n; j++) {
      const w = model.weights.get(i, j);
      if (w <= edgeThreshold) continue;
      const tgtActor = model.partition[j];
      let kind;
      if (i === j) kind = "self";
      else if (srcActor === tgtActor) kind = "within";
      else kind = "between";
      edges.push({
        from: model.labels[i],
        to: model.labels[j],
        weight: w,
        color: groupColors[srcActor],
        kind,
        curvature: kind === "within" ? curvature : kind === "between" ? 0 : 0
      });
    }
  }
  const legend = actorLevels.map((a) => ({
    name: a,
    color: groupColors[a],
    shape: groupShapes[a]
  }));
  return { layout, width, height, nodes, edges, legend };
}
function computePositions(labels, partition, actorLevels, layout, width, height, bipartite) {
  const n = labels.length;
  const cx = width / 2;
  const cy = height / 2;
  if (layout === "circular") {
    const r2 = Math.min(cx, cy) * 0.7;
    return labels.map((_, i) => {
      const angle = -Math.PI / 2 + 2 * Math.PI * i / n;
      return { x: cx + r2 * Math.cos(angle), y: cy + r2 * Math.sin(angle) };
    });
  }
  if (layout === "vertical" || layout === "horizontal") {
    const groupA2 = actorLevels[0];
    const idxsA2 = [], idxsB2 = [];
    for (let i = 0; i < n; i++) {
      (partition[i] === groupA2 ? idxsA2 : idxsB2).push(i);
    }
    const out2 = new Array(n);
    if (layout === "vertical") {
      const colA = cx - width * 0.25;
      const colB = cx + width * 0.25;
      const margin = height * 0.1;
      const innerH = height - 2 * margin;
      idxsA2.forEach((idx, k) => {
        out2[idx] = { x: colA, y: margin + (k + 0.5) * (innerH / Math.max(1, idxsA2.length)) };
      });
      idxsB2.forEach((idx, k) => {
        out2[idx] = { x: colB, y: margin + (k + 0.5) * (innerH / Math.max(1, idxsB2.length)) };
      });
    } else {
      const rowA = cy - height * 0.25;
      const rowB = cy + height * 0.25;
      const margin = width * 0.1;
      const innerW = width - 2 * margin;
      idxsA2.forEach((idx, k) => {
        out2[idx] = { x: margin + (k + 0.5) * (innerW / Math.max(1, idxsA2.length)), y: rowA };
      });
      idxsB2.forEach((idx, k) => {
        out2[idx] = { x: margin + (k + 0.5) * (innerW / Math.max(1, idxsB2.length)), y: rowB };
      });
    }
    return out2;
  }
  const groupA = actorLevels[0];
  const idxsA = [], idxsB = [];
  for (let i = 0; i < n; i++) {
    (partition[i] === groupA ? idxsA : idxsB).push(i);
  }
  const gapHalf = bipartite.gapHalf;
  const arcSpan = bipartite.arcSpan;
  const cxA = cx - gapHalf;
  const cxB = cx + gapHalf;
  const r = bipartite.radius ?? Math.min(cx - gapHalf - 60, (height - 100) / 2);
  const out = new Array(n);
  idxsA.forEach((idx, k) => {
    const t = idxsA.length > 1 ? k / (idxsA.length - 1) : 0.5;
    const a = Math.PI + arcSpan - t * (2 * arcSpan);
    out[idx] = { x: cxA + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  idxsB.forEach((idx, k) => {
    const t = idxsB.length > 1 ? k / (idxsB.length - 1) : 0.5;
    const a = -arcSpan + t * (2 * arcSpan);
    out[idx] = { x: cxB + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  return out;
}

// src/htna/mcmlPlot.ts
var MCML_COLOR_PALETTE = [
  "#E69F00",
  "#56B4E9",
  "#009E73",
  "#F0E442",
  "#0072B2",
  "#D55E00",
  "#CC79A7",
  "#999999"
];
var clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
var finite = (x) => Number.isFinite(x);
function matrixView(value, name) {
  if (value instanceof Matrix) {
    if (value.rows !== value.cols) throw new Error(`${name} must be square.`);
    for (const x of value.data) if (!finite(x)) throw new Error(`${name} must contain finite weights.`);
    return value;
  }
  if (!Array.isArray(value) || value.length === 0 || !value.every((row) => Array.isArray(row))) {
    throw new Error(`${name} must be a Matrix or a non-empty numeric matrix.`);
  }
  const n = value.length;
  if (value.some((row) => row.length !== n)) throw new Error(`${name} must be square.`);
  for (const row of value) for (const x of row) {
    if (typeof x !== "number" || !finite(x)) throw new Error(`${name} must contain finite weights.`);
  }
  return { rows: n, cols: n, get: (i, j) => value[i][j] };
}
function arrayFrom(values, n) {
  if (values == null) return new Array(n).fill(0);
  const out = Array.from(values);
  if (out.length !== n || out.some((x) => !finite(x))) throw new Error("MCML inits must be finite and match layer labels.");
  return out;
}
function isMcmlLike(input) {
  return typeof input === "object" && input !== null && "macro" in input && "cluster_members" in input;
}
function normalizeMembers(members, labels) {
  const names = Object.keys(members);
  if (names.length === 0) throw new Error("MCML clusters must contain at least one named cluster.");
  const labelIndex = new Map(labels.map((label, i) => [label, i]));
  const seen = /* @__PURE__ */ new Set();
  const indices = names.map((name) => {
    const nodes = members[name];
    if (!nodes || nodes.length === 0) throw new Error(`MCML cluster "${name}" is empty.`);
    return nodes.map((node) => {
      if (!labelIndex.has(node)) throw new Error(`MCML cluster "${name}" contains unknown node "${node}".`);
      if (seen.has(node)) throw new Error(`MCML node "${node}" belongs to more than one cluster.`);
      seen.add(node);
      return labelIndex.get(node);
    });
  });
  if (seen.size !== labels.length) {
    const missing = labels.filter((label) => !seen.has(label));
    throw new Error(`MCML clusters do not assign: ${missing.join(", ")}.`);
  }
  return { names, indices };
}
function aggregate(values, method) {
  const nonzero = values.filter((x) => x !== 0);
  if (nonzero.length === 0) return 0;
  if (method === "mean") return nonzero.reduce((a, b) => a + b, 0) / nonzero.length;
  if (method === "max") return Math.max(...nonzero);
  return nonzero.reduce((a, b) => a + b, 0);
}
function prepareTna(model, options) {
  if (!options.clusters) throw new Error("plotMCML(): `clusters` is required when input is a TNA model.");
  if (model.weights.rows !== model.labels.length || model.weights.cols !== model.labels.length) {
    throw new Error("plotMCML(): TNA labels and weight dimensions do not match.");
  }
  const { names, indices } = normalizeMembers(options.clusters, model.labels);
  const method = options.aggregation ?? "sum";
  const directed = options.directed ?? model.type !== "co-occurrence";
  const weightAt = (i, j) => directed ? model.weights.get(i, j) : (model.weights.get(i, j) + model.weights.get(j, i)) / 2;
  const macro = new Matrix(names.length, names.length);
  for (let i = 0; i < names.length; i++) for (let j = 0; j < names.length; j++) {
    const values = [];
    for (const a of indices[i]) for (const b of indices[j]) values.push(weightAt(a, b));
    macro.set(i, j, aggregate(values, method));
  }
  const clusters = {};
  for (let c = 0; c < names.length; c++) {
    const name = names[c];
    const idx = indices[c];
    const matrix = new Matrix(idx.length, idx.length);
    for (let i = 0; i < idx.length; i++) for (let j = 0; j < idx.length; j++) {
      matrix.set(i, j, weightAt(idx[i], idx[j]));
    }
    const initTotal = idx.reduce((sum, i) => sum + (model.inits[i] ?? 0), 0);
    const inits = idx.map((i) => initTotal > 0 ? (model.inits[i] ?? 0) / initTotal : 1 / idx.length);
    clusters[name] = { labels: idx.map((i) => model.labels[i]), weights: matrix, inits };
  }
  const macroInits = indices.map((idx) => idx.reduce((sum, i) => sum + (model.inits[i] ?? 0), 0));
  const initSum = macroInits.reduce((a, b) => a + b, 0);
  return {
    macro: { labels: names, weights: macro, inits: initSum > 0 ? macroInits.map((x) => x / initSum) : macroInits.map(() => 1 / names.length) },
    clusters,
    members: options.clusters,
    directed
  };
}
function prepareExisting(input, options) {
  const names = input.macro.labels;
  const macroWeights = matrixView(input.macro.weights, "MCML macro weights");
  if (names.length !== macroWeights.rows) throw new Error("MCML macro labels and weights do not match.");
  const memberNames = Object.keys(input.cluster_members);
  if (memberNames.length !== names.length || names.some((name) => !input.cluster_members[name])) {
    throw new Error("MCML macro labels must match cluster_members names.");
  }
  normalizeMembers(input.cluster_members, memberNames.flatMap((name) => [...input.cluster_members[name]]));
  const clusters = {};
  for (const name of names) {
    const layer = input.clusters?.[name];
    const labels = [...input.cluster_members[name]];
    if (!layer) {
      clusters[name] = { labels, weights: new Matrix(labels.length, labels.length), inits: new Array(labels.length).fill(0) };
      continue;
    }
    const weights = matrixView(layer.weights, `MCML cluster "${name}" weights`);
    if (weights.rows !== labels.length || layer.labels.length !== labels.length || layer.labels.some((x, i) => x !== labels[i])) {
      throw new Error(`MCML cluster "${name}" labels, members, and weights must have identical order.`);
    }
    clusters[name] = { labels, weights, inits: arrayFrom(layer.inits, labels.length) };
  }
  return {
    macro: { labels: [...names], weights: macroWeights, inits: arrayFrom(input.macro.inits, names.length) },
    clusters,
    members: input.cluster_members,
    directed: options.directed ?? input.meta?.directed !== false
  };
}
function edgeWidth(value, max, range) {
  return range[0] + (range[1] - range[0]) * Math.abs(value) / Math.max(max, 1e-12);
}
function roundValue(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
function formatWeight(value, digits) {
  const rounded = roundValue(value, digits);
  if (rounded === 0) return void 0;
  return rounded.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(/^(-?)0\./, "$1.");
}
function shellPoint(shell, target) {
  const angle = Math.atan2((target.y - shell.y) / shell.ry, (target.x - shell.x) / shell.rx);
  return [shell.x + shell.rx * Math.cos(angle), shell.y + shell.ry * Math.sin(angle)];
}
function mcmlPlotData(input, options = {}) {
  const prepared = isMcmlLike(input) ? prepareExisting(input, options) : prepareTna(input, options);
  const {
    width = 960,
    height = 760,
    theme = "classic",
    mode = "weights",
    minimum = 0,
    summaryPie = "inits",
    edgeColorBy = "auto",
    edgePositiveColor = "#2E7D32",
    edgeNegativeColor = "#C62828",
    edgeLabelDigits = 2,
    spacing = 3,
    shapeSize = 1.2,
    summarySize = 4,
    skewAngle = 60,
    topLayerScale = [0.8, 0.25],
    interLayerGap = 0.6,
    nodeRadiusScale = 0.55,
    nodeSize = 2.4,
    edgeWidthRange = [0.3, 1.3],
    betweenEdgeWidthRange = [0.5, 2],
    summaryEdgeWidthRange = [0.5, 2],
    edgeAlpha = 0.35,
    betweenEdgeAlpha = 0.6,
    summaryEdgeAlpha = 0.7,
    interLayerAlpha = 0.5
  } = options;
  if (width <= 0 || height <= 0) throw new Error("MCML plot width and height must be positive.");
  if (minimum < 0) throw new Error("MCML plot minimum must be non-negative.");
  const names = prepared.macro.labels;
  const k = names.length;
  const colors = names.map((_, i) => options.colors?.[i % (options.colors?.length || 1)] ?? MCML_COLOR_PALETTE[i % MCML_COLOR_PALETTE.length]);
  const compress = Math.cos(clamp(skewAngle, 0, 90) * Math.PI / 180);
  const unit = Math.min(width, height) / 8.5;
  const baseX = width / 2;
  const baseY = height * 0.7;
  const angles = names.map((_, i) => Math.PI / 2 - i * 2 * Math.PI / k);
  const shellRx = shapeSize * unit;
  const shellRy = Math.max(10, shellRx * compress);
  const shells = names.map((name, i) => ({
    id: name,
    label: name,
    x: baseX + spacing * unit * Math.cos(angles[i]),
    y: baseY - spacing * unit * Math.sin(angles[i]) * compress,
    rx: shellRx,
    ry: shellRy,
    color: colors[i]
  }));
  const bottomTop = Math.min(...shells.map((shell) => shell.y - shell.ry));
  const topBaseY = bottomTop - spacing * interLayerGap * unit + 42;
  const summaryRadius = Math.max(18, summarySize / 4 * 27);
  const topRx = spacing * topLayerScale[0] * unit;
  const topRy = spacing * topLayerScale[1] * unit;
  const rowTotals = names.map((_, i) => {
    let sum = 0;
    for (let j = 0; j < k; j++) sum += prepared.macro.weights.get(i, j);
    return sum;
  });
  const summaryNodes = names.map((name, i) => ({
    id: `summary:${name}`,
    label: name,
    x: baseX + topRx * Math.cos(angles[i]),
    y: topBaseY - topRy * Math.sin(angles[i]),
    rx: summaryRadius,
    ry: summaryRadius,
    radius: summaryRadius,
    color: colors[i],
    proportion: clamp(summaryPie === "inits" ? prepared.macro.inits[i] ?? 0 : rowTotals[i] > 0 ? prepared.macro.weights.get(i, i) / rowTotals[i] : 0)
  }));
  const shapeValues = Array.isArray(options.nodeShape) ? options.nodeShape : [options.nodeShape ?? "circle"];
  const detailNodes = [];
  for (let c = 0; c < k; c++) {
    const name = names[c];
    const shell = shells[c];
    const layer = prepared.clusters[name];
    const nodeOrbit = shellRx * nodeRadiusScale;
    for (let i = 0; i < layer.labels.length; i++) {
      const angle = layer.labels.length === 1 ? Math.PI / 2 : Math.PI / 2 - i * 2 * Math.PI / layer.labels.length;
      let total = 0;
      for (let j = 0; j < layer.labels.length; j++) total += layer.weights.get(i, j);
      detailNodes.push({
        id: layer.labels[i],
        label: layer.labels[i],
        cluster: name,
        x: shell.x + (layer.labels.length === 1 ? 0 : nodeOrbit * Math.cos(angle)),
        y: shell.y - (layer.labels.length === 1 ? 0 : nodeOrbit * Math.sin(angle) * compress),
        radius: nodeSize * 0.045 * unit,
        color: colors[c],
        shape: shapeValues[detailNodes.length % shapeValues.length],
        selfProportion: clamp(total > 0 ? layer.weights.get(i, i) / total : 0)
      });
    }
  }
  const nodeById = new Map(detailNodes.map((node) => [node.id, node]));
  const hasNegative = (() => {
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) if (prepared.macro.weights.get(i, j) < 0) return true;
    for (const name of names) {
      const w = prepared.clusters[name].weights;
      for (let i = 0; i < w.rows; i++) for (let j = 0; j < w.cols; j++) if (w.get(i, j) < 0) return true;
    }
    return false;
  })();
  const signColors = edgeColorBy === "sign" || edgeColorBy === "auto" && hasNegative;
  const colorFor = (value, clusterColor) => signColors ? value < 0 ? edgeNegativeColor : edgePositiveColor : clusterColor;
  let macroMax = 0, withinMax = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) macroMax = Math.max(macroMax, Math.abs(prepared.macro.weights.get(i, j)));
  for (const name of names) {
    const w = prepared.clusters[name].weights;
    for (let i = 0; i < w.rows; i++) for (let j = 0; j < w.cols; j++) withinMax = Math.max(withinMax, Math.abs(w.get(i, j)));
  }
  const edgeLabels = options.edgeLabels ?? mode === "tna";
  const summaryEdgeLabels = options.summaryEdgeLabels ?? mode === "tna";
  const visible = (weight) => Math.abs(weight) > minimum && roundValue(weight, edgeLabelDigits) !== 0;
  const withinEdges = [];
  for (let c = 0; c < k; c++) {
    const name = names[c];
    const layer = prepared.clusters[name];
    for (let i = 0; i < layer.labels.length; i++) for (let j = 0; j < layer.labels.length; j++) {
      if (!prepared.directed && j < i) continue;
      const weight = layer.weights.get(i, j);
      if (!visible(weight)) continue;
      const from = nodeById.get(layer.labels[i]), to = nodeById.get(layer.labels[j]);
      withinEdges.push({
        id: `within:${name}:${i}:${j}`,
        from: from.id,
        to: to.id,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        weight,
        kind: "within",
        color: colorFor(weight, colors[c]),
        width: edgeWidth(weight, withinMax, edgeWidthRange) * 1.5,
        opacity: edgeAlpha,
        directed: prepared.directed,
        label: edgeLabels ? formatWeight(weight, edgeLabelDigits) : void 0,
        curvature: 0,
        loopRotation: i === j ? Math.atan2(from.y - shells[c].y, from.x - shells[c].x) : void 0
      });
    }
  }
  const betweenEdges = [];
  const summaryEdges = [];
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    if (!prepared.directed && j < i) continue;
    const weight = prepared.macro.weights.get(i, j);
    if (!visible(weight)) continue;
    const sourceSummary = summaryNodes[i], targetSummary = summaryNodes[j];
    const loopRotation = i === j ? Math.atan2(sourceSummary.y - summaryNodes.reduce((s, n) => s + n.y, 0) / k, sourceSummary.x - baseX) : void 0;
    summaryEdges.push({
      id: `summary:${i}:${j}`,
      from: names[i],
      to: names[j],
      fromX: sourceSummary.x,
      fromY: sourceSummary.y,
      toX: targetSummary.x,
      toY: targetSummary.y,
      weight,
      kind: "summary",
      color: colorFor(weight, colors[i]),
      width: edgeWidth(weight, macroMax, summaryEdgeWidthRange) * 1.5,
      opacity: summaryEdgeAlpha,
      directed: prepared.directed && options.summaryArrows !== false,
      label: summaryEdgeLabels ? formatWeight(weight, edgeLabelDigits) : void 0,
      curvature: options.curvedEdges ?? theme !== "classic" ? options.summaryCurve ?? (prepared.directed ? 0.25 : 0) : 0,
      loopRotation
    });
    if (i === j) continue;
    const [x1, y1] = shellPoint(shells[i], shells[j]);
    const [x2, y2] = shellPoint(shells[j], shells[i]);
    betweenEdges.push({
      id: `between:${i}:${j}`,
      from: names[i],
      to: names[j],
      fromX: x1,
      fromY: y1,
      toX: x2,
      toY: y2,
      weight,
      kind: "between",
      color: colorFor(weight, colors[i]),
      width: edgeWidth(weight, macroMax, betweenEdgeWidthRange) * 1.5,
      opacity: betweenEdgeAlpha,
      directed: prepared.directed && options.betweenArrows === true,
      curvature: 0
    });
  }
  const interLayerEdges = detailNodes.map((node, i) => {
    const c = names.indexOf(node.cluster);
    const target = summaryNodes[c];
    return {
      id: `inter-layer:${i}`,
      from: node.id,
      to: node.cluster,
      fromX: node.x,
      fromY: node.y,
      toX: target.x,
      toY: target.y,
      weight: 0,
      kind: "inter-layer",
      color: colors[c],
      width: 1,
      opacity: interLayerAlpha,
      directed: false,
      curvature: 0
    };
  });
  const styled = theme !== "classic";
  return {
    width,
    height,
    directed: prepared.directed,
    theme,
    nodeDonut: options.nodeDonut ?? styled,
    // Macro nodes are painted by the shared tnaj network renderer: a compact
    // solid node plus a thin probability ring, never a large donut.
    summaryDonut: false,
    nodeDonutInnerRatio: clamp(options.nodeDonutInnerRatio ?? 0.55, 0.05, 0.95),
    summaryDonutInnerRatio: clamp(options.summaryDonutInnerRatio ?? 0.6, 0.05, 0.95),
    title: options.title,
    subtitle: options.subtitle,
    shells,
    detailNodes,
    summaryNodes,
    withinEdges,
    betweenEdges,
    summaryEdges,
    interLayerEdges,
    legend: names.map((name, i) => ({ name, color: colors[i] })),
    options: {
      showLabels: options.showLabels ?? true,
      summaryLabels: options.summaryLabels ?? true,
      legend: options.legend ?? true,
      shellAlpha: options.shellAlpha ?? (theme === "light" ? 0.1 : 0.15),
      shellBorderWidth: options.shellBorderWidth ?? (theme === "light" ? 0 : 0.75)
    }
  };
}
function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function arcPath(cx, cy, inner, outer, proportion) {
  const p = clamp(proportion);
  if (p <= 0) return "";
  if (p >= 0.999999) {
    return `M${cx} ${cy - outer}A${outer} ${outer} 0 1 1 ${cx - 1e-3} ${cy - outer}` + (inner > 0 ? `L${cx - 1e-3} ${cy - inner}A${inner} ${inner} 0 1 0 ${cx} ${cy - inner}Z` : `L${cx} ${cy}Z`);
  }
  const start = -Math.PI / 2, end = start + p * 2 * Math.PI;
  const ox1 = cx + outer * Math.cos(start), oy1 = cy + outer * Math.sin(start);
  const ox2 = cx + outer * Math.cos(end), oy2 = cy + outer * Math.sin(end);
  const large = p > 0.5 ? 1 : 0;
  if (inner <= 0) return `M${cx} ${cy}L${ox1} ${oy1}A${outer} ${outer} 0 ${large} 1 ${ox2} ${oy2}Z`;
  const ix2 = cx + inner * Math.cos(end), iy2 = cy + inner * Math.sin(end);
  const ix1 = cx + inner * Math.cos(start), iy1 = cy + inner * Math.sin(start);
  return `M${ox1} ${oy1}A${outer} ${outer} 0 ${large} 1 ${ox2} ${oy2}L${ix2} ${iy2}A${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1}Z`;
}
function loopPath(x, y, nodeRadius, rotation) {
  const r = nodeRadius * 0.8, d = nodeRadius;
  const cx = x + d * Math.cos(rotation), cy = y + d * Math.sin(rotation);
  const alpha = Math.acos(clamp((d * d + r * r - nodeRadius * nodeRadius) / (2 * d * r), -1, 1));
  const start = rotation + Math.PI + alpha, end = rotation + Math.PI - alpha + 2 * Math.PI;
  return `M${cx + r * Math.cos(start)} ${cy + r * Math.sin(start)}A${r} ${r} 0 1 1 ${cx + r * Math.cos(end)} ${cy + r * Math.sin(end)}`;
}
function edgePath(edge, radiusFrom = 0, radiusTo = 0) {
  if (edge.from === edge.to || edge.fromX === edge.toX && edge.fromY === edge.toY) {
    const rotation = edge.loopRotation ?? -Math.PI / 2;
    const r = Math.max(radiusFrom, 8);
    return { path: loopPath(edge.fromX, edge.fromY, r, rotation), lx: edge.fromX + 2.3 * r * Math.cos(rotation), ly: edge.fromY + 2.3 * r * Math.sin(rotation) };
  }
  const dx = edge.toX - edge.fromX, dy = edge.toY - edge.fromY, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const x1 = edge.fromX + ux * radiusFrom, y1 = edge.fromY + uy * radiusFrom;
  const x2 = edge.toX - ux * radiusTo, y2 = edge.toY - uy * radiusTo;
  const labelT = edge.directed ? 0.7 : 0.5;
  if (edge.curvature === 0) return {
    path: `M${x1} ${y1}L${x2} ${y2}`,
    lx: x1 + (x2 - x1) * labelT,
    ly: y1 + (y2 - y1) * labelT
  };
  const px = -uy, py = ux, bend = len * edge.curvature;
  const cx = (x1 + x2) / 2 + px * bend, cy = (y1 + y2) / 2 + py * bend;
  return {
    path: `M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}`,
    lx: (1 - labelT) ** 2 * x1 + 2 * (1 - labelT) * labelT * cx + labelT ** 2 * x2,
    ly: (1 - labelT) ** 2 * y1 + 2 * (1 - labelT) * labelT * cy + labelT ** 2 * y2
  };
}
var svgId = 0;
function plotMCML(input, options = {}) {
  const data = mcmlPlotData(input, options);
  const marker = `mcml-arrow-${++svgId}`;
  const nodeById = new Map(data.detailNodes.map((node) => [node.id, node]));
  const summaryById = new Map(data.summaryNodes.map((node) => [node.label, node]));
  let body = `<defs><marker id="${marker}" viewBox="0 0 7 6" refX="6.4" refY="3" markerWidth="5" markerHeight="4.3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L7 3L0 6Z" fill="context-stroke"/></marker></defs>`;
  const renderEdge = (edge, radiusFrom = 0, radiusTo = 0, dash = false) => {
    const geometry = edgePath(edge, radiusFrom, radiusTo);
    return `<path class="mcml-edge mcml-edge-${edge.kind}" data-from="${esc(edge.from)}" data-to="${esc(edge.to)}" data-weight="${edge.weight}" d="${geometry.path}" fill="none" stroke="${esc(edge.color)}" stroke-width="${edge.width}" stroke-opacity="${edge.opacity}" stroke-linecap="round"${dash ? ' stroke-dasharray="6 5"' : ""}${edge.directed ? ` marker-end="url(#${marker})"` : ""}/>` + (edge.label ? `<text class="mcml-edge-label" data-from="${esc(edge.from)}" data-to="${esc(edge.to)}" x="${geometry.lx}" y="${geometry.ly - 4}" text-anchor="middle">${esc(edge.label)}</text>` : "");
  };
  const interLayerGuides = data.shells.map((shell) => {
    const summary = summaryById.get(shell.id);
    const dx = shell.x - summary.x, dy = shell.y - summary.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length, uy = dy / length;
    const sourceRadius = summary.radius + 6;
    const sourceX = summary.x + ux * sourceRadius;
    const sourceY = summary.y + uy * sourceRadius;
    const [targetX, targetY] = shellPoint(shell, {
      ...shell,
      x: summary.x,
      y: summary.y
    });
    return `<path class="mcml-edge mcml-edge-inter-layer mcml-cluster-guide" data-cluster="${esc(shell.id)}" d="M${sourceX} ${sourceY}L${targetX} ${targetY}" fill="none" stroke="${esc(shell.color)}" stroke-width="1" stroke-opacity="${data.interLayerEdges.find((edge) => edge.to === shell.id)?.opacity ?? 0.5}" stroke-dasharray="6 5"/>`;
  }).join("");
  body += `<g class="mcml-inter-layer">${interLayerGuides}</g>`;
  const summaryPairSet = new Set(data.summaryEdges.filter((edge) => edge.from !== edge.to).map((edge) => `${edge.from}\0${edge.to}`));
  const summaryCenterX = data.summaryNodes.reduce((sum, node) => sum + node.x, 0) / data.summaryNodes.length;
  const summaryCenterY = data.summaryNodes.reduce((sum, node) => sum + node.y, 0) / data.summaryNodes.length;
  const renderSummaryEdge = (edge) => {
    const from = summaryById.get(edge.from), to = summaryById.get(edge.to);
    const paintedRadius = from.radius + 6;
    const geometry = edge.from === edge.to ? networkSelfLoopGeometry(
      from.x,
      from.y,
      paintedRadius,
      Math.atan2(from.y - summaryCenterY, from.x - summaryCenterX)
    ) : networkEdgeGeometry(
      from.x,
      from.y,
      to.x,
      to.y,
      paintedRadius,
      to.radius + 6,
      summaryPairSet.has(`${edge.to}\0${edge.from}`) ? Math.min(22, Math.hypot(to.x - from.x, to.y - from.y) * 0.14) : 0
    );
    if (!geometry.path) return "";
    const labelY = geometry.labelY + (edge.from === edge.to ? 3 : -4);
    return `<path class="mcml-edge mcml-edge-summary" data-from="${esc(edge.from)}" data-to="${esc(edge.to)}" data-weight="${edge.weight}" d="${geometry.path}" fill="none" stroke="${esc(edge.color)}" stroke-width="${edge.width}" stroke-opacity="${edge.opacity}" stroke-linecap="round"/>` + (edge.directed ? `<polygon class="mcml-summary-arrow" points="${networkArrowPolygon(geometry.tipX, geometry.tipY, geometry.tipDx, geometry.tipDy)}" fill="${esc(edge.color)}" fill-opacity="${Math.min(1, edge.opacity + 0.18)}"/>` : "") + (edge.label ? `<text class="mcml-edge-label" x="${geometry.labelX}" y="${labelY}" text-anchor="middle">${esc(edge.label)}</text>` : "");
  };
  body += '<g class="mcml-summary-edges">' + data.summaryEdges.map(renderSummaryEdge).join("") + "</g>";
  body += '<g class="mcml-between-edges">' + data.betweenEdges.map((edge) => renderEdge(edge)).join("") + "</g>";
  body += '<g class="mcml-shells">' + data.shells.map((shell) => `<ellipse class="mcml-shell" data-cluster="${esc(shell.id)}" cx="${shell.x}" cy="${shell.y}" rx="${shell.rx}" ry="${shell.ry}" fill="${esc(shell.color)}" fill-opacity="${data.options.shellAlpha}" stroke="${esc(shell.color)}" stroke-width="${data.options.shellBorderWidth}"/>`).join("") + "</g>";
  const withinByDirection = new Map(data.withinEdges.map((edge) => [`${edge.from}\0${edge.to}`, edge]));
  const renderedWithinPairs = /* @__PURE__ */ new Set();
  const renderReciprocalWithin = (forward, reverse) => {
    const source = nodeById.get(forward.from), target = nodeById.get(forward.to);
    const dx = target.x - source.x, dy = target.y - source.y, length = Math.hypot(dx, dy) || 1;
    const ux = dx / length, uy = dy / length;
    const sourceX = source.x + ux * source.radius, sourceY = source.y + uy * source.radius;
    const targetX = target.x - ux * target.radius, targetY = target.y - uy * target.radius;
    const midX = (sourceX + targetX) / 2, midY = (sourceY + targetY) / 2;
    const half = (edge, endX, endY) => {
      const labelX = midX + (endX - midX) * 0.42;
      const labelY = midY + (endY - midY) * 0.42 - 4;
      return `<path class="mcml-edge mcml-edge-within mcml-edge-reciprocal-half" data-from="${esc(edge.from)}" data-to="${esc(edge.to)}" data-weight="${edge.weight}" d="M${midX} ${midY}L${endX} ${endY}" fill="none" stroke="${esc(edge.color)}" stroke-width="${edge.width}" stroke-opacity="${edge.opacity}" stroke-linecap="round" marker-end="url(#${marker})"/>` + (edge.label ? `<text class="mcml-edge-label" data-from="${esc(edge.from)}" data-to="${esc(edge.to)}" x="${labelX}" y="${labelY}" text-anchor="middle">${esc(edge.label)}</text>` : "");
    };
    return `<g class="mcml-reciprocal-edge" data-pair="${esc([forward.from, forward.to].sort().join("\u2194"))}">` + half(forward, targetX, targetY) + half(reverse, sourceX, sourceY) + "</g>";
  };
  let withinBody = "";
  for (const edge of data.withinEdges) {
    const pairKey = edge.from < edge.to ? `${edge.from}\0${edge.to}` : `${edge.to}\0${edge.from}`;
    const reverse = edge.from !== edge.to ? withinByDirection.get(`${edge.to}\0${edge.from}`) : void 0;
    if (edge.directed && reverse) {
      if (renderedWithinPairs.has(pairKey)) continue;
      renderedWithinPairs.add(pairKey);
      withinBody += renderReciprocalWithin(edge, reverse);
    } else {
      const from = nodeById.get(edge.from), to = nodeById.get(edge.to);
      withinBody += renderEdge(edge, from.radius, to.radius);
    }
  }
  body += `<g class="mcml-within-edges">${withinBody}</g>`;
  const renderPie = (x, y, r, p, color, donut, innerRatio, bg, cls) => {
    const inner = donut ? r * innerRatio : 0;
    return `<g class="${cls}"><circle cx="${x}" cy="${y}" r="${r}" fill="${esc(bg)}" stroke="#555" stroke-width="1"/>` + (p > 0 ? `<path d="${arcPath(x, y, inner, r, p)}" fill="${esc(color)}"/>` : "") + (donut ? `<circle cx="${x}" cy="${y}" r="${inner}" fill="#fff"/>` : "") + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#555" stroke-width="1"/></g>`;
  };
  body += '<g class="mcml-detail-nodes">';
  for (const node of data.detailNodes) {
    if (node.shape === "circle") body += renderPie(node.x, node.y, node.radius, node.selfProportion, node.color, data.nodeDonut, data.nodeDonutInnerRatio, "#e5e7eb", "mcml-detail-node");
    else if (node.shape === "square") body += `<rect class="mcml-detail-node" x="${node.x - node.radius}" y="${node.y - node.radius}" width="${2 * node.radius}" height="${2 * node.radius}" fill="${esc(node.color)}" stroke="#555"/>`;
    else if (node.shape === "diamond") body += `<path class="mcml-detail-node" d="M${node.x} ${node.y - node.radius}L${node.x + node.radius} ${node.y}L${node.x} ${node.y + node.radius}L${node.x - node.radius} ${node.y}Z" fill="${esc(node.color)}" stroke="#555"/>`;
    else body += `<path class="mcml-detail-node" d="M${node.x} ${node.y - node.radius}L${node.x + node.radius} ${node.y + node.radius}L${node.x - node.radius} ${node.y + node.radius}Z" fill="${esc(node.color)}" stroke="#555"/>`;
    if (data.options.showLabels) {
      const shell = data.shells.find((x) => x.id === node.cluster);
      const side = node.x >= shell.x ? 1 : -1;
      body += `<text class="mcml-node-label" x="${node.x + side * (node.radius + 5)}" y="${node.y + 4}" text-anchor="${side > 0 ? "start" : "end"}">${esc(node.label)}</text>`;
    }
  }
  body += '</g><g class="mcml-summary-nodes">';
  for (const node of data.summaryNodes) {
    const ringInner = node.radius + 2;
    const ringOuter = node.radius + 6;
    body += `<g class="mcml-summary-node" data-cluster="${esc(node.label)}"><circle cx="${node.x}" cy="${node.y}" r="${ringOuter}" fill="#e5e7eb"/>` + (node.proportion > 0 ? `<path d="${arcPath(node.x, node.y, ringInner, ringOuter, node.proportion)}" fill="${esc(node.color)}"/>` : "") + `<circle cx="${node.x}" cy="${node.y}" r="${node.radius}" fill="${esc(node.color)}" stroke="#777" stroke-width="1.5"/>`;
    if (data.options.summaryLabels) {
      body += `<text class="mcml-summary-label mcml-summary-label-inside" x="${node.x}" y="${node.y + 3.5}" text-anchor="middle">${esc(node.label)}</text>`;
    }
    body += "</g>";
  }
  body += "</g>";
  if (data.options.legend) {
    const lx = data.width - 145, ly = data.height - 28 - data.legend.length * 22;
    body += `<g class="mcml-legend" transform="translate(${lx} ${ly})"><text class="mcml-legend-title" font-weight="700">Clusters</text>`;
    data.legend.forEach((entry, i) => {
      body += `<circle cx="8" cy="${22 + i * 22}" r="7" fill="${esc(entry.color)}"/><text x="22" y="${26 + i * 22}">${esc(entry.name)}</text>`;
    });
    body += "</g>";
  }
  if (data.title) body += `<text class="mcml-title" x="${data.width / 2}" y="25" text-anchor="middle">${esc(data.title)}</text>`;
  if (data.subtitle) body += `<text class="mcml-subtitle" x="${data.width / 2}" y="45" text-anchor="middle">${esc(data.subtitle)}</text>`;
  const label = data.title ?? "Multi-cluster multi-layer network";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.width} ${data.height}" width="${data.width}" height="${data.height}" role="img" aria-label="${esc(label)}"><style>
    .mcml-title{font:700 18px system-ui,sans-serif}.mcml-subtitle{font:12px system-ui,sans-serif;fill:#666}
    .mcml-node-label,.mcml-summary-label,.mcml-edge-label,.mcml-legend text{font:11px system-ui,sans-serif;fill:#333;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}.mcml-summary-label{font-weight:650}.mcml-summary-label-inside{font-size:10px;stroke-width:2.5px}.mcml-edge-label{font-size:10px}.mcml-legend-title{font:700 11px system-ui,sans-serif;fill:#555}
  </style>${body}</svg>`;
}
var plot_mcml = plotMCML;
var mcml_plot_data = mcmlPlotData;

export { HTNA_COLOR_PALETTE, HTNA_SHAPE_PALETTE, MCML_COLOR_PALETTE, bootstrapHtna, diffNetworks, extractMetaPaths, formatPaths, htna, htnaFromLong, htnaPlotData, mcmlPlotData, mcml_plot_data, plotMCML, plot_mcml, sequencePlotHtnaData };
//# sourceMappingURL=chunk-L4NYFGX5.js.map
//# sourceMappingURL=chunk-L4NYFGX5.js.map