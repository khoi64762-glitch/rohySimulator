// src/core/matrix.ts
var Matrix = class _Matrix {
  data;
  rows;
  cols;
  constructor(rows, cols, data) {
    this.rows = rows;
    this.cols = cols;
    if (data) {
      this.data = data instanceof Float64Array ? data : new Float64Array(data);
      if (this.data.length !== rows * cols) {
        throw new Error(
          `Data length ${this.data.length} doesn't match ${rows}x${cols}=${rows * cols}`
        );
      }
    } else {
      this.data = new Float64Array(rows * cols);
    }
  }
  /** Create from a 2D array. */
  static from2D(arr) {
    const rows = arr.length;
    if (rows === 0) return new _Matrix(0, 0);
    const cols = arr[0].length;
    const data = new Float64Array(rows * cols);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        data[i * cols + j] = arr[i][j];
      }
    }
    return new _Matrix(rows, cols, data);
  }
  /** Create an identity matrix. */
  static eye(n) {
    const m = new _Matrix(n, n);
    for (let i = 0; i < n; i++) {
      m.data[i * n + i] = 1;
    }
    return m;
  }
  /** Create a matrix filled with a value. */
  static fill(rows, cols, value) {
    const data = new Float64Array(rows * cols);
    data.fill(value);
    return new _Matrix(rows, cols, data);
  }
  /** Create a zero matrix. */
  static zeros(rows, cols) {
    return new _Matrix(rows, cols);
  }
  /** Get element at (i, j). */
  get(i, j) {
    return this.data[i * this.cols + j];
  }
  /** Set element at (i, j). */
  set(i, j, value) {
    this.data[i * this.cols + j] = value;
  }
  /** Deep copy. */
  clone() {
    return new _Matrix(this.rows, this.cols, new Float64Array(this.data));
  }
  /** Convert to 2D array. */
  to2D() {
    const result = [];
    for (let i = 0; i < this.rows; i++) {
      const row = [];
      for (let j = 0; j < this.cols; j++) {
        row.push(this.get(i, j));
      }
      result.push(row);
    }
    return result;
  }
  /** Transpose. */
  transpose() {
    const result = new _Matrix(this.cols, this.rows);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        result.set(j, i, this.get(i, j));
      }
    }
    return result;
  }
  /** Matrix multiply: this @ other. */
  matmul(other) {
    if (this.cols !== other.rows) {
      throw new Error(
        `Cannot multiply ${this.rows}x${this.cols} by ${other.rows}x${other.cols}`
      );
    }
    const result = new _Matrix(this.rows, other.cols);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < other.cols; j++) {
        let sum = 0;
        for (let k = 0; k < this.cols; k++) {
          sum += this.get(i, k) * other.get(k, j);
        }
        result.set(i, j, sum);
      }
    }
    return result;
  }
  /** Element-wise addition. */
  add(other) {
    const result = new _Matrix(this.rows, this.cols);
    for (let i = 0; i < this.data.length; i++) {
      result.data[i] = this.data[i] + other.data[i];
    }
    return result;
  }
  /** Element-wise subtraction. */
  sub(other) {
    const result = new _Matrix(this.rows, this.cols);
    for (let i = 0; i < this.data.length; i++) {
      result.data[i] = this.data[i] - other.data[i];
    }
    return result;
  }
  /** Element-wise multiplication. */
  mul(other) {
    const result = new _Matrix(this.rows, this.cols);
    for (let i = 0; i < this.data.length; i++) {
      result.data[i] = this.data[i] * other.data[i];
    }
    return result;
  }
  /** Scalar multiply. */
  scale(s) {
    const result = new _Matrix(this.rows, this.cols);
    for (let i = 0; i < this.data.length; i++) {
      result.data[i] = this.data[i] * s;
    }
    return result;
  }
  /** Element-wise apply. */
  map(fn) {
    const result = new _Matrix(this.rows, this.cols);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        result.set(i, j, fn(this.get(i, j), i, j));
      }
    }
    return result;
  }
  /** Sum of all elements. */
  sum() {
    let s = 0;
    for (let i = 0; i < this.data.length; i++) {
      s += this.data[i];
    }
    return s;
  }
  /** Row sums as array. */
  rowSums() {
    const sums = new Float64Array(this.rows);
    for (let i = 0; i < this.rows; i++) {
      let s = 0;
      for (let j = 0; j < this.cols; j++) {
        s += this.get(i, j);
      }
      sums[i] = s;
    }
    return sums;
  }
  /** Column sums as array. */
  colSums() {
    const sums = new Float64Array(this.cols);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        sums[j] += this.get(i, j);
      }
    }
    return sums;
  }
  /** Get diagonal as array. */
  diag() {
    const n = Math.min(this.rows, this.cols);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      d[i] = this.get(i, i);
    }
    return d;
  }
  /** Set diagonal values. */
  setDiag(value) {
    const result = this.clone();
    const n = Math.min(this.rows, this.cols);
    for (let i = 0; i < n; i++) {
      result.set(i, i, value);
    }
    return result;
  }
  /** Fill diagonal with values from array. */
  setDiagFrom(values) {
    const result = this.clone();
    const n = Math.min(this.rows, this.cols, values.length);
    for (let i = 0; i < n; i++) {
      result.set(i, i, values[i]);
    }
    return result;
  }
  /** Create a diagonal matrix from a vector. */
  static diag(values) {
    const n = values.length;
    const result = new _Matrix(n, n);
    for (let i = 0; i < n; i++) {
      result.set(i, i, values[i]);
    }
    return result;
  }
  /** Max element. */
  max() {
    let m = -Infinity;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] > m) m = this.data[i];
    }
    return m;
  }
  /** Min element. */
  min() {
    let m = Infinity;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] < m) m = this.data[i];
    }
    return m;
  }
  /** Count elements matching a predicate. */
  count(predicate) {
    let c = 0;
    for (let i = 0; i < this.data.length; i++) {
      if (predicate(this.data[i])) c++;
    }
    return c;
  }
  /** Check if any element satisfies predicate. */
  any(predicate) {
    for (let i = 0; i < this.data.length; i++) {
      if (predicate(this.data[i])) return true;
    }
    return false;
  }
  /** Flatten to array in column-major order (matching R's as.vector). */
  flattenColMajor() {
    const result = new Float64Array(this.rows * this.cols);
    let idx = 0;
    for (let j = 0; j < this.cols; j++) {
      for (let i = 0; i < this.rows; i++) {
        result[idx++] = this.get(i, j);
      }
    }
    return result;
  }
  /** Flatten to array in row-major order. */
  flatten() {
    return new Float64Array(this.data);
  }
  /** Get a row as array. */
  row(i) {
    const result = new Float64Array(this.cols);
    for (let j = 0; j < this.cols; j++) {
      result[j] = this.get(i, j);
    }
    return result;
  }
  /** Get a column as array. */
  col(j) {
    const result = new Float64Array(this.rows);
    for (let i = 0; i < this.rows; i++) {
      result[i] = this.get(i, j);
    }
    return result;
  }
  /** Extract a sub-matrix given row and column indices. */
  subMatrix(rowIndices, colIndices) {
    const result = new _Matrix(rowIndices.length, colIndices.length);
    for (let i = 0; i < rowIndices.length; i++) {
      for (let j = 0; j < colIndices.length; j++) {
        result.set(i, j, this.get(rowIndices[i], colIndices[j]));
      }
    }
    return result;
  }
  /** Quantile of all elements. */
  quantile(p) {
    const sorted = Array.from(this.data).sort((a, b) => a - b);
    const idx = p * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    const frac = idx - lo;
    return sorted[lo] * (1 - frac) + sorted[hi] * frac;
  }
  /** Is square? */
  get isSquare() {
    return this.rows === this.cols;
  }
  /** Mean of non-zero elements. */
  meanNonZero() {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] > 0) {
        sum += this.data[i];
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }
  /** Invert matrix using Gauss-Jordan elimination. */
  inverse() {
    if (!this.isSquare) {
      throw new Error("Cannot invert non-square matrix");
    }
    const n = this.rows;
    const aug = new _Matrix(n, 2 * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        aug.set(i, j, this.get(i, j));
      }
      aug.set(i, n + i, 1);
    }
    for (let col = 0; col < n; col++) {
      let maxVal = Math.abs(aug.get(col, col));
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        const val = Math.abs(aug.get(row, col));
        if (val > maxVal) {
          maxVal = val;
          maxRow = row;
        }
      }
      if (maxVal < 1e-15) {
        throw new Error("Matrix is singular");
      }
      if (maxRow !== col) {
        for (let j = 0; j < 2 * n; j++) {
          const tmp = aug.get(col, j);
          aug.set(col, j, aug.get(maxRow, j));
          aug.set(maxRow, j, tmp);
        }
      }
      const pivot = aug.get(col, col);
      for (let j = 0; j < 2 * n; j++) {
        aug.set(col, j, aug.get(col, j) / pivot);
      }
      for (let row = 0; row < n; row++) {
        if (row !== col) {
          const factor = aug.get(row, col);
          for (let j = 0; j < 2 * n; j++) {
            aug.set(row, j, aug.get(row, j) - factor * aug.get(col, j));
          }
        }
      }
    }
    const result = new _Matrix(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        result.set(i, j, aug.get(i, n + j));
      }
    }
    return result;
  }
  /** Outer product of two vectors. */
  static outer(a, b) {
    const m = a.length;
    const n = b.length;
    const result = new _Matrix(m, n);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        result.set(i, j, a[i] * b[j]);
      }
    }
    return result;
  }
};
function rowNormalize(mat) {
  const result = mat.clone();
  for (let i = 0; i < mat.rows; i++) {
    let rowSum = 0;
    for (let j = 0; j < mat.cols; j++) {
      rowSum += mat.get(i, j);
    }
    if (rowSum === 0) rowSum = 1;
    for (let j = 0; j < mat.cols; j++) {
      result.set(i, j, mat.get(i, j) / rowSum);
    }
  }
  return result;
}
function minmaxScale(mat) {
  const minVal = mat.min();
  const maxVal = mat.max();
  if (maxVal === minVal) return Matrix.zeros(mat.rows, mat.cols);
  const range = maxVal - minVal;
  return mat.map((v) => (v - minVal) / range);
}
function maxScale(mat) {
  const maxVal = mat.max();
  if (maxVal === 0) return mat.clone();
  return mat.map((v) => v / maxVal);
}
function rankScale(mat) {
  const flat = Array.from(mat.data);
  const n = flat.length;
  const indexed = flat.map((v, i2) => ({ v, i: i2 }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      ranks[indexed[k].i] = avgRank;
    }
    i = j;
  }
  return new Matrix(mat.rows, mat.cols, ranks);
}
function applyScaling(mat, scaling) {
  if (!scaling) return { weights: mat.clone(), applied: [] };
  const methods = typeof scaling === "string" ? [scaling] : scaling;
  let result = mat.clone();
  const applied = [];
  for (const method of methods) {
    const m = method.toLowerCase();
    switch (m) {
      case "minmax":
        result = minmaxScale(result);
        applied.push("minmax");
        break;
      case "max":
        result = maxScale(result);
        applied.push("max");
        break;
      case "rank":
        result = rankScale(result);
        applied.push("rank");
        break;
      default:
        throw new Error(`Unknown scaling method: ${method}`);
    }
  }
  return { weights: result, applied };
}
function arrayMean(arr) {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}
function arrayStd(arr, ddof = 1) {
  if (arr.length <= ddof) return 0;
  const mean = arrayMean(arr);
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) {
    const diff = arr[i] - mean;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / (arr.length - ddof));
}
function pearsonCorr(a, b) {
  if (a.length !== b.length || a.length < 2) return NaN;
  const meanA = arrayMean(a);
  const meanB = arrayMean(b);
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? NaN : num / den;
}
function arrayQuantile(arr, p) {
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// src/core/prepare.ts
function createSeqdata(data, options) {
  const stateSet = /* @__PURE__ */ new Set();
  for (const row of data) {
    for (const val of row) {
      if (val !== null && val !== void 0 && val !== "") {
        stateSet.add(val);
      }
    }
  }
  const labels = Array.from(stateSet).sort();
  if (options?.beginState && !labels.includes(options.beginState)) {
    labels.unshift(options.beginState);
  }
  if (options?.endState && !labels.includes(options.endState)) {
    labels.push(options.endState);
  }
  let result = data;
  if (options?.beginState) {
    result = result.map((row) => [options.beginState, ...row]);
  }
  if (options?.endState) {
    result = result.map((row) => [...row, options.endState]);
  }
  return { data: result, labels };
}
function prepareData(data, options) {
  const { data: seqData, labels } = createSeqdata(data, options);
  const actionCounts = /* @__PURE__ */ new Map();
  let totalLength = 0;
  let maxLen = 0;
  for (const row of seqData) {
    let rowLen = 0;
    for (const val of row) {
      if (val !== null && val !== void 0 && val !== "") {
        actionCounts.set(val, (actionCounts.get(val) ?? 0) + 1);
        rowLen++;
      }
    }
    totalLength += rowLen;
    if (rowLen > maxLen) maxLen = rowLen;
  }
  return {
    sequenceData: seqData,
    labels,
    statistics: {
      nSessions: seqData.length,
      nUniqueActions: labels.length,
      uniqueActions: labels,
      maxSequenceLength: maxLen,
      meanSequenceLength: seqData.length > 0 ? totalLength / seqData.length : 0
    }
  };
}
function importOnehot(data, cols, options) {
  const windowSize = options?.windowSize ?? 1;
  const windowType = options?.windowType ?? "tumbling";
  const aggregate = options?.aggregate ?? false;
  const decoded = data.map(
    (row) => cols.map((col) => row[col] === 1 ? col : null)
  );
  const groups = [];
  if (options?.actor || options?.session) {
    const groupMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < data.length; i++) {
      const parts = [];
      if (options?.actor) parts.push(String(data[i][options.actor] ?? ""));
      if (options?.session) parts.push(String(data[i][options.session] ?? ""));
      const key = parts.join("_");
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(decoded[i]);
    }
    for (const rows of groupMap.values()) {
      groups.push(rows);
    }
  } else {
    groups.push(decoded);
  }
  const result = [];
  for (const groupRows of groups) {
    const nRows = groupRows.length;
    const allWindows = [];
    if (windowType === "sliding") {
      const active = cols.map(
        (_, c) => Array.from({ length: nRows }, (__, r) => groupRows[r][c] !== null)
      );
      const maxW = Math.max(windowSize, 2);
      for (let w = 1; w < maxW; w++) {
        for (let c = 0; c < cols.length; c++) {
          const prev = active[c].slice();
          for (let r = 0; r < nRows; r++) {
            active[c][r] = prev[r] || r >= w && prev[r - w];
          }
        }
      }
      for (let r = 1; r < nRows; r++) {
        const windowVals = [];
        for (let c = 0; c < cols.length; c++) {
          windowVals.push(active[c][r] ? cols[c] : null);
        }
        allWindows.push(windowVals);
      }
    } else {
      for (let start = 0; start < nRows; start += windowSize) {
        const windowRows = groupRows.slice(start, Math.min(start + windowSize, nRows));
        const windowVals = [];
        if (aggregate) {
          for (let c = 0; c < cols.length; c++) {
            let firstVal = null;
            for (const r of windowRows) {
              if (r[c] !== null) {
                firstVal = r[c];
                break;
              }
            }
            windowVals.push(firstVal);
          }
        } else {
          for (const r of windowRows) {
            for (let c = 0; c < cols.length; c++) {
              windowVals.push(r[c]);
            }
          }
        }
        allWindows.push(windowVals);
      }
    }
    const effectiveInterval = options?.interval ?? allWindows.length;
    const safeInterval = Math.max(1, effectiveInterval);
    if (allWindows.length === 0) {
      result.push([]);
    } else {
      const nGroups = Math.ceil(allWindows.length / safeInterval);
      for (let g = 0; g < nGroups; g++) {
        const groupWindows = allWindows.slice(g * safeInterval, (g + 1) * safeInterval);
        const rowValues = [];
        for (const w of groupWindows) {
          for (const v of w) rowValues.push(v);
        }
        result.push(rowValues);
      }
    }
  }
  const wsAttr = aggregate ? 1 : windowSize;
  return {
    sequences: result,
    windowSize: wsAttr,
    windowSpan: cols.length
  };
}

