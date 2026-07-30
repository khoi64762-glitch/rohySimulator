export { B as BuildModelOptions, C as CentralityMeasure, a as CentralityResult, b as CliqueResult, c as ClusterResult, d as CommunityMethod, e as CommunityResult, f as CompareRow, G as GroupTNA, M as Matrix, g as ModelType, S as Sequence, h as SequenceData, T as TNA, i as TNAData, j as TransitionParams, k as applyScaling, l as arrayMean, m as arrayQuantile, n as arrayStd, o as maxScale, p as minmaxScale, q as pearsonCorr, r as rankScale, s as rowNormalize } from '../types-C4ftN5gs.cjs';
export { A as ACCENT_PALETTE, D as DEFAULT_COLORS, O as OnehotSequenceData, S as SET3_PALETTE, a as atna, b as buildModel, c as colorPalette, d as computeTransitions, e as computeTransitions3D, f as computeWeightsFrom3D, g as computeWeightsFromMatrix, h as createColorMap, i as createGroupTNA, j as createSeqdata, k as createTNA, l as ctna, m as darkenColor, n as eigenDominantLeft, o as ftna, p as groupApply, q as groupAtna, r as groupCtna, s as groupEntries, t as groupFtna, u as groupNames, v as groupTna, w as hexToRgb, x as importOnehot, y as isGroupTNA, z as isHtna, B as lightenColor, C as prepareData, E as renameGroups, F as rgbToHex, G as solveLinear, H as summary, I as tna } from '../colors-B6ja0wYD.cjs';
export { S as SeededRNG } from '../rng-CY-fA99P.cjs';
export { C as CategoricalAgg, D as DesignMatrix, M as MetaData, N as NumericAgg, P as PrepareLongOptions, a as PrepareLongResult, d as designMatrix, i as isNumericColumn, p as parseTimeValue, b as prepareLong } from '../prepare-long-CKL0YxYR.cjs';

/** Shared SVG geometry used by tnaj network renderers and demos. */
interface NetworkEdgeGeometry {
    path: string;
    tipX: number;
    tipY: number;
    tipDx: number;
    tipDy: number;
    labelX: number;
    labelY: number;
}
/**
 * Quadratic network edge from painted node boundary to painted node boundary.
 * This is the library form of the established geometry from demo/main.ts.
 */
declare function networkEdgeGeometry(sx: number, sy: number, tx: number, ty: number, sourceRadius: number, targetRadius?: number, curvature?: number, arrowLength?: number): NetworkEdgeGeometry;
/** Filled triangle arrowhead used by the main tnaj network renderer. */
declare function networkArrowPolygon(tipX: number, tipY: number, dx: number, dy: number, length?: number, halfWidth?: number): string;
/** Compact outward self-loop, matching the established HTNA demo geometry. */
declare function networkSelfLoopGeometry(x: number, y: number, nodeRadius: number, outwardAngle: number, reach?: number): NetworkEdgeGeometry;

export { type NetworkEdgeGeometry, networkArrowPolygon, networkEdgeGeometry, networkSelfLoopGeometry };
