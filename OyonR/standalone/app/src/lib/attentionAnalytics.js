/*
 * Experimental attention analytics built only from aggregate windows. These
 * rules are descriptive, not a validated attention classifier. Keeping the
 * calculation pure makes the screen auditable and prevents UI components from
 * quietly inventing replacements for missing sensor values.
 */

export const ATTENTION_STATE_META = Object.freeze({
  focused: { label: 'Focused', color: '#2ea043' },
  shifting: { label: 'Shifting', color: '#d29922' },
  away: { label: 'Away', color: '#f85149' },
  available: { label: 'Available', color: '#58a6ff' },
  unmeasured: { label: 'Unmeasured', color: '#8b949e' },
});

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value) {
  return value && typeof value === 'object' ? value : null;
}

function mean(values) {
  const usable = values.filter((value) => value != null);
  return usable.length
    ? usable.reduce((sum, value) => sum + value, 0) / usable.length
    : null;
}

function timeMs(value) {
  const numeric = finite(value);
  if (numeric != null) return numeric;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function durationMs(window) {
  const explicit = finite(window.duration_ms);
  if (explicit != null && explicit >= 0) return explicit;
  const start = timeMs(window.window_start_ms ?? window.window_start);
  const end = timeMs(window.window_end_ms ?? window.window_end);
  return start != null && end != null ? Math.max(0, end - start) : 0;
}

function classifyAttention({ focus, offScreen, missingFace, gazeValid, fixations }) {
  if (
    focus == null
    && offScreen == null
    && missingFace == null
    && gazeValid == null
    && fixations == null
  ) return 'unmeasured';

  if ((offScreen != null && offScreen >= 0.35) || (missingFace != null && missingFace >= 0.4)) {
    return 'away';
  }
  if (
    focus != null
    && focus >= 0.65
    && (offScreen == null || offScreen <= 0.2)
    && (gazeValid == null || gazeValid >= 0.5)
  ) return 'focused';
  if (
    (offScreen == null || offScreen < 0.35)
    && ((fixations != null && fixations >= 2) || (focus != null && focus < 0.5))
  ) return 'shifting';
  return 'available';
}

function pearson(pairs) {
  if (pairs.length < 5) return null;
  const meanX = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let numerator = 0;
  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;
    numerator += dx * dy;
    sumX += dx * dx;
    sumY += dy * dy;
  }
  const denominator = Math.sqrt(sumX * sumY);
  return denominator > 0 ? numerator / denominator : null;
}

function sortedEntries(map) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
}

