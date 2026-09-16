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
  statsView: 'team', showArchived: false,
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
  $('#sb-enabled').onchange = (e) => (e.target.checked ? connectScorebot() : disconnectScorebot());
  $('#sb-disconnect').onclick = disconnectScorebot;
  $('#sb-test').onclick = testScorebot;
  $('#sb-startstop').onclick = toggleScorebot;
  $('#fa-retry').onclick = (e) => { e.stopPropagation(); dismissFeedAlert(); connectScorebot(); };
  $('#fa-dismiss').onclick = (e) => { e.stopPropagation(); dismissFeedAlert(); };
  // Clicking the banner anywhere clears it. The instinct is to click the thing
  // you want gone, not to hunt for its button.
  $('#feedalert').onclick = dismissFeedAlert;
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
  // The feed dropping produces no game events, so it needs its own channel —
  // otherwise the only symptom is a screen that quietly stops updating.
  es.addEventListener('feed', async (e) => {
    const f = JSON.parse(e.data || '{}');
    feedAlert(f);
    // Refresh from the server rather than painting the SSE subset, so the
    // Setup diagnostics keep their message counts and last-error text.
    try { S.cfg = await api('/api/config'); paintScorebotStatus(S.cfg.scorebotStatus); }
    catch { /* the alert is the part that matters */ }
    if (S.gameId) await refreshState();   // hand the locked controls back
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
    paintBoardScore(box, st, side, t.points);
  }
  $('#sb-period').textContent = `${st.clock.periodLabel} ${S.sport.periods.label}`.toUpperCase();
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

  applyFeedLocks();

  // After applyFeedLocks, which sets `disabled` from feed ownership alone and
  // would otherwise re-enable ◂Per at the first period. Both the range and the
  // ownership matter, so this has the last word.
  const maxPeriod = S.sport.periods.count + (S.sport.periods.maxOvertimes ?? 3);
  const prevBtn = $('[data-period="prev"]'), nextBtn = $('[data-period="next"]');
  const periodFed = !!st.feed?.owns?.period;
  if (prevBtn) prevBtn.disabled = periodFed || st.clock.period <= 1;
  if (nextBtn) {
    nextBtn.disabled = periodFed || st.clock.period >= maxPeriod;
    if (!periodFed) {
      nextBtn.title = nextBtn.disabled
        ? `Capped at ${S.sport.periods.label.toLowerCase()} ${maxPeriod}` : '';
    }
  }

  feedAlert(st.feed);
  renderTeamSwitch();
  renderDiamond();
  renderAux();
  renderRecent();
  tickClock();
  if ($('#view-stats').classList.contains('active')) renderStats();
}

/**
 * The board's score beside the one our logged plays add up to. Shown only when
 * they disagree *and* the feed is currently driving that number: a stale figure
 * left over from a dead feed is not a mismatch worth flagging, and a row that
 * stays quiet when the two agree means an operator only ever reads it when
 * something needs fixing.
 */
function paintBoardScore(box, st, side, entered) {
  const chip = $('.sb-board', box);
  if (!chip) return;
  const fed = st.feed?.owns?.[side === 'home' ? 'homeScore' : 'awayScore'];
  const board = st.officialScore?.[side];
  const drift = !!fed && board != null && board !== entered;
  chip.classList.toggle('hidden', !drift);
  box.classList.toggle('drift', drift);
  if (!drift) return;
  const d = board - entered;
  chip.textContent = `BOARD ${board} (${d > 0 ? '+' : ''}${d})`;
  chip.title = d > 0
    ? `The scoreboard has ${board}, the plays entered here add up to ${entered}. ` +
      `Usually a scoring play not logged yet.`
    : `The scoreboard has ${board}, the plays entered here add up to ${entered}. ` +
      `Usually a play logged twice, or logged to the wrong team.`;
}

/* ---------------------------- feed alert ---------------------------- */
const FEED = { lost: false, timer: null, backAt: 0 };
const BACK_MS = 4000;   // how long the green "reconnected" note stays up

/**
 * Raised when a feed the operator wants has gone away on its own.
 *
 * The test is `droppedAt` — a connection that actually existed and then
 * failed — not merely "not connected". Pressing Connect reports
 * mode=mqtt/connected=false for a moment while the socket comes up, and that
 * is not a fault; the status pill in Setup already says "Connecting…".
 * Deliberately stopping clears both `wanted` and `droppedAt`, so switching
 * the feed off never raises this either.
 */
