/**
 * RespirationEstimator — breathing rate from the same facial-ROI colour stream
 * that feeds rPPG.
 *
 * Breathing modulates the rPPG signal in two ways that both land well below
 * the cardiac band: perfusion changes across the respiratory cycle, and the
 * small head/torso motion of breathing itself. Isolating 0.1-0.5 Hz (6-30
 * breaths/min) recovers a usable rate from a buffer that already exists — no
 * new sensor, no new model, and no extra per-frame cost beyond one array push.
 *
 * SCOPE — read this before trusting a number. This is a learning-analytics
 * signal, not a diagnostic one. It is a decent *estimate with a confidence*,
 * useful as a trend and as a covariate; it is not a respiration monitor and
 * must never be used for anything clinical or safety-critical.
 *
 * Why the long window: frequency resolution is 1/T. Resolving 12 vs 15
 * breaths/min (0.20 vs 0.25 Hz) needs T well past 20 s, so the default
 * analysis window is 45 s and the minimum is 25 s. That is intentional and
 * matches how slowly the quantity itself moves — a resting respiration rate
 * does not meaningfully change second to second, so a value per ~5 s that is
 * ACTUALLY right beats a jittery one per frame that is not.
 */

import { powerSpectrum } from './fft.js';
import { resampleUniform, detrend, movingAverageHighPass } from './HeartRateEstimator.js';

const MIN_BRPM = 6;
const MAX_BRPM = 30;
/** Bins around the peak excluded from the background estimate. */
const PEAK_EXCLUSION_BINS = 2;
/** SNR at/below which a peak is indistinguishable from noise (measured). */
const SNR_FLOOR = 6;
/** SNR span above the floor that maps to full confidence. */
const SNR_SPAN = 12;


export class RespirationEstimator {
  constructor(options = {}) {
    this.options = {
      // Rolling analysis window. Long by necessity (see header).
      bufferSeconds: 45,
      // Nothing is emitted before the buffer spans this much signal.
      minWindowSeconds: 25,
      // Recompute at most this often — the underlying quantity cannot change
      // faster, so anything more is churn.
      updateIntervalMs: 5000,
      // Internal working rate. Respiration tops out at 0.5 Hz, so 5 Hz is 10x
      // Nyquist and keeps the FFT small.
      workingHz: 5,
      // Drop estimates below this SNR-derived confidence rather than emitting
      // a number nobody should read. 0 disables.
      // Raised from 0.35 after measurement: under the OLD peak/mean SNR, white
      // noise scored 0.42 and slow lighting drift 0.64 — both sailed through a
      // 0.35 gate and reported a confident, plausible-looking breathing rate
      // from a signal containing none. Lower this to trade false positives for
      // coverage; it is exposed as `respiration_min_confidence`.
      minConfidence: 0.4,
      // Compute a second, illumination-resistant signal from green's share of
      // total RGB. It is reported as corroborating evidence; by default it
      // does not censor the established green-channel estimate.
      rgbCorroboration: true,
      requireRgbCorroboration: false,
      rgbAgreementToleranceBrpm: 2,
      // Sampling validity. Resampling must not manufacture a continuous trace
      // across a throttled/backgrounded camera stream.
      minimumSampleRateHz: 2,
      maxSampleGapMs: 2000,
      // Consecutive recomputes that must agree before a rate is emitted.
      // 1 disables the check (and restores the old false-positive behaviour).
      // 4 chosen by measurement, not taste. Across 4 junk signals x 6 noise
      // seeds and 6 real signals x 6 seeds:
      //   count=2 -> 6/24 false positives, 24/24 detected, 34 s
      //   count=3 -> 1/24 false positives, 36/36 detected, 36 s
      //   count=4 -> 0/24 false positives, 36/36 detected, 42 s
      // The extra ~6 s buys the last false positive. A missing reading is far
      // better than a wrong one here.
      agreementCount: 4,
      agreementToleranceBrpm: 2,
      agreementToleranceFraction: 0.15,
      // Plausibility prior, mirroring the heart-rate tracker. Normal adult
      // resting respiration is ~12-20 br/min; 10-24 is a generous band around
      // it. Inside the band a rate is believed after the usual agreement;
      // OUTSIDE it, this many EXTRA agreeing recomputes are required first.
      //
      // This is the guard that matters in practice. A strong periodic
      // artifact (an air-conditioner cycle, a flickering display) puts real
      // harmonic energy in the band and produces a STABLE spurious peak, so
      // agreement alone cannot reject it — measured at 7.1-8.0 br/min with
      // confidence 1.00 across every seed. What gives it away is that such
      // peaks land outside the physiological range far more often than real
      // breathing does. A genuinely slow breather is still reported, after
      // sustained corroboration.
      // 9, not 10: a genuine 10 br/min breather sat exactly ON a 10 boundary
      // and flipped in and out of the plausible band, so it kept demanding
      // extra corroboration and was never reported (6/36 real cases missed).
      // A boundary placed on top of a normal rate is a badly-chosen boundary;
      // the artifact this guards against measured 7.2 br/min.
      plausibleMinBrpm: 9,
      plausibleMaxBrpm: 24,
      implausibleCorroboration: 2,
      ...options,
    };
    this.samples = [];
    this._last = null;
    this._lastComputeMs = 0;
    this._recent = [];
    this._estimateState = 'acquiring';
    this._confirmationCount = 0;
    this._confirmationRequired = Math.max(1, this.options.agreementCount);
    this._acquisitionReason = null;
  }

