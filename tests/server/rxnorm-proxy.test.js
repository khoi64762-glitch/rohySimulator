// Unit tests for the RxNorm proxy enrichment added for the Treatments
// library "Add from RxNorm / openFDA" search: term type per hit, empty
// approximateTerm names filled from /properties, ingredient-first ordering,
// and tolerance of a failing properties lookup. Fetch is mocked through
// proxyCache.setFetch, the same seam catalogue-proxies.test.js uses.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setFetch, cacheClear, cacheSet } from '../../server/services/proxyCache.js';
import { searchRxNorm, lookupRxCui, ttyRank, ENRICH_CAP, DEFAULT_TIMEOUT_MS } from '../../server/services/rxnormProxy.js';

function mockResponse(json, { status = 200 } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
        text: async () => JSON.stringify(json),
    };
}

// A fetch stub keyed on the RxNav path: approximateTerm returns the
// candidate list, /rxcui/<id>/properties.json returns the matching entry
// from `props` (or the configured failure).
function rxnavFetch({ candidates, props = {}, failures = {} }) {
    return vi.fn(async (url) => {
        if (url.includes('/approximateTerm.json')) {
            return mockResponse({ approximateGroup: { candidate: candidates } });
        }
        const m = url.match(/\/rxcui\/([^/]+)\/properties\.json$/);
        if (m) {
            const id = decodeURIComponent(m[1]);
            if (failures[id] === 'throw') throw new Error('network down');
            if (failures[id] === 404) return mockResponse({}, { status: 404 });
            return mockResponse(props[id] ? { properties: props[id] } : {});
        }
        return mockResponse({}, { status: 500 });
    });
}

const propsCalls = (spy) => spy.mock.calls.filter(([u]) => u.includes('/properties.json'));
const termCalls = (spy) => spy.mock.calls.filter(([u]) => u.includes('/approximateTerm.json'));

