// Tiny TTL-keyed Map shared by the three search proxies (RxNorm, openFDA,
// LOINC). One module so the cache is process-wide; each proxy passes a
// namespace prefix to avoid key collisions.
//
// Why not Redis / disk? The whole point of a 24h cache is to soften
// upstream rate limits during a single deploy lifecycle. Survives across
// requests, dies with the process. If the operator restarts, the next
// search refreshes — that's correct behaviour for "pinned snapshot"
// thinking. A persistent cache would silently keep stale data alive.
//
// Eviction: lazy on read, plus a hard bound on insert. The cleanup interval
// is intentionally absent — adding a setInterval here would also prevent
// process exit in tests (this file is imported by routes, which is imported
// by tests). Instead, when an insert would push the store past
// CACHE_MAX_ENTRIES, expired entries are swept first and, if that is not
// enough, the oldest-inserted live entries go — a Map iterates in insertion
// order, and a re-set key is deleted first so it moves to the back. Without
// the bound every distinct typeahead prefix and every enriched rxcui stayed
// resident for 24h: an authenticated client could grow the process heap
// without limit by searching random strings.

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const CACHE_MAX_ENTRIES = 2000;

const store = new Map();

function sweepExpired(now = Date.now()) {
    for (const [key, entry] of store) {
        if (now > entry.expiresAt) store.delete(key);
    }
}

function evictOldest(target) {
    for (const key of store.keys()) {
        if (store.size < target) break;
        store.delete(key);
    }
}

export function cacheGet(namespace, key) {
    const composite = `${namespace}::${key}`;
    const entry = store.get(composite);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        store.delete(composite);
        return undefined;
    }
    return entry.value;
}

export function cacheSet(namespace, key, value, ttlMs = DEFAULT_TTL_MS) {
    const composite = `${namespace}::${key}`;
    // Delete-then-set so a refreshed key counts as newest for eviction order.
    store.delete(composite);
    if (store.size >= CACHE_MAX_ENTRIES) {
        sweepExpired();
        if (store.size >= CACHE_MAX_ENTRIES) evictOldest(CACHE_MAX_ENTRIES);
    }
    store.set(composite, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheClear(namespace) {
    if (!namespace) {
        store.clear();
        return;
    }
    const prefix = `${namespace}::`;
    for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
    }
}

export function cacheStats() {
    return {
        size: store.size,
        keys: Array.from(store.keys()).map((k) => k.split('::', 2)[0]).reduce((acc, ns) => {
            acc[ns] = (acc[ns] || 0) + 1;
            return acc;
        }, {}),
    };
}

// ---- Upstream request budget -----------------------------------------------
//
// Upper bound for any single upstream round-trip (RxNav approximateTerm or
// properties, openFDA, Clinical Tables). Typeahead that takes longer than
// this is useless to the user anyway; the route reports the timeout as a
// per-source error. Every proxy fetch carries the caller's signal (the HTTP
// route aborts it when the client goes away) joined with this budget, so a
// stalled upstream can neither pin the request nor keep enrichment fetches
// alive after the response is done. AbortSignal.any / .timeout are Node 20+.
export const DEFAULT_TIMEOUT_MS = 4000;

export function upstreamSignal(signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const budget = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, budget]) : budget;
}

// Allow tests / dev to inject a mock fetcher.
let _fetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
export function setFetch(fn) { _fetch = fn; }
export function getFetch() { return _fetch; }