function feedAlert(f) {
  if (!f) return;
  const box = $('#feedalert');
  const lost = !!f.wanted && f.mode !== 'off' && !f.connected && !!f.droppedAt;

  // Belt and braces for the auto-hide: a background tab throttles setTimeout
  // hard, so the green note could sit there long after its four seconds were
  // up. Every state refresh re-checks the clock and clears it.
  if (FEED.backAt && Date.now() - FEED.backAt > BACK_MS) hideFeedAlert();

  if (lost && !FEED.lost) {
    FEED.lost = true;
    clearTimeout(FEED.timer);
    $('.fa-icon', box).textContent = '⚠';
    // Two different faults needing two different fixes: a dropped socket is a
    // network or broker problem, a quiet board means the source stopped —
    // emulator switched off, scoreboard powered down, operator went home.
    $('.fa-title', box).textContent = f.stalled
      ? 'Scorebot has stopped sending'
      : 'Scorebot disconnected';
    $('#fa-detail').textContent =
      (f.topic ? f.topic + ' — ' : '') + (f.reason || f.dropReason || 'connection lost');
    box.classList.remove('hidden', 'back');
  } else if (!lost && FEED.lost) {
    FEED.lost = false;
    // Back on its own — say so and clear itself, rather than leaving a warning
    // about a problem that has already fixed itself for someone to dismiss.
    clearTimeout(FEED.timer);
    $('.fa-icon', box).textContent = '✓';
    $('.fa-title', box).textContent = 'Scorebot reconnected';
    $('#fa-detail').textContent = f.topic || '';
    box.classList.remove('hidden');
    box.classList.add('back');
    FEED.backAt = Date.now();
    FEED.timer = setTimeout(hideFeedAlert, BACK_MS);
  }
}

function hideFeedAlert() {
  clearTimeout(FEED.timer);
  FEED.timer = null;
  FEED.backAt = 0;
  $('#feedalert').classList.add('hidden');
}

/**
 * Dismissing settles the state machine as well as hiding the banner. Without
 * resetting `lost`, pressing Reconnect hid the warning and then the successful
 * reconnect raised the green note in its place — the alert appeared to come
 * back on its own moments after being dismissed.
 */
function dismissFeedAlert() {
  FEED.lost = false;
  hideFeedAlert();
}

/**
 * Grey out the manual controls for anything the scoreboard feed is driving.
 * Disabled only while the feed is actually connected, so a dropped broker hands
 * control straight back rather than stranding the operator.
 */