  /**
   * Feed one facial-ROI colour sample. Shares the heart-rate sampler's stream;
   * Green remains the primary signal (strongest perfusion response). RGB is
   * retained only to form an optional illumination-resistant corroboration
   * ratio; no images or ROI pixels are retained.
   *
   * @param {{r:number,g:number,b:number}} rgb
   * @param {number} ts epoch ms
   */
  addSample(rgb, ts = Date.now()) {
    if (!rgb || !Number.isFinite(rgb.g)) return;
    const previous = this.samples[this.samples.length - 1];
    // A long camera pause starts a new contiguous acquisition. Keeping samples
    // from both sides of the pause poisoned the entire rolling buffer: progress
    // reached 100%, sampling stayed invalid, and the user then waited up to
    // another 45 seconds for that single old gap to age out. Never interpolate
    // across missing video; recover immediately from the first new frame.
    if (previous && ts - previous.t > this.options.maxSampleGapMs) {
      this.samples = [];
      this._last = null;
      this._lastComputeMs = 0;
      this._recent = [];
      this._estimateState = 'acquiring';
      this._confirmationCount = 0;
      this._confirmationRequired = Math.max(1, this.options.agreementCount);
      this._acquisitionReason = 'sample_gap';
    }
    this.samples.push({
      t: ts,
      r: Number.isFinite(rgb.r) ? rgb.r : null,
      g: rgb.g,
      b: Number.isFinite(rgb.b) ? rgb.b : null,
    });
    const cutoff = ts - this.options.bufferSeconds * 1000;
    while (this.samples.length > 0 && this.samples[0].t < cutoff) this.samples.shift();
  }

  /** Acquisition progress, for UI that must distinguish "filling" from "failed". */
  status(now = Date.now()) {
    const span = this.spanSeconds();
    const sampling = this.samplingStatus();
    const buffered = span >= this.options.minWindowSeconds;
    const estimateState = !buffered
        ? 'acquiring'
        : !sampling.adequate
          ? sampling.reason
          : this._estimateState === 'acquiring' ? 'no_stable_rate' : this._estimateState;
    if (buffered) this._acquisitionReason = null;
    return {
      buffered_seconds: span,
      min_window_seconds: this.options.minWindowSeconds,
      progress: Math.min(1, span / this.options.minWindowSeconds),
      buffered,
      ready: buffered && sampling.adequate,
      reason: !buffered
        ? this._acquisitionReason ?? 'acquiring'
        : sampling.adequate ? estimateState : sampling.reason,
      estimate_state: estimateState,
      confirmation_count: this._confirmationCount,
      confirmation_required: this._confirmationRequired,
      n_samples: this.samples.length,
      sample_rate_hz: sampling.sampleRateHz,
      minimum_sample_rate_hz: this.options.minimumSampleRateHz,
      median_sample_interval_ms: sampling.medianIntervalMs,
      max_sample_gap_ms: sampling.maxGapMs,
      maximum_sample_gap_ms: this.options.maxSampleGapMs,
      sampling_adequate: sampling.adequate,
      last_update_ms: this._lastComputeMs ? now - this._lastComputeMs : null,
    };
  }

