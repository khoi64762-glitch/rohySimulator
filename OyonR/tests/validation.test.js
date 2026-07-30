import assert from 'node:assert/strict';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';
import { OYON_WINDOW_BATCH_SCHEMA_VERSION } from '../src/version.js';

const validEvent = {
  session_id: 1,
  user_id: 2,
  case_id: 3,
  tenant_id: 1,
  window_start: '2026-05-07T19:00:00.000Z',
  window_end: '2026-05-07T19:00:10.000Z',
  dominant_emotion: 'neutral',
  probabilities: {
    neutral: 0.5,
    happy: 0.1,
    sad: 0.1,
    surprise: 0.1,
    anger: 0.1,
    fear: 0.05,
    disgust: 0.05,
  },
  valence: null,
  arousal: null,
  confidence: 0.5,
  entropy: 2,
  valid_frames: 10,
  missing_face_ratio: 0.1,
  quality: { meanFaceAreaRatio: 0.2 },
  model_name: 'test-model',
  model_version: '1',
  capture_mode: 'local-browser',
  consent_version: 'fer-consent-v1',
};

{
  const result = validateEmotionBatch({ events: [validEvent] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.schemaVersion, null, 'unversioned v2/Rohy payloads remain valid');
}

{
  const result = validateEmotionBatch({
    schema_version: OYON_WINDOW_BATCH_SCHEMA_VERSION,
    events: [validEvent],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.schemaVersion, OYON_WINDOW_BATCH_SCHEMA_VERSION);
}

{
  const result = validateEmotionBatch({
    schema_version: 'oyon-window-batch-v99',
    events: [validEvent],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('schema_version')));
}

{
  const result = validateEmotionBatch({ events: [{ ...validEvent, image: 'base64' }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('image is forbidden')));
}

{
  const result = validateEmotionBatch({ events: [{ ...validEvent, dominant_emotion: 'confused' }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('dominant_emotion')));
}

{
  const result = validateEmotionBatch({ events: [{ ...validEvent, probabilities: { neutral: 2 } }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('probabilities.neutral')));
}

{
  const result = validateEmotionBatch({ events: [{ ...validEvent, confidence: 1.2 }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('confidence')));
}

// Engagement block — well-formed engagement passes.
{
  const engagementEvent = {
    ...validEvent,
    engagement: {
      blink_count: 2,
      blink_rate_hz: 0.32,
      eye_openness_mean: 0.81,
      eye_openness_std: 0.07,
      gaze_entropy: 0.42,
      gaze_zone_proportions: {
        center: 0.71, left: 0.08, right: 0.05, up: 0.04, down: 0.12,
      },
      valid_frame_ratio: 0.94,
      valid_frames: 18,
      total_frames: 19,
      duration_ms: 10000,
      expected_samples: 11,
      focus_score: 0.68,
      focus_score_components: { blink: 0.9, openness: 0.81, gaze_stability: 0.58 },
      window_start: '2026-05-07T19:00:00.000Z',
      window_end: '2026-05-07T19:00:10.000Z',
      model_version: 'mediapipe-blendshapes-v1',
    },
  };
  const result = validateEmotionBatch({ events: [engagementEvent] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// engagement = null is allowed (back-compat / optional block).
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, engagement: null }] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// Window with no `engagement` field still passes (the base validEvent test does this,
// but assert again to lock the contract).
{
  const { ...withoutEngagement } = validEvent;
  delete withoutEngagement.engagement;
  const result = validateEmotionBatch({ events: [withoutEngagement] });
  assert.equal(result.ok, true);
}

// iris_landmarks_raw at top level → rejected.
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, iris_landmarks_raw: [1, 2, 3] }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('iris_landmarks_raw')));
}

// gaze_points_raw at top level → rejected.
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, gaze_points_raw: [] }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('gaze_points_raw')));
}

// pupil_diameter_px → rejected.
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, pupil_diameter_px: 3.2 }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('pupil_diameter_px')));
}

// eye_image_left → rejected.
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, eye_image_left: 'b64' }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('eye_image_left')));
}

// eye_image_strip → rejected (prefix rule).
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, eye_image_strip: 'b64' }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('eye_image_strip')));
}