function applyFeedLocks() {
  const feed = S.state?.feed;
  const owns = feed?.owns || {};
  const why = (field) =>
    `Coming from the Scorebot${feed?.topic ? ` (${feed.topic})` : ''}. ` +
    `To enter it by hand, set "${field}" to Manual under Setup → Scorebot → Field sources.`;

  const lock = (nodes, field, label) => {
    for (const n of nodes) {
      if (!n) continue;
      const locked = !!owns[field];
      n.disabled = locked;
      n.classList.toggle('fed', locked);
      if (locked) n.title = why(label);
      else if (n.title.startsWith('Coming from the Scorebot')) n.title = '';
    }
  };

  // game clock: start/stop needs both the value and the run state
  const clockLocked = owns.clock && owns.running;
  lock([$('#btn-clock')], clockLocked ? 'clock' : '__none', 'Game Clock');
  lock($$('[data-clockadj]').concat([$('[data-clockset]')]), 'clock', 'Game Clock');
  lock($$('[data-period]'), 'period', 'Period / Inning');
  lock([$('#aux-toggle'), $('#aux-auto')].concat($$('#aux-presets button')), 'auxClock', 'Play / Shot Clock');
  lock($$('[data-half]'), 'half', 'Top / Bottom');
  lock($$('[data-base]'), 'bases', 'Runners on Base');
  for (const b of $$('[data-count]')) {
    const k = b.dataset.count;
    if (k === 'reset') lock([b], (owns.balls && owns.strikes) ? 'balls' : '__none', 'Balls / Strikes');
    else lock([b], k, { balls: 'Balls', strikes: 'Strikes', outs: 'Outs' }[k] || k);
  }

  // a badge on each bar, so it is obvious why things are greyed rather than broken
  const badge = (barSel, fields, text) => {
    const bar = $(barSel);
    if (!bar) return;
    let el2 = $('.fedbadge', bar);
    const on = fields.some((f) => owns[f]);
    if (!on) { el2?.remove(); return; }
    if (!el2) { el2 = el('span', 'fedbadge'); bar.appendChild(el2); }
    el2.textContent = text;
    el2.title = `Live from the Scorebot${feed?.topic ? ` — ${feed.topic}` : ''}`;
  };
  badge('#clockbar', ['clock', 'running', 'period'], '⛓ Scorebot');
  badge('#auxbar', ['auxClock'], '⛓ Scorebot');
  badge('#diamondbar', ['half', 'outs', 'balls', 'strikes', 'bases'], '⛓ Scorebot');
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
  // the preset buttons are rebuilt here, so re-apply any feed lock to them
  const owns = S.state?.feed?.owns || {};
  if (owns.auxClock) {
    for (const b of $$('#aux-presets button')) { b.disabled = true; b.classList.add('fed'); }
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
      const ed = el('button', 'rl-undo rl-edit', 'edit');
      ed.title = 'Reopen this play and change what was entered';
      ed.onclick = () => editEntry(t);
      li.appendChild(ed);
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
    vals[f.name] = (f.sticky && S.sticky[S.side][f.name] != null)
      ? S.sticky[S.side][f.name] : fieldDefault(f);
  }
  // Snapshot the starting values so an untouched optional field is not saved.
  // Stamped now, not on save. A goal is tapped the moment it goes in and the
  // scorer is chosen afterwards; reading the clock at save time would log the
  // play several seconds late, and put it in the wrong period if the tap landed
  // either side of a buzzer.
  SHEET = {
    action, vals, init: JSON.parse(JSON.stringify(vals)), activeNum: null,
    side: S.side, editing: null,
    at: { clockMs: Math.round(liveClockMs()), period: S.state.clock.period }
  };
  $('#sheet-title').textContent = action.label;
  $('#sheet-save').textContent = 'Save Entry';
  $('#sheet-team').textContent = (S.state.teams[S.side].shortName || S.state.teams[S.side].name).toUpperCase();
  renderSheetFields();
  $('#sheet').classList.remove('hidden');

  // If nothing needs input at all, this is a one-tap action — save immediately.
  if (!(action.fields || []).length) saveSheet();
}

function closeSheet() { $('#sheet').classList.add('hidden'); SHEET = null; }

/**
 * Reopen a logged play with its values filled in.
 *
 * Corrections are appended, never overwritten in place — the original entry
 * and every edit of it stay in the log, which is what makes undo exact and
 * leaves an audit trail of who changed what.
 */
function editEntry(t) {
  if (!S.state || t.type !== 'stat') return;
  const action = (S.sport.palette || [])
    .flatMap((g) => g.actions || [])
    .find((a) => a.key === t.action);
  if (!action) return toast(`"${t.action}" is not in this sport's palette`, 'err');

  const vals = {};
  for (const f of action.fields || []) {
    const v = t.data?.[f.name];
    vals[f.name] = v === undefined || v === null ? fieldDefault(f) : v;
  }
  // No `init` snapshot here: when editing, every field is written back, so
  // clearing one actually clears it instead of silently keeping the old value.
  SHEET = { action, vals, init: {}, activeNum: null, side: t.team, editing: t.id };
  $('#sheet-title').textContent = `Edit — ${action.label}`;
  $('#sheet-save').textContent = 'Save Changes';
  const team = S.state.teams[t.team];
  $('#sheet-team').textContent = (team.shortName || team.name).toUpperCase();
  renderSheetFields();
  $('#sheet').classList.remove('hidden');
}

/** What a field holds before anyone touches it. */
function fieldDefault(f) {
  if (f.default !== undefined) return f.default;
  if (f.type === 'toggle') return false;
  if (f.type === 'players' || f.type === 'players_opp') return [];
  if (f.type === 'number') return 0;
  return f.type === 'select' ? (f.options?.[0] ?? '') : null;
}

/** The side this sheet is about: the selected team when entering, the play's
 *  own team when editing one logged against the other side. */
const sheetSide = () => SHEET?.side ?? S.side;

