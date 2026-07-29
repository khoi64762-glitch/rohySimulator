// Type declarations for the Oyon discourse subpaths (`oyon/discourse`,
// `oyon/text`). Hand-written; consult JSDoc and the source modules
// (`src/aggregation/DiscourseAggregator.js`, `src/analytics/TextAnalyzer.js`)
// for authoritative shapes. See docs/DISCOURSE.md.

/**
 * Speech-act label, drawn from `OYON_DISCOURSE_STATES` (`discourse-states-v1`,
 * `src/version.js`). Mirrored here rather than imported because
 * `types/version.d.ts` does not (yet) declare `OYON_DISCOURSE_STATES` — if
 * the vocabulary changes, update `src/version.js` first and mirror the
 * change here; this file must never define states of its own.
 */
export type DiscourseAct = 'thinking' | 'request' | 'question' | 'directive' | 'statement';

/**
 * Language code driving `classifySentence`'s rule set. `'en'` (the default)
 * runs the full five-rule classifier below; any other value degrades to
 * PUNCTUATION-ONLY classification (`question` on a terminal `?`/`؟`/`？`,
 * `statement` otherwise) — see docs/DISCOURSE.md "Language limitation".
 */
export type DiscourseLang = string;

/** Grapheme/word `Intl.Segmenter`-shaped injection point, matching `TypingComposerAdapter`'s convention. `false` forces the regex fallback. */
export interface DiscourseSegmenterLike {
  segment(text: string): Iterable<{ segment: string; isWordLike?: boolean }>;
}

export interface ClassifySentenceOptions {
  lang?: DiscourseLang;
  /** Replaces (does NOT append to) `DEFAULT_HEDGES` — see docs/DISCOURSE.md "the `hedges` option". */
  hedges?: string[];
  /** Replaces `DEFAULT_REQUEST_MARKERS`. */
  requestMarkers?: string[];
  /** Replaces `DEFAULT_WH_WORDS`. */
  whWords?: string[];
  /** Replaces `DEFAULT_POLAR_AUX_WORDS`. */
  polarAuxWords?: string[];
  /** Replaces `DEFAULT_DIRECTIVES`. */
  directives?: string[];
}

export interface ClassifySentenceResult {
  act: DiscourseAct;
  /**
   * Names the literal marker/rule that fired — e.g. `'hedge:maybe'`,
   * `'request:can you'`, `'question:wh:why'`, `'question:aux:do'`,
   * `'question:terminal:?'`, `'directive:explain'`, or (non-English)
   * `'punctuation:?'`. `null` for the default `statement` case.
   */
  matched: string | null;
}

export interface SplitSentencesOptions {
  /** Injection point for a sentence `Intl.Segmenter`-shaped object; `false` forces the regex fallback (`.!?؟？！。`). */
  sentenceSegmenter?: { segment(text: string): Iterable<{ segment: string }> } | false;
}

export interface WordSegmenterOptions {
  /** Injection point for a word `Intl.Segmenter`-shaped object; `false` forces the regex fallback. */
  wordSegmenter?: DiscourseSegmenterLike | false;
}

export type TextAnalyzerOptions = ClassifySentenceOptions & SplitSentencesOptions & WordSegmenterOptions;

/**
 * Split `text` into an ordered array of trimmed, non-empty sentence strings.
 * Prefers `Intl.Segmenter({ granularity: 'sentence' })`; repairs the common
 * false splits after `e.g.`/`i.e.`/`Dr.`/`Mr.`/`Mrs.`/`Ms.`/`Prof.` — see
 * docs/DISCOURSE.md "Sentence splitting".
 */
export function splitSentences(text: string, options?: SplitSentencesOptions): string[];

/**
 * Classify one sentence into a speech act. FIRST MATCH WINS across exactly
 * five precedence-ordered rules — see docs/DISCOURSE.md for the full table
 * and the "I think" exclusion.
 */
export function classifySentence(sentence: string, options?: ClassifySentenceOptions): ClassifySentenceResult;

/** Word tokens in `text`, in order (via `Intl.Segmenter({ granularity: 'word' })`'s `isWordLike` segments, or a regex fallback). */
export function extractWords(text: string, options?: WordSegmenterOptions): string[];

/** `extractWords(text, options).length`. */
export function countWords(text: string, options?: WordSegmenterOptions): number;

/** Paragraph count: `text` split on one-or-more blank lines. Non-empty text with no blank line is one paragraph; empty/whitespace-only text is zero. */
export function countParagraphs(text: string): number;

/**
 * The `text-v1` metrics block. `deep_question_ratio` is `null` — never `0`
 * — when `question_count` is 0, so "never asked" stays distinguishable from
 * "asked only shallow questions". `deep_question_count`/`shallow_question_count`
 * implement Graesser & Person's causal-explanatory (why/how) vs. retrieval
 * (what/who/when/where/which) question taxonomy — see docs/DISCOURSE.md.
 */
export interface DiscourseTextMetrics {
  word_count: number;
  sentence_count: number;
  paragraph_count: number;
  mean_words_per_sentence: number;
  mean_word_length: number;
  type_token_ratio: number;
  long_word_ratio: number;
  question_count: number;
  directive_count: number;
  request_count: number;
  statement_count: number;
  thinking_count: number;
  deep_question_count: number;
  shallow_question_count: number;
  polar_question_count: number;
  question_ratio: number;
  deep_question_ratio: number | null;
  speech_act_lang: string;
}

export interface ComputeTextMetricsInput {
  sentenceActs?: Array<{ act: DiscourseAct; matched: string | null }>;
  words?: string[];
  paragraphCount?: number;
  lang?: DiscourseLang;
}

