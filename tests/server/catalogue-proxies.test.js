// Unit tests for the three search proxies. Mock fetch via setFetch from
// proxyCache.js — the proxies all funnel through `getFetch()` so the
// override applies process-wide.
//
// Why unit-test the proxies separately from the routes: the route test
// spawns the real server in a child process, so an in-process fetch mock
// wouldn't apply. These tests prove cache hit/miss + result normalization
// without touching the network. The route test can then assume the
// proxies work and only verify wiring (auth, query-param plumbing).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { setFetch, cacheClear, cacheGet, cacheSet, cacheStats, CACHE_MAX_ENTRIES } from '../../server/services/proxyCache.js';
import { perUserRateLimit, RATE_LIMITED_CODE } from '../../server/middleware/perUserRateLimit.js';
import { searchRxNorm, lookupRxCui } from '../../server/services/rxnormProxy.js';
import { searchOpenFda } from '../../server/services/openfdaProxy.js';
import { searchLoinc } from '../../server/services/loincProxy.js';

function mockResponse(json, { status = 200 } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
        text: async () => JSON.stringify(json),
    };
}

describe('proxyCache + search proxies', () => {
    beforeEach(() => {
        cacheClear();
    });

    describe('rxnormProxy.searchRxNorm', () => {
        it('returns empty array for blank query without hitting fetch', async () => {
            const fetchSpy = vi.fn();
            setFetch(fetchSpy);
            const out = await searchRxNorm('   ');
            expect(out).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('parses and normalizes RxNav approximateTerm response', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse({
                approximateGroup: {
                    candidate: [
                        { rxcui: '1191', name: 'Aspirin', score: '95' },
                        { rxcui: '1191', name: 'ASA', score: '90', synonym: 'Acetylsalicylic acid' },
                        { rxcui: '32968', name: 'Clopidogrel', score: '85' },
                    ],
                },
            }));
            setFetch(fetchSpy);
            const hits = await searchRxNorm('aspirin');
            // One approximateTerm call; the per-hit /properties enrichment
            // (tty + empty-name fill) is covered in rxnorm-proxy.test.js.
            expect(fetchSpy.mock.calls.filter(([u]) => u.includes('/approximateTerm.json'))).toHaveLength(1);
            expect(hits).toHaveLength(2);
            const aspirin = hits.find((h) => h.rxcui === '1191');
            expect(aspirin.display_name).toBe('Aspirin');
            expect(aspirin.score).toBe(95);
            expect(aspirin.external_source).toBe('rxnorm');
            // De-dup keeps the higher-score row for the same rxcui.
            expect(hits.find((h) => h.rxcui === '1191').score).toBe(95);
        });

        it('caches results — second identical call does not refetch', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse({
                approximateGroup: { candidate: [{ rxcui: '7242', name: 'Naloxone', score: '100' }] },
            }));
            setFetch(fetchSpy);
            const a = await searchRxNorm('naloxone');
            const b = await searchRxNorm('naloxone');
            expect(fetchSpy.mock.calls.filter(([u]) => u.includes('/approximateTerm.json'))).toHaveLength(1);
            expect(b).toEqual(a);
        });

        it('throws on upstream HTTP error', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse({}, { status: 500 }));
            setFetch(fetchSpy);
            await expect(searchRxNorm('fail')).rejects.toThrow(/HTTP 500/);
        });

        it('lookupRxCui parses /rxcui/:id/properties response', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse({
                properties: { rxcui: '7242', name: 'naloxone', synonym: 'Narcan', tty: 'IN' },
            }));
            setFetch(fetchSpy);
            const out = await lookupRxCui('7242');
            expect(out).toEqual({ rxcui: '7242', name: 'naloxone', synonym: 'Narcan', tty: 'IN' });
        });

        it('lookupRxCui returns null on 404', async () => {
            setFetch(vi.fn().mockResolvedValue(mockResponse({}, { status: 404 })));
            expect(await lookupRxCui('00000')).toBeNull();
        });
    });

    describe('openfdaProxy.searchOpenFda', () => {
        it('returns empty array for blank query without hitting fetch', async () => {
            const fetchSpy = vi.fn();
            setFetch(fetchSpy);
            const out = await searchOpenFda('');
            expect(out).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('normalizes openFDA drug-label response', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse({
                results: [{
                    set_id: 'abc-123',
                    indications_and_usage: ['Aspirin is indicated for pain relief.'],
                    contraindications: ['Hypersensitivity'],
                    adverse_reactions: ['GI upset'],
                    boxed_warning: ['Bleeding risk'],
                    openfda: {
                        spl_set_id: ['xyz-set'],
                        rxcui: ['1191'],
                        brand_name: ['BAYER ASPIRIN'],
                        generic_name: ['ASPIRIN'],
                        manufacturer_name: ['Bayer'],
                        product_ndc: ['12345-678'],
                    },
                }],
            }));
            setFetch(fetchSpy);
            const hits = await searchOpenFda('aspirin');
            expect(hits).toHaveLength(1);
            expect(hits[0]).toMatchObject({
                external_source: 'openfda',
                external_id: 'xyz-set',
                rxcui: '1191',
                display_name: 'BAYER ASPIRIN',
                ndc_primary: '12345-678',
                indications: 'Aspirin is indicated for pain relief.',
                boxed_warning: 'Bleeding risk',
            });
        });

        it('treats upstream 404 as empty (openFDA convention)', async () => {
            setFetch(vi.fn().mockResolvedValue(mockResponse({}, { status: 404 })));
            const out = await searchOpenFda('madeup');
            expect(out).toEqual([]);
        });
    });

    describe('loincProxy.searchLoinc', () => {
        it('returns empty for blank query', async () => {
            const fetchSpy = vi.fn();
            setFetch(fetchSpy);
            expect(await searchLoinc('')).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('parses Clinical Tables tuple response', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse([
                3,
                ['718-7', '4544-3', '789-8'],
                null,
                [
                    ['718-7', 'Hemoglobin', 'Hemoglobin [Mass/volume] in Blood', 'g/dL'],
                    ['4544-3', 'Hematocrit', 'Hematocrit [Volume Fraction] of Blood', '%'],
                    ['789-8', 'Erythrocytes', 'Erythrocytes [#/volume] in Blood', '10*6/uL'],
                ],
                null,
            ]));
            setFetch(fetchSpy);
            const hits = await searchLoinc('hemog');
            expect(hits).toHaveLength(3);
            expect(hits[0]).toMatchObject({
                external_source: 'loinc',
                external_id: '718-7',
                loinc_code: '718-7',
                ucum_unit: 'g/dL',
            });
        });

        it('caches and reuses across calls', async () => {
            const fetchSpy = vi.fn().mockResolvedValue(mockResponse([
                1, ['2951-2'], null,
                [['2951-2', 'Sodium', 'Sodium [Moles/volume] in Serum or Plasma', 'mmol/L']],
                null,
            ]));
            setFetch(fetchSpy);
            const a = await searchLoinc('sodium');
            const b = await searchLoinc('sodium');
            expect(fetchSpy).toHaveBeenCalledOnce();
            expect(a).toEqual(b);
        });
    });
});

