// RxNorm (NLM RxNav) search proxy.
//
// Upstream: https://rxnav.nlm.nih.gov/REST/
// License: Public domain (NLM). Free, no auth needed, generous limits.
//
// Endpoints used:
//   /approximateTerm.json?term=<q>&maxEntries=<n>   — fuzzy name search
//   /rxcui/<rxcui>/properties.json                  — canonical name + tty
//
// Why approximateTerm over /drugs.json:
//   /drugs.json is exact-match on a single name. approximateTerm returns
//   ranked suggestions for typeahead-style search ("aspir" → Aspirin),
//   which is what the catalogue Search tab wants. /drugs.json fits
//   "I have a confirmed name, give me the variants" — useful later for
//   normalization, not for search.
//
// approximateTerm has two gaps the Treatments library needs closed:
//   1. `name` is null for candidates sourced from some vocabularies (GS,
//      NDDF, …) — for "ceftriaxone" the top-ranked candidate for rxcui
//      2193 carries no name at all, so the ingredient hit rendered as "".
//   2. It never returns the term type (IN / SCD / SBD …), which is what
//      lets a UI put ingredients ahead of dose-form rows.
// Both come from /rxcui/{id}/properties.json, so searchRxNorm enriches
// the top ENRICH_CAP hits from that endpoint (parallel, per-hit failures
// tolerated, 24h cached per rxcui via proxyCache). Added response fields
// are strictly additive: `tty` and `name_source`.
//
// The proxy does NOT mutate the DB. A search hit is a transient suggestion;
// only when the user clicks "Add to my catalogue" does the route layer
// INSERT a medications row. That's intentional — we don't want every
// keystroke to inflate medications with throwaway rows.

import { cacheGet, cacheSet, getFetch } from './proxyCache.js';

const NAMESPACE = 'rxnorm';
const RXNAV_BASE = 'https://rxnav.nlm.nih.gov/REST';

// How many hits per search get a /properties round-trip. Beyond the cap a
// hit keeps whatever approximateTerm gave it (tty null). Lookups are cached
// 24h per rxcui, so repeated typeahead prefixes converge on zero extra calls.
export const ENRICH_CAP = 10;

// Term-type ordering for the search list: ingredients first (that is what a
// treatment_effects row names), then clinical/branded dose forms, then the
// rest (brand names, components, unknown). Score orders inside each group.
const TTY_GROUP = {
    IN: 0, MIN: 0,
    SCD: 1, SBD: 1, SCDF: 1, SBDF: 1, SCDG: 1, SBDG: 1, GPCK: 1, BPCK: 1,
};
export function ttyRank(tty) {
    if (!tty) return 2;
    const rank = TTY_GROUP[String(tty).toUpperCase()];
    return rank === undefined ? 2 : rank;
}

function normHit(candidate) {
    const name = candidate.name || candidate.candidate || '';
    return {
        external_source: 'rxnorm',
        external_id: candidate.rxcui || null,
        rxcui: candidate.rxcui || null,
        display_name: name,
        score: typeof candidate.score === 'string' ? Number(candidate.score) : (candidate.score ?? null),
        synonym: candidate.synonym || null,
        tty: null,
        name_source: name ? 'approximateTerm' : null,
    };
}

// Fill display_name / tty from /properties for the top hits. Never throws:
// a hit whose lookup fails keeps its approximateTerm fields.
async function enrichHits(hits, { signal } = {}) {
    const targets = hits.filter((h) => h.rxcui && (!h.display_name || !h.tty)).slice(0, ENRICH_CAP);
    if (targets.length === 0) return hits;
    const props = await Promise.all(
        targets.map((h) => lookupRxCui(h.rxcui, { signal }).catch(() => null))
    );
    const byRxcui = new Map(targets.map((h, i) => [h.rxcui, props[i]]));
    return hits.map((h) => {
        const p = byRxcui.get(h.rxcui);
        if (!p) return h;
        const filledName = !h.display_name && p.name;
        return {
            ...h,
            display_name: filledName ? p.name : h.display_name,
            name_source: filledName ? 'properties' : h.name_source,
            synonym: h.synonym || p.synonym || null,
            tty: p.tty || h.tty,
        };
    });
}

function sortHits(hits) {
    return hits
        .map((h, i) => ({ h, i }))
        .sort((a, b) => {
            const g = ttyRank(a.h.tty) - ttyRank(b.h.tty);
            if (g !== 0) return g;
            const s = (b.h.score ?? -Infinity) - (a.h.score ?? -Infinity);
            if (s !== 0) return s;
            return a.i - b.i;
        })
        .map(({ h }) => h);
}

export async function searchRxNorm(query, { limit = 20, signal } = {}) {
    const q = (query || '').trim();
    if (!q) return [];
    const cacheKey = `q:${q.toLowerCase()}:${limit}`;
    const cached = cacheGet(NAMESPACE, cacheKey);
    if (cached) return cached;

    const fetchFn = getFetch();
    if (!fetchFn) throw new Error('rxnormProxy: global fetch unavailable');

    const url = `${RXNAV_BASE}/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=${limit}`;
    const res = await fetchFn(url, { signal });
    if (!res.ok) {
        throw new Error(`RxNav approximateTerm failed: HTTP ${res.status}`);
    }
    const body = await res.json();
    const candidates = body?.approximateGroup?.candidate || [];
    // De-dup on rxcui — RxNav frequently returns the same drug under
    // multiple synonyms (and unnamed vocabulary rows). Keep the highest
    // score per rxcui; on a tie prefer the candidate that carries a name.
    const byRxcui = new Map();
    for (const c of candidates) {
        const key = c.rxcui || `name:${c.name}`;
        const existing = byRxcui.get(key);
        const better = !existing
            || Number(c.score) > Number(existing.score)
            || (Number(c.score) === Number(existing.score) && !existing.name && !!c.name);
        if (better) byRxcui.set(key, c);
    }
    const raw = Array.from(byRxcui.values()).map(normHit);
    const hits = sortHits(await enrichHits(raw, { signal }));
    cacheSet(NAMESPACE, cacheKey, hits);
    return hits;
}

export async function lookupRxCui(rxcui, { signal } = {}) {
    if (!rxcui) return null;
    const cacheKey = `rxcui:${rxcui}`;
    const cached = cacheGet(NAMESPACE, cacheKey);
    if (cached) return cached;
    const fetchFn = getFetch();
    if (!fetchFn) throw new Error('rxnormProxy: global fetch unavailable');
    const url = `${RXNAV_BASE}/rxcui/${encodeURIComponent(rxcui)}/properties.json`;
    const res = await fetchFn(url, { signal });
    if (!res.ok) return null;
    const body = await res.json();
    const props = body?.properties || null;
    if (!props) return null;
    const out = {
        rxcui: props.rxcui,
        name: props.name,
        synonym: props.synonym || null,
        tty: props.tty || null,
    };
    cacheSet(NAMESPACE, cacheKey, out);
    return out;
}
