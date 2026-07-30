interface AnovaResult {
    F: number;
    df1: number;
    df2: number;
    p: number;
    eta2: number;
}
interface KruskalResult {
    H: number;
    df: number;
    p: number;
}
interface ChisqResult {
    X2: number;
    df: number;
    p: number;
    cramerV: number;
    n: number;
    expectedMin: number;
    residuals: number[][];
    dropped: boolean;
}
interface WelchPair {
    a: string;
    b: string;
    diff: number;
    t: number;
    df: number;
    p: number;
    pAdj?: number;
}
interface ChisqPair {
    a: string;
    b: string;
    X2: number;
    df: number;
    p: number;
    cramerV: number;
    pAdj?: number;
}
/** Upper tail of F(df1, df2) — the ANOVA p-value. */
declare function pf(f: number, df1: number, df2: number): number;
/** Two-sided p of Student's t on df. */
declare function pt2(t: number, df: number): number;
/** Upper tail of chi-square on df — the p-value of a chi-square / Kruskal–Wallis statistic. */
declare function pchisq(q: number, df: number): number;
/**
 * One-way ANOVA across k groups.
 * eta^2 = SS_between / SS_total — the proportion of the covariate's variance the clustering
 * accounts for. Reported ALWAYS, next to p: with 30 sessions a "significant" difference can
 * be trivial and a large one can miss significance, and only the effect size says which.
 */
declare function anova(groups: number[][]): AnovaResult | null;
/** Kruskal–Wallis H, tie-corrected (R's kruskal.test). */
declare function kruskal(groups: number[][]): KruskalResult | null;
/**
 * Chi-square of independence on a cluster × level table, with Cramér's V and the per-cell
 * standardized adjusted residuals (via `stdres`, which the caller passes in from tnaj so
 * there is exactly one definition of a residual in this notebook).
 *
 * `expectedMin` rides along on purpose: the chi-square approximation needs expected counts
 * of ~5, cluster × covariate tables are small, and R warns about this. Reporting the p while
 * silently swallowing R's warning would be the notebook lying by omission.
 */
declare function chisqTest(table: number[][], stdres?: (t: number[][]) => number[][]): ChisqResult | null;
/**
 * Pairwise Welch t-tests between clusters, multiplicity-adjusted.
 *
 * NOT Games–Howell, and the difference is worth stating. Games–Howell is the Welch t with a
 * STUDENTIZED-RANGE adjustment (ptukey), which the engine does not implement; this uses the
 * identical Welch t statistic and df, and adjusts with Holm (or BH) instead. Holm is valid
 * and slightly more conservative than the studentized range, so the risk it carries is a
 * missed difference, never a fabricated one. It is exactly R's
 * `pairwise.t.test(x, g, pool.sd = FALSE, p.adjust.method = "holm")`, which is what the
 * comparison is pinned against.
 */
declare function pairwiseWelch(names: string[], groups: number[][], adjust: string, pAdjust: (p: number[], m: string) => number[]): WelchPair[];
/** Pairwise chi-square between clusters (each a 2 × levels sub-table), multiplicity-adjusted. */
declare function pairwiseChisq(names: string[], table: number[][], adjust: string, pAdjust: (p: number[], m: string) => number[], stdres?: (t: number[][]) => number[][]): ChisqPair[];

export { type AnovaResult as A, type ChisqPair as C, type KruskalResult as K, type WelchPair as W, type ChisqResult as a, anova as b, chisqTest as c, pairwiseWelch as d, pchisq as e, pf as f, pt2 as g, kruskal as k, pairwiseChisq as p };
