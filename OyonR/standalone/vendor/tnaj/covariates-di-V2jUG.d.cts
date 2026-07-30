import { M as MetaData } from './prepare-long-CKL0YxYR.cjs';
import { A as AnovaResult, K as KruskalResult, a as ChisqResult, W as WelchPair, C as ChisqPair } from './group-tests-DmTg7_MZ.cjs';
import { P as PAdjustMethod } from './pAdjust-DGekUM6t.cjs';

/**
 * Weighted multinomial logistic regression — the M-step of a COVARIATE mixture model.
 *
 * A plain mixture Markov model has one mixing weight per cluster: pi_m, the same for every
 * sequence. A covariate MMM lets the mixing weights depend on what you know about the case:
 *
 *     pi_i = softmax(X_i · B)
 *
 * so "who ends up in cluster 2" becomes a multinomial logit on the metadata, estimated
 * INSIDE the EM rather than tested after it. That is the whole difference between modelling
 * membership and describing it: the post-hoc route (cluster, then ANOVA the covariates
 * against the hard labels) throws away classification uncertainty and reports p-values that
 * are too confident. Here the responsibilities stay soft and the covariates see them soft.
 *
 * The responses are therefore FRACTIONAL — R[i][m] is a posterior, not a 0/1 label — which
 * is exactly `nnet::multinom` with case weights, and is what the parity test pins against.
 *
 * Fitted by Newton–Raphson on the full (k-1)x(p+1) coefficient block:
 *     score:    g[m][j] = sum_i x_ij (R_im - pi_im)
 *     information: I[(m,j),(l,q)] = sum_i x_ij x_iq pi_im (delta_ml - pi_il)
 * Both are exact; there is no line search because the multinomial log-likelihood is concave
 * in B, so undamped Newton converges from any start.
 */
/** Row-major (k-1) x p1 coefficients, plus what the caller needs to report them. */
interface MultinomFit {
    /** beta[m][j] — m indexes the NON-REFERENCE clusters in order, j the columns of X. */
    beta: number[][];
    /** Fitted priors, n x k, in ORIGINAL cluster order (the reference class included). */
    priors: number[][];
    /** Weighted multinomial log-likelihood at the fit. */
    logLik: number;
    iterations: number;
    converged: boolean;
}
/** Solve A·x = b in place by Gauss–Jordan with partial pivoting. Returns null if singular.
 *  Also used to invert the information matrix for standard errors. */
declare function solveLinear(A: number[][], b: number[]): number[] | null;
/** Inverse of a symmetric positive-definite matrix, or null if it is not invertible. */
declare function invertMatrix(A: number[][]): number[][] | null;
declare function fitMultinom(X: number[][], R: number[][], refIdx: number, beta0?: number[][], opts?: {
    maxIter?: number;
    tol?: number;
    ridge?: number;
    firth?: boolean;
}): MultinomFit;
/**
 * Standard errors for the coefficients — by LOUIS' IDENTITY, not from the M-step.
 *
 * This is the part every two-step gets wrong, and it is easy to get wrong here too. The
 * M-step's information matrix is the COMPLETE-data information: it is what you would have if
 * you KNEW which cluster every sequence belonged to. You do not. Using it treats a sequence
 * with posterior (0.51, 0.49) as a certain member, and the standard errors come out too
 * small — the exact bias the covariate MMM exists to avoid.
 *
 * Louis (1982): observed = complete − missing, where the missing information is the
 * conditional VARIANCE of the complete-data score:
 *
 *     I_obs = sum_i x_i x_i^T ⊗ [ (diag(pi_i) − pi_i pi_i^T) − (diag(R_i) − R_i R_i^T) ]
 *
 * and it behaves exactly as it should at both extremes. Responsibilities near 0/1 (clusters
 * cleanly separated) → the missing term vanishes → the complete-data SEs, which are then
 * honest. Responsibilities near the priors (clusters not identified by the data at all) →
 * the two terms cancel → the information goes to zero and the SEs blow up, which is the
 * truth: nothing has been learned about who belongs where.
 *
 * LIMITATION, stated because it is real: this is the B-block of the information only. It
 * conditions on the transition and initial-state parameters at their MLEs and does not
 * propagate their uncertainty into B. seqHMM differentiates the whole parameter vector.
 */
declare function multinomSE(X: number[][], R: number[][], priors: number[][], refIdx: number): {
    se: number[][];
    ok: boolean;
};

