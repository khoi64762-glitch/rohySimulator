'use strict';

var chunkO5U3BFYT_cjs = require('./chunk-O5U3BFYT.cjs');
var chunkRT5XI5AH_cjs = require('./chunk-RT5XI5AH.cjs');

// src/transitiontrees/fit.ts
var ROOT_CONTEXT = "<root>";
var ROOT_PATHWAY = "(start)";
var PATH_SEPARATOR = " -> ";
function assertFinite(name, value) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}
function integerOption(name, value, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}
function resolveSmoothing(spec = "floor") {
  const raw = typeof spec === "string" ? { method: spec } : spec;
  switch (raw.method) {
    case "floor": {
      const ymin = raw.ymin ?? 1e-3;
      const rule = raw.rule ?? "interpolate";
      assertFinite("smoothing.ymin", ymin);
      if (ymin < 0) throw new Error("smoothing.ymin must be >= 0");
      if (rule !== "interpolate" && rule !== "cap") {
        throw new Error('smoothing.rule must be "interpolate" or "cap"');
      }
      return { method: "floor", ymin, rule };
    }
    case "laplace": {
      const alpha = raw.alpha ?? 1;
      assertFinite("smoothing.alpha", alpha);
      if (alpha < 0) throw new Error("smoothing.alpha must be >= 0");
      return { method: "laplace", alpha };
    }
    case "kneser_ney": {
      const discount = raw.discount ?? 0.75;
      assertFinite("smoothing.discount", discount);
      if (discount < 0 || discount > 1) {
        throw new Error("smoothing.discount must be in [0, 1]");
      }
      return { method: "kneser_ney", discount };
    }
    case "witten_bell":
      return { method: "witten_bell" };
    case "jelinek_mercer": {
      const lambda = raw.lambda ?? 0.5;
      assertFinite("smoothing.lambda", lambda);
      if (lambda < 0 || lambda > 1) {
        throw new Error("smoothing.lambda must be in [0, 1]");
      }
      return { method: "jelinek_mercer", lambda };
    }
    default:
      throw new Error(`unknown smoothing method: ${String(raw.method)}`);
  }
}
function sum(values) {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}
function uniform(k) {
  return new Float64Array(k).fill(1 / k);
}
function smoothCounts(counts, smoothing, parentProbability) {
  const k = counts.length;
  const n = sum(counts);
  const parent = parentProbability ?? uniform(k);
  if (n === 0) return parent.slice();
  if (smoothing.method === "laplace") {
    const denominator = n + smoothing.alpha * k;
    if (denominator === 0) return parent.slice();
    return Float64Array.from(counts, (value) => (value + smoothing.alpha) / denominator);
  }
  const mle = Float64Array.from(counts, (value) => value / n);
  if (smoothing.method === "floor") {
    if (smoothing.ymin <= 0) return mle;
    if (smoothing.rule === "cap") {
      const result = Float64Array.from(mle, (value) => Math.max(value, smoothing.ymin));
      const denominator = sum(result);
      for (let i = 0; i < k; i++) result[i] = result[i] / denominator;
      return result;
    }
    if (k * smoothing.ymin >= 1) {
      throw new Error(`floor interpolate smoothing requires ymin < 1/alphabetSize (${1 / k})`);
    }
    let hasZero = false;
    for (let i = 0; i < k; i++) if (mle[i] === 0) hasZero = true;
    if (!hasZero) return mle;
    const scale = 1 - k * smoothing.ymin;
    return Float64Array.from(mle, (value) => scale * value + smoothing.ymin);
  }
  if (smoothing.method === "kneser_ney") {
    const result = Float64Array.from(counts, (value) => Math.max(value - smoothing.discount, 0) / n);
    const backoffWeight = 1 - sum(result);
    for (let i = 0; i < k; i++) result[i] = result[i] + backoffWeight * parent[i];
    return result;
  }
  if (smoothing.method === "witten_bell") {
    let observed = 0;
    for (let i = 0; i < k; i++) if (counts[i] > 0) observed++;
    const lambda = observed / (observed + n);
    return Float64Array.from(mle, (value, i) => (1 - lambda) * value + lambda * parent[i]);
  }
  return Float64Array.from(
    mle,
    (value, i) => (1 - smoothing.lambda) * value + smoothing.lambda * parent[i]
  );
}
function isTNAData(input) {
  return !Array.isArray(input) && "sequenceData" in input;
}
function isTNA(input) {
  return !Array.isArray(input) && "weights" in input && "labels" in input;
}
function inputSequences(input) {
  if (Array.isArray(input)) return input;
  if (isTNAData(input)) return input.sequenceData;
  if (isTNA(input)) {
    if (!input.data) {
      throw new Error("contextTree requires sequence-bearing input; an aggregated TNA matrix is insufficient");
    }
    return input.data;
  }
  throw new Error("unsupported context-tree input");
}
function cleanSequences(data) {
  const sequences = [];
  const indices = [];
  for (let i = 0; i < data.length; i++) {
    const clean = data[i].filter((state) => state !== null && state !== "");
    if (clean.length > 0) {
      sequences.push(clean);
      indices.push(i);
    }
  }
  return { sequences, indices };
}
function resolveWeights(weights, rowCount, indices) {
  if (weights === void 0) return null;
  if (weights.length !== rowCount) throw new Error("weights must have one value per input sequence");
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) throw new Error("weights must be finite and non-negative");
  }
  const kept = indices.map((index) => weights[index]);
  if (sum(kept) <= 0) throw new Error("weights must include at least one positive value");
  const first = kept[0];
  if (kept.every((weight) => weight === first)) return null;
  return kept;
}
function resolveAlphabet(input, data, supplied) {
  if (supplied) {
    if (supplied.length === 0 || new Set(supplied).size !== supplied.length) {
      throw new Error("alphabet must contain unique states and cannot be empty");
    }
    return supplied.slice();
  }
  if (!Array.isArray(input) && "labels" in input && input.labels.length > 0) return input.labels.slice();
  const values = /* @__PURE__ */ new Set();
  for (const sequence of data) for (const state of sequence) if (state !== null && state !== "") values.add(state);
  return [...values].sort();
}
function contextKey(sequence, start, depth) {
  const states = [];
  for (let i = start; i < start + depth; i++) states.push(sequence[i]);
  return states.join(PATH_SEPARATOR);
}
function countContexts(sequences, depth, alphabet, weights) {
  const result = /* @__PURE__ */ new Map();
  const stateIndex = new Map(alphabet.map((state, index) => [state, index]));
  if (depth === 0) result.set(ROOT_CONTEXT, new Float64Array(alphabet.length));
  for (let sequenceIndex = 0; sequenceIndex < sequences.length; sequenceIndex++) {
    const sequence = sequences[sequenceIndex];
    const weight = weights?.[sequenceIndex] ?? 1;
    if (depth === 0) {
      const counts = result.get(ROOT_CONTEXT);
      for (const state of sequence) {
        const index = state === null ? void 0 : stateIndex.get(state);
        if (index !== void 0) counts[index] = counts[index] + weight;
      }
      continue;
    }
    for (let start = 0; start + depth < sequence.length; start++) {
      const next = sequence[start + depth];
      const index = typeof next === "string" ? stateIndex.get(next) : void 0;
      if (index === void 0) continue;
      const key = contextKey(sequence, start, depth);
      let counts = result.get(key);
      if (!counts) {
        counts = new Float64Array(alphabet.length);
        result.set(key, counts);
      }
      counts[index] = counts[index] + weight;
    }
  }
  return result;
}
function parentContext(context) {
  if (context === ROOT_CONTEXT) return null;
  const separator = context.indexOf(PATH_SEPARATOR);
  return separator < 0 ? ROOT_CONTEXT : context.slice(separator + PATH_SEPARATOR.length);
}
function nearestParentProbability(nodes, context) {
  let parent = parentContext(context);
  while (parent !== null) {
    const node = nodes[parent];
    if (node) return node.probability;
    parent = parentContext(parent);
  }
  return null;
}
function buildEdges(nodes) {
  const edges = [];
  for (const context of Object.keys(nodes)) {
    if (context === ROOT_CONTEXT) continue;
    const parent = parentContext(context);
    if (!nodes[parent]) continue;
    const separator = context.indexOf(PATH_SEPARATOR);
    edges.push({
      parent,
      child: context,
      symbol: separator < 0 ? context : context.slice(0, separator)
    });
  }
  return edges;
}
function contextTree(input, options = {}) {
  const requestedDepth = integerOption("maxDepth", options.maxDepth ?? 5, 0);
  const minCount = integerOption("minCount", options.minCount ?? 5, 1);
  const original = inputSequences(input);
  const { sequences, indices } = cleanSequences(original);
  if (sequences.length === 0) throw new Error("no usable sequences after removing missing states");
  const alphabet = resolveAlphabet(input, sequences, options.alphabet);
  const weights = resolveWeights(options.weights, original.length, indices);
  const smoothing = resolveSmoothing(options.smoothing);
  const nodes = {};
  let fittedDepth = requestedDepth;
  for (let depth = 0; depth <= requestedDepth; depth++) {
    const countsAtDepth = countContexts(sequences, depth, alphabet, weights);
    let kept = 0;
    for (const [context, counts] of countsAtDepth) {
      const count = sum(counts);
      if (depth > 0 && count < minCount) continue;
      const probability = smoothCounts(counts, smoothing, nearestParentProbability(nodes, context));
      nodes[context] = { depth, counts, probability, count };
      kept++;
    }
    if (kept === 0) {
      fittedDepth = depth - 1;
      break;
    }
  }
  const root = nodes[ROOT_CONTEXT];
  if (!root) throw new Error("unable to construct root context");
  return {
    nodes,
    edges: buildEdges(nodes),
    alphabet,
    maxDepth: fittedDepth,
    minCount,
    nSequences: sequences.length,
    nObservations: root.count,
    smoothing,
    pruned: false,
    pruning: null,
    data: sequences.map((sequence) => sequence.slice()),
    weights
  };
}
function smoothTree(tree, smoothingSpec = "floor") {
  const smoothing = resolveSmoothing(smoothingSpec);
  const nodes = {};
  const contexts = Object.keys(tree.nodes).sort(
    (left, right) => tree.nodes[left].depth - tree.nodes[right].depth
  );
  for (const context of contexts) {
    const source = tree.nodes[context];
    const counts = source.counts.slice();
    nodes[context] = {
      depth: source.depth,
      counts,
      probability: smoothCounts(counts, smoothing, nearestParentProbability(nodes, context)),
      count: source.count
    };
  }
  return {
    ...tree,
    nodes,
    edges: tree.edges.map((edge) => ({ ...edge })),
    alphabet: tree.alphabet.slice(),
    smoothing,
    data: tree.data.map((sequence) => sequence.slice()),
    weights: tree.weights?.slice() ?? null
  };
}
function matchContext(tree, history) {
  const clean = history.filter((state) => state !== null && state !== "");
  for (let depth = Math.min(tree.maxDepth, clean.length); depth >= 1; depth--) {
    const context = clean.slice(clean.length - depth).join(PATH_SEPARATOR);
    if (tree.nodes[context]) return context;
  }
  return ROOT_CONTEXT;
}
function cloneContextTree(tree) {
  const nodes = {};
  for (const [context, node] of Object.entries(tree.nodes)) {
    nodes[context] = {
      depth: node.depth,
      counts: node.counts.slice(),
      probability: node.probability.slice(),
      count: node.count
    };
  }
  return {
    ...tree,
    nodes,
    edges: tree.edges.map((edge) => ({ ...edge })),
    alphabet: tree.alphabet.slice(),
    pruning: tree.pruning ? { ...tree.pruning } : null,
    data: tree.data.map((sequence) => sequence.slice()),
    weights: tree.weights?.slice() ?? null
  };
}

