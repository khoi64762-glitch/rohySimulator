import type { StoredTypingWindow, TypingMetricsV3 } from './storedTypingWindows';

/*
 * typingAnalytics — pools N typing episode windows into the one summary the
 * /analyze/typing dashboard renders. Pure functions over stored rows; no IO.
 *
 * Null discipline (AUTHORITATIVE for this module): the aggregator emits
 * `null` — and older `typing-v2` rows simply omit v3 fields — when a
 * measurement was NOT MADE (no word counts supplied, no boundary contexts,
 * no positioned revisions). Every pooled figure here stays `null` in that
 * case so the dashboard renders "—"; coercing to 0 would assert a
 * measurement that never happened. Sums pool only what was measured;
 * rates/means divide totals, never average per-episode rates (episodes have
 * very different durations).
 */

export interface TypingAggregateSummary {
  episodes: number;
  submitted: number;
  abandoned: number;
  /** Sum of episode wall-clock spans, ms. */
  totalElapsedMs: number;
  /** Sum of active ("hands on keys") time, ms. */
  totalActiveMs: number;

  // Production
  committedGraphemes: number;
  producedGraphemes: number | null;
  /** committed / produced over the pooled totals; null when nothing was produced. */
  productRatio: number | null;
  charsPerMin: number | null;
  charsPerMinActive: number | null;
  wordsPerMin: number | null;
  wordsPerMinActive: number | null;

  // Pausing
  /** Bucket-key → count, summed across episodes, in ascending bucket order. */
  pauseHistogram: Record<string, number>;
  /** Location → count summed across episodes; null when no episode ever carried boundary contexts. */
  pauseLocationCounts: Record<string, number> | null;

  // Bursts
  pBurstCount: number | null;
  rBurstCount: number | null;
  pBurstMeanGraphemes: number | null;
  rBurstMeanGraphemes: number | null;

  // Revision
  revisionRatio: number | null;
  revisionDistanceMean: number | null;
  leadingEdgeRevisionRatio: number | null;
  correctionCount: number | null;
}

/** Ops that count as revisions — matches TypingAggregator's `revisionOps`. */
const REVISION_OPS = new Set(['delete', 'replace', 'correct']);

/** Leading-edge tolerance the aggregator defaults to when a row's quality block lacks it. */
const DEFAULT_LEADING_EDGE_TOLERANCE = 2;

/** Canonical presentation order for pause locations (most → least local). */
export const PAUSE_LOCATION_ORDER = [
  'mid_word',
  'word_boundary',
  'sentence_boundary',
  'paragraph_boundary',
] as const;

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Ascending sort key for a pause-histogram bucket key (`lt_500_ms`,
 * `500_to_1000_ms`, `gte_5000_ms`, ...): the bucket's lower bound in ms.
 * Unrecognized keys sort last, preserving relative order.
 */
function pauseBucketLowerBound(key: string): number {
  if (key.startsWith('lt_')) return 0;
  const gte = /^gte_(\d+)_ms$/.exec(key);
  if (gte) return Number(gte[1]);
  const range = /^(\d+)_to_\d+_ms$/.exec(key);
  if (range) return Number(range[1]);
  return Number.MAX_SAFE_INTEGER;
}

/** Human label for a pause-histogram bucket key; falls back to the raw key. */
export function pauseBucketLabel(key: string): string {
  const seconds = (ms: number) => (ms % 1000 === 0 ? `${ms / 1000}` : `${(ms / 1000).toFixed(1)}`);
  const lt = /^lt_(\d+)_ms$/.exec(key);
  if (lt) return `< ${seconds(Number(lt[1]))} s`;
  const gte = /^gte_(\d+)_ms$/.exec(key);
  if (gte) return `≥ ${seconds(Number(gte[1]))} s`;
  const range = /^(\d+)_to_(\d+)_ms$/.exec(key);
  if (range) return `${seconds(Number(range[1]))}–${seconds(Number(range[2]))} s`;
  return key;
}

