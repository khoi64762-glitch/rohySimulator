// src/sequences/prepare.ts
function prepareSequenceData(data) {
  const stateSet = /* @__PURE__ */ new Set();
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (v != null && v !== "") {
        stateSet.add(v);
      }
    }
  }
  const alphabet = [...stateSet].sort();
  const stateToIndex = /* @__PURE__ */ new Map();
  for (let i = 0; i < alphabet.length; i++) {
    stateToIndex.set(alphabet[i], i + 1);
  }
  const sequences = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const coded = new Array(row.length);
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (v != null && v !== "") {
        coded[j] = stateToIndex.get(v);
      } else {
        coded[j] = NaN;
      }
    }
    sequences.push(coded);
  }
  return { sequences, alphabet };
}
function rle(arr) {
  if (arr.length === 0) return { values: [], lengths: [] };
  const values = [];
  const lengths = [];
  let current = arr[0];
  let len = 1;
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    const same = current === v;
    if (same) {
      len++;
    } else {
      values.push(current);
      lengths.push(len);
      current = v;
      len = 1;
    }
  }
  values.push(current);
  lengths.push(len);
  return { values, lengths };
}
function extractLast(sequences, alphabet) {
  const n = sequences.length;
  const k = sequences[0]?.length ?? 0;
  const group = [];
  const lastVals = /* @__PURE__ */ new Set();
  const lastObs = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = sequences[i];
    let last = 0;
    for (let j = 0; j < k; j++) {
      if (!isNaN(row[j])) last = j;
    }
    lastObs[i] = last;
    const val = row[last];
    group.push(alphabet[val - 1]);
    lastVals.add(val);
  }
  const newAlphabet = alphabet.filter((_, i) => !lastVals.has(i + 1));
  const valMap = new Array(alphabet.length + 1).fill(NaN);
  let idx = 1;
  for (let i = 0; i < alphabet.length; i++) {
    if (!lastVals.has(i + 1)) {
      valMap[i + 1] = idx++;
    }
  }
  const newSeqs = [];
  for (let i = 0; i < n; i++) {
    const row = sequences[i];
    const newRow = new Array(k);
    for (let j = 0; j < k; j++) {
      const v = row[j];
      if (isNaN(v) || lastVals.has(v)) {
        newRow[j] = NaN;
      } else {
        newRow[j] = valMap[v];
      }
    }
    newRow[lastObs[i]] = NaN;
    newSeqs.push(newRow);
  }
  return { sequences: newSeqs, alphabet: newAlphabet, group };
}

// src/sequences/convert.ts
function convert(data, format = "frequency") {
  const prepared = prepareSequenceData(data);
  const { sequences, alphabet } = prepared;
  const n = sequences.length;
  const a = alphabet.length;
  if (format === "frequency") {
    return convertFrequency(sequences, alphabet, n, a, false);
  }
  if (format === "onehot") {
    return convertFrequency(sequences, alphabet, n, a, true);
  }
  if (format === "edgelist") {
    return convertEdgelist(sequences, alphabet, n);
  }
  return convertReverse(sequences, alphabet, n);
}
function convertFrequency(sequences, alphabet, n, a, binary) {
  const ids = [];
  const matrix = [];
  for (let i = 0; i < n; i++) {
    ids.push(i + 1);
    const counts = new Array(a).fill(0);
    const row = sequences[i];
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (!isNaN(v)) {
        counts[v - 1]++;
      }
    }
    if (binary) {
      for (let k = 0; k < a; k++) {
        counts[k] = counts[k] > 0 ? 1 : 0;
      }
    }
    matrix.push(counts);
  }
  return { ids, states: [...alphabet], matrix };
}
function convertEdgelist(sequences, alphabet, n) {
  const result = [];
  for (let i = 0; i < n; i++) {
    const row = sequences[i];
    const valid = [];
    for (let j = 0; j < row.length; j++) {
      if (!isNaN(row[j])) valid.push(row[j]);
    }
    for (let j = 0; j < valid.length - 1; j++) {
      result.push({
        id: i + 1,
        from: alphabet[valid[j] - 1],
        to: alphabet[valid[j + 1] - 1]
      });
    }
  }
  return result;
}
function convertReverse(sequences, alphabet, n) {
  const result = [];
  for (let i = 0; i < n; i++) {
    const row = sequences[i];
    const valid = [];
    for (let j = 0; j < row.length; j++) {
      if (!isNaN(row[j])) valid.push(row[j]);
    }
    for (let j = 1; j < valid.length; j++) {
      result.push({
        id: i + 1,
        state: alphabet[valid[j] - 1],
        previous: alphabet[valid[j - 1] - 1]
      });
    }
  }
  return result;
}

