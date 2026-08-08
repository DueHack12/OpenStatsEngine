/* OpenStatsEngine — operator console */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers
  });
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(payload?.error || payload || `HTTP ${res.status}`);
  return payload;
}

function toast(msg, kind = '') {
  const n = el('div', `toastmsg ${kind}`, msg);
  $('#toast').appendChild(n);
  setTimeout(() => n.remove(), kind === 'err' ? 5200 : 2000);
}

/* ------------------------------------------------------------------ */
const S = {
  cfg: null, sports: [], teams: [], games: [],
  gameId: null, sport: null, state: null,
  side: 'home',
  sticky: { home: {}, away: {} },
  statsView: 'team',
  sources: {}, suggestedMap: null, importText: '', aux: null,
  clock: { base: 0, at: 0, running: false, down: true },
  rosterEdit: []
};

/* ---------------------------- boot ---------------------------- */
init();

async function init() {
  bindChrome();
  try {
    [S.cfg, S.sports, S.teams, S.games] = await Promise.all([
      api('/api/config'), api('/api/sports'), api('/api/teams'), api('/api/games')
    ]);
  } catch (e) { toast('Cannot reach server: ' + e.message, 'err'); return; }

  fillSelect('#ng-sport', S.sports.map((s) => [s.id, s.name]));
  fillSelect('#rs-sport', S.sports.map((s) => [s.id, s.name]));
  fillSelect('#ex-sport', S.sports.map((s) => [s.id, s.name]));
  $('#ng-date').value = new Date().toISOString().slice(0, 10);
  $('#ng-operator').value = S.cfg.operator || '';
  $('#ex-season').value = S.cfg.season || '';
  loadScorebotForm();
  refreshTeamSelects();
  renderGameList();

  if (S.cfg.activeGameId) await openGame(S.cfg.activeGameId);
  else showNoGame();

  connectStream();
  setInterval(tickClock, 200);
  renderVmix();
}

function fillSelect(sel, pairs, keep = false) {
  const n = $(sel); if (!n) return;
  const cur = n.value;
  n.innerHTML = '';
  for (const [v, t] of pairs) { const o = el('option', null, t); o.value = v; n.appendChild(o); }
  if (keep && cur) n.value = cur;
}

function refreshTeamSelects() {
  const pairs = S.teams.map((t) => [t.id, t.name]);
  for (const s of ['#ng-away', '#ng-home', '#rs-team', '#ex-team']) fillSelect(s, pairs, true);
  // Don't default both sides of a matchup to the same team.
  if (pairs.length > 1 && $('#ng-home').value === $('#ng-away').value) {
    $('#ng-home').value = pairs.find(([id]) => id !== $('#ng-away').value)[0];
  }
}

/* ---------------------------- chrome ---------------------------- */
function bindChrome() {
  $$('.tab').forEach((b) => b.onclick = () => go(b.dataset.tab));
  $$('[data-goto]').forEach((b) => b.onclick = () => go(b.dataset.goto));

  $('#btn-clock').onclick = () => clockOp(S.clock.running ? 'stop' : 'start');
  $$('[data-clockadj]').forEach((b) => b.onclick = () => {
    const delta = parseInt(b.dataset.clockadj, 10) * 1000;
    clockOp('set', { ms: Math.max(0, liveClockMs() + delta) });
  });
  $('[data-clockset]').onclick = () => {
    const v = prompt('Set clock (mm:ss)', fmtClock(liveClockMs()));
    if (v == null) return;
    const m = String(v).match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/) || String(v).match(/^(\d+)$/);
    if (!m) return toast('Use mm:ss', 'err');
    const ms = m[2] != null ? (parseInt(m[1], 10) * 60 + parseFloat(m[2])) * 1000 : parseInt(m[1], 10) * 60000;
    clockOp('set', { ms });
  };
  $$('[data-period]').forEach((b) => b.onclick = () => {
    const cur = S.state?.clock.period || 1;
    clockOp('period', { period: cur + (b.dataset.period === 'prev' ? -1 : 1) });
  });
  $('#btn-undo').onclick = undoLast;
  $('#btn-redo').onclick = redoLast;

  $$('.teambtn').forEach((b) => b.onclick = () => setSide(b.dataset.side));
  $('#sheet-close').onclick = closeSheet;
  $('#sheet').onclick = (e) => { if (e.target.id === 'sheet') closeSheet(); };

  $$('[data-statsview]').forEach((b) => b.onclick = () => {
    $$('[data-statsview]').forEach((x) => x.classList.remove('active'));
    b.classList.add('active'); S.statsView = b.dataset.statsview; renderStats();
  });

  $('#ng-create').onclick = createGame;
  $('#tm-save').onclick = saveTeam;
  $('#rs-load').onclick = loadRoster;
  $('#rs-save').onclick = saveRoster;
  $('#rs-addrow').onclick = () => { S.rosterEdit.push({ number: '', name: '', pos: '', year: '' }); renderRosterTable(); };
  $('#rs-csv').onclick = () => window.open(`/api/teams/${$('#rs-team').value}/export/roster.csv?sport=${$('#rs-sport').value}`);
  $('#rs-url-preview').onclick = () => importRoster({ url: $('#rs-url').value, preview: true });
  $('#rs-url-import').onclick = () => importRoster({ url: $('#rs-url').value });
  $('#rs-paste-import').onclick = () => importRoster({ csv: $('#rs-paste').value });
  $('#rs-stats-import').onclick = () => importStats(false);
  $('#sb-save').onclick = saveScorebot;
  $('#sb-test').onclick = testScorebot;
  $('#sb-startstop').onclick = toggleScorebot;
  $('#ex-commit').onclick = commitGame;
  $('#ex-season-go').onclick = () => window.open(
    `/api/teams/${$('#ex-team').value}/export/season.csv?sport=${$('#ex-sport').value}&season=${encodeURIComponent($('#ex-season').value)}`);
  $('#sheet-save').onclick = saveSheet;

  // baseball situation strip
  $$('[data-half]').forEach((b) => b.onclick = () => setSituation({ half: b.dataset.half }));
  $$('[data-count]').forEach((b) => b.onclick = () => {
    const k = b.dataset.count;
    const sit = S.state?.situation || {};
    if (k === 'reset') return setSituation({ balls: 0, strikes: 0 });
    const caps = { balls: 4, strikes: 3, outs: 3 };
    const next = ((sit[k] || 0) + 1) % (caps[k] + 1);
    setSituation({ [k]: next });
  });
  $$('[data-base]').forEach((b) => b.onclick = () => {
    const cur = S.state?.situation?.bases || {};
    const bases = {
      first: !!cur.first, second: !!cur.second, third: !!cur.third,
      [b.dataset.base]: !cur[b.dataset.base]
    };
    setSituation({ bases });
  });

  // play clock / shot clock
  $('#aux-toggle').onclick = () => auxOp(S.aux?.running ? 'auxStop' : 'auxStart');
  $('#aux-auto').onchange = (e) => auxOp('auxConfig', { autoReset: e.target.checked });
  $('#aux-on').onchange = (e) => auxOp('auxConfig', { enabled: e.target.checked });

  // bulk team import
  $('#tm-sheet-preview').onclick = () => importTeamSheet(true);
  $('#tm-sheet-import').onclick = () => importTeamSheet(false);

  // scorebot
  $('#sb-parse').onclick = parseScorebotSample;
  $('#sb-apply-map').onclick = applySuggestedMap;

  // imports
  $('#rs-file').onchange = loadImportFile;
  $('#rs-paste').oninput = () => showDetectedFormat($('#rs-paste').value);
  $('#rs-stats-preview').onclick = () => importStats(true);
  $('#hist-load').onclick = loadHistory;
  $('#hist-csv').onclick = () => window.open(
    `/api/teams/${$('#rs-team').value}/export/season.csv?sport=${$('#rs-sport').value}&season=${encodeURIComponent(S.cfg.season || '')}`);

  document.addEventListener('keydown', onKey);
}

