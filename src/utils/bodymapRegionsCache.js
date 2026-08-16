// localStorage fast-path for the body-map polygon regions, shared by the
// viewer (BodyMap.jsx) and the editor (BodyMapDebug.jsx).
//
// Regression lock: posterior body-map coordinates were traced in a
// letterboxed editor. The corrected numbers ship in defaultRegions.js and
// public/bodymap-regions.json, but the viewer used to trust whatever sat
// under `rohy_bodymap_regions` forever and never re-validated it, so every
// browser that had ever opened the exam room kept the stale polygons. The
// cache is therefore version-stamped: a payload whose version does not
// match REGIONS_CACHE_VERSION is discarded and the server file
// (GET /bodymap-regions) becomes the source again.
//
// Bump REGIONS_CACHE_VERSION whenever the shipped default coordinates
// change in a way that must reach already-primed browsers.

export const REGIONS_STORAGE_KEY = 'rohy_bodymap_regions';
export const REGIONS_CACHE_VERSION = 2;

/**
 * Read the cached regions.
 * @returns {object|null} the regions tree, or null when absent / stale / unreadable
 */
export function readCachedRegions() {
    let raw = null;
    try {
        raw = localStorage.getItem(REGIONS_STORAGE_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === REGIONS_CACHE_VERSION && parsed.regions) {
            return parsed.regions;
        }
    } catch {
        // fall through: unreadable is treated exactly like stale
    }
    clearCachedRegions();
    return null;
}

/**
 * Cache a regions tree under the current version stamp.
 * @param {object} regions the full { anterior, posterior } tree
 */
export function writeCachedRegions(regions) {
    try {
        localStorage.setItem(
            REGIONS_STORAGE_KEY,
            JSON.stringify({ version: REGIONS_CACHE_VERSION, regions })
        );
    } catch {
        // quota / privacy mode: the server copy is still authoritative
    }
}

/** Drop the cached copy (used by the editor's reset and by stale-discard). */
export function clearCachedRegions() {
    try {
        localStorage.removeItem(REGIONS_STORAGE_KEY);
    } catch {
        // nothing to clear
    }
}
