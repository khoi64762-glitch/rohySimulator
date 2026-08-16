// Regression lock: posterior body-map coordinates were traced in a letterboxed editor
//
// The corrected coordinates only reach a browser if the viewer stops
// trusting an unversioned `rohy_bodymap_regions` cache. This pins the
// stale-discard behaviour of the shared cache helper.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    REGIONS_STORAGE_KEY,
    REGIONS_CACHE_VERSION,
    readCachedRegions,
    writeCachedRegions,
    clearCachedRegions,
} from './bodymapRegionsCache';

const sample = { anterior: { male: { chest: { id: 'chest', points: [[1, 1]] } } } };

beforeEach(() => localStorage.clear());

describe('bodymapRegionsCache', () => {
    it('round-trips a regions tree under the current version stamp', () => {
        writeCachedRegions(sample);
        const raw = JSON.parse(localStorage.getItem(REGIONS_STORAGE_KEY));
        expect(raw.version).toBe(REGIONS_CACHE_VERSION);
        expect(readCachedRegions()).toEqual(sample);
    });

    it('discards the legacy unversioned payload (bare regions tree) and clears the key', () => {
        // Exactly what every pre-fix browser has parked under the key.
        localStorage.setItem(REGIONS_STORAGE_KEY, JSON.stringify(sample));
        expect(readCachedRegions()).toBeNull();
        expect(localStorage.getItem(REGIONS_STORAGE_KEY)).toBeNull();
    });

    it('discards a payload stamped with an older version', () => {
        localStorage.setItem(REGIONS_STORAGE_KEY, JSON.stringify({ version: REGIONS_CACHE_VERSION - 1, regions: sample }));
        expect(readCachedRegions()).toBeNull();
        expect(localStorage.getItem(REGIONS_STORAGE_KEY)).toBeNull();
    });

    it('treats unparseable JSON like a stale copy', () => {
        localStorage.setItem(REGIONS_STORAGE_KEY, '{not json');
        expect(readCachedRegions()).toBeNull();
        expect(localStorage.getItem(REGIONS_STORAGE_KEY)).toBeNull();
    });

    it('returns null when nothing is cached and clear() is a no-op', () => {
        expect(readCachedRegions()).toBeNull();
        clearCachedRegions();
        expect(readCachedRegions()).toBeNull();
    });
});