// src/sequences/stats.ts
function lgamma(x) {
  if (x <= 0) return Infinity;
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
  let sum = c[0];
  for (let i = 1; i < 9; i++) {
    sum += c[i] / (x + i - 1);
  }
  const t = x + 6.5;
  return 0.5 * Math.log(2 * Math.PI) + (x - 0.5) * Math.log(t) - t + Math.log(sum);
}
function gammaPSeries(a, x) {
  if (x === 0) return 0;
  const maxIter = 200;
  const eps = 1e-15;
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n <= maxIter; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * eps) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
}
function gammaQCF(a, x) {
  const maxIter = 200;
  const eps = 1e-15;
  const tiny = 1e-30;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= maxIter; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }
  return h * Math.exp(-x + a * Math.log(x) - lgamma(a));
}
function gammaQ(a, x) {
  if (x < 0) return 1;
  if (x === 0) return 1;
  if (a === 0) return 0;
  if (x < a + 1) {
    return 1 - gammaPSeries(a, x);
  }
  return gammaQCF(a, x);
}
function chiSqUpperTail(x, df) {
  if (x <= 0) return 1;
  if (df <= 0) return NaN;
  return gammaQ(df / 2, x / 2);
}

// src/sequences/indices.ts
function sequenceTransitions(sequences, a) {
  const n = sequences.length;
  const k = sequences[0]?.length ?? 0;
  const trans = [];
  for (let i = 0; i < n; i++) {
    const mat = [];
    for (let r = 0; r < a; r++) {
      mat.push(new Array(a).fill(0));
    }
    trans.push(mat);
  }
  for (let t = 0; t < k - 1; t++) {
    for (let i = 0; i < n; i++) {
      const from = sequences[i][t];
      const to = sequences[i][t + 1];
      if (!isNaN(from) && !isNaN(to)) {
        trans[i][from - 1][to - 1]++;
      }
    }
  }
  return trans;
}
function cyclicStrength(sequences, n, k, lastObs) {
  const maxStr = new Array(n).fill(0);
  for (let lag = 2; lag <= k - 1; lag++) {
    const strength = new Array(n).fill(0);
    for (let j = 0; j < k - lag; j++) {
      for (let i = 0; i < n; i++) {
        const from = sequences[i][j];
        const to = sequences[i][j + lag];
        if (!isNaN(from) && !isNaN(to) && from === to) {
          strength[i]++;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const lo = lastObs[i] + 1;
      if (lo > lag) {
        strength[i] = strength[i] / (lo - lag);
        if (strength[i] > maxStr[i]) {
          maxStr[i] = strength[i];
        }
      }
    }
  }
  return maxStr;
}
function sequenceIndices(data, options) {
  const prepared = prepareSequenceData(data);
  const { sequences, alphabet } = prepared;
  const a = alphabet.length;
  const n = sequences.length;
  const k = sequences[0]?.length ?? 0;
  const trans = sequenceTransitions(sequences, a);
  const fav = [];
  if (options?.favorable) {
    for (const f of options.favorable) {
      const idx = alphabet.indexOf(f);
      if (idx >= 0) fav.push(idx + 1);
    }
  }
  const omega = options?.omega ?? 1;
  const allVals = /* @__PURE__ */ new Set();
  let hasNaN = false;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      const v = sequences[i][j];
      if (isNaN(v)) {
        hasNaN = true;
      } else {
        allVals.add(v);
      }
    }
  }
  const uVals = allVals.size + (hasNaN ? 1 : 0);
  const lastObs = new Array(n);
  for (let i = 0; i < n; i++) {
    let last = 0;
    for (let j = 0; j < k; j++) {
      if (!isNaN(sequences[i][j])) last = j;
    }
    lastObs[i] = last;
  }
  const cyclic = cyclicStrength(sequences, n, k, lastObs);
  const results = [];
  for (let i = 0; i < n; i++) {
    const row = sequences[i];
    const p = lastObs[i] + 1;
    let validN = 0;
    for (let j = 0; j < k; j++) {
      if (!isNaN(row[j])) validN++;
    }
    const freq = new Array(a).fill(0);
    for (let j = 0; j < k; j++) {
      const v = row[j];
      if (!isNaN(v)) freq[v - 1]++;
    }
    const prop = freq.map((f) => f / validN);
    const runs = rle(row);
    const obsValues = [];
    const obsSpells = [];
    for (let j = 0; j < runs.values.length; j++) {
      if (!isNaN(runs.values[j])) {
        obsValues.push(runs.values[j]);
        obsSpells.push(runs.lengths[j]);
      }
    }
    const meanSpell = obsSpells.length > 0 ? obsSpells.reduce((s, v) => s + v, 0) / obsSpells.length : 0;
    const maxSpell = obsSpells.length > 0 ? Math.max(...obsSpells) : 0;
    let uStates = 0;
    for (let j = 0; j < a; j++) {
      if (freq[j] > 0) uStates++;
    }
    let longEnt = 0;
    for (let j = 0; j < a; j++) {
      if (prop[j] > 0) {
        longEnt -= prop[j] * Math.log(prop[j]);
      }
    }
    longEnt = uVals > 1 ? longEnt / Math.log(uVals) : 0;
    let simpson = 0;
    for (let j = 0; j < a; j++) {
      simpson += prop[j] * prop[j];
    }
    simpson = 1 - simpson;
    const transMat = trans[i];
    let self = 0;
    for (let j = 0; j < a; j++) {
      self += transMat[j][j];
    }
    let total = 0;
    for (let r = 0; r < a; r++) {
      for (let c = 0; c < a; c++) {
        total += transMat[r][c];
      }
    }
    const loops = total > 0 ? self / total : 0;
    const rate = validN > 1 ? (total - self) / (validN - 1) : 0;
    let nonSelfUsed = 0;
    for (let r = 0; r < a; r++) {
      for (let c = 0; c < a; c++) {
        if (r !== c) {
          if (transMat[r][c] > 0) nonSelfUsed++;
        }
      }
    }
    const transComp = a > 1 ? nonSelfUsed / (a * (a - 1)) : 0;
    const initState = row[0];
    let initPer;
    let firstDiff = -1;
    for (let j = 1; j < k; j++) {
      if (isNaN(row[j]) || row[j] !== initState) {
        firstDiff = j;
        break;
      }
    }
    if (firstDiff === -1) {
      initPer = 1;
    } else {
      initPer = firstDiff / p;
    }
    const initProp = !isNaN(initState) ? prop[initState - 1] : 0;
    const firstThirdEnd = Math.ceil(p / 3);
    const lastThirdStart = Math.ceil(2 * p / 3);
    let earlyCount = 0;
    let earlyTotal = 0;
    for (let j = 0; j < firstThirdEnd; j++) {
      earlyTotal++;
      if (!isNaN(row[j]) && row[j] === initState) earlyCount++;
    }
    let lateCount = 0;
    let lateTotal = 0;
    for (let j = lastThirdStart - 1; j < p; j++) {
      lateTotal++;
      if (!isNaN(row[j]) && row[j] === initState) lateCount++;
    }
    const early = earlyTotal > 0 ? earlyCount / earlyTotal : 0;
    const late = lateTotal > 0 ? lateCount / lateTotal : 0;
    const initDecay = early - late;
    const firstState = !isNaN(initState) ? alphabet[initState - 1] : "";
    const lastState = !isNaN(row[lastObs[i]]) ? alphabet[row[lastObs[i]] - 1] : "";
    let domIdx = 0;
    let domFreq = freq[0];
    for (let j = 1; j < a; j++) {
      if (freq[j] > domFreq) {
        domIdx = j;
        domFreq = freq[j];
      }
    }
    const domState = alphabet[domIdx];
    const domProp = prop[domIdx];
    let domSpell = 0;
    for (let j = 0; j < obsValues.length; j++) {
      if (obsValues[j] === domIdx + 1 && obsSpells[j] > domSpell) {
        domSpell = obsSpells[j];
      }
    }
    let emergentState = null;
    let emergentPer = null;
    let emergentProp = null;
    const persisting = obsSpells.filter((s) => s >= 3);
    if (persisting.length > 0) {
      let trueState = 0;
      let trueSpell = 0;
      for (let j = 0; j < obsValues.length; j++) {
        if (obsSpells[j] >= 3 && obsSpells[j] > domSpell) {
          if (obsSpells[j] > trueSpell) {
            trueState = obsValues[j];
            trueSpell = obsSpells[j];
          }
        }
      }
      const domEmergent = domSpell >= 3 && domIdx + 1 !== initState;
      const initSpellLen = obsSpells.length > 0 ? obsSpells[0] : 0;
      let maxInitSpell = 0;
      for (let j = 1; j < obsValues.length; j++) {
        if (obsValues[j] === initState && obsSpells[j] > maxInitSpell) {
          maxInitSpell = obsSpells[j];
        }
      }
      const initEmergent = maxInitSpell * 2 > initSpellLen && maxInitSpell >= 3;
      const candidates = [trueState, domIdx + 1, initState];
      const spellsCandidates = [
        trueSpell,
        domEmergent ? domSpell : 0,
        initEmergent ? maxInitSpell : 0
      ];
      let maxVal = 0;
      let maxIdx = -1;
      for (let j = 0; j < 3; j++) {
        if (spellsCandidates[j] > maxVal) {
          maxVal = spellsCandidates[j];
          maxIdx = j;
        }
      }
      if (maxIdx >= 0 && maxVal > 0) {
        const cand = candidates[maxIdx];
        emergentState = !isNaN(cand) ? alphabet[cand - 1] : null;
        emergentPer = maxVal;
        emergentProp = !isNaN(cand) ? prop[cand - 1] : null;
      }
    }
    const normEnt = a > 1 ? longEnt / Math.log(a) : 0;
    let nonSelfSum = 0;
    for (let r = 0; r < a; r++) {
      for (let c = 0; c < a; c++) {
        if (r !== c) nonSelfSum += transMat[r][c];
      }
    }
    const transDensity = p > 1 ? nonSelfSum / (p - 1) : 0;
    let spellCV;
    if (obsSpells.length <= 1) {
      spellCV = NaN;
    } else if (meanSpell > 0) {
      let sumSq = 0;
      for (const s of obsSpells) {
        sumSq += (s - meanSpell) * (s - meanSpell);
      }
      const spellSd = Math.sqrt(sumSq / (obsSpells.length - 1));
      spellCV = Math.min(spellSd / meanSpell, 1);
    } else {
      spellCV = 0;
    }
    const compIdx = 0.4 * normEnt + 0.4 * transDensity + 0.2 * spellCV;
    let intPot;
    if (fav.length > 0) {
      let sumW = 0;
      let sumPosW = 0;
      const favSet = new Set(fav);
      for (let j = 0; j < p; j++) {
        const w = Math.pow(j + 1, omega);
        sumW += w;
        if (!isNaN(row[j]) && favSet.has(row[j])) {
          sumPosW += w;
        }
      }
      intPot = sumW > 0 ? sumPosW / sumW : 0;
    }
    const result = {
      validN,
      validProportion: validN / p,
      uniqueStates: uStates,
      meanSpellDuration: meanSpell,
      maxSpellDuration: maxSpell,
      longitudinalEntropy: longEnt,
      simpsonDiversity: simpson,
      selfLoopTendency: loops,
      transitionRate: rate,
      transitionComplexity: transComp,
      initialStatePersistence: initPer,
      initialStateProportion: initProp,
      initialStateInfluenceDecay: initDecay,
      cyclicFeedbackStrength: cyclic[i],
      firstState,
      lastState,
      dominantState: domState,
      dominantProportion: domProp,
      dominantMaxSpell: domSpell,
      emergentState,
      emergentStatePersistence: emergentPer,
      emergentStateProportion: emergentProp,
      complexityIndex: compIdx
    };
    if (intPot !== void 0) {
      result.integrativePotential = intPot;
    }
    results.push(result);
  }
  return results;
}