// src/transitiontrees/analyze.ts
function sum2(values) {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}
function argmax(values) {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}
function klDivergence(p, q, base = Math.E) {
  const denominator = Math.log(base);
  let result = 0;
  for (let i = 0; i < p.length; i++) {
    const pi = p[i];
    if (pi <= 0) continue;
    const qi = q[i];
    if (qi === 0) return Infinity;
    result += pi * Math.log(pi / qi) / denominator;
  }
  return result;
}
function entropy(probability, base) {
  const denominator = Math.log(base);
  let result = 0;
  for (let i = 0; i < probability.length; i++) {
    const value = probability[i];
    if (value > 0) result -= value * Math.log(value) / denominator;
  }
  return result;
}
function normalizePathway(pathway) {
  if (Array.isArray(pathway)) {
    if (pathway.length === 0) return ROOT_CONTEXT;
    return pathway.join(PATH_SEPARATOR);
  }
  const trimmed = pathway.trim();
  return trimmed === ROOT_PATHWAY || trimmed === "(root)" || trimmed === ROOT_CONTEXT ? ROOT_CONTEXT : trimmed;
}
function pathwayParts(pathway) {
  return pathway === ROOT_CONTEXT ? [] : pathway.split(PATH_SEPARATOR);
}
function pathwayExists(tree, pathway) {
  return tree.nodes[normalizePathway(pathway)] !== void 0;
}
function queryPathway(tree, pathway, options = {}) {
  const key = normalizePathway(pathway);
  const exactNode = tree.nodes[key];
  let probability;
  if (exactNode) probability = exactNode.probability.slice();
  else if (options.exact) probability = new Float64Array(tree.alphabet.length).fill(NaN);
  else probability = tree.nodes[matchContext(tree, pathwayParts(key))].probability.slice();
  if (options.nextState === void 0) return probability;
  const index = tree.alphabet.indexOf(options.nextState);
  if (index < 0) throw new Error(`nextState '${options.nextState}' is not in the tree alphabet`);
  return probability[index];
}
function subtree(tree, pathway) {
  const key = normalizePathway(pathway);
  if (!tree.nodes[key]) throw new Error(`pathway '${key}' is not a node in the tree`);
  const children = /* @__PURE__ */ new Map();
  for (const edge of tree.edges) {
    const list = children.get(edge.parent) ?? [];
    list.push(edge.child);
    children.set(edge.parent, list);
  }
  const keep = /* @__PURE__ */ new Set();
  const visit = (context) => {
    keep.add(context);
    for (const child of children.get(context) ?? []) visit(child);
  };
  visit(key);
  const result = cloneContextTree(tree);
  for (const context of Object.keys(result.nodes)) if (!keep.has(context)) delete result.nodes[context];
  result.edges = result.edges.filter((edge) => keep.has(edge.parent) && keep.has(edge.child));
  result.localRoot = key;
  return result;
}
function treePathways(tree, options = {}) {
  const minCount = Math.trunc(options.minCount ?? 1);
  const sortBy = options.sortBy ?? "count";
  const direction = options.decreasing ?? true;
  const rows = [];
  for (const [context, node] of Object.entries(tree.nodes)) {
    if (node.count < minCount) continue;
    const modalIndex = argmax(node.probability);
    const likelyNext = tree.alphabet[modalIndex];
    const parent = parentContext(context);
    const parentNode = parent === null ? void 0 : tree.nodes[parent];
    const parentModal = parentNode ? argmax(parentNode.probability) : -1;
    rows.push({
      pathway: context === ROOT_CONTEXT ? ROOT_PATHWAY : context,
      depth: node.depth,
      count: node.count,
      likelyNext,
      nextProbability: node.probability[modalIndex],
      divergence: parentNode ? klDivergence(node.probability, parentNode.probability, 2) : NaN,
      changesPrediction: parentNode ? modalIndex !== parentModal : null
    });
  }
  const value = (row) => {
    if (sortBy === "depth") return row.depth;
    if (sortBy === "divergence") return Number.isNaN(row.divergence) ? -Infinity : row.divergence;
    return row.count;
  };
  rows.sort((left, right) => direction ? value(right) - value(left) : value(left) - value(right));
  return rows;
}
function commonPathways(tree, options = {}) {
  const rows = treePathways(tree, { minCount: options.minCount, sortBy: "count" });
  const filtered = options.depth === void 0 ? rows : rows.filter((row) => row.depth === options.depth);
  return filtered.slice(0, Math.trunc(options.top ?? 10));
}
function divergentPathways(tree, options = {}) {
  let rows = treePathways(tree, { minCount: options.minCount, sortBy: "divergence" }).filter((row) => !Number.isNaN(row.divergence));
  if (options.flipsOnly) rows = rows.filter((row) => row.changesPrediction === true);
  return rows.slice(0, Math.trunc(options.top ?? 10));
}
function sharpPathways(tree, options = {}) {
  const rows = treePathways(tree, { minCount: options.minCount, sortBy: "count" });
  rows.sort((left, right) => right.nextProbability - left.nextProbability);
  return rows.slice(0, Math.trunc(options.top ?? 10));
}
function treeDependence(tree, options = {}) {
  const base = options.base ?? 2;
  if (!Number.isFinite(base) || base <= 0 || base === 1) throw new Error("base must be positive and not equal to 1");
  const rows = [];
  for (const [context, node] of Object.entries(tree.nodes)) {
    if (context === ROOT_CONTEXT) continue;
    const parent = parentContext(context);
    const parentNode = tree.nodes[parent];
    if (!parentNode) continue;
    const modal = argmax(node.probability);
    const parentModal = argmax(parentNode.probability);
    const nodeEntropy = entropy(node.probability, base);
    const parentEntropy = entropy(parentNode.probability, base);
    rows.push({
      pathway: context,
      depth: node.depth,
      count: node.count,
      divergence: klDivergence(node.probability, parentNode.probability, base),
      entropy: nodeEntropy,
      entropyBefore: parentEntropy,
      entropyDrop: parentEntropy - nodeEntropy,
      likelyNext: tree.alphabet[modal],
      likelyBefore: tree.alphabet[parentModal],
      changesPrediction: modal !== parentModal
    });
  }
  const sortBy = options.sortBy ?? "divergence";
  const value = (row) => {
    if (sortBy === "entropyDrop") return row.entropyDrop;
    return row[sortBy];
  };
  rows.sort((left, right) => value(right) - value(left));
  return options.top === void 0 ? rows : rows.slice(0, Math.trunc(options.top));
}
function predictNext(tree, history) {
  return tree.nodes[matchContext(tree, history)].probability.slice();
}
function predictTree(tree, histories, options = {}) {
  const probabilities = histories.map((history) => predictNext(tree, history));
  if (options.type === "class") {
    return probabilities.map((probability) => tree.alphabet[argmax(probability)]);
  }
  return probabilities;
}
function scorePositions(tree, newData, options = {}) {
  const rows = [];
  for (let sequenceIndex = 0; sequenceIndex < newData.length; sequenceIndex++) {
    const sequence = newData[sequenceIndex].filter(
      (state) => state !== null && state !== ""
    );
    for (let position = 0; position < sequence.length; position++) {
      const observed = sequence[position];
      const stateIndex = tree.alphabet.indexOf(observed);
      if (stateIndex < 0) continue;
      const context = matchContext(tree, sequence.slice(0, position));
      const predictedProbability = tree.nodes[context].probability[stateIndex];
      rows.push({
        sequenceId: sequenceIndex + 1,
        position: position + 1,
        matchedContext: context === ROOT_CONTEXT ? ROOT_PATHWAY : context,
        observed,
        predictedProbability,
        logLikelihood: predictedProbability > 0 ? Math.log(predictedProbability) : -Infinity
      });
    }
  }
  if (options.worst !== void 0) {
    if (!Number.isInteger(options.worst) || options.worst < 1) throw new Error("worst must be a positive integer");
    rows.sort((left, right) => left.predictedProbability - right.predictedProbability);
    return rows.slice(0, options.worst);
  }
  return rows;
}
function scoreSequences(tree, newData) {
  const positions = scorePositions(tree, newData);
  const grouped = /* @__PURE__ */ new Map();
  for (const position of positions) {
    const rows = grouped.get(position.sequenceId) ?? [];
    rows.push(position);
    grouped.set(position.sequenceId, rows);
  }
  return [...grouped].sort((a, b) => a[0] - b[0]).map(([sequenceId, rows]) => {
    const logLikelihood = rows.reduce((total, row) => total + row.logLikelihood, 0);
    return {
      sequenceId,
      nScored: rows.length,
      logLikelihood,
      perplexity: Math.exp(-logLikelihood / rows.length)
    };
  });
}
function childrenByParent(tree) {
  const children = /* @__PURE__ */ new Map();
  for (const edge of tree.edges) {
    const entries = children.get(edge.parent) ?? [];
    entries.push(edge.child);
    children.set(edge.parent, entries);
  }
  return children;
}
function inSampleLikelihood(tree) {
  const children = childrenByParent(tree);
  let value = 0;
  let n = 0;
  for (const [context, node] of Object.entries(tree.nodes)) {
    const unique = node.counts.slice();
    for (const child of children.get(context) ?? []) {
      const childCounts = tree.nodes[child].counts;
      for (let i = 0; i < unique.length; i++) unique[i] = unique[i] - childCounts[i];
    }
    for (let i = 0; i < unique.length; i++) {
      const count = unique[i];
      if (count > 0 && node.probability[i] > 0) value += count * Math.log(node.probability[i]);
      n += count;
    }
  }
  return { value, n };
}
function treeLogLikelihood(tree, newData) {
  const degreesOfFreedom = Object.keys(tree.nodes).length * (tree.alphabet.length - 1);
  if (newData === void 0) {
    const result = inSampleLikelihood(tree);
    return { value: result.value, nObservations: Math.round(result.n), degreesOfFreedom };
  }
  const rows = scorePositions(tree, newData);
  return {
    value: rows.reduce((total, row) => total + row.logLikelihood, 0),
    nObservations: rows.length,
    degreesOfFreedom
  };
}
function treePerplexity(tree, newData) {
  const likelihood = treeLogLikelihood(tree, newData);
  return likelihood.nObservations === 0 ? NaN : Math.exp(-likelihood.value / likelihood.nObservations);
}
function treeModelFit(tree, newData) {
  const likelihood = treeLogLikelihood(tree, newData);
  if (likelihood.nObservations === 0) {
    return { ...likelihood, value: NaN, aic: NaN, bic: NaN, perplexity: NaN };
  }
  return {
    ...likelihood,
    aic: -2 * likelihood.value + 2 * likelihood.degreesOfFreedom,
    bic: -2 * likelihood.value + Math.log(likelihood.nObservations) * likelihood.degreesOfFreedom,
    perplexity: Math.exp(-likelihood.value / likelihood.nObservations)
  };
}
function chiSquareCritical(alpha, degreesOfFreedom) {
  if (degreesOfFreedom <= 0) return 0;
  let low = 0;
  let high = Math.max(1, degreesOfFreedom);
  while (chunkO5U3BFYT_cjs.pchisq(high, degreesOfFreedom) > alpha) high *= 2;
  for (let iteration = 0; iteration < 100; iteration++) {
    const midpoint = (low + high) / 2;
    if (chunkO5U3BFYT_cjs.pchisq(midpoint, degreesOfFreedom) > alpha) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}
function gSquared(counts, parentProbability) {
  const n = sum2(counts);
  if (n === 0) return 0;
  let result = 0;
  for (let i = 0; i < counts.length; i++) {
    const observed = counts[i];
    if (observed <= 0) continue;
    const expected = Math.max(n * parentProbability[i], Number.EPSILON);
    result += 2 * observed * Math.log(observed / expected);
  }
  return result;
}
function leafContexts(tree) {
  const parents = new Set(tree.edges.map((edge) => edge.parent));
  return Object.keys(tree.nodes).filter((context) => context !== ROOT_CONTEXT && !parents.has(context));
}
function pruneTree(tree, options = {}) {
  const criterion = options.criterion ?? "G2";
  if (!["G2", "KL", "AIC", "BIC"].includes(criterion)) throw new Error(`unknown pruning criterion: ${criterion}`);
  const alpha = options.alpha ?? 0.05;
  const threshold = options.threshold ?? 5e-3;
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) throw new Error("alpha must be in (0, 1)");
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error("threshold must be non-negative");
  const result = cloneContextTree(tree);
  const critical = chiSquareCritical(alpha, tree.alphabet.length - 1);
  while (true) {
    const dropped = /* @__PURE__ */ new Set();
    for (const leaf of leafContexts(result)) {
      const parent = parentContext(leaf);
      const childNode = result.nodes[leaf];
      const parentNode = result.nodes[parent];
      if (!parentNode) continue;
      let keep = false;
      if (criterion === "G2") keep = gSquared(childNode.counts, parentNode.probability) > critical;
      else if (criterion === "KL") {
        keep = klDivergence(childNode.probability, parentNode.probability) > threshold;
      } else {
        let childLikelihood = 0;
        let parentLikelihood = 0;
        for (let i = 0; i < childNode.counts.length; i++) {
          const count = childNode.counts[i];
          childLikelihood += count * Math.log(Math.max(childNode.probability[i], Number.EPSILON));
          parentLikelihood += count * Math.log(Math.max(parentNode.probability[i], Number.EPSILON));
        }
        const penalty = tree.alphabet.length - 1;
        if (criterion === "AIC") keep = 2 * penalty - 2 * childLikelihood < -2 * parentLikelihood;
        else keep = Math.log(childNode.count) * penalty - 2 * childLikelihood < -2 * parentLikelihood;
      }
      if (!keep) dropped.add(leaf);
    }
    if (dropped.size === 0) break;
    for (const context of dropped) delete result.nodes[context];
    result.edges = result.edges.filter((edge) => !dropped.has(edge.child));
  }
  result.pruned = true;
  result.pruning = { criterion, alpha, threshold };
  return result;
}
function drawState(tree, probability, rng) {
  const value = rng.random();
  let cumulative = 0;
  for (let i = 0; i < probability.length; i++) {
    cumulative += probability[i];
    if (value < cumulative) return tree.alphabet[i];
  }
  return tree.alphabet[tree.alphabet.length - 1];
}
function generateTreeSequences(tree, options = {}) {
  const n = options.n ?? 5;
  const length = options.length ?? 10;
  if (!Number.isInteger(n) || n < 1) throw new Error("n must be a positive integer");
  if (!Number.isInteger(length) || length < 1) throw new Error("length must be a positive integer");
  if (options.start && options.start.length !== n) throw new Error("start must have length n");
  const rng = new chunkRT5XI5AH_cjs.SeededRNG(options.seed ?? 1);
  const root = tree.nodes[ROOT_CONTEXT];
  const output = [];
  for (let sequenceIndex = 0; sequenceIndex < n; sequenceIndex++) {
    const sequence = [options.start?.[sequenceIndex] ?? drawState(tree, root.probability, rng)];
    while (sequence.length < length) {
      const context = matchContext(tree, sequence);
      sequence.push(drawState(tree, tree.nodes[context].probability, rng));
    }
    output.push(sequence);
  }
  return output;
}
function nTreeNodes(tree) {
  return Object.keys(tree.nodes).length;
}

