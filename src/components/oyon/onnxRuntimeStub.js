// Build-time stub for `onnxruntime-web`, aliased in vite.config.js.
//
// Why this exists: importing `oyon/signal-capture` reaches
// `VoiceTurnController → WorkerVoiceAnalyzer → voiceAnalysisWorker →
// SileroVadAdapter → import('onnxruntime-web')`. That import is already lazy
// at RUNTIME, but a bundler still has to emit everything it can reach, which
// added ~48.7 MB of `ort-wasm-simd-threaded*.wasm` plus ~500 KB of JS glue to
// dist/ — and therefore to frontend/ and the Docker image.
//
// None of it was reachable in practice. Rohy forces `voice_enabled: false`
// (VoiceService owns the microphone; see useSignalCapture.js), so the VAD
// never runs. And the SPA has no other bundled ONNX path: the emotion
// classifier runs inside the <oyon-app> element, which loads its own runtime
// same-origin from /oyon/standalone/vendor/onnxruntime-web. Bundling a second
// copy shipped the same megabytes twice.
//
// Settings gate CONSTRUCTION, not the import graph — that distinction is the
// whole reason this file is needed. Oyon's own doc comment promises a disabled
// modality's collaborators are never constructed, and that is true at runtime;
// it says nothing about what a bundler must still emit.
//
// This is deliberately NOT an empty object. If a bundled path ever genuinely
// needs ONNX, it should fail loudly here with a message naming the fix, rather
// than fail somewhere deep in an inference call with `undefined is not a
// function`.

const MESSAGE =
    'onnxruntime-web is stubbed out of the Rohy SPA bundle (vite.config.js alias → ' +
    'src/components/oyon/onnxRuntimeStub.js). Nothing in the SPA should need it: ' +
    'Oyon voice capture is disabled, and the <oyon-app> element loads its own ONNX ' +
    'runtime from /oyon/standalone/vendor/onnxruntime-web. If you are adding a ' +
    'bundled inference path, remove the alias and re-measure the dist/ size first — ' +
    'it was worth ~48.7 MB.';

function unavailable() {
    throw new Error(MESSAGE);
}

// The surface SileroVadAdapter/OnnxEmotionClassifier touch. Accessing any
// other export throws through the Proxy below.
export const InferenceSession = { create: unavailable };
export const Tensor = unavailable;
export const env = {};

export default new Proxy({ InferenceSession, Tensor, env }, {
    get(target, prop) {
        if (prop in target) return target[prop];
        return unavailable;
    },
});
