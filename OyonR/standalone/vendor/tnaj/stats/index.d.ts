export { d as distanceCorr, k as kendallTau, r as rankArray, a as rvCoefficient, s as spearmanCorr, b as spearmanCorrArr } from '../correlation-BoV6ZDBJ.js';
import { P as PAdjustMethod } from '../pAdjust-DGekUM6t.js';
export { p as pAdjust } from '../pAdjust-DGekUM6t.js';
import { A as AnovaResult, K as KruskalResult } from '../group-tests-DmTg7_MZ.js';
export { C as ChisqPair, a as ChisqResult, W as WelchPair, b as anova, c as chisqTest, k as kruskal, p as pairwiseChisq, d as pairwiseWelch, e as pchisq, f as pf, g as pt2 } from '../group-tests-DmTg7_MZ.js';

/**
 * The STUDENTIZED RANGE distribution — `ptukey`.
 *
 * Tukey's HSD and the Games–Howell test are both defined against it, and neither is honest
 * without it: substituting a t or a normal quantile ignores that you are looking at the RANGE
 * of k means, not one difference, and the resulting p-values are anticonservative by exactly
 * the amount the multiple-comparison correction was supposed to buy back.
 *
 * WRITTEN FROM THE DEFINITION, NOT PORTED. R's `ptukey` is a hand-optimised Fortran-era
 * routine (Copenhaver & Holland 1988) whose constants cannot be checked by reading them. So
 * this computes the integral it is defined as, with Gauss–Legendre quadrature, and the answer
 * is checked against R's over a grid (tests/ptukey-r.test.ts). A wrong port would pass a code
 * review and fail that test; a correct integral passes both.
 *
 *   Q = (max_i X_i - min_i X_i) / S,   X_i ~ iid N(mu, sigma^2),   S^2 ~ sigma^2 chi^2_df / df
 *
 *   P(Q <= q) = INT_0^inf  f_S(u) * W(q*u; k)  du
 *
 * where W is the CDF of the range of k iid standard normals,
 *
 *   W(w; k) = k * INT_-inf^inf  phi(z) * [Phi(z) - Phi(z - w)]^(k-1)  dz
 *
 * and S has density
 *
 *   f_S(u) = df^(df/2) / (Gamma(df/2) * 2^(df/2 - 1)) * u^(df-1) * exp(-df*u^2/2).
 */
/** Standard normal CDF — Cody's erf-based form, accurate to ~1e-15 (the tails matter here). */
declare function pnorm(x: number): number;
/**
 * W(w; k) — CDF of the range of k iid standard normals.
 *
 *   W(w) = k * INT phi(z) [Phi(z) - Phi(z - w)]^(k-1) dz
 *
 * The integrand is a Gaussian times a smooth power, so it is concentrated where phi(z) is and
 * [-8, 8] holds it to far below 1e-12. Pinned against R's ptukey at df = Inf to 9e-9.
 */
declare function prange(w: number, k: number): number;
/**
 * P(Q <= q) for the studentized range with `k` groups and `df` error degrees of freedom.
 *
 * @param q  studentized range statistic (>= 0)
 * @param k  number of groups (>= 2)
 * @param df error degrees of freedom (> 0). df = Infinity gives the range distribution itself.
 */
declare function ptukey(q: number, k: number, df: number): number;
/** Upper tail — what a p-value actually is. */
declare function ptukeyUpper(q: number, k: number, df: number): number;
/**
 * Quantile of the studentized range: the critical value behind a Tukey / Games–Howell interval.
 *
 * Bisection, but on a BUDGET. Every probe evaluates a double integral, so the iteration count is
 * not free the way it is for a closed-form CDF — 200 iterations of a 1e-10 tolerance is how the
 * first version of this took 58 seconds to post-hoc thirty datasets. A confidence bound is
 * reported to a few decimals; 1e-7 is already far past what anyone reads.
 */
declare function qtukey(p: number, k: number, df: number): number;

interface Describe {
    group: string;
    n: number;
    mean: number;
    sd: number;
    se: number;
    median: number;
    q1: number;
    q3: number;
    iqr: number;
    min: number;
    max: number;
    /** 95% CI of the MEAN (t-based) — not a range of the data. */
    ciLower: number;
    ciUpper: number;
}
/** R's `quantile(type = 7)` — the default, and the one every R answer you compare against uses. */
declare function quantile7(sorted: readonly number[], p: number): number;
declare function describeGroups(names: readonly string[], groups: readonly number[][]): Describe[];
interface WelchAnovaResult {
    F: number;
    df1: number;
    df2: number;
    p: number;
}
/**
 * Welch's ANOVA — `oneway.test(var.equal = FALSE)`. The omnibus that does NOT assume equal
 * variances, and the one that belongs with Games–Howell.
 */
