/* OpenStatsEngine — announcer view. Read-only; never writes a stat. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  gameId: null, sport: null, g: null,
  seen: new Set(),          // notable ids already popped
  primed: false,            // first payload must not replay the whole game
  popupsOn: true,
  index: [],
  sel: 0,
  clock: { base: 0, at: 0, running: false, down: true },
  aux: null
};

const api = async (p) => {
  const r = await fetch(p);
  const j = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(j?.error || j || `HTTP ${r.status}`);
  return j;
};

init();

async function init() {
  bindKeys();
  $('#popuptoggle').onclick = togglePopups;
  $('#clear').onclick = () => { $('#search').value = ''; runSearch(); $('#search').focus(); };
  $('#search').addEventListener('input', runSearch);

  try {
    const cfg = await api('/api/config');
    if (!cfg.activeGameId) return showNoGame();
    S.gameId = cfg.activeGameId;
    const meta = await api(`/api/games/${encodeURIComponent(S.gameId)}`);
    S.sport = await api(`/api/sports/${meta.sport}`);
    await refresh();
  } catch (e) {
    $('#nogame').textContent = 'Cannot reach the stats server: ' + e.message;
    return showNoGame();
  }

  stream();
  setInterval(tick, 200);
  // A safety net in case the event stream drops without firing onerror.
  setInterval(() => refresh().catch(() => {}), 15000);
  $('#search').focus();
}

function showNoGame() {
  $('#nogame').classList.remove('hidden');
  $('#main').classList.add('hidden');
  $('#searchwrap').classList.add('hidden');
  $('#board').classList.add('hidden');
}

function stream() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { $('#conn').classList.add('ok'); $('#conn').textContent = '● live'; };
  es.onerror = () => { $('#conn').classList.remove('ok'); $('#conn').textContent = '● reconnecting'; };
  es.addEventListener('update', (e) => {
    const d = JSON.parse(e.data || '{}');
    if (!d.gameId || d.gameId === S.gameId) refresh().catch(() => {});
  });
}

async function refresh() {
  const g = await api(`/api/games/${encodeURIComponent(S.gameId)}/announcer`);
  S.g = g;
  S.clock = { base: g.clock.clockMs, at: Date.now(), running: g.clock.running, down: g.clock.countsDown };
  S.aux = g.auxClock ? { ...g.auxClock, at: Date.now(), base: g.auxClock.ms } : null;
  handleNotables(g.announcer.notables);
  render();
}

/* ---------------------------- popups ---------------------------- */
function handleNotables(list) {
  if (!S.primed) {
    // First load: everything that already happened is history, not news.
    for (const n of list) S.seen.add(n.id);
    S.primed = true;
    return;
  }
  // oldest-first so a burst pops in the order it happened
  for (const n of [...list].reverse()) {
    if (S.seen.has(n.id)) continue;
    S.seen.add(n.id);
    if (S.popupsOn) popup(n);
  }
}

const POP_MS = { huge: 14000, big: 9000, note: 7000 };

function popup(n) {
  const wrap = $('#popups');
  while (wrap.children.length >= 3) wrap.firstChild.remove();

  const p = el('div', `pop ${n.level}`);
  if (n.color) p.style.borderLeftColor = n.color;
  const h = el('div', 'pop-h');
  h.appendChild(el('span', 'pop-team', n.teamAbbrev || ''));
  h.appendChild(el('span', 'pop-title', n.headline));
  p.appendChild(h);
  if (n.detail) p.appendChild(el('div', 'pop-detail', n.detail));
  const when = [n.periodLabel || (n.period ? `P${n.period}` : ''), n.clock].filter(Boolean).join(' · ');
  if (when) p.appendChild(el('div', 'pop-when', when));

  const x = el('button', 'pop-x', '✕');
  x.onclick = () => p.remove();
  p.appendChild(x);

  wrap.appendChild(p);
  setTimeout(() => p.remove(), POP_MS[n.level] || 9000);
}