/**
 * Episode fluency for the table: the stored v3 `chars_per_min` when present,
 * else recomputed from the always-present v1 fields (identical formula).
 * Null when the episode had no elapsed time.
 */
export function episodeCharsPerMin(typing: TypingMetricsV3): number | null {
  const stored = num(typing.chars_per_min);
  if (stored !== null) return stored;
  const elapsed = num(typing.elapsed_ms) ?? 0;
  const committed = num(typing.committed_graphemes) ?? 0;
  return elapsed > 0 ? committed / (elapsed / 60000) : null;
}

export function aggregateTypingEpisodes(episodes: StoredTypingWindow[]): TypingAggregateSummary {
  let submitted = 0;
  let abandoned = 0;
  let totalElapsedMs = 0;
  let totalActiveMs = 0;
  let committedGraphemes = 0;
  let insertedGraphemes = 0;
  let deletedGraphemes = 0;

  // Word totals pool ONLY episodes that measured words; their elapsed/active
  // denominators are tracked separately so unmeasured episodes don't dilute
  // the rate.
  let sawProduced = false;
  let producedGraphemes = 0;
  let wordTotal = 0;
  let wordElapsedMs = 0;
  let sawWords = false;
  let wordActiveTotal = 0;
  let wordActiveMs = 0;
  let sawWordsActive = false;

  const pauseHistogram: Record<string, number> = {};
  const pauseLocations: Record<string, number> = {};
  let sawPauseLocations = false;

  let sawBursts = false;
  let pBurstCount = 0;
  let rBurstCount = 0;
  let pBurstGraphemes = 0;
  let rBurstGraphemes = 0;

  let revisionCount = 0;
  let revisionDistanceSum = 0;
  let leadingEdgeCount = 0;
  let sawRevisionDistances = false;
  let sawCorrections = false;
  let correctionCount = 0;

  for (const episode of episodes) {
    const t = episode.typing;
    if (t.submitted) submitted += 1;
    if (t.abandoned) abandoned += 1;
    const elapsed = num(t.elapsed_ms) ?? 0;
    const active = num(t.active_input_ms) ?? 0;
    const committed = num(t.committed_graphemes) ?? 0;
    totalElapsedMs += elapsed;
    totalActiveMs += active;
    committedGraphemes += committed;
    insertedGraphemes += num(t.inserted_graphemes) ?? 0;
    deletedGraphemes += num(t.deleted_graphemes) ?? 0;

    // produced_graphemes is v3; on v2 rows inserted_graphemes is the same
    // accumulator under its v1 name (see TypingAggregator.finalize()).
    const produced = num(t.produced_graphemes) ?? num(t.inserted_graphemes);
    if (produced !== null) {
      sawProduced = true;
      producedGraphemes += produced;
    }

    // Words: recover the episode's word count from its rate x its own
    // denominator, then pool counts over pooled denominators.
    const wpm = num(t.words_per_min);
    if (wpm !== null && elapsed > 0) {
      sawWords = true;
      wordTotal += wpm * (elapsed / 60000);
      wordElapsedMs += elapsed;
    }
    const wpmActive = num(t.words_per_min_active);
    if (wpmActive !== null && active > 0) {
      sawWordsActive = true;
      wordActiveTotal += wpmActive * (active / 60000);
      wordActiveMs += active;
    }

    if (t.pause_histogram && typeof t.pause_histogram === 'object') {
      for (const [key, count] of Object.entries(t.pause_histogram)) {
        const n = num(count);
        if (n !== null) pauseHistogram[key] = (pauseHistogram[key] ?? 0) + n;
      }
    }
    if (t.pause_location_counts && typeof t.pause_location_counts === 'object') {
      sawPauseLocations = true;
      for (const [key, count] of Object.entries(t.pause_location_counts)) {
        const n = num(count);
        if (n !== null) pauseLocations[key] = (pauseLocations[key] ?? 0) + n;
      }
    }

    const pCount = num(t.p_burst_count);
    const rCount = num(t.r_burst_count);
    if (pCount !== null || rCount !== null) {
      sawBursts = true;
      pBurstCount += pCount ?? 0;
      rBurstCount += rCount ?? 0;
      // Pooled mean = total graphemes / total bursts, reconstructed from each
      // episode's mean x count (mean is 0 when the count is 0).
      pBurstGraphemes += (num(t.p_burst_mean_graphemes) ?? 0) * (pCount ?? 0);
      rBurstGraphemes += (num(t.r_burst_mean_graphemes) ?? 0) * (rCount ?? 0);
    }

    // Revision distances: recompute from revision_locations (the aggregator
    // derives its own mean/median from the same capped array, so pooling the
    // entries is exactly consistent), honoring each episode's own
    // leading-edge tolerance.
    const tolerance =
      num(episode.quality?.thresholds && (episode.quality.thresholds as { leading_edge_tolerance_graphemes?: unknown }).leading_edge_tolerance_graphemes) ??
      DEFAULT_LEADING_EDGE_TOLERANCE;
    for (const entry of Array.isArray(t.revision_locations) ? t.revision_locations : []) {
      if (!REVISION_OPS.has(entry.op)) continue;
      const distance = num(entry.distance);
      if (distance === null) continue; // typing-v2 rows carry no distance — not measured.
      sawRevisionDistances = true;
      revisionCount += 1;
      revisionDistanceSum += distance;
      if (distance <= tolerance) leadingEdgeCount += 1;
    }

    const corrections = num(t.correction_count);
    if (corrections !== null) {
      sawCorrections = true;
      correctionCount += corrections;
    }
  }

  const orderedHistogram: Record<string, number> = {};
  for (const key of Object.keys(pauseHistogram).sort((a, b) => pauseBucketLowerBound(a) - pauseBucketLowerBound(b))) {
    orderedHistogram[key] = pauseHistogram[key];
  }

  const orderedLocations: Record<string, number> = {};
  if (sawPauseLocations) {
    for (const key of PAUSE_LOCATION_ORDER) {
      if (key in pauseLocations) orderedLocations[key] = pauseLocations[key];
    }
    for (const key of Object.keys(pauseLocations)) {
      if (!(key in orderedLocations)) orderedLocations[key] = pauseLocations[key];
    }
  }

  return {
    episodes: episodes.length,
    submitted,
    abandoned,
    totalElapsedMs,
    totalActiveMs,
    committedGraphemes,
    producedGraphemes: sawProduced ? producedGraphemes : null,
    productRatio: sawProduced && producedGraphemes > 0 ? committedGraphemes / producedGraphemes : null,
    charsPerMin: totalElapsedMs > 0 ? committedGraphemes / (totalElapsedMs / 60000) : null,
    charsPerMinActive: totalActiveMs > 0 ? committedGraphemes / (totalActiveMs / 60000) : null,
    wordsPerMin: sawWords && wordElapsedMs > 0 ? wordTotal / (wordElapsedMs / 60000) : null,
    wordsPerMinActive: sawWordsActive && wordActiveMs > 0 ? wordActiveTotal / (wordActiveMs / 60000) : null,
    pauseHistogram: orderedHistogram,
    pauseLocationCounts: sawPauseLocations ? orderedLocations : null,
    pBurstCount: sawBursts ? pBurstCount : null,
    rBurstCount: sawBursts ? rBurstCount : null,
    pBurstMeanGraphemes: sawBursts && pBurstCount > 0 ? pBurstGraphemes / pBurstCount : null,
    rBurstMeanGraphemes: sawBursts && rBurstCount > 0 ? rBurstGraphemes / rBurstCount : null,
    revisionRatio: insertedGraphemes > 0 ? deletedGraphemes / insertedGraphemes : null,
    revisionDistanceMean: sawRevisionDistances && revisionCount > 0 ? revisionDistanceSum / revisionCount : null,
    leadingEdgeRevisionRatio: sawRevisionDistances && revisionCount > 0 ? leadingEdgeCount / revisionCount : null,
    correctionCount: sawCorrections ? correctionCount : null,
  };
}