// Raw-media keys cannot be hidden inside arbitrary extension objects.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, quality: { diagnostics: { image: 'base64' } } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('quality.diagnostics.image')));
}

// The recursive privacy check traverses arrays as well as objects.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, quality: { samples: [{ landmarks: [{ x: 1 }] }] } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('quality.samples[0].landmarks')));
}

// Eye-image prefixes are rejected at any nesting depth.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, quality: { diagnostics: { eye_image_debug: 'base64' } } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('quality.diagnostics.eye_image_debug')));
}

// Benign nested quality extensions retain their existing valid behaviour.
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      quality: { diagnostics: { thresholds: [0.1, 0.2], points: 2, label: 'stable' } },
    }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// engagement.focus_score out of range.
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      engagement: { focus_score: 1.5 },
    }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('engagement.focus_score')));
}

// engagement.gaze_zone_proportions with an unsupported zone.
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      engagement: { gaze_zone_proportions: { invalid_zone: 0.5, center: 0.5 } },
    }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('invalid_zone')));
}

// engagement.landmarks nested forbidden.
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      engagement: { landmarks: [{ x: 1 }] },
    }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('engagement.landmarks')));
}

// engagement.eye_image_strip nested forbidden (prefix inside engagement).
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      engagement: { eye_image_strip: 'b64' },
    }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('engagement.eye_image_strip')));
}

// ─── Gaze block (Stage 4) ──────────────────────────────────────────────

// Well-formed gaze block passes.
{
  const gazeEvent = {
    ...validEvent,
    gaze: {
      n_points: 287,
      total_frames: 300,
      centroid: { x: 0.05, y: -0.04 },
      dispersion: 0.12,
      zone_proportions: {
        top_left:    0.02, top_center:    0.05, top_right:    0.01,
        middle_left: 0.04, middle_center: 0.71, middle_right: 0.04,
        bottom_left: 0.03, bottom_center: 0.08, bottom_right: 0.02,
      },
      aoi_dwell_ms: { stimulus_chart: 4200, stimulus_text: 3100 },
      aoi_entries: { stimulus_chart: 2, stimulus_text: 1 },
      aoi_revisits: { stimulus_chart: 1, stimulus_text: 0 },
      aoi_time_to_first_ms: { stimulus_chart: 120, stimulus_text: 4400 },
      aoi_transitions: { 'stimulus_chart→stimulus_text': 1 },
      aoi_transition_count: 1,
      aoi_transition_entropy: 0,
      fixation_count: 4,
      fixation_duration_ms_total: 7100,
      fixation_duration_ms_mean: 1775,
      fixation_duration_ms_median: 1600,
      fixation_duration_ms_max: 2600,
      scanpath_length: 0.84,
      fixation_sampling_adequate: true,
      fixation_algorithm: 'idt-coarse-v1',
      fixation_min_duration_ms: 150,
      fixation_dispersion_threshold: 0.08,
      observed_sample_interval_ms: 33.3,
      observed_sample_rate_hz: 30.03,
      max_observed_sample_gap_ms: 61,
      timing_source: 'timestamps',
      off_screen_episode_count: 1,
      calibration_age_ms: 142000,
      calibration_quality: 0.78,
      valid_frame_ratio: 0.94,
      off_screen_ratio: 0.03,
      duration_ms: 10000,
      window_start: '2026-05-07T19:00:00.000Z',
      window_end: '2026-05-07T19:00:10.000Z',
      model_version: 'webeyetrack-0.0.2',
    },
  };
  const result = validateEmotionBatch({ events: [gazeEvent] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// Privacy-safe camera capability/timing block passes.
{
  const summary = {
    frames_observed: 298,
    estimated_dropped_frames: 2,
    drop_ratio: 0.0067,
    observed_fps: 29.9,
    frame_interval_ms_mean: 33.4,
    frame_interval_ms_std: 1.2,
    max_frame_gap_ms: 50,
    span_ms: 9960,
  };
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      capture_quality: {
        available: true,
        settings: { width: 1280, height: 720, frame_rate: 30 },
        constraints: { facing_mode: 'user' },
        capabilities: { frame_rate: { min: 5, max: 60 } },
        timing: {
          source: 'requestVideoFrameCallback',
          window: summary,
          lifetime: summary,
        },
      },
    }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// Camera identity is forbidden even when nested in an otherwise valid block.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, capture_quality: { settings: { device_id: 'secret' } } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('device_id is forbidden')));
}

// gaze = null is allowed (optional block).
{
  const result = validateEmotionBatch({ events: [{ ...validEvent, gaze: null }] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// gaze.zone_proportions with all-indexed (r<n>c<n>) keys passes — 5x5 mode.
{
  const zp = {};
  for (let r = 0; r < 5; r += 1) for (let c = 0; c < 5; c += 1) zp[`r${r}c${c}`] = 1 / 25;
  const result = validateEmotionBatch({ events: [{ ...validEvent, gaze: { zone_proportions: zp } }] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// Mixed 3x3 + indexed zone keys → rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { zone_proportions: { top_left: 0.5, r0c1: 0.5 } } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('zone_proportions keys must all')));
}

// Raw points field forbidden (top-level deny — `gaze_points_raw`).
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze_points_raw: [[0.1, 0.2], [0.3, 0.4]] }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('gaze_points_raw is forbidden')));
}

// Raw points inside gaze block → forbidden by FORBIDDEN_GAZE_FIELDS.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { gaze_points_raw: [[0, 0]] } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('gaze.gaze_points_raw is forbidden')));
}

// gaze_raw / gaze_trace inside gaze → forbidden.
{
  for (const key of ['gaze_raw', 'gaze_trace', 'points', 'points_raw']) {
    const result = validateEmotionBatch({
      events: [{ ...validEvent, gaze: { [key]: [1] } }],
    });
    assert.equal(result.ok, false, `key ${key} should be forbidden`);
    assert.ok(result.errors.some(e => e.includes(`gaze.${key}`)),
      `expected gaze.${key} error, got ${JSON.stringify(result.errors)}`);
  }
}

// Naming-convention deny: keys ending in _array / _trace / _raw inside gaze.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { custom_array: [1, 2, 3] } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('gaze.custom_array')));
}

// Oversized array inside gaze → forbidden by length cap.
{
  const big = new Array(101).fill(0);
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { sample_log: big } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('exceeds 100')));
}