// src/sequences/discover.ts
function extractNgrams(sequences, alphabet, len) {
  const n = sequences.length;
  const m = sequences[0]?.length ?? 0;
  const results = [];
  for (const j of len) {
    if (j > m) {
      results.push({ patterns: Array.from({ length: n }, () => []), length: j });
      continue;
    }
    const cols = m - j + 1;
    const tmp = Array.from(
      { length: n },
      () => new Array(cols).fill("")
    );
    for (let pos = 0; pos < cols; pos++) {
      for (let i = 0; i < n; i++) {
        const row = sequences[i];
        let valid = true;
        const parts = [];
        for (let d = 0; d < j; d++) {
          const v = row[pos + d];
          if (isNaN(v)) {
            valid = false;
            break;
          }
          parts.push(alphabet[v - 1]);
        }
        if (valid) {
          tmp[i][pos] = parts.join("->");
        }
      }
    }
    results.push({ patterns: tmp, length: j });
  }
  return results;
}
function extractGapped(sequences, alphabet, gap) {
  const n = sequences.length;
  const m = sequences[0]?.length ?? 0;
  const results = [];
  for (const g of gap) {
    const cols = m - g;
    const tmp = Array.from(
      { length: n },
      () => new Array(cols).fill("")
    );
    const wildcards = "*".repeat(g);
    const sep = `->${wildcards}->`;
    for (let pos = 0; pos < m - g - 1; pos++) {
      for (let i = 0; i < n; i++) {
        const row = sequences[i];
        const from = row[pos];
        const to = row[pos + g + 1];
        if (!isNaN(from) && !isNaN(to)) {
          tmp[i][pos] = `${alphabet[from - 1]}${sep}${alphabet[to - 1]}`;
        }
      }
    }
    results.push({ patterns: tmp, length: g + 2 });
  }
  return results;
}
function extractRepeated(sequences, alphabet, len) {
  const n = sequences.length;
  const m = sequences[0]?.length ?? 0;
  const results = [];
  for (const j of len) {
    if (j > m) {
      results.push({ patterns: Array.from({ length: n }, () => []), length: j });
      continue;
    }
    const cols = m - j + 1;
    const tmp = Array.from(
      { length: n },
      () => new Array(cols).fill("")
    );
    for (let pos = 0; pos < cols; pos++) {
      for (let i = 0; i < n; i++) {
        const row = sequences[i];
        let valid = true;
        let allSame = true;
        const first = row[pos];
        if (isNaN(first)) {
          continue;
        }
        const parts = [alphabet[first - 1]];
        for (let d = 1; d < j; d++) {
          const v = row[pos + d];
          if (isNaN(v)) {
            valid = false;
            break;
          }
          if (v !== first) {
            allSame = false;
            break;
          }
          parts.push(alphabet[v - 1]);
        }
        if (valid && allSame) {
          tmp[i][pos] = parts.join("->");
        }
      }
    }
    results.push({ patterns: tmp, length: j });
  }
  return results;
}
function searchPattern(sequences, alphabet, pattern) {
  const n = sequences.length;
  const m = sequences[0]?.length ?? 0;
  const states = pattern.split("->");
  const wildcards = states.map((s) => /^\*+$/.test(s));
  let totalLen = states.length;
  const fixedPositions = [];
  const fixedStates = [];
  if (wildcards.some((w) => w)) {
    let pos = 0;
    for (let i = 0; i < states.length; i++) {
      if (wildcards[i]) {
        pos += states[i].length;
      } else {
        fixedPositions.push(pos);
        fixedStates.push(states[i]);
        pos++;
      }
    }
    totalLen = pos;
  } else {
    for (let i = 0; i < states.length; i++) {
      fixedPositions.push(i);
      fixedStates.push(states[i]);
    }
  }
  if (totalLen > m) {
    return [{ patterns: Array.from({ length: n }, () => []), length: totalLen }];
  }
  const cols = m - totalLen + 1;
  const discovered = Array.from(
    { length: n },
    () => new Array(cols).fill("")
  );
  for (let pos = 0; pos < cols; pos++) {
    for (let i = 0; i < n; i++) {
      const row = sequences[i];
      let anyNaN = false;
      for (let d = 0; d < totalLen; d++) {
        if (isNaN(row[pos + d])) {
          anyNaN = true;
          break;
        }
      }
      if (anyNaN) continue;
      let match = true;
      for (let f = 0; f < fixedPositions.length; f++) {
        if (alphabet[row[pos + fixedPositions[f]] - 1] !== fixedStates[f]) {
          match = false;
          break;
        }
      }
      if (match) {
        const parts = [];
        for (let d = 0; d < totalLen; d++) {
          parts.push(alphabet[row[pos + d] - 1]);
        }
        discovered[i][pos] = parts.join("->");
      }
    }
  }
  return [{ patterns: discovered, length: totalLen }];
}
function formatPatterns(extracted) {
  const results = [];
  for (const item of extracted) {
    const patMat = item.patterns;
    const n = patMat.length;
    const allPats = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < patMat[i].length; j++) {
        const p = patMat[i][j];
        if (p !== "") allPats.push(p);
      }
    }
    if (allPats.length === 0) {
      results.push({
        matrix: Array.from({ length: n }, () => []),
        unique: [],
        length: item.length
      });
      continue;
    }
    const unique = [...new Set(allPats)];
    const patIdx = /* @__PURE__ */ new Map();
    for (let i = 0; i < unique.length; i++) {
      patIdx.set(unique[i], i);
    }
    const matrix = Array.from(
      { length: n },
      () => new Array(unique.length).fill(0)
    );
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < patMat[i].length; j++) {
        const p = patMat[i][j];
        if (p !== "") {
          matrix[i][patIdx.get(p)]++;
        }
      }
    }
    results.push({ matrix, unique, length: item.length });
  }
  return results;
}
function stateSupport(sequences, alphabet) {
  const n = sequences.length;
  const m = sequences[0]?.length ?? 0;
  const a = alphabet.length;
  const support = /* @__PURE__ */ new Map();
  for (let s = 0; s < a; s++) {
    let count = 0;
    for (let i = 0; i < n; i++) {
      let found = false;
      for (let j = 0; j < m; j++) {
        if (sequences[i][j] === s + 1) {
          found = true;
          break;
        }
      }
      if (found) count++;
    }
    support.set(alphabet[s], count / n);
  }
  return support;
}
function chisqTest(groupCounts, totalCounts, nGroups) {
  const nPatterns = groupCounts.length;
  const prob = 1 / nGroups;
  const statistic = new Array(nPatterns);
  const pValue = new Array(nPatterns);
  const df = nGroups - 1;
  for (let i = 0; i < nPatterns; i++) {
    let chi2 = 0;
    for (let g = 0; g < nGroups; g++) {
      const expected = totalCounts[i] * prob;
      const diff = groupCounts[i][g] - expected;
      chi2 += diff * diff / expected;
    }
    statistic[i] = chi2;
    pValue[i] = chiSqUpperTail(chi2, df);
  }
  return { statistic, pValue };
}
function processPatterns(raw, n, group, stateSupp, minFreq, minSupport, start, end, contain) {
  const entries = [];
  const hasGroup = group !== null && group.length > 0;
  let groups = [];
  let groupIndices = /* @__PURE__ */ new Map();
  if (hasGroup) {
    groups = [...new Set(group)];
    for (const g of groups) {
      const indices = [];
      for (let i = 0; i < group.length; i++) {
        if (group[i] === g) indices.push(i);
      }
      groupIndices.set(g, indices);
    }
  }
  for (const r of raw) {
    if (r.unique.length === 0) continue;
    const mat = r.matrix;
    for (let p = 0; p < r.unique.length; p++) {
      let frequency = 0;
      let count = 0;
      for (let i = 0; i < n; i++) {
        const v = mat[i][p];
        frequency += v;
        if (v > 0) count++;
      }
      const support = count / n;
      if (frequency < minFreq || support < minSupport) continue;
      const pattern = r.unique[p];
      if (start && start.length > 0) {
        if (!start.some((s) => pattern.startsWith(s))) continue;
      }
      if (end && end.length > 0) {
        if (!end.some((s) => pattern.endsWith(s))) continue;
      }
      if (contain && contain.length > 0) {
        const pat = contain.join("|");
        if (!new RegExp(pat).test(pattern)) continue;
      }
      const entry = {
        pattern,
        length: r.length,
        frequency,
        proportion: 0,
        // filled after grouping by length
        count,
        support,
        lift: 0
        // filled below
      };
      const patStates = pattern.split("->").filter((s) => !/^\*+$/.test(s));
      let denom = 1;
      for (const s of patStates) {
        denom *= stateSupp.get(s) ?? 1;
      }
      entry.lift = denom > 0 ? support / denom : 0;
      if (hasGroup) {
        const gc = {};
        const countsArr = [];
        for (const g of groups) {
          const indices = groupIndices.get(g);
          let gCount = 0;
          for (const idx of indices) {
            if (mat[idx][p] > 0) gCount++;
          }
          gc[`count_${g}`] = gCount;
          countsArr.push(gCount);
        }
        entry.groupCounts = gc;
        const chisqResult = chisqTest([countsArr], [count], groups.length);
        entry.chisq = chisqResult.statistic[0];
        entry.pValue = chisqResult.pValue[0];
      }
      entries.push(entry);
    }
  }
  entries.sort((a, b) => b.frequency - a.frequency);
  const lengthTotals = /* @__PURE__ */ new Map();
  for (const e of entries) {
    lengthTotals.set(e.length, (lengthTotals.get(e.length) ?? 0) + e.frequency);
  }
  for (const e of entries) {
    const total = lengthTotals.get(e.length) ?? 1;
    e.proportion = e.frequency / total;
  }
  return entries;
}
function discoverPatterns(data, options) {
  const prepared = prepareSequenceData(data);
  const { sequences, alphabet } = prepared;
  const n = sequences.length;
  const type = options?.type ?? "ngram";
  const len = options?.len ?? [2, 3, 4, 5];
  const gap = options?.gap ?? [1, 2, 3];
  const minFreq = options?.minFreq ?? 2;
  const minSupport = options?.minSupport ?? 0.01;
  const group = options?.group ?? null;
  let extracted;
  if (options?.pattern) {
    extracted = searchPattern(sequences, alphabet, options.pattern);
  } else if (type === "ngram") {
    extracted = extractNgrams(sequences, alphabet, len);
  } else if (type === "gapped") {
    extracted = extractGapped(sequences, alphabet, gap);
  } else {
    extracted = extractRepeated(sequences, alphabet, len);
  }
  const raw = formatPatterns(extracted);
  const stateSupp = stateSupport(sequences, alphabet);
  const patterns = processPatterns(
    raw,
    n,
    group,
    stateSupp,
    minFreq,
    minSupport,
    options?.start,
    options?.end,
    options?.contain
  );
  return { patterns, _raw: raw };
}