function togglePopups() {
  S.popupsOn = !S.popupsOn;
  $('#popuptoggle').textContent = `Popups: ${S.popupsOn ? 'on' : 'off'}`;
  $('#popuptoggle').classList.toggle('off', !S.popupsOn);
  if (!S.popupsOn) $('#popups').innerHTML = '';
}

/* ---------------------------- clocks ---------------------------- */
function tick() {
  if (!S.g) return;
  if (S.sport?.hasClock !== false) {
    const c = S.clock;
    const ms = c.running ? (c.down ? Math.max(0, c.base - (Date.now() - c.at)) : c.base + (Date.now() - c.at)) : c.base;
    $('#bclock').textContent = fmtClock(ms);
  } else $('#bclock').textContent = '—';

  if (S.aux && S.aux.enabled) {
    const a = S.aux;
    const ms = a.running ? Math.max(0, a.base - (Date.now() - a.at)) : a.base;
    const v = $('#baux-val');
    v.textContent = Math.ceil(ms / 1000);
    v.className = ms <= 0 ? 'expired' : (ms <= 5000 ? 'warn' : '');
  }
}

function fmtClock(ms) {
  ms = Math.max(0, ms || 0);
  const t = ms / 1000, m = Math.floor(t / 60), s = t - m * 60;
  if (m === 0 && ms < 60000) return `:${s.toFixed(1).padStart(4, '0')}`;
  return `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
}

/* ---------------------------- render ---------------------------- */
function render() {
  const g = S.g, A = g.teams.away, H = g.teams.home;
  const sit = g.situation || {};

  for (const [side, box] of [['away', $('#bteam-away')], ['home', $('#bteam-home')]]) {
    const t = g.teams[side];
    $('.bname', box).textContent = t.shortName || t.name;
    $('.bscore', box).textContent = t.points;
    $('.brec', box).textContent = t.mascot || '';
    box.classList.toggle('poss', sit.possession === side);
    if (t.primaryColor) $('.bscore', box).style.color = '';
  }
  $('#bperiod').textContent = `${g.clock.periodLabel} ${S.sport.periods.label}`;
  $('#bclock').classList.toggle('running', g.clock.running);

  let s = '';
  if (sit.down != null && S.sport.trackDownDistance) {
    s = `${ord(sit.down)} & ${sit.distance === 0 ? 'Goal' : sit.distance}`;
    if (sit.possession) s += ` · ${g.teams[sit.possession].abbrev}`;
  } else if (S.sport.hasCount) {
    const b = sit.bases || {};
    s = `${sit.half === 'bottom' ? 'BOT' : 'TOP'} ${g.clock.periodLabel} · ${sit.balls ?? 0}-${sit.strikes ?? 0}, ${sit.outs ?? 0} out`;
    if (b.occupied) s += ` · ${b.display}`;
  } else if (sit.possession) s = `Possession: ${g.teams[sit.possession].abbrev}`;
  $('#bsit').textContent = s;

  const auxBox = $('#baux');
  if (S.aux && S.aux.enabled) { auxBox.classList.remove('hidden'); $('#baux-lbl').textContent = S.aux.label; }
  else auxBox.classList.add('hidden');

  $('#gamelabel').textContent = `${A.name} at ${H.name} · ${g.meta.date}${g.meta.venue ? ' · ' + g.meta.venue : ''}`;

  renderCards('#storylines', g.announcer.storylines.map((x) => ({ text: x.text, cls: '' })),
    'Nothing notable yet — it builds as the game goes.');
  renderCards('#watch', g.announcer.watch.map((w) => ({ text: `${w.team} ${w.text}`, cls: 'warn' })),
    'No one close to a milestone yet.');
  renderCards('#milestones', g.announcer.milestones.map((m) => ({ text: `${m.team} ${m.text}`, cls: 'gold' })),
    'No milestones reached yet.');

  renderLeaders(g);
  renderTeamStats(g);
  renderScoring(g);
  renderPlays(g);

  buildIndex(g);
  renderChips();
  if ($('#search').value.trim()) runSearch();
  tick();
}

const ord = (n) => ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;

function renderCards(sel, items, emptyMsg) {
  const w = $(sel); w.innerHTML = '';
  if (!items.length) { w.appendChild(el('div', 'empty-note', emptyMsg)); return; }
  for (const it of items) w.appendChild(el('div', `card ${it.cls}`, it.text));
}

function renderLeaders(g) {
  const w = $('#leaders'); w.innerHTML = '';
  let any = false;
  for (const cat of S.sport.leaderCategories) {
    const L = g.leaders[cat.key];
    if (!L || !L.rows.length) continue;
    any = true;
    const box = el('div', 'lead');
    box.appendChild(el('div', 'lead-h', L.label));
    for (const r of L.rows.slice(0, 4)) {
      const row = el('div', 'lead-r');
      row.appendChild(el('span', 'tm', g.teams[r.side].abbrev));
      row.appendChild(el('span', 'nm', `#${r.number} ${r.name}`));
      row.appendChild(el('span', 'ln', r.line));
      box.appendChild(row);
    }
    w.appendChild(box);
  }
  if (!any) w.appendChild(el('div', 'empty-note', 'No stats logged yet.'));
}

