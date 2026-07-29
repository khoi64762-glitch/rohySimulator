/**
 * TextAnalyzer — pure, DOM-free sentence splitting, speech-act classification,
 * and text metrics (`text-v1`) for the `discourse` modality.
 *
 * No DOM, no timers, no globals beyond `Intl.Segmenter` feature-detection.
 * Every function here takes a plain string and options bag and returns a
 * plain value; nothing is retained across calls (that statefulness lives in
 * `DiscourseAggregator`, `src/aggregation/DiscourseAggregator.js`).
 *
 * ---- what this is NOT ----
 *
 * This is not sentiment analysis, not a language model, and not a full NLP
 * pipeline. It is a small, precedence-ordered rule engine over sentence-level
 * lexical markers (see `classifySentence` below) plus a handful of standard
 * writing-metrics formulas. Zero new dependencies — no `carm-text`, no
 * tokenizer package. `Intl.Segmenter` (sentence + word granularity) is used
 * when the host provides it, with documented regex fallbacks otherwise —
 * exactly the pattern `TypingComposerAdapter` already uses for grapheme/word
 * counting (`src/capture/TypingComposerAdapter.js`); read that file's
 * `countGraphemesAndWords` before touching this one.
 *
 * ---- sentence splitting ----
 *
 * `splitSentences` prefers `Intl.Segmenter({ granularity: 'sentence' })`;
 * without it, falls back to splitting on `.!?` plus the Arabic question mark
 * `؟` (U+061F) and the full-width/CJK terminators `？`/`！`/`。`. In the
 * fallback, an ASCII `.` only terminates a sentence when it is followed by
 * whitespace or end-of-text — a `.` glued to a following character is
 * intra-token punctuation (`3.14`, `example.com/a`, the interior periods of
 * `e.g.`) and never a boundary. The non-ASCII terminators split
 * unconditionally (CJK text has no inter-sentence spaces). Both paths
 * are then run through `mergeAbbreviationSplits`, which re-joins a sentence
 * that Intl.Segmenter (or the fallback) split immediately after a small,
 * FIXED list of common abbreviations (`e.g.`, `i.e.`, `Dr.`, `Mr.`, `Mrs.`,
 * `Ms.`, `Prof.`) — verified against Node's real ICU sentence breaker, which
 * DOES split "I met Dr. Smith yesterday." into "I met Dr." + "Smith
 * yesterday." without this pass. This is deliberately minimal: it is NOT a
 * general abbreviation model (no exhaustive title/acronym list, no
 * locale-specific rules) — see docs/DISCOURSE.md "Known failure modes".
 *
 * ---- speech-act classification: precedence IS the design ----
 *
 * `classifySentence` collects one candidate per marker family and picks the
 * winner by EARLIEST MATCH POSITION in the sentence, breaking position ties
 * by family rank — see `docs/DISCOURSE.md` for the full table and the
 * reasoning behind each precedence call:
 *
 *   - thinking  — a tentative/epistemic marker (the `hedges` list), matched
 *                 ANYWHERE in the sentence; candidate position = where its
 *                 earliest marker occurs.
 *   - request   — a mitigated-directive marker (`can you`, `please`, ...),
 *                 matched anywhere; position likewise.
 *   - question  — a SENTENCE-INITIAL wh-word or polar auxiliary; position =
 *                 the first word (effectively 0).
 *   - directive — a SENTENCE-INITIAL base verb from a closed list
 *                 (`explain`, `describe`, `summarise`, ...); position 0.
 *   - Tie rank at equal position: thinking > request > question > directive.
 *   - Fallbacks, only when NO family matched: a terminal question mark
 *     (`?`/`؟`/`？`) makes it a `question`; otherwise `statement`.
 *
 * Position-first is what keeps the anywhere-matched families honest: an
 * interior hedge or request marker must not override an obvious
 * sentence-initial question or directive ("Why can you not do this?" is a
 * question, "Explain why it might fail." is a directive), while a
 * SENTENCE-INITIAL hedge/request still wins its ties ("What if we tried Y?"
 * → thinking beats the wh-reading of "what"; "Can you explain X?" → request
 * beats the polar-aux reading of "can"). One deliberate consequence of the
 * fallback demotion: a sentence-initial directive with a terminal question
 * mark ("Explain this?") classifies as `directive` — the imperative verb is
 * stronger evidence than the punctuation.
 *
 * **"I think" is deliberately excluded from the hedge list.** It is so
 * common in everyday writing that including it would swallow a huge share
 * of the corpus into `thinking`, and "I think X is wrong" reads as a
 * hedged ASSERTION (the writer is stating a position, tentatively) rather
 * than genuine open-ended exploration the way "I wonder whether X" or "what
 * if X" do. This is a defensible-but-contestable call — see
 * `tests/text-analyzer.test.js` case "I think this is wrong." → `statement`,
 * which exists specifically to pin this exclusion down, and
 * `docs/DISCOURSE.md` for the fuller argument. The hedge list is an OPTION
 * (`options.hedges`, replacing — not appending to — `DEFAULT_HEDGES`) so a
 * host that disagrees with this call can override it without touching this
 * file.
 *
 * `classifySentence` always returns `{ act, matched }`: `matched` names the
 * literal marker (or rule) that fired, e.g. `'hedge:maybe'`,
 * `'request:can you'`, `'question:wh:why'`, `'question:aux:do'`,
 * `'question:terminal:?'`, `'directive:explain'`, or `null` for the default
 * `statement` case. This audit trail matters more than the label itself —
 * a researcher can always ask "why was this sentence tagged `request`?" and
 * get a literal answer instead of having to re-run the classifier mentally.
 *
 * ---- language ----
 *
 * `options.lang` (default `'en'`). The five-rule classifier above is
 * English-only — the marker lists are English phrases/words. For any other
 * `lang`, classification degrades to PUNCTUATION-ONLY: a sentence ending in
 * `?`/`؟`/`？` is `question`, everything else is `statement` — `thinking`,
 * `request`, and `directive` are simply never produced. Every metrics block
 * reports `speech_act_lang` so a consumer can tell an English session (where
 * all five acts are meaningful) from a non-English one (where only two are)
 * without cross-referencing anything else.
 *
 * ---- text-v1 metrics ----
 *
 * `deep_question_count` / `shallow_question_count` implement Graesser &
 * Person's (1994) shallow-vs-deep question taxonomy: why/how questions are
 * CAUSAL-EXPLANATORY (deep — they ask for a mechanism or reason), while
 * what/who/when/where/which questions are RETRIEVAL (shallow — they ask for
 * a fact). `deep_question_ratio` is `deep_question_count / question_count`,
 * and is `null` — never `0` — when `question_count` is 0, so "no questions
 * asked" stays distinguishable from "asked only shallow questions".
 */

