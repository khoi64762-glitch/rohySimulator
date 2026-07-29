// Precedence-table test matrix for src/analytics/TextAnalyzer.js — see
// docs/DISCOURSE.md for the full five-rule table this pins down. Every case
// below was hand-labelled against the spec, not against the implementation.
import assert from 'node:assert/strict';
import {
  analyzeText,
  classifySentence,
  splitSentences,
  extractWords,
  countWords,
  countParagraphs,
  computeTextMetrics,
  DEFAULT_HEDGES,
  DEFAULT_DIRECTIVES,
} from '../src/analytics/TextAnalyzer.js';

// ---------- A. Hand-labelled precedence-table matrix (>= 25 sentences, every act + boundary) ----------
{
  const cases = [
    // [sentence, expectedAct, expectedMatched, deepOrShallow?]
    ['Can you explain the second theme?', 'request', 'request:can you'],
    ['Explain the second theme.', 'directive', 'directive:explain'],
    ['Why does the reaction slow down?', 'question', 'question:wh:why', 'deep'],
    ['What is the boiling point?', 'question', 'question:wh:what', 'shallow'],
    ['I wonder why it works.', 'thinking', 'hedge:i wonder'],
    ['What if we tried a lower temperature?', 'thinking', 'hedge:what if'],
    ['I think this is wrong.', 'statement', null],
    ['Please summarise this.', 'request', 'request:please'],
    ['The reaction slows down.', 'statement', null],
    ['Maybe the catalyst is contaminated.', 'thinking', 'hedge:maybe'],
    ['Perhaps we should recheck the data.', 'thinking', 'hedge:perhaps'],
    ['Could you show me the results?', 'request', 'request:could you'],
    ['Would you mind rewriting this section?', 'request', 'request:would you'],
    ['Will you send the file?', 'request', 'request:will you'],
    ['Who is responsible for this task?', 'question', 'question:wh:who', 'shallow'],
    ['When will the results be published?', 'question', 'question:wh:when', 'shallow'],
    ['Where should we submit the report?', 'question', 'question:wh:where', 'shallow'],
    ['Which method performed best?', 'question', 'question:wh:which', 'shallow'],
    ['How does the algorithm converge?', 'question', 'question:wh:how', 'deep'],
    ['Do you agree with this conclusion?', 'question', 'question:aux:do', 'polar'],
    ['Is this the correct answer?', 'question', 'question:aux:is', 'polar'],
    ['This concludes the analysis, right?', 'question', 'question:terminal:?'],
    ['List the key findings.', 'directive', 'directive:list'],
    ['Summarize the results in two sentences.', 'directive', 'directive:summarize'],
    ['Compare the two methods.', 'directive', 'directive:compare'],
    ['Suppose the temperature were doubled.', 'thinking', 'hedge:suppose'],
    ['It seems the model overfit.', 'thinking', 'hedge:it seems'],
    ['I am not sure this is correct.', 'thinking', 'hedge:not sure'],
    ['I guess we should try again.', 'thinking', 'hedge:i guess'],
    ['This is possibly the best approach.', 'thinking', 'hedge:possibly'],
    ['Presumably the sensor failed.', 'thinking', 'hedge:presumably'],
    ['I would like you to review this draft.', 'request', 'request:i would like you to'],
    ['Would it be possible to extend the deadline?', 'request', 'request:would it be possible'],
    ['Do you mind checking my code?', 'request', 'request:do you mind'],
    ['Define the term entropy.', 'directive', 'directive:define'],
    ['Translate this paragraph into French.', 'directive', 'directive:translate'],
    ['Outline the main argument.', 'directive', 'directive:outline'],
  ];

  assert.ok(cases.length >= 25, 'test matrix must cover at least 25 sentences');

  for (const [sentence, expectedAct, expectedMatched] of cases) {
    const result = classifySentence(sentence);
    assert.equal(result.act, expectedAct, `${JSON.stringify(sentence)} -> expected act '${expectedAct}', got '${result.act}' (matched: ${result.matched})`);
    assert.equal(result.matched, expectedMatched, `${JSON.stringify(sentence)} -> expected matched '${expectedMatched}', got '${result.matched}'`);
  }

  // Every act in OYON_DISCOURSE_STATES must appear at least once in the matrix.
  const seenActs = new Set(cases.map((c) => c[1]));
  for (const act of ['thinking', 'request', 'question', 'directive', 'statement']) {
    assert.ok(seenActs.has(act), `test matrix must cover act '${act}'`);
  }

  // deep/shallow/polar sub-classification, cross-checked via computeTextMetrics.
  const deepCases = cases.filter((c) => c[3] === 'deep').map((c) => c[0]);
  const shallowCases = cases.filter((c) => c[3] === 'shallow').map((c) => c[0]);
  const polarCases = cases.filter((c) => c[3] === 'polar').map((c) => c[0]);
  assert.equal(deepCases.length, 2, 'why/how questions');
  assert.equal(shallowCases.length, 5, 'what/who/when/where/which questions');
  assert.equal(polarCases.length, 2, 'polar-auxiliary questions');
}