/** Stats where the smaller number is the better one. */
const LOWER_BETTER = new Set([
  'turnovers', 'fumbles_lost', 'int_thrown', 'penalties', 'penalty_yds', 'penalty_line',
  'sacks_allowed', 'timeouts_used', 'to', 'pf', 'pim', 'giveaways', 'ga',
  'fouls', 'offsides', 'yc', 'rc', 'errors', 'lob', 'so', 'pen_time', 'cs'
]);

function renderTeamStats(g) {
  const w = $('#teamstats');
  let h = '<table class="cmp"><tr class="cmp-head"><td>' + esc(g.teams.away.abbrev) +
    '</td><td>Team</td><td>' + esc(g.teams.home.abbrev) + '</td></tr>';
  for (const [k, label] of S.sport.teamStatRows) {
    const a = g.teams.away[k], hm = g.teams.home[k];
    // Only mark a winner when both sides are plain numbers. Composite values
    // like "5-4-0" or "2/7" have no meaningful greater-than, and highlighting
    // the wrong side of turnovers or penalties would actively mislead.
    const plain = (v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()));
    let aWin = false, hWin = false;
    if (plain(a) && plain(hm)) {
      const na = parseFloat(a), nh = parseFloat(hm);
      if (na !== nh) {
        const awayBetter = LOWER_BETTER.has(k) ? na < nh : na > nh;
        aWin = awayBetter; hWin = !awayBetter;
      }
    }
    h += `<tr><td class="${aWin ? 'win' : ''}">${esc(fmt(a))}</td><td>${esc(label)}</td>` +
         `<td class="${hWin ? 'win' : ''}">${esc(fmt(hm))}</td></tr>`;
  }
  w.innerHTML = h + '</table>';
}

function renderScoring(g) {
  const w = $('#scoring'); w.innerHTML = '';
  if (!g.scoringPlays.length) { w.appendChild(el('div', 'empty-note', 'No scoring yet.')); return; }
  for (const s of [...g.scoringPlays].reverse().slice(0, 8)) {
    const d = el('div', 'sc');
    d.appendChild(el('span', 'w', `${s.periodLabel} ${s.clock}`));
    d.appendChild(el('span', 't', g.teams[s.side].abbrev));
    d.appendChild(el('span', 'd', s.desc));
    d.appendChild(el('span', 's', `${s.awayScore}-${s.homeScore}`));
    w.appendChild(d);
  }
}

