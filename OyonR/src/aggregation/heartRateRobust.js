/**
 * robustBpm — anomaly-filtered central BPM over a set of per-estimate readings.
 *
 * Literature-grounded pipeline (all O(n), no deps):
 *   1. Prior-HR gate (optional) — drop readings far from a known recent HR
 *      ("deviation from previously estimated HR", PPG accuracy patents).
 *   2. Harmonic fold (optional) — a reading within tolerance of ½× or 2× the
 *      robust centre is folded home (the octave / sub-harmonic error). rPPG's
 *      analogue of Kubios' insert-missed / remove-extra beat correction.
 *   3. Hampel / MAD gate — drop readings > madH · max(1.4826·MAD, madFloor)
 *      from the median centre (the standard robust outlier test; the floor
 *      stops a low-noise MAD from collapsing the gate).
 *   4. Confidence-weighted mean of survivors, with a minimum-weight floor so a
 *      low-quality reading still contributes a little (rPPG SQI weighting).
 *
 * Returns the robust BPM plus counts so callers can surface an honest
 * "corrected fraction" (Kubios flags > 5% correction as over-correction).
 *
 * @param {Array<{bpm:number, weight?:number}>} items  weight = confidence (0..1)
 * @param {object} [options]
 * @returns {{bpm:number|null, centre:number|null, folded:number, dropped:number, kept:number, total:number, corrected_fraction:number}}
 */
export function robustBpm(items, options = {}) {
  const o = {
    enabled: true,
    fold: true,
    foldTol: 0.10,     // ±10% of ½×/2× centre counts as an octave error
    madH: 3,           // Hampel h
    madFloor: 4,       // BPM floor for the scaled MAD (min gate half-width)
    weighted: true,
    minWeight: 0.1,
    priorBpm: null,    // recent HR for the prior gate (null = off)
    maxJump: 0,        // max BPM deviation from priorBpm (0 = prior gate off)
    ...options,
  };

  const pts = (Array.isArray(items) ? items : [])
    .filter((it) => it && Number.isFinite(it.bpm))
    .map((it) => ({ bpm: it.bpm, w: Number.isFinite(it.weight) ? it.weight : 1 }));
  const total = pts.length;
  const empty = { bpm: null, centre: null, folded: 0, dropped: 0, kept: 0, total, corrected_fraction: 0 };
  if (total === 0) return empty;

  // Filter disabled → plain (optionally weighted) mean, no correction.
  if (!o.enabled) {
    const bpm = weightedMean(pts, o.weighted, o.minWeight);
    return { bpm, centre: median(pts.map((p) => p.bpm)), folded: 0, dropped: 0, kept: total, total, corrected_fraction: 0 };
  }

  // 1. Prior-HR gate.
  let work = pts;
  if (o.maxJump > 0 && Number.isFinite(o.priorBpm)) {
    const near = work.filter((p) => Math.abs(p.bpm - o.priorBpm) <= o.maxJump);
    if (near.length > 0) work = near; // never nuke the whole window
  }

  // 2. Harmonic fold.
  let centre = median(work.map((p) => p.bpm));
  let folded = 0;
  if (o.fold && centre > 0) {
    work = work.map((p) => {
      if (approx(p.bpm, 0.5 * centre, o.foldTol)) { folded += 1; return { bpm: p.bpm * 2, w: p.w }; }
      if (approx(p.bpm, 2 * centre, o.foldTol)) { folded += 1; return { bpm: p.bpm / 2, w: p.w }; }
      return p;
    });
    centre = median(work.map((p) => p.bpm));
  }

  // 3. Hampel / MAD gate.
  const mad = median(work.map((p) => Math.abs(p.bpm - centre)));
  const gate = o.madH * Math.max(1.4826 * mad, o.madFloor);
  const kept = work.filter((p) => Math.abs(p.bpm - centre) <= gate);
  const survivors = kept.length > 0 ? kept : work; // never drop everything
  const dropped = work.length - survivors.length;

  // 4. Confidence-weighted mean of survivors.
  const bpm = weightedMean(survivors, o.weighted, o.minWeight);

  return {
    bpm,
    centre,
    folded,
    dropped,
    kept: survivors.length,
    total,
    corrected_fraction: total > 0 ? (folded + dropped) / total : 0,
  };
}

function approx(x, target, tol) {
  return Math.abs(x - target) <= tol * target;
}

function weightedMean(pts, weighted, minWeight) {
  let num = 0;
  let den = 0;
  for (const p of pts) {
    const w = weighted ? Math.max(minWeight, p.w) : 1;
    num += p.bpm * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

function median(values) {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