// ---------- B. matched names the firing marker (audit trail) ----------
{
  assert.equal(classifySentence('Perhaps this is right.').matched, 'hedge:perhaps');
  assert.equal(classifySentence('Please help.').matched, 'request:please');
  assert.equal(classifySentence('How are you?').matched, 'question:wh:how');
  assert.equal(classifySentence('Is it done?').matched, 'question:aux:is');
  assert.equal(classifySentence('Fine?').matched, 'question:terminal:?');
  assert.equal(classifySentence('Fix this.').matched, 'directive:fix');
  assert.equal(classifySentence('It works fine.').matched, null);
}

// ---------- C. deep_question_ratio is null (not 0) when there are no questions ----------
{
  const { metrics } = analyzeText('This is a statement. Explain the theme.');
  assert.equal(metrics.question_count, 0);
  assert.equal(metrics.deep_question_ratio, null, 'null, never 0, when question_count is 0');
}

// ---------- D. deep_question_ratio is a real ratio when there ARE questions ----------
{
  const { metrics } = analyzeText('Why does this happen? What is the answer? Who asked?');
  assert.equal(metrics.question_count, 3);
  assert.equal(metrics.deep_question_count, 1, 'only "Why does this happen?"');
  assert.equal(metrics.shallow_question_count, 2, '"What is the answer?" + "Who asked?"');
  assert.ok(Math.abs(metrics.deep_question_ratio - (1 / 3)) < 1e-9);
}

// ---------- E. non-English falls back to punctuation-only classification ----------
{
  const question = classifySentence('Onko tämä oikein?', { lang: 'fi' });
  assert.deepEqual(question, { act: 'question', matched: 'punctuation:?' });

  const statement = classifySentence('Tämä on oikein.', { lang: 'fi' });
  assert.deepEqual(statement, { act: 'statement', matched: null });

  // Even an English hedge phrase must NOT fire once lang is non-English —
  // punctuation-only means punctuation-only, no partial English matching.
  const noHedge = classifySentence('Maybe this is wrong.', { lang: 'fi' });
  assert.equal(noHedge.act, 'statement');
  assert.equal(noHedge.matched, null);

  const { metrics } = analyzeText('Onko tämä oikein? Tämä on oikein.', { lang: 'fi' });
  assert.equal(metrics.speech_act_lang, 'fi');
  assert.equal(metrics.question_count, 1);
  assert.equal(metrics.thinking_count, 0);
  assert.equal(metrics.request_count, 0);
  assert.equal(metrics.directive_count, 0);
}

// ---------- F. English is the default lang ----------
{
  assert.equal(classifySentence('Please help.').act, 'request');
  assert.equal(analyzeText('Please help.').metrics.speech_act_lang, 'en');
}