function go(tab) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  if (tab === 'stats') renderStats();
  if (tab === 'export') renderExport();
  if (tab === 'vmix') renderVmix();
  if (tab === 'setup') renderGameList();
}

/* ---------------------------- live stream ---------------------------- */
function connectStream() {
  const es = new EventSource('/api/stream');
  es.onopen = () => $('#conn').classList.add('ok');
  es.onerror = () => $('#conn').classList.remove('ok');
  es.addEventListener('update', async (e) => {
    const d = JSON.parse(e.data || '{}');
    if (d.gameId && d.gameId === S.gameId) await refreshState();
  });
}

/* ---------------------------- game ---------------------------- */
async function openGame(id) {
  try {
    const meta = await api(`/api/games/${encodeURIComponent(id)}`);
    S.gameId = id;
    S.sport = await api(`/api/sports/${meta.sport}`);
    S.sticky = { home: {}, away: {} };
    await refreshState();
    $('#nogame').classList.add('hidden');
    renderPalette();
    renderTeamSwitch();
  } catch (e) { toast(e.message, 'err'); showNoGame(); }
}

function showNoGame() {
  S.gameId = null; S.state = null;
  $('#nogame').classList.remove('hidden');
  for (const id of ['#scoreboard', '#clockbar', '#teamswitch', '#palette', '#recent']) $(id).classList.add('hidden');
}

async function refreshState() {
  if (!S.gameId) return;
  S.state = await api(`/api/games/${encodeURIComponent(S.gameId)}/state`);
  applyState();
}

function applyState() {
  const st = S.state; if (!st) return;
  for (const id of ['#scoreboard', '#clockbar', '#teamswitch', '#palette', '#recent']) $(id).classList.remove('hidden');
  S.clock = { base: st.clock.clockMs, at: Date.now(), running: st.clock.running, down: st.clock.countsDown };

  for (const side of ['home', 'away']) {
    const box = $(`#sb-${side}`), t = st.teams[side];
    $('.sb-abbr', box).textContent = t.abbrev || t.name;
    $('.sb-score', box).textContent = t.points;
    box.classList.toggle('poss', st.situation?.possession === side);
  }
  $('#sb-period').textContent = `${st.clock.periodLabel} ${S.sport.periods.label}`.toUpperCase();
  const maxPeriod = S.sport.periods.count + (S.sport.periods.maxOvertimes ?? 3);
  const prevBtn = $('[data-period="prev"]'), nextBtn = $('[data-period="next"]');
  if (prevBtn) prevBtn.disabled = st.clock.period <= 1;
  if (nextBtn) {
    nextBtn.disabled = st.clock.period >= maxPeriod;
    nextBtn.title = nextBtn.disabled ? `Capped at ${S.sport.periods.label.toLowerCase()} ${maxPeriod}` : '';
  }
  $('#btn-clock').textContent = st.clock.running ? '❚❚ Stop' : '▶ Start';
  $('#btn-clock').classList.toggle('on', st.clock.running);
  $('#sb-clock').classList.toggle('running', st.clock.running);

  const sit = st.situation || {};
  let sitTxt = '';
  if (sit.down != null && S.sport.trackDownDistance) {
    sitTxt = `${ordinal(sit.down)} & ${sit.distance === 0 ? 'Goal' : sit.distance}`;
    if (sit.possession) sitTxt += ` · ${st.teams[sit.possession].abbrev}`;
  } else if (sit.outs != null && S.sport.hasCount) {
    sitTxt = `${sit.half === 'top' ? '▲' : '▼'} ${st.clock.periodLabel} · ${sit.outs} out`;
  } else if (sit.possession) {
    sitTxt = `Poss: ${st.teams[sit.possession].abbrev}`;
  }
  $('#sb-situation').textContent = sitTxt;

  S.aux = st.auxClock
    ? { ...st.auxClock, at: Date.now(), base: st.auxClock.ms }
    : null;

  renderTeamSwitch();
  renderDiamond();
  renderAux();
  renderRecent();
  tickClock();
  if ($('#view-stats').classList.contains('active')) renderStats();
}

/* ---------------------------- baseball situation ---------------------------- */
function renderDiamond() {
  const bar = $('#diamondbar');
  if (!S.sport?.hasCount) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const sit = S.state?.situation || {};
  $('#cnt-balls').textContent = sit.balls ?? 0;
  $('#cnt-strikes').textContent = sit.strikes ?? 0;
  $('#cnt-outs').textContent = sit.outs ?? 0;
  $$('[data-half]').forEach((b) => b.classList.toggle('on', (sit.half || 'top') === b.dataset.half));
  const bases = sit.bases || {};
  $$('[data-base]').forEach((b) => b.classList.toggle('on', !!bases[b.dataset.base]));
}

async function setSituation(patch) {
  if (!S.gameId) return;
  try {
    S.state = await api(`/api/games/${encodeURIComponent(S.gameId)}/situation`, {
      method: 'POST', body: JSON.stringify(patch)
    });
    applyState();
  } catch (e) { toast(e.message, 'err'); }
}

function liveClockMs() {
  const c = S.clock;
  if (!c.running) return c.base;
  const d = Date.now() - c.at;
  return c.down ? Math.max(0, c.base - d) : c.base + d;
}

function tickClock() {
  if (!S.state) return;
  if (S.sport?.hasClock !== false) $('#sb-clock').textContent = fmtClock(liveClockMs());
  else $('#sb-clock').textContent = '—';
  tickAux();
}

/* ---------------------------- play / shot clock ---------------------------- */
function liveAuxMs() {
  const a = S.aux;
  if (!a) return 0;
  if (!a.running) return a.base;
  return Math.max(0, a.base - (Date.now() - a.at));
}

