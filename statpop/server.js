#!/usr/bin/env node
/**
 * StatPop — fills a vMix GT comparison graphic from OpenStatsEngine.
 *
 * Type a stat in plain words ("Total Yards", "drops", "3rd down %"); StatPop
 * finds it in the live OSE game and pushes label + both teams' values into the
 * title with vMix's SetText API. No npm dependencies.
 *
 *   node server.js [--port 8700] [--ose 192.168.1.50:8080] [--vmix localhost:8088] [--data <folder>]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildCatalog } from './lib/catalog.js';
import { compose, defaultSettings, mergeSettings, cleanRow, fieldList } from './lib/compose.js';
import { vmixFunction, vmixState, findInput } from './lib/vmix.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const PORT = parseInt(arg('--port', process.env.STATPOP_PORT || '8700'), 10);
const DATA = path.resolve(arg('--data', process.env.STATPOP_DATA || path.join(HERE, 'data')));
const FILE = path.join(DATA, 'statpop.json');
const PUBLIC = path.join(HERE, 'public');

/* ------------------------------------------------------------ settings */

fs.mkdirSync(DATA, { recursive: true });
let settings = defaultSettings();
try {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  settings = mergeSettings(settings, saved);
  settings.presets = saved.presets && typeof saved.presets === 'object' ? saved.presets : {};
  settings.live = false; // never go live on air by surprise after a restart
} catch { /* first run */ }
// --ose / --vmix (or STATPOP_OSE / STATPOP_VMIX) set the addresses from a shortcut
const oseArg = arg('--ose', process.env.STATPOP_OSE);
const vmixArg = arg('--vmix', process.env.STATPOP_VMIX);
if (oseArg || vmixArg) {
  settings = mergeSettings(settings, { ...(oseArg && { ose: { url: oseArg } }), ...(vmixArg && { vmix: { url: vmixArg } }) });
}

function save() {
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(settings, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
}

/* ----------------------------------------------------------------- OSE */

const oseBase = () => (settings.ose.url || 'http://localhost:8080').replace(/\/+$/, '');
async function oseGet(p) {
  const res = await fetch(oseBase() + p, { signal: AbortSignal.timeout(2500) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `OpenStatsEngine answered ${res.status}`);
  return body;
}

const manifests = new Map();
let oseCache = { at: 0, promise: null };
let lastGood = null;                // { game, catalog, at } — keeps the graphic intact if OSE blips
let oseStatus = { ok: false, error: 'Not checked yet' };

async function loadGame() {
  let id = settings.ose.gameId;
  if (!id) {
    const cfg = await oseGet('/api/config');
    id = cfg.activeGameId;
    if (!id) throw new Error('No active game in OpenStatsEngine — start or activate one');
  }
  const game = await oseGet(`/api/games/${encodeURIComponent(id)}/state`);
  if (!manifests.has(game.sportId)) {
    manifests.set(game.sportId, await oseGet(`/api/sports/${encodeURIComponent(game.sportId)}`).catch(() => null));
  }
  return { game, catalog: buildCatalog(game, manifests.get(game.sportId)), at: Date.now() };
}

/** Game + catalog, at most one OSE round-trip per 400 ms however many callers. */
function getGame() {
  const now = Date.now();
  if (oseCache.promise && now - oseCache.at < 400) return oseCache.promise;
  oseCache = {
    at: now,
    promise: loadGame().then((r) => {
      lastGood = r;
      oseStatus = { ok: true, error: null };
      return r;
    }).catch((err) => {
      oseStatus = { ok: false, error: niceError(err, 'OpenStatsEngine', settings.ose.url) };
      return lastGood ? { ...lastGood, stale: true } : null;
    })
  };
  return oseCache.promise;
}

function niceError(err, what, url) {
  const msg = String(err?.cause?.code || err?.name || '');
  if (msg === 'ECONNREFUSED') return `Can't reach ${what} at ${url} — is it running?`;
  if (msg === 'TimeoutError' || msg === 'UND_ERR_CONNECT_TIMEOUT') return `${what} at ${url} didn't answer in time`;
  if (msg === 'ENOTFOUND') return `Unknown host in ${what} address ${url}`;
  return err?.message || String(err);
}

async function current() {
  const r = await getGame();
  const out = compose(settings, r?.game || null, r?.catalog || null);
  out.game = r?.game ? {
    id: r.game.meta?.id, sport: r.game.sportName, sportId: r.game.sportId,
    period: r.game.clock?.periodLabel, clock: r.game.clock?.clock, status: r.game.meta?.status,
    updatedAt: r.game.updatedAt
  } : null;
  out.stale = !!r?.stale;
  return out;
}

/* ---------------------------------------------------------------- vMix */

let lastSent = new Map();           // "fn|field" -> value vMix last accepted
let lastSentInput = '';
let vmixStatus = { ok: null, error: null, lastPush: null, sent: 0 };
let pushing = false;

/** Push fields to vMix. force=false sends only what changed since last time. */
async function push(force = false) {
  if (pushing) return { skipped: true };
  pushing = true;
  try {
    const input = settings.vmix.input;
    if (!input) throw new Error('Choose the vMix title input first (Settings)');
    if (input !== lastSentInput) { lastSent = new Map(); lastSentInput = input; }
    const c = await current();
    if (!c.game && !force) return { skipped: true, reason: 'no game data' };
    let sent = 0;
    const errors = [];
    for (const { field, value, fn = 'SetText' } of c.fields) {
      const k = `${fn}|${field}`;
      if (!force && lastSent.get(k) === value) continue;
      try {
        await vmixFunction(settings.vmix.url, fn, { Input: input, SelectedName: field, Value: value });
        lastSent.set(k, value);
        sent++;
      } catch (err) {
        errors.push(`${field}: ${niceError(err, 'vMix', settings.vmix.url)}`);
        if (/reach|answer in time|Unknown host/.test(errors.at(-1))) break; // vMix is down; stop hammering
      }
    }
    vmixStatus = { ok: !errors.length, error: errors[0] || null, lastPush: new Date().toISOString(), sent };
    if (errors.length) lastSent = new Map(); // resend everything once it's back
    return { sent, errors };
  } catch (err) {
    vmixStatus = { ...vmixStatus, ok: false, error: err.message };
    return { sent: 0, errors: [err.message] };
  } finally {
    pushing = false;
  }
}

let timer = null;
function schedule() {
  clearInterval(timer);
  timer = setInterval(() => { if (settings.live) push(false); }, settings.intervalMs);
}
schedule();

/* ---------------------------------------------------------------- HTTP */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 1e6) throw new Error('Body too large'); }
  return s ? JSON.parse(s) : {};
}