  spanSeconds() {
    if (this.samples.length < 2) return 0;
    return (this.samples[this.samples.length - 1].t - this.samples[0].t) / 1000;
  }

  sampleRateHz() {
    const span = this.spanSeconds();
    if (span <= 0) return 0;
    return (this.samples.length - 1) / span;
  }

  samplingStatus() {
    const deltas = [];
    for (let i = 1; i < this.samples.length; i += 1) {
      const delta = this.samples[i].t - this.samples[i - 1].t;
      if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
    }
    const medianIntervalMs = median(deltas);
    const maxGapMs = deltas.length > 0 ? Math.max(...deltas) : null;
    const sampleRateHz = this.sampleRateHz();
    let reason = null;
    if (sampleRateHz < this.options.minimumSampleRateHz) reason = 'low_sample_rate';
    else if (maxGapMs != null && maxGapMs > this.options.maxSampleGapMs) reason = 'sample_gap';
    return {
      adequate: reason == null,
      reason,
      sampleRateHz,
      medianIntervalMs,
      maxGapMs,
    };
  }

  /**
   * @returns {{brpm:number, snr:number, confidence:number, window_seconds:number,
   *            n_samples:number, fs:number, method:string}|null}
   */
  estimate(now = Date.now()) {
    const span = this.spanSeconds();
    if (span < this.options.minWindowSeconds) {
      this._estimateState = 'acquiring';
      return null;
    }
    const sampling = this.samplingStatus();
    if (!sampling.adequate) {
      this._last = null;
      this._recent = [];
      this._estimateState = sampling.reason;
      this._confirmationCount = 0;
      return null;
    }

    // Throttle: repeat the previous answer between recomputes rather than
    // burning an FFT per frame for a quantity that moves this slowly.
    //
    // This MUST apply whether or not there is a previous result. Guarding it on
    // `this._last` (as it originally did) meant that while an estimate was
    // being rejected the FFT re-ran on every single sample — so the
    // "consecutive agreeing estimates" check was comparing buffers ~1 s apart,
    // which are almost the same data and therefore agree trivially. Noise
    // passed the agreement gate that way. Genuinely independent evidence needs
    // genuinely spaced recomputes.
    if (this._lastComputeMs > 0 && now - this._lastComputeMs < this.options.updateIntervalMs) {
      return this._last;
    }
    this._lastComputeMs = now;

    const times = this.samples.map((s) => s.t);
    const values = this.samples.map((s) => s.g);
    const primary = analyzeRespirationSeries(times, values, span, this.options.workingHz);
    if (!primary) {
      this._estimateState = 'no_stable_rate';
      return null;
    }
    const { brpm, snr, confidence, fs } = primary;

    const rgbCorroboration = this.options.rgbCorroboration
      ? analyzeRgbCorroboration(this.samples, times, span, this.options, brpm)
      : disabledCorroboration();
    rgbCorroboration.required = Boolean(this.options.requireRgbCorroboration);
    const rgbAccepted = !this.options.requireRgbCorroboration || rgbCorroboration.agrees;
    const confidenceAccepted = confidence >= this.options.minConfidence;

    // Cross-estimate agreement — the discriminator that does not depend on
    // delicate spectral thresholds. A real breathing rate is stable across
    // consecutive ~5 s recomputes; a spurious peak from drift or noise wanders,
    // because it is a different accident each time. Measured attempts to tune
    // the filter instead were unstable: one high-pass pass rejected a drift
    // case that two passes turned into a confident 7.4 br/min, which is
    // fitting the noise realisation rather than the physics.
    //
    // Costs one extra update interval (~5 s) before the first reading.
    // The history must hold at least as many values as the STRICTEST path
    // requires. A fixed cap of 4 made the out-of-band branch (which needs
    // agreementCount + implausibleCorroboration = 6) unreachable, so a
    // genuinely slow or fast breather could never be reported at all — the
    // prior silently became a censor instead of a delay.
    const historyCap = this.options.agreementCount + Math.max(0, this.options.implausibleCorroboration);
    // Low-quality candidates remain visible but cannot accumulate evidence for
    // confirmation. The aggregator will weight them softly by confidence.
    if (!confidenceAccepted || !rgbAccepted) this._recent = [];
    else this._recent.push(brpm);
    while (this._recent.length > historyCap) this._recent.shift();
    const plausible = brpm >= this.options.plausibleMinBrpm && brpm <= this.options.plausibleMaxBrpm;
    const needed = Math.max(1, this.options.agreementCount)
      + (plausible ? 0 : Math.max(0, this.options.implausibleCorroboration));
    this._confirmationRequired = needed;
    this._confirmationCount = Math.min(this._recent.length, needed);
    const window = this._recent.length > 0 ? this._recent.slice(-needed) : [brpm];
    const spread = Math.max(...window) - Math.min(...window);
    const tolerance = Math.max(
      this.options.agreementToleranceBrpm,
      brpm * this.options.agreementToleranceFraction,
    );
    const stable = confidenceAccepted
      && rgbAccepted
      && this._recent.length >= needed
      && spread <= tolerance;
    // Report the median of the agreeing estimates rather than the newest —
    // the agreement is the evidence, so the summary should reflect all of it.
    const agreed = [...window].sort((a, b) => a - b);
    const reported = agreed.length % 2
      ? agreed[(agreed.length - 1) / 2]
      : (agreed[agreed.length / 2 - 1] + agreed[agreed.length / 2]) / 2;

    // Confidence controls influence instead of existence. Until repeated
    // estimates agree, reduce confidence so the number is visibly red/amber
    // and contributes little to the confidence-weighted window mean.
    let effectiveConfidence = confidence;
    if (!rgbAccepted) effectiveConfidence *= 0.25;
    if (!stable && confidenceAccepted && rgbAccepted) {
      const support = Math.min(1, this._recent.length / needed);
      effectiveConfidence *= spread > tolerance ? 0.25 : Math.min(0.55, support);
    }
    if (!confidenceAccepted) this._estimateState = 'low_confidence';
    else if (!rgbAccepted) this._estimateState = 'rgb_uncorroborated';
    else if (this._recent.length < needed) this._estimateState = 'confirming';
    else if (spread > tolerance) this._estimateState = 'unstable_rate';
    else this._estimateState = 'measured';

    this._last = {
      brpm: reported,
      snr,
      confidence: effectiveConfidence,
      confidence_raw: confidence,
      quality_accepted: stable,
      stability: {
        confirmed: stable,
        count: this._confirmationCount,
        required: this._confirmationRequired,
        spread_brpm: spread,
        tolerance_brpm: tolerance,
      },
      window_seconds: span,
      n_samples: this.samples.length,
      fs,
      method: 'green-lowband',
      sampling_quality: {
        sample_rate_hz: sampling.sampleRateHz,
        median_sample_interval_ms: sampling.medianIntervalMs,
        max_sample_gap_ms: sampling.maxGapMs,
        adequate: sampling.adequate,
      },
      rgb_corroboration: rgbCorroboration,
    };
    return this._last;
  }