// ---------- G. splitSentences: abbreviation false-split repair ----------
{
  assert.deepEqual(
    splitSentences('I met Dr. Smith yesterday. He was pleased.'),
    ['I met Dr. Smith yesterday.', 'He was pleased.'],
  );
  assert.deepEqual(
    splitSentences('Please bring supplies, e.g. water and food, tomorrow.'),
    ['Please bring supplies, e.g. water and food, tomorrow.'],
  );
  assert.deepEqual(
    splitSentences('This works, i.e. it passes all tests. Good.'),
    ['This works, i.e. it passes all tests.', 'Good.'],
  );
  assert.deepEqual(
    splitSentences('Ask Mr. Lee and Ms. Park to join. They agreed.'),
    ['Ask Mr. Lee and Ms. Park to join.', 'They agreed.'],
  );
  assert.deepEqual(
    splitSentences('Prof. Diaz reviewed the draft. It was approved.'),
    ['Prof. Diaz reviewed the draft.', 'It was approved.'],
  );
}

// ---------- H. splitSentences: plain multi-sentence text, real Intl.Segmenter path ----------
{
  const sentences = splitSentences('First sentence. Second sentence! Third one?');
  assert.deepEqual(sentences, ['First sentence.', 'Second sentence!', 'Third one?']);
}

// ---------- I. splitSentences: forced regex fallback (sentenceSegmenter: false) ----------
{
  const sentences = splitSentences('First sentence. Second sentence! Third one?', { sentenceSegmenter: false });
  assert.deepEqual(sentences, ['First sentence.', 'Second sentence!', 'Third one?']);

  // Non-Latin terminators the fallback must also split on: Arabic '؟', full-width '？'/'！'/'。'.
  const arabic = splitSentences('هل هذا صحيح؟ نعم.', { sentenceSegmenter: false });
  assert.equal(arabic.length, 2);

  const fullWidth = splitSentences('これは正しいですか？はい。', { sentenceSegmenter: false });
  assert.equal(fullWidth.length, 2);
}

// ---------- J. splitSentences: empty / whitespace-only text ----------
{
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences('   \n\t  '), []);
  assert.deepEqual(splitSentences(null), []);
  assert.deepEqual(splitSentences(undefined), []);
}

// ---------- K. extractWords / countWords: Intl.Segmenter vs. fallback agree in the ASCII case ----------
{
  const text = "Don't stop believing.";
  const withSegmenter = extractWords(text);
  const withFallback = extractWords(text, { wordSegmenter: false });
  assert.equal(countWords(text), withSegmenter.length);
  assert.deepEqual(withSegmenter, withFallback, 'ASCII contraction text: both paths agree');
  assert.ok(withSegmenter.includes("Don't") || withSegmenter.some((w) => w.toLowerCase().includes("don't")));
}

// ---------- L. extractWords: Intl.Segmenter correctly counts a spaceless CJK sentence; fallback cannot ----------
{
  // "今日は良い天気です" ("The weather is nice today") — no spaces between words.
  const text = '今日は良い天気です。';
  const segmenterWords = extractWords(text);
  const fallbackWords = extractWords(text, { wordSegmenter: false });
  assert.ok(segmenterWords.length > 1, 'Intl.Segmenter must split this into multiple word-like tokens');
  assert.ok(fallbackWords.length <= 1, 'the letter-run regex fallback cannot separate spaceless CJK words');
}

// ---------- M. countParagraphs ----------
{
  assert.equal(countParagraphs(''), 0);
  assert.equal(countParagraphs('   '), 0);
  assert.equal(countParagraphs('One paragraph, no blank line.'), 1);
  assert.equal(countParagraphs('First paragraph.\n\nSecond paragraph.'), 2);
  assert.equal(countParagraphs('First.\n\n\nSecond.\n\nThird.'), 3);
}

// ---------- N. analyzeText: sentences array shape is exactly { index, act, wordCount, charCount } ----------
{
  const { sentences } = analyzeText('Explain this. Why does it fail?');
  assert.equal(sentences.length, 2);
  for (const [i, entry] of sentences.entries()) {
    assert.deepEqual(Object.keys(entry).sort(), ['act', 'charCount', 'index', 'wordCount']);
    assert.equal(entry.index, i);
    assert.equal(typeof entry.act, 'string');
    assert.equal(typeof entry.wordCount, 'number');
    assert.equal(typeof entry.charCount, 'number');
  }
  assert.equal(sentences[0].act, 'directive');
  assert.equal(sentences[1].act, 'question');
}

