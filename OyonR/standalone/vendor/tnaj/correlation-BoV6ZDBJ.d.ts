/**
 * Rank array values (1-based, average ties).
 * Used internally by spearmanCorr and kendallTau.
 */
declare function rankArray(arr: Float64Array): Float64Array;
/**
 * Spearman rank correlation = Pearson correlation on ranks.
 * Accepts Float64Array (from centrality vectors).
 */
declare function spearmanCorr(a: Float64Array, b: Float64Array): number;
/**
 * Spearman rank correlation for number[] arrays.
 * Used by reliability metrics.
 */
declare function spearmanCorrArr(x: number[], y: number[]): number;
/**
 * Kendall's tau-b (matches R's cor(x, y, method='kendall')).
 * tau-b = (C - D) / sqrt((n0 - Tx) * (n0 - Ty))
 */
declare function kendallTau(x: number[], y: number[]): number;
/**
 * Distance correlation matching R's tna:::distance_correlation.
 * Returns v_xy / sqrt(v_x * v_y) (biased estimator; can be negative).
 */
declare function distanceCorr(x: number[], y: number[]): number;
/**
 * RV coefficient matching R's tna:::rv_coefficient.
 * Uses column-centred matrices and tcrossprod formula:
 * RV = trace(XX' * YY') / sqrt(trace(XX' * XX') * trace(YY' * YY'))
 *
 * Accepts any object with .rows, .get(i,j) — compatible with tnaj Matrix.
 */
declare function rvCoefficient(a: {
    rows: number;
    get(i: number, j: number): number;
}, b: {
    rows: number;
    get(i: number, j: number): number;
}): number;

export { rvCoefficient as a, spearmanCorrArr as b, distanceCorr as d, kendallTau as k, rankArray as r, spearmanCorr as s };
