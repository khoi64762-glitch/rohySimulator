import { ATTENTION_DEFAULT_BETA, buildModel } from './chunk-2EXGRQR6.js';

// src/core/group.ts
function isGroupTNA(x) {
  return typeof x === "object" && x !== null && "models" in x;
}
function isHtna(x) {
  return typeof x === "object" && x !== null && "weights" in x && "labels" in x && Array.isArray(x.partition) && x.partition.length === x.labels.length;
}
function createGroupTNA(models) {
  return { models };
}
function groupNames(g) {
  return Object.keys(g.models);
}
function groupEntries(g) {
  return Object.entries(g.models);
}
function groupApply(g, fn) {
  const result = {};
  for (const [name, model] of Object.entries(g.models)) {
    result[name] = fn(model, name);
  }
  return result;
}
function renameGroups(g, newNames) {
  const oldNames = Object.keys(g.models);
  if (newNames.length !== oldNames.length) {
    throw new Error(`Expected ${oldNames.length} names, got ${newNames.length}`);
  }
  const models = {};
  for (let i = 0; i < oldNames.length; i++) {
    models[newNames[i]] = g.models[oldNames[i]];
  }
  return { models };
}
function buildGroupModels(data, groups, options) {
  if (data.length !== groups.length) {
    throw new Error(`Data length ${data.length} doesn't match groups length ${groups.length}`);
  }
  let labels = options?.labels;
  if (!labels) {
    const stateSet = /* @__PURE__ */ new Set();
    for (const row of data) {
      for (const val of row) {
        if (val !== null && val !== void 0 && val !== "") {
          stateSet.add(val);
        }
      }
    }
    labels = Array.from(stateSet).sort();
  }
  const uniqueGroups = [];
  const seen = /* @__PURE__ */ new Set();
  for (const g of groups) {
    if (!seen.has(g)) {
      uniqueGroups.push(g);
      seen.add(g);
    }
  }
  const scalingOpt = options?.scaling ?? null;
  const optsNoScaling = { ...options, scaling: void 0, labels };
  const models = {};
  for (const grp of uniqueGroups) {
    const grpData = [];
    for (let i = 0; i < data.length; i++) {
      if (groups[i] === grp) {
        grpData.push(data[i]);
      }
    }
    models[grp] = buildModel(grpData, optsNoScaling);
  }
  if (scalingOpt) {
    const type = options?.type ?? "relative";
    const grpNames = Object.keys(models);
    const n = models[grpNames[0]].weights.rows;
    if (type === "relative") {
      for (const name of grpNames) {
        const w = models[name].weights;
        for (let i = 0; i < n; i++) {
          let rs = 0;
          for (let j = 0; j < n; j++) rs += w.get(i, j);
          if (rs > 0) {
            for (let j = 0; j < n; j++) w.set(i, j, w.get(i, j) / rs);
          }
        }
      }
    }
    const allVals = [];
    for (const name of grpNames) {
      const w = models[name].weights;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          allVals.push(w.get(i, j));
        }
      }
    }
    let scaled;
    if (scalingOpt === "rank") {
      const indexed = allVals.map((v, i) => ({ v, i }));
      indexed.sort((a, b) => a.v - b.v);
      scaled = new Array(allVals.length);
      let idx = 0;
      while (idx < indexed.length) {
        let end = idx;
        while (end < indexed.length && indexed[end].v === indexed[idx].v) end++;
        const avgRank = (idx + 1 + end) / 2;
        for (let k = idx; k < end; k++) scaled[indexed[k].i] = avgRank;
        idx = end;
      }
    } else if (scalingOpt === "minmax") {
      const min = Math.min(...allVals);
      const max = Math.max(...allVals);
      const range = max - min || 1;
      scaled = allVals.map((v) => (v - min) / range);
    } else if (scalingOpt === "max") {
      const max = Math.max(...allVals);
      scaled = max === 0 ? [...allVals] : allVals.map((v) => v / max);
    } else {
      scaled = allVals;
    }
    let offset = 0;
    for (const name of grpNames) {
      const w = models[name].weights;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          w.set(i, j, scaled[offset++]);
        }
      }
    }
  }
  return { models };
}
function groupTna(data, groups, options) {
  return buildGroupModels(data, groups, { ...options, type: "relative" });
}
function groupFtna(data, groups, options) {
  return buildGroupModels(data, groups, { ...options, type: "frequency" });
}
function groupCtna(data, groups, options) {
  return buildGroupModels(data, groups, { ...options, type: "co-occurrence" });
}
function groupAtna(data, groups, options) {
  return buildGroupModels(data, groups, {
    ...options,
    type: "attention",
    params: { beta: options?.beta ?? ATTENTION_DEFAULT_BETA }
  });
}

export { createGroupTNA, groupApply, groupAtna, groupCtna, groupEntries, groupFtna, groupNames, groupTna, isGroupTNA, isHtna, renameGroups };
//# sourceMappingURL=chunk-PKCMUOEM.js.map
//# sourceMappingURL=chunk-PKCMUOEM.js.map