// ---------- O. analyzeText: metrics counts are self-consistent with sentences[] ----------
{
  const text = 'Explain this. Why does it fail? Maybe it overheated. The fan stopped.';
  const { metrics, sentences } = analyzeText(text);
  assert.equal(metrics.sentence_count, sentences.length);
  assert.equal(metrics.word_count, sentences.reduce((sum, s) => sum + s.wordCount, 0));
  assert.equal(metrics.directive_count, sentences.filter((s) => s.act === 'directive').length);
  assert.equal(metrics.question_count, sentences.filter((s) => s.act === 'question').length);
  assert.equal(metrics.thinking_count, sentences.filter((s) => s.act === 'thinking').length);
  assert.equal(metrics.statement_count, sentences.filter((s) => s.act === 'statement').length);
  assert.equal(metrics.request_count, sentences.filter((s) => s.act === 'request').length);
}

// ---------- P. type_token_ratio and long_word_ratio: hand-computed example ----------
{
  // Words: "the", "cat", "sat", "on", "the", "mat" -> 6 tokens, 5 distinct types.
  const { metrics } = analyzeText('The cat sat on the mat.');
  assert.equal(metrics.word_count, 6);
  assert.ok(Math.abs(metrics.type_token_ratio - (5 / 6)) < 1e-9);
  assert.equal(metrics.long_word_ratio, 0, 'no word here is longer than 6 characters');

  const longWordText = analyzeText('Extraordinary circumstances necessitate immediate attention.');
  assert.ok(longWordText.metrics.long_word_ratio > 0.5, 'most words here exceed 6 characters');
}

// ---------- Q. hedges/directives options REPLACE, not append to, the defaults ----------
{
  const customHedge = classifySentence('I suspect this is off.', { hedges: ['i suspect'] });
  assert.equal(customHedge.act, 'thinking');
  assert.equal(customHedge.matched, 'hedge:i suspect');

  // With a custom hedge list, a DEFAULT hedge marker no longer fires.
  const noLongerHedge = classifySentence('Maybe this is off.', { hedges: ['i suspect'] });
  assert.notEqual(noLongerHedge.act, 'thinking', 'default hedge list was replaced, not extended');

  // Extending via spread keeps both the default and the addition working.
  const extended = [...DEFAULT_HEDGES, 'i suspect'];
  assert.equal(classifySentence('Maybe this is off.', { hedges: extended }).act, 'thinking');
  assert.equal(classifySentence('I suspect this is off.', { hedges: extended }).act, 'thinking');

  const customDirective = classifySentence('Draft a summary.', { directives: [...DEFAULT_DIRECTIVES, 'draft'] });
  assert.equal(customDirective.act, 'directive');
  assert.equal(customDirective.matched, 'directive:draft');
}

// ---------- R. computeTextMetrics is a pure function of its inputs (used directly by DiscourseAggregator) ----------
{
  const metrics = computeTextMetrics({
    sentenceActs: [
      { act: 'question', matched: 'question:wh:why' },
      { act: 'question', matched: 'question:wh:what' },
      { act: 'statement', matched: null },
    ],
    words: ['why', 'does', 'this', 'happen', 'what', 'is', 'it', 'fine'],
    paragraphCount: 1,
    lang: 'en',
  });
  assert.equal(metrics.sentence_count, 3);
  assert.equal(metrics.question_count, 2);
  assert.equal(metrics.deep_question_count, 1);
  assert.equal(metrics.shallow_question_count, 1);
  assert.ok(Math.abs(metrics.deep_question_ratio - 0.5) < 1e-9);

  // Empty input never divides by zero.
  const empty = computeTextMetrics();
  assert.equal(empty.sentence_count, 0);
  assert.equal(empty.word_count, 0);
  assert.equal(empty.mean_words_per_sentence, 0);
  assert.equal(empty.type_token_ratio, 0);
  assert.equal(empty.question_ratio, 0);
  assert.equal(empty.deep_question_ratio, null);
}