const publicSettings = () => ({ ...settings, presetNames: Object.keys(settings.presets).sort() });

async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/settings' && m === 'GET') return send(res, 200, publicSettings());
  if (p === '/api/settings' && (m === 'PUT' || m === 'POST')) {
    const body = await readBody(req);
    const wasInterval = settings.intervalMs;
    const presets = settings.presets;
    settings = mergeSettings(settings, body);
    settings.presets = presets;
    if (body.ose) {            // different server or game: forget the old one entirely
      oseCache = { at: 0, promise: null };
      lastGood = null;
    }
    if (body.vmix) vmixStatus = { ok: null, error: null, lastPush: null, sent: 0 };
    if (settings.intervalMs !== wasInterval) schedule();
    save();
    if (settings.live) push(false);
    return send(res, 200, publicSettings());
  }

  if (p === '/api/preview' && m === 'GET') {
    const c = await current();
    return send(res, 200, { ...c, ose: oseStatus, vmix: vmixStatus, live: settings.live });
  }

  if (p === '/api/catalog' && m === 'GET') {
    const r = await getGame();
    const side = (s) => (settings.teamA === 'home' ? s : (s === 'home' ? 'away' : 'home'));
    return send(res, 200, {
      ose: oseStatus,
      entries: (r?.catalog?.entries || []).map((e) => ({
        id: e.id, label: e.label, key: e.key, source: e.source,
        a: e[side('home')], b: e[side('away')]
      }))
    });
  }

  if (p === '/api/games' && m === 'GET') {
    try {
      const [games, cfg] = await Promise.all([oseGet('/api/games'), oseGet('/api/config')]);
      return send(res, 200, { ok: true, activeGameId: cfg.activeGameId, games });
    } catch (err) {
      return send(res, 200, { ok: false, error: niceError(err, 'OpenStatsEngine', settings.ose.url), games: [] });
    }
  }

  if (p === '/api/vmix' && m === 'GET') {
    try {
      const st = await vmixState(settings.vmix.url);
      const titles = st.inputs.filter((i) => i.fields.some((f) => f.kind === 'text'));
      const sel = findInput(st, settings.vmix.input);
      let missing = [];
      let colorCheck = false;
      if (sel) {
        const names = (kind) => new Set(sel.fields.filter((f) => f.kind === kind).map((f) => f.name));
        const texts = names('text'), colours = names('color');
        // Older vMix versions don't list shape colours, so only check them when it does.
        colorCheck = colours.size > 0;
        const c = compose(settings, null, null);
        const wanted = new Map(c.fields.map((x) => [x.field, x.fn]));
        // score fields and team-colour boxes are only sent with a game, so add them here
        if (settings.sendScore) for (const f of [...fieldList(settings.fields.scoreA), ...fieldList(settings.fields.scoreB)]) wanted.set(f, 'SetText');
        for (const [side, key] of [['A', 'boxA'], ['B', 'boxB']]) {
          const team = settings.colors[side === 'A' ? settings.teamA : (settings.teamA === 'home' ? 'away' : 'home')];
          if (team.box !== 'off') for (const f of fieldList(settings.fields[key])) wanted.set(f, 'SetColor');
        }
        missing = [...wanted].filter(([f, fn]) => fn === 'SetColor' ? colorCheck && !colours.has(f) : !texts.has(f)).map(([f]) => f);
      }
      const overlays = st.overlays.map((o) => ({ number: o.number, active: !!sel && o.input === sel.number }));
      return send(res, 200, {
        ok: true, version: st.version,
        inputs: titles.map((i) => ({ key: i.key, number: i.number, title: i.title, type: i.type, fields: i.fields.filter((f) => f.kind === 'text').map((f) => f.name) })),
        selected: sel ? {
          key: sel.key, number: sel.number, title: sel.title,
          fields: sel.fields.filter((f) => f.kind === 'text').map((f) => f.name),
          colors: sel.fields.filter((f) => f.kind === 'color').map((f) => ({ name: f.name, value: f.value }))
        } : null,
        missing, colorCheck, overlays
      });
    } catch (err) {
      return send(res, 200, { ok: false, error: niceError(err, 'vMix', settings.vmix.url), inputs: [] });
    }
  }

  if (p === '/api/send' && m === 'POST') {
    const r = await push(true);
    return send(res, 200, { ...r, vmix: vmixStatus });
  }

  if (p === '/api/overlay' && m === 'POST') {
    const { channel = 1, action = 'In' } = await readBody(req);
    const ch = Math.max(1, Math.min(4, parseInt(channel, 10) || 1));
    const act = { in: 'In', out: 'Out', toggle: '' }[String(action).toLowerCase()] ?? 'In';
    try {
      if (!settings.vmix.input) throw new Error('Choose the vMix title input first (Settings)');
      if (act === 'In') await push(false); // make sure it's current before it goes up
      await vmixFunction(settings.vmix.url, `OverlayInput${ch}${act}`, { Input: settings.vmix.input });
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 200, { ok: false, error: niceError(err, 'vMix', settings.vmix.url) });
    }
  }

  // Presets: the header and rows, saved under a name.
  if (p === '/api/presets' && m === 'POST') {
    const { name } = await readBody(req);
    const n = String(name || '').trim().slice(0, 60);
    if (!n) return send(res, 400, { error: 'Give the preset a name' });
    settings.presets[n] = {
      header: settings.header, rowCount: settings.rowCount,
      rows: settings.rows.slice(0, settings.rowCount).map(cleanRow)
    };
    save();
    return send(res, 200, publicSettings());
  }
  const pm = p.match(/^\/api\/presets\/(.+)$/);
  if (pm) {
    const n = decodeURIComponent(pm[1]);
    const pr = settings.presets[n];
    if (!pr) return send(res, 404, { error: `No preset called "${n}"` });
    if (m === 'DELETE') { delete settings.presets[n]; save(); return send(res, 200, publicSettings()); }
    if (m === 'POST') { // load
      const presets = settings.presets;
      settings = mergeSettings(settings, { header: pr.header, rowCount: pr.rowCount, rows: pr.rows });
      settings.presets = presets;
      save();
      if (settings.live) push(false);
      return send(res, 200, publicSettings());
    }
  }

  return send(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

function listen(port, tries = 0) {
  // One-shot handlers per attempt, so a failed attempt's "listening" callback
  // can't fire later with the wrong port.
  const onError = (err) => {
    server.off('listening', onListening);
    if (err.code === 'EADDRINUSE' && tries < 10) {
      const next = port + 1 === 8088 || port + 1 === 8099 ? port + 2 : port + 1;
      console.log(`  Port ${port} is busy, trying ${next}…`);
      return listen(next, tries + 1);
    }
    console.error(err.message);
    process.exit(1);
  };
  const onListening = () => {
    server.off('error', onError);
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    console.log('\n  StatPop — OpenStatsEngine → vMix stat graphics');
    console.log(`  Local       : http://localhost:${port}`);
    for (const ip of ips) console.log(`  Network     : http://${ip}:${port}`);
    console.log(`  Data        : ${FILE}`);
    console.log(`  OSE         : ${settings.ose.url}`);
    console.log(`  vMix        : ${settings.vmix.url}\n`);
    if (args.includes('--open')) openBrowser(`http://localhost:${port}`);
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, '0.0.0.0');
}

/** Open the control page on the port we actually got (it may have moved). */
function openBrowser(url) {
  const [cmd, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* no browser */ }
}

listen(PORT);
