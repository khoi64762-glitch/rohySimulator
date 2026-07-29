/**
 * P-value adjustment methods matching R's p.adjust().
 * Ported from Desktop analysis/permutation.ts.
 */
type PAdjustMethod = 'none' | 'bonferroni' | 'holm' | 'fdr' | 'BH';
/**
 * Adjust p-values for multiple comparisons.
 * Matches R's p.adjust() for supported methods.
 */
declare function pAdjust(pvals: number[], method: PAdjustMethod): number[];

export { type PAdjustMethod as P, pAdjust as p };