function renderAux() {
  const bar = $('#auxbar'), box = $('#sb-aux');
  if (!S.aux) { bar.classList.add('hidden'); box.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  box.classList.toggle('hidden', !S.aux.enabled);
  $('#aux-title').textContent = S.aux.label;
  $('#sb-aux-lbl').textContent = S.aux.label;
  $('#aux-toggle').textContent = S.aux.running ? '❚❚ Stop' : '▶ Start';
  $('#aux-toggle').classList.toggle('on', S.aux.running);
  // A linked clock follows the game clock, so its own start button is noise.
  $('#aux-toggle').classList.toggle('hidden', !!S.aux.linked);
  $('#aux-auto').checked = !!S.aux.autoReset;
  // If the feed owns this clock, say so — the manual controls still work as an
  // override, but the next poll will correct them.
  const fromFeed = (S.cfg?.scorebot?.sources?.auxClock ?? 'scorebot') === 'scorebot'
    && !!S.cfg?.scorebot?.enabled;
  $('#aux-src').textContent = fromFeed ? 'from Scorebot' : '';
  $('#aux-src').classList.toggle('hidden', !fromFeed);
  $('#aux-on').checked = !!S.aux.enabled;

  const wrap = $('#aux-presets');
  wrap.innerHTML = '';
  for (const secs of S.aux.presets || []) {
    const b = el('button', 'ctl', String(secs));
    b.onclick = () => auxOp('aux', { ms: secs * 1000 });
    wrap.appendChild(b);
  }
  tickAux();
}

function tickAux() {
  if (!S.aux || !S.aux.enabled) return;
  const ms = liveAuxMs();
  const secs = Math.ceil(ms / 1000);
  const val = $('#sb-aux-val');
  val.textContent = secs;
  val.classList.toggle('expired', ms <= 0);
  val.classList.toggle('warn', ms > 0 && ms <= 5000);
}

async function auxOp(op, extra = {}) {
  if (!S.gameId) return;
  try {
    S.state = await api(`/api/games/${encodeURIComponent(S.gameId)}/clock`, {
      method: 'POST', body: JSON.stringify({ op, ...extra })
    });
    applyState();
  } catch (e) { toast(e.message, 'err'); }
}

function fmtClock(ms) {
  ms = Math.max(0, ms || 0);
  const t = ms / 1000, m = Math.floor(t / 60), s = t - m * 60;
  if (m === 0 && ms < 60000) return `:${s.toFixed(1).padStart(4, '0')}`;
  return `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
}
const ordinal = (n) => ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;

async function clockOp(op, extra = {}) {
  if (!S.gameId) return;
  try {
    S.state = await api(`/api/games/${encodeURIComponent(S.gameId)}/clock`, {
      method: 'POST', body: JSON.stringify({ op, ...extra })
    });
    applyState();
  } catch (e) { toast(e.message, 'err'); }
}

function setSide(side) { S.side = side; renderTeamSwitch(); }

function renderTeamSwitch() {
  $$('.teambtn').forEach((b) => {
    const side = b.dataset.side;
    b.classList.toggle('active', side === S.side);
    $('.tb-name', b).textContent = S.state ? (S.state.teams[side].shortName || S.state.teams[side].name) : side;
  });
}

/* ---------------------------- palette ---------------------------- */
let HOTKEYS = [];

function renderPalette() {
  const wrap = $('#palette'); wrap.innerHTML = ''; HOTKEYS = [];
  for (const g of S.sport.palette) {
    const box = el('div', 'pgroup');
    box.appendChild(el('h3', null, g.group));
    const btns = el('div', 'pbtns');
    for (const a of g.actions) {
      const b = el('button', 'pbtn');
      b.dataset.color = a.color || g.color || '';
      const hk = HOTKEYS.length < 9 ? String(HOTKEYS.length + 1) : '';
      b.innerHTML = `${esc(a.label)}${hk ? `<span class="hk">${hk}</span>` : ''}`;
      b.onclick = () => openSheet(a);
      if (hk) HOTKEYS.push(a);
      btns.appendChild(b);
    }
    box.appendChild(btns);
    wrap.appendChild(box);
  }
}

function renderRecent() {
  const list = $('#recent-list'); list.innerHTML = '';
  const items = (S.state?.timeline || []).slice(0, 40);
  const undone = S.state?.undone || [];
  $('#recent-count').textContent = `${S.state?.counts.effective ?? 0} entries` +
    (undone.length ? ` · ${undone.length} undone` : '');
  $('#btn-redo').disabled = !undone.length;

  // Undone entries stay visible so a specific one can be put back, rather than
  // only being able to reverse the most recent undo.
  for (const t of undone.slice(0, 6)) {
    const li = el('li', 'undone');
    li.appendChild(el('span', 'rl-time', `${t.periodLabel ?? ''} ${t.clock ?? ''}`));
    li.appendChild(el('span', 'rl-team', t.team ? S.state.teams[t.team].abbrev : ''));
    const main = el('div', 'rl-main');
    main.appendChild(el('div', null, t.label));
    if (t.text) main.appendChild(el('div', 'rl-detail', t.text));
    li.appendChild(main);
    const r = el('button', 'rl-undo redo', '↷ redo');
    r.onclick = () => redoEvent(t.id);
    li.appendChild(r);
    list.appendChild(li);
  }
  for (const t of items) {
    const li = el('li');
    li.appendChild(el('span', 'rl-time', `${t.periodLabel ?? ''} ${t.clock ?? ''}`));
    li.appendChild(el('span', 'rl-team', t.team ? S.state.teams[t.team].abbrev : ''));
    const main = el('div', 'rl-main');
    main.appendChild(el('div', t.type === 'stat' ? '' : 'rl-sys', t.label + (t.corrected ? ' (edited)' : '')));
    if (t.text) main.appendChild(el('div', 'rl-detail', t.text));
    li.appendChild(main);
    if (t.type === 'stat') {
      const u = el('button', 'rl-undo', 'undo');
      u.onclick = () => undoEvent(t.id);
      li.appendChild(u);
    }
    list.appendChild(li);
  }
}

async function undoLast() {
  if (!S.gameId) return;
  try {
    const r = await api(`/api/games/${encodeURIComponent(S.gameId)}/undo`, { method: 'POST', body: '{}' });
    S.state = r.state; applyState(); toast('Undone');
  } catch (e) { toast(e.message, 'err'); }
}

async function redoLast() {
  if (!S.gameId) return;
  try {
    const r = await api(`/api/games/${encodeURIComponent(S.gameId)}/redo`, { method: 'POST', body: '{}' });
    S.state = r.state; applyState(); toast('Restored', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function redoEvent(id) {
  try {
    const r = await api(`/api/games/${encodeURIComponent(S.gameId)}/redo`, {
      method: 'POST', body: JSON.stringify({ eventId: id })
    });
    S.state = r.state; applyState(); toast('Restored', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function undoEvent(id) {
  try {
    const r = await api(`/api/games/${encodeURIComponent(S.gameId)}/undo`, {
      method: 'POST', body: JSON.stringify({ eventId: id })
    });
    S.state = r.state; applyState(); toast('Undone');
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------------------------- entry sheet ---------------------------- */
let SHEET = null;

function openSheet(action) {
  if (!S.state) return;
  const vals = {};
  for (const f of action.fields || []) {
    if (f.sticky && S.sticky[S.side][f.name] != null) vals[f.name] = S.sticky[S.side][f.name];
    else if (f.default !== undefined) vals[f.name] = f.default;
    else if (f.type === 'toggle') vals[f.name] = false;
    else if (f.type === 'players' || f.type === 'players_opp') vals[f.name] = [];
    else if (f.type === 'number') vals[f.name] = 0;
    else vals[f.name] = f.type === 'select' ? (f.options?.[0] ?? '') : null;
  }
  // Snapshot the starting values so an untouched optional field is not saved.
  SHEET = { action, vals, init: JSON.parse(JSON.stringify(vals)), activeNum: null };
  $('#sheet-title').textContent = action.label;
  $('#sheet-team').textContent = (S.state.teams[S.side].shortName || S.state.teams[S.side].name).toUpperCase();
  renderSheetFields();
  $('#sheet').classList.remove('hidden');

  // If nothing needs input at all, this is a one-tap action — save immediately.
  if (!(action.fields || []).length) saveSheet();
}

function closeSheet() { $('#sheet').classList.add('hidden'); SHEET = null; }

function renderSheetFields() {
  const wrap = $('#sheet-fields'); wrap.innerHTML = '';
  const { action, vals } = SHEET;
  const other = S.side === 'home' ? 'away' : 'home';

  for (const f of action.fields || []) {
    const box = el('div', 'field' + (f.optional ? ' optional collapsed' : ''));
    const lab = el('div', 'flabel');
    lab.appendChild(el('span', null, f.label));
    const valSpan = el('span', 'fval');
    lab.appendChild(valSpan);
    if (f.optional) {
      const more = el('button', 'fmore', '+ add');
      more.onclick = () => { box.classList.toggle('collapsed'); more.textContent = box.classList.contains('collapsed') ? '+ add' : '− hide'; };
      lab.appendChild(more);
    }
    box.appendChild(lab);
    const body = el('div', 'fbody');
    box.appendChild(body);

    const setVal = (v) => { vals[f.name] = v; paintLabel(); };
    const paintLabel = () => {
      const v = vals[f.name];
      if (f.type === 'player' || f.type === 'player_opp') valSpan.textContent = v ? playerLabel(f.type === 'player' ? S.side : other, v) : '';
      else if (f.type === 'players' || f.type === 'players_opp') valSpan.textContent = (v || []).length ? `${v.length} selected` : '';
      else if (f.type === 'toggle') valSpan.textContent = v ? 'YES' : '';
      else valSpan.textContent = v === 0 || v ? String(v) : '';
    };

    if (f.type === 'player' || f.type === 'player_opp') {
      body.appendChild(playerGrid(f.type === 'player' ? S.side : other, () => vals[f.name], (id) => {
        setVal(vals[f.name] === id ? null : id);
        renderSheetFields();
      }));
    } else if (f.type === 'players' || f.type === 'players_opp') {
      body.appendChild(playerGrid(f.type === 'players' ? S.side : other, () => vals[f.name] || [], (id) => {
        const cur = vals[f.name] || [];
        setVal(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
        renderSheetFields();
      }, true));
    } else if (f.type === 'number') {
      if (SHEET.activeNum == null) SHEET.activeNum = f.name;
      body.appendChild(numpad(f, () => vals[f.name], setVal));
    } else if (f.type === 'toggle') {
      const c = el('button', 'chip' + (vals[f.name] ? ' on' : ''), f.label);
      c.onclick = () => { setVal(!vals[f.name]); renderSheetFields(); };
      const row = el('div', 'chips'); row.appendChild(c); body.appendChild(row);
    } else if (f.type === 'select') {
      const row = el('div', 'chips');
      for (const o of f.options || []) {
        const c = el('button', 'chip' + (vals[f.name] === o ? ' active' : ''), o);
        c.onclick = () => { setVal(o); renderSheetFields(); };
        row.appendChild(c);
      }
      body.appendChild(row);
    } else {
      const inp = el('input');
      inp.value = vals[f.name] ?? '';
      inp.oninput = () => setVal(inp.value);
      body.appendChild(inp);
    }
    paintLabel();
    // A filled optional field should stay visible after a re-render.
    if (f.optional && isFilled(vals[f.name])) box.classList.remove('collapsed');
    wrap.appendChild(box);
  }
}

const isFilled = (v) => Array.isArray(v) ? v.length > 0 : (v !== null && v !== undefined && v !== '' && v !== false && v !== 0);

function playerLabel(side, id) {
  const p = (S.state.rosters[side] || []).find((x) => x.id === id);
  return p ? `#${p.number} ${p.name}` : id;
}

function playerGrid(side, getVal, onPick, multi = false) {
  const grid = el('div', 'pgrid');
  const roster = S.state.rosters[side] || [];
  if (!roster.length) {
    const w = el('div', 'hint', `No roster loaded for ${S.state.teams[side].name}. Add one in the Teams tab, or entries will save without a player.`);
    grid.appendChild(w);
    return grid;
  }
  const cur = getVal();
  for (const p of roster) {
    const sel = multi ? (cur || []).includes(p.id) : cur === p.id;
    const c = el('button', 'pcell' + (sel ? ' sel' : ''));
    c.appendChild(el('span', 'num', p.number || '–'));
    c.appendChild(el('span', 'nm', p.name || ''));
    c.onclick = () => onPick(p.id);
    grid.appendChild(c);
  }
  return grid;
}

function numpad(f, getVal, setVal) {
  const wrap = el('div', 'numpad');
  const disp = el('div', 'numval', String(getVal() ?? 0));
  wrap.appendChild(disp);
  let buf = String(getVal() ?? 0);
  let fresh = true; // first digit replaces the default rather than appending
  const push = (ch) => {
    if (ch === 'C') buf = '0';
    else if (ch === '←') buf = buf.length > 1 ? buf.slice(0, -1) : '0';
    else if (ch === '±') buf = buf.startsWith('-') ? buf.slice(1) : '-' + buf;
    else {
      if (fresh) { buf = ch; fresh = false; }
      else buf = buf === '0' ? ch : (buf === '-0' ? '-' + ch : buf + ch);
    }
    disp.textContent = buf;
    setVal(parseInt(buf, 10) || 0);
  };
  wrap._push = push;
  const keys = ['7', '8', '9', '←', 'C', '4', '5', '6', '±', '+10', '1', '2', '3', '0', '−10'];
  for (const k of keys) {
    const b = el('button', null, k);
    b.onclick = () => {
      if (k === '+10' || k === '−10') {
        const n = (parseInt(buf, 10) || 0) + (k === '+10' ? 10 : -10);
        buf = String(n); fresh = false; disp.textContent = buf; setVal(n);
      } else push(k);
    };
    wrap.appendChild(b);
  }
  if (!f.neg) $$('button', wrap).find((b) => b.textContent === '±')?.setAttribute('disabled', 'true');
  return wrap;
}

async function saveSheet() {
  if (!SHEET || !S.gameId) return;
  const { action, vals, init } = SHEET;
  const data = {};
  for (const f of action.fields || []) {
    const v = vals[f.name];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (v === false) continue;
    // An optional field the operator never touched carries no information.
    if (f.optional && JSON.stringify(v) === JSON.stringify(init[f.name])) continue;
    data[f.name] = v;
    if (f.sticky) S.sticky[S.side][f.name] = v;
  }
  const btn = $('#sheet-save'); btn.disabled = true;
  try {
    const r = await api(`/api/games/${encodeURIComponent(S.gameId)}/events`, {
      method: 'POST',
      body: JSON.stringify({ type: 'stat', team: S.side, action: action.key, data })
    });
    S.state = r.state;
    closeSheet();
    applyState();
    toast(action.label + ' saved', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

/* ---------------------------- keyboard ---------------------------- */
function onKey(e) {
  const typing = /input|textarea|select/i.test(e.target.tagName) && e.target.type !== 'checkbox';
  const sheetOpen = !$('#sheet').classList.contains('hidden');

  if (sheetOpen) {
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key === 'Enter') { e.preventDefault(); saveSheet(); return; }
    if (typing) return;
    const pad = $('.numpad');
    if (pad && /^[0-9]$/.test(e.key)) { e.preventDefault(); pad._push(e.key); }
    else if (pad && e.key === 'Backspace') { e.preventDefault(); pad._push('←'); }
    else if (pad && e.key === '-') { e.preventDefault(); pad._push('±'); }
    return;
  }
  if (typing) return;
  if (!$('#view-live').classList.contains('active')) return;

  if (e.key === ' ') { e.preventDefault(); clockOp(S.clock.running ? 'stop' : 'start'); }
  else if (e.key === 'u' || e.key === 'z') { e.preventDefault(); undoLast(); }
  else if (e.key === 'y' || e.key === 'Z') { e.preventDefault(); redoLast(); }
  else if (e.key === 'a') setSide('away');
  else if (e.key === 'h') setSide('home');
  else if (e.key === 'r' && S.aux) { e.preventDefault(); auxOp('aux', { ms: S.aux.fullMs }); }
  else if (e.key === 'p' && S.aux && !S.aux.linked) { e.preventDefault(); auxOp(S.aux.running ? 'auxStop' : 'auxStart'); }
  else if (/^[1-9]$/.test(e.key)) {
    const a = HOTKEYS[parseInt(e.key, 10) - 1];
    if (a) { e.preventDefault(); openSheet(a); }
  }
}

/* ---------------------------- stats ---------------------------- */
function renderStats() {
  const body = $('#statsbody');
  if (!S.state) { body.innerHTML = '<div class="empty">No active game.</div>'; return; }
  const st = S.state;
  body.innerHTML = '';

  if (S.statsView === 'team') {
    const nPer = Math.max(st.clock.periodCount, st.clock.period);
    let ls = '<div class="tbltitle">Linescore</div><div class="tblwrap"><table class="tbl"><thead><tr><th>Team</th>';
    for (let p = 1; p <= nPer; p++) ls += `<th>${p > st.clock.periodCount ? 'OT' : p}</th>`;
    ls += '<th>T</th></tr></thead><tbody>';
    for (const side of ['away', 'home']) {
      const t = st.teams[side];
      ls += `<tr><td>${esc(t.name)}</td>`;
      for (let p = 1; p <= nPer; p++) ls += `<td>${t.byPeriod?.[p] ?? 0}</td>`;
      ls += `<td><b>${t.points}</b></td></tr>`;
    }
    ls += '</tbody></table></div>';

    let cmp = '<div class="tbltitle">Team Stats</div><table class="cmp">';
    cmp += `<tr><td><b>${esc(st.teams.away.abbrev)}</b></td><td></td><td><b>${esc(st.teams.home.abbrev)}</b></td></tr>`;
    for (const [k, label] of S.sport.teamStatRows) {
      cmp += `<tr><td>${esc(fmtv(st.teams.away[k]))}</td><td>${esc(label)}</td><td>${esc(fmtv(st.teams.home[k]))}</td></tr>`;
    }
    cmp += '</table>';

    const dr = `<div class="tbltitle">Situational</div><table class="cmp">
      <tr><td>${esc(st.droughts.away.display)}</td><td>Since last score</td><td>${esc(st.droughts.home.display)}</td></tr>
      <tr><td>${st.runs.best.away}</td><td>Biggest run</td><td>${st.runs.best.home}</td></tr>
      <tr><td colspan="3" style="text-align:center;color:var(--dim);font-size:11.5px">
        Elapsed ${esc(st.situation.elapsedDisplay)} · ${st.counts.effective} entries logged</td></tr></table>`;
    body.innerHTML = ls + cmp + dr;
    return;
  }

  if (S.statsView === 'away' || S.statsView === 'home') {
    const side = S.statsView;
    const players = Object.values(st.players).filter((p) => p.side === side);
    if (!players.length) { body.innerHTML = '<div class="empty">No stats logged for this team yet.</div>'; return; }
    for (const tbl of S.sport.playerStatTables) {
      const rows = players.filter((p) => hasAny(p, tbl.cols)).sort((a, b) => numCmp(a.number, b.number));
      if (!rows.length) continue;
      let h = `<div class="tbltitle">${esc(st.teams[side].name)} — ${esc(tbl.label)}</div><div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th>Pos</th>`;
      for (const [, l] of tbl.cols) h += `<th>${esc(l)}</th>`;
      h += '</tr></thead><tbody>';
      for (const p of rows) {
        h += `<tr><td>${esc(p.number)}</td><td>${esc(p.name)}</td><td>${esc(p.pos)}</td>`;
        for (const [k] of tbl.cols) h += `<td>${esc(fmtv(p[k]))}</td>`;
        h += '</tr>';
      }
      h += '</tbody></table></div>';
      body.insertAdjacentHTML('beforeend', h);
    }
    return;
  }

  if (S.statsView === 'leaders') {
    for (const cat of S.sport.leaderCategories) {
      const L = st.leaders[cat.key];
      if (!L?.rows.length) continue;
      let h = `<div class="tbltitle">${esc(L.label)}</div><div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th>Team</th><th>Line</th></tr></thead><tbody>`;
      for (const r of L.rows) {
        h += `<tr><td>${esc(r.number)}</td><td>${esc(r.name)}</td><td>${esc(st.teams[r.side].abbrev)}</td><td style="text-align:left">${esc(r.line)}</td></tr>`;
      }
      h += '</tbody></table></div>';
      body.insertAdjacentHTML('beforeend', h);
    }
    if (!body.innerHTML) body.innerHTML = '<div class="empty">No leaders yet.</div>';
    return;
  }

  if (S.statsView === 'scoring') {
    if (!st.scoringPlays.length) { body.innerHTML = '<div class="empty">No scoring yet.</div>'; return; }
    let h = '<div class="tblwrap"><table class="tbl"><thead><tr><th>Per</th><th>Clock</th><th>Team</th><th>Play</th><th>A</th><th>H</th></tr></thead><tbody>';
    for (const s of st.scoringPlays) {
      h += `<tr><td>${esc(s.periodLabel)}</td><td>${esc(s.clock)}</td><td>${esc(st.teams[s.side].abbrev)}</td>
        <td style="text-align:left;white-space:normal">${esc(s.desc)}</td><td>${s.awayScore}</td><td>${s.homeScore}</td></tr>`;
    }
    body.innerHTML = h + '</tbody></table></div>';
    return;
  }

  // play-by-play
  let h = '<div class="tblwrap"><table class="tbl"><thead><tr><th>Per</th><th>Clock</th><th>Tm</th><th>Play</th><th>Logged</th></tr></thead><tbody>';
  for (const t of st.timeline) {
    h += `<tr><td>${esc(t.periodLabel ?? '')}</td><td>${esc(t.clock ?? '')}</td>
      <td>${t.team ? esc(st.teams[t.team].abbrev) : ''}</td>
      <td style="text-align:left;white-space:normal">${esc(t.label)}${t.text ? ' — <span style="color:var(--dim)">' + esc(t.text) + '</span>' : ''}</td>
      <td style="color:var(--dim);font-size:11px">${esc(t.tsLocal ?? '')}</td></tr>`;
  }
  body.innerHTML = h + '</tbody></table></div>';
}

const hasAny = (p, cols) => cols.some(([k]) => { const v = p[k]; return typeof v === 'number' ? v !== 0 : (v && !/^0([-/]0)?$|^\.000$|^0\.0$/.test(String(v))); });
const numCmp = (a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999);
const fmtv = (v) => v == null ? '' : (typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(1)) : v);

/* ---------------------------- setup ---------------------------- */
async function createGame() {
  try {
    const plen = parseFloat($('#ng-plen').value);
    const meta = await api('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        sport: $('#ng-sport').value,
        date: $('#ng-date').value,
        homeTeamId: $('#ng-home').value,
        awayTeamId: $('#ng-away').value,
        level: $('#ng-level').value,
        venue: $('#ng-venue').value,
        operator: $('#ng-operator').value,
        settings: isFinite(plen) && plen > 0 ? { periodLengthMs: plen * 60000 } : {}
      })
    });
    if ($('#ng-operator').value) await api('/api/config', { method: 'POST', body: JSON.stringify({ operator: $('#ng-operator').value }) });
    S.games = await api('/api/games');
    renderGameList();
    await openGame(meta.id);
    go('live');
    toast('Game created', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

function renderGameList() {
  const wrap = $('#gamelist'); wrap.innerHTML = '';
  if (!S.games.length) { wrap.innerHTML = '<div class="hint">No games yet.</div>'; return; }
  const list = el('div', 'glist');
  for (const g of S.games) {
    const row = el('div', 'grow' + (g.id === S.gameId ? ' active' : ''));
    const main = el('div', 'gmain');
    main.appendChild(el('div', null, `${g.awayName} at ${g.homeName}`));
    main.appendChild(el('div', 'gsub', `${g.date} · ${g.sport} · ${g.level} · ${g.status}${g.venue ? ' · ' + g.venue : ''}`));
    row.appendChild(main);
    const act = el('button', null, g.id === S.gameId ? 'Active' : 'Make Active');
    act.onclick = async () => {
      await api(`/api/games/${encodeURIComponent(g.id)}/activate`, { method: 'POST', body: '{}' });
      await openGame(g.id); renderGameList(); go('live');
    };
    row.appendChild(act);
    const del = el('button', null, 'Delete');
    del.onclick = async () => {
      if (!confirm(`Delete "${g.id}" and all of its logged entries? This cannot be undone.`)) return;
      await api(`/api/games/${encodeURIComponent(g.id)}`, { method: 'DELETE' });
      S.games = await api('/api/games');
      if (S.gameId === g.id) showNoGame();
      renderGameList(); toast('Deleted');
    };
    row.appendChild(del);
    list.appendChild(row);
  }
  wrap.appendChild(list);
}

/* ---------------------------- teams ---------------------------- */
async function saveTeam() {
  try {
    const t = await api('/api/teams', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#tm-name').value, shortName: $('#tm-short').value,
        abbrev: $('#tm-abbr').value, mascot: $('#tm-mascot').value,
        primaryColor: $('#tm-color').value, secondaryColor: $('#tm-color2').value
      })
    });
    S.teams = await api('/api/teams');
    refreshTeamSelects();
    $('#rs-team').value = t.id;
    toast(`Saved ${t.name}`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function loadRoster() {
  const team = currentTeamId(); if (!team) return;
  try {
    const r = await api(`/api/teams/${team}/roster?sport=${$('#rs-sport').value}`);
    S.rosterEdit = r.players.map((p) => ({ ...p }));
    renderRosterTable();
    toast(`${r.players.length} players`);
  } catch (e) { toast(e.message, 'err'); }
}

function renderRosterTable() {
  const wrap = $('#rostertable');
  if (!S.rosterEdit.length) { wrap.innerHTML = '<div class="hint">No players loaded.</div>'; return; }
  let h = '<div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th>Name</th><th>Pos</th><th>Yr</th><th></th></tr></thead><tbody>';
  S.rosterEdit.forEach((p, i) => {
    h += `<tr>
      <td><input data-i="${i}" data-k="number" value="${esc(p.number ?? '')}" style="width:56px"></td>
      <td><input data-i="${i}" data-k="name" value="${esc(p.name ?? '')}"></td>
      <td><input data-i="${i}" data-k="pos" value="${esc(p.pos ?? '')}" style="width:70px"></td>
      <td><input data-i="${i}" data-k="year" value="${esc(p.year ?? '')}" style="width:56px"></td>
      <td><button data-del="${i}">✕</button></td></tr>`;
  });
  wrap.innerHTML = h + '</tbody></table></div>';
  $$('input[data-i]', wrap).forEach((inp) => inp.oninput = () => {
    S.rosterEdit[+inp.dataset.i][inp.dataset.k] = inp.value;
  });
  $$('[data-del]', wrap).forEach((b) => b.onclick = () => {
    S.rosterEdit.splice(+b.dataset.del, 1); renderRosterTable();
  });
}

async function saveRoster() {
  const team = currentTeamId(); if (!team) return;
  try {
    const players = S.rosterEdit.filter((p) => String(p.name || '').trim());
    const r = await api(`/api/teams/${team}/roster`, {
      method: 'POST',
      body: JSON.stringify({ sport: $('#rs-sport').value, players, mode: 'replace' })
    });
    S.rosterEdit = r.roster.map((p) => ({ ...p }));
    renderRosterTable();
    if (S.gameId) await refreshState();
    toast(`Saved ${r.count} players`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function importTeamSheet(preview) {
  const out = $('#tm-sheet-out');
  const url = $('#tm-sheet').value.trim();
  if (!url) return toast('Paste the Google Sheets link first', 'err');
  out.textContent = preview ? 'Reading sheet…' : 'Importing…';
  try {
    const r = await api('/api/teams/import-sheet', {
      method: 'POST', body: JSON.stringify({ url, preview })
    });
    const lines = [
      `${preview ? 'PREVIEW — nothing saved yet' : 'IMPORTED'}`,
      `${r.teams.length} teams · ${r.withColor} with a colour from the sheet`, ''
    ];
    for (const t of r.teams.slice(0, 20)) {
      lines.push(`   ${(t.abbrev || '?').padEnd(6)} ${String(t.name).slice(0, 40).padEnd(42)} ${t.primaryColor || '(default)'}`);
    }
    if (r.teams.length > 20) lines.push(`   … and ${r.teams.length - 20} more`);
    if (r.warnings?.length) lines.push('', 'NOTES:', ...r.warnings.map((w) => '  • ' + w));
    out.textContent = lines.join('\n');
    if (!preview) {
      S.teams = await api('/api/teams');
      refreshTeamSelects();
      toast(`${r.imported} teams imported`, 'ok');
    }
  } catch (e) { out.textContent = 'Error: ' + e.message; toast(e.message, 'err'); }
}

/** Guard every team-scoped call: an empty select would build /api/teams//… */
function currentTeamId() {
  const id = $('#rs-team').value;
  if (!id) {
    const msg = S.teams.length
      ? 'Pick a team from the Team dropdown first.'
      : 'No teams yet — add one above, or use "Import All Teams from Google Sheet".';
    toast(msg, 'err');
    $('#rs-out').textContent = msg;
    return null;
  }
  return encodeURIComponent(id);
}

async function importRoster({ url, csv, preview = false }) {
  const team = currentTeamId(); if (!team) return;
  const out = $('#rs-out');
  out.textContent = 'Working…';
  try {
    const r = await api(`/api/teams/${team}/roster/import`, {
      method: 'POST',
      body: JSON.stringify({
        sport: $('#rs-sport').value, url, csv, preview,
        mode: $('#rs-replace').checked ? 'replace' : 'merge'
      })
    });
    if (r.preview) {
      out.textContent = `PREVIEW — ${r.players.length} players found (nothing saved yet)\n` +
        (r.warnings?.length ? r.warnings.join('\n') + '\n' : '') +
        r.players.slice(0, 60).map((p) => `${String(p.number).padStart(3)}  ${p.name}  ${p.pos || ''} ${p.year || ''}`).join('\n');
    } else {
      out.textContent = `Imported ${r.imported} players. Roster now has ${r.total}.` +
        (r.warnings?.length ? '\n' + r.warnings.join('\n') : '');
      S.rosterEdit = r.roster.map((p) => ({ ...p }));
      renderRosterTable();
      if (S.gameId) await refreshState();
      toast('Roster imported', 'ok');
    }
  } catch (e) { out.textContent = 'Error: ' + e.message; toast(e.message, 'err'); }
}

/** Client-side format sniff, purely so the operator sees what they picked. */
function sniff(text) {
  const s = String(text || '');
  if (!s.trim()) return '';
  if (s.slice(0, 8).startsWith('%PDF-')) return 'PDF — not importable, see note below';
  const first = s.split(/\r?\n/, 1)[0] || '';
  if (first.includes('Jersey') && first.includes('|')) return 'HUDL per-game export';
  if (/<table/i.test(s)) return /(Passing|Rushing|Receiving)\s*Stats/i.test(s) ? 'HUDL season page' : 'HTML table';
  return 'CSV / spreadsheet';
}

function showDetectedFormat(text) {
  const k = sniff(text);
  $('#rs-detect').textContent = k ? `Detected: ${k}` : '';
}

async function loadImportFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const out = $('#rs-out');
  try {
    const text = await f.text();
    S.importText = text;
    showDetectedFormat(text);
    // The saved HUDL season page is megabytes; keep it out of the textarea.
    $('#rs-paste').value = text.length > 20000
      ? `[${f.name} — ${(text.length / 1024 / 1024).toFixed(1)} MB loaded, too large to show here]`
      : text;
    out.textContent = `Loaded ${f.name} (${text.length.toLocaleString()} characters).\nDetected: ${sniff(text)}\n\nUse "Preview Stats" to check it before importing.`;
  } catch (err) { out.textContent = 'Could not read that file: ' + err.message; }
}

function importPayloadText() {
  const pasted = $('#rs-paste').value;
  return (S.importText && pasted.startsWith('[')) ? S.importText : (pasted || S.importText || '');
}

async function importStats(preview = false) {
  const team = currentTeamId(); if (!team) return;
  const out = $('#rs-out');
  const text = importPayloadText();
  if (!text.trim()) return toast('Paste or choose a file first', 'err');
  out.textContent = preview ? 'Previewing…' : 'Importing…';
  try {
    const r = await api(`/api/teams/${team}/stats/import`, {
      method: 'POST',
      body: JSON.stringify({
        sport: $('#rs-sport').value, csv: text,
        season: $('#ex-season').value || S.cfg.season, preview
      })
    });
    const lines = [];
    lines.push(`${preview ? 'PREVIEW — nothing saved yet' : 'IMPORTED'}   (format: ${r.kind || 'csv'})`);
    lines.push(`${r.players?.length ?? r.imported} players`);
    if (r.sections?.length) {
      lines.push('', 'Sections found:');
      for (const s of r.sections) lines.push(`   ${s.key.padEnd(16)} ${s.players} players`);
    }
    if (r.unmatched?.length) {
      lines.push('', `${r.unmatched.length} row(s) belong to the other team (jersey not on this roster).`);
    }
    const cols = r.matched || r.matchedColumns || [];
    if (cols.length) lines.push('', `Stat columns read: ${cols.join(', ')}`);
    if (preview && r.players) {
      lines.push('', 'Sample:');
      for (const p of r.players.slice(0, 15)) {
        const top = Object.entries(p.stats || {}).filter(([, v]) => v).slice(0, 6)
          .map(([k, v]) => `${k}=${v}`).join(' ');
        lines.push(`   #${String(p.number).padEnd(3)} ${(p.name || '(no name in file)').padEnd(20)} ${top}`);
      }
    }
    if (r.warnings?.length) lines.push('', 'NOTES:', ...r.warnings.map((w) => '  • ' + w));
    out.textContent = lines.join('\n');
    if (!preview) toast('Stats imported', 'ok');
  } catch (e) { out.textContent = 'Error: ' + e.message; toast(e.message, 'err'); }
}

/* ---------------------------- season history ---------------------------- */
async function loadHistory() {
  const team = currentTeamId(); if (!team) return;
  const body = $('#histbody');
  body.innerHTML = 'Loading…';
  try {
    const r = await api(`/api/teams/${team}/history?sport=${$('#rs-sport').value}`);
    if (!r.seasons.length) {
      body.innerHTML = `<div class="hint">No committed games yet for ${esc(r.teamName)} in ${esc(r.sport)}. ` +
        `Games appear here once you hit "Mark Final &amp; Commit to Season" on the Export tab.</div>`;
      return;
    }
    let h = '';
    for (const s of r.seasons) {
      h += `<div class="tbltitle">${esc(s.season)} — ${s.gameCount} game${s.gameCount === 1 ? '' : 's'}</div>`;
      h += '<div class="tblwrap"><table class="tbl"><thead><tr><th>Date</th><th>Opponent</th><th>H/A</th><th>Result</th><th>Players</th><th></th></tr></thead><tbody>';
      for (const g of s.games) {
        const t = g.teamStats || {};
        const line = t.score != null ? `${t.score} pts` : '';
        h += `<tr><td>${esc(g.date)}</td><td>${esc(g.opponent)}</td><td>${esc(g.homeAway)}</td>
          <td>${esc(line)}</td><td>${g.playerCount}</td>
          <td>${g.exists ? `<a href="/api/games/${encodeURIComponent(g.gameId)}/export/report.pdf" target="_blank" rel="noopener">PDF</a>` : '<span style="color:var(--dim)">archived</span>'}</td></tr>`;
      }
      h += '</tbody></table></div>';

      if (s.players.length) {
        const keys = Object.keys(s.players[0]).filter((k) =>
          !['number', 'name', 'pos', 'games', 'side'].includes(k) &&
          s.players.some((p) => typeof p[k] === 'number' && p[k] !== 0)).slice(0, 12);
        h += `<div class="tbltitle">${esc(s.season)} season totals (from games logged here)</div>`;
        h += '<div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th>GP</th>' +
          keys.map((k) => `<th>${esc(k)}</th>`).join('') + '</tr></thead><tbody>';
        for (const p of s.players) {
          h += `<tr><td>${esc(p.number)}</td><td>${esc(p.name)}</td><td>${p.games}</td>` +
            keys.map((k) => `<td>${esc(fmtv(p[k] ?? 0))}</td>`).join('') + '</tr>';
        }
        h += '</tbody></table></div>';
      }
      if (s.imported) {
        h += `<div class="hint">Also holds an imported set (${esc(s.imported.label)}, ${s.imported.playerCount} players, ` +
          `loaded ${esc(s.imported.importedAt)}) with columns: ${esc((s.imported.matchedColumns || []).join(', '))}.</div>`;
      }
    }
    body.innerHTML = h;
  } catch (e) { body.innerHTML = `<div class="hint">Error: ${esc(e.message)}</div>`; }
}

/* ---------------------------- scorebot ---------------------------- */
function loadScorebotForm() {
  const sb = S.cfg.scorebot || {};
  $('#sb-enabled').checked = !!sb.enabled;
  $('#sb-url').value = sb.url || '';
  $('#sb-key').value = sb.apiKey || '';
  $('#sb-game').value = sb.gameCode || '';
  $('#sb-poll').value = sb.pollMs || 1000;
  $('#sb-map').value = sb.fieldMap ? JSON.stringify(sb.fieldMap, null, 1) : '';
  renderSourceToggles();
  paintScorebotStatus(S.cfg.scorebotStatus);
}

/** One Scorebot/Manual toggle per feed field. */
function renderSourceToggles() {
  const wrap = $('#sb-sources');
  const fields = S.cfg.scorebotFields || [];
  const sources = { ...(S.cfg.scorebot?.sources || {}) };
  S.sources = sources;
  wrap.innerHTML = '';
  for (const f of fields) {
    const row = el('div', 'srcrow');
    const lab = el('div', 'srclab');
    lab.appendChild(el('span', null, f.label));
    if (f.hint) lab.appendChild(el('span', 'srchint', f.hint));
    row.appendChild(lab);
    const seg = el('div', 'seg');
    for (const mode of ['scorebot', 'manual']) {
      const b = el('button', 'segbtn' + (sources[f.key] === mode ? ' on' : ''), mode === 'scorebot' ? 'Scorebot' : 'Manual');
      b.onclick = () => {
        sources[f.key] = mode;
        renderSourceTogglesState();
      };
      seg.appendChild(b);
    }
    row.appendChild(seg);
    row.dataset.field = f.key;
    wrap.appendChild(row);
  }
  renderSourceTogglesState();
}

function renderSourceTogglesState() {
  $$('#sb-sources .srcrow').forEach((row) => {
    const cur = S.sources[row.dataset.field];
    $$('.segbtn', row).forEach((b, i) => b.classList.toggle('on', (i === 0 ? 'scorebot' : 'manual') === cur));
  });
}

async function parseScorebotSample() {
  const out = $('#sb-out');
  const txt = $('#sb-raw').value.trim();
  if (!txt) return toast('Paste a JSON message first', 'err');
  out.textContent = 'Parsing…';
  try {
    let fieldMap = null;
    const mt = $('#sb-map').value.trim();
    if (mt) { try { fieldMap = JSON.parse(mt); } catch { /* ignore, show suggestions anyway */ } }
    const r = await api('/api/scorebot/parse', {
      method: 'POST', body: JSON.stringify({ json: txt, ...(fieldMap ? { fieldMap } : {}) })
    });
    S.suggestedMap = r.suggestedFieldMap;
    const lines = ['WHAT OPENSTATSENGINE READ FROM THIS MESSAGE', ''];
    for (const f of r.fields) {
      const key = f.key === 'clock' ? 'clockMs' : f.key;
      const v = r.normalized[key];
      const shown = v === undefined || v === null ? '— not found —'
        : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      lines.push(`  ${f.label.padEnd(18)} ${shown}`);
    }
    lines.push('', `Scanned ${r.pathCount} paths in the message.`, '', 'SUGGESTED FIELD MAP');
    lines.push(JSON.stringify(r.suggestedFieldMap, null, 2));
    if (r.missing.length) {
      lines.push('', `Not found in this message: ${r.missing.join(', ')}.`);
      lines.push('Set those to Manual below, or add the right path to the Field Map.');
    }
    out.textContent = lines.join('\n');
    toast('Parsed', 'ok');
  } catch (e) { out.textContent = 'Error: ' + e.message; toast(e.message, 'err'); }
}

function applySuggestedMap() {
  if (!S.suggestedMap) return toast('Parse a sample first', 'err');
  $('#sb-map').value = JSON.stringify(S.suggestedMap, null, 1);
  // anything the sample did not contain is better handled by hand
  const found = Object.keys(S.suggestedMap);
  for (const f of (S.cfg.scorebotFields || [])) {
    S.sources[f.key] = found.includes(f.key) ? 'scorebot' : 'manual';
  }
  renderSourceTogglesState();
  toast('Field map filled in — review, then Save Settings', 'ok');
}

function paintScorebotStatus(st) {
  if (!st) return;
  $('#sb-startstop').textContent = st.mode === 'off' ? 'Start' : 'Stop';
  $('#sb-out').textContent =
    `mode: ${st.mode} · connected: ${st.connected} · messages: ${st.messages}` +
    (st.lastMessage ? `\nlast message: ${st.lastMessage}` : '') +
    (st.lastError ? `\nlast error: ${st.lastError}` : '') +
    (st.lastNormalized ? `\nnormalized: ${JSON.stringify(st.lastNormalized)}` : '');
}

function scorebotBody() {
  let fieldMap = null;
  const t = $('#sb-map').value.trim();
  if (t) { try { fieldMap = JSON.parse(t); } catch { throw new Error('Field Map is not valid JSON'); } }
  return {
    enabled: $('#sb-enabled').checked, url: $('#sb-url').value.trim(),
    apiKey: $('#sb-key').value, gameCode: $('#sb-game').value.trim(),
    pollMs: parseInt($('#sb-poll').value, 10) || 1000,
    sources: S.sources || {},
    ...(fieldMap ? { fieldMap } : {})
  };
}

async function saveScorebot() {
  try {
    S.cfg = await api('/api/config', { method: 'POST', body: JSON.stringify({ scorebot: scorebotBody() }) });
    paintScorebotStatus(S.cfg.scorebotStatus);
    toast('Scorebot settings saved', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function testScorebot() {
  $('#sb-out').textContent = 'Testing…';
  try {
    const r = await api('/api/scorebot/test', { method: 'POST', body: JSON.stringify(scorebotBody()) });
    $('#sb-out').textContent =
      `HTTP ${r.status}\n\nNORMALIZED (what OSE will use):\n${JSON.stringify(r.normalized, null, 2)}\n\nRAW RESPONSE:\n` +
      (typeof r.raw === 'string' ? r.raw : JSON.stringify(r.raw, null, 2));
  } catch (e) { $('#sb-out').textContent = 'Error: ' + e.message; }
}

async function toggleScorebot() {
  try {
    const st = $('#sb-startstop').textContent === 'Start'
      ? await api('/api/scorebot/start', { method: 'POST', body: '{}' })
      : await api('/api/scorebot/stop', { method: 'POST', body: '{}' });
    paintScorebotStatus(st);
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------------------------- export / vmix ---------------------------- */
function renderExport() {
  const wrap = $('#export-links');
  if (!S.gameId) { wrap.innerHTML = '<div class="hint">No active game.</div>'; return; }
  const base = `/api/games/${encodeURIComponent(S.gameId)}/export`;
  const items = [
    ['Full Report (PDF)', 'report.pdf'], ['Summary, no PBP (PDF)', 'summary.pdf'],
    ['Box Score (CSV)', 'boxscore.csv'], ['Team Stats (CSV)', 'teamstats.csv'],
    ['Scoring (CSV)', 'scoring.csv'], ['Play-by-Play (CSV)', 'pbp.csv']
  ];
  wrap.innerHTML = items.map(([l, f]) => `<a href="${base}/${f}" target="_blank" rel="noopener">${esc(l)}</a>`).join('');
}

function renderVmix() {
  const wrap = $('#vmix-links');
  const base = location.origin;
  const rows = [
    ['Scoreboard', `${base}/vmix/live/scoreboard.xml`, 'Scores, clock, period, possession, TOP, drought, score by period'],
    ['Team Stats', `${base}/vmix/live/teamstats.xml`, 'One row per stat — home vs away comparison graphics'],
    ['Team Stats (flat)', `${base}/vmix/live/teamstatsflat.xml`, 'One row, every stat as its own column'],
    ['Leaders', `${base}/vmix/live/leaders.xml`, 'Add ?cat=passing&side=home&limit=3'],
    ['Players', `${base}/vmix/live/players.xml`, 'Add ?side=home&cat=rushing&limit=5'],
    ['Scoring', `${base}/vmix/live/scoring.xml`, 'Scoring summary / ticker'],
    ['Recent Plays', `${base}/vmix/live/plays.xml`, 'Add ?n=6'],
    ['Roster', `${base}/vmix/live/roster.xml`, 'Add ?side=away'],
    ['Everything', `${base}/vmix/live/all.xml`, 'All sections in one document']
  ];
  wrap.innerHTML = rows.map(([l, u, note]) => `
    <div class="vrow"><span class="lbl">${esc(l)}</span><code>${esc(u)}</code>
      <button data-copy="${esc(u)}">Copy</button>
      <a href="${esc(u)}" target="_blank" rel="noopener"><button>Open</button></a></div>
    <div class="hint" style="margin:-2px 0 8px 8px">${esc(note)}</div>`).join('');
  $$('[data-copy]', wrap).forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied', 'ok'); }
    catch { toast('Copy failed — select the URL manually', 'err'); }
  });
  wrap.insertAdjacentHTML('afterbegin',
    `<div class="vrow"><span class="lbl">Announcer</span><code>${esc(base)}/announcer</code>` +
    `<button data-copy="${esc(base)}/announcer">Copy</button>` +
    `<a href="/announcer" target="_blank" rel="noopener"><button>Open</button></a></div>` +
    `<div class="hint" style="margin:-2px 0 12px 8px">Read-only booth page: big-play popups, key stats, and type-to-find any number.</div>`);
  $$('[data-copy]', wrap).forEach((b2) => b2.onclick = async () => {
    try { await navigator.clipboard.writeText(b2.dataset.copy); toast('Copied', 'ok'); }
    catch { toast('Copy failed — select the URL manually', 'err'); }
  });
  $('#vmix-path').textContent =
    'XML files are also written to the data/vmix folder next to the server.\n' +
    'data/vmix/_live/  always contains the active game.\n' +
    'data/vmix/<game-id>/  keeps a per-game copy.';
}

async function commitGame() {
  if (!S.gameId) return;
  try {
    const r = await api(`/api/games/${encodeURIComponent(S.gameId)}/commit`, { method: 'POST', body: '{}' });
    S.games = await api('/api/games');
    renderGameList();
    toast(`Final ${r.final.away}-${r.final.home} committed to season`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