// src/core/transitions.ts
var ATTENTION_DEFAULT_BETA = 1;
function isNA(val) {
  return val === null || val === void 0 || val === "";
}
function getValidTransitions(row) {
  const result = [];
  for (let i = 0; i < row.length; i++) {
    const val = row[i];
    if (!isNA(val)) {
      result.push({ pos: i, state: val });
    }
  }
  return result;
}
function computeTransitions(data, states, type = "relative", params) {
  const nStates = states.length;
  const stateToIdx = /* @__PURE__ */ new Map();
  states.forEach((s, i) => stateToIdx.set(s, i));
  switch (type) {
    case "relative":
      return transitionsRelative(data, stateToIdx, nStates);
    case "frequency":
      return transitionsFrequency(data, stateToIdx, nStates);
    case "co-occurrence":
      return transitionsCooccurrence(data, stateToIdx, nStates, params);
    case "reverse":
      return transitionsReverse(data, stateToIdx, nStates);
    case "n-gram":
      return transitionsNgram(data, stateToIdx, nStates, params?.n ?? 2);
    case "gap":
      return transitionsGap(data, stateToIdx, nStates, params?.maxGap ?? 5, params?.decay ?? 0.5);
    case "window":
      return transitionsWindow(data, stateToIdx, nStates, params?.size ?? 3);
    case "attention":
      return transitionsAttention(data, stateToIdx, nStates, params?.beta ?? ATTENTION_DEFAULT_BETA);
    default:
      throw new Error(`Unknown transition type: ${type}`);
  }
}
function transitionsRelative(data, stateToIdx, nStates) {
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const firstIdx = stateToIdx.get(valid[0].state);
    if (firstIdx !== void 0) inits[firstIdx]++;
    for (let i = 0; i < valid.length - 1; i++) {
      const fromIdx = stateToIdx.get(valid[i].state);
      const toIdx = stateToIdx.get(valid[i + 1].state);
      if (fromIdx !== void 0 && toIdx !== void 0) {
        counts.set(fromIdx, toIdx, counts.get(fromIdx, toIdx) + 1);
      }
    }
  }
  const weights = rowNormalize(counts);
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights, inits };
}
function transitionsFrequency(data, stateToIdx, nStates) {
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const firstIdx = stateToIdx.get(valid[0].state);
    if (firstIdx !== void 0) inits[firstIdx]++;
    for (let i = 0; i < valid.length - 1; i++) {
      const fromIdx = stateToIdx.get(valid[i].state);
      const toIdx = stateToIdx.get(valid[i + 1].state);
      if (fromIdx !== void 0 && toIdx !== void 0) {
        counts.set(fromIdx, toIdx, counts.get(fromIdx, toIdx) + 1);
      }
    }
  }
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights: counts, inits };
}
function transitionsCooccurrence(data, stateToIdx, nStates, params) {
  if (params?.windowed) {
    return transitionsCooccurrenceWindowed(
      data,
      stateToIdx,
      nStates,
      params.windowSize ?? 1,
      params.windowSpan ?? 1
    );
  }
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const firstIdx = stateToIdx.get(valid[0].state);
    if (firstIdx !== void 0) inits[firstIdx]++;
    for (let i = 0; i < valid.length - 1; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const idx1 = stateToIdx.get(valid[i].state);
        const idx2 = stateToIdx.get(valid[j].state);
        if (idx1 !== void 0 && idx2 !== void 0) {
          counts.set(idx1, idx2, counts.get(idx1, idx2) + 1);
          if (idx1 !== idx2) {
            counts.set(idx2, idx1, counts.get(idx2, idx1) + 1);
          }
        }
      }
    }
  }
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights: counts, inits };
}
function transitionsCooccurrenceWindowed(data, stateToIdx, nStates, windowSize, windowSpan) {
  const nSeqs = data.length;
  const nCols = nSeqs > 0 ? data[0].length : 0;
  const effWindow = windowSize * windowSpan;
  const divides = nCols % effWindow === 0;
  const q = Math.floor(nCols / effWindow) - (divides ? 1 : 0);
  const nWindows = q + 1;
  const trans = [];
  for (let r = 0; r < nSeqs; r++) {
    trans.push(Matrix.zeros(nStates, nStates));
  }
  for (let w = 0; w < nWindows; w++) {
    const wStart = w * effWindow;
    const wEnd = Math.min(nCols, (w + 1) * effWindow);
    for (let j = wStart; j < wEnd; j++) {
      for (let k = wStart; k < wEnd; k++) {
        for (let row = 0; row < nSeqs; row++) {
          const fromVal = data[row][j];
          const toVal = data[row][k];
          if (isNA(fromVal) || isNA(toVal)) continue;
          const fi = stateToIdx.get(fromVal);
          const ti = stateToIdx.get(toVal);
          if (fi !== void 0 && ti !== void 0) {
            trans[row].set(fi, ti, trans[row].get(fi, ti) + 1);
          }
        }
      }
    }
  }
  const counts = Matrix.zeros(nStates, nStates);
  for (const t of trans) {
    for (let i = 0; i < nStates; i++) {
      for (let j = 0; j < nStates; j++) {
        counts.set(i, j, counts.get(i, j) + t.get(i, j));
      }
    }
  }
  const inits = new Float64Array(nStates);
  for (let row = 0; row < nSeqs; row++) {
    const val = data[row][0];
    if (!isNA(val)) {
      const idx = stateToIdx.get(val);
      if (idx !== void 0) inits[idx]++;
    }
  }
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  } else {
    inits.fill(NaN);
  }
  return { weights: counts, inits };
}
function transitionsReverse(data, stateToIdx, nStates) {
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const lastIdx = stateToIdx.get(valid[valid.length - 1].state);
    if (lastIdx !== void 0) inits[lastIdx]++;
    for (let i = valid.length - 1; i > 0; i--) {
      const fromIdx = stateToIdx.get(valid[i].state);
      const toIdx = stateToIdx.get(valid[i - 1].state);
      if (fromIdx !== void 0 && toIdx !== void 0) {
        counts.set(fromIdx, toIdx, counts.get(fromIdx, toIdx) + 1);
      }
    }
  }
  const weights = rowNormalize(counts);
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights, inits };
}
function transitionsNgram(data, stateToIdx, nStates, n) {
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const firstIdx = stateToIdx.get(valid[0].state);
    if (firstIdx !== void 0) inits[firstIdx]++;
    for (let i = 0; i <= valid.length - n; i++) {
      const fromIdx = stateToIdx.get(valid[i].state);
      const toIdx = stateToIdx.get(valid[i + n - 1].state);
      if (fromIdx !== void 0 && toIdx !== void 0) {
        counts.set(fromIdx, toIdx, counts.get(fromIdx, toIdx) + 1);
      }
    }
  }
  const weights = rowNormalize(counts);
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights, inits };
}
function transitionsGap(data, stateToIdx, nStates, maxGap, decay) {
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const firstIdx = stateToIdx.get(valid[0].state);
    if (firstIdx !== void 0) inits[firstIdx]++;
    for (let i = 0; i < valid.length; i++) {
      const fromIdx = stateToIdx.get(valid[i].state);
      if (fromIdx === void 0) continue;
      for (let j = i + 1; j < Math.min(i + maxGap + 1, valid.length); j++) {
        const toIdx = stateToIdx.get(valid[j].state);
        if (toIdx === void 0) continue;
        const gap = j - i;
        const weight = Math.pow(decay, gap - 1);
        counts.set(fromIdx, toIdx, counts.get(fromIdx, toIdx) + weight);
      }
    }
  }
  const weights = rowNormalize(counts);
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights, inits };
}
function transitionsWindow(data, stateToIdx, nStates, size) {
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const firstIdx = stateToIdx.get(valid[0].state);
    if (firstIdx !== void 0) inits[firstIdx]++;
    for (let wStart = 0; wStart <= valid.length - size; wStart++) {
      const window = valid.slice(wStart, wStart + size);
      for (let i = 0; i < window.length; i++) {
        for (let j = i + 1; j < window.length; j++) {
          const idx1 = stateToIdx.get(window[i].state);
          const idx2 = stateToIdx.get(window[j].state);
          if (idx1 !== void 0 && idx2 !== void 0) {
            counts.set(idx1, idx2, counts.get(idx1, idx2) + 1);
          }
        }
      }
    }
  }
  const weights = rowNormalize(counts);
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights, inits };
}
function transitionsAttention(data, stateToIdx, nStates, beta) {
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const firstIdx = stateToIdx.get(valid[0].state);
    if (firstIdx !== void 0) inits[firstIdx]++;
    for (let i = 0; i < valid.length; i++) {
      const fromIdx = stateToIdx.get(valid[i].state);
      if (fromIdx === void 0) continue;
      for (let j = i + 1; j < valid.length; j++) {
        const toIdx = stateToIdx.get(valid[j].state);
        if (toIdx === void 0) continue;
        const distance = j - i;
        const weight = Math.exp(-beta * distance);
        counts.set(fromIdx, toIdx, counts.get(fromIdx, toIdx) + weight);
      }
    }
  }
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights: counts, inits };
}
function computeTransitions3D(data, states, type = "relative", params) {
  const nSequences = data.length;
  const nStates = states.length;
  const stateToIdx = /* @__PURE__ */ new Map();
  states.forEach((s, i) => stateToIdx.set(s, i));
  const trans = [];
  for (let r = 0; r < nSequences; r++) {
    trans.push(Matrix.zeros(nStates, nStates));
  }
  const nCols = data.length > 0 ? data[0].length : 0;
  if (type === "relative" || type === "frequency") {
    for (let col = 0; col < nCols - 1; col++) {
      for (let row = 0; row < nSequences; row++) {
        const fromVal = data[row][col];
        const toVal = data[row][col + 1];
        if (isNA(fromVal) || isNA(toVal)) continue;
        const fromIdx = stateToIdx.get(fromVal);
        const toIdx = stateToIdx.get(toVal);
        if (fromIdx !== void 0 && toIdx !== void 0) {
          trans[row].set(fromIdx, toIdx, trans[row].get(fromIdx, toIdx) + 1);
        }
      }
    }
  } else if (type === "reverse") {
    for (let col = 0; col < nCols - 1; col++) {
      for (let row = 0; row < nSequences; row++) {
        const fromVal = data[row][col + 1];
        const toVal = data[row][col];
        if (isNA(fromVal) || isNA(toVal)) continue;
        const fromIdx = stateToIdx.get(fromVal);
        const toIdx = stateToIdx.get(toVal);
        if (fromIdx !== void 0 && toIdx !== void 0) {
          trans[row].set(fromIdx, toIdx, trans[row].get(fromIdx, toIdx) + 1);
        }
      }
    }
  } else if (type === "co-occurrence") {
    if (params?.windowed) {
      const ws = params.windowSize ?? 1;
      const wspan = params.windowSpan ?? 1;
      const effWindow = ws * wspan;
      const divides = nCols % effWindow === 0;
      const q = Math.floor(nCols / effWindow) - (divides ? 1 : 0);
      const nWindows = q + 1;
      for (let w = 0; w < nWindows; w++) {
        const wStart = w * effWindow;
        const wEnd = Math.min(nCols, (w + 1) * effWindow);
        for (let j = wStart; j < wEnd; j++) {
          for (let k = wStart; k < wEnd; k++) {
            for (let row = 0; row < nSequences; row++) {
              const fromVal = data[row][j];
              const toVal = data[row][k];
              if (isNA(fromVal) || isNA(toVal)) continue;
              const fi = stateToIdx.get(fromVal);
              const ti = stateToIdx.get(toVal);
              if (fi !== void 0 && ti !== void 0) {
                trans[row].set(fi, ti, trans[row].get(fi, ti) + 1);
              }
            }
          }
        }
      }
    } else {
      for (let i = 0; i < nCols - 1; i++) {
        for (let j = i + 1; j < nCols; j++) {
          for (let row = 0; row < nSequences; row++) {
            const fromVal = data[row][i];
            const toVal = data[row][j];
            if (isNA(fromVal) || isNA(toVal)) continue;
            const fi = stateToIdx.get(fromVal);
            const ti = stateToIdx.get(toVal);
            if (fi !== void 0 && ti !== void 0) {
              trans[row].set(fi, ti, trans[row].get(fi, ti) + 1);
              if (fi !== ti) {
                trans[row].set(ti, fi, trans[row].get(ti, fi) + 1);
              }
            }
          }
        }
      }
    }
  } else if (type === "attention") {
    const beta = params?.beta ?? ATTENTION_DEFAULT_BETA;
    for (let i = 0; i < nCols; i++) {
      for (let j = i + 1; j < nCols; j++) {
        for (let row = 0; row < nSequences; row++) {
          const fromVal = data[row][i];
          const toVal = data[row][j];
          if (isNA(fromVal) || isNA(toVal)) continue;
          const fi = stateToIdx.get(fromVal);
          const ti = stateToIdx.get(toVal);
          if (fi !== void 0 && ti !== void 0) {
            const d = Math.exp(-beta * (j - i));
            trans[row].set(fi, ti, trans[row].get(fi, ti) + d);
          }
        }
      }
    }
  }
  return trans;
}
function computeWeightsFrom3D(transitions, type = "relative", scaling) {
  if (transitions.length === 0) {
    throw new Error("No transition matrices provided");
  }
  const n = transitions[0].rows;
  const weights = Matrix.zeros(n, n);
  for (const t of transitions) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        weights.set(i, j, weights.get(i, j) + t.get(i, j));
      }
    }
  }
  let result = type === "relative" ? rowNormalize(weights) : weights;
  if (scaling) {
    const scaled = applyScaling(result, scaling);
    result = scaled.weights;
  }
  return result;
}
function computeWeightsFromMatrix(mat, type = "relative") {
  if (type === "relative") return rowNormalize(mat);
  return mat.clone();
}