/**
 * clusterCovariates — do the clusters differ on the metadata, and who ends up where?
 *
 * The engine-side counterpart of `Nestimate::build_clusters(covariates = ~ Age + Gender)`,
 * which resolves covariate names against the metadata and fits `nnet::multinom` of cluster
 * membership on them. Two questions, deliberately answered separately because they are not
 * the same question:
 *
 *   PROFILE   — one test per covariate, marginally. Numeric → ANOVA (F, eta^2) + Kruskal–
 *               Wallis. Categorical → chi-square + Cramér's V + per-cell standardized
 *               residuals. Plus pairwise post-hoc, so a significant omnibus names the
 *               clusters that actually differ. This is what a reader wants first: it says
 *               WHICH covariates the clusters differ on, one at a time.
 *
 *   MEMBERSHIP— one multinomial logit of cluster membership on ALL covariates at once, so
 *               each is adjusted for the others. A covariate that only looks significant
 *               because it proxies another shows up here and nowhere in the profile.
 *
 * THE TWO-STEP, said once and meant. Both run on the HARD assignment, so a sequence with
 * posterior (0.51, 0.49) counts as a certain member: classification uncertainty is discarded
 * and the p-values are optimistic. That is what Nestimate does and what everyone reports, and
 * it is still the two-step. It DESCRIBES the clusters you got. To claim a covariate PREDICTS
 * membership, put it in the model — `mmm({ covariates })` fits the logit inside the EM, keeps
 * the responsibilities soft, and gets standard errors (Louis) that carry the uncertainty.
 */

interface CovariateProfileRow {
    covariate: string;
    kind: 'numeric' | 'categorical' | 'skipped';
    /** Why it was not tested (constant, all-missing, one level, …). */
    reason?: string;
    /** Per-cluster descriptives — mean/sd for numeric, counts per level for categorical. */
    byCluster?: {
        cluster: string;
        n: number;
        mean?: number;
        sd?: number;
        counts?: number[];
    }[];
    levels?: string[];
    anova?: AnovaResult;
    kruskal?: KruskalResult;
    chisq?: ChisqResult;
    postHocNumeric?: WelchPair[];
    postHocCategorical?: ChisqPair[];
}
interface MembershipModel {
    terms: string[];
    refCluster: string;
    clusters: string[];
    coefficients: number[][];
    se: number[][];
    z: number[][];
    pValues: number[][];
    oddsRatios: number[][];
    ciLower: number[][];
    ciUpper: number[][];
    /** The dropped reference level of every factor term. */
    reference: Record<string, string>;
    /** Sessions dropped for a missing covariate value — never imputed to 0. */
    dropped: number;
    /** False when the standard errors are not USABLE — not merely when a matrix failed to invert.
     *  A separated fit inverts fine and returns an SE of 194,000; that is not a standard error,
     *  it is the MLE sitting on the boundary. When this is false the coefficients, p-values, ORs
     *  and CIs in this object are all meaningless and must not be reported. */
    seOk: boolean;
    /** True when the fit fell back to Firth's penalised likelihood — either because a cluster ×
     *  level cell was empty, or because the unpenalised fit turned out to be (quasi-)separated
     *  (a continuous covariate that orders the clusters too well, or a tiny cluster, neither of
     *  which leaves an empty cell). Nestimate does the same (`estimator = "auto"`). */
    firth: boolean;
}
interface ClusterCovariatesResult {
    clusters: string[];
    profile: CovariateProfileRow[];
    membership?: MembershipModel;
}
interface ClusterCovariatesOptions {
    /** Metadata column names to use. Default: every column except `.session_id`/`.session_nr`. */
    terms?: string[];
    /** Multiplicity adjustment for the pairwise post-hoc. Default 'holm'. */
    adjust?: PAdjustMethod;
    /** Also fit the multivariate membership logit. Default true. */
    membership?: boolean;
    /** Reference cluster for the logit, by NAME. Default: the first cluster. */
    refCluster?: string;
    /** Confidence level for the coefficient CIs. Default 0.05 (95%), as R `mmm_stats`. */
    level?: number;
    /** Cluster labels, in assignment order. Default 'Cluster 1'..'Cluster k'. */
    clusterNames?: string[];
}
/**
 * @param assignments 1-indexed cluster of each session, index-aligned with `meta.rows`.
 */
declare function clusterCovariates(assignments: readonly number[], meta: MetaData, options?: ClusterCovariatesOptions): ClusterCovariatesResult;

export { type ClusterCovariatesOptions as C, type MembershipModel as M, type ClusterCovariatesResult as a, type CovariateProfileRow as b, clusterCovariates as c, type MultinomFit as d, fitMultinom as f, invertMatrix as i, multinomSE as m, solveLinear as s };
