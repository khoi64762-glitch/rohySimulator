// @vitest-environment node
//
// Node env, not the client project's jsdom default: this file imports
// vite.config.js, which pulls in esbuild, and esbuild asserts that
// `new TextEncoder().encode('') instanceof Uint8Array` — false under jsdom's
// TextEncoder, so the suite dies on import. Build config is node's domain.
//
// Regression lock: the ONNX bundle exclusion.
//
// Without the vite.config.js alias this test guards, importing
// `oyon/signal-capture` grows dist/ from 5,936 KB to 56,452 KB — ~48.7 MB of
// `ort-wasm-simd-threaded*.wasm` plus ~500 KB of JS glue, for a voice code
// path Rohy never runs and an ONNX runtime the <oyon-app> element already
// serves from /oyon/standalone/vendor/onnxruntime-web.
//
// Nothing else would catch its removal: the build still succeeds, every test
// still passes, and the SPA still works. The only symptom is a Docker image
// ~48.7 MB heavier, which is exactly the kind of regression that survives
// review. Measured with `npx vite build --outDir=…` before and after.

import { describe, it, expect } from 'vitest';
import viteConfig from '../../../vite.config.js';
import * as stub from './onnxRuntimeStub.js';

function aliasEntries(config) {
    const alias = config?.resolve?.alias;
    if (!alias) return [];
    return Array.isArray(alias)
        ? alias
        : Object.entries(alias).map(([find, replacement]) => ({ find, replacement }));
}

function matches(entry, request) {
    return entry.find instanceof RegExp ? entry.find.test(request) : entry.find === request;
}

describe('onnxruntime-web is aliased out of the SPA bundle', () => {
    it('aliases both the bare package and its subpath entrypoints', () => {
        const entries = aliasEntries(viteConfig);
        // SileroVadAdapter imports both, picking webgpu when available.
        for (const request of ['onnxruntime-web', 'onnxruntime-web/webgpu']) {
            const hit = entries.find(e => matches(e, request));
            expect(hit, `no vite alias covers "${request}"`).toBeDefined();
            expect(String(hit.replacement)).toMatch(/onnxRuntimeStub\.js$/);
        }
    });

    // The alias must not swallow unrelated specifiers.
    it('does not capture packages that merely start with the same text', () => {
        const entries = aliasEntries(viteConfig).filter(e => String(e.replacement).includes('onnxRuntimeStub'));
        expect(entries.some(e => matches(e, 'onnxruntime-web-extra'))).toBe(false);
        expect(entries.some(e => matches(e, 'not-onnxruntime-web'))).toBe(false);
    });
});

describe('the stub fails loudly rather than silently', () => {
    it('throws a message naming the alias and the cost', () => {
        expect(() => stub.InferenceSession.create()).toThrow(/onnxRuntimeStub\.js/);
        expect(() => stub.InferenceSession.create()).toThrow(/48\.7 MB/);
    });

    // An empty-object stub would surface as "undefined is not a function"
    // somewhere deep inside an inference call instead.
    it('throws for exports it does not model, not undefined', () => {
        expect(stub.default.somethingNobodyModelled).toBeTypeOf('function');
        expect(() => stub.default.somethingNobodyModelled()).toThrow(/stubbed out/);
    });
});
