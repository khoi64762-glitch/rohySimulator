import './chunk-WWL5GAAO.js';
export { ACCENT_PALETTE, DEFAULT_COLORS, SET3_PALETTE, colorPalette, createColorMap, darkenColor, hexToRgb, lightenColor, rgbToHex } from './chunk-7SYEF5ZL.js';
export { AVAILABLE_MEASURES, AVAILABLE_METHODS, bettiNumbers, betweennessNetwork, bipartiteGroups, bottleneckDistance, buildDFG, buildDFGFromSequences, buildHon, buildHonem, buildHypa, buildHypergraph, buildMogen, buildSimplicial, chainStructure, cliqueExpansion, cliques, clusterData, clusterSequences, communities, computeDendrogram, estimateCsWtna, estimateEdgeStability, estimateNetworkStability, eulerCharacteristic, findRepresentatives, hypergraphCentrality, hypergraphMeasures, mogenTransitions, pathCounts, pathDependence, pathwaysHon, pathwaysHypa, pathwaysMogen, permutationTestWtna, persistenceLandscape, persistentHomology, prune, pruneDisparity, qAnalysis, simplicialDegree, simulate, stateFrequencies, transitionEntropy } from './chunk-F7YVWPXB.js';
export { clusterMmm, mmm, validateMmmOptions } from './chunk-ZCVPZDHU.js';
export { eigenDominantLeft, solveLinear } from './chunk-UZZFDWDX.js';
export { chiSqUpperTail, convert, discoverPatterns, entropyProfile, extractLast, meanTimeInState, modalSequence, prepareSequenceData, rle, sequenceFrequencies, sequenceIndices, sequenceStateDistribution, sequenceStateFrequencies, sequenceTransitions } from './chunk-7G5VVISJ.js';
import './chunk-BAZJ42T7.js';
export { pAdjust } from './chunk-ZULEKCKD.js';
export { HTNA_COLOR_PALETTE, HTNA_SHAPE_PALETTE, MCML_COLOR_PALETTE, bootstrapHtna, diffNetworks, extractMetaPaths, formatPaths, htna, htnaFromLong, htnaPlotData, mcmlPlotData, mcml_plot_data, plotMCML, plot_mcml, sequencePlotHtnaData } from './chunk-L4NYFGX5.js';
import './chunk-HICX3NUZ.js';
export { applyIntervalWindowing, applyWindowing, bootstrapWtna, buildWtnaMatrix, computeWithinWindow, computeWtnaTransitions, rowNormalizeWtna, toBinaryMatrix } from './chunk-4WEWB4WN.js';
export { createGroupTNA, groupApply, groupAtna, groupCtna, groupEntries, groupFtna, groupNames, groupTna, isGroupTNA, isHtna, renameGroups } from './chunk-PKCMUOEM.js';
import './chunk-PYJAP7US.js';
import './chunk-YQOO3CNR.js';
export { RELIABILITY_METRICS, compareModels, compareSequences, distanceCorr, kendallTau, networkReliability, rankArray, rvCoefficient, spearmanCorr, spearmanCorrArr, stdResiduals } from './chunk-DOMOOFBU.js';
export { Matrix, SeededRNG, applyScaling, arrayMean, arrayQuantile, arrayStd, atna, buildModel, computeTransitions, computeTransitions3D, computeWeightsFrom3D, computeWeightsFromMatrix, createSeqdata, createTNA, ctna, ftna, importOnehot, maxScale, minmaxScale, pearsonCorr, prepareData, rankScale, rowNormalize, summary, tna } from './chunk-2EXGRQR6.js';

// src/light/helpers.ts
var HON_SEP = "";
function extractTrajectories(data) {
  if (data !== null && typeof data === "object" && !Array.isArray(data) && "weights" in data) {
    const model = data;
    if (!model.data) {
      throw new Error(
        "extractTrajectories: TNA model does not contain data. Rebuild with buildTna()."
      );
    }
    return sequenceDataToTrajectories(model.data);
  }
  if (!Array.isArray(data)) {
    throw new Error("extractTrajectories: data must be an array of trajectories");
  }
  return sequenceDataToTrajectories(data);
}
function sequenceDataToTrajectories(data) {
  const out = [];
  for (const rawSeq of data) {
    if (!Array.isArray(rawSeq)) continue;
    let lastNonNull = -1;
    for (let i = 0; i < rawSeq.length; i++) {
      const v = rawSeq[i];
      if (v !== null && v !== void 0 && (typeof v !== "number" || !Number.isNaN(v))) {
        lastNonNull = i;
      }
    }
    if (lastNonNull < 0) continue;
    const traj = [];
    for (let i = 0; i <= lastNonNull; i++) {
      const v = rawSeq[i];
      if (v === null || v === void 0) continue;
      traj.push(String(v));
    }
    if (traj.length >= 2) out.push(traj);
  }
  return out;
}
function kgramCounts(trajectories, k) {
  if (k < 1) throw new Error("kgramCounts: k must be >= 1");
  const nodeCounts = /* @__PURE__ */ new Map();
  const edgeCounts = /* @__PURE__ */ new Map();
  const EDGE_SEP = "";
  for (const traj of trajectories) {
    const n = traj.length;
    if (n < k) continue;
    const kgrams = [];
    for (let i = 0; i + k <= n; i++) {
      const kg = traj.slice(i, i + k).join(HON_SEP);
      kgrams.push(kg);
      nodeCounts.set(kg, (nodeCounts.get(kg) ?? 0) + 1);
    }
    for (let i = 0; i + 1 < kgrams.length; i++) {
      const key = `${kgrams[i]}${EDGE_SEP}${kgrams[i + 1]}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  const nodes = Array.from(nodeCounts.keys()).sort();
  const edges = [];
  for (const [key, weight] of edgeCounts) {
    const sepIdx = key.indexOf(EDGE_SEP);
    edges.push({
      from: key.slice(0, sepIdx),
      to: key.slice(sepIdx + 1),
      weight
    });
  }
  return { nodes, nodeCounts, edges };
}

export { extractTrajectories, kgramCounts };
//# sourceMappingURL=light.js.map
//# sourceMappingURL=light.js.map