// gaze.centroid out of range → rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { centroid: { x: 5, y: 0 } } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('gaze.centroid.x')));
}

// gaze.aoi_dwell_ms with negative value → rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { aoi_dwell_ms: { stim_a: -10 } } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('aoi_dwell_ms.stim_a')));
}

// gaze.valid_frame_ratio out of [0,1] → rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, gaze: { valid_frame_ratio: 1.4 } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('valid_frame_ratio')));
}

// Modality-scoped windows carry no emotion classification. Every `*_only` flag
// the runtime emits must exempt the emotion scalars — previously only
// `engagement_only` did, so posture/facial/gaze/heart-rate windows were
// rejected by HttpEmotionTransport.
{
  const window_start = '2026-05-07T19:00:00.000Z';
  const window_end = '2026-05-07T19:00:10.000Z';
  const modalityWindows = [
    { engagement_only: true, engagement: { blink_count: 3 } },
    { facial_only: true, facial: { yaw_deg: 4 } },
    { gaze_only: true, gaze: { n_points: 40 } },
    { heart_rate_only: true, heart_rate: { bpm: 68 } },
    { posture_only: true, posture: { slouch_ratio: 0.2 } },
  ];

  for (const block of modalityWindows) {
    const flag = Object.keys(block).find(key => key.endsWith('_only'));
    const result = validateEmotionBatch({
      schema_version: OYON_WINDOW_BATCH_SCHEMA_VERSION,
      events: [{ ...block, window_start, window_end }],
    });
    assert.equal(result.ok, true, `${flag} window rejected: ${result.errors.join('; ')}`);
  }
}

