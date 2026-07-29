#!/usr/bin/env node
/**
 * bench-voice-worker.mjs — measures how much MAIN-THREAD time the worker
 * analysis path (src/workers/voiceAnalysisWorker.js via
 * createWorkerVoiceAnalyzer) removes, compared to running the same
 * per-frame voice DSP in-thread.
 *
 *   npm run bench:voice-worker            (or: node scripts/bench-voice-worker.mjs)
 *
 * Method: N frames (512 samples, 16 kHz — one 32 ms Silero chunk each) of a
 * voiced synthetic signal are pushed through
 *   1. the analyzer in main-thread mode (the same-thread fallback core —
 *      exactly what runs when Workers are unavailable), and
 *   2. the analyzer in worker mode, backed by a real `node:worker_threads`
 *      worker speaking the same voice-worker-v1 protocol with transferred
 *      ArrayBuffers (the closest Node analogue of the browser module
 *      Worker; the identical core runs inside it).
 * Main-thread cost is measured with `performance.eventLoopUtilization()`
 * deltas (active event-loop time — the precise "how long was this thread
 * busy" number), alongside wall time.
 *
 * HONESTY NOTES (read before quoting numbers):
 * - This is a Node benchmark of the DSP tier only (FFT + spectral + NSDF
 *   pitch; `vadEnabled: false`). The Silero ONNX inference that ALSO moves
 *   off-thread in the browser is not included (ORT is not loaded here), so
 *   the browser-side benefit is LARGER than what this script shows.
 * - Frames are pushed back-to-back, not paced at 32 ms, so wall times are
 *   throughput numbers, not latency numbers.
 * - This script REPORTS; it asserts nothing. Timing assertions flake in CI.
 */

import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { createWorkerVoiceAnalyzer } from '../src/inference/WorkerVoiceAnalyzer.js';

const FRAME_COUNT = Number(process.env.BENCH_FRAMES || 1000);
const FRAME_SAMPLES = 512;
const SAMPLE_RATE = 16000;

/** Voiced-ish synthetic frame: 180 Hz fundamental + harmonics + noise. */
function makeFrame(i) {
  const frame = new Float32Array(FRAME_SAMPLES);
  const f0 = 180 + (i % 7) * 5;
  for (let n = 0; n < FRAME_SAMPLES; n += 1) {
    const t = (i * FRAME_SAMPLES + n) / SAMPLE_RATE;
    frame[n] = 0.4 * Math.sin(2 * Math.PI * f0 * t)
      + 0.2 * Math.sin(2 * Math.PI * 2 * f0 * t)
      + 0.1 * Math.sin(2 * Math.PI * 3 * f0 * t)
      + 0.02 * (Math.random() * 2 - 1);
  }
  return frame;
}

/**
 * Browser-Worker-shaped bridge over a node:worker_threads worker running
 * the REAL voiceAnalysisWorker core (imported by href inside the thread).
 */
function makeNodeWorkerBridge() {
  const moduleHref = new URL('../src/workers/voiceAnalysisWorker.js', import.meta.url).href;
  const nodeWorker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.moduleHref).then(({ createVoiceAnalysisWorkerCore }) => {
      const core = createVoiceAnalysisWorkerCore();
      parentPort.on('message', (message) => {
        core.handleMessage(message, (out, transfer) => parentPort.postMessage(out, transfer || []));
      });
    });
    `,
    { eval: true, workerData: { moduleHref } },
  );
  const bridge = {
    onmessage: null,
    onerror: null,
    postMessage(message, transfer) { nodeWorker.postMessage(message, transfer || []); },
    terminate() { nodeWorker.terminate(); },
  };
  nodeWorker.on('message', (data) => { if (typeof bridge.onmessage === 'function') bridge.onmessage({ data }); });
  nodeWorker.on('error', (err) => { if (typeof bridge.onerror === 'function') bridge.onerror(err); });
  return bridge;
}

async function run(label, analyzer) {
  await analyzer.init();
  // Warm up caches (Hann window, JIT) outside the measured window.
  for (let i = 0; i < 25; i += 1) await analyzer.analyze(makeFrame(i), SAMPLE_RATE);
  analyzer.reset();

  const eluStart = performance.eventLoopUtilization();
  const t0 = performance.now();
  for (let i = 0; i < FRAME_COUNT; i += 1) {
    await analyzer.analyze(makeFrame(i), SAMPLE_RATE);
    // Yield to the event loop after every frame: frames arrive as events in
    // production, and eventLoopUtilization() only accumulates at loop
    // iterations — a microtask-only loop would (wrongly) read as 0 active.
    await new Promise((resolve) => setImmediate(resolve));
  }
  const wallMs = performance.now() - t0;
  const elu = performance.eventLoopUtilization(eluStart);
  const result = {
    label,
    mode: analyzer.mode,
    wallMs,
    mainThreadActiveMs: elu.active,
    perFrameActiveUs: (elu.active / FRAME_COUNT) * 1000,
    droppedFrames: analyzer.droppedFrames,
  };
  analyzer.dispose();
  return result;
}

const inThread = await run(
  'in-thread (fallback core, same thread)',
  createWorkerVoiceAnalyzer({ workerFactory: () => null, vadEnabled: false }),
);
const offThread = await run(
  'worker (node:worker_threads, transferred buffers)',
  createWorkerVoiceAnalyzer({ workerFactory: () => makeNodeWorkerBridge(), vadEnabled: false }),
);

const fmt = (n) => n.toFixed(2);
console.log(`\nvoice DSP benchmark — ${FRAME_COUNT} frames × ${FRAME_SAMPLES} samples (${(FRAME_COUNT * 32 / 1000).toFixed(1)} s of audio)\n`);
for (const r of [inThread, offThread]) {
  console.log(`  ${r.label}  [mode=${r.mode}]`);
  console.log(`    wall time            ${fmt(r.wallMs)} ms`);
  console.log(`    main-thread active   ${fmt(r.mainThreadActiveMs)} ms  (${fmt(r.perFrameActiveUs)} µs/frame)`);
  console.log(`    dropped frames       ${r.droppedFrames}\n`);
}
const saved = inThread.mainThreadActiveMs - offThread.mainThreadActiveMs;
const pct = (saved / inThread.mainThreadActiveMs) * 100;
console.log(`  main-thread time moved off-thread: ${fmt(saved)} ms over ${FRAME_COUNT} frames`
  + ` (${fmt(pct)}% of the in-thread cost; ${fmt((saved / FRAME_COUNT) * 1000)} µs per 32 ms frame).`);
console.log('  Note: DSP tier only — in the browser the Silero ONNX inference also moves'
  + '\n  off-thread with this path, so the real-world saving is larger than shown here.');
