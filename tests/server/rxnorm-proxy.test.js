// Unit tests for the RxNorm proxy enrichment added for the Treatments
// library "Add from RxNorm / openFDA" search: term type per hit, empty
// approximateTerm names filled from /properties, ingredient-first ordering,
// and tolerance of a failing properties lookup. Fetch is mocked through
// proxyCache.setFetch, the same seam catalogue-proxies.test.js uses.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setFetch, cacheClear } from '../../server/services/proxyCache.js';
import { searchRxNorm, ttyRank, ENRICH_CAP } from '../../server/services/rxnormProxy.js';

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

    it('ttyRank groups term types', () => {
        expect(ttyRank('IN')).toBe(0);
        expect(ttyRank('min')).toBe(0);
        expect(ttyRank('SCD')).toBe(1);
        expect(ttyRank('SBD')).toBe(1);
        expect(ttyRank('BN')).toBe(2);
        expect(ttyRank(null)).toBe(2);
    });
});
