// Wall-clock anchoring for the session clock and the scenario timeline.
//
// PatientMonitor unmounts on every room switch (App.jsx renders it only in
// the chat room), so any state held as a plain counter dies with it. The
// session clock and the scenario timeline are therefore anchored to wall-
// clock timestamps: ticks *recompute* time from the anchor instead of
// incrementing, which makes remounts, page refreshes, and background-tab
// timer throttling all land on the same, correct time.
//
// The scenario anchor is persisted to localStorage keyed by sessionId so a
// refresh resumes the trajectory where it really is, not at t=0.

// SQLite stores DATETIME as 'YYYY-MM-DD HH:MM:SS' in UTC with no zone
// marker; JS would parse that as local time. Force UTC unless the string
// already carries a zone.
export const parseUtcTimestamp = (ts) => {
   if (!ts) return null;
   const s = String(ts);
   const iso = s.includes('T') ? s : s.replace(' ', 'T');
   const zoned = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
   const ms = Date.parse(zoned);
   return Number.isFinite(ms) ? ms : null;
};

export const SCENARIO_ANCHOR_KEY = 'rohy_scenario_anchor';

// Anchor shape: { sessionId, scenarioId, startMs, offsetSec, playing }.
// Returns the saved anchor only when it belongs to the given session.
export const readScenarioAnchor = (sessionId) => {
   try {
      const raw = localStorage.getItem(SCENARIO_ANCHOR_KEY);
      if (!raw) return null;
      const anchor = JSON.parse(raw);
      return anchor && sessionId != null && anchor.sessionId === sessionId ? anchor : null;
   } catch {
      return null;
   }
};

export const writeScenarioAnchor = (anchor) => {
   try {
      if (anchor) localStorage.setItem(SCENARIO_ANCHOR_KEY, JSON.stringify(anchor));
      else localStorage.removeItem(SCENARIO_ANCHOR_KEY);
   } catch { /* storage full/blocked — anchor just won't survive a refresh */ }
};

// Current position (seconds) of an anchored scenario. While playing, time
// flows from startMs; paused, it holds at offsetSec.
export const anchorSeconds = (anchor) =>
   anchor.playing ? anchor.offsetSec + (Date.now() - anchor.startMs) / 1000 : anchor.offsetSec;