// src/transitiontrees/advanced.ts
function sum3(values) {
  let result = 0;
  for (let i = 0; i < values.length; i++) result += values[i];
  return result;
}
function argmax2(values) {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}
function kl(p, q, base = Math.E) {
  let result = 0;
  const denominator = Math.log(base);
  for (let i = 0; i < p.length; i++) {
    if (p[i] <= 0) continue;
    if (q[i] <= 0) return Infinity;
    result += p[i] * Math.log(p[i] / q[i]) / denominator;
  }
  return result;
}
function draw(probability, rng) {
  const value = rng.random();
  let cumulative = 0;
  for (let i = 0; i < probability.length; i++) {
    cumulative += probability[i];
    if (value < cumulative) return i;
  }
  return probability.length - 1;
}
function validateProbability(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be in [0, 1]`);
  }
}
function imputeSequences(tree, newData, options = {}) {
  const method = options.method ?? "modal";
  if (method !== "modal" && method !== "probability") throw new Error("unknown imputation method");
  const rng = new chunkRT5XI5AH_cjs.SeededRNG(options.seed ?? 1);
  const fill = (source) => {
    const sequence = source.slice();
    let lastObserved = -1;
    for (let i = 0; i < sequence.length; i++) {
      if (sequence[i] !== null && sequence[i] !== "") lastObserved = i;
    }
    for (let position = 0; position <= lastObserved; position++) {
      if (sequence[position] !== null && sequence[position] !== "") continue;
      const history = sequence.slice(0, position).filter((state) => state !== null && state !== "");
      const probability = predictNext(tree, history);
      const stateIndex = method === "modal" ? argmax2(probability) : draw(probability, rng);
      sequence[position] = tree.alphabet[stateIndex];
    }
    return sequence;
  };
  const nested = newData.length > 0 && Array.isArray(newData[0]);
  return nested ? newData.map(fill) : fill(newData);
}
function mineContexts(tree, state, options = {}) {
  const stateIndex = tree.alphabet.indexOf(state);
  if (stateIndex < 0) throw new Error(`state '${state}' is not in the tree alphabet`);
  const minProbability = options.minProbability ?? 0;
  const maxProbability = options.maxProbability ?? 1;
  const minCount = options.minCount ?? 1;
  validateProbability("minProbability", minProbability);
  validateProbability("maxProbability", maxProbability);
  if (minProbability > maxProbability) throw new Error("minProbability cannot exceed maxProbability");
  if (!Number.isFinite(minCount) || minCount < 0) throw new Error("minCount must be non-negative");
  return Object.entries(tree.nodes).filter(([, node]) => node.count >= minCount).map(([context, node]) => ({
    pathway: context === ROOT_CONTEXT ? ROOT_PATHWAY : context,
    depth: node.depth,
    count: node.count,
    state,
    probability: node.probability[stateIndex],
    isModal: argmax2(node.probability) === stateIndex
  })).filter((row) => row.probability >= minProbability && row.probability <= maxProbability).sort((left, right) => right.probability - left.probability || right.count - left.count);
}
function mineSequences(tree, newData, options = {}) {
  const n = options.n ?? 10;
  if (!Number.isInteger(n) || n < 0) throw new Error("n must be a non-negative integer");
  const direction = options.which ?? "surprising";
  const rows = scoreSequences(tree, newData).slice();
  rows.sort((left, right) => direction === "surprising" ? right.perplexity - left.perplexity : left.perplexity - right.perplexity);
  return rows.slice(0, n);
}
function sameAlphabet(left, right) {
  if (left.alphabet.length !== right.alphabet.length || left.alphabet.some((state) => !right.alphabet.includes(state))) {
    throw new Error("trees have incompatible alphabets");
  }
}
function probabilityAt(tree, context, alphabet) {
  const node = tree.nodes[context] ?? tree.nodes[matchContext(
    tree,
    context === ROOT_CONTEXT ? [] : context.split(PATH_SEPARATOR)
  )];
  return Float64Array.from(alphabet, (state) => node.probability[tree.alphabet.indexOf(state)]);
}
function treeDistanceBreakdown(treeA, treeB) {
  sameAlphabet(treeA, treeB);
  const contexts = [.../* @__PURE__ */ new Set([...Object.keys(treeA.nodes), ...Object.keys(treeB.nodes)])];
  return contexts.map((context) => {
    const probabilityA = probabilityAt(treeA, context, treeA.alphabet);
    const probabilityB = probabilityAt(treeB, context, treeA.alphabet);
    const divergenceAB = kl(probabilityA, probabilityB);
    const divergenceBA = kl(probabilityB, probabilityA);
    return {
      pathway: context === ROOT_CONTEXT ? ROOT_PATHWAY : context,
      countA: treeA.nodes[context]?.count ?? 0,
      countB: treeB.nodes[context]?.count ?? 0,
      divergenceAB,
      divergenceBA,
      divergenceSymmetric: (divergenceAB + divergenceBA) / 2
    };
  });
}
function treeDistance(treeA, treeB, options = {}) {
  const rows = treeDistanceBreakdown(treeA, treeB);
  const totalWeight = rows.reduce((total, row) => total + row.countA + row.countB, 0);
  if (totalWeight === 0) return 0;
  return rows.reduce((total, row) => total + (options.symmetric ?? true ? row.divergenceSymmetric : row.divergenceAB) * (row.countA + row.countB), 0) / totalWeight;
}
function refitLike(data, template) {
  let result = contextTree(data, {
    maxDepth: template.maxDepth,
    minCount: template.minCount,
    smoothing: template.smoothing,
    alphabet: template.alphabet
  });
  if (template.pruned && template.pruning) result = pruneTree(result, template.pruning);
  return result;
}
function compareTrees(treeA, treeB, options = {}) {
  sameAlphabet(treeA, treeB);
  if (treeA.weights || treeB.weights) throw new Error("compareTrees does not support weighted trees");
  const iterations = options.iterations ?? 200;
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("iterations must be a positive integer");
  const symmetric = options.symmetric ?? true;
  const distance = treeDistance(treeA, treeB, { symmetric });
  const pathways = treeDistanceBreakdown(treeA, treeB).sort((left, right) => right.divergenceSymmetric - left.divergenceSymmetric);
  const pooled = [...treeA.data, ...treeB.data].map((sequence) => sequence.slice());
  const sizeA = treeA.data.length;
  const rng = new chunkRT5XI5AH_cjs.SeededRNG(options.seed ?? 1);
  const nullDistribution = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    const order = rng.permutation(pooled.length);
    const sampleA = order.slice(0, sizeA).map((index) => pooled[index]);
    const sampleB = order.slice(sizeA).map((index) => pooled[index]);
    nullDistribution.push(treeDistance(
      refitLike(sampleA, treeA),
      refitLike(sampleB, treeB),
      { symmetric }
    ));
  }
  return {
    distance,
    nullDistribution,
    pValue: (1 + nullDistribution.filter((value) => value >= distance).length) / (iterations + 1),
    pathways
  };
}
function smoothingLabel(spec) {
  const resolved = resolveSmoothing(spec);
  const entries = Object.entries(resolved).filter(([key]) => key !== "method");
  return entries.length === 0 ? resolved.method : `${resolved.method}(${entries.map(([key, value]) => `${key}=${String(value)}`).join(", ")})`;
}
function tuneTree(data, options = {}) {
  const maxDepth = options.maxDepth ?? [2, 3, 4, 5];
  const minCount = options.minCount ?? [3, 5, 10];
  const smoothing = options.smoothing ?? ["floor"];
  const pruning = options.prune ?? [false, true];
  const folds = options.folds ?? 5;
  if (!Number.isInteger(folds) || folds < 2) throw new Error("folds must be an integer >= 2");
  if (data.length < folds) throw new Error(`not enough sequences for ${folds} folds`);
  const alphabet = options.alphabet ?? [...new Set(data.flat().filter((state) => state !== null && state !== ""))].sort();
  const order = new chunkRT5XI5AH_cjs.SeededRNG(options.seed ?? 1).permutation(data.length);
  const foldSets = Array.from({ length: folds }, () => []);
  order.forEach((index, position) => foldSets[position % folds].push(index));
  const rows = [];
  for (const depth of maxDepth) for (const count of minCount) {
    for (const smoother of smoothing) for (const shouldPrune of pruning) {
      let logLikelihood = 0;
      let nScored = 0;
      let nodes = 0;
      let successfulFolds = 0;
      let foldsFailed = 0;
      for (const testIndices of foldSets) {
        const testSet = new Set(testIndices);
        const train = data.filter((_, index) => !testSet.has(index));
        const test = data.filter((_, index) => testSet.has(index));
        try {
          let tree = contextTree(train, { maxDepth: depth, minCount: count, smoothing: smoother, alphabet });
          if (shouldPrune) tree = pruneTree(tree, { criterion: "G2", alpha: options.alpha ?? 0.05 });
          const score = treeLogLikelihood(tree, test);
          if (!Number.isFinite(score.value) || score.nObservations === 0) throw new Error("fold did not score");
          logLikelihood += score.value;
          nScored += score.nObservations;
          nodes += nTreeNodes(tree);
          successfulFolds++;
        } catch {
          foldsFailed++;
        }
      }
      rows.push({
        maxDepth: depth,
        minCount: count,
        smoothing: smoothingLabel(smoother),
        prune: shouldPrune,
        logLikelihood,
        nScored,
        perplexity: nScored > 0 ? Math.exp(-logLikelihood / nScored) : NaN,
        nNodesAverage: successfulFolds > 0 ? nodes / successfulFolds : NaN,
        foldsFailed
      });
    }
  }
  rows.sort((left, right) => {
    if (Number.isNaN(left.perplexity)) return 1;
    if (Number.isNaN(right.perplexity)) return -1;
    return left.perplexity - right.perplexity;
  });
  return { rows, best: rows.find((row) => row.foldsFailed === 0 && Number.isFinite(row.perplexity)) ?? null };
}
function chiSquareCritical2(alpha, degreesOfFreedom) {
  if (degreesOfFreedom <= 0) return 0;
  let low = 0;
  let high = Math.max(1, degreesOfFreedom);
  while (chunkO5U3BFYT_cjs.pchisq(high, degreesOfFreedom) > alpha) high *= 2;
  for (let iteration = 0; iteration < 100; iteration++) {
    const midpoint = (low + high) / 2;
    if (chunkO5U3BFYT_cjs.pchisq(midpoint, degreesOfFreedom) > alpha) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}
function rawCounts(data, context, alphabet) {
  const counts = new Float64Array(alphabet.length);
  const parts = context === ROOT_CONTEXT ? [] : context.split(PATH_SEPARATOR);
  for (const source of data) {
    const sequence = source.filter((state) => state !== null && state !== "");
    if (parts.length === 0) {
      for (const state of sequence) {
        const index = alphabet.indexOf(state);
        if (index >= 0) counts[index] = counts[index] + 1;
      }
      continue;
    }
    for (let start = 0; start + parts.length < sequence.length; start++) {
      if (!parts.every((state, offset) => sequence[start + offset] === state)) continue;
      const index = alphabet.indexOf(sequence[start + parts.length]);
      if (index >= 0) counts[index] = counts[index] + 1;
    }
  }
  return counts;
}
function rawStats(data, contexts, alphabet) {
  const cache = /* @__PURE__ */ new Map();
  const countsFor = (context) => {
    let counts = cache.get(context);
    if (!counts) {
      counts = rawCounts(data, context, alphabet);
      cache.set(context, counts);
    }
    return counts;
  };
  return contexts.map((context) => {
    const counts = countsFor(context);
    const total = sum3(counts);
    if (total === 0) return { count: 0, modal: null, nextProbability: NaN, divergence: NaN, changesPrediction: null, g2: NaN };
    const modal = argmax2(counts);
    const parent = parentContext(context);
    if (parent === null) return { count: total, modal, nextProbability: counts[modal] / total, divergence: NaN, changesPrediction: null, g2: NaN };
    const parentCounts = countsFor(parent);
    const parentTotal = sum3(parentCounts);
    if (parentTotal === 0) return { count: total, modal, nextProbability: counts[modal] / total, divergence: NaN, changesPrediction: null, g2: NaN };
    const probability = Float64Array.from(counts, (value) => value / total);
    const parentProbability = Float64Array.from(parentCounts, (value) => value / parentTotal);
    let g2 = 0;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > 0) g2 += 2 * counts[i] * Math.log(counts[i] / Math.max(total * parentProbability[i], Number.EPSILON));
    }
    return {
      count: total,
      modal,
      nextProbability: counts[modal] / total,
      divergence: kl(probability, parentProbability, 2),
      changesPrediction: modal !== argmax2(parentCounts),
      g2
    };
  });
}
function finite(values) {
  return values.filter(Number.isFinite);
}
function mean(values) {
  const usable = finite(values);
  return usable.length === 0 ? NaN : sum3(usable) / usable.length;
}
function sd(values) {
  const usable = finite(values);
  if (usable.length < 2) return NaN;
  const average = mean(usable);
  return Math.sqrt(usable.reduce((total, value) => total + (value - average) ** 2, 0) / (usable.length - 1));
}
function quantile(values, probability) {
  const usable = finite(values).sort((left, right) => left - right);
  if (usable.length === 0) return NaN;
  const position = (usable.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return usable[lower] + fraction * ((usable[Math.min(lower + 1, usable.length - 1)] ?? usable[lower]) - usable[lower]);
}
function confidenceInterval(values, ciLevel) {
  return [quantile(values, ciLevel / 2), quantile(values, 1 - ciLevel / 2)];
}
function optionRate(name, value) {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new Error(`${name} must be in (0, 1)`);
}
function bootstrapPathways(tree, options = {}) {
  if (tree.weights) throw new Error("bootstrapPathways does not support weighted trees");
  const iterations = options.iterations ?? 1e3;
  if (!Number.isInteger(iterations) || iterations < 2) throw new Error("iterations must be an integer >= 2");
  const statistic = options.statistic ?? "count";
  const consistencyRange = options.consistencyRange ?? [0.5, 1.5];
  const stabilityThreshold = options.stabilityThreshold ?? 0.95;
  const informativeThreshold = options.informativeThreshold ?? 0.8;
  const alpha = options.alpha ?? 0.05;
  const ciLevel = options.ciLevel ?? 0.05;
  optionRate("stabilityThreshold", stabilityThreshold);
  optionRate("informativeThreshold", informativeThreshold);
  optionRate("alpha", alpha);
  optionRate("ciLevel", ciLevel);
  if (consistencyRange.length !== 2 || consistencyRange[0] <= 0 || consistencyRange[1] <= consistencyRange[0]) {
    throw new Error("consistencyRange must contain two increasing positive numbers");
  }
  const seed = options.seed ?? 1;
  const rng = new chunkRT5XI5AH_cjs.SeededRNG(seed);
  const contexts = Object.keys(tree.nodes);
  const original = rawStats(tree.data, contexts, tree.alphabet);
  const matrices = {
    count: [],
    nextProbability: [],
    divergence: [],
    g2: [],
    changesPrediction: []
  };
  for (let iteration = 0; iteration < iterations; iteration++) {
    const sampled = rng.choice(tree.data.length, tree.data.length).map((index) => tree.data[index]);
    const stats = rawStats(sampled, contexts, tree.alphabet);
    matrices.count.push(stats.map((row) => row.count));
    matrices.nextProbability.push(stats.map((row) => row.nextProbability));
    matrices.divergence.push(stats.map((row) => row.divergence));
    matrices.g2.push(stats.map((row) => row.g2));
    matrices.changesPrediction.push(stats.map((row) => row.changesPrediction));
  }
  const critical = chiSquareCritical2(alpha, tree.alphabet.length - 1);
  const pathways = contexts.map((context, index) => ({
    pathway: context === ROOT_CONTEXT ? ROOT_PATHWAY : context,
    depth: tree.nodes[context].depth,
    count: original[index].count,
    likelyNext: original[index].modal === null ? null : tree.alphabet[original[index].modal],
    nextProbability: original[index].nextProbability,
    divergence: original[index].divergence,
    changesPrediction: original[index].changesPrediction,
    g2: original[index].g2
  }));
  const selectedMatrix = (name) => {
    if (name === "nextProbability") return matrices.nextProbability;
    if (name === "divergence") return matrices.divergence;
    return matrices.count;
  };
  const selectedOriginal = (row) => statistic === "count" ? row.count : statistic === "nextProbability" ? row.nextProbability : row.divergence;
  const summary = pathways.map((pathway, index) => {
    const values = selectedMatrix(statistic).map((row) => row[index]);
    const observed = selectedOriginal(original[index]);
    const low = Math.min(observed * consistencyRange[0], observed * consistencyRange[1]);
    const high = Math.max(observed * consistencyRange[0], observed * consistencyRange[1]);
    const inside = Number.isFinite(observed) ? values.filter((value) => value >= low && value <= high).length : 0;
    const pStability = Number.isFinite(observed) ? (iterations - inside + 1) / (iterations + 1) : NaN;
    const g2Values = matrices.g2.map((row) => row[index]);
    const informativeCount = g2Values.filter((value) => Number.isFinite(value) && value > critical).length;
    const informativeRate = Number.isFinite(original[index].g2) ? informativeCount / iterations : NaN;
    const flipValues = matrices.changesPrediction.map((row) => row[index]).filter((value) => value !== null);
    const flipConsistency = original[index].changesPrediction === null || flipValues.length === 0 ? NaN : flipValues.filter((value) => value === original[index].changesPrediction).length / flipValues.length;
    const countValues = matrices.count.map((row) => row[index]);
    const probabilityValues = matrices.nextProbability.map((row) => row[index]);
    const divergenceValues = matrices.divergence.map((row) => row[index]);
    return {
      ...pathway,
      pStability,
      stabilityRate: Number.isFinite(observed) ? inside / iterations : NaN,
      stable: Number.isFinite(pStability) && pStability < 1 - stabilityThreshold,
      informativeRate,
      informative: Number.isFinite(informativeRate) && informativeRate >= informativeThreshold,
      flipConsistency,
      meanCount: mean(countValues),
      sdCount: sd(countValues),
      countCI: confidenceInterval(countValues, ciLevel),
      meanNextProbability: mean(probabilityValues),
      sdNextProbability: sd(probabilityValues),
      nextProbabilityCI: confidenceInterval(probabilityValues, ciLevel),
      meanDivergence: mean(divergenceValues),
      sdDivergence: sd(divergenceValues),
      divergenceCI: confidenceInterval(divergenceValues, ciLevel),
      meanG2: mean(g2Values),
      sdG2: sd(g2Values),
      g2CI: confidenceInterval(g2Values, ciLevel)
    };
  });
  summary.sort((left, right) => Number(right.stable) + Number(right.informative) - Number(left.stable) - Number(left.informative) || (Number.isFinite(right.stabilityRate) ? right.stabilityRate : 0) - (Number.isFinite(left.stabilityRate) ? left.stabilityRate : 0) || right.count - left.count);
  return {
    pathways,
    summary,
    resamples: options.keepResamples === false ? null : matrices,
    iterations,
    statistic,
    consistencyRange: [...consistencyRange],
    stabilityThreshold,
    informativeThreshold,
    alpha,
    ciLevel,
    g2CriticalValue: critical,
    seed
  };
}

// src/transitiontrees/workflows.ts
function sum4(values) {
  let result = 0;
  for (let i = 0; i < values.length; i++) result += values[i];
  return result;
}
function argmax3(values) {
  let result = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[result]) result = i;
  return result;
}
function requireColumn(data, column) {
  if (!data.every((row) => Object.hasOwn(row, column))) throw new Error(`'${column}' is not a column of data`);
}
function numericTime(value, unit) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("time contains a non-finite value");
    return value / (unit === "seconds" ? 1 : unit === "milliseconds" ? 1e3 : 1e6);
  }
  if (value instanceof Date) return value.getTime() / 1e3;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error(`could not parse time value '${String(value)}'`);
  return parsed / 1e3;
}
function prepareTreeInput(data, options) {
  if (!Array.isArray(data) || data.length === 0) throw new Error("data must contain at least one event");
  requireColumn(data, options.action);
  const actorColumns = options.actor === void 0 ? [] : Array.isArray(options.actor) ? options.actor : [options.actor];
  for (const column of [...actorColumns, options.time, options.order, options.session, ...options.metadata ?? []]) {
    if (column !== void 0) requireColumn(data, column);
  }
  const timeThreshold = options.timeThreshold ?? 900;
  if (!Number.isFinite(timeThreshold) || timeThreshold < 0) throw new Error("timeThreshold must be non-negative");
  const actor = (row) => actorColumns.length === 0 ? "session" : actorColumns.map((column) => String(row[column])).join("-");
  const entries = data.map((row, index) => ({
    row,
    index,
    actor: actor(row),
    time: options.time === void 0 ? null : numericTime(row[options.time], options.unixTimeUnit ?? "seconds"),
    order: options.order === void 0 ? index : row[options.order]
  }));
  const compare = (left, right) => {
    const byActor = left.actor.localeCompare(right.actor);
    if (byActor !== 0) return byActor;
    if (options.session) {
      const bySession = String(left.row[options.session]).localeCompare(String(right.row[options.session]));
      if (bySession !== 0) return bySession;
    }
    if (left.time !== null && right.time !== null && left.time !== right.time) return left.time - right.time;
    const l = left.order;
    const r = right.order;
    if (typeof l === "number" && typeof r === "number") return l - r;
    return String(l).localeCompare(String(r));
  };
  entries.sort(compare);
  const groups = /* @__PURE__ */ new Map();
  const sessionNumber = /* @__PURE__ */ new Map();
  let previous = null;
  for (const entry of entries) {
    let id;
    if (options.session) id = `${entry.actor} | ${String(entry.row[options.session])}`;
    else if (options.time) {
      const starts = previous === null || previous.actor !== entry.actor || entry.time === null || previous.time === null || entry.time - previous.time > timeThreshold;
      if (starts) sessionNumber.set(entry.actor, (sessionNumber.get(entry.actor) ?? 0) + 1);
      const number2 = sessionNumber.get(entry.actor);
      id = actorColumns.length === 0 ? `session${number2}` : `${entry.actor} session${number2}`;
    } else id = entry.actor;
    const rows = groups.get(id) ?? [];
    rows.push(entry);
    groups.set(id, rows);
    previous = entry;
  }
  const sessionIds = [...groups.keys()].sort();
  const maxLength = Math.max(...sessionIds.map((id) => groups.get(id).length));
  const sequences = sessionIds.map((id) => {
    const sequence = groups.get(id).map((entry) => String(entry.row[options.action]));
    return [...sequence, ...new Array(maxLength - sequence.length).fill(null)];
  });
  const metadata = options.metadata ? sessionIds.map((id) => Object.fromEntries(options.metadata.map((column) => [column, groups.get(id)[0].row[column]]))) : null;
  return { sequences, sessionIds, metadata };
}
function compareSmoothing(input, options = {}) {
  const smoothing = options.smoothing ?? ["floor", "laplace", "kneser_ney", "witten_bell", "jelinek_mercer"];
  return smoothing.map((method) => {
    const tree = Array.isArray(input) ? contextTree(input, { ...options, smoothing: method }) : smoothTree(input, method);
    return { smoothing: method, nNodes: nTreeNodes(tree), perplexity: treePerplexity(tree) };
  });
}
function comparePruning(tree, options = {}) {
  const criteria = options.criteria ?? ["G2", "KL", "AIC", "BIC"];
  const original = nTreeNodes(tree);
  return criteria.map((criterion) => {
    const nodes = nTreeNodes(pruneTree(tree, { criterion, alpha: options.alpha, threshold: options.threshold }));
    return {
      criterion,
      nNodes: nodes,
      reductionPercent: Math.round(1e3 * (1 - nodes / original)) / 10
    };
  });
}
function contextTreeGroups(data, groups, options = {}) {
  if (groups.length !== data.length) throw new Error("groups must have one value per sequence");
  if (options.block && options.block.length !== data.length) throw new Error("block must have one value per sequence");
  const groupNames = [...new Set(groups.map(String))].sort();
  const alphabet = options.alphabet ?? [...new Set(data.flat().filter((state) => state !== null && state !== ""))].sort();
  const trees = {};
  for (const name of groupNames) {
    const subset = data.filter((_, index) => String(groups[index]) === name);
    trees[name] = contextTree(subset, { ...options, alphabet });
  }
  return { trees, groupNames, groupVariable: options.groupVariable, block: options.block?.slice() };
}
function contextDepth(context) {
  return context === ROOT_CONTEXT ? 0 : context.split(" -> ").length;
}
function contextCounts(data, context, alphabet) {
  const counts = new Float64Array(alphabet.length);
  const parts = context === ROOT_CONTEXT ? [] : context.split(" -> ");
  for (const raw of data) {
    const sequence = raw.filter((state) => state !== null && state !== "");
    if (parts.length === 0) {
      for (const state of sequence) {
        const index = alphabet.indexOf(state);
        if (index >= 0) counts[index] = counts[index] + 1;
      }
    } else for (let start = 0; start + parts.length < sequence.length; start++) {
      if (!parts.every((state, offset) => sequence[start + offset] === state)) continue;
      const index = alphabet.indexOf(sequence[start + parts.length]);
      if (index >= 0) counts[index] = counts[index] + 1;
    }
  }
  return counts;
}
function entropyBits(probability) {
  let result = 0;
  for (let i = 0; i < probability.length; i++) if (probability[i] > 0) result -= probability[i] * Math.log2(probability[i]);
  return result;
}
function jsdBits(rows) {
  const totals = rows.map(sum4);
  const grand = sum4(totals);
  if (totals.filter((total) => total > 0).length < 2 || grand === 0) return 0;
  const mixture = new Float64Array(rows[0].length);
  let within = 0;
  for (let group = 0; group < rows.length; group++) {
    if (totals[group] === 0) continue;
    const weight = totals[group] / grand;
    const probability = Float64Array.from(rows[group], (value) => value / totals[group]);
    within += weight * entropyBits(probability);
    for (let state = 0; state < mixture.length; state++) mixture[state] = mixture[state] + weight * probability[state];
  }
  return Math.max(entropyBits(mixture) - within, 0);
}
function usageG2(counts, opportunities) {
  const table = counts.map((count, index) => [count, Math.max(opportunities[index] - count, 0)]);
  const rowTotals = table.map((row) => row[0] + row[1]);
  const columnTotals = [sum4(table.map((row) => row[0])), sum4(table.map((row) => row[1]))];
  const grand = sum4(rowTotals);
  if (grand === 0) return 0;
  let result = 0;
  for (let row = 0; row < table.length; row++) for (let column = 0; column < 2; column++) {
    const observed = table[row][column];
    const expected = rowTotals[row] * columnTotals[column] / grand;
    if (observed > 0 && expected > 0) result += 2 * observed * Math.log(observed / expected);
  }
  return result;
}
function adjustBH(values) {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array(values.length);
  let previous = 1;
  for (let rank = indexed.length - 1; rank >= 0; rank--) {
    previous = Math.min(previous, indexed[rank].value * indexed.length / (rank + 1));
    result[indexed[rank].index] = previous;
  }
  return result;
}
function groupStats(data, labels, names, contexts, alphabet) {
  const byGroup = names.map((name) => data.filter((_, index) => labels[index] === name));
  const counts = contexts.map((context) => byGroup.map((subset) => contextCounts(subset, context, alphabet)));
  const depths = contexts.map(contextDepth);
  const opportunities = names.map((_, groupIndex) => {
    const totals = /* @__PURE__ */ new Map();
    for (let i = 0; i < contexts.length; i++) totals.set(depths[i], (totals.get(depths[i]) ?? 0) + sum4(counts[i][groupIndex]));
    return totals;
  });
  const jsd = counts.map(jsdBits);
  const usage = counts.map((rows, index) => usageG2(
    rows.map(sum4),
    opportunities.map((totals) => totals.get(depths[index]) ?? 0)
  ));
  return {
    counts,
    jsd,
    usage,
    behavioral: jsd.reduce((total, value, index) => total + value * sum4(counts[index].map(sum4)), 0),
    usageTotal: sum4(usage)
  };
}
function compareGroups(group, options = {}) {
  const names = group.groupNames;
  if (names.length < 2) throw new Error("at least two groups are required");
  for (const name of names) if (group.trees[name].weights) throw new Error("compareGroups does not support weighted trees");
  const iterations = options.iterations ?? 999;
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("iterations must be a positive integer");
  const minCount = options.minCount ?? 1;
  const seed = options.seed ?? 1;
  const alphabet = group.trees[names[0]].alphabet;
  const data = names.flatMap((name) => group.trees[name].data.map((sequence) => sequence.slice()));
  const labels = names.flatMap((name) => group.trees[name].data.map(() => name));
  const contexts = [...new Set(names.flatMap((name) => Object.keys(group.trees[name].nodes)))];
  if (!contexts.includes(ROOT_CONTEXT)) contexts.unshift(ROOT_CONTEXT);
  const observed = groupStats(data, labels, names, contexts, alphabet);
  const block = options.block ?? group.block;
  if (block && block.length !== data.length) throw new Error("block must have one value per pooled sequence");
  const rng = new chunkRT5XI5AH_cjs.SeededRNG(seed);
  const exceedJsd = new Array(contexts.length).fill(0);
  const exceedUsage = new Array(contexts.length).fill(0);
  let exceedBehavioral = 0;
  let exceedUsageTotal = 0;
  const permuteLabels = () => {
    if (!block) return rng.shuffle(labels.slice());
    const result = labels.slice();
    const indices = /* @__PURE__ */ new Map();
    block.forEach((value, index) => indices.set(String(value), [...indices.get(String(value)) ?? [], index]));
    for (const subset of indices.values()) {
      const shuffled = rng.shuffle(subset.map((index) => labels[index]));
      subset.forEach((index, position) => {
        result[index] = shuffled[position];
      });
    }
    return result;
  };
  for (let iteration = 0; iteration < iterations; iteration++) {
    const candidate = groupStats(data, permuteLabels(), names, contexts, alphabet);
    contexts.forEach((_, index) => {
      if (candidate.jsd[index] >= observed.jsd[index] - 1e-12) exceedJsd[index] = exceedJsd[index] + 1;
      if (candidate.usage[index] >= observed.usage[index] - 1e-12) exceedUsage[index] = exceedUsage[index] + 1;
    });
    if (candidate.behavioral >= observed.behavioral - 1e-12) exceedBehavioral++;
    if (candidate.usageTotal >= observed.usageTotal - 1e-12) exceedUsageTotal++;
  }
  const jsdP = exceedJsd.map((count) => (count + 1) / (iterations + 1));
  const usageP = exceedUsage.map((count) => (count + 1) / (iterations + 1));
  const jsdAdjusted = adjustBH(jsdP);
  const nonRootIndices = contexts.map((context, index) => context === ROOT_CONTEXT ? -1 : index).filter((index) => index >= 0);
  const usageAdjustedValues = adjustBH(nonRootIndices.map((index) => usageP[index]));
  const usageAdjusted = new Array(contexts.length).fill(NaN);
  nonRootIndices.forEach((index, position) => {
    usageAdjusted[index] = usageAdjustedValues[position];
  });
  const pathways = contexts.map((context, index) => {
    const counts = Object.fromEntries(names.map((name, groupIndex) => [name, sum4(observed.counts[index][groupIndex])]));
    const modalNext = Object.fromEntries(names.map((name, groupIndex) => {
      const row = observed.counts[index][groupIndex];
      return [name, sum4(row) === 0 ? null : alphabet[argmax3(row)]];
    }));
    const represented = Object.values(modalNext).filter((state) => state !== null);
    return {
      pathway: context === ROOT_CONTEXT ? ROOT_PATHWAY : context,
      depth: contextDepth(context),
      countTotal: sum4(Object.values(counts)),
      counts,
      modalNext,
      flips: new Set(represented).size > 1,
      jsdBits: observed.jsd[index],
      jsdPValue: jsdP[index],
      jsdAdjustedPValue: jsdAdjusted[index],
      usageG2: context === ROOT_CONTEXT ? NaN : observed.usage[index],
      usagePValue: context === ROOT_CONTEXT ? NaN : usageP[index],
      usageAdjustedPValue: usageAdjusted[index]
    };
  }).filter((row) => row.countTotal >= minCount).sort((left, right) => right.jsdBits - left.jsdBits || right.usageG2 - left.usageG2);
  const distanceMatrix = {};
  for (const left of names) {
    distanceMatrix[left] = {};
    for (const right of names) distanceMatrix[left][right] = left === right ? 0 : treeDistance(group.trees[left], group.trees[right]);
  }
  return {
    pathways,
    omnibus: [
      { axis: "behavioral", statistic: "count-weighted JSD (bits)", value: observed.behavioral, pValue: (exceedBehavioral + 1) / (iterations + 1) },
      { axis: "usage", statistic: "sum G2", value: observed.usageTotal, pValue: (exceedUsageTotal + 1) / (iterations + 1) }
    ],
    distanceMatrix,
    groups: names.slice(),
    iterations,
    seed,
    nContexts: pathways.length,
    stratified: block !== void 0
  };
}

// src/transitiontrees/visualize.ts
var COLORS = ["#63d7c0", "#8da7ff", "#ffbd69", "#ef7fa5", "#9add67", "#b98cff", "#5fc4ee", "#ff826d"];
var BG = "var(--tt-bg)";
var GRID = "var(--tt-grid)";
var TEXT = "var(--tt-text)";
var MUTED = "var(--tt-muted)";
var ORANGE = "#ff9f43";
function escape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
function number(value, digits = 3) {
  if (Number.isNaN(value)) return "NA";
  if (!Number.isFinite(value)) return "\u221E";
  return value.toFixed(digits).replace(/\.?0+$/, "");
}
function svg(width, height, content, label, theme = "light") {
  const variables = theme === "light" ? "--tt-bg:#ffffff;--tt-text:#142638;--tt-muted:#536b80;--tt-grid:#d8e1e8" : "--tt-bg:#081421;--tt-text:#dce9f6;--tt-muted:#91a8bf;--tt-grid:#274159";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="${variables}" role="img" aria-label="${escape(label)}"><style>
    .tt-text{font-family:Inter,ui-sans-serif,system-ui,sans-serif;fill:${TEXT}} .tt-muted{fill:${MUTED}}
    .tt-axis{stroke:${GRID};stroke-width:1}.tt-label{font-size:12px}.tt-small{font-size:10px}
  </style><rect width="${width}" height="${height}" rx="16" fill="${BG}"/>${content}</svg>`;
}
function title(text, width) {
  return `<text class="tt-text" x="24" y="30" font-size="16" font-weight="700">${escape(text)}</text><line class="tt-axis" x1="24" y1="42" x2="${width - 24}" y2="42"/>`;
}
function color(index) {
  return COLORS[index % COLORS.length];
}
function mixHex(from, to, amount) {
  const value = Math.max(0, Math.min(1, amount));
  const channel = (hex, offset) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  const mixed = [1, 3, 5].map((offset) => Math.round(channel(from, offset) + (channel(to, offset) - channel(from, offset)) * value));
  return `#${mixed.map((entry) => entry.toString(16).padStart(2, "0")).join("")}`;
}
function stateOf(context) {
  if (context === ROOT_CONTEXT) return ROOT_PATHWAY;
  const parts = context.split(PATH_SEPARATOR);
  return parts[parts.length - 1];
}
function stateColor(tree, context) {
  if (context === ROOT_CONTEXT) return "#d9e5f2";
  return color(Math.max(tree.alphabet.indexOf(stateOf(context)), 0));
}
function treeLayout(tree, width, height, keep) {
  const shown = (context) => !keep || keep.has(context);
  const children = /* @__PURE__ */ new Map();
  for (const edge of tree.edges) {
    if (!shown(edge.parent) || !shown(edge.child)) continue;
    children.set(edge.parent, [...children.get(edge.parent) ?? [], edge.child]);
  }
  for (const list of children.values()) list.sort((left, right) => tree.nodes[right].count - tree.nodes[left].count);
  let leaf = 0;
  const positions = /* @__PURE__ */ new Map();
  const visit = (context) => {
    const descendants = children.get(context) ?? [];
    if (descendants.length === 0) {
      const value2 = leaf++;
      positions.set(context, value2);
      return value2;
    }
    const values = descendants.map(visit);
    const value = values.reduce((sum5, item) => sum5 + item, 0) / values.length;
    positions.set(context, value);
    return value;
  };
  visit(tree.localRoot ?? ROOT_CONTEXT);
  const maxLeaf = Math.max(leaf - 1, 1);
  const maxDepth = Math.max(...[...positions.keys()].map((context) => tree.nodes[context].depth), 1);
  return [...positions].map(([context, row]) => ({
    context,
    x: 54 + tree.nodes[context].depth / maxDepth * (width - 300),
    y: 68 + row / maxLeaf * (height - 104)
  }));
}
function horizontalTree(tree, options) {
  const width = options.width ?? 980;
  const allContexts = Object.keys(tree.nodes);
  const cap = options.maxNodes ?? Infinity;
  const keep = allContexts.length > cap ? new Set(allContexts.slice().sort((a, b) => tree.nodes[b].count - tree.nodes[a].count).slice(0, cap)) : void 0;
  const count = keep ? keep.size : allContexts.length;
  const height = options.height ?? Math.max(430, count * 16);
  const points = treeLayout(tree, width, height, keep);
  const lookup = new Map(points.map((point) => [point.context, point]));
  const maximum = Math.max(...Object.values(tree.nodes).map((node) => node.count));
  const edges = tree.edges.map((edge) => {
    const from = lookup.get(edge.parent);
    const to = lookup.get(edge.child);
    if (!from || !to) return "";
    const thickness = 0.7 + 5 * Math.sqrt(tree.nodes[edge.child].count / maximum);
    const middle = (from.x + to.x) / 2;
    return `<path d="M${from.x},${from.y} C${middle},${from.y} ${middle},${to.y} ${to.x},${to.y}" fill="none" stroke="#50728d" stroke-width="${thickness}" opacity=".72"><title>${escape(edge.child)} \xB7 n=${number(tree.nodes[edge.child].count, 1)}</title></path>`;
  }).join("");
  const nodes = points.map((point) => {
    const node = tree.nodes[point.context];
    const radius = 4 + 7 * Math.sqrt(node.count / maximum);
    const modal = tree.alphabet[node.probability.indexOf(Math.max(...node.probability))];
    const label = point.context === ROOT_CONTEXT ? ROOT_PATHWAY : point.context;
    return `<g><circle cx="${point.x}" cy="${point.y}" r="${radius}" fill="${stateColor(tree, point.context)}" stroke="#e8f2fb" stroke-width="1.2"><title>${escape(label)} \xB7 n=${number(node.count, 1)} \xB7 next ${escape(modal)} (${number(Math.max(...node.probability))})</title></circle>${options.showLabels === false ? "" : `<text class="tt-text tt-small" x="${point.x + radius + 7}" y="${point.y + 4}">${escape(label)} \u2192 ${escape(modal)}</text>`}</g>`;
  }).join("");
  return svg(width, height, title(options.title ?? "Horizontal prediction suffix tree", width) + edges + nodes, "Horizontal prediction suffix tree", options.theme);
}
function radialTree(tree, options) {
  const width = options.width ?? 760;
  const height = options.height ?? 700;
  const base = treeLayout(tree, 800, 700);
  const maxDepth = Math.max(...base.map((point) => tree.nodes[point.context].depth), 1);
  const minY = Math.min(...base.map((point) => point.y));
  const maxY = Math.max(...base.map((point) => point.y));
  const centerX = width / 2;
  const centerY = height / 2 + 12;
  const maximumRadius = Math.min(width, height) * 0.4;
  const points = base.map((point) => {
    const angle = (point.y - minY) / Math.max(maxY - minY, 1) * Math.PI * 2 - Math.PI / 2;
    const radius = tree.nodes[point.context].depth / maxDepth * maximumRadius;
    return { context: point.context, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
  });
  const lookup = new Map(points.map((point) => [point.context, point]));
  const maximum = Math.max(...Object.values(tree.nodes).map((node) => node.count));
  const edges = tree.edges.map((edge) => {
    const from = lookup.get(edge.parent);
    const to = lookup.get(edge.child);
    if (!from || !to) return "";
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#567792" opacity=".7" stroke-width="${0.7 + 5 * Math.sqrt(tree.nodes[edge.child].count / maximum)}"/>`;
  }).join("");
  const nodes = points.map((point) => {
    const node = tree.nodes[point.context];
    const modal = tree.alphabet[node.probability.indexOf(Math.max(...node.probability))];
    return `<circle cx="${point.x}" cy="${point.y}" r="${4 + 8 * Math.sqrt(node.count / maximum)}" fill="${stateColor(tree, point.context)}" stroke="#eff7ff"><title>${escape(point.context === ROOT_CONTEXT ? ROOT_PATHWAY : point.context)} \xB7 n=${number(node.count, 1)} \xB7 next ${escape(modal)}</title></circle>`;
  }).join("");
  return svg(width, height, title(options.title ?? "Radial dendrogram", width) + edges + nodes, "Radial context-tree dendrogram", options.theme);
}
function icicleTree(tree, options) {
  const width = options.width ?? 900;
  const height = options.height ?? 580;
  const children = /* @__PURE__ */ new Map();
  for (const edge of tree.edges) children.set(edge.parent, [...children.get(edge.parent) ?? [], edge.child]);
  const partitions = [];
  const visit = (context, start, end) => {
    partitions.push({ context, start, end });
    const descendants = children.get(context) ?? [];
    const total = descendants.reduce((value, child) => value + tree.nodes[child].count, 0);
    let cursor = start;
    for (const child of descendants) {
      const next = total === 0 ? cursor : cursor + (end - start) * tree.nodes[child].count / total;
      visit(child, cursor, next);
      cursor = next;
    }
  };
  visit(tree.localRoot ?? ROOT_CONTEXT, 0, 1);
  const maxDepth = Math.max(...partitions.map((item) => tree.nodes[item.context].depth), 1);
  const left = 26;
  const top = 58;
  const plotWidth = width - 52;
  const plotHeight = height - 86;
  const cells = partitions.map((item) => {
    const depth = tree.nodes[item.context].depth;
    const x = left + depth / (maxDepth + 1) * plotWidth;
    const cellWidth = plotWidth / (maxDepth + 1) - 3;
    const y = top + item.start * plotHeight;
    const cellHeight = Math.max((item.end - item.start) * plotHeight - 2, 1);
    const label = item.context === ROOT_CONTEXT ? ROOT_PATHWAY : item.context;
    return `<g><rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" rx="3" fill="${stateColor(tree, item.context)}" opacity="${0.45 + 0.5 * (depth + 1) / (maxDepth + 1)}"><title>${escape(label)} \xB7 n=${number(tree.nodes[item.context].count, 1)}</title></rect>${cellHeight > 15 && options.showLabels !== false ? `<text class="tt-text tt-small" x="${x + 6}" y="${y + Math.min(cellHeight / 2 + 4, 16)}">${escape(stateOf(item.context))}</text>` : ""}</g>`;
  }).join("");
  return svg(width, height, title(options.title ?? "Count-proportional icicle", width) + cells, "Count-proportional context-tree icicle", options.theme);
}
function plotTree(tree, options = {}) {
  if ((options.style ?? "horizontal") === "dendrogram") return radialTree(tree, options);
  if (options.style === "icicle") return icicleTree(tree, options);
  return horizontalTree(tree, options);
}
function plotPathways(tree, options = {}) {
  const rows = treePathways(tree, { sortBy: options.sortBy ?? "count", minCount: options.minCount }).slice(0, options.top ?? 12);
  const width = options.width ?? 900;
  const rowHeight = 28;
  const height = options.height ?? 78 + rows.length * rowHeight;
  const labelWidth = 260;
  const cellWidth = (width - labelWidth - 28) / tree.alphabet.length;
  const cells = rows.map((row, rowIndex) => {
    const context = row.pathway === ROOT_PATHWAY ? ROOT_CONTEXT : row.pathway;
    const node = tree.nodes[context];
    const modal = node.probability.indexOf(Math.max(...node.probability));
    const prefix = row.changesPrediction ? "\u203A " : "";
    const label = `<text class="tt-text tt-small" x="20" y="${70 + rowIndex * rowHeight}">${escape(prefix + row.pathway)}</text>`;
    return label + tree.alphabet.map((state, stateIndex) => {
      const probability = node.probability[stateIndex];
      const x = labelWidth + stateIndex * cellWidth;
      const y = 52 + rowIndex * rowHeight;
      return `<g><rect x="${x}" y="${y}" width="${cellWidth - 3}" height="${rowHeight - 3}" rx="3" fill="${color(stateIndex)}" opacity="${0.08 + 0.92 * probability}"><title>${escape(row.pathway)} \xB7 P(${escape(state)})=${number(probability)}</title></rect><text class="tt-text tt-small" x="${x + cellWidth / 2}" y="${y + 17}" text-anchor="middle" font-weight="${stateIndex === modal ? 800 : 400}">${number(probability, 2)}</text></g>`;
    }).join("");
  }).join("");
  const headers = tree.alphabet.map((state, index) => `<text class="tt-muted tt-small" x="${labelWidth + index * cellWidth + cellWidth / 2}" y="42" text-anchor="middle">${escape(state)}</text>`).join("");
  return svg(width, height, title(options.title ?? "Next-state probability by context", width) + headers + cells, "Next-state probability heatmap", options.theme);
}
function plotDivergence(tree, options = {}) {
  const rows = treePathways(tree, { sortBy: "divergence", minCount: options.minCount }).filter((row) => Number.isFinite(row.divergence)).slice(0, options.top ?? 12);
  const width = options.width ?? 900;
  const height = options.height ?? 76 + rows.length * 30;
  const left = 250;
  const right = 35;
  const maximum = Math.max(...rows.map((row) => row.divergence), 1e-9);
  const marks = rows.map((row, index) => {
    const y = 62 + index * 30;
    const x = left + row.divergence / maximum * (width - left - right);
    return `<text class="tt-text tt-small" x="18" y="${y + 4}">${escape(row.pathway)}</text><line x1="${left}" y1="${y}" x2="${x}" y2="${y}" stroke="#617f98" stroke-width="2"/><circle cx="${x}" cy="${y}" r="6" fill="${row.changesPrediction ? ORANGE : "#67d6c0"}"><title>KL=${number(row.divergence)} \xB7 n=${number(row.count, 1)}</title></circle>`;
  }).join("");
  return svg(width, height, title(options.title ?? "Divergence from shorter-history prediction", width) + `<line class="tt-axis" x1="${left}" y1="50" x2="${left}" y2="${height - 18}"/>` + marks, "Context divergence lollipop chart", options.theme);
}
function plotDistributions(tree, options = {}) {
  const rows = treePathways(tree, { sortBy: options.sortBy ?? "count", minCount: options.minCount }).slice(0, options.top ?? 8);
  const width = options.width ?? 900;
  const height = options.height ?? 70 + rows.length * 44;
  const left = 250;
  const plotWidth = width - left - 35;
  const marks = rows.map((row, index) => {
    const context = row.pathway === ROOT_PATHWAY ? ROOT_CONTEXT : row.pathway;
    const probability = tree.nodes[context].probability;
    let cursor = left;
    const bars = tree.alphabet.map((state, stateIndex) => {
      const segmentWidth = probability[stateIndex] * plotWidth;
      const result = `<rect x="${cursor}" y="${54 + index * 44}" width="${Math.max(segmentWidth, 0.5)}" height="26" fill="${color(stateIndex)}"><title>${escape(state)} ${number(probability[stateIndex])}</title></rect>`;
      cursor += segmentWidth;
      return result;
    }).join("");
    return `<text class="tt-text tt-small" x="18" y="${71 + index * 44}">${escape(row.pathway)}</text>${bars}`;
  }).join("");
  const legend = tree.alphabet.map((state, index) => `<rect x="${left + index * 125}" y="${height - 18}" width="10" height="10" fill="${color(index)}"/><text class="tt-muted tt-small" x="${left + 15 + index * 125}" y="${height - 9}">${escape(state)}</text>`).join("");
  return svg(width, height + 12, title(options.title ?? "Per-context next-state distributions", width) + marks + legend, "Per-context probability distributions", options.theme);
}
function plotPruning(tree, pathway, pruned, options = {}) {
  const normalized = pathway === ROOT_PATHWAY ? ROOT_CONTEXT : pathway;
  if (!tree.nodes[normalized]) throw new Error(`pathway '${pathway}' is not in the source tree`);
  const chain = [];
  let current = normalized;
  while (current !== null) {
    chain.push(current);
    current = parentContext(current);
  }
  const width = options.width ?? 920;
  const height = options.height ?? 100 + chain.length * 58;
  const marks = chain.map((context, index) => {
    const node = tree.nodes[context];
    const kept = pruned.nodes[context] !== void 0;
    const modal = node.probability.indexOf(Math.max(...node.probability));
    const y = 70 + index * 58;
    const bars = tree.alphabet.map((state, stateIndex) => `<rect x="${390 + stateIndex * 145}" y="${y - 14}" width="${node.probability[stateIndex] * 115}" height="18" rx="3" fill="${color(stateIndex)}" opacity="${kept ? 0.95 : 0.28}"><title>${escape(state)} ${number(node.probability[stateIndex])}</title></rect>`).join("");
    return `${index < chain.length - 1 ? `<line x1="46" y1="${y + 9}" x2="46" y2="${y + 44}" stroke="${GRID}" stroke-width="2"/>` : ""}<circle cx="46" cy="${y}" r="9" fill="${kept ? "#63d7c0" : "#5f6d79"}"/><text class="tt-text tt-label" x="68" y="${y + 4}" opacity="${kept ? 1 : 0.45}">${escape(context === ROOT_CONTEXT ? ROOT_PATHWAY : context)}</text><text class="tt-muted tt-small" x="300" y="${y + 4}">n=${number(node.count, 1)} \xB7 ${escape(tree.alphabet[modal])}</text>${bars}`;
  }).join("");
  return svg(width, height, title(options.title ?? "Suffix memory retained by pruning", width) + marks, "Pruning suffix-chain diagnostic", options.theme);
}
function plotPredictive(tree, data, options = {}) {
  const type = options.type ?? "logloss";
  const rows = scorePositions(tree, data);
  const width = options.width ?? 900;
  const height = options.height ?? 430;
  const left = 58;
  const top = 58;
  const plotWidth = width - 88;
  const plotHeight = height - 105;
  if (type === "ecdf") {
    const values = rows.map((row) => row.predictedProbability).sort((a, b) => a - b);
    const path = values.map((value, index) => `${index ? "L" : "M"}${left + value * plotWidth},${top + plotHeight - (index + 1) / values.length * plotHeight}`).join(" ");
    return svg(width, height, title(options.title ?? "ECDF of assigned probability", width) + axes(left, top, plotWidth, plotHeight, "assigned probability", "cumulative share") + `<path d="${path}" fill="none" stroke="#63d7c0" stroke-width="3"/>`, "Predictive probability empirical CDF", options.theme);
  }
  const maxPosition = Math.max(...rows.map((row) => row.position), 1);
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) grouped.set(row.sequenceId, [...grouped.get(row.sequenceId) ?? [], row]);
  if (type === "position") {
    const paths = [...grouped].map(([sequenceId, values], index) => {
      const points2 = values.map((row) => `${left + (row.position - 1) / Math.max(maxPosition - 1, 1) * plotWidth},${top + (1 - row.predictedProbability) * plotHeight}`).join(" ");
      return `<polyline points="${points2}" fill="none" stroke="${color(index)}" stroke-width="1.8" opacity=".7"><title>Sequence ${sequenceId}</title></polyline>`;
    }).join("");
    return svg(width, height, title(options.title ?? "Prediction confidence by position", width) + axes(left, top, plotWidth, plotHeight, "position", "assigned probability") + paths, "Per-sequence prediction confidence", options.theme);
  }
  const maxLoss = Math.max(...rows.map((row) => -row.logLikelihood / Math.log(2)).filter(Number.isFinite), Math.log2(tree.alphabet.length));
  const points = rows.map((row) => {
    const loss = -row.logLikelihood / Math.log(2);
    const x = left + (row.position - 1) / Math.max(maxPosition - 1, 1) * plotWidth;
    const y = top + loss / maxLoss * plotHeight;
    return `<circle cx="${x}" cy="${y}" r="3" fill="#8da7ff" opacity=".42"><title>sequence ${row.sequenceId}, position ${row.position}: ${number(loss)} bits</title></circle>`;
  }).join("");
  const uniformY = top + Math.log2(tree.alphabet.length) / maxLoss * plotHeight;
  return svg(width, height, title(options.title ?? "Per-position predictive surprise", width) + axes(left, top, plotWidth, plotHeight, "position", "log loss (bits)") + `<line x1="${left}" y1="${uniformY}" x2="${left + plotWidth}" y2="${uniformY}" stroke="${ORANGE}" stroke-dasharray="7 5"><title>uniform prediction</title></line>` + points, "Position-level predictive log loss", options.theme);
}
function axes(left, top, width, height, xLabel, yLabel) {
  return `<line class="tt-axis" x1="${left}" y1="${top + height}" x2="${left + width}" y2="${top + height}"/><line class="tt-axis" x1="${left}" y1="${top}" x2="${left}" y2="${top + height}"/><text class="tt-muted tt-small" x="${left + width / 2}" y="${top + height + 30}" text-anchor="middle">${escape(xLabel)}</text><text class="tt-muted tt-small" x="16" y="${top + height / 2}" transform="rotate(-90 16 ${top + height / 2})" text-anchor="middle">${escape(yLabel)}</text>`;
}
function plotTrajectories(tree, options = {}) {
  const maxDepth = options.maxDepth ?? Math.max(...tree.data.map((sequence) => sequence.length));
  const minCount = options.minCount ?? 4;
  const measure = options.measure ?? "frequency";
  const allNodes = /* @__PURE__ */ new Map();
  allNodes.set(ROOT_CONTEXT, { key: ROOT_CONTEXT, depth: 0, count: tree.data.length, probability: 1, parent: null, state: ROOT_PATHWAY });
  for (const source of tree.data) {
    const sequence = source.filter((state) => state !== null && state !== "").slice(0, maxDepth);
    for (let depth = 1; depth <= sequence.length; depth++) {
      const prefix = sequence.slice(0, depth);
      const key = prefix.join(PATH_SEPARATOR);
      const parent = depth === 1 ? ROOT_CONTEXT : prefix.slice(0, -1).join(PATH_SEPARATOR);
      const existing = allNodes.get(key);
      if (existing) existing.count++;
      else {
        const history = prefix.slice(0, -1);
        const matched = (() => {
          for (let d = Math.min(tree.maxDepth, history.length); d >= 1; d--) {
            const candidate = history.slice(-d).join(PATH_SEPARATOR);
            if (tree.nodes[candidate]) return candidate;
          }
          return ROOT_CONTEXT;
        })();
        const stateIndex = tree.alphabet.indexOf(prefix[prefix.length - 1]);
        allNodes.set(key, { key, depth, count: 1, probability: tree.nodes[matched].probability[stateIndex] ?? 0, parent, state: prefix[prefix.length - 1] });
      }
    }
  }
  const retained = /* @__PURE__ */ new Map();
  retained.set(ROOT_CONTEXT, allNodes.get(ROOT_CONTEXT));
  const ordered = [...allNodes.values()].filter((node) => node.depth > 0).sort((left2, right2) => left2.depth - right2.depth || right2.count - left2.count);
  for (const node of ordered) {
    if (node.count >= minCount && node.parent !== null && retained.has(node.parent)) retained.set(node.key, node);
  }
  if (retained.size === 1) throw new Error(`no forward prefix occurs at least ${minCount} times`);
  const children = /* @__PURE__ */ new Map();
  for (const node of retained.values()) {
    if (!node.parent) continue;
    children.set(node.parent, [...children.get(node.parent) ?? [], node.key]);
  }
  for (const entries of children.values()) entries.sort((left2, right2) => {
    const stateOrder = tree.alphabet.indexOf(retained.get(left2).state) - tree.alphabet.indexOf(retained.get(right2).state);
    return stateOrder || retained.get(right2).count - retained.get(left2).count;
  });
  let leaf = 0;
  const row = /* @__PURE__ */ new Map();
  const place = (key) => {
    const descendants = children.get(key) ?? [];
    if (descendants.length === 0) {
      const value2 = leaf++;
      row.set(key, value2);
      return value2;
    }
    const values = descendants.map(place);
    const value = values.reduce((total, entry) => total + entry, 0) / values.length;
    row.set(key, value);
    return value;
  };
  place(ROOT_CONTEXT);
  const deepest = Math.max(...[...retained.values()].map((node) => node.depth));
  const width = options.width ?? Math.max(980, 190 + deepest * 150);
  const height = options.height ?? Math.max(430, 145 + Math.max(leaf - 1, 1) * 50);
  const left = 74;
  const right = 60;
  const top = 105;
  const bottom = 70;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (depth) => left + depth / Math.max(deepest, 1) * plotWidth;
  const y = (key) => top + (row.get(key) ?? 0) / Math.max(leaf - 1, 1) * plotHeight;
  const nonRoot = [...retained.values()].filter((node) => node.depth > 0);
  const counts = nonRoot.map((node) => node.count);
  const minFlow = Math.min(...counts);
  const maxFlow = Math.max(...counts);
  const scale = (node) => measure === "predictability" ? node.probability : (node.count - minFlow) / Math.max(maxFlow - minFlow, 1);
  const fill = (node) => mixHex("#d9eef0", "#155d58", scale(node));
  const textFill = (node) => scale(node) > 0.48 ? "#ffffff" : "#132f3a";
  const flowWidth = (node) => 1 + 7 * (node.count - minFlow) / Math.max(maxFlow - minFlow, 1);
  const depthGuides = Array.from({ length: deepest + 1 }, (_, depth) => `<line x1="${x(depth)}" y1="${top - 35}" x2="${x(depth)}" y2="${height - bottom + 18}" stroke="${GRID}" stroke-dasharray="3 6"/><text class="tt-muted tt-small" x="${x(depth)}" y="${height - 24}" text-anchor="middle">${depth === 0 ? "start" : `move ${depth}`}</text>`).join("");
  const edges = nonRoot.map((node) => {
    const parent = retained.get(node.parent);
    const fromX = x(parent.depth) + (parent.depth === 0 ? 25 : 34);
    const toX = x(node.depth) - 34;
    const fromY = y(parent.key);
    const toY = y(node.key);
    const middle = (fromX + toX) / 2;
    return `<path d="M${fromX},${fromY} C${middle},${fromY} ${middle},${toY} ${toX},${toY}" fill="none" stroke="${fill(node)}" stroke-width="${flowWidth(node)}" stroke-linecap="round" opacity=".9"><title>${escape(node.key)} \xB7 n=${node.count} \xB7 P(move | history)=${number(node.probability)}</title></path>`;
  }).join("");
  const boxes = nonRoot.map((node) => {
    const cx = x(node.depth);
    const cy = y(node.key);
    const metric = measure === "frequency" ? `n=${node.count}` : `${number(node.probability * 100, 0)}%`;
    return `<g><rect x="${cx - 34}" y="${cy - 15}" width="68" height="30" rx="9" fill="${fill(node)}" stroke="#8da4b6" stroke-width=".8"><title>${escape(node.key)} \xB7 n=${node.count} \xB7 P=${number(node.probability)}</title></rect><text x="${cx}" y="${cy + 3}" text-anchor="middle" font-family="Inter,ui-sans-serif,system-ui,sans-serif" font-size="10" font-weight="800" fill="${textFill(node)}">${escape(node.state)}</text><text class="tt-muted tt-small" x="${cx}" y="${cy + 26}" text-anchor="middle">${metric}</text></g>`;
  }).join("");
  const rootX = x(0);
  const rootY = y(ROOT_CONTEXT);
  const root = `<g><rect x="${rootX - 25}" y="${rootY - 18}" width="50" height="36" rx="11" fill="#31475b" stroke="#c7d6e3"/><text class="tt-text tt-small" x="${rootX}" y="${rootY + 4}" text-anchor="middle" font-weight="800">start</text></g>`;
  const legendX = width - 238;
  const legendY = 59;
  const legend = `<defs><linearGradient id="tt-trajectory-gradient"><stop offset="0" stop-color="#d9eef0"/><stop offset="1" stop-color="#155d58"/></linearGradient></defs><text class="tt-muted tt-small" x="${legendX}" y="${legendY - 8}">${measure === "frequency" ? "sequence frequency" : "P(move | history)"}</text><rect x="${legendX}" y="${legendY}" width="190" height="10" rx="5" fill="url(#tt-trajectory-gradient)"/><text class="tt-muted tt-small" x="${legendX}" y="${legendY + 25}">low</text><text class="tt-muted tt-small" x="${legendX + 190}" y="${legendY + 25}" text-anchor="end">high</text>`;
  const subtitle = measure === "frequency" ? "node colour and ribbon width encode sequences following each prefix" : "node colour encodes conditional probability; ribbon width still encodes sequence flow";
  const heading = title(options.title ?? `Forward trajectory tree \xB7 ${measure}`, width) + `<text class="tt-muted tt-small" x="24" y="62">${subtitle}</text>`;
  return svg(width, height, heading + legend + depthGuides + edges + root + boxes, "Forward prefix trajectory flow tree", options.theme);
}
function plotBootstrap(result, options = {}) {
  const rows = result.summary.filter((row) => Number.isFinite(row.g2)).slice(0, options.top ?? 14);
  const width = options.width ?? 920;
  const height = options.height ?? 82 + rows.length * 31;
  const left = 245;
  const right = 35;
  const maximum = Math.max(result.g2CriticalValue, ...rows.flatMap((row) => [row.g2CI[1], row.g2]));
  const x = (value) => left + Math.max(0, value) / maximum * (width - left - right);
  const criticalX = x(result.g2CriticalValue);
  const marks = rows.map((row, index) => {
    const y = 65 + index * 31;
    const trust = row.stable && row.informative ? "#63d7c0" : row.informative ? ORANGE : row.stable ? "#8da7ff" : "#6e7d8b";
    return `<text class="tt-text tt-small" x="18" y="${y + 4}">${escape(row.pathway)}</text><line x1="${x(row.g2CI[0])}" y1="${y}" x2="${x(row.g2CI[1])}" y2="${y}" stroke="${trust}" stroke-width="4"/><circle cx="${x(row.g2)}" cy="${y}" r="5" fill="${trust}"><title>G\xB2 ${number(row.g2)} \xB7 CI [${number(row.g2CI[0])}, ${number(row.g2CI[1])}]</title></circle>`;
  }).join("");
  return svg(width, height, title(options.title ?? "Bootstrap G\xB2 forest plot", width) + `<line x1="${criticalX}" y1="50" x2="${criticalX}" y2="${height - 18}" stroke="${ORANGE}" stroke-width="2" stroke-dasharray="6 5"><title>\u03C7\xB2 critical value ${number(result.g2CriticalValue)}</title></line>` + marks, "Bootstrap confidence-interval forest plot", options.theme);
}
function plotPathwayResamples(result, options = {}) {
  if (!result.resamples) throw new Error("resamples were not retained");
  const statistic = options.statistic ?? "divergence";
  const top = options.top ?? 6;
  const rows = result.summary.slice(0, top);
  const width = options.width ?? 920;
  const panelHeight = 100;
  const height = options.height ?? 58 + rows.length * panelHeight;
  const matrix = result.resamples[statistic];
  const marks = rows.map((row, rowIndex) => {
    const pathwayIndex = result.pathways.findIndex((candidate) => candidate.pathway === row.pathway);
    const values = matrix.map((sample) => sample[pathwayIndex]).filter(Number.isFinite);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const bins = 18;
    const counts = new Array(bins).fill(0);
    for (const value of values) {
      const index = max === min ? 0 : Math.min(Math.floor((value - min) / (max - min) * bins), bins - 1);
      counts[index] = counts[index] + 1;
    }
    const maximum = Math.max(...counts, 1);
    const left = 250;
    const plotWidth = width - left - 30;
    const yBase = 132 + rowIndex * panelHeight;
    const bars = counts.map((count, index) => `<rect x="${left + index / bins * plotWidth}" y="${yBase - count / maximum * 62}" width="${plotWidth / bins - 2}" height="${count / maximum * 62}" fill="#8da7ff" opacity=".78"/>`).join("");
    return `<text class="tt-text tt-small" x="18" y="${yBase - 26}">${escape(row.pathway)}</text>${bars}<text class="tt-muted tt-small" x="${left}" y="${yBase + 15}">${number(min)}</text><text class="tt-muted tt-small" x="${left + plotWidth}" y="${yBase + 15}" text-anchor="end">${number(max)}</text>`;
  }).join("");
  return svg(width, height, title(options.title ?? `Bootstrap resamples \xB7 ${statistic}`, width) + marks, "Bootstrap pathway resample distributions", options.theme);
}
function plotComparison(result, options = {}) {
  const width = options.width ?? 900;
  const height = options.height ?? 430;
  const left = 58;
  const top = 62;
  const plotWidth = width - 92;
  const plotHeight = height - 112;
  const values = result.nullDistribution;
  const min = Math.min(...values, result.distance);
  const max = Math.max(...values, result.distance);
  const bins = 28;
  const counts = new Array(bins).fill(0);
  for (const value of values) {
    const index = max === min ? 0 : Math.min(Math.floor((value - min) / (max - min) * bins), bins - 1);
    counts[index] = counts[index] + 1;
  }
  const maximum = Math.max(...counts, 1);
  const bars = counts.map((count, index) => `<rect x="${left + index / bins * plotWidth}" y="${top + plotHeight - count / maximum * plotHeight}" width="${plotWidth / bins - 2}" height="${count / maximum * plotHeight}" fill="#7890a6" opacity=".78"/>`).join("");
  const observedX = left + (result.distance - min) / Math.max(max - min, 1e-12) * plotWidth;
  return svg(width, height, title(options.title ?? `Permutation null \xB7 p=${number(result.pValue)}`, width) + axes(left, top, plotWidth, plotHeight, "tree distance", "permutations") + bars + `<line x1="${observedX}" y1="${top}" x2="${observedX}" y2="${top + plotHeight}" stroke="${ORANGE}" stroke-width="4"><title>observed ${number(result.distance)}</title></line>`, "Permutation null distribution", options.theme);
}
function plotTuning(result, options = {}) {
  const rows = result.rows.filter((row) => Number.isFinite(row.perplexity));
  const width = options.width ?? 920;
  const height = options.height ?? 460;
  const left = 62;
  const top = 62;
  const plotWidth = width - 100;
  const plotHeight = height - 118;
  const depths = rows.map((row) => row.maxDepth);
  const minDepth = Math.min(...depths);
  const maxDepth = Math.max(...depths);
  const perplexities = rows.map((row) => row.perplexity);
  const minP = Math.min(...perplexities);
  const maxP = Math.max(...perplexities);
  const key = (row) => `${row.smoothing} \xB7 n\u2265${row.minCount} \xB7 ${row.prune ? "pruned" : "full"}`;
  const groups = /* @__PURE__ */ new Map();
  for (const row of rows) groups.set(key(row), [...groups.get(key(row)) ?? [], row]);
  const x = (value) => left + (value - minDepth) / Math.max(maxDepth - minDepth, 1) * plotWidth;
  const y = (value) => top + (value - minP) / Math.max(maxP - minP, 1e-12) * plotHeight;
  const lines = [...groups].map(([name, values], index) => {
    values.sort((a, b) => a.maxDepth - b.maxDepth);
    return `<polyline points="${values.map((row) => `${x(row.maxDepth)},${y(row.perplexity)}`).join(" ")}" fill="none" stroke="${color(index)}" stroke-width="2" opacity=".72"><title>${escape(name)}</title></polyline>${values.map((row) => `<circle cx="${x(row.maxDepth)}" cy="${y(row.perplexity)}" r="4" fill="${color(index)}"><title>${escape(name)} \xB7 perplexity ${number(row.perplexity)}</title></circle>`).join("")}`;
  }).join("");
  const best = result.best ? `<text x="${x(result.best.maxDepth)}" y="${y(result.best.perplexity) - 10}" text-anchor="middle" fill="${ORANGE}" font-size="24">\u2605</text>` : "";
  return svg(width, height, title(options.title ?? "Cross-validated tuning surface", width) + axes(left, top, plotWidth, plotHeight, "maximum depth", "perplexity") + lines + best, "Cross-validated perplexity tuning surface", options.theme);
}
function plotGroupDifference(trees, options = {}) {
  const names = options.groups ?? Object.keys(trees).slice(0, 2);
  if (names.length !== 2 || !trees[names[0]] || !trees[names[1]]) throw new Error("two valid groups are required");
  const leftTree = trees[names[0]];
  const rightTree = trees[names[1]];
  const alphabet = leftTree.alphabet;
  const depth = options.depth ?? 1;
  const contexts = [.../* @__PURE__ */ new Set([...Object.keys(leftTree.nodes), ...Object.keys(rightTree.nodes)])].filter((context) => leftTree.nodes[context]?.depth === depth || rightTree.nodes[context]?.depth === depth);
  const width = options.width ?? 900;
  const rowHeight = 34;
  const height = options.height ?? 78 + contexts.length * rowHeight;
  const labelWidth = 250;
  const cellWidth = (width - labelWidth - 30) / alphabet.length;
  const probability = (tree, context, state) => tree.nodes[context]?.probability[tree.alphabet.indexOf(state)] ?? 0;
  const cells = contexts.map((context, rowIndex) => `<text class="tt-text tt-small" x="18" y="${72 + rowIndex * rowHeight}">${escape(context)}</text>${alphabet.map((state, stateIndex) => {
    const difference = probability(rightTree, context, state) - probability(leftTree, context, state);
    const opacity = 0.12 + 0.88 * Math.min(Math.abs(difference), 1);
    const fill = difference >= 0 ? "#ef7fa5" : "#5fc4ee";
    return `<g><rect x="${labelWidth + stateIndex * cellWidth}" y="${53 + rowIndex * rowHeight}" width="${cellWidth - 3}" height="${rowHeight - 3}" rx="3" fill="${fill}" opacity="${opacity}"><title>${escape(names[1])} \u2212 ${escape(names[0])}: ${number(difference)}</title></rect><text class="tt-text tt-small" x="${labelWidth + stateIndex * cellWidth + cellWidth / 2}" y="${74 + rowIndex * rowHeight}" text-anchor="middle">${difference > 0 ? "+" : ""}${number(difference, 2)}</text></g>`;
  }).join("")}`).join("");
  const headers = alphabet.map((state, index) => `<text class="tt-muted tt-small" x="${labelWidth + index * cellWidth + cellWidth / 2}" y="42" text-anchor="middle">${escape(state)}</text>`).join("");
  return svg(width, height, title(options.title ?? `${names[1]} \u2212 ${names[0]} next-state probability`, width) + headers + cells, "Group next-state probability difference map", options.theme);
}

