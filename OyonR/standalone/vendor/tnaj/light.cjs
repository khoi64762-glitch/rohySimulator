'use strict';

require('./chunk-FD2BSOIG.cjs');
var chunkSPOTRRG2_cjs = require('./chunk-SPOTRRG2.cjs');
var chunkPSLEWOXL_cjs = require('./chunk-PSLEWOXL.cjs');
var chunkT7KNIXMR_cjs = require('./chunk-T7KNIXMR.cjs');
var chunk6QIV2LH7_cjs = require('./chunk-6QIV2LH7.cjs');
var chunkNBXN24WK_cjs = require('./chunk-NBXN24WK.cjs');
require('./chunk-LAVAYJH7.cjs');
var chunkZKTLZLRH_cjs = require('./chunk-ZKTLZLRH.cjs');
var chunkNNWZ5TFN_cjs = require('./chunk-NNWZ5TFN.cjs');
require('./chunk-GF6HGQDU.cjs');
var chunkQ2XZ4DYY_cjs = require('./chunk-Q2XZ4DYY.cjs');
var chunkOLUSGFBH_cjs = require('./chunk-OLUSGFBH.cjs');
require('./chunk-VXJCTRXM.cjs');
require('./chunk-TJLPKQPI.cjs');
var chunkO5U3BFYT_cjs = require('./chunk-O5U3BFYT.cjs');
var chunkRT5XI5AH_cjs = require('./chunk-RT5XI5AH.cjs');

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