// ---------------------------------------------------------------------------
// Marker vocabularies (English classification only — see class doc "language").
// Exported so a host can build an override list by EXTENDING a default
// (`[...DEFAULT_HEDGES, 'my new hedge']`) rather than re-typing it from
// scratch when it only wants to add, not fully replace.
// ---------------------------------------------------------------------------

/**
 * Tentative/epistemic markers for rule 1 (`thinking`). Deliberately excludes
 * "I think" — see the module doc comment above. Matched ANYWHERE in the
 * sentence (word-boundary, case-insensitive), not just sentence-initially.
 */
export const DEFAULT_HEDGES = Object.freeze([
  'i wonder',
  'maybe',
  'perhaps',
  'might',
  'what if',
  'suppose',
  'not sure',
  'unsure',
  'could it be',
  'it seems',
  'seems like',
  'i guess',
  'possibly',
  'presumably',
]);

/** Mitigated-directive markers for rule 2 (`request`). Matched anywhere. */
export const DEFAULT_REQUEST_MARKERS = Object.freeze([
  'can you',
  'could you',
  'would you',
  'will you',
  'please',
  "i'd like you to",
  'i would like you to',
  'would it be possible',
  'do you mind',
]);

/** Sentence-initial wh-words for rule 3 (`question`). */
export const DEFAULT_WH_WORDS = Object.freeze([
  'what', 'who', 'whom', 'whose', 'when', 'where', 'which', 'why', 'how',
]);