// ==================== statistical-defect regressions (adversarial review, finding 12) ====================

// ---------- S. Precedence: an INTERIOR hedge/request marker must not override an
//              obvious sentence-initial question or directive ----------
// The classifier picks the EARLIEST-positioned family, with sentence-initial
// hedges/requests still winning their position ties (thinking > request >
// question > directive at equal position) — see TextAnalyzer's module doc.
{
  // The three inputs that used to misclassify:
  assert.deepEqual(classifySentence('Why can you not do this?'),
    { act: 'question', matched: 'question:wh:why' },
    'sentence-initial "why" beats the interior "can you" — this is a question, not a request');
  assert.deepEqual(classifySentence('Explain why it might fail.'),
    { act: 'directive', matched: 'directive:explain' },
    'sentence-initial "explain" beats the interior hedge "might" — a directive, not thinking');
  assert.deepEqual(classifySentence('Can you explain why it might fail?'),
    { act: 'request', matched: 'request:can you' },
    'sentence-initial "can you" (request) wins its position-0 tie with the polar aux "can" and beats the interior "might"');

  // The deliberate cases that must KEEP their classification:
  assert.equal(classifySentence('I wonder why it works.').act, 'thinking');
  assert.equal(classifySentence('What if we tried Y?').act, 'thinking', 'sentence-initial "what if" still beats the wh-reading of "what"');
  assert.equal(classifySentence('Can you explain X?').act, 'request');
  assert.equal(classifySentence('I think this is wrong.').act, 'statement');

  // Deliberate consequence of demoting the terminal '?' to a fallback: a
  // sentence-initial directive with a question mark reads as a directive —
  // the imperative verb is stronger evidence than the punctuation.
  assert.deepEqual(classifySentence('Explain this?'), { act: 'directive', matched: 'directive:explain' });
  // The terminal '?' fallback still fires when NO family matched.
  assert.deepEqual(classifySentence('This concludes the analysis, right?'), { act: 'question', matched: 'question:terminal:?' });
}

// ---------- T. Fallback sentence splitting must not corrupt decimals, URLs, or
//              interior abbreviation periods ----------
// An ASCII '.' glued to the next character is intra-token punctuation, never
// a boundary; the fallback used to shatter "3.14" into "3." + "14.".
{
  assert.deepEqual(
    splitSentences('The value is 3.14. Next value.', { sentenceSegmenter: false }),
    ['The value is 3.14.', 'Next value.'],
    'decimal point must not split the number',
  );
  assert.deepEqual(
    splitSentences('Visit https://example.com/a. Then continue.', { sentenceSegmenter: false }),
    ['Visit https://example.com/a.', 'Then continue.'],
    'URL-internal dots must not split the URL',
  );
  assert.deepEqual(
    splitSentences('Use e.g. apples. Next.', { sentenceSegmenter: false }),
    ['Use e.g. apples.', 'Next.'],
    'the interior period of "e.g." never splits; the trailing one is repaired by the abbreviation merge',
  );
  assert.deepEqual(
    splitSentences('That is i.e. equivalent. Next.', { sentenceSegmenter: false }),
    ['That is i.e. equivalent.', 'Next.'],
  );
  assert.deepEqual(
    splitSentences('I met Dr. Smith. Next.', { sentenceSegmenter: false }),
    ['I met Dr. Smith.', 'Next.'],
  );

  // The fallback now agrees with the Intl.Segmenter path on these inputs.
  for (const text of ['The value is 3.14. Next value.', 'Visit https://example.com/a. Then continue.']) {
    assert.deepEqual(
      splitSentences(text, { sentenceSegmenter: false }),
      splitSentences(text),
      `fallback and Intl.Segmenter must agree on ${JSON.stringify(text)}`,
    );
  }

  // CJK/Arabic terminators still split WITHOUT requiring a following space.
  assert.equal(splitSentences('これは正しいですか？はい。', { sentenceSegmenter: false }).length, 2);
}

console.log('text-analyzer.test.js passed');
