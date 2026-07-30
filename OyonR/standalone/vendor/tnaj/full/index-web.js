import { isTnawReady, initTnaw } from '../chunk-FIMMJAVI.js';
export { initTnaw, isTnawReady } from '../chunk-FIMMJAVI.js';
export { bootstrapTna, casedropReliability, centralities, clusterData, clusterSequences, compareWeightMatrices, computeDendrogram, estimateCS, findRepresentatives, markovOrderTest, markovStability, passageTime, permutationTest, reliabilityAnalysis } from '../chunk-HTI5QIWI.js';
import '../chunk-NRYFPQCB.js';
import '../chunk-Y6HFV4RZ.js';
import '../chunk-WWL5GAAO.js';
export { ACCENT_PALETTE, DEFAULT_COLORS, SET3_PALETTE, colorPalette, createColorMap, darkenColor, hexToRgb, lightenColor, rgbToHex } from '../chunk-7SYEF5ZL.js';
export { AVAILABLE_MEASURES, AVAILABLE_METHODS, bettiNumbers, betweennessNetwork, buildDFG, buildDFGFromSequences, buildHon, buildHonem, buildHypa, buildMogen, buildSimplicial, cliques, clusterCovariates, communities, estimateCsWtna, estimateEdgeStability, estimateNetworkStability, eulerCharacteristic, extractTrajectories, extractTuples, g2Statistic, kgramCounts, layerDof, logLikelihood, marginalDistribution, mogenTransitions, pathCounts, pathDependence, pathwaysHon, pathwaysHypa, pathwaysMogen, pchisqUpper, permutationTestWtna, prune, pruneDisparity, simulate, stateFrequencies, transitionMatrixFromKgrams, withinWPermutation } from '../chunk-F7YVWPXB.js';
export { fitMultinom, multinomSE } from '../chunk-ZCVPZDHU.js';
export { designMatrix, eigenDominantLeft, isNumericColumn, parseTimeValue, prepareLong, solveLinear } from '../chunk-UZZFDWDX.js';
import '../chunk-7G5VVISJ.js';
import '../chunk-BAZJ42T7.js';
export { pAdjust } from '../chunk-ZULEKCKD.js';
export { HTNA_COLOR_PALETTE, HTNA_SHAPE_PALETTE, MCML_COLOR_PALETTE, bootstrapHtna, diffNetworks, extractMetaPaths, formatPaths, htna, htnaFromLong, htnaPlotData, mcmlPlotData, mcml_plot_data, plotMCML, plot_mcml, sequencePlotHtnaData } from '../chunk-L4NYFGX5.js';
import '../chunk-HICX3NUZ.js';
export { applyIntervalWindowing, applyWindowing, bootstrapWtna, buildWtnaMatrix, computeWithinWindow, computeWtnaTransitions, rowNormalizeWtna, toBinaryMatrix } from '../chunk-4WEWB4WN.js';
export { createGroupTNA, groupApply, groupAtna, groupCtna, groupEntries, groupFtna, groupNames, groupTna, isGroupTNA, isHtna, renameGroups } from '../chunk-PKCMUOEM.js';
import '../chunk-PYJAP7US.js';
import '../chunk-YQOO3CNR.js';
export { RELIABILITY_METRICS, anova, chisqTest, compareModels, compareSequences, distanceCorr, kendallTau, kruskal, networkReliability, pairwiseChisq, pairwiseWelch, pchisq, pf, pt2, rankArray, rvCoefficient, spearmanCorr, spearmanCorrArr, stdResiduals } from '../chunk-DOMOOFBU.js';
export { Matrix, SeededRNG, applyScaling, arrayMean, arrayQuantile, arrayStd, atna, buildModel, computeTransitions, computeTransitions3D, computeWeightsFrom3D, computeWeightsFromMatrix, createSeqdata, createTNA, ctna, ftna, importOnehot, maxScale, minmaxScale, pearsonCorr, prepareData, rankScale, rowNormalize, summary, tna } from '../chunk-2EXGRQR6.js';

// src/full/state-web.ts
var _initPromise = null;
async function initWasm() {
  if (isTnawReady()) return true;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      await initTnaw();
      return isTnawReady();
    } catch (err) {
      console.warn("[tnajw/full] WASM init failed; dispatchers will use TS fallback:", err);
      return false;
    }
  })();
  return _initPromise;
}
function isWasmEnabled() {
  return isTnawReady();
}

export { initWasm, isWasmEnabled };
//# sourceMappingURL=index-web.js.map
//# sourceMappingURL=index-web.js.map