// src/core/model.ts
function createTNA(weights, inits, labels, data = null, type = "relative", scaling = [], params) {
  return { weights, inits, labels, data, type, scaling, params };
}
function isSquareMatrix(data) {
  if (data.length === 0) return false;
  return data.length === data[0].length;
}
function buildModel(x, options) {
  const type = options?.type ?? "relative";
  const scaling = options?.scaling ?? null;
  let labels = options?.labels;
  const beginState = options?.beginState;
  const endState = options?.endState;
  const params = options?.params;
  if (isTNAData(x)) {
    return buildModel(x.sequenceData, { ...options, labels: labels ?? x.labels });
  }
  if (isNumericMatrix(x)) {
    if (isSquareMatrix(x)) {
      const mat = Matrix.from2D(x);
      const weights2 = computeWeightsFromMatrix(mat, type);
      const n = weights2.rows;
      const stateLabels2 = labels ?? Array.from({ length: n }, (_, i) => `S${i + 1}`);
      const inits2 = new Float64Array(n).fill(1 / n);
      const { weights: scaled2, applied: applied2 } = applyScaling(weights2, scaling);
      return createTNA(scaled2, inits2, stateLabels2, null, type, applied2);
    }
  }
  const seqData = x;
  const { data: processedData, labels: detectedLabels } = createSeqdata(seqData, {
    beginState,
    endState
  });
  const stateLabels = labels ?? detectedLabels;
  const { weights, inits } = computeTransitions(processedData, stateLabels, type, params);
  const { weights: scaled, applied } = applyScaling(weights, scaling);
  return createTNA(scaled, inits, stateLabels, processedData, type, applied, params);
}
function tna(x, options) {
  return buildModel(x, { ...options, type: "relative" });
}
function ftna(x, options) {
  return buildModel(x, { ...options, type: "frequency" });
}
function ctna(x, options) {
  if (isOnehotSequenceData(x)) {
    return buildModel(x.sequences, {
      ...options,
      type: "co-occurrence",
      params: {
        ...options?.params,
        windowed: true,
        windowSize: x.windowSize,
        windowSpan: x.windowSpan
      }
    });
  }
  return buildModel(x, { ...options, type: "co-occurrence" });
}
function atna(x, options) {
  return buildModel(x, {
    ...options,
    type: "attention",
    params: { beta: options?.beta ?? ATTENTION_DEFAULT_BETA }
  });
}
function isTNAData(x) {
  return typeof x === "object" && x !== null && "sequenceData" in x && "labels" in x && "statistics" in x;
}
function isOnehotSequenceData(x) {
  return typeof x === "object" && x !== null && "sequences" in x && "windowSize" in x && "windowSpan" in x;
}
function isNumericMatrix(x) {
  if (!Array.isArray(x) || x.length === 0) return false;
  const first = x[0];
  if (!Array.isArray(first) || first.length === 0) return false;
  return typeof first[0] === "number";
}
function summary(model) {
  return {
    nStates: model.labels.length,
    type: model.type,
    scaling: model.scaling,
    nEdges: model.weights.count((v) => v > 0),
    density: model.weights.count((v) => v > 0) / model.labels.length ** 2,
    meanWeight: model.weights.meanNonZero(),
    maxWeight: model.weights.max(),
    hasSelfLoops: model.weights.diag().some((v) => v > 0)
  };
}