/** why/how are causal-explanatory ("deep"); the rest are retrieval ("shallow") — Graesser & Person. */
const DEEP_WH_WORDS = new Set(['why', 'how']);

/** Sentence-initial polar (yes/no) auxiliaries for rule 3 (`question`). */
export const DEFAULT_POLAR_AUX_WORDS = Object.freeze([
  'do', 'does', 'did', 'is', 'are', 'was', 'were', 'am',
  'can', 'could', 'will', 'would', 'should', 'shall',
  'have', 'has', 'had', 'may', 'might', 'must',
]);

/** Sentence-initial base verbs for rule 4 (`directive`). */
export const DEFAULT_DIRECTIVES = Object.freeze([
  'explain', 'describe', 'summarise', 'summarize', 'list', 'write', 'give',
  'tell', 'show', 'compare', 'define', 'analyse', 'analyze', 'rewrite',
  'fix', 'translate', 'continue', 'expand', 'clarify', 'outline',
]);

/**
 * Minimal, FIXED abbreviation list for `splitSentences`'s false-split
 * repair — see module doc comment. Not a general abbreviation model; kept
 * intentionally small.
 */
const ABBREVIATIONS = Object.freeze(['e.g', 'i.e', 'dr', 'mr', 'mrs', 'ms', 'prof']);

const TERMINAL_QUESTION_RE = /[?؟？]\s*$/;
// Fallback sentence boundaries: `!?؟？！。` runs split unconditionally, but an
// ASCII `.` run only when followed by whitespace/end-of-text — a period glued
// to the next character is intra-token (`3.14`, `example.com`, `e.g.`), not a
// sentence boundary. (`e.g. ` / `Dr. ` false splits at a REAL boundary are
// then repaired by `mergeAbbreviationSplits`.)
const SENTENCE_TERMINATOR_RE = /[!?؟？！。]+|\.+(?=\s|$)/g;
const WORD_FALLBACK_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

const ABBREVIATION_END_RE = new RegExp(
  `\\b(?:${ABBREVIATIONS.map(escapeRegex).join('|')})\\.\\s*$`,
  'i',
);

const markerRegexCache = new Map();

// ---------------------------------------------------------------------------
// Sentence splitting
// ---------------------------------------------------------------------------

/**
 * Split `text` into an ordered array of trimmed, non-empty sentence strings.
 * Prefers `Intl.Segmenter({ granularity: 'sentence' })`; falls back to a
 * regex split on `.!?؟？！。` when unavailable (or when `options.sentenceSegmenter
 * === false`, which forces the fallback for testing). Both paths are passed
 * through `mergeAbbreviationSplits` to repair the common false splits after
 * `e.g.` / `i.e.` / `Dr.` / `Mr.` / `Mrs.` / `Ms.` / `Prof.` — see the module
 * doc comment.
 */
export function splitSentences(text, options = {}) {
  if (typeof text !== 'string' || text.trim().length === 0) return [];

  const segmenter = resolveSentenceSegmenter(options);
  const rawSegments = segmenter
    ? [...segmenter.segment(text)].map((entry) => entry.segment)
    : splitSentencesFallback(text);

  const merged = mergeAbbreviationSplits(rawSegments);
  return merged.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

function resolveSentenceSegmenter(options) {
  if (options.sentenceSegmenter === false) return null;
  if (options.sentenceSegmenter) return options.sentenceSegmenter;
  return createDefaultSentenceSegmenter();
}

function createDefaultSentenceSegmenter() {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return new Intl.Segmenter(undefined, { granularity: 'sentence' });
  }
  return null;
}

function splitSentencesFallback(text) {
  const segments = [];
  let lastIndex = 0;
  let match;
  SENTENCE_TERMINATOR_RE.lastIndex = 0;
  while ((match = SENTENCE_TERMINATOR_RE.exec(text)) !== null) {
    const end = match.index + match[0].length;
    segments.push(text.slice(lastIndex, end));
    lastIndex = end;
  }
  if (lastIndex < text.length) segments.push(text.slice(lastIndex));
  return segments;
}

