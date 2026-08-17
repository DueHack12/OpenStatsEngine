import fs from 'node:fs';
import path from 'node:path';
import { id, slug, localStamp, localDate, clone } from './util.js';

/**
 * On-disk layout (everything is plain text so it can be inspected, diffed and
 * backed up with a file copy):
 *
 *   data/
 *     config.json
 *     teams/<teamId>.json          team profile + roster + season aggregates
 *     games/<gameId>/meta.json     matchup, date, venue, sport, settings
 *     games/<gameId>/events.jsonl  append-only event log (the source of truth)
 *     vmix/<gameId>/*.xml          mirrored XML for vMix file-based data sources
 *     exports/                     generated CSV / PDF
 */

export class Store {
  constructor(root) {
    this.root = path.resolve(root);
    this.dirs = {
      teams: path.join(this.root, 'teams'),
      games: path.join(this.root, 'games'),
      vmix: path.join(this.root, 'vmix'),
      exports: path.join(this.root, 'exports')
    };
    for (const d of Object.values(this.dirs)) fs.mkdirSync(d, { recursive: true });
    this.configPath = path.join(this.root, 'config.json');
    this.config = this._readJSON(this.configPath) || {
      orgName: 'OpenStatsEngine',
      season: String(new Date().getFullYear()),
      operator: '',
      scorebot: { enabled: false, url: '', apiKey: '', pollMs: 1000, gameCode: '' }
    };
    this.saveConfig();
    this._eventCache = new Map(); // gameId -> events[]
  }

  // ---------- low level ----------
  _readJSON(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }

  _writeJSON(p, obj) {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, p); // atomic replace, so a crash mid-write can't truncate
  }

  saveConfig() { this._writeJSON(this.configPath, this.config); }

  updateConfig(patch) {
    // Capture the nested block first: the top-level spread below replaces
    // `scorebot` wholesale, so merging afterwards would merge it with itself and
    // silently drop every key the patch didn't mention — disconnecting the feed
    // would have erased its URL.
    const prevScorebot = this.config.scorebot || {};
    this.config = { ...this.config, ...patch };
    if (patch.scorebot) {
      this.config.scorebot = { ...prevScorebot, ...patch.scorebot };
      // `sources` is itself a map of per-field settings, so patching one field
      // must not drop the rest. Same reason as above, one level deeper.
      if (patch.scorebot.sources) {
        this.config.scorebot.sources = { ...(prevScorebot.sources || {}), ...patch.scorebot.sources };
      }
    }
    this.saveConfig();
    return this.config;
  }

  /**
   * Roll a snapshot of everything irreplaceable into data/_backups/<stamp>/.
   *
   * A season of stats is hand-entered and lives in one folder on one laptop, so
   * a stray delete — or a mistyped --data — would otherwise cost the lot. The
   * files are small plain text, so keeping the last few copies is nearly free.
   * vmix/ is skipped because it is regenerated from the event log.
   */
  backup({ keep = 10 } = {}) {
    const hasTeams = fs.existsSync(this.dirs.teams) && fs.readdirSync(this.dirs.teams).length;
    const hasGames = fs.existsSync(this.dirs.games) && fs.readdirSync(this.dirs.games).length;
    if (!hasTeams && !hasGames) return null; // nothing worth saving yet

    const root = path.join(this.root, '_backups');
    fs.mkdirSync(root, { recursive: true });
    const stamp = localStamp().replace(/[: ]/g, '-');
    const dest = path.join(root, stamp);
    // Two restarts inside the same second reuse the snapshot, but pruning still
    // has to run — skipping it here would let backups grow without limit.
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
      for (const name of ['teams', 'games']) {
        const src = path.join(this.root, name);
        if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, name), { recursive: true });
      }
      if (fs.existsSync(this.configPath)) fs.copyFileSync(this.configPath, path.join(dest, 'config.json'));
    }

    const all = fs.readdirSync(root).filter((d) => /^\d{4}-/.test(d)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - keep))) {
      fs.rmSync(path.join(root, old), { recursive: true, force: true });
    }
    return dest;
  }

  /** Bytes on disk for the live data, excluding backups and generated XML. */
  dataSize() {
    let total = 0;
    const walk = (p) => {
      let st;
      try { st = fs.statSync(p); } catch { return; }
      if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); }
      else total += st.size;
    };
    for (const name of ['teams', 'games']) walk(path.join(this.root, name));
    return total;
  }

  // ---------- teams ----------
  teamPath(teamId) { return path.join(this.dirs.teams, `${teamId}.json`); }

  listTeams() {
    return fs.readdirSync(this.dirs.teams)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this._readJSON(path.join(this.dirs.teams, f)))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getTeam(teamId) { return this._readJSON(this.teamPath(teamId)); }

  /** Create or update a team. Roster is merged by jersey number + name. */
  saveTeam(team) {
    const teamId = team.id || slug(team.name);
    const existing = this.getTeam(teamId);
    const merged = {
      id: teamId,
      name: team.name || existing?.name || teamId,
      shortName: team.shortName ?? existing?.shortName ?? (team.name || teamId).slice(0, 12),
      abbrev: (team.abbrev ?? existing?.abbrev ?? (team.name || teamId).slice(0, 3)).toUpperCase(),
      mascot: team.mascot ?? existing?.mascot ?? '',
      primaryColor: team.primaryColor ?? existing?.primaryColor ?? '#1e40af',
      secondaryColor: team.secondaryColor ?? existing?.secondaryColor ?? '#ffffff',
      sports: team.sports ?? existing?.sports ?? {},
      createdAt: existing?.createdAt || localStamp(),
      updatedAt: localStamp()
    };
    this._writeJSON(this.teamPath(teamId), merged);
    return merged;
  }

  /**
   * Replace or merge a team's roster for one sport.
   * mode 'merge' keeps players not present in the incoming list (so a partial
   * HUDL export can't wipe the roster you hand-entered on game day).
   */
  saveRoster(teamId, sport, players, mode = 'merge') {
    const team = this.getTeam(teamId);
    if (!team) throw new Error(`Unknown team: ${teamId}`);
    team.sports[sport] = team.sports[sport] || { roster: [], season: {} };
    const cur = team.sports[sport].roster || [];
    let next;
    if (mode === 'replace') {
      next = players.map((p) => ({ ...p, id: p.id || id('p_') }));
    } else {
      const byKey = new Map();
      const keyOf = (p) => `${String(p.number ?? '').trim()}|${String(p.name || '').trim().toLowerCase()}`;
      for (const p of cur) byKey.set(keyOf(p), p);
      for (const p of players) {
        const k = keyOf(p);
        // also match on name alone so a jersey change updates rather than duplicates
        const byName = cur.find((c) => c.name && p.name &&
          c.name.trim().toLowerCase() === p.name.trim().toLowerCase());
        const target = byKey.get(k) || byName;
        if (target) Object.assign(target, { ...p, id: target.id });
        else { const np = { ...p, id: p.id || id('p_') }; cur.push(np); byKey.set(k, np); }
      }
      next = cur;
    }
    next.sort((a, b) => {
      const an = parseInt(a.number, 10), bn = parseInt(b.number, 10);
      if (isFinite(an) && isFinite(bn) && an !== bn) return an - bn;
      if (isFinite(an) !== isFinite(bn)) return isFinite(an) ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
    team.sports[sport].roster = next;
    team.updatedAt = localStamp();
    this._writeJSON(this.teamPath(teamId), team);
    return team;
  }

  getRoster(teamId, sport) {
    const t = this.getTeam(teamId);
    return t?.sports?.[sport]?.roster || [];
  }

  // ---------- games ----------
  gameDir(gameId) { return path.join(this.dirs.games, gameId); }

  listGames() {
    if (!fs.existsSync(this.dirs.games)) return [];
    return fs.readdirSync(this.dirs.games)
      .map((g) => this._readJSON(path.join(this.dirs.games, g, 'meta.json')))
      .filter(Boolean)
      .sort((a, b) => String(b.date + b.startTime).localeCompare(String(a.date + a.startTime)));
  }

  getGame(gameId) { return this._readJSON(path.join(this.gameDir(gameId), 'meta.json')); }

  createGame(spec) {
    const date = spec.date || localDate();
    const gid = spec.id || `${date}_${slug(spec.sport)}_${slug(spec.awayTeamId)}-at-${slug(spec.homeTeamId)}`;
    const dir = this.gameDir(gid);
    if (fs.existsSync(path.join(dir, 'meta.json'))) throw new Error('A game with that id already exists');
    fs.mkdirSync(dir, { recursive: true });
    const meta = {
      id: gid,
      sport: spec.sport,
      season: spec.season || this.config.season,
      date,
      startTime: spec.startTime || localStamp().slice(11),
      venue: spec.venue || '',
      level: spec.level || 'Varsity',
      homeTeamId: spec.homeTeamId,
      awayTeamId: spec.awayTeamId,
      homeName: spec.homeName || this.getTeam(spec.homeTeamId)?.name || spec.homeTeamId,
      awayName: spec.awayName || this.getTeam(spec.awayTeamId)?.name || spec.awayTeamId,
      operator: spec.operator || this.config.operator || '',
      notes: spec.notes || '',
      status: 'pregame',
      settings: spec.settings || {},
      createdAt: localStamp(),
      updatedAt: localStamp()
    };
    this._writeJSON(path.join(dir, 'meta.json'), meta);
    fs.writeFileSync(path.join(dir, 'events.jsonl'), '');
    this._eventCache.set(gid, []);
    return meta;
  }

  updateGame(gameId, patch) {
    const meta = this.getGame(gameId);
    if (!meta) throw new Error('No such game');
    Object.assign(meta, patch, { id: meta.id, updatedAt: localStamp() });
    this._writeJSON(path.join(this.gameDir(gameId), 'meta.json'), meta);
    return meta;
  }

  deleteGame(gameId) {
    fs.rmSync(this.gameDir(gameId), { recursive: true, force: true });
    fs.rmSync(path.join(this.dirs.vmix, gameId), { recursive: true, force: true });
    this._eventCache.delete(gameId);
  }

  // ---------- events ----------
  eventsPath(gameId) { return path.join(this.gameDir(gameId), 'events.jsonl'); }

  readEvents(gameId) {
    if (this._eventCache.has(gameId)) return this._eventCache.get(gameId);
    const p = this.eventsPath(gameId);
    let events = [];
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try { events.push(JSON.parse(s)); }
        catch { /* skip a torn final line rather than losing the whole game */ }
      }
    }
    this._eventCache.set(gameId, events);
    return events;
  }

  appendEvent(gameId, ev) {
    const events = this.readEvents(gameId);
    const full = {
      id: ev.id || id('e_'),
      seq: events.length ? events[events.length - 1].seq + 1 : 1,
      ts: new Date().toISOString(),
      tsLocal: localStamp(),
      ...ev
    };
    fs.appendFileSync(this.eventsPath(gameId), JSON.stringify(full) + '\n');
    events.push(full);
    return full;
  }

  /** Soft-delete: append an 'undo' marker so the audit trail stays intact. */
  undoEvent(gameId, targetId, by = '') {
    return this.appendEvent(gameId, { type: 'undo', targetId, by });
  }

  /** Cancel an undo. Also append-only, so the log records the whole sequence. */
  redoEvent(gameId, targetId, by = '') {
    return this.appendEvent(gameId, { type: 'redo', targetId, by });
  }

  /** Rewrite an event's payload by appending a correction marker. */
  correctEvent(gameId, targetId, data, by = '') {
    return this.appendEvent(gameId, { type: 'correct', targetId, data, by });
  }

  /** Events with undo/correct markers already applied, in sequence order. */
  effectiveEvents(gameId) {
    const raw = this.readEvents(gameId);
    const undone = new Set();
    const corrections = new Map();
    // Replayed in order, so the last undo/redo for a target is the one that counts.
    for (const e of raw) {
      if (e.type === 'undo' && e.targetId) undone.add(e.targetId);
      if (e.type === 'redo' && e.targetId) undone.delete(e.targetId);
      if (e.type === 'correct' && e.targetId) {
        corrections.set(e.targetId, { ...(corrections.get(e.targetId) || {}), ...e.data });
      }
    }
    return raw
      .filter((e) => !['undo', 'redo', 'correct'].includes(e.type) && !undone.has(e.id))
      .map((e) => {
        const c = corrections.get(e.id);
        if (!c) return e;
        return { ...e, ...c, data: { ...(e.data || {}), ...(c.data || {}) }, corrected: true };
      });
  }

  /** Ids currently undone, oldest first. */
  undoneIds(gameId) {
    const undone = new Set();
    for (const e of this.readEvents(gameId)) {
      if (e.type === 'undo' && e.targetId) undone.add(e.targetId);
      if (e.type === 'redo' && e.targetId) undone.delete(e.targetId);
    }
    return [...undone];
  }

  /** Aggregate a finished game into each team's season totals. */
  commitSeasonStats(gameId, derived) {
    const meta = this.getGame(gameId);
    if (!meta) return;
    for (const side of ['home', 'away']) {
      const teamId = side === 'home' ? meta.homeTeamId : meta.awayTeamId;
      const team = this.getTeam(teamId);
      if (!team) continue;
      team.sports[meta.sport] = team.sports[meta.sport] || { roster: [], season: {} };
      const season = team.sports[meta.sport].season || {};
      const bucket = season[meta.season] = season[meta.season] || { games: {}, updatedAt: '' };
      bucket.games[gameId] = {
        date: meta.date,
        opponent: side === 'home' ? meta.awayName : meta.homeName,
        homeAway: side === 'home' ? 'H' : 'A',
        teamStats: clone(derived.teams[side] || {}),
        players: clone(
          Object.values(derived.players).filter((p) => p.side === side)
        )
      };
      bucket.updatedAt = localStamp();
      team.sports[meta.sport].season = season;
      team.updatedAt = localStamp();
      this._writeJSON(this.teamPath(teamId), team);
    }
  }
}