// Regression lock: adversarial review #10 — proxyCache was an unbounded Map
// (every distinct typeahead prefix stayed resident for 24h) and the search
// routes had no per-user limit above the global 600/min per-IP one.
describe('proxyCache bound + eviction', () => {
    beforeEach(() => cacheClear());
    afterEach(() => vi.useRealTimers());

    it('never holds more than CACHE_MAX_ENTRIES; the oldest-inserted entries go first', () => {
        expect(CACHE_MAX_ENTRIES).toBe(2000);
        for (let i = 0; i < CACHE_MAX_ENTRIES + 25; i += 1) cacheSet('t', `k${i}`, i);
        expect(cacheStats().size).toBe(CACHE_MAX_ENTRIES);
        expect(cacheGet('t', 'k0')).toBeUndefined();
        expect(cacheGet('t', 'k24')).toBeUndefined();
        expect(cacheGet('t', 'k25')).toBe(25);
        expect(cacheGet('t', `k${CACHE_MAX_ENTRIES + 24}`)).toBe(CACHE_MAX_ENTRIES + 24);
    });

    it('re-setting a key moves it to the back of the eviction order', () => {
        for (let i = 0; i < CACHE_MAX_ENTRIES; i += 1) cacheSet('t', `k${i}`, i);
        cacheSet('t', 'k0', 'refreshed');           // now newest
        cacheSet('t', 'overflow', 1);              // evicts k1, not k0
        expect(cacheGet('t', 'k0')).toBe('refreshed');
        expect(cacheGet('t', 'k1')).toBeUndefined();
        expect(cacheStats().size).toBe(CACHE_MAX_ENTRIES);
    });

    it('sweeps expired entries on insert before evicting live ones', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-16T10:00:00Z'));
        for (let i = 0; i < CACHE_MAX_ENTRIES - 1; i += 1) cacheSet('short', `k${i}`, i, 1000);
        cacheSet('long', 'keep', 'x');            // 24h TTL — must survive
        expect(cacheStats().size).toBe(CACHE_MAX_ENTRIES);
        vi.advanceTimersByTime(5000);              // the short ones are now expired
        cacheSet('long', 'new', 'y');
        const stats = cacheStats();
        expect(stats.keys.short).toBeUndefined();  // all swept
        expect(stats.size).toBe(2);
        expect(cacheGet('long', 'keep')).toBe('x');
        expect(cacheGet('long', 'new')).toBe('y');
    });
});

describe('per-user search rate limit', () => {
    function appWithLimiter(max) {
        const app = express();
        app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-user'] || 1) }; next(); });
        app.get('/search', perUserRateLimit({ max, windowMs: 60_000, message: 'Too many catalogue searches. Please slow down.' }), (req, res) => res.json({ ok: true }));
        return new Promise((resolve) => {
            const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
        });
    }

    it('31st request in a minute from the same user is 429 { error, code: RATE_LIMITED }; other users are unaffected', async () => {
        const { server, base } = await appWithLimiter(30);
        try {
            const statuses = [];
            for (let i = 0; i < 31; i += 1) {
                const r = await fetch(`${base}/search`, { headers: { 'x-user': '7' } });
                statuses.push(r.status);
                if (i === 30) {
                    expect(await r.json()).toEqual({ error: 'Too many catalogue searches. Please slow down.', code: RATE_LIMITED_CODE });
                    expect(r.headers.get('ratelimit-limit')).toBe('30');
                }
            }
            expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
            expect(statuses[30]).toBe(429);
            // Keyed by user, not IP: user 8 on the same loopback IP still gets through.
            const other = await fetch(`${base}/search`, { headers: { 'x-user': '8' } });
            expect(other.status).toBe(200);
        } finally {
            await new Promise((r) => server.close(r));
        }
    });
});

