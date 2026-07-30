import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import OyonServerDashboards from './OyonServerDashboards';

/*
 * The named "Oyon" dashboard — a first-class full-page surface for educators
 * and admins, distinct from the Emotion Analytics route.
 *
 * The difference matters. Emotion Analytics is Rohy's OWN dashboard
 * (TnaDashboard preset to the emotion source, with Rohy-authored Attention /
 * Affect / Gaze tabs). This surface renders OYON's own Analyze dashboards, via
 * OyonServerDashboards → <oyon-app chrome="none" page="/analyze">. Two
 * consequences:
 *
 *   - Nothing here duplicates or replaces an existing Rohy tab. This is
 *     additive: a new surface beside the existing ones.
 *   - As new modalities start producing data, the upstream dashboards for them
 *     appear here without Rohy authoring a view per signal. The engine owns its
 *     own presentation; Rohy owns authorization and the data feed.
 *
 * Authorization stays entirely server-side: this component only calls Rohy's
 * API (educator+ scoped by assertOyonReadAccess), and hands the resulting rows
 * to the element via setWindows(). The element never talks to the API itself.
 */

const PAGE = 200;
const CAP = 1000;

export default function OyonDashboardRoom({ onClose }) {
   const { t } = useTranslation('app');
   const [records, setRecords] = useState(null);
   const [modalities, setModalities] = useState([]);
   const [truncated, setTruncated] = useState(false);
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState(null);

   // Emotion windows: the pool Oyon's Analyze dashboards consume. Paginated and
   // capped, mirroring TnaDashboardV2's fetch so both surfaces put the same
   // ceiling on a large tenant.
   // Mount-only, so the initial `loading: true` / `error: null` state already
   // describes the pre-fetch condition — no synchronous setState needed here.
   useEffect(() => {
      let cancelled = false;
      (async () => {
         try {
            const all = [];
            let offset = 0;
            let total = Infinity;
            while (offset < total && all.length < CAP) {
               const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
               const d = await apiFetch(`/addons/oyon/emotion-records?${params}`);
               const rows = d?.records || [];
               all.push(...rows);
               total = Number.isFinite(d?.total) ? d.total : all.length;
               if (rows.length < PAGE) break;
               offset += PAGE;
            }
            if (!cancelled) {
               setRecords(all);
               setTruncated(all.length >= CAP && total > all.length);
            }
         } catch (err) {
            if (!cancelled) setError(err?.message || String(err));
         } finally {
            if (!cancelled) setLoading(false);
         }
      })();
      return () => { cancelled = true; };
   }, []);

   // Which modality-scoped signals this tenant actually has (migration 0039).
   // Advisory only — a failure here must not blank the dashboard, so it never
   // touches `error`.
   useEffect(() => {
      let cancelled = false;
      apiFetch('/addons/oyon/signal-windows?limit=1')
         .then((d) => { if (!cancelled) setModalities(d?.modalities || []); })
         .catch(() => { /* advisory chips only */ });
      return () => { cancelled = true; };
   }, []);

   const totalSignals = useMemo(
      () => modalities.reduce((sum, m) => sum + (Number(m.count) || 0), 0),
      [modalities]
   );

   return (
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-950">
         <header className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 shrink-0">
            <h1 className="text-sm font-semibold text-slate-100">{t('oyon_dashboard')}</h1>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
            {records && (
               <span className="text-xs text-slate-400">
                  {t('oyon_dashboard_window_count', { count: records.length })}
                  {truncated ? ` · ${t('oyon_dashboard_truncated')}` : ''}
               </span>
            )}
            {totalSignals > 0 && (
               <span className="flex items-center gap-1 flex-wrap">
                  {modalities.map(m => (
                     <span
                        key={m.modality}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300"
                     >
                        {m.modality} · {m.count}
                     </span>
                  ))}
               </span>
            )}
            <button
               type="button"
               onClick={onClose}
               className="ml-auto p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
               aria-label={t('close')}
            >
               <X className="w-4 h-4" />
            </button>
         </header>

         {error ? (
            <div className="m-4 rounded-md border border-red-500/30 bg-red-950/40 px-3 py-3 text-sm text-red-200">
               <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {t('oyon_dashboard_load_failed')}
               </div>
               <div className="mt-1 text-red-300/80">{error}</div>
            </div>
         ) : (
            <div className="flex-1 min-h-0">
               <OyonServerDashboards records={records || []} loading={loading} />
            </div>
         )}
      </div>
   );
}