function renderSheetFields() {
  const wrap = $('#sheet-fields'); wrap.innerHTML = '';
  const { action, vals } = SHEET;
  const side = sheetSide();
  const other = side === 'home' ? 'away' : 'home';

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
      if (f.type === 'player' || f.type === 'player_opp') valSpan.textContent = v ? playerLabel(f.type === 'player' ? side : other, v) : '';
      else if (f.type === 'players' || f.type === 'players_opp') valSpan.textContent = (v || []).length ? `${v.length} selected` : '';
      else if (f.type === 'toggle') valSpan.textContent = v ? 'YES' : '';
      else valSpan.textContent = v === 0 || v ? String(v) : '';
    };

    if (f.type === 'player' || f.type === 'player_opp') {
      body.appendChild(playerGrid(f.type === 'player' ? side : other, () => vals[f.name], (id) => {
        setVal(vals[f.name] === id ? null : id);
        renderSheetFields();
      }));
    } else if (f.type === 'players' || f.type === 'players_opp') {
      body.appendChild(playerGrid(f.type === 'players' ? side : other, () => vals[f.name] || [], (id) => {
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
  const { action, vals, init, editing } = SHEET;
  const side = sheetSide();
  const data = {};
  for (const f of action.fields || []) {
    const v = vals[f.name];
    if (editing) {
      // Every field is written back, blanks as explicit nulls. A correction is
      // merged onto the original, so a field simply left out would keep its old
      // value, making it impossible to remove an assist or untick a TD.
      //
      // An optional field sitting at its default is written as null rather than
      // as 0 or false, so editing a play does not decorate it with "YAC: 0".
      const blank = v === null || v === undefined || v === '' || v === false ||
        (Array.isArray(v) && !v.length);
      data[f.name] = (blank || (f.optional && JSON.stringify(v) === JSON.stringify(fieldDefault(f))))
        ? null : v;
      continue;
    }
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (v === false) continue;
    // An optional field the operator never touched carries no information.
    if (f.optional && JSON.stringify(v) === JSON.stringify(init[f.name])) continue;
    data[f.name] = v;
    if (f.sticky) S.sticky[side][f.name] = v;
  }
  const btn = $('#sheet-save'); btn.disabled = true;
  try {
    const r = editing
      ? await api(`/api/games/${encodeURIComponent(S.gameId)}/correct`, {
        method: 'POST',
        // The nested `data` is the contract: the outer object patches the
        // event itself, the inner one patches the play's own fields.
        body: JSON.stringify({ eventId: editing, data: { data } })
      })
      : await api(`/api/games/${encodeURIComponent(S.gameId)}/events`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'stat', team: side, action: action.key, data,
          ...(SHEET.at || {})
        })
      });
    S.state = r.state;
    closeSheet();
    applyState();
    toast(editing ? `${action.label} edited` : `${action.label} saved`, 'ok');
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

    // What the scoreboard itself is counting. Shown as its own block rather
    // than mixed into the logged totals, so it is always clear which number
    // came from where when the two disagree.
    let bs = '';
    const b = st.boardStats;
    if (b) {
      const rows = [['sog', 'Shots on Goal'], ['corners', 'Corners'], ['saves', 'Saves']]
        .filter(([k]) => b.home[k] != null || b.away[k] != null);
      if (rows.length) {
        bs = '<div class="tbltitle">From the Scoreboard</div><table class="cmp">';
        bs += `<tr><td><b>${esc(st.teams.away.abbrev)}</b></td><td></td><td><b>${esc(st.teams.home.abbrev)}</b></td></tr>`;
        for (const [k, label] of rows) {
          bs += `<tr><td>${b.away[k] ?? '—'}</td><td>${esc(label)}</td><td>${b.home[k] ?? '—'}</td></tr>`;
        }
        bs += `<tr><td colspan="3" style="text-align:center;color:var(--dim);font-size:11.5px">`
           + `Counted by the scoreboard, not from logged plays</td></tr></table>`;
      }
    }

    const dr = `<div class="tbltitle">Situational</div><table class="cmp">
      <tr><td>${esc(st.droughts.away.display)}</td><td>Since last score</td><td>${esc(st.droughts.home.display)}</td></tr>
      <tr><td>${st.runs.best.away}</td><td>Biggest run</td><td>${st.runs.best.home}</td></tr>
      <tr><td colspan="3" style="text-align:center;color:var(--dim);font-size:11.5px">
        Elapsed ${esc(st.situation.elapsedDisplay)} · ${st.counts.effective} entries logged</td></tr></table>`;
    body.innerHTML = ls + cmp + bs + dr;
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

/** One row in the games list. Shared by the live and archived sections. */
function gameRow(g) {
  const row = el('div', 'grow' + (g.id === S.gameId ? ' active' : '') + (g.archived ? ' arch' : ''));
  const main = el('div', 'gmain');
  const title = el('div', null, `${g.awayName} at ${g.homeName}`);
  if (g.archived && g.id === S.gameId) title.appendChild(el('span', 'archtag', 'ARCHIVED'));
  main.appendChild(title);
  main.appendChild(el('div', 'gsub',
    `${g.date} · ${g.sport} · ${g.level} · ${g.status}${g.venue ? ' · ' + g.venue : ''}`));
  row.appendChild(main);

  const act = el('button', null, g.id === S.gameId ? 'Active' : 'Make Active');
  act.onclick = async () => {
    await api(`/api/games/${encodeURIComponent(g.id)}/activate`, { method: 'POST', body: '{}' });
    await openGame(g.id); renderGameList(); go('live');
  };
  row.appendChild(act);

  const arch = el('button', null, g.archived ? 'Unarchive' : 'Archive');
  arch.title = g.archived
    ? 'Put this game back in the list above'
    : 'Move to Archived. Nothing is deleted — exports and season totals are untouched.';
  arch.onclick = async () => {
    try {
      await api(`/api/games/${encodeURIComponent(g.id)}/archive`, {
        method: 'POST', body: JSON.stringify({ archived: !g.archived })
      });
      S.games = await api('/api/games');
      // Opening the drawer after archiving shows where the game went, rather
      // than having it simply vanish from the list.
      if (!g.archived) S.showArchived = true;
      renderGameList();
      toast(g.archived ? 'Back in the list' : 'Moved to Archived — nothing deleted', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  row.appendChild(arch);

  const del = el('button', null, 'Delete');
  del.onclick = async () => {
    if (!confirm(`Delete "${g.id}" and all of its logged entries? This cannot be undone.\n\n` +
      `To clear it from this list without losing anything, use Archive instead.`)) return;
    await api(`/api/games/${encodeURIComponent(g.id)}`, { method: 'DELETE' });
    S.games = await api('/api/games');
    if (S.gameId === g.id) showNoGame();
    renderGameList(); toast('Deleted');
  };
  row.appendChild(del);
  return row;
}

function renderGameList() {
  const wrap = $('#gamelist'); wrap.innerHTML = '';
  if (!S.games.length) { wrap.innerHTML = '<div class="hint">No games yet.</div>'; return; }

  // The active game stays in the live list whatever its archive state — nobody
  // should have to open a drawer to find the game that is currently on air.
  const archived = S.games.filter((g) => g.archived && g.id !== S.gameId);
  const live = S.games.filter((g) => !g.archived || g.id === S.gameId);

  if (live.length) {
    const list = el('div', 'glist');
    for (const g of live) list.appendChild(gameRow(g));
    wrap.appendChild(list);
  } else {
    wrap.appendChild(el('div', 'hint', 'Every game is archived — they are in the section below.'));
  }

  if (!archived.length) return;

  // Their own section rather than dimmed rows mixed into the list: a finished
  // game and this Friday's game should not look like neighbours.
  const head = el('button', 'archhead' + (S.showArchived ? ' open' : ''));
  head.setAttribute('aria-expanded', String(!!S.showArchived));
  head.appendChild(el('span', 'archcaret', S.showArchived ? '▾' : '▸'));
  head.appendChild(el('span', 'archttl', 'Archived'));
  head.appendChild(el('span', 'archcount', String(archived.length)));
  head.onclick = () => { S.showArchived = !S.showArchived; renderGameList(); };
  wrap.appendChild(head);

  if (!S.showArchived) return;
  const box = el('div', 'archbox');
  box.appendChild(el('div', 'archnote',
    'Hidden from the list above. Nothing is deleted — exports, play-by-play and season totals are all intact.'));
  const alist = el('div', 'glist');
  for (const g of archived) alist.appendChild(gameRow(g));
  box.appendChild(alist);
  wrap.appendChild(box);
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
  // Shown in seconds, stored in ms. 0 is a real value here — it disables the
  // check — so it must not fall through to the default.
  $('#sb-stale').value = sb.staleMs == null ? 5 : Math.round(sb.staleMs / 1000);
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
      b.onclick = async () => {
        const prev = sources[f.key];
        if (prev === mode) return;
        sources[f.key] = mode;
        renderSourceTogglesState();
        // Saved on the spot rather than waiting for Save Settings. These are
        // switches, and an unsaved switch that reverts on the next reload is
        // worse than no switch at all.
        try {
          S.cfg = await api('/api/config', {
            method: 'POST',
            body: JSON.stringify({ scorebot: { sources: { [f.key]: mode } } })
          });
          toast(`${f.label}: ${mode === 'manual' ? 'Manual' : 'Scorebot'}`, 'ok');
          if (S.gameId) await refreshState();   // lock or free the controls now
        } catch (e) {
          sources[f.key] = prev;                 // put the switch back
          renderSourceTogglesState();
          toast(`Could not save: ${e.message}`, 'err');
        }
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
  const off = st.mode === 'off';
  // One button at a time. Both used to be visible while connected, which put
  // two "Disconnect" buttons side by side.
  $('#sb-startstop').textContent = 'Connect';
  $('#sb-startstop').classList.add('primary');
  $('#sb-startstop').classList.toggle('hidden', !off);
  $('#sb-disconnect').classList.toggle('hidden', off);
  if (S.cfg?.scorebot) $('#sb-enabled').checked = !!S.cfg.scorebot.enabled && !off;

  const dot = $('#sb-state');
  dot.textContent = off ? '● Disconnected'
    : (st.connected ? `● Connected — ${st.mode.toUpperCase()}${st.topic ? ' · ' + st.topic : ''}` : '● Connecting…');
  dot.className = 'sbstate ' + (off ? 'off' : (st.connected ? 'on' : 'wait'));

  $('#sb-out').textContent =
    `mode: ${st.mode} · connected: ${st.connected} · messages: ${st.messages}` +
    (st.lastMessage ? `\nlast message: ${st.lastMessage}` : '') +
    (st.lastError ? `\nlast error: ${st.lastError}` : '') +
    (st.hint ? `\n\n${st.hint}` : '') +
    (st.lastNormalized ? `\n\nnormalized: ${JSON.stringify(st.lastNormalized)}` : '');
}

/** Seconds on screen, milliseconds in the config. A blank box means "I did not
 *  set this", not "turn the warning off" — only a deliberate 0 disables it. */
function staleMsFromForm() {
  const raw = $('#sb-stale').value.trim();
  if (raw === '') return 5000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 5000;
  return n === 0 ? 0 : n * 1000;
}

function scorebotBody() {
  let fieldMap = null;
  const t = $('#sb-map').value.trim();
  if (t) {
    try { fieldMap = JSON.parse(t); }
    catch {
      // Warn, but still save everything else. Refusing the whole save meant a
      // half-typed field map could stop you turning the feed off.
      toast('Field Map is not valid JSON — saved everything else, map left unchanged', 'err');
      fieldMap = null;
    }
  }
  return {
    enabled: $('#sb-enabled').checked, url: $('#sb-url').value.trim(),
    apiKey: $('#sb-key').value, gameCode: $('#sb-game').value.trim(),
    pollMs: parseInt($('#sb-poll').value, 10) || 1000,
    staleMs: staleMsFromForm(),
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
    const head = r.transport === 'mqtt'
      ? `MQTT connected\nTopics seen: ${(r.topics || []).map((t) => `${t.topic} (${t.count})`).join(', ') || 'none'}`
      : `HTTP ${r.status}`;
    $('#sb-out').textContent =
      `${head}\n\nNORMALIZED (what OSE will use):\n${JSON.stringify(r.normalized, null, 2)}\n\nRAW MESSAGE:\n` +
      (typeof r.raw === 'string' ? r.raw : JSON.stringify(r.raw, null, 2));
  } catch (e) { $('#sb-out').textContent = 'Error: ' + e.message; }
}

async function connectScorebot() {
  try {
    // save the form first so Connect uses what is on screen
    await api('/api/config', { method: 'POST', body: JSON.stringify({ scorebot: scorebotBody() }) });
    const st = await api('/api/scorebot/start', { method: 'POST', body: '{}' });
    S.cfg = await api('/api/config');
    paintScorebotStatus(st);
    toast('Scorebot connected', 'ok');
  } catch (e) {
    $('#sb-enabled').checked = false;
    toast(e.message, 'err');
  }
}

async function disconnectScorebot() {
  try {
    const st = await api('/api/scorebot/stop', { method: 'POST', body: '{}' });
    S.cfg = await api('/api/config');
    $('#sb-enabled').checked = false;
    paintScorebotStatus(st);
    toast('Scorebot disconnected — it will stay off until you connect again', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function toggleScorebot() {
  return S.cfg?.scorebotStatus?.mode === 'off' ? connectScorebot() : disconnectScorebot();
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
  // The XPath matters as much as the URL: vMix needs it pointed at the
  // repeating <Row> elements, not the document that contains them. Left at the
  // document name it yields one row of every field concatenated together.
  const rows = [
    ['Scoreboard', `${base}/vmix/live/scoreboard.xml`, 'Scoreboard/Row', 'Scores, clock, period, possession, TOP, drought, score by period'],
    ['Team Stats', `${base}/vmix/live/teamstats.xml`, 'TeamStats/Row', 'One row per stat — home vs away comparison graphics'],
    ['Team Stats (flat)', `${base}/vmix/live/teamstatsflat.xml`, 'TeamStatsFlat/Row', 'One row, every stat as its own column'],
    ['Leaders', `${base}/vmix/live/leaders.xml`, 'Leaders/Row', 'Add ?cat=passing&side=home&limit=3'],
    ['Players', `${base}/vmix/live/players.xml`, 'Players/Row', 'Add ?side=home&cat=rushing&limit=5'],
    ['Scoring', `${base}/vmix/live/scoring.xml`, 'Scoring/Row', 'Scoring summary / ticker'],
    ['Recent Plays', `${base}/vmix/live/plays.xml`, 'Plays/Row', 'Add ?n=6'],
    ['Roster', `${base}/vmix/live/roster.xml`, 'Roster/Row', 'Add ?side=away'],
    ['Everything', `${base}/vmix/live/all.xml`, 'Game/Scoreboard/Row', 'All sections nested under <Game> — point the XPath at the section you want, e.g. Game/TeamStats/Row']
  ];
  wrap.innerHTML = rows.map(([l, u, xp, note]) => `
    <div class="vrow"><span class="lbl">${esc(l)}</span><code>${esc(u)}</code>
      <button data-copy="${esc(u)}">Copy</button>
      <a href="${esc(u)}" target="_blank" rel="noopener"><button>Open</button></a></div>
    <div class="hint" style="margin:-2px 0 8px 8px">${esc(note)}<br>
      <b>XPath</b> <code>${esc(xp)}</code>
      <button class="tiny" data-copy="${esc(xp)}">Copy</button></div>`).join('');
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

/**
 * A yes/no question with wording of our own. `confirm()` only offers OK and
 * Cancel, which cannot express "Archive now" against "Keep it in the list".
 * Resolves true for the primary action.
 */
function ask({ title, body, yes, no }) {
  return new Promise((resolve) => {
    const box = $('#ask');
    $('#ask-title').textContent = title;
    $('#ask-body').textContent = body;
    $('#ask-yes').textContent = yes;
    $('#ask-no').textContent = no;
    const done = (v) => {
      box.classList.add('hidden');
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter') done(true);
    };
    $('#ask-yes').onclick = () => done(true);
    $('#ask-no').onclick = () => done(false);
    document.addEventListener('keydown', onKey);
    box.classList.remove('hidden');
    $('#ask-yes').focus();
  });
}

async function commitGame() {
  if (!S.gameId) return;
  const id = S.gameId;
  try {
    const r = await api(`/api/games/${encodeURIComponent(id)}/commit`, { method: 'POST', body: '{}' });
    S.games = await api('/api/games');
    renderGameList();
    toast(`Final ${r.final.away}-${r.final.home} committed to season`, 'ok');

    // Offered rather than done automatically: the crew is often still holding
    // a final-score graphic, and exports are usually pulled straight after.
    const archiveNow = await ask({
      title: `Final ${r.final.away}–${r.final.home} committed`,
      body: 'Archive this game now to clear it from the games list? '
          + 'Nothing is deleted — the play-by-play, exports and season totals all stay, '
          + 'and it stays on air if it is still the active game. '
          + 'You can archive it later from Setup → Games.',
      yes: 'Archive now',
      no: 'Keep it in the list'
    });
    if (!archiveNow) return;
    await api(`/api/games/${encodeURIComponent(id)}/archive`, {
      method: 'POST', body: JSON.stringify({ archived: true })
    });
    S.games = await api('/api/games');
    renderGameList();
    toast('Archived — find it under "Show archived"', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