// The exemption is scoped: a modality window that DOES carry emotion scalars
// still has them range-checked.
{
  const result = validateEmotionBatch({
    events: [{
      posture_only: true,
      posture: { slouch_ratio: 0.2 },
      confidence: 1.7,
      window_start: '2026-05-07T19:00:00.000Z',
      window_end: '2026-05-07T19:00:10.000Z',
    }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('confidence')));
}

// An ordinary emotion window still requires them.
{
  const { confidence, ...withoutConfidence } = validEvent;
  const result = validateEmotionBatch({ events: [withoutConfidence] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('confidence')));
}

// ─── Typing block (typing-v3) ──────────────────────────────────────────

// A well-formed typing-v3 block — every field this version adds — passes.
{
  const typingEvent = {
    ...validEvent,
    modality: 'typing',
    window_kind: 'episode',
    feature_profile: 'typing-v3',
    typing: {
      elapsed_ms: 6100,
      active_input_ms: 500,
      first_input_latency_ms: 0,
      committed_graphemes: 8,
      inserted_graphemes: 11,
      deleted_graphemes: 3,
      replacement_graphemes: 0,
      pasted_graphemes: 0,
      edit_event_count: 7,
      composition_count: 0,
      revision_ratio: 3 / 11,
      production_rate_per_active_min: 960,
      inter_event_intervals_ms: [100, 200, 100, 2600, 100, 2900],
      pause_histogram: { lt_500_ms: 4, '500_to_1000_ms': 0, '1000_to_2000_ms': 0, '2000_to_5000_ms': 1, gte_5000_ms: 1 },
      burst_count: 3,
      submitted: true,
      abandoned: false,
      revision_locations: [
        { offset: 3, length: 3, op: 'insert', t: 0, wall_ms: 0, distance: 0 },
        { offset: 1, length: 2, op: 'delete', t: 6000, wall_ms: 6000, distance: 7 },
      ],
      // typing-v3 additions.
      edit_timestamps_ms: [100, 300, 400, 3000, 3100, 6000],
      p_burst_count: 2,
      r_burst_count: 1,
      p_burst_mean_graphemes: 3,
      r_burst_mean_graphemes: 5,
      mean_burst_graphemes: 11 / 3,
      mean_burst_words: null,
      revision_distance_mean: 1,
      revision_distance_median: 0,
      leading_edge_revision_ratio: 6 / 7,
      chars_per_min: 78.68852459016394,
      chars_per_min_active: 960,
      words_per_min: null,
      words_per_min_active: null,
      produced_graphemes: 11,
      product_ratio: 8 / 11,
      pause_location_counts: null,
    },
    quality: {
      thresholds: {
        pause_buckets: [500, 1000, 2000, 5000],
        burst_threshold_ms: 2000,
        pause_threshold_mode: 'fixed',
        leading_edge_tolerance_graphemes: 2,
      },
      intervals_truncated: false,
      revision_locations_truncated: false,
    },
  };
  const result = validateEmotionBatch({ events: [typingEvent] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// typing-v1 and typing-v2 shaped payloads (no v3 fields at all) stay valid — additive only.
{
  const typingV1Event = {
    ...validEvent,
    modality: 'typing',
    typing: {
      elapsed_ms: 1000,
      active_input_ms: 500,
      first_input_latency_ms: 100,
      committed_graphemes: 10,
      inserted_graphemes: 10,
      deleted_graphemes: 0,
      replacement_graphemes: 0,
      pasted_graphemes: 0,
      edit_event_count: 1,
      composition_count: 0,
      revision_ratio: 0,
      production_rate_per_active_min: 100,
      inter_event_intervals_ms: [],
      pause_histogram: {},
      burst_count: 1,
      submitted: true,
      abandoned: false,
      // no revision_locations, no typing-v3 fields at all.
    },
    quality: {
      thresholds: { pause_buckets: [500, 1000, 2000, 5000], burst_threshold_ms: 2000 },
      intervals_truncated: false,
    },
  };
  const result = validateEmotionBatch({ events: [typingV1Event] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// p_burst_count negative -> rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'typing', typing: { p_burst_count: -1 } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('p_burst_count')));
}

// leading_edge_revision_ratio out of [0,1] -> rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'typing', typing: { leading_edge_revision_ratio: 1.2 } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('leading_edge_revision_ratio')));
}

// revision_distance_mean / median / mean_burst_graphemes / words_per_min accept null (never measured).
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      modality: 'typing',
      typing: {
        revision_distance_mean: null,
        revision_distance_median: null,
        mean_burst_words: null,
        words_per_min: null,
        words_per_min_active: null,
        pause_location_counts: null,
      },
    }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// words_per_min negative -> rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'typing', typing: { words_per_min: -5 } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('words_per_min')));
}

// pause_location_counts: well-formed passes.
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      modality: 'typing',
      typing: { pause_location_counts: { mid_word: 1, word_boundary: 2, sentence_boundary: 0, paragraph_boundary: 3 } },
    }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// pause_location_counts: unsupported key -> rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'typing', typing: { pause_location_counts: { not_a_real_key: 1 } } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('pause_location_counts')));
}

// pause_location_counts: negative count -> rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'typing', typing: { pause_location_counts: { mid_word: -1 } } }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('pause_location_counts.mid_word')));
}