Object.defineProperty(exports, "ACCENT_PALETTE", {
  enumerable: true,
  get: function () { return chunkSPOTRRG2_cjs.ACCENT_PALETTE; }
});
Object.defineProperty(exports, "DEFAULT_COLORS", {
  enumerable: true,
  get: function () { return chunkSPOTRRG2_cjs.DEFAULT_COLORS; }
});
Object.defineProperty(exports, "SET3_PALETTE", {
  enumerable: true,
  get: function () { return chunkSPOTRRG2_cjs.SET3_PALETTE; }
});
Object.defineProperty(exports, "colorPalette", {
  enumerable: true,
  get: function () { return chunkSPOTRRG2_cjs.colorPalette; }
});
Object.defineProperty(exports, "createColorMap", {
  enumerable: true,
  get: function () { return chunkSPOTRRG2_cjs.createColorMap; }
});
Object.defineProperty(exports, "darkenColor", {
  enumerable: true,
  get: function () { return chunkSPOTRRG2_cjs.darkenColor; }
});
Object.defineProperty(exports, "hexToRgb", {
  enumerable: true,
  get: function () { return chunkSPOTRRG2_cjs.hexToRgb; }
});
Object.defineProperty(exports, "lightenColor", {
  enumerable: true,
  get: function () { return chunkSPOTRRG2_cjs.lightenColor; }
});
Object.defineProperty(exports, "rgbToHex", {
  enumerable: true,
  get: function () { return chunkSPOTRRG2_cjs.rgbToHex; }
});
Object.defineProperty(exports, "AVAILABLE_MEASURES", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.AVAILABLE_MEASURES; }
});
Object.defineProperty(exports, "AVAILABLE_METHODS", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.AVAILABLE_METHODS; }
});
Object.defineProperty(exports, "bettiNumbers", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.bettiNumbers; }
});
Object.defineProperty(exports, "betweennessNetwork", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.betweennessNetwork; }
});
Object.defineProperty(exports, "bipartiteGroups", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.bipartiteGroups; }
});
Object.defineProperty(exports, "bottleneckDistance", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.bottleneckDistance; }
});
Object.defineProperty(exports, "buildDFG", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.buildDFG; }
});
Object.defineProperty(exports, "buildDFGFromSequences", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.buildDFGFromSequences; }
});
Object.defineProperty(exports, "buildHon", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.buildHon; }
});
Object.defineProperty(exports, "buildHonem", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.buildHonem; }
});
Object.defineProperty(exports, "buildHypa", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.buildHypa; }
});
Object.defineProperty(exports, "buildHypergraph", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.buildHypergraph; }
});
Object.defineProperty(exports, "buildMogen", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.buildMogen; }
});
Object.defineProperty(exports, "buildSimplicial", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.buildSimplicial; }
});
Object.defineProperty(exports, "chainStructure", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.chainStructure; }
});
Object.defineProperty(exports, "cliqueExpansion", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.cliqueExpansion; }
});
Object.defineProperty(exports, "cliques", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.cliques; }
});
Object.defineProperty(exports, "clusterData", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.clusterData; }
});
Object.defineProperty(exports, "clusterSequences", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.clusterSequences; }
});
Object.defineProperty(exports, "communities", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.communities; }
});
Object.defineProperty(exports, "computeDendrogram", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.computeDendrogram; }
});
Object.defineProperty(exports, "estimateCsWtna", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.estimateCsWtna; }
});
Object.defineProperty(exports, "estimateEdgeStability", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.estimateEdgeStability; }
});
Object.defineProperty(exports, "estimateNetworkStability", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.estimateNetworkStability; }
});
Object.defineProperty(exports, "eulerCharacteristic", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.eulerCharacteristic; }
});
Object.defineProperty(exports, "findRepresentatives", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.findRepresentatives; }
});
Object.defineProperty(exports, "hypergraphCentrality", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.hypergraphCentrality; }
});
Object.defineProperty(exports, "hypergraphMeasures", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.hypergraphMeasures; }
});
Object.defineProperty(exports, "mogenTransitions", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.mogenTransitions; }
});
Object.defineProperty(exports, "pathCounts", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.pathCounts; }
});
Object.defineProperty(exports, "pathDependence", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.pathDependence; }
});
Object.defineProperty(exports, "pathwaysHon", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.pathwaysHon; }
});
Object.defineProperty(exports, "pathwaysHypa", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.pathwaysHypa; }
});
Object.defineProperty(exports, "pathwaysMogen", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.pathwaysMogen; }
});
Object.defineProperty(exports, "permutationTestWtna", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.permutationTestWtna; }
});
Object.defineProperty(exports, "persistenceLandscape", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.persistenceLandscape; }
});
Object.defineProperty(exports, "persistentHomology", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.persistentHomology; }
});
Object.defineProperty(exports, "prune", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.prune; }
});
Object.defineProperty(exports, "pruneDisparity", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.pruneDisparity; }
});
Object.defineProperty(exports, "qAnalysis", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.qAnalysis; }
});
Object.defineProperty(exports, "simplicialDegree", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.simplicialDegree; }
});
Object.defineProperty(exports, "simulate", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.simulate; }
});
Object.defineProperty(exports, "stateFrequencies", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.stateFrequencies; }
});
Object.defineProperty(exports, "transitionEntropy", {
  enumerable: true,
  get: function () { return chunkPSLEWOXL_cjs.transitionEntropy; }
});
Object.defineProperty(exports, "clusterMmm", {
  enumerable: true,
  get: function () { return chunkT7KNIXMR_cjs.clusterMmm; }
});
Object.defineProperty(exports, "mmm", {
  enumerable: true,
  get: function () { return chunkT7KNIXMR_cjs.mmm; }
});
Object.defineProperty(exports, "validateMmmOptions", {
  enumerable: true,
  get: function () { return chunkT7KNIXMR_cjs.validateMmmOptions; }
});
Object.defineProperty(exports, "eigenDominantLeft", {
  enumerable: true,
  get: function () { return chunk6QIV2LH7_cjs.eigenDominantLeft; }
});
Object.defineProperty(exports, "solveLinear", {
  enumerable: true,
  get: function () { return chunk6QIV2LH7_cjs.solveLinear; }
});
Object.defineProperty(exports, "chiSqUpperTail", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.chiSqUpperTail; }
});
Object.defineProperty(exports, "convert", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.convert; }
});
Object.defineProperty(exports, "discoverPatterns", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.discoverPatterns; }
});
Object.defineProperty(exports, "entropyProfile", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.entropyProfile; }
});
Object.defineProperty(exports, "extractLast", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.extractLast; }
});
Object.defineProperty(exports, "meanTimeInState", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.meanTimeInState; }
});
Object.defineProperty(exports, "modalSequence", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.modalSequence; }
});
Object.defineProperty(exports, "prepareSequenceData", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.prepareSequenceData; }
});
Object.defineProperty(exports, "rle", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.rle; }
});
Object.defineProperty(exports, "sequenceFrequencies", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.sequenceFrequencies; }
});
Object.defineProperty(exports, "sequenceIndices", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.sequenceIndices; }
});
Object.defineProperty(exports, "sequenceStateDistribution", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.sequenceStateDistribution; }
});
Object.defineProperty(exports, "sequenceStateFrequencies", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.sequenceStateFrequencies; }
});
Object.defineProperty(exports, "sequenceTransitions", {
  enumerable: true,
  get: function () { return chunkNBXN24WK_cjs.sequenceTransitions; }
});
Object.defineProperty(exports, "pAdjust", {
  enumerable: true,
  get: function () { return chunkZKTLZLRH_cjs.pAdjust; }
});
Object.defineProperty(exports, "HTNA_COLOR_PALETTE", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.HTNA_COLOR_PALETTE; }
});
Object.defineProperty(exports, "HTNA_SHAPE_PALETTE", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.HTNA_SHAPE_PALETTE; }
});
Object.defineProperty(exports, "MCML_COLOR_PALETTE", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.MCML_COLOR_PALETTE; }
});
Object.defineProperty(exports, "bootstrapHtna", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.bootstrapHtna; }
});
Object.defineProperty(exports, "diffNetworks", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.diffNetworks; }
});
Object.defineProperty(exports, "extractMetaPaths", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.extractMetaPaths; }
});
Object.defineProperty(exports, "formatPaths", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.formatPaths; }
});
Object.defineProperty(exports, "htna", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.htna; }
});
Object.defineProperty(exports, "htnaFromLong", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.htnaFromLong; }
});
Object.defineProperty(exports, "htnaPlotData", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.htnaPlotData; }
});
Object.defineProperty(exports, "mcmlPlotData", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.mcmlPlotData; }
});
Object.defineProperty(exports, "mcml_plot_data", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.mcml_plot_data; }
});
Object.defineProperty(exports, "plotMCML", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.plotMCML; }
});
Object.defineProperty(exports, "plot_mcml", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.plot_mcml; }
});
Object.defineProperty(exports, "sequencePlotHtnaData", {
  enumerable: true,
  get: function () { return chunkNNWZ5TFN_cjs.sequencePlotHtnaData; }
});
Object.defineProperty(exports, "applyIntervalWindowing", {
  enumerable: true,
  get: function () { return chunkQ2XZ4DYY_cjs.applyIntervalWindowing; }
});
Object.defineProperty(exports, "applyWindowing", {
  enumerable: true,
  get: function () { return chunkQ2XZ4DYY_cjs.applyWindowing; }
});
Object.defineProperty(exports, "bootstrapWtna", {
  enumerable: true,
  get: function () { return chunkQ2XZ4DYY_cjs.bootstrapWtna; }
});
Object.defineProperty(exports, "buildWtnaMatrix", {
  enumerable: true,
  get: function () { return chunkQ2XZ4DYY_cjs.buildWtnaMatrix; }
});
Object.defineProperty(exports, "computeWithinWindow", {
  enumerable: true,
  get: function () { return chunkQ2XZ4DYY_cjs.computeWithinWindow; }
});
Object.defineProperty(exports, "computeWtnaTransitions", {
  enumerable: true,
  get: function () { return chunkQ2XZ4DYY_cjs.computeWtnaTransitions; }
});
Object.defineProperty(exports, "rowNormalizeWtna", {
  enumerable: true,
  get: function () { return chunkQ2XZ4DYY_cjs.rowNormalizeWtna; }
});
Object.defineProperty(exports, "toBinaryMatrix", {
  enumerable: true,
  get: function () { return chunkQ2XZ4DYY_cjs.toBinaryMatrix; }
});
Object.defineProperty(exports, "createGroupTNA", {
  enumerable: true,
  get: function () { return chunkOLUSGFBH_cjs.createGroupTNA; }
});
Object.defineProperty(exports, "groupApply", {
  enumerable: true,
  get: function () { return chunkOLUSGFBH_cjs.groupApply; }
});
Object.defineProperty(exports, "groupAtna", {
  enumerable: true,
  get: function () { return chunkOLUSGFBH_cjs.groupAtna; }
});
Object.defineProperty(exports, "groupCtna", {
  enumerable: true,
  get: function () { return chunkOLUSGFBH_cjs.groupCtna; }
});
Object.defineProperty(exports, "groupEntries", {
  enumerable: true,
  get: function () { return chunkOLUSGFBH_cjs.groupEntries; }
});
Object.defineProperty(exports, "groupFtna", {
  enumerable: true,
  get: function () { return chunkOLUSGFBH_cjs.groupFtna; }
});
Object.defineProperty(exports, "groupNames", {
  enumerable: true,
  get: function () { return chunkOLUSGFBH_cjs.groupNames; }
});
Object.defineProperty(exports, "groupTna", {
  enumerable: true,
  get: function () { return chunkOLUSGFBH_cjs.groupTna; }
});
Object.defineProperty(exports, "isGroupTNA", {
  enumerable: true,
  get: function () { return chunkOLUSGFBH_cjs.isGroupTNA; }
});
Object.defineProperty(exports, "isHtna", {
  enumerable: true,
  get: function () { return chunkOLUSGFBH_cjs.isHtna; }
});
Object.defineProperty(exports, "renameGroups", {
  enumerable: true,
  get: function () { return chunkOLUSGFBH_cjs.renameGroups; }
});
Object.defineProperty(exports, "RELIABILITY_METRICS", {
  enumerable: true,
  get: function () { return chunkO5U3BFYT_cjs.RELIABILITY_METRICS; }
});
Object.defineProperty(exports, "compareModels", {
  enumerable: true,
  get: function () { return chunkO5U3BFYT_cjs.compareModels; }
});
Object.defineProperty(exports, "compareSequences", {
  enumerable: true,
  get: function () { return chunkO5U3BFYT_cjs.compareSequences; }
});
Object.defineProperty(exports, "distanceCorr", {
  enumerable: true,
  get: function () { return chunkO5U3BFYT_cjs.distanceCorr; }
});
Object.defineProperty(exports, "kendallTau", {
  enumerable: true,
  get: function () { return chunkO5U3BFYT_cjs.kendallTau; }
});
Object.defineProperty(exports, "networkReliability", {
  enumerable: true,
  get: function () { return chunkO5U3BFYT_cjs.networkReliability; }
});
Object.defineProperty(exports, "rankArray", {
  enumerable: true,
  get: function () { return chunkO5U3BFYT_cjs.rankArray; }
});
Object.defineProperty(exports, "rvCoefficient", {
  enumerable: true,
  get: function () { return chunkO5U3BFYT_cjs.rvCoefficient; }
});
Object.defineProperty(exports, "spearmanCorr", {
  enumerable: true,
  get: function () { return chunkO5U3BFYT_cjs.spearmanCorr; }
});
Object.defineProperty(exports, "spearmanCorrArr", {
  enumerable: true,
  get: function () { return chunkO5U3BFYT_cjs.spearmanCorrArr; }
});
Object.defineProperty(exports, "stdResiduals", {
  enumerable: true,
  get: function () { return chunkO5U3BFYT_cjs.stdResiduals; }
});
Object.defineProperty(exports, "Matrix", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.Matrix; }
});
Object.defineProperty(exports, "SeededRNG", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.SeededRNG; }
});
Object.defineProperty(exports, "applyScaling", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.applyScaling; }
});
Object.defineProperty(exports, "arrayMean", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.arrayMean; }
});
Object.defineProperty(exports, "arrayQuantile", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.arrayQuantile; }
});
Object.defineProperty(exports, "arrayStd", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.arrayStd; }
});
Object.defineProperty(exports, "atna", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.atna; }
});
Object.defineProperty(exports, "buildModel", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.buildModel; }
});
Object.defineProperty(exports, "computeTransitions", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.computeTransitions; }
});
Object.defineProperty(exports, "computeTransitions3D", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.computeTransitions3D; }
});
Object.defineProperty(exports, "computeWeightsFrom3D", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.computeWeightsFrom3D; }
});
Object.defineProperty(exports, "computeWeightsFromMatrix", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.computeWeightsFromMatrix; }
});
Object.defineProperty(exports, "createSeqdata", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.createSeqdata; }
});
Object.defineProperty(exports, "createTNA", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.createTNA; }
});
Object.defineProperty(exports, "ctna", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.ctna; }
});
Object.defineProperty(exports, "ftna", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.ftna; }
});
Object.defineProperty(exports, "importOnehot", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.importOnehot; }
});
Object.defineProperty(exports, "maxScale", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.maxScale; }
});
Object.defineProperty(exports, "minmaxScale", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.minmaxScale; }
});
Object.defineProperty(exports, "pearsonCorr", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.pearsonCorr; }
});
Object.defineProperty(exports, "prepareData", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.prepareData; }
});
Object.defineProperty(exports, "rankScale", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.rankScale; }
});
Object.defineProperty(exports, "rowNormalize", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.rowNormalize; }
});
Object.defineProperty(exports, "summary", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.summary; }
});
Object.defineProperty(exports, "tna", {
  enumerable: true,
  get: function () { return chunkRT5XI5AH_cjs.tna; }
});
exports.extractTrajectories = extractTrajectories;
exports.kgramCounts = kgramCounts;
//# sourceMappingURL=light.cjs.map
//# sourceMappingURL=light.cjs.map