/**
 * Re-join adjacent raw segments when the boundary between them immediately
 * follows one of the fixed `ABBREVIATIONS` — a minimal repair, not a general
 * abbreviation model (see module doc comment).
 */
function mergeAbbreviationSplits(rawSegments) {
  const merged = [];
  let buffer = '';
  for (const segment of rawSegments) {
    buffer += segment;
    if (ABBREVIATION_END_RE.test(buffer)) continue;
    merged.push(buffer);
    buffer = '';
  }
  if (buffer.length > 0) merged.push(buffer);
  return merged;
}

// ---------------------------------------------------------------------------
// Word extraction / counting
// ---------------------------------------------------------------------------

/**
 * Word tokens (strings) in `text`, in order. Uses
 * `Intl.Segmenter({ granularity: 'word' })` counting only `isWordLike`
 * segments when available (correct for CJK/Thai and other scripts without
 * inter-word spaces — see `TypingComposerAdapter`'s identical convention);
 * otherwise a Unicode-aware letter/number run regex, tolerating an internal
 * apostrophe so contractions count as one word.
 */
export function extractWords(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];

  const segmenter = resolveWordSegmenter(options);
  if (segmenter) {
    const tokens = [];
    for (const entry of segmenter.segment(text)) {
      if (entry.isWordLike) tokens.push(entry.segment);
    }
    return tokens;
  }

  const matches = text.match(WORD_FALLBACK_RE);
  return matches ? matches : [];
}

/** `extractWords(text, options).length` — see `extractWords`. */
export function countWords(text, options = {}) {
  return extractWords(text, options).length;
}

function resolveWordSegmenter(options) {
  if (options.wordSegmenter === false) return null;
  if (options.wordSegmenter) return options.wordSegmenter;
  return createDefaultWordSegmenter();
}