// revision_locations entry: distance negative -> rejected; wall_ms/distance are optional (typing-v2-shaped entry stays valid).
{
  const badDistance = validateEmotionBatch({
    events: [{
      ...validEvent,
      modality: 'typing',
      typing: { revision_locations: [{ offset: 0, length: 1, op: 'insert', t: 0, distance: -1 }] },
    }],
  });
  assert.equal(badDistance.ok, false);
  assert.ok(badDistance.errors.some(e => e.includes('revision_locations[0].distance')));

  const noV3Fields = validateEmotionBatch({
    events: [{
      ...validEvent,
      modality: 'typing',
      typing: { revision_locations: [{ offset: 0, length: 1, op: 'insert', t: 0 }] },
    }],
  });
  assert.equal(noV3Fields.ok, true, JSON.stringify(noV3Fields.errors));
}

// edit_timestamps_ms: too long -> rejected; negative value -> rejected.
{
  const tooLong = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'typing', typing: { edit_timestamps_ms: new Array(5001).fill(1) } }],
  });
  assert.equal(tooLong.ok, false);
  assert.ok(tooLong.errors.some(e => e.includes('edit_timestamps_ms')));

  const negative = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'typing', typing: { edit_timestamps_ms: [-1] } }],
  });
  assert.equal(negative.ok, false);
  assert.ok(negative.errors.some(e => e.includes('edit_timestamps_ms')));
}

// adaptive_burst_count / adaptive_active_input_ms and quality.thresholds adaptive fields: well-formed passes.
{
  const result = validateEmotionBatch({
    events: [{
      ...validEvent,
      modality: 'typing',
      typing: { adaptive_burst_count: 2, adaptive_active_input_ms: 630 },
      quality: {
        thresholds: {
          pause_buckets: [500, 1000, 2000, 5000],
          burst_threshold_ms: 2000,
          pause_threshold_mode: 'adaptive',
          leading_edge_tolerance_graphemes: 2,
          adaptive_burst_threshold_ms: 330,
          adaptive_rule: 'median_iki_x3',
        },
      },
    }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// produced_graphemes / product_ratio: well-formed passes; negative produced_graphemes rejected.
{
  const result = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'typing', typing: { produced_graphemes: 11, product_ratio: 8 / 11 } }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const bad = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'typing', typing: { produced_graphemes: -1 } }],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => e.includes('produced_graphemes')));
}

// ─── Voice block (voice-v1) ────────────────────────────────────────────