exports.PATH_SEPARATOR = PATH_SEPARATOR;
exports.ROOT_CONTEXT = ROOT_CONTEXT;
exports.ROOT_PATHWAY = ROOT_PATHWAY;
exports.bootstrapPathways = bootstrapPathways;
exports.commonPathways = commonPathways;
exports.compareGroups = compareGroups;
exports.comparePruning = comparePruning;
exports.compareSmoothing = compareSmoothing;
exports.compareTrees = compareTrees;
exports.contextTree = contextTree;
exports.contextTreeGroups = contextTreeGroups;
exports.divergentPathways = divergentPathways;
exports.generateTreeSequences = generateTreeSequences;
exports.imputeSequences = imputeSequences;
exports.matchContext = matchContext;
exports.mineContexts = mineContexts;
exports.mineSequences = mineSequences;
exports.nTreeNodes = nTreeNodes;
exports.parentContext = parentContext;
exports.pathwayExists = pathwayExists;
exports.plotBootstrap = plotBootstrap;
exports.plotComparison = plotComparison;
exports.plotDistributions = plotDistributions;
exports.plotDivergence = plotDivergence;
exports.plotGroupDifference = plotGroupDifference;
exports.plotPathwayResamples = plotPathwayResamples;
exports.plotPathways = plotPathways;
exports.plotPredictive = plotPredictive;
exports.plotPruning = plotPruning;
exports.plotTrajectories = plotTrajectories;
exports.plotTree = plotTree;
exports.plotTuning = plotTuning;
exports.predictNext = predictNext;
exports.predictTree = predictTree;
exports.prepareTreeInput = prepareTreeInput;
exports.pruneTree = pruneTree;
exports.queryPathway = queryPathway;
exports.resolveSmoothing = resolveSmoothing;
exports.scorePositions = scorePositions;
exports.scoreSequences = scoreSequences;
exports.sharpPathways = sharpPathways;
exports.smoothCounts = smoothCounts;
exports.smoothTree = smoothTree;
exports.subtree = subtree;
exports.treeDependence = treeDependence;
exports.treeDistance = treeDistance;
exports.treeDistanceBreakdown = treeDistanceBreakdown;
exports.treeLogLikelihood = treeLogLikelihood;
exports.treeModelFit = treeModelFit;
exports.treePathways = treePathways;
exports.treePerplexity = treePerplexity;
exports.tuneTree = tuneTree;
//# sourceMappingURL=chunk-VXJCTRXM.cjs.map
//# sourceMappingURL=chunk-VXJCTRXM.cjs.map