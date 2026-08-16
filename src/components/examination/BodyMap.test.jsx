// Regression lock: posterior body-map coordinates were traced in a letterboxed editor
//
// The viewer used to return early on ANY `rohy_bodymap_regions` value and
// never re-validate it, so browsers that had ever opened the exam room
// kept the mis-traced posterior polygons forever. It must discard a
// legacy (unversioned) cache, take the server file, and re-cache it under
// the current version stamp.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import defaultRegions from '../../utils/defaultRegions';
import { REGIONS_STORAGE_KEY, REGIONS_CACHE_VERSION } from '../../utils/bodymapRegionsCache';

const apiFetchMock = vi.fn();
vi.mock('../../services/apiClient', () => ({
    apiFetch: (...args) => apiFetchMock(...args),
}));

import BodyMap from './BodyMap';

// A deliberately different tree so we can tell which source the viewer used.
const serverRegions = JSON.parse(JSON.stringify(defaultRegions));
serverRegions.posterior.female.handLeft.points = [[1, 50], [9, 50], [9, 58], [1, 58]];
const legacyRegions = JSON.parse(JSON.stringify(defaultRegions));
legacyRegions.posterior.female.handLeft.points = [[14, 50], [28, 50], [26, 58], [16, 58]];

const handLeftPolygon = (container) => {
    const polys = Array.from(container.querySelectorAll('polygon'));
    return polys.find((p) => p.getAttribute('points') === serverRegions.posterior.female.handLeft.points.map(([x, y]) => `${x},${y}`).join(' '))
        || polys.find((p) => p.getAttribute('points') === legacyRegions.posterior.female.handLeft.points.map(([x, y]) => `${x},${y}`).join(' '));
};

beforeEach(() => {
    apiFetchMock.mockReset();
});

describe('BodyMap — versioned regions cache', () => {
    it('discards a legacy unversioned localStorage copy, fetches the server file and re-caches it stamped', async () => {
        localStorage.setItem(REGIONS_STORAGE_KEY, JSON.stringify(legacyRegions));
        apiFetchMock.mockResolvedValue({ regions: serverRegions });

        const { container } = render(
            <BodyMap view="posterior" gender="female" selectedRegion={null} onRegionClick={() => {}} />
        );

        await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/bodymap-regions', { auth: false }));
        await waitFor(() => {
            expect(handLeftPolygon(container).getAttribute('points')).toBe('1,50 9,50 9,58 1,58');
        });
        const cached = JSON.parse(localStorage.getItem(REGIONS_STORAGE_KEY));
        expect(cached.version).toBe(REGIONS_CACHE_VERSION);
        expect(cached.regions.posterior.female.handLeft.points).toEqual([[1, 50], [9, 50], [9, 58], [1, 58]]);
    });

    it('trusts a current-version cache and does not call the server', async () => {
        localStorage.setItem(REGIONS_STORAGE_KEY, JSON.stringify({ version: REGIONS_CACHE_VERSION, regions: serverRegions }));
        const { container } = render(
            <BodyMap view="posterior" gender="female" selectedRegion={null} onRegionClick={() => {}} />
        );
        await act(async () => {});
        expect(apiFetchMock).not.toHaveBeenCalled();
        expect(handLeftPolygon(container).getAttribute('points')).toBe('1,50 9,50 9,58 1,58');
    });
});
