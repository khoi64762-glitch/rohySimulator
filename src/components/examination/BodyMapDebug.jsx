import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import DEFAULT_REGIONS from '../../utils/defaultRegions';
import { apiFetch, apiPost } from '../../services/apiClient';
import { useBodyImage } from '../../hooks/useBodyImage';
import { useToast } from '../../contexts/ToastContext';
import { mapRegionLabel } from './examinationLabels';
import { readCachedRegions, writeCachedRegions, clearCachedRegions } from '../../utils/bodymapRegionsCache';

// Editor canvas height in CSS px; the width follows the silhouette's real
// aspect ratio (see below), never a fixed 500x900 box.
const CANVAS_HEIGHT_PX = 900;

// width / height seeds per view so the first paint is already close before
// onLoad measures the exact PNG — same seeds as BodyMap.jsx.
const DEFAULT_RATIO = { anterior: 429 / 791, posterior: 438 / 1022 };

/**
 * Body Map Debug Tool with Draggable Vertices
 * Click and drag polygon vertices to adjust regions
 * Changes are saved to localStorage and server
 *
 * Regression lock: posterior body-map coordinates were traced in a
 * letterboxed editor. The old editor drew the PNG with object-contain
 * inside a hardcoded 500x900 box while the SVG overlay filled the whole
 * box, so on the narrow posterior silhouettes (~0.43 w/h) the image was
 * letterboxed ~12% on each side and every vertex traced there was stored
 * in letterbox space, not image space. The viewer (BodyMap.jsx) sizes its
 * box to the image's intrinsic ratio, so those polygons landed on the
 * torso instead of the arms. The editor now uses the same
 * intrinsic-ratio container as the viewer: SVG-% == image-% in both.
 */