function renderPlays(g) {
  const w = $('#plays'); w.innerHTML = '';
  const items = g.timeline.filter((t) => t.type === 'stat').slice(0, 12);
  if (!items.length) { w.appendChild(el('div', 'empty-note', 'No plays logged yet.')); return; }
  for (const t of items) {
    const d = el('div', 'play');
    d.appendChild(el('span', 'w', `${t.periodLabel ?? ''} ${t.clock ?? ''}`));
    d.appendChild(el('span', 't', t.team ? g.teams[t.team].abbrev : ''));
    const x = el('div', 'x');
    x.appendChild(el('span', null, t.label));
    if (t.text) x.appendChild(el('i', null, t.text));
    d.appendChild(x);
    w.appendChild(d);
  }
}

const fmt = (v) => v == null ? '' : (typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(1)) : v);

/* ---------------------------- search ---------------------------- */
/**
 * One flat index of everything askable: players (with every stat line they
 * qualify for), each team-comparison row, each leader board, and the
 * situational numbers. Matching is keyword-based so "3rd down", "third",
 * "possession" and a jersey number all land somewhere sensible.
 */
function buildIndex(g) {
  const idx = [];
  const kw = (...parts) => parts.filter(Boolean).join(' ').toLowerCase();

  for (const p of Object.values(g.players)) {
    const team = g.teams[p.side];
    const lines = [];
    for (const tbl of S.sport.playerStatTables) {
      const cells = tbl.cols.map(([k, l]) => [l, p[k]]).filter(([, v]) => v !== undefined && v !== null && v !== 0 && v !== '0' && v !== '0-0' && v !== '0/0');
      if (cells.length) lines.push({ label: tbl.label, cells });
    }
    if (!lines.length) continue;
    idx.push({
      type: 'player', tag: 'player',
      title: `#${p.number} ${p.name}`,
      sub: `${team.name}${p.pos ? ' · ' + p.pos : ''}${p.year ? ' · ' + p.year : ''}`,
      keywords: kw(p.name, p.number, '#' + p.number, team.name, team.abbrev, team.shortName, p.pos),
      lines
    });
  }

  for (const [k, label] of S.sport.teamStatRows) {
    idx.push({
      type: 'team', tag: 'team stat', title: label,
      keywords: kw(label, k, k.replace(/_/g, ' '), 'team'),
      compare: { away: fmt(g.teams.away[k]), home: fmt(g.teams.home[k]),
                 awayName: g.teams.away.abbrev, homeName: g.teams.home.abbrev }
    });
  }

  for (const cat of S.sport.leaderCategories) {
    const L = g.leaders[cat.key];
    if (!L || !L.rows.length) continue;
    idx.push({
      type: 'leaders', tag: 'leaders', title: `${L.label} leaders`,
      keywords: kw(L.label, cat.key, 'leader leaders best top most'),
      rows: L.rows.slice(0, 5).map((r) => `${g.teams[r.side].abbrev} #${r.number} ${r.name} — ${r.line}`)
    });
  }

  // situational odds and ends announcers reach for
  const sit = [
    ['Time of Possession', kw('time of possession top clock control'),
     { away: g.teams.away.top, home: g.teams.home.top, awayName: g.teams.away.abbrev, homeName: g.teams.home.abbrev }],
    ['Since Last Score', kw('drought since last score scoreless'),
     { away: g.droughts.away.display, home: g.droughts.home.display, awayName: g.teams.away.abbrev, homeName: g.teams.home.abbrev }],
    ['Biggest Run', kw('run streak biggest unanswered'),
     { away: g.runs.best.away, home: g.runs.best.home, awayName: g.teams.away.abbrev, homeName: g.teams.home.abbrev }]
  ];
  // Some sports already carry these in teamStatRows (football has Time of
  // Possession); don't offer the same thing twice.
  const already = new Set(idx.map((i) => i.title.toLowerCase()));
  for (const [title, keywords, compare] of sit) {
    if (compare.away == null && compare.home == null) continue;
    if (already.has(title.toLowerCase())) continue;
    idx.push({ type: 'team', tag: 'situational', title, keywords, compare });
  }

  S.index = idx;
}