  reset() {
    this.samples = [];
    this._last = null;
    this._lastComputeMs = 0;
    this._recent = [];
    this._estimateState = 'acquiring';
    this._confirmationCount = 0;
    this._confirmationRequired = Math.max(1, this.options.agreementCount);
    this._acquisitionReason = null;
  }
}

function analyzeRespirationSeries(times, values, span, workingHz) {
  // Uniform resampling first: decoded-video spacing jitters, and an FFT on an
  // uneven grid smears the peak.
  const resampled = resampleUniform(times, values);
  if (!resampled || resampled.length < 32) return null;
  const sourceFs = (resampled.length - 1) / span;
  if (!Number.isFinite(sourceFs) || sourceFs <= 0) return null;

  const decimateBy = Math.max(1, Math.round(sourceFs / workingHz));
  const decimated = decimateBy > 1 ? meanDecimate(resampled, decimateBy) : resampled.slice();
  const fs = sourceFs / decimateBy;
  if (decimated.length < 32 || !Number.isFinite(fs) || fs <= 0) return null;

  const detrended = detrend(decimated);
  const hpWindow = Math.max(3, Math.round(fs * (60 / MIN_BRPM) * 1.5));
  const filtered = movingAverageHighPass(detrended, hpWindow);
  const spec = powerSpectrum(hann(filtered));
  const df = fs / (spec.length * 2);
  const loBin = Math.max(1, Math.floor((MIN_BRPM / 60) / df));
  const hiBin = Math.min(spec.length - 2, Math.ceil((MAX_BRPM / 60) / df));
  if (hiBin <= loBin) return null;

  let peak = -1;
  let peakVal = -Infinity;
  for (let i = Math.max(loBin, 1); i <= Math.min(hiBin, spec.length - 2); i += 1) {
    if (spec[i] > spec[i - 1] && spec[i] > spec[i + 1] && spec[i] > peakVal) {
      peakVal = spec[i];
      peak = i;
    }
  }
  if (peak < 0 || !(peakVal > 0)) return null;
  if (peak <= loBin + 1 || peak >= hiBin - 1) return null;

  const brpm = parabolicPeak(spec, peak) * df * 60;
  if (!Number.isFinite(brpm) || brpm < MIN_BRPM || brpm > MAX_BRPM) return null;

  const background = [];
  for (let i = loBin; i <= hiBin; i += 1) {
    if (Math.abs(i - peak) > PEAK_EXCLUSION_BINS) background.push(spec[i]);
  }
  background.sort((a, b) => a - b);
  const bg = background.length > 0 ? background[Math.floor(background.length / 2)] : 0;
  const snr = bg > 0 ? peakVal / bg : null;
  const confidence = snr != null ? clamp01((snr - SNR_FLOOR) / SNR_SPAN) : 0;
  return { brpm, snr, confidence, fs };
}