export function buildAttentionAnalytics(input) {
  const windows = [...input].sort((a, b) => {
    const aTime = timeMs(a.window_end_ms ?? a.window_end) ?? 0;
    const bTime = timeMs(b.window_end_ms ?? b.window_end) ?? 0;
    return aTime - bTime;
  });

  const focus = [];
  const onScreen = [];
  const gazeValid = [];
  const fixations = [];
  const medianFixationMs = [];
  const scanpath = [];
  const respiration = [];
  const respirationConfidence = [];
  const rgbAgreement = [];
  const states = [];
  const stateCounts = Object.fromEntries(Object.keys(ATTENTION_STATE_META).map((key) => [key, 0]));
  const stateDurationsMs = Object.fromEntries(Object.keys(ATTENTION_STATE_META).map((key) => [key, 0]));
  const aoiDwell = {};
  const aoiTransitions = {};
  let totalFixations = 0;
  let totalTransitions = 0;
  let focusedRuns = 0;
  let longestFocusedRunMs = 0;
  let currentFocusedRunMs = 0;
  let recoveries = 0;
  let previousState = null;

  for (const window of windows) {
    const engagement = record(window.engagement);
    const gaze = record(window.gaze);
    const facial = record(window.facial);
    const breathing = record(window.respiration);

    const focusValue = finite(engagement?.focus_score);
    const offScreenValue = finite(gaze?.off_screen_ratio);
    const missingFaceValue = finite(window.missing_face_ratio) ?? (
      finite(facial?.valid_frame_ratio) == null ? null : 1 - finite(facial.valid_frame_ratio)
    );
    const gazeValidValue = finite(gaze?.valid_frame_ratio);
    const fixationValue = finite(gaze?.fixation_count);
    const duration = durationMs(window);
    const state = classifyAttention({
      focus: focusValue,
      offScreen: offScreenValue,
      missingFace: missingFaceValue,
      gazeValid: gazeValidValue,
      fixations: fixationValue,
    });

    focus.push(focusValue);
    onScreen.push(offScreenValue == null ? null : Math.max(0, Math.min(1, 1 - offScreenValue)));
    gazeValid.push(gazeValidValue);
    fixations.push(fixationValue);
    medianFixationMs.push(finite(gaze?.fixation_duration_ms_median));
    scanpath.push(finite(gaze?.scanpath_length));
    respiration.push(finite(breathing?.brpm_mean));
    respirationConfidence.push(finite(breathing?.confidence_mean));
    rgbAgreement.push(finite(breathing?.rgb_corroboration_agreement_ratio));
    states.push(state);
    stateCounts[state] += 1;
    stateDurationsMs[state] += duration;

    if (fixationValue != null) totalFixations += fixationValue;
    const transitionCount = finite(gaze?.aoi_transition_count);
    if (transitionCount != null) totalTransitions += transitionCount;

    const dwell = record(gaze?.aoi_dwell_ms);
    if (dwell) {
      for (const [label, raw] of Object.entries(dwell)) {
        const value = finite(raw);
        if (value != null) aoiDwell[label] = (aoiDwell[label] ?? 0) + value;
      }
    }
    const transitions = record(gaze?.aoi_transitions);
    if (transitions) {
      for (const [label, raw] of Object.entries(transitions)) {
        const value = finite(raw);
        if (value != null) aoiTransitions[label] = (aoiTransitions[label] ?? 0) + value;
      }
    }

    if (state === 'focused') {
      if (previousState !== 'focused') focusedRuns += 1;
      currentFocusedRunMs += duration;
      longestFocusedRunMs = Math.max(longestFocusedRunMs, currentFocusedRunMs);
      if (previousState === 'away') recoveries += 1;
    } else {
      currentFocusedRunMs = 0;
    }
    previousState = state;
  }

  const overlapPairs = windows.flatMap((_, index) => (
    focus[index] != null && respiration[index] != null
      ? [[focus[index], respiration[index]]]
      : []
  ));
  const measuredAttentionWindows = states.filter((state) => state !== 'unmeasured').length;
  const respirationValues = respiration.filter((value) => value != null);

  return {
    windows,
    series: {
      focus,
      onScreen,
      gazeValid,
      fixations,
      medianFixationMs,
      scanpath,
      respiration,
      respirationConfidence,
      rgbAgreement,
    },
    states,
    stateCounts,
    stateDurationsMs,
    measuredAttentionWindows,
    meanFocus: mean(focus),
    meanOnScreen: mean(onScreen),
    meanGazeValid: mean(gazeValid),
    totalFixations,
    totalTransitions,
    focusedRuns,
    longestFocusedRunMs,
    recoveries,
    topAoiDwell: sortedEntries(aoiDwell),
    topAoiTransitions: sortedEntries(aoiTransitions),
    respiration: {
      values: respirationValues,
      readableWindows: respirationValues.length,
      mean: mean(respiration),
      min: respirationValues.length ? Math.min(...respirationValues) : null,
      max: respirationValues.length ? Math.max(...respirationValues) : null,
      meanConfidence: mean(respirationConfidence),
      meanRgbAgreement: mean(rgbAgreement),
      overlapWindows: overlapPairs.length,
      focusCorrelation: pearson(overlapPairs),
    },
  };
}