// src/core/rng.ts
var SeededRNG = class {
  s0;
  s1;
  s2;
  s3;
  constructor(seed) {
    seed = seed >>> 0;
    this.s0 = splitmix32(seed);
    this.s1 = splitmix32(this.s0);
    this.s2 = splitmix32(this.s1);
    this.s3 = splitmix32(this.s2);
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) {
      this.s0 = 1;
    }
  }
  /** Generate next random 32-bit unsigned integer (xoshiro128**). */
  next() {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9 >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }
  /** Generate a random float in [0, 1). */
  random() {
    return this.next() / 4294967296;
  }
  /** Generate a random integer in [0, max). */
  randInt(max) {
    return Math.floor(this.random() * max);
  }
  /** Fisher-Yates shuffle (in-place). */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randInt(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
  /** Generate a random permutation of indices [0, n). */
  permutation(n) {
    const arr = Array.from({ length: n }, (_, i) => i);
    return this.shuffle(arr);
  }
  /** Random choice with replacement: pick `size` items from [0, n). */
  choice(n, size) {
    const result = [];
    for (let i = 0; i < size; i++) {
      result.push(this.randInt(n));
    }
    return result;
  }
  /** Random choice WITHOUT replacement: pick `size` items from [0, n). */
  choiceWithoutReplacement(n, size) {
    if (size > n) throw new Error(`Cannot choose ${size} from ${n} without replacement`);
    const pool = Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < size; i++) {
      const j = i + this.randInt(n - i);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, size);
  }
};
function rotl(x, k) {
  return (x << k | x >>> 32 - k) >>> 0;
}
function splitmix32(seed) {
  seed = seed + 2654435769 >>> 0;
  seed = Math.imul(seed ^ seed >>> 16, 2246822507) >>> 0;
  seed = Math.imul(seed ^ seed >>> 13, 3266489909) >>> 0;
  return (seed ^ seed >>> 16) >>> 0;
}

export { ATTENTION_DEFAULT_BETA, Matrix, SeededRNG, applyScaling, arrayMean, arrayQuantile, arrayStd, atna, buildModel, computeTransitions, computeTransitions3D, computeWeightsFrom3D, computeWeightsFromMatrix, createSeqdata, createTNA, ctna, ftna, importOnehot, maxScale, minmaxScale, pearsonCorr, prepareData, rankScale, rowNormalize, summary, tna };
//# sourceMappingURL=chunk-2EXGRQR6.js.map
//# sourceMappingURL=chunk-2EXGRQR6.js.map