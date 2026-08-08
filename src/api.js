import fs from 'node:fs';
import { deriveGame } from './engine.js';
import { announcerView } from './announcer.js';
import { getSport, sportManifest, listSports } from './sports/index.js';
import { clockFromEvents, clockNow } from './clock.js';
import { XML_VIEWS, writeXmlFiles } from './vmix.js';
import { boxScoreCSV, teamStatsCSV, playByPlayCSV, scoringCSV, seasonCSV, rosterCSV } from './exports/csv.js';
import { gameReportPDF } from './exports/report.js';
import { parseRosterCSV, importRosterFromURL, importStatsAuto } from './importers/index.js';
import { importTeamsFromSheet } from './importers/sheets.js';
import { localStamp } from './util.js';
import { FEED_FIELDS } from './integrations/scorebot.js';

const raw = (body, type, filename, status = 200) => ({ __raw: true, body, type, filename, status });
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };

export function registerRoutes(route, ctx) {
  const { store, broadcast, scorebot } = ctx;

  /** Stamp an event with the game clock in effect right now, then append. */
  function append(gameId, ev) {
    const meta = store.getGame(gameId) || bad('No such game', 404);
    const sport = getSport(meta.sport);
    const st = clockFromEvents(store.effectiveEvents(gameId), sport, meta.settings || {});
    const full = store.appendEvent(gameId, {
      period: st.period,
      clockMs: Math.round(clockNow(st)),
      ...ev
    });
    touch(gameId);
    return full;
  }

  const xmlTimers = new Map();
  function touch(gameId) {
    broadcast('update', { gameId });
    // Mirror XML to disk on a short debounce so a burst of entries writes once.
    clearTimeout(xmlTimers.get(gameId));
    xmlTimers.set(gameId, setTimeout(() => {
      try { writeXmlFiles(store, deriveGame(store, gameId)); }
      catch (e) { console.error('XML mirror failed:', e.message); }
    }, 250));
  }

  const activeId = () => store.config.activeGameId;

  /* ---------------- config & meta ---------------- */
  route('GET', '/api/config', () => ({
    ...store.config,
    scorebot: { ...store.config.scorebot, sources: scorebot.sources },
    scorebotStatus: scorebot.status,
    scorebotFields: FEED_FIELDS,
    version: '1.1.0'
  }));

  route('POST', '/api/config', ({ body }) => {
    // read the *merged* value, since an unset source still defaults to scorebot
    const before = scorebot.sources.auxClock;
    const cfg = store.updateConfig(body || {});
    const after = scorebot.sources.auxClock;
    // Handing the play/shot clock back to the operator restores auto-reset from
    // logged plays; the feed turns it off again if it takes over later.
    if (before === 'scorebot' && after === 'manual' && cfg.activeGameId) {
      const meta = store.getGame(cfg.activeGameId);
      if (meta && getSport(meta.sport).auxClock) {
        append(cfg.activeGameId, {
          type: 'aux_config', source: 'manual',
          data: { autoReset: true, reason: 'clock returned to manual control' }
        });
      }
    }
    if (cfg.scorebot?.enabled && cfg.activeGameId) scorebot.start(cfg.activeGameId);
    else scorebot.stop();
    return { ...cfg, scorebotStatus: scorebot.status };
  });

  route('GET', '/api/sports', () => listSports());
  route('GET', '/api/sports/:id', ({ params }) => sportManifest(getSport(params.id)));

  /* ---------------- teams & rosters ---------------- */
  route('GET', '/api/teams', () => store.listTeams());
  route('POST', '/api/teams', ({ body }) => {
    if (!body?.name) bad('Team name is required');
    return store.saveTeam(body);
  });
  /**
   * Bulk-create every team from a shared Google Sheet (Validation tab for the
   * roster of schools, Pics tab for colours). Safe to re-run — teams are merged
   * by name, so it refreshes colours and abbreviations without touching rosters
   * or anything already logged.
   */
  route('POST', '/api/teams/import-sheet', async ({ body }) => {
    const { url, validationGid, picsGid, preview = false } = body || {};
    if (!url) bad('Paste the Google Sheets link');
    const r = await importTeamsFromSheet(url, { validationGid, picsGid });

    // Duplicate abbreviations are legal but will read ambiguously on air.
    const byAbbrev = new Map();
    for (const t of r.teams) {
      if (!t.abbrev) continue;
      byAbbrev.set(t.abbrev, [...(byAbbrev.get(t.abbrev) || []), t.name]);
    }
    const clashes = [...byAbbrev.entries()].filter(([, names]) => names.length > 1);
    const warnings = [...r.warnings];
    if (clashes.length) {
      warnings.push(
        `${clashes.length} abbreviation(s) are used by more than one school and will look ` +
        `identical on a graphic: ` +
        clashes.map(([a, names]) => `${a} (${names.join(' / ')})`).join('; ')
      );
    }
    if (preview) return { preview: true, ...r, warnings };

    const saved = r.teams.map((t) => store.saveTeam(t));
    return {
      ok: true, imported: saved.length, withColor: r.withColor,
      warnings, teams: saved.map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev, primaryColor: t.primaryColor }))
    };
  });

  route('GET', '/api/teams/:id', ({ params }) => store.getTeam(params.id) || bad('Unknown team', 404));
  route('DELETE', '/api/teams/:id', ({ params }) => {
    const t = store.getTeam(params.id) || bad('Unknown team', 404);
    fs.rmSync(store.teamPath(params.id), { force: true });
    return { deleted: t.id };
  });

  route('GET', '/api/teams/:id/roster', ({ params, query }) => ({
    teamId: params.id,
    sport: query.sport,
    players: store.getRoster(params.id, query.sport || bad('sport query param required'))
  }));

  route('POST', '/api/teams/:id/roster', ({ params, body }) => {
    const { sport, players, mode } = body || {};
    if (!sport) bad('sport is required');
    if (!Array.isArray(players)) bad('players array is required');
    const team = store.saveRoster(params.id, sport, players, mode || 'merge');
    return { ok: true, count: team.sports[sport].roster.length, roster: team.sports[sport].roster };
  });

  /**
   * Roster import from a URL (CIAC / any HTML roster table) or pasted CSV.
   * `preview: true` parses without saving so the operator can eyeball it first.
   */
  route('POST', '/api/teams/:id/roster/import', async ({ params, body }) => {
    const { sport, url, csv, mode = 'merge', preview = false } = body || {};
    if (!sport) bad('sport is required');
    let result;
    if (url) result = await importRosterFromURL(url);
    else if (csv) result = { ...parseRosterCSV(csv), source: 'pasted CSV', kind: 'csv' };
    else bad('Provide either a url or csv body field');

    if (!result.players.length) bad(`No players found. ${result.warnings.join(' ')}`);
    if (preview) return { preview: true, ...result };

    const team = store.saveRoster(params.id, sport, result.players, mode);
    return {
      ok: true, imported: result.players.length,
      total: team.sports[sport].roster.length,
      warnings: result.warnings, source: result.source,
      roster: team.sports[sport].roster
    };
  });

  /**
   * Stat import for HUDL (per-game pipe export or saved season page), MaxPreps
   * CSV/HTML, or any spreadsheet. Format is detected automatically.
   */
  route('POST', '/api/teams/:id/stats/import', ({ params, body }) => {
    const { sport, season, csv, label = 'import', category = null, merge = true, preview = false } = body || {};
    if (!sport || !csv) bad('sport and csv (the file contents) are required');
    // HUDL per-game files hold both teams and identify players only by jersey,
    // so hand the importer this team's numbers to split them apart.
    const rosterNums = store.getRoster(params.id, sport).map((p) => p.number).filter(Boolean);
    const result = importStatsAuto(csv, sport, {
      category, merge, rosterNums: rosterNums.length ? rosterNums : null
    });
    if (!result.players.length) bad(`No player rows found. ${(result.warnings || []).join(' ')}`);
    if (preview) return { preview: true, ...result };

    const team = store.getTeam(params.id) || bad('Unknown team', 404);
    const s = season || store.config.season;
    team.sports[sport] = team.sports[sport] || { roster: [], season: {} };
    team.sports[sport].season[s] = team.sports[sport].season[s] || { games: {} };
    team.sports[sport].season[s].imported = {
      label, importedAt: localStamp(),
      matchedColumns: result.matched,
      players: result.players
    };
    store.saveTeam(team);
    // names from the import also seed the roster, which is usually what you want
    // for an opponent you have never played before
    store.saveRoster(params.id, sport,
      result.players.map((p) => ({ number: p.number, name: p.name, pos: p.pos, year: p.year })), 'merge');
    return { ok: true, imported: result.players.length, matchedColumns: result.matched, warnings: result.warnings };
  });

  /* ---------------- games ---------------- */
  route('GET', '/api/games', () => store.listGames());

  route('POST', '/api/games', ({ body }) => {
    const b = body || {};
    for (const f of ['sport', 'homeTeamId', 'awayTeamId']) if (!b[f]) bad(`${f} is required`);
    if (b.homeTeamId === b.awayTeamId) bad('Home and away must be different teams');
    getSport(b.sport);
    const meta = store.createGame(b);
    store.updateConfig({ activeGameId: meta.id });
    append(meta.id, { type: 'game_start', data: { sport: meta.sport }, by: meta.operator });
    if (store.config.scorebot?.enabled) scorebot.start(meta.id);
    return meta;
  });

  route('GET', '/api/games/:id', ({ params }) => store.getGame(params.id) || bad('No such game', 404));
  route('PATCH', '/api/games/:id', ({ params, body }) => {
    const m = store.updateGame(params.id, body || {});
    touch(params.id);
    return m;
  });
  route('DELETE', '/api/games/:id', ({ params }) => {
    store.deleteGame(params.id);
    if (activeId() === params.id) store.updateConfig({ activeGameId: null });
    broadcast('update', { gameId: params.id, deleted: true });
    return { deleted: params.id };
  });

  route('POST', '/api/games/:id/activate', ({ params }) => {
    store.getGame(params.id) || bad('No such game', 404);
    store.updateConfig({ activeGameId: params.id });
    if (store.config.scorebot?.enabled) scorebot.start(params.id);
    touch(params.id);
    return { activeGameId: params.id };
  });

  /** The full derived state — this is what the entry UI polls/refreshes on. */
  route('GET', '/api/games/:id/state', ({ params }) => deriveGame(store, params.id));

  /** Everything the announcer page needs in one call: state plus the derived
   *  storylines, milestones and notable plays. */
  route('GET', '/api/games/:id/announcer', ({ params }) => {
    const g = deriveGame(store, params.id);
    return { ...g, announcer: announcerView(store, params.id, g) };
  });

  route('GET', '/api/games/:id/events', ({ params, query }) => {
    const all = store.readEvents(params.id);
    const n = parseInt(query.limit || '0', 10);
    return n > 0 ? all.slice(-n) : all;
  });

  /* ---------------- stat entry ---------------- */
  route('POST', '/api/games/:id/events', ({ params, body }) => {
    const b = body || {};
    const meta = store.getGame(params.id) || bad('No such game', 404);
    if (b.type === 'stat' || b.action) {
      if (!b.team || !['home', 'away'].includes(b.team)) bad('team must be "home" or "away"');
      const sport = getSport(meta.sport);
      const known = sport.palette.some((g) => g.actions.some((a) => a.key === b.action));
      if (!known) bad(`Unknown action "${b.action}" for ${meta.sport}`);
    }
    const ev = append(params.id, {
      type: b.type || 'stat',
      team: b.team,
      action: b.action,
      data: b.data || {},
      by: b.by || store.config.operator || '',
      source: 'manual'
    });
    return { event: ev, state: deriveGame(store, params.id) };
  });

  route('POST', '/api/games/:id/undo', ({ params, body }) => {
    let targetId = body?.eventId;
    if (!targetId) {
      // undo the most recent stat entry that has not already been undone
      const eff = store.effectiveEvents(params.id).filter((e) => e.type === 'stat');
      if (!eff.length) bad('Nothing to undo');
      targetId = eff[eff.length - 1].id;
    }
    store.undoEvent(params.id, targetId, body?.by || store.config.operator || '');
    touch(params.id);
    return { undone: targetId, state: deriveGame(store, params.id) };
  });

  /** Put back an undone entry. With no eventId, the most recent undo is reversed. */
  route('POST', '/api/games/:id/redo', ({ params, body }) => {
    let targetId = body?.eventId;
    if (!targetId) {
      const raw = store.readEvents(params.id);
      const stillUndone = new Set(store.undoneIds(params.id));
      const last = [...raw].reverse().find((e) => e.type === 'undo' && stillUndone.has(e.targetId));
      if (!last) bad('Nothing to redo');
      targetId = last.targetId;
    }
    store.redoEvent(params.id, targetId, body?.by || store.config.operator || '');
    touch(params.id);
    return { redone: targetId, state: deriveGame(store, params.id) };
  });

  route('POST', '/api/games/:id/correct', ({ params, body }) => {
    if (!body?.eventId) bad('eventId is required');
    store.correctEvent(params.id, body.eventId, body.data || {}, body.by || store.config.operator || '');
    touch(params.id);
    return { corrected: body.eventId, state: deriveGame(store, params.id) };
  });

  /* ---------------- clock ---------------- */
  route('POST', '/api/games/:id/clock', ({ params, body }) => {
    const op = body?.op || bad('op is required (start|stop|set|period|aux|auxStart|auxStop|auxConfig)');
    const map = {
      start: 'clock_start', stop: 'clock_stop', set: 'clock_set', period: 'period_set',
      aux: 'aux_set', auxStart: 'aux_start', auxStop: 'aux_stop', auxConfig: 'aux_config'
    };
    const type = map[op] || bad(`Unknown clock op "${op}"`);
    const meta = store.getGame(params.id) || bad('No such game', 404);
    if (type.startsWith('aux') && !getSport(meta.sport).auxClock) {
      bad(`${getSport(meta.sport).name} has no secondary clock`);
    }
    const data = {};
    if (op === 'set') data.ms = Number(body.ms) || 0;
    if (op === 'period') {
      // Periods are correctable in both directions — an operator who advances by
      // mistake needs to go back — and bounded, so a stray tap cannot run the
      // game off to the 12th overtime.
      const sport = getSport(meta.sport);
      const n = Number(body.period);
      if (!Number.isInteger(n)) bad('period must be a whole number');
      const maxOT = meta.settings?.maxOvertimes ?? sport.periods.maxOvertimes ?? 3;
      const max = sport.periods.count + maxOT;
      if (n < 1) bad(`Cannot go before the 1st ${sport.periods.label.toLowerCase()}`);
      if (n > max) {
        const isInnings = sport.periods.label === 'Inning';
        bad(isInnings
          ? `${max} innings is the limit. Raise "maxOvertimes" in the game's settings if you really need more.`
          : `${sport.name} is capped at ${maxOT} overtime${maxOT === 1 ? '' : 's'} (${sport.periods.label.toLowerCase()} ${max}). ` +
            `Raise "maxOvertimes" in the game's settings to go further.`);
      }
      data.period = n;
      if (body.ms != null) data.ms = Number(body.ms);
    }
    if (op === 'aux') { data.ms = Number(body.ms); if (body.running != null) data.running = !!body.running; }
    if (op === 'auxConfig') {
      if (body.enabled != null) data.enabled = !!body.enabled;
      if (body.autoReset != null) data.autoReset = !!body.autoReset;
    }
    append(params.id, { type, data, by: body.by || store.config.operator || '' });
    return deriveGame(store, params.id);
  });

  route('POST', '/api/games/:id/possession', ({ params, body }) => {
    const team = body?.team;
    if (!['home', 'away'].includes(team)) bad('team must be "home" or "away"');
    append(params.id, { type: 'possession', team, data: {} });
    return deriveGame(store, params.id);
  });

  /**
   * Manual situation entry — down/distance, half-inning, count, bases.
   * Written as the same situation_set event the feed uses, so the operator can
   * always override a field the scoreboard is getting wrong.
   */
  route('POST', '/api/games/:id/situation', ({ params, body }) => {
    const d = body || {};
    const data = {};
    for (const k of ['down', 'distance', 'ballOn', 'possession', 'half', 'outs', 'balls', 'strikes', 'bases']) {
      if (d[k] !== undefined) data[k] = d[k];
    }
    if (!Object.keys(data).length) bad('Nothing to set');
    append(params.id, { type: 'situation_set', source: 'manual', data, by: d.by || store.config.operator || '' });
    return deriveGame(store, params.id);
  });

  /** Freeze the game and roll its numbers into both teams' season totals. */
  route('POST', '/api/games/:id/commit', ({ params }) => {
    const g = deriveGame(store, params.id);
    store.commitSeasonStats(params.id, g);
    store.updateGame(params.id, { status: 'final', committedAt: localStamp() });
    append(params.id, { type: 'game_end', data: { home: g.teams.home.points, away: g.teams.away.points } });
    return { ok: true, final: { home: g.teams.home.points, away: g.teams.away.points } };
  });

  /* ---------------- exports ---------------- */
  const exp = {
    'boxscore.csv': (g, id) => raw(boxScoreCSV(g), 'text/csv; charset=utf-8', `${id}-boxscore.csv`),
    'teamstats.csv': (g, id) => raw(teamStatsCSV(g), 'text/csv; charset=utf-8', `${id}-teamstats.csv`),
    'scoring.csv': (g, id) => raw(scoringCSV(g), 'text/csv; charset=utf-8', `${id}-scoring.csv`),
    'pbp.csv': (g, id) => raw(playByPlayCSV(store, id, g), 'text/csv; charset=utf-8', `${id}-playbyplay.csv`),
    'report.pdf': (g, id) => raw(gameReportPDF(g), 'application/pdf', `${id}-report.pdf`),
    'summary.pdf': (g, id) => raw(gameReportPDF(g, { includePBP: false }), 'application/pdf', `${id}-summary.pdf`)
  };
  route('GET', '/api/games/:id/export/:file', ({ params }) => {
    const fn = exp[params.file] || bad(`Unknown export "${params.file}". Try: ${Object.keys(exp).join(', ')}`, 404);
    return fn(deriveGame(store, params.id), params.id);
  });

  /**
   * Everything stored for one team in a sport/season: every game we have played
   * them (or they have played), with team lines and per-player numbers, plus any
   * imported HUDL/MaxPreps season totals. This is what makes a rematch easy —
   * pull up what they did to us in September before the November game.
   */
  route('GET', '/api/teams/:id/history', ({ params, query }) => {
    const team = store.getTeam(params.id) || bad('Unknown team', 404);
    const sport = query.sport || bad('sport query param required');
    const bucket = team.sports?.[sport]?.season || {};
    const season = query.season || null;
    const seasons = season ? [season] : Object.keys(bucket).sort().reverse();

    const out = [];
    for (const s of seasons) {
      const b = bucket[s];
      if (!b) continue;
      const games = Object.entries(b.games || {}).map(([gameId, g]) => ({
        gameId, date: g.date, opponent: g.opponent, homeAway: g.homeAway,
        teamStats: g.teamStats, playerCount: (g.players || []).length,
        exists: !!store.getGame(gameId)
      })).sort((x, y) => String(y.date).localeCompare(String(x.date)));

      // season aggregate across the games we logged ourselves
      const totals = new Map();
      for (const g of Object.values(b.games || {})) {
        for (const p of g.players || []) {
          const k = `${p.number}|${p.name}`;
          if (!totals.has(k)) totals.set(k, { number: p.number, name: p.name, pos: p.pos, games: 0 });
          const t = totals.get(k);
          t.games++;
          for (const [key, v] of Object.entries(p)) if (typeof v === 'number') t[key] = (t[key] || 0) + v;
        }
      }
      out.push({
        season: s, games, gameCount: games.length,
        players: [...totals.values()].sort((a, b2) => (parseInt(a.number, 10) || 999) - (parseInt(b2.number, 10) || 999)),
        imported: b.imported ? {
          label: b.imported.label, importedAt: b.imported.importedAt,
          playerCount: b.imported.players.length,
          matchedColumns: b.imported.matchedColumns,
          players: b.imported.players
        } : null,
        updatedAt: b.updatedAt
      });
    }
    return { teamId: team.id, teamName: team.name, sport, seasons: out };
  });

  route('GET', '/api/teams/:id/export/season.csv', ({ params, query }) => {
    const sport = query.sport || bad('sport query param required');
    const season = query.season || store.config.season;
    return raw(seasonCSV(store, params.id, sport, season), 'text/csv; charset=utf-8',
      `${params.id}-${sport}-${season}-season.csv`);
  });
  route('GET', '/api/teams/:id/export/roster.csv', ({ params, query }) => {
    const sport = query.sport || bad('sport query param required');
    return raw(rosterCSV(store, params.id, sport), 'text/csv; charset=utf-8', `${params.id}-${sport}-roster.csv`);
  });

  /* ---------------- vMix XML ---------------- */
  function xml(gameId, view, query) {
    const key = String(view).replace(/\.xml$/i, '').toLowerCase();
    const fn = XML_VIEWS[key] || bad(`Unknown view "${key}". Try: ${Object.keys(XML_VIEWS).join(', ')}`, 404);
    const g = deriveGame(store, gameId);
    const q = { ...query };
    if (q.limit) q.limit = parseInt(q.limit, 10);
    if (q.n) q.n = parseInt(q.n, 10);
    return raw(fn(g, q), 'application/xml; charset=utf-8', null);
  }

  // /vmix/live/... always follows the active game so vMix never needs re-pointing
  route('GET', '/vmix/live/:view', ({ params, query }) =>
    xml(activeId() || bad('No active game — start or activate a game first', 404), params.view, query));
  route('GET', '/vmix/:gameId/:view', ({ params, query }) => xml(params.gameId, params.view, query));

  // Convenience index so you can browse the available feeds from vMix's browser
  route('GET', '/vmix', ({ url }) => {
    const base = `${url.protocol}//${url.host}`;
    return {
      activeGame: activeId(),
      note: 'Point vMix Data Sources (XML) at any of these URLs. Each returns repeating <Row> elements.',
      live: Object.keys(XML_VIEWS).map((v) => `${base}/vmix/live/${v}.xml`),
      examples: [
        `${base}/vmix/live/players.xml?side=home&cat=passing&limit=5`,
        `${base}/vmix/live/leaders.xml?cat=rushing&side=away&limit=3`,
        `${base}/vmix/live/plays.xml?n=6`
      ],
      files: `${store.dirs.vmix} (same XML mirrored to disk, _live folder tracks the active game)`
    };
  });

  /* ---------------- scorebot ---------------- */
  route('GET', '/api/scorebot/status', () => ({ ...scorebot.status, config: store.config.scorebot }));
  route('POST', '/api/scorebot/start', () => {
    const id = activeId() || bad('No active game');
    return scorebot.start(id);
  });
  route('POST', '/api/scorebot/stop', () => { scorebot.stop(); return scorebot.status; });

  /**
   * Parse a raw JSON sample without any network call. Paste one Scorebot
   * message here and it returns the normalised reading plus suggested paths for
   * every field, which is the fieldMap you then save.
   */
  route('POST', '/api/scorebot/parse', async ({ body }) => {
    let raw = body?.json ?? body?.raw ?? body;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); }
      catch (e) { bad(`That is not valid JSON: ${e.message}`); }
    }
    if (!raw || typeof raw !== 'object') bad('Paste a JSON object from the feed.');
    const { discoverPaths, normalizeFeed, FEED_FIELDS, DEFAULT_SOURCES } =
      await import('./integrations/scorebot.js');
    const fieldMap = body?.fieldMap || store.config.scorebot?.fieldMap || {};
    const { suggestions, paths } = discoverPaths(raw);
    const normalized = normalizeFeed(raw, fieldMap);
    const missing = FEED_FIELDS
      .filter(({ key }) => {
        const v = normalized[key === 'clock' ? 'clockMs' : key];
        return v === undefined || v === null;
      })
      .map(({ key }) => key);
    return {
      normalized, suggestions, missing,
      suggestedFieldMap: Object.fromEntries(
        Object.entries(suggestions).map(([k, v]) => [k, v[0].path])
      ),
      fields: FEED_FIELDS,
      defaultSources: DEFAULT_SOURCES,
      pathCount: Object.keys(paths).length
    };
  });

  /** Fetch the feed once and show both the raw and normalised payload — the
   *  fastest way to work out the right fieldMap for a new venue. */
  route('POST', '/api/scorebot/test', async ({ body }) => {
    const cfg = { ...store.config.scorebot, ...(body || {}) };
    if (!cfg.url) bad('No scorebot URL configured');

    // MQTT feeds (Sportzcast ScoreConnect III) are sampled by subscribing for a
    // moment. Use topic "#" to discover what a broker is publishing.
    if (/^mqtts?:/i.test(cfg.url)) {
      const { sampleMqtt } = await import('./integrations/mqtt.js');
      const { normalizeFeed } = await import('./integrations/scorebot.js');
      const r = await sampleMqtt({
        url: cfg.gameCode ? cfg.url.replace('{game}', encodeURIComponent(cfg.gameCode)) : cfg.url,
        topic: cfg.topic, username: cfg.mqttUser,
        password: cfg.mqttPassword || cfg.apiKey || undefined,
        ms: 4000
      });
      if (r.error) bad(r.error);
      if (!r.messages.length) {
        bad(r.connected
          ? `Connected, but nothing was published in 4 seconds. Check the topic — try "#" to see everything the broker is sending.`
          : 'Could not connect to the MQTT broker.');
      }
      const first = r.messages.find((m) => { try { JSON.parse(m.payload); return true; } catch { return false; } });
      const json = first ? JSON.parse(first.payload) : null;
      return {
        status: 200, ok: true, transport: 'mqtt',
        topics: r.topics,
        raw: json ?? r.messages[0].payload.slice(0, 2000),
        normalized: json ? normalizeFeed(json, cfg.fieldMap || {}) : null
      };
    }

    if (/^wss?:/i.test(cfg.url)) bad('Test only supports HTTP(S) and MQTT URLs. For WebSocket feeds, start the client and watch the status.');
    const headers = { Accept: 'application/json' };
    if (cfg.apiKey) { headers.Authorization = `Bearer ${cfg.apiKey}`; headers['x-api-key'] = cfg.apiKey; }
    const url = cfg.gameCode ? cfg.url.replace('{game}', encodeURIComponent(cfg.gameCode)) : cfg.url;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* leave as text for inspection */ }
    const { normalizeFeed } = await import('./integrations/scorebot.js');
    return {
      status: res.status,
      ok: res.ok,
      raw: json ?? text.slice(0, 4000),
      normalized: json ? normalizeFeed(json, cfg.fieldMap || {}) : null
    };
  });

  /* ---------------- health ---------------- */
  route('GET', '/api/health', () => ({
    ok: true, time: localStamp(), activeGame: activeId(),
    games: store.listGames().length, teams: store.listTeams().length
  }));
}