// A well-formed voice-v1 block — including legitimate nulls on every
// unmeasurable statistic — passes. Nulls are the aggregator's contract for
// "could not be measured" (a turn with no detectable pitch is not a turn at
// 0 Hz); the validator must accept them, never force a 0.
{
  const voiceEvent = {
    ...validEvent,
    modality: 'voice',
    window_kind: 'episode',
    feature_profile: 'voice-v1',
    voice: {
      turn_duration_ms: 3400,
      speech_duration_ms: 1900,
      speech_ratio: 1900 / 3400,
      initial_silence_ms: 300,
      trailing_silence_ms: 400,
      internal_pause_count: 1,
      internal_pause_total_ms: 600,
      pause_histogram: { lt_500_ms: 1, '500_to_1000_ms': 1, '1000_to_2000_ms': 0, '2000_to_5000_ms': 0, gte_5000_ms: 0 },
      speech_segment_count: 3,
      segment_duration_mean_ms: 1900 / 3,
      excluded_playback_ms: 600,
      muted_ms: 0,
      voiced_frame_ratio: 13 / 34,
      // Pitch statistics legitimately null (below the voiced-frame floor).
      pitch_median_hz: null,
      pitch_iqr_hz: null,
      pitch_slope_hz_per_s: null,
      pitch_confidence_mean: null,
      pitch_frames_excluded_ratio: null,
      rms_mean: 0.147,
      rms_variability: 0.05,
      peak_to_average_ratio: 3.4,
      clipping_ratio: 0,
      near_silence_ratio: 15 / 34,
      // Spectral means legitimately null (silent turn).
      spectral_centroid_mean_hz: null,
      spectral_rolloff_mean_hz: null,
      sample_rate: 16000,
      channel_count: 1,
      echo_cancellation: true,
      noise_suppression: true,
      auto_gain_control: false,
      stream_owner: 'oyon',
      clipped_coverage: 0,
      muted_coverage: 0,
      hidden_coverage: null,
      contaminated_coverage: 3 / 34,
      vad_coverage: 1,
      pitch_coverage: 11 / 19,
      analyzable_speech_ms: 1900,
      insufficient_data: false,
      insufficient_reasons: [],
    },
    quality: {
      thresholds: { frame_ms: 32, vad_threshold: 0.5, pause_threshold_ms: 500 },
      loudness_contaminated: false,
    },
  };
  const result = validateEmotionBatch({ events: [voiceEvent] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
}

// Measured pitch must sit in a plausible 20–1000 Hz band; a falling slope
// (negative) is valid, an implausible one is not.
{
  const ok = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { pitch_median_hz: 125, pitch_iqr_hz: 25, pitch_slope_hz_per_s: -30 } }],
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));

  const low = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { pitch_median_hz: 5 } }],
  });
  assert.equal(low.ok, false);
  assert.ok(low.errors.some(e => e.includes('pitch_median_hz')));

  const wildSlope = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { pitch_slope_hz_per_s: 5000 } }],
  });
  assert.equal(wildSlope.ok, false);
  assert.ok(wildSlope.errors.some(e => e.includes('pitch_slope_hz_per_s')));
}

// Ratios are bounded 0–1; counts are non-negative integers; durations are
// non-negative finite.
{
  const badRatio = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { speech_ratio: 1.2 } }],
  });
  assert.equal(badRatio.ok, false);
  assert.ok(badRatio.errors.some(e => e.includes('speech_ratio')));

  const badCount = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { internal_pause_count: -1 } }],
  });
  assert.equal(badCount.ok, false);
  assert.ok(badCount.errors.some(e => e.includes('internal_pause_count')));

  const badDuration = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { turn_duration_ms: -5 } }],
  });
  assert.equal(badDuration.ok, false);
  assert.ok(badDuration.errors.some(e => e.includes('turn_duration_ms')));

  const fractionalCount = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { speech_segment_count: 1.5 } }],
  });
  assert.equal(fractionalCount.ok, false);
  assert.ok(fractionalCount.errors.some(e => e.includes('speech_segment_count')));
}

// stream_owner is a closed enum; booleans must be booleans.
{
  const badOwner = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { stream_owner: 'martian' } }],
  });
  assert.equal(badOwner.ok, false);
  assert.ok(badOwner.errors.some(e => e.includes('stream_owner')));

  const badBool = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { auto_gain_control: 'yes' } }],
  });
  assert.equal(badBool.ok, false);
  assert.ok(badBool.errors.some(e => e.includes('auto_gain_control')));
}

// insufficient_reasons: transport length caps (shape sanity, not a gate).
{
  const tooMany = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { insufficient_reasons: new Array(17).fill('turn_too_short') } }],
  });
  assert.equal(tooMany.ok, false);
  assert.ok(tooMany.errors.some(e => e.includes('insufficient_reasons')));

  const nonString = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { insufficient_reasons: [42] } }],
  });
  assert.equal(nonString.ok, false);
  assert.ok(nonString.errors.some(e => e.includes('insufficient_reasons[0]')));
}

// pause_histogram: non-negative integer map.
{
  const bad = validateEmotionBatch({
    events: [{ ...validEvent, modality: 'voice', voice: { pause_histogram: { lt_500_ms: -1 } } }],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => e.includes('pause_histogram')));
}

console.log('validation.test.js passed');
