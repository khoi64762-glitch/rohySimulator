// Regression lock: posterior body-map coordinates were traced in a letterboxed editor
//
// BodyMapDebug used to draw the silhouette PNG with object-contain inside
// a fixed 500x900 box while its SVG overlay filled the whole box. The
// posterior PNGs (~0.43 w/h) were letterboxed ~12% on each side, so every
// posterior vertex was stored in letterbox space. The viewer sizes its box
// to the image's real ratio, so arms/forearms/hands landed on the torso.
//
// The x-ranges below were measured directly on public/woman-back.png
// (silhouette pixel runs at the polygon centroid rows). If a future
// re-trace moves a limb back onto the torso, this fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import defaultRegions from './defaultRegions';

const TOLERANCE = 3;

// Measured silhouette x-extents (percent of image width) on woman-back.png.
const FEMALE_POSTERIOR_LIMB_BOUNDS = {
    upperArmLeft: [19, 30],
    forearmLeft: [14, 29],
    handLeft: [4, 20],
    upperArmRight: [69, 81],
    forearmRight: [69, 86],
    handRight: [80, 95],
};

const xRange = (points) => {
    const xs = points.map(([x]) => x);
    return [Math.min(...xs), Math.max(...xs)];
};

describe('defaultRegions — posterior female limbs sit on the silhouette', () => {
    Object.entries(FEMALE_POSTERIOR_LIMB_BOUNDS).forEach(([regionKey, [minX, maxX]]) => {
        it(`posterior.female.${regionKey} x-range is within [${minX}, ${maxX}] ±${TOLERANCE}`, () => {
            const region = defaultRegions.posterior.female[regionKey];
            expect(region, `region ${regionKey} missing`).toBeTruthy();
            const [lo, hi] = xRange(region.points);
            expect(lo).toBeGreaterThanOrEqual(minX - TOLERANCE);
            expect(hi).toBeLessThanOrEqual(maxX + TOLERANCE);
        });
    });

    it('left-side limbs stay left of centre and right-side limbs right of centre (never on the torso)', () => {
        const female = defaultRegions.posterior.female;
        ['upperArmLeft', 'forearmLeft', 'handLeft'].forEach((k) => {
            expect(xRange(female[k].points)[1]).toBeLessThan(35);
        });
        ['upperArmRight', 'forearmRight', 'handRight'].forEach((k) => {
            expect(xRange(female[k].points)[0]).toBeGreaterThan(65);
        });
    });

    it('every coordinate stays inside the 0-100 viewBox', () => {
        Object.values(defaultRegions).forEach((view) => {
            Object.values(view).forEach((gender) => {
                Object.values(gender).forEach((region) => {
                    region.points.forEach(([x, y]) => {
                        expect(x).toBeGreaterThanOrEqual(0);
                        expect(x).toBeLessThanOrEqual(100);
                        expect(y).toBeGreaterThanOrEqual(0);
                        expect(y).toBeLessThanOrEqual(100);
                    });
                });
            });
        });
    });
});

describe('public/bodymap-regions.json mirrors defaultRegions', () => {
    it('the server-served file deep-equals the bundled defaults', () => {
        const file = resolve(process.cwd(), 'public/bodymap-regions.json');
        const served = JSON.parse(readFileSync(file, 'utf8'));
        expect(served).toEqual({ regions: defaultRegions });
    });
});