function analyzeRgbCorroboration(samples, times, span, options, primaryBrpm) {
  const values = [];
  for (const sample of samples) {
    if (!Number.isFinite(sample.r) || !Number.isFinite(sample.g) || !Number.isFinite(sample.b)) {
      return unavailableCorroboration();
    }
    const total = sample.r + sample.g + sample.b;
    if (!(total > 0)) return unavailableCorroboration();
    values.push(sample.g / total);
  }
  const spread = Math.max(...values) - Math.min(...values);
  if (!Number.isFinite(spread) || spread < 1e-7) return unavailableCorroboration();
  const result = analyzeRespirationSeries(times, values, span, options.workingHz);
  if (!result || result.confidence < options.minConfidence) return unavailableCorroboration();
  const delta = Math.abs(result.brpm - primaryBrpm);
  return {
    enabled: true,
    available: true,
    brpm: result.brpm,
    snr: result.snr,
    confidence: result.confidence,
    delta_brpm: delta,
    agrees: delta <= options.rgbAgreementToleranceBrpm,
    method: 'green-share-lowband',
  };
}

function unavailableCorroboration() {
  return {
    enabled: true,
    available: false,
    brpm: null,
    snr: null,
    confidence: 0,
    delta_brpm: null,
    agrees: false,
    method: 'green-share-lowband',
  };
}

function disabledCorroboration() {
  return { ...unavailableCorroboration(), enabled: false };
}

/** Block-mean decimation — averaging is a cheap anti-alias prefilter. */
export function meanDecimate(values, factor) {
  if (factor <= 1) return values.slice();
  const out = [];
  for (let i = 0; i + factor <= values.length; i += factor) {
    let s = 0;
    for (let k = 0; k < factor; k += 1) s += values[i + k];
    out.push(s / factor);
  }
  return out;
}

function hann(x) {
  const n = x.length;
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return out;
}

function parabolicPeak(spec, i) {
  const a = spec[i - 1];
  const b = spec[i];
  const c = spec[i + 1];
  if (!Number.isFinite(a) || !Number.isFinite(c)) return i;
  const denom = a - 2 * b + c;
  if (denom === 0) return i;
  const delta = (0.5 * (a - c)) / denom;
  return Number.isFinite(delta) && Math.abs(delta) <= 1 ? i + delta : i;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export { MIN_BRPM, MAX_BRPM };