declare function welchAnova(groups: readonly number[][]): WelchAnovaResult | null;
interface EffectSizes {
    /** SS_between / SS_total. Biased upward — always reports SOME effect. */
    eta2: number;
    /** Bias-corrected. Can be negative, and that is information, not a bug. */
    omega2: number;
    /** Rank-based, for Kruskal–Wallis: H / (N - 1). `effectsize::rank_epsilon_squared`. */
    epsilon2: number | null;
}
declare function effectSizes(groups: readonly number[][], _anova: AnovaResult | null, kw: KruskalResult | null): EffectSizes;
/**
 * Hedges' g — Cohen's d with the small-sample bias correction. Per PAIR.
 *
 * The correction factor is the EXACT one,
 *
 *   J(m) = Gamma(m/2) / ( sqrt(m/2) * Gamma((m-1)/2) ),   m = n1 + n2 - 2
 *
 * not the familiar `1 - 3/(4m - 1)` approximation. They agree to about 1e-4, which sounds
 * like nothing until you compare against `effectsize::hedges_g`, which uses the exact form:
 * the approximation showed up as a 1.6e-4 mismatch on the small-n datasets — precisely where
 * the correction is doing any work at all.
 */
declare function hedgesG(x: readonly number[], y: readonly number[]): number;
interface PostHocPair {
    a: string;
    b: string;
    /** mean(b) − mean(a) — R's TukeyHSD orients "b-a" this way. */
    diff: number;
    /** The test statistic: q for Tukey/Games–Howell, t for Welch, z for Dunn. */
    statistic: number;
    df: number | null;
    p: number;
    pAdj: number;
    ciLower: number | null;
    ciUpper: number | null;
    /** Hedges' g for this pair — a p-value alone never says how big. */
    effect: number;
}
type PostHocMethod = 'tukey' | 'gamesHowell' | 'welch' | 'dunn';
/**
 * Tukey's HSD — `TukeyHSD(aov(y ~ g))`.
 *
 * One pooled MSE across all groups, and the studentized range for the multiplicity. Exact
 * familywise alpha WHEN the variances are equal; anticonservative when they are not, which is
 * why Games–Howell exists.
 */
declare function tukeyHSD(names: readonly string[], groups: readonly number[][], level?: number): PostHocPair[];
/**
 * Games–Howell — `rstatix::games_howell_test`.
 *
 * Tukey's studentized range, but each pair gets its OWN standard error and its own
 * Welch–Satterthwaite df. No pooled MSE, no equal-variance assumption.
 */
declare function gamesHowell(names: readonly string[], groups: readonly number[][], level?: number): PostHocPair[];
/** Pairwise Welch t, then p.adjust. Simpler than Games–Howell and more conservative. */
declare function welchPairs(names: readonly string[], groups: readonly number[][], adjust?: PAdjustMethod): PostHocPair[];
/**
 * Dunn's test — the post-hoc that belongs with Kruskal–Wallis.
 *
 * It re-uses the SAME pooled ranks and the SAME tie correction as the omnibus, which is the
 * whole point: running pairwise Mann–Whitney tests instead re-ranks within each pair and is
 * therefore a different test that can disagree with the omnibus it is supposed to follow.
 */
declare function dunnTest(names: readonly string[], groups: readonly number[][], adjust?: PAdjustMethod): PostHocPair[];
declare function postHoc(method: PostHocMethod, names: readonly string[], groups: readonly number[][], adjust?: PAdjustMethod, level?: number): PostHocPair[];
interface OmnibusChoice {
    anova: AnovaResult | null;
    welch: WelchAnovaResult | null;
    kruskal: KruskalResult | null;
}
interface CovariateReport {
    covariate: string;
    describe: Describe[];
    omnibus: OmnibusChoice;
    effects: EffectSizes;
    postHoc: PostHocPair[];
    method: PostHocMethod;
    /** True when the group variances differ enough that the pooled-variance tests are suspect. */
    heteroscedastic: boolean;
}
/** Levene's test (Brown–Forsythe, median-centred) — is the equal-variance assumption safe? */
declare function leveneBF(groups: readonly number[][]): {
    F: number;
    df1: number;
    df2: number;
    p: number;
} | null;
declare function analyseCovariate(covariate: string, names: readonly string[], groups: readonly number[][], options?: {
    method?: PostHocMethod | 'auto';
    adjust?: PAdjustMethod;
    level?: number;
}): CovariateReport;

export { AnovaResult, type CovariateReport, type Describe, type EffectSizes, KruskalResult, type OmnibusChoice, PAdjustMethod, type PostHocMethod, type PostHocPair, type WelchAnovaResult, analyseCovariate, describeGroups, dunnTest, effectSizes, gamesHowell, hedgesG, leveneBF, pnorm, postHoc, prange, ptukey, ptukeyUpper, qtukey, quantile7, tukeyHSD, welchAnova, welchPairs };