function createDefaultWordSegmenter() {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return new Intl.Segmenter(undefined, { granularity: 'word' });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Paragraphs
// ---------------------------------------------------------------------------

/**
 * Paragraph count: `text` split on one-or-more blank lines. A non-empty text
 * with no blank line is one paragraph; empty/whitespace-only text is zero.
 */
export function countParagraphs(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return 0;
  const paragraphs = text
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  return paragraphs.length > 0 ? paragraphs.length : 1;
}

// ---------------------------------------------------------------------------
// Speech-act classification
// ---------------------------------------------------------------------------

/**
 * Classify one sentence into a speech act. See the module doc comment for
 * the full five-rule precedence order and the "I think" exclusion. Returns
 * `{ act, matched }` — `act` is one of `OYON_DISCOURSE_STATES`
 * (`src/version.js`); `matched` names the literal marker/rule that fired, or
 * `null` for the default `statement` case.
 */
export function classifySentence(sentence, options = {}) {
  const trimmed = typeof sentence === 'string' ? sentence.trim() : '';
  if (trimmed.length === 0) return { act: 'statement', matched: null };

  const lang = resolveLang(options.lang);

  // Non-English: punctuation-only — see module doc comment "language".
  if (lang !== 'en') {
    if (TERMINAL_QUESTION_RE.test(trimmed)) return { act: 'question', matched: 'punctuation:?' };
    return { act: 'statement', matched: null };
  }

  const normalized = normalizeApostrophes(trimmed.toLowerCase());

  // One candidate per family; winner = earliest position in the sentence,
  // ties broken by `rank` (thinking > request > question > directive) — see
  // the module doc comment "speech-act classification".
  const candidates = [];

  const hedges = options.hedges || DEFAULT_HEDGES;
  const hedgeMatch = findEarliestMarker(normalized, hedges);
  if (hedgeMatch) {
    candidates.push({ act: 'thinking', matched: `hedge:${hedgeMatch.marker}`, position: hedgeMatch.index, rank: 0 });
  }

  const requestMarkers = options.requestMarkers || DEFAULT_REQUEST_MARKERS;
  const requestMatch = findEarliestMarker(normalized, requestMarkers);
  if (requestMatch) {
    candidates.push({ act: 'request', matched: `request:${requestMatch.marker}`, position: requestMatch.index, rank: 1 });
  }

  // Question/directive markers are sentence-INITIAL only: their position is
  // the first word's own offset (0 barring leading punctuation), measured on
  // the same normalized string as the hedge/request positions.
  const first = firstWordToken(normalized);
  if (first) {
    const whWords = options.whWords || DEFAULT_WH_WORDS;
    if (whWords.includes(first.word)) {
      candidates.push({ act: 'question', matched: `question:wh:${first.word}`, position: first.index, rank: 2 });
    }
    const polarAuxWords = options.polarAuxWords || DEFAULT_POLAR_AUX_WORDS;
    if (polarAuxWords.includes(first.word)) {
      candidates.push({ act: 'question', matched: `question:aux:${first.word}`, position: first.index, rank: 2 });
    }
    const directives = options.directives || DEFAULT_DIRECTIVES;
    if (directives.includes(first.word)) {
      candidates.push({ act: 'directive', matched: `directive:${first.word}`, position: first.index, rank: 3 });
    }
  }

  if (candidates.length > 0) {
    let winner = candidates[0];
    for (const candidate of candidates.slice(1)) {
      if (candidate.position < winner.position
        || (candidate.position === winner.position && candidate.rank < winner.rank)) {
        winner = candidate;
      }
    }
    return { act: winner.act, matched: winner.matched };
  }

  // Fallbacks, only when no family matched: terminal '?' -> question, else statement.
  if (TERMINAL_QUESTION_RE.test(trimmed)) {
    return { act: 'question', matched: 'question:terminal:?' };
  }
  return { act: 'statement', matched: null };
}

function resolveLang(lang) {
  return typeof lang === 'string' && lang.length > 0 ? lang : 'en';
}

function normalizeApostrophes(text) {
  return text.replace(/[’‘]/g, "'");
}

/**
 * First run of Latin letters, lowercased, WITH its offset in the string —
 * the "sentence-initial word" (and its position, for the earliest-match
 * comparison against anywhere-matched hedge/request markers) for the
 * wh/aux/directive checks. `null` when the sentence has no Latin letters.
 */
function firstWordToken(lowerText) {
  const match = lowerText.match(/^[^a-z]*([a-z]+)/);
  return match ? { word: match[1], index: match[0].length - match[1].length } : null;
}

/**
 * The marker (from `markers`) whose earliest occurrence in `lowerText` comes
 * FIRST, with that occurrence's index — `{ marker, index }`, or `null` when
 * none match. List order breaks exact-position ties, so the audit trail is
 * deterministic.
 */
function findEarliestMarker(lowerText, markers) {
  let best = null;
  for (const marker of markers) {
    const match = markerRegex(marker).exec(lowerText);
    if (match && (best === null || match.index < best.index)) {
      best = { marker, index: match.index };
    }
  }
  return best;
}

function markerRegex(marker) {
  let re = markerRegexCache.get(marker);
  if (!re) {
    const escaped = marker.split(/\s+/).map(escapeRegex).join('\\s+');
    re = new RegExp(`\\b${escaped}\\b`, 'i');
    markerRegexCache.set(marker, re);
  }
  return re;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// text-v1 metrics
// ---------------------------------------------------------------------------

/**
 * Compute the `text-v1` metrics block from already-classified sentences and
 * already-extracted word tokens. Pure aggregation — no splitting/classifying
 * of its own — so `DiscourseAggregator` can call this once per `finalize()`
 * over ACCUMULATED sentences/words spanning multiple `analyze()` calls,
 * while `analyzeText` (below) calls it once per single text. Keeping the
 * ratio/count formulas in exactly one place avoids the two call sites
 * drifting apart.
 *
 * `sentenceActs` is an array of `{ act, matched }` (as returned by
 * `classifySentence`); `words` is a flat array of word token strings (as
 * returned by `extractWords`); `paragraphCount` and `lang` are scalars.
 */
export function computeTextMetrics({ sentenceActs = [], words = [], paragraphCount = 0, lang = 'en' } = {}) {
  const sentenceCount = sentenceActs.length;
  const wordCount = words.length;
  const wordLengths = words.map((word) => [...word].length);

  const meanWordsPerSentence = sentenceCount > 0 ? wordCount / sentenceCount : 0;
  const meanWordLength = wordCount > 0 ? mean(wordLengths) : 0;
  const uniqueTypes = new Set(words.map((word) => word.toLowerCase()));
  const typeTokenRatio = wordCount > 0 ? uniqueTypes.size / wordCount : 0;
  const longWordCount = wordLengths.filter((length) => length > 6).length;
  const longWordRatio = wordCount > 0 ? longWordCount / wordCount : 0;

  let questionCount = 0;
  let directiveCount = 0;
  let requestCount = 0;
  let statementCount = 0;
  let thinkingCount = 0;
  let deepQuestionCount = 0;
  let shallowQuestionCount = 0;
  let polarQuestionCount = 0;

  for (const { act, matched } of sentenceActs) {
    switch (act) {
      case 'question': {
        questionCount += 1;
        if (typeof matched === 'string' && matched.startsWith('question:wh:')) {
          const word = matched.slice('question:wh:'.length);
          if (DEEP_WH_WORDS.has(word)) deepQuestionCount += 1;
          else shallowQuestionCount += 1;
        } else if (typeof matched === 'string' && matched.startsWith('question:aux:')) {
          polarQuestionCount += 1;
        }
        break;
      }
      case 'directive': directiveCount += 1; break;
      case 'request': requestCount += 1; break;
      case 'thinking': thinkingCount += 1; break;
      case 'statement':
      default: statementCount += 1; break;
    }
  }

  const questionRatio = sentenceCount > 0 ? questionCount / sentenceCount : 0;
  // null (not 0) when there are no questions — "never asked" must stay
  // distinguishable from "asked only shallow questions" (deep ratio 0).
  const deepQuestionRatio = questionCount > 0 ? deepQuestionCount / questionCount : null;

  return {
    word_count: wordCount,
    sentence_count: sentenceCount,
    paragraph_count: paragraphCount,
    mean_words_per_sentence: meanWordsPerSentence,
    mean_word_length: meanWordLength,
    type_token_ratio: typeTokenRatio,
    long_word_ratio: longWordRatio,
    question_count: questionCount,
    directive_count: directiveCount,
    request_count: requestCount,
    statement_count: statementCount,
    thinking_count: thinkingCount,
    deep_question_count: deepQuestionCount,
    shallow_question_count: shallowQuestionCount,
    polar_question_count: polarQuestionCount,
    question_ratio: questionRatio,
    deep_question_ratio: deepQuestionRatio,
    speech_act_lang: resolveLang(lang),
  };
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

// ---------------------------------------------------------------------------
// analyzeText — the single-call convenience entry point
// ---------------------------------------------------------------------------

/**
 * Split `text` into sentences, classify each one, and compute the `text-v1`
 * metrics block over the whole text in one call. Returns `{ metrics,
 * sentences }` where `sentences` is an ordered array of `{ index, act,
 * wordCount, charCount }` — deliberately WITHOUT the sentence text itself or
 * `matched` (that level of detail is available from `classifySentence`
 * directly; `DiscourseAggregator`'s per-event `detail.matched` is populated
 * by calling `classifySentence` itself, not by unpacking this return value).
 *
 * `charCount` is a Unicode CODE-POINT count (`[...sentence].length`), not a
 * full grapheme-cluster count — a deliberate simplification to avoid a third
 * `Intl.Segmenter` pass (sentence + word are already used); see
 * docs/DISCOURSE.md "Known limitations".
 */
export function analyzeText(text, options = {}) {
  const lang = resolveLang(options.lang);
  const effectiveOptions = { ...options, lang };

  const rawSentences = splitSentences(text, effectiveOptions);
  const sentenceActs = [];
  const words = [];

  const sentences = rawSentences.map((sentenceText, index) => {
    const { act, matched } = classifySentence(sentenceText, effectiveOptions);
    sentenceActs.push({ act, matched });
    const tokens = extractWords(sentenceText, effectiveOptions);
    words.push(...tokens);
    return {
      index,
      act,
      wordCount: tokens.length,
      charCount: [...sentenceText].length,
    };
  });

  const paragraphCount = countParagraphs(text);
  const metrics = computeTextMetrics({ sentenceActs, words, paragraphCount, lang });

  return { metrics, sentences };
}
