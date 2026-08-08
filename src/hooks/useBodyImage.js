import { useMemo, useState } from 'react';
import { baseUrl } from '../config/api';

// Regression lock: body-image upload wrote to unserved public/ root (bug report 2.9.15 #13)
//
// Admin-uploaded body silhouettes land at /uploads/bodymap/<type>.(png|svg)
// (served by the /uploads static mount in server/server.js); the bundled
// defaults ship with the SPA at /<type>.png. A reader can't know whether an
// upload exists or which extension it used, so the <img> walks a candidate
// list via onError: uploaded .png → uploaded .svg → bundled default.
//
// `version` is a cache-buster: bump it after a successful upload so an
// already-mounted preview refetches instead of repainting the cached old
// image (the default 0 keeps the URL stable for plain readers).

/**
 * Resolve the silhouette image for a body-map type with upload-first fallback.
 *
 * @param {('man-front'|'man-back'|'woman-front'|'woman-back')} type body image slot
 * @param {number} [version=0] cache-buster; change it to force a refetch
 * @returns {{src: string, onError: Function}} spread onto an <img>: current
 *   candidate URL plus the error handler that advances to the next fallback
 */
export function useBodyImage(type, version = 0) {
    const candidates = useMemo(() => [
        baseUrl(`/uploads/bodymap/${type}.png?v=${version}`),
        baseUrl(`/uploads/bodymap/${type}.svg?v=${version}`),
        baseUrl(`/${type}.png`),
    ], [type, version]);
    const [candidateIndex, setCandidateIndex] = useState(0);

    // New type or version restarts the probe from the uploaded image —
    // render-time derived-state reset (not an effect) per React guidance.
    const [prevCandidates, setPrevCandidates] = useState(candidates);
    if (prevCandidates !== candidates) {
        setPrevCandidates(candidates);
        setCandidateIndex(0);
    }

    return {
        src: candidates[Math.min(candidateIndex, candidates.length - 1)],
        onError: () => setCandidateIndex((i) => Math.min(i + 1, candidates.length - 1)),
    };
}

export default useBodyImage;
