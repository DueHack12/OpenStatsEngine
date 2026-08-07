import football from './football.js';
import basketball from './basketball.js';
import hockey from './hockey.js';
import soccer from './soccer.js';
import lacrosse from './lacrosse.js';
import baseball from './baseball.js';

export const SPORTS = { football, basketball, hockey, soccer, lacrosse, baseball };

export function getSport(id) {
  const s = SPORTS[id];
  if (!s) throw new Error(`Unknown sport: ${id}`);
  return s;
}

/** Trimmed definition sent to the browser so the UI can render itself. */
export function sportManifest(s) {
  return {
    id: s.id,
    name: s.name,
    periods: s.periods,
    clockCountsDown: s.clockCountsDown !== false,
    hasClock: s.hasClock !== false,
    hasPossession: !!s.hasPossession,
    hasCount: !!s.hasCount,
    auxClock: s.auxClock
      ? { key: s.auxClock.key, label: s.auxClock.label, presets: s.auxClock.presets,
          defaultMs: s.auxClock.defaultMs, linkedToGameClock: !!s.auxClock.linkedToGameClock }
      : null,
    trackDownDistance: !!s.trackDownDistance,
    palette: s.palette,
    playerStatTables: s.playerStatTables.map((t) => ({ key: t.key, label: t.label, cols: t.cols })),
    teamStatRows: s.teamStatRows,
    leaderCategories: s.leaderCategories.map((c) => ({ key: c.key, label: c.label, sort: c.sort }))
  };
}

export function listSports() {
  return Object.values(SPORTS).map((s) => ({ id: s.id, name: s.name }));
}