// src/sequences/descriptives.ts
function collectStates(data) {
  const stateSet = /* @__PURE__ */ new Set();
  for (let i = 0; i < data.length; i++) {
    const seq = data[i];
    for (let j = 0; j < seq.length; j++) {
      const v = seq[j];
      if (v != null) stateSet.add(v);
    }
  }
  return Array.from(stateSet).sort();
}
function maxLength(data) {
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i].length > max) max = data[i].length;
  }
  return max;
}
function sequenceStateDistribution(data) {
  const states = collectStates(data);
  const nPos = maxLength(data);
  const nStates = states.length;
  const stateIndex = /* @__PURE__ */ new Map();
  for (let s = 0; s < nStates; s++) {
    stateIndex.set(states[s], s);
  }
  const counts = [];
  for (let t = 0; t < nPos; t++) {
    counts.push(new Array(nStates).fill(0));
  }
  for (let i = 0; i < data.length; i++) {
    const seq = data[i];
    for (let t = 0; t < seq.length; t++) {
      const v = seq[t];
      if (v != null) {
        const idx = stateIndex.get(v);
        const row = counts[t];
        row[idx] = (row[idx] ?? 0) + 1;
      }
    }
  }
  const proportions = [];
  for (let t = 0; t < nPos; t++) {
    let totalNonNull = 0;
    for (let s = 0; s < nStates; s++) {
      totalNonNull += counts[t][s];
    }
    const row = new Array(nStates);
    for (let s = 0; s < nStates; s++) {
      row[s] = totalNonNull > 0 ? counts[t][s] / totalNonNull : 0;
    }
    proportions.push(row);
  }
  return { proportions, counts, states, nPositions: nPos };
}
function sequenceStateFrequencies(data) {
  const states = collectStates(data);
  const nStates = states.length;
  const stateIndex = /* @__PURE__ */ new Map();
  for (let s = 0; s < nStates; s++) {
    stateIndex.set(states[s], s);
  }
  const counts = new Array(nStates).fill(0);
  let total = 0;
  for (let i = 0; i < data.length; i++) {
    const seq = data[i];
    for (let j = 0; j < seq.length; j++) {
      const v = seq[j];
      if (v != null) {
        const ci = stateIndex.get(v);
        counts[ci] = (counts[ci] ?? 0) + 1;
        total++;
      }
    }
  }
  const proportions = new Array(nStates);
  for (let s = 0; s < nStates; s++) {
    proportions[s] = total > 0 ? counts[s] / total : 0;
  }
  return { counts, proportions, states, total };
}
function meanTimeInState(data) {
  const states = collectStates(data);
  const nStates = states.length;
  const n = data.length;
  const stateIndex = /* @__PURE__ */ new Map();
  for (let s = 0; s < nStates; s++) {
    stateIndex.set(states[s], s);
  }
  const perSeq = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(nStates).fill(0);
    const seq = data[i];
    for (let j = 0; j < seq.length; j++) {
      const v = seq[j];
      if (v != null) {
        const ri = stateIndex.get(v);
        row[ri] = (row[ri] ?? 0) + 1;
      }
    }
    perSeq.push(row);
  }
  const meanTime = new Array(nStates);
  const sdTime = new Array(nStates);
  for (let s = 0; s < nStates; s++) {
    if (n === 0) {
      meanTime[s] = 0;
      sdTime[s] = 0;
      continue;
    }
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += perSeq[i][s];
    }
    const mean = sum / n;
    meanTime[s] = mean;
    if (n <= 1) {
      sdTime[s] = NaN;
      continue;
    }
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const diff = perSeq[i][s] - mean;
      sumSq += diff * diff;
    }
    sdTime[s] = Math.sqrt(sumSq / (n - 1));
  }
  return { meanTime, sdTime, states };
}
function modalSequence(data) {
  const dist = sequenceStateDistribution(data);
  const nPos = dist.nPositions;
  const allStates = dist.states;
  const nStates = allStates.length;
  const modalStates = new Array(nPos);
  const modalProportions = new Array(nPos);
  for (let t = 0; t < nPos; t++) {
    let maxCount = -1;
    let maxIdx = 0;
    for (let s = 0; s < nStates; s++) {
      if (dist.counts[t][s] > maxCount) {
        maxCount = dist.counts[t][s];
        maxIdx = s;
      }
    }
    let totalNonNull = 0;
    for (let s = 0; s < nStates; s++) {
      totalNonNull += dist.counts[t][s];
    }
    if (totalNonNull > 0) {
      modalStates[t] = allStates[maxIdx];
      modalProportions[t] = maxCount / totalNonNull;
    } else {
      modalStates[t] = "";
      modalProportions[t] = 0;
    }
  }
  return { states: modalStates, proportions: modalProportions };
}
function entropyProfile(data) {
  const dist = sequenceStateDistribution(data);
  const nPos = dist.nPositions;
  const nStates = dist.states.length;
  const logNStates = nStates > 1 ? Math.log2(nStates) : 0;
  const entropy = new Array(nPos);
  for (let t = 0; t < nPos; t++) {
    const props = dist.proportions[t];
    let h = 0;
    for (let s = 0; s < nStates; s++) {
      const p = props[s];
      if (p > 0) {
        h -= p * Math.log2(p);
      }
    }
    entropy[t] = logNStates > 0 ? h / logNStates : 0;
  }
  return { entropy, nPositions: nPos };
}
function sequenceFrequencies(data, options) {
  const n = data.length;
  if (n === 0) return [];
  const canonical = [];
  for (let i = 0; i < n; i++) {
    const seq = data[i];
    let lastNonNull = seq.length - 1;
    while (lastNonNull >= 0 && seq[lastNonNull] === null) {
      lastNonNull--;
    }
    const trimmed = [];
    for (let j = 0; j <= lastNonNull; j++) {
      trimmed.push(seq[j] ?? "");
    }
    canonical.push(trimmed);
  }
  const freqMap = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const key = JSON.stringify(canonical[i]);
    const existing = freqMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      freqMap.set(key, { sequence: canonical[i], count: 1 });
    }
  }
  const entries = Array.from(freqMap.entries());
  entries.sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  const top = options?.top ?? entries.length;
  const results = [];
  for (let i = 0; i < Math.min(top, entries.length); i++) {
    const entry = entries[i][1];
    results.push({
      sequence: entry.sequence,
      count: entry.count,
      proportion: entry.count / n
    });
  }
  return results;
}

export { chiSqUpperTail, convert, discoverPatterns, entropyProfile, extractLast, meanTimeInState, modalSequence, prepareSequenceData, rle, sequenceFrequencies, sequenceIndices, sequenceStateDistribution, sequenceStateFrequencies, sequenceTransitions };
//# sourceMappingURL=chunk-7G5VVISJ.js.map
//# sourceMappingURL=chunk-7G5VVISJ.js.map