export default function BodyMapDebug({ gender = 'male', view = 'anterior' }) {
    const { t } = useTranslation('examination');
    const toast = useToast();
    const [clickCoords, setClickCoords] = useState(null);
    const [showGrid, setShowGrid] = useState(true);
    const [showRegions, setShowRegions] = useState(true);
    const [selectedRegion, setSelectedRegion] = useState(null);
    const [draggingVertex, setDraggingVertex] = useState(null);
    const [saveStatus, setSaveStatus] = useState(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [imgRatio, setImgRatio] = useState(null);
    const svgRef = useRef(null);

    // Load saved regions from the (version-stamped) localStorage cache or use defaults
    const [regions, setRegions] = useState(() => {
        const cached = readCachedRegions();
        return cached || JSON.parse(JSON.stringify(DEFAULT_REGIONS));
    });

    // Try loading from server on mount if no (current-version) localStorage data
    useEffect(() => {
        if (readCachedRegions()) return;
        apiFetch('/bodymap-regions', { auth: false })
            .then(data => {
                if (data?.regions) {
                    setRegions(data.regions);
                    writeCachedRegions(data.regions);
                }
            })
            .catch(err => console.warn('Failed to load from server:', err));
    }, []);

    const currentRegions = regions[view]?.[gender] || regions.anterior.male;

    // Admin-uploaded silhouette first, bundled default as fallback (bug report 2.9.15 #13).
    const bodyImageType = `${gender === 'female' ? 'woman' : 'man'}-${view === 'posterior' ? 'back' : 'front'}`;
    const { src: bodyImageSrc, onError: onBodyImageError } = useBodyImage(bodyImageType);

    // Drop the measured ratio whenever the image changes so the previous
    // view's ratio can't briefly distort the new one before it loads —
    // render-time derived-state reset (not an effect) per React guidance.
    const [ratioSrc, setRatioSrc] = useState(bodyImageSrc);
    if (ratioSrc !== bodyImageSrc) {
        setRatioSrc(bodyImageSrc);
        setImgRatio(null);
    }

    const effectiveRatio = Number((imgRatio || DEFAULT_RATIO[view] || DEFAULT_RATIO.anterior).toFixed(4));
    const canvasWidthPx = Math.round(CANVAS_HEIGHT_PX * effectiveRatio);

    const getSvgCoords = (e) => {
        const svg = svgRef.current;
        if (!svg) return { x: 0, y: 0 };
        const rect = svg.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width * 100);
        const y = ((e.clientY - rect.top) / rect.height * 100);
        return { x, y };
    };

    const handleSvgClick = (e) => {
        if (draggingVertex) return;
        const { x, y } = getSvgCoords(e);
        setClickCoords({ x: x.toFixed(1), y: y.toFixed(1) });
    };

    const handleVertexMouseDown = (regionKey, vertexIndex, e) => {
        e.stopPropagation();
        setDraggingVertex({ regionKey, vertexIndex });
        setSelectedRegion(regionKey);
    };

    const handleMouseMove = (e) => {
        if (!draggingVertex) return;
        const { x, y } = getSvgCoords(e);
        const { regionKey, vertexIndex } = draggingVertex;

        setRegions(prev => {
            const newRegions = JSON.parse(JSON.stringify(prev));
            newRegions[view][gender][regionKey].points[vertexIndex] = [Math.round(x), Math.round(y)];
            return newRegions;
        });
        setHasChanges(true);
    };

    const handleMouseUp = () => {
        setDraggingVertex(null);
    };

    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [draggingVertex, view, gender]);

    const pointsToString = (points) => points.map(([x, y]) => `${x},${y}`).join(' ');

    // Save to localStorage and server
    const saveChanges = async () => {
        setSaveStatus('saving');
        try {
            // Save to localStorage immediately (version-stamped, see bodymapRegionsCache.js)
            writeCachedRegions(regions);

            // Also save to server for persistence. Pre-fix this gated on
            // AuthService.getToken() — but cookie-mode users have no
            // localStorage token, so the gate evaluated false and the
            // server save was silently skipped. apiPost handles auth
            // centrally (cookie or bearer); if the user genuinely isn't
            // authed, the 401 lands in catch() and we surface saved-local.
            await apiPost('/bodymap-regions', { regions });

            setSaveStatus('saved');
            setHasChanges(false);
            setTimeout(() => setSaveStatus(null), 2000);
        } catch (err) {
            console.error('Failed to save to server:', err);
            // Still saved to localStorage
            setSaveStatus('saved-local');
            setHasChanges(false);
            setTimeout(() => setSaveStatus(null), 3000);
        }
    };

    // Reset to defaults
    const resetToDefaults = async () => {
        const ok = await toast.confirm(t('bodymap_editor_reset_confirm'), { type: 'danger' });
        if (!ok) return;
        setRegions(JSON.parse(JSON.stringify(DEFAULT_REGIONS)));
        clearCachedRegions();
        setHasChanges(false);
        setSaveStatus(null);
    };

    const copyToClipboard = () => {
        const data = JSON.stringify(regions[view][gender], null, 2);
        navigator.clipboard.writeText(data);
        toast.success(t('bodymap_editor_copied_view'));
    };

    const exportAll = () => {
        const data = JSON.stringify(regions, null, 2);
        navigator.clipboard.writeText(data);
        toast.success(t('bodymap_editor_copied_all'));
    };

    const saveLabel = saveStatus === 'saving' ? t('bodymap_editor_saving')
        : saveStatus === 'saved' ? t('bodymap_editor_saved')
        : saveStatus === 'saved-local' ? t('bodymap_editor_saved_local')
        : t('bodymap_editor_save');

    return (
        <div className="p-4 bg-slate-900 min-h-screen">
            {/* Save Bar - Fixed at top */}
            <div className="mb-4 p-3 bg-slate-800 rounded-lg border border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-bold text-white">{t('bodymap_editor_title')}</h1>
                    <span className="text-slate-400">|</span>
                    <span className="text-slate-300">{t('bodymap_editor_subtitle', { gender, view })}</span>
                    {hasChanges && (
                        <span className="px-2 py-1 bg-yellow-600/20 text-yellow-400 text-sm rounded">
                            {t('bodymap_editor_unsaved')}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={resetToDefaults}
                        className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600 transition-colors"
                    >
                        {t('bodymap_editor_reset')}
                    </button>
                    <button
                        onClick={saveChanges}
                        disabled={saveStatus === 'saving'}
                        className={`px-6 py-2 font-bold rounded transition-colors ${
                            hasChanges
                                ? 'bg-green-600 hover:bg-green-500 text-white'
                                : 'bg-slate-600 text-slate-300'
                        } ${saveStatus === 'saving' ? 'opacity-50 cursor-wait' : ''}`}
                    >
                        {saveLabel}
                    </button>
                </div>
            </div>

            <div className="mb-4 flex gap-4 flex-wrap items-center">
                <label className="flex items-center gap-2 text-white">
                    <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                    {t('bodymap_editor_show_grid')}
                </label>
                <label className="flex items-center gap-2 text-white">
                    <input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} />
                    {t('bodymap_editor_show_regions')}
                </label>
                <button
                    onClick={copyToClipboard}
                    className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500"
                >
                    {t('bodymap_editor_copy_view')}
                </button>
                <button
                    onClick={exportAll}
                    className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-500"
                >
                    {t('bodymap_editor_export_all')}
                </button>
                {clickCoords && (
                    <span className="text-yellow-400 font-mono">
                        {t('bodymap_editor_click_coords', { x: clickCoords.x, y: clickCoords.y })}
                    </span>
                )}
                {selectedRegion && (
                    <span className="text-cyan-400 font-mono">
                        {t('bodymap_editor_selected', {
                            region: mapRegionLabel(t, selectedRegion, currentRegions[selectedRegion]?.label)
                        })}
                    </span>
                )}
            </div>

            <p className="text-gray-400 text-sm mb-4">
                {t('bodymap_editor_drag_hint')}
            </p>

            <div className="flex gap-8">
                {/*
                    Image with overlay. The box takes the PNG's intrinsic
                    aspect ratio (measured on load) so the img fills it
                    edge-to-edge without object-contain letterboxing and the
                    SVG's 0-100 viewBox maps 1:1 onto image percent — exactly
                    what BodyMap.jsx renders in the exam room.
                */}
                <div
                    className="relative"
                    data-testid="bodymap-editor-canvas"
                    style={{ width: `${canvasWidthPx}px`, height: `${CANVAS_HEIGHT_PX}px` }}
                >
                    <img
                        src={bodyImageSrc}
                        onError={onBodyImageError}
                        alt={t('body_alt', { gender, view })}
                        className="absolute inset-0 w-full h-full select-none"
                        draggable={false}
                        onLoad={(e) => {
                            const { naturalWidth: w, naturalHeight: h } = e.target;
                            if (w > 0 && h > 0) setImgRatio(w / h);
                        }}
                    />
                    <svg
                        ref={svgRef}
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        className="absolute inset-0 w-full h-full cursor-crosshair"
                        onClick={handleSvgClick}
                    >
                        {/* Grid */}
                        {showGrid && (
                            <g stroke="rgba(255,255,255,0.2)" strokeWidth="0.2">
                                {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(v => (
                                    <g key={v}>
                                        <line x1={v} y1="0" x2={v} y2="100" />
                                        <line x1="0" y1={v} x2="100" y2={v} />
                                        <text x={v + 0.5} y="3" fill="rgba(255,255,255,0.5)" fontSize="2">{v}</text>
                                        <text x="1" y={v + 1} fill="rgba(255,255,255,0.5)" fontSize="2">{v}</text>
                                    </g>
                                ))}
                            </g>
                        )}

                        {/* Regions */}
                        {showRegions && Object.entries(currentRegions).map(([key, region]) => (
                            <g key={region.id}>
                                <polygon
                                    points={pointsToString(region.points)}
                                    fill={selectedRegion === key ? `${region.color}60` : `${region.color}30`}
                                    stroke={selectedRegion === key ? '#fff' : region.color}
                                    strokeWidth={selectedRegion === key ? '0.8' : '0.4'}
                                    onClick={(e) => { e.stopPropagation(); setSelectedRegion(key); }}
                                    style={{ cursor: 'pointer' }}
                                />
                                <text
                                    x={region.points.reduce((s, p) => s + p[0], 0) / region.points.length}
                                    y={region.points.reduce((s, p) => s + p[1], 0) / region.points.length}
                                    fill="white"
                                    fontSize="2"
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    style={{ pointerEvents: 'none' }}
                                >
                                    {mapRegionLabel(t, region.id || key, region.label)}
                                </text>
                                {/* Draggable vertices */}
                                {selectedRegion === key && region.points.map(([x, y], idx) => (
                                    <circle
                                        key={idx}
                                        cx={x}
                                        cy={y}
                                        r="1.5"
                                        fill="#fff"
                                        stroke={region.color}
                                        strokeWidth="0.5"
                                        style={{ cursor: 'grab' }}
                                        onMouseDown={(e) => handleVertexMouseDown(key, idx, e)}
                                    />
                                ))}
                            </g>
                        ))}
                    </svg>
                </div>

                {/* Region list */}
                <div className="text-white text-sm font-mono max-h-[900px] overflow-auto w-96">
                    <h3 className="font-bold mb-2">{t('bodymap_editor_regions_heading', { gender, view })}</h3>
                    <p className="text-gray-400 text-xs mb-4">{t('bodymap_editor_regions_hint')}</p>
                    {Object.entries(currentRegions).map(([key, region]) => (
                        <div
                            key={key}
                            className={`mb-2 p-2 rounded cursor-pointer ${selectedRegion === key ? 'bg-slate-600 ring-2 ring-white' : 'bg-slate-800 hover:bg-slate-700'}`}
                            onClick={() => setSelectedRegion(key)}
                        >
                            <div style={{ color: region.color }} className="font-bold">{mapRegionLabel(t, region.id || key, region.label)}</div>
                            <div className="text-xs text-slate-400 break-all">
                                {JSON.stringify(region.points)}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