describe('rxnormProxy.searchRxNorm — tty + name enrichment', () => {
    beforeEach(() => cacheClear());

    it('returns tty per hit from /properties and keeps the wire shape backward compatible', async () => {
        const spy = rxnavFetch({
            candidates: [
                { rxcui: '2193', name: 'ceftriaxone', score: '12.6' },
                { rxcui: '1664992', name: 'ceftriaxone Injection', score: '12.1' },
            ],
            props: {
                2193: { rxcui: '2193', name: 'ceftriaxone', synonym: '', tty: 'IN' },
                1664992: { rxcui: '1664992', name: 'ceftriaxone Injection', synonym: '', tty: 'SCDF' },
            },
        });
        setFetch(spy);
        const hits = await searchRxNorm('ceftriaxone');
        expect(hits.map((h) => h.tty)).toEqual(['IN', 'SCDF']);
        expect(hits[0]).toMatchObject({
            external_source: 'rxnorm', external_id: '2193', rxcui: '2193',
            display_name: 'ceftriaxone', score: 12.6, synonym: null,
            tty: 'IN', name_source: 'approximateTerm',
        });
        expect(termCalls(spy)).toHaveLength(1);
        expect(propsCalls(spy)).toHaveLength(2);
    });

    it('fills an empty approximateTerm name from /properties and marks name_source', async () => {
        // Regression lock: the live "ceftriaxone" ingredient hit (rxcui 2193)
        // rendered with display_name "" because the top-ranked candidate
        // carried no name.
        const spy = rxnavFetch({
            candidates: [
                { rxcui: '2193', rxaui: '10327356', score: '12.639', rank: '1', source: 'GS' },
                { rxcui: '1664992', name: 'ceftriaxone Injection', score: '12.18', source: 'RXNORM' },
            ],
            props: {
                2193: { rxcui: '2193', name: 'ceftriaxone', synonym: '', tty: 'IN' },
                1664992: { rxcui: '1664992', name: 'ceftriaxone Injection', tty: 'SCDF' },
            },
        });
        setFetch(spy);
        const hits = await searchRxNorm('ceftriaxone');
        const ingredient = hits.find((h) => h.rxcui === '2193');
        expect(ingredient.display_name).toBe('ceftriaxone');
        expect(ingredient.name_source).toBe('properties');
        expect(ingredient.tty).toBe('IN');
    });

    it('prefers the named candidate on a score tie so no lookup is needed for the name', async () => {
        const spy = rxnavFetch({
            candidates: [
                { rxcui: '2193', score: '12.639', source: 'GS' },
                { rxcui: '2193', name: 'ceftriaxone', score: '12.639', source: 'RXNORM' },
                { rxcui: '2193', name: 'CEFTRIAXONE', score: '12.639', source: 'VANDF' },
            ],
            props: { 2193: { rxcui: '2193', name: 'ceftriaxone', tty: 'IN' } },
        });
        setFetch(spy);
        const hits = await searchRxNorm('ceftriaxone');
        expect(hits).toHaveLength(1);
        expect(hits[0].display_name).toBe('ceftriaxone');
        expect(hits[0].name_source).toBe('approximateTerm');
    });

    it('orders IN/MIN first, then SCD/SBD, then others, score-descending inside each group', async () => {
        const spy = rxnavFetch({
            candidates: [
                { rxcui: '10', name: 'Brandex', score: '99' },
                { rxcui: '20', name: 'drug 10 MG Oral Tablet', score: '90' },
                { rxcui: '30', name: 'drug', score: '80' },
                { rxcui: '40', name: 'Brandex 10 MG Oral Tablet', score: '95' },
                { rxcui: '50', name: 'drug / other', score: '70' },
            ],
            props: {
                10: { rxcui: '10', name: 'Brandex', tty: 'BN' },
                20: { rxcui: '20', name: 'drug 10 MG Oral Tablet', tty: 'SCD' },
                30: { rxcui: '30', name: 'drug', tty: 'IN' },
                40: { rxcui: '40', name: 'Brandex 10 MG Oral Tablet', tty: 'SBD' },
                50: { rxcui: '50', name: 'drug / other', tty: 'MIN' },
            },
        });
        setFetch(spy);
        const hits = await searchRxNorm('drug');
        expect(hits.map((h) => `${h.rxcui}:${h.tty}`)).toEqual(['30:IN', '50:MIN', '40:SBD', '20:SCD', '10:BN']);
        // Score is preserved on every hit.
        expect(hits.map((h) => h.score)).toEqual([80, 70, 95, 90, 99]);
    });

    it('tolerates a failing /properties lookup — the hit keeps its approximateTerm fields', async () => {
        const spy = rxnavFetch({
            candidates: [
                { rxcui: '1', name: 'alpha', score: '90' },
                { rxcui: '2', score: '85' },
                { rxcui: '3', name: 'gamma', score: '80' },
            ],
            props: { 3: { rxcui: '3', name: 'gamma', tty: 'IN' } },
            failures: { 1: 'throw', 2: 404 },
        });
        setFetch(spy);
        const hits = await searchRxNorm('alpha');
        expect(hits).toHaveLength(3);
        const alpha = hits.find((h) => h.rxcui === '1');
        expect(alpha).toMatchObject({ display_name: 'alpha', tty: null, name_source: 'approximateTerm' });
        const unnamed = hits.find((h) => h.rxcui === '2');
        expect(unnamed).toMatchObject({ display_name: '', tty: null, name_source: null });
        expect(hits[0].rxcui).toBe('3'); // the one resolved IN sorts first
    });

    it('caps enrichment at ENRICH_CAP lookups per search and caches the enriched result', async () => {
        const candidates = Array.from({ length: ENRICH_CAP + 5 }, (_, i) => ({ rxcui: String(100 + i), name: `d${i}`, score: String(90 - i) }));
        const spy = rxnavFetch({ candidates, props: {} });
        setFetch(spy);
        const first = await searchRxNorm('d');
        expect(propsCalls(spy)).toHaveLength(ENRICH_CAP);
        const second = await searchRxNorm('d');
        expect(second).toEqual(first);
        expect(termCalls(spy)).toHaveLength(1);
        expect(propsCalls(spy)).toHaveLength(ENRICH_CAP);
    });

    // Regression lock: adversarial review #10 — one search fanned out into
    // 1 + 10 upstream requests, hits already carrying name + tty were still
    // looked up, and cached rxcui rows counted against the cap.
    it('ENRICH_CAP is 6 and only hits missing a name or a tty are looked up', async () => {
        expect(ENRICH_CAP).toBe(6);
        // Pre-seed the "already complete" state via the rxcui cache: after a
        // first search resolved 100..102, hits 100..102 need no round-trip.
        for (const id of ['100', '101', '102']) cacheSet('rxnorm', `rxcui:${id}`, { rxcui: id, name: `d${id}`, synonym: null, tty: 'IN' });
        const candidates = Array.from({ length: 12 }, (_, i) => ({ rxcui: String(100 + i), name: `d${100 + i}`, score: String(90 - i) }));
        const spy = rxnavFetch({ candidates, props: {} });
        setFetch(spy);
        const hits = await searchRxNorm('d');
        // Cached rows are applied for free (tty filled) and do NOT consume the cap...
        expect(hits.filter((h) => h.tty === 'IN').map((h) => h.rxcui).sort()).toEqual(['100', '101', '102']);
        // ...so exactly ENRICH_CAP UNCACHED lookups go upstream, none for 100..102.
        const looked = propsCalls(spy).map(([u]) => u.match(/rxcui\/(\d+)\//)[1]);
        expect(looked).toHaveLength(ENRICH_CAP);
        expect(looked).toEqual(['103', '104', '105', '106', '107', '108']);
        expect(termCalls(spy)).toHaveLength(1);
    });

    it('a hit whose approximateTerm row already has both name and tty is never looked up', async () => {
        // approximateTerm never returns tty today; if it ever does, the
        // lookup must be skipped — the filter is "missing name OR missing tty".
        const spy = rxnavFetch({ candidates: [{ rxcui: '1', name: 'alpha', score: '90' }], props: {} });
        setFetch(spy);
        cacheSet('rxnorm', 'rxcui:1', { rxcui: '1', name: 'alpha', synonym: null, tty: 'IN' });
        await searchRxNorm('alpha');
        expect(propsCalls(spy)).toHaveLength(0);
    });

    // Regression lock: adversarial review #10 — no abort signal, a stalled
    // RxNav pinned the request for the full route timeout.
    describe('upstream timeout / abort', () => {
        // A fetch that never resolves on its own but honours the signal —
        // exactly what undici does when the AbortSignal fires.
        const hangingFetch = () => vi.fn((url, { signal } = {}) => new Promise((_, reject) => {
            if (signal?.aborted) return reject(signal.reason);
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));

        it('DEFAULT_TIMEOUT_MS is ~4 s and searchRxNorm rejects within the budget when RxNav hangs', async () => {
            expect(DEFAULT_TIMEOUT_MS).toBe(4000);
            setFetch(hangingFetch());
            const started = Date.now();
            await expect(searchRxNorm('hang', { timeoutMs: 60 })).rejects.toThrow(/timeout|abort/i);
            expect(Date.now() - started).toBeLessThan(1500);
        });

        it('every fetch carries a signal; the caller\'s signal aborts the search and enrichment', async () => {
            const spy = hangingFetch();
            setFetch(spy);
            const controller = new AbortController();
            const p = searchRxNorm('abortme', { signal: controller.signal, timeoutMs: 5000 });
            controller.abort(new Error('client went away'));
            await expect(p).rejects.toThrow(/client went away/);
            expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
        });

        it('a hanging /properties lookup does not sink the search — the hit keeps its approximateTerm fields', async () => {
            const spy = vi.fn((url, { signal } = {}) => {
                if (url.includes('/approximateTerm.json')) {
                    return Promise.resolve(mockResponse({ approximateGroup: { candidate: [{ rxcui: '9', name: 'slow', score: '50' }] } }));
                }
                return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
            });
            setFetch(spy);
            const hits = await searchRxNorm('slow', { timeoutMs: 60 });
            expect(hits).toEqual([expect.objectContaining({ rxcui: '9', display_name: 'slow', tty: null })]);
        });

        it('bare lookupRxCui gets its own budget', async () => {
            setFetch(hangingFetch());
            await expect(lookupRxCui('1', { timeoutMs: 60 })).rejects.toThrow(/timeout|abort/i);
        });
    });

    it('ttyRank groups term types', () => {
        expect(ttyRank('IN')).toBe(0);
        expect(ttyRank('min')).toBe(0);
        expect(ttyRank('SCD')).toBe(1);
        expect(ttyRank('SBD')).toBe(1);
        expect(ttyRank('BN')).toBe(2);
        expect(ttyRank(null)).toBe(2);
    });
});