/**
 * Pure aggregation from already-classified sentences (`{ act, matched }`)
 * and already-extracted word tokens into the `text-v1` metrics block. Used
 * by both `analyzeText` (single text) and `DiscourseAggregator.finalize()`
 * (accumulated across possibly-multiple `analyze()` calls) so the ratio/
 * count formulas live in exactly one place.
 */
export function computeTextMetrics(input?: ComputeTextMetricsInput): DiscourseTextMetrics;

/**
 * One entry of `analyzeText()`'s `sentences` array — deliberately WITHOUT
 * the sentence text itself or `matched` (call `classifySentence` directly
 * for that level of detail). `charCount` is a Unicode code-point count, not
 * a full grapheme-cluster count — see docs/DISCOURSE.md "Known limitations".
 */
export interface DiscourseSentenceSummary {
  index: number;
  act: DiscourseAct;
  wordCount: number;
  charCount: number;
}

export interface AnalyzeTextResult {
  metrics: DiscourseTextMetrics;
  sentences: DiscourseSentenceSummary[];
}

/** Split, classify, and compute `text-v1` metrics over one text in a single call. */
export function analyzeText(text: string, options?: TextAnalyzerOptions): AnalyzeTextResult;

/** Tentative/epistemic markers for rule 1 (`thinking`). Deliberately excludes "I think" — see docs/DISCOURSE.md. */
export const DEFAULT_HEDGES: readonly string[];
/** Mitigated-directive markers for rule 2 (`request`). */
export const DEFAULT_REQUEST_MARKERS: readonly string[];
/** Sentence-initial wh-words for rule 3 (`question`). */
export const DEFAULT_WH_WORDS: readonly string[];
/** Sentence-initial polar (yes/no) auxiliaries for rule 3 (`question`). */
export const DEFAULT_POLAR_AUX_WORDS: readonly string[];
/** Sentence-initial base verbs for rule 4 (`directive`). */
export const DEFAULT_DIRECTIVES: readonly string[];

// ---------------------------------------------------------------------------
// DiscourseAggregator
// ---------------------------------------------------------------------------

/**
 * `detail` shape for one per-sentence discourse event. Deliberately NEVER
 * carries the sentence text — a redundancy rule, not a privacy rule; see
 * `DiscourseAggregator`'s class doc comment and docs/DISCOURSE.md.
 */
export interface DiscourseEventDetail {
  /** Running sentence counter across the WHOLE episode (not reset per `analyze()` call). */
  index: number;
  words: number;
  matched: string | null;
}

/** One event handed to `DiscourseAggregator`'s `onEvent` callback — one per sentence, in order. */
export interface DiscourseEvent {
  modality: 'discourse';
  state: DiscourseAct;
  source: 'user';
  /** Approximate wall-clock ms. */
  timestamp: number;
  /** Monotonic ms (the `analyze()` call's `timestamp` argument, when supplied). */
  monotonic_ms: number;
  detail: DiscourseEventDetail;
}

export interface DiscourseQuality {
  lang: DiscourseLang;
  /** Whether `hedges` was the built-in default list or a caller override. */
  hedges: 'default' | 'custom';
  /** Whether `directives` was the built-in default list or a caller override. */
  directives: 'default' | 'custom';
  /** `OYON_DISCOURSE_STATES_VERSION` (`src/version.js`) — the vocabulary is defined IN precedence order, so this doubles as the precedence-order version. */
  precedence_version: string;
}

export interface DiscourseWindow {
  modality: 'discourse';
  window_kind: 'episode';
  feature_profile: 'text-v1';
  window_start: string;
  window_end: string;
  text: DiscourseTextMetrics;
  quality: DiscourseQuality;
}

export interface DiscourseAggregatorOptions {
  /** Per-sentence event sink. `null`/omitted (default) means "emit nothing". */
  onEvent?: ((event: DiscourseEvent) => void) | null;
  /** Wall clock, used to stamp `window_start`/`window_end` and as the fallback event timestamp. Default `() => Date.now()`. */
  now?: () => number;
  /** Default `'en'`. See `DiscourseLang`. */
  lang?: DiscourseLang;
  /** `null` (default) uses `TextAnalyzer`'s built-in `DEFAULT_HEDGES`; supplying a list REPLACES it. */
  hedges?: string[] | null;
  /** `null` (default) uses `TextAnalyzer`'s built-in `DEFAULT_DIRECTIVES`; supplying a list REPLACES it. */
  directives?: string[] | null;
}

export interface DiscourseAnalyzeArgs {
  /** Monotonic ms (mirrors `TypingAggregator.record()`'s convention). */
  timestamp?: number;
  /** Optional real `Date.now()` reading; stamps `window_start` on the call that opens the episode. */
  wallTimestamp?: number;
}

export interface DiscourseFinalizeArgs {
  timestamp?: number;
}

/**
 * Aggregates per-sentence speech-act classification and `text-v1` metrics,
 * across one or more `analyze()` calls, into a `discourse` episode window.
 * Pure: no DOM, no timers, no globals. There is no separate `start()` — the
 * first `analyze()` call that produces at least one sentence implicitly
 * opens the episode; see the class doc comment in
 * `src/aggregation/DiscourseAggregator.js` and docs/DISCOURSE.md.
 */
export class DiscourseAggregator {
  constructor(options?: DiscourseAggregatorOptions);
  options: Required<DiscourseAggregatorOptions>;
  /** True once the first non-empty `analyze()` call has opened the episode. */
  readonly active: boolean;
  /** Classify every sentence in `text` and emit one event per sentence, in order. No-op (`[]`) for empty/whitespace-only text. */
  analyze(text: string, args?: DiscourseAnalyzeArgs): DiscourseEvent[];
  /** End the episode and return its window, or `null` if it never opened. */
  finalize(args?: DiscourseFinalizeArgs): DiscourseWindow | null;
}