function score(item, q) {
  const k = item.keywords;
  const t = item.title.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 900;
  // whole-word start anywhere in the keywords is the common case
  if (new RegExp(`(^|[\\s#])${escRx(q)}`).test(k)) return 800 - t.length;
  if (k.includes(q)) return 500 - t.length;
  // every typed word present somewhere ("third down", "prep rushing")
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => k.includes(w))) return 400;
  return 0;
}
const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function runSearch() {
  const q = $('#search').value.trim().toLowerCase();
  const box = $('#results');
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }

  const hits = S.index
    .map((i) => ({ i, s: score(i, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 12)
    .map((x) => x.i);

  box.classList.remove('hidden');
  if (!hits.length) {
    box.innerHTML = `<div class="nores">Nothing matches “${esc(q)}”. Try a player, a jersey number, a team, or a stat like “rushing” or “third down”.</div>`;
    return;
  }
  S.sel = Math.min(S.sel, hits.length - 1);
  box.innerHTML = hits.map((h, n) => renderResult(h, n === S.sel)).join('');
}

function renderResult(h, sel) {
  let inner = `<div class="res-h"><span class="res-t">${esc(h.title)}</span>` +
              `<span class="res-tag ${h.type}">${esc(h.tag)}</span></div>`;
  if (h.sub) inner += `<div class="res-sub">${esc(h.sub)}</div>`;

  if (h.lines) {
    for (const l of h.lines) {
      inner += `<div class="res-sub" style="margin-top:8px">${esc(l.label)}</div><div class="res-grid">` +
        l.cells.map(([lab, v]) => `<div><b>${esc(fmt(v))}</b><span>${esc(lab)}</span></div>`).join('') + '</div>';
    }
  }
  if (h.compare) {
    inner += `<div class="res-grid" style="margin-top:8px">` +
      `<div><b>${esc(h.compare.away)}</b><span>${esc(h.compare.awayName)}</span></div>` +
      `<div><b>${esc(h.compare.home)}</b><span>${esc(h.compare.homeName)}</span></div></div>`;
  }
  if (h.rows) inner += h.rows.map((r) => `<div class="res-line">${esc(r)}</div>`).join('');

  return `<div class="res ${sel ? 'sel' : ''}">${inner}</div>`;
}

function renderChips() {
  const w = $('#chips');
  if (w.dataset.sport === S.sport.id) return;
  w.dataset.sport = S.sport.id;
  w.innerHTML = '';
  const common = ['Time of Possession', 'Since Last Score'];
  const perSport = {
    football: ['Passing', 'Rushing', 'Receiving', 'Tackles', 'Third Down', 'Turnovers', 'Total Yards'],
    basketball: ['Points', 'Rebounds', 'Assists', 'FG%', 'Turnovers'],
    hockey: ['Points', 'Goals', 'Goaltending', 'Power Play', 'Faceoff'],
    soccer: ['Scoring', 'Shots', 'Corner', 'Saves', 'Fouls'],
    lacrosse: ['Points', 'Ground Balls', 'Faceoffs', 'Clears', 'Saves'],
    baseball: ['Batting', 'Pitching', 'Hits', 'Errors']
  };
  for (const c of [...(perSport[S.sport.id] || []), ...common]) {
    const b = el('button', 'chip', c);
    b.onclick = () => { $('#search').value = c; runSearch(); $('#search').focus(); };
    w.appendChild(b);
  }
}

/* ---------------------------- keyboard ---------------------------- */
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const inSearch = e.target === $('#search');
    if (e.key === '/' && !inSearch) { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
    if (e.key === 'Escape') { $('#search').value = ''; runSearch(); $('#search').blur(); $('#popups').innerHTML = ''; return; }
    if (inSearch) {
      if (e.key === 'ArrowDown') { e.preventDefault(); S.sel++; runSearch(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); S.sel = Math.max(0, S.sel - 1); runSearch(); }
      return;
    }
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePopups(); }
    else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    }
  });
}
