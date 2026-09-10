/* Feed monitor: what the board is sending, what OSE made of it, and what
   actually reached the log. Polls one endpoint so a game-night refresh is a
   single request. */
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Every field OSE tries to read, in the order the operator thinks about them. */
const FIELDS = [
  ['period', 'Period'], ['clockMs', 'Clock'], ['running', 'Clock running'],
  ['homeScore', 'Home score'], ['awayScore', 'Away score'], ['possession', 'Possession'],
  ['homeShots', 'Home SOG'], ['awayShots', 'Away SOG'],
  ['homeCorners', 'Home corners'], ['awayCorners', 'Away corners'],
  ['homeSaves', 'Home saves'], ['awaySaves', 'Away saves'],
  ['half', 'Top/Bottom'], ['outs', 'Outs'], ['balls', 'Balls'], ['strikes', 'Strikes'],
  ['down', 'Down'], ['distance', 'Distance'], ['ballOn', 'Ball on'],
  ['auxClockMs', 'Play/shot clock']
];

/* Which feed-source switch governs each normalised field, so the monitor can
   say "you turned this off" rather than showing it as missing data. */
const OWNER = {
  period: 'period', clockMs: 'clock', running: 'running',
  homeScore: 'homeScore', awayScore: 'awayScore', possession: 'possession',
  homeShots: 'shots', awayShots: 'shots', homeCorners: 'corners', awayCorners: 'corners',
  homeSaves: 'saves', awaySaves: 'saves',
  half: 'half', outs: 'outs', balls: 'balls', strikes: 'strikes',
  down: 'down', distance: 'distance', ballOn: 'ballOn', auxClockMs: 'auxClock'
};

const S = { paused: false, last: {}, timer: null };

const ms2clock = (ms) => {
  if (ms == null) return null;
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const ago = (ms) => {
  if (ms == null) return '—';
  if (ms < 1000) return 'just now';
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s ago`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s ago`;
};

function kv(into, pairs) {
  into.innerHTML = '';
  for (const [k, v, cls] of pairs) {
    if (v === undefined) continue;
    into.appendChild(el('div', 'k', k));
    into.appendChild(el('div', 'v' + (cls ? ' ' + cls : ''), v));
  }
}

function paintLink(d) {
  const f = d.feed, pill = $('#link-pill');
  let cls = 'off', txt = 'Off';
  if (f.mode !== 'off') {
    if (f.stalled) { cls = 'warn'; txt = 'Gone quiet'; }
    else if (f.connected) { cls = 'up'; txt = `Live · ${f.mode.toUpperCase()}`; }
    else { cls = 'down'; txt = 'Disconnected'; }
  }
  pill.className = 'pill ' + cls;
  pill.textContent = txt;

  const quiet = f.quietMs;
  const quietCls = quiet == null ? '' : (quiet > (f.staleMs || 5000) ? 'bad' : 'good');
  kv($('#link-kv'), [
    ['Feed URL', f.url || '—'],
    ['Topic', f.topic || '—'],
    ['Messages', String(f.messages)],
    ['Last message', ago(quiet), quietCls],
    ['Warn if silent', f.staleMs ? `${Math.round(f.staleMs / 1000)}s` : 'off'],
    ['This server', (d.server.addresses || []).map((a) => `${a}:${d.server.port}`).join('  ') || '—'],
    f.dropReason ? ['Last drop', f.dropReason, 'bad'] : undefined,
    f.lastError ? ['Last error', f.lastError, 'bad'] : undefined
  ].filter(Boolean));
}

function paintGame(d) {
  const g = d.game;
  if (!g) {
    $('#game-name').textContent = 'no active game';
    kv($('#game-kv'), [['Status', 'Start or activate a game to log anything']]);
    return;
  }
  $('#game-name').textContent = `${g.sport} · ${g.matchup}`;
  $('#g-away-ab').textContent = g.matchup.split(' at ')[0] || 'AWAY';
  $('#g-home-ab').textContent = g.matchup.split(' at ')[1] || 'HOME';
  $('#g-away').textContent = g.score.away;
  $('#g-home').textContent = g.score.home;
  $('#g-clock').textContent = g.clock;
  $('#g-clock').classList.toggle('run', !!g.running);
  $('#g-period').textContent = g.periodLabel;

  const os = g.officialScore, b = g.boardStats;
  const mismatch = os && ((os.home != null && os.home !== g.score.home) ||
                          (os.away != null && os.away !== g.score.away));
  kv($('#game-kv'), [
    ['Clock source', g.feed.owns.clock ? 'Scorebot' : 'Manual'],
    ['Period source', g.feed.owns.period ? 'Scorebot' : 'Manual'],
    os ? ['Board score', `${os.away}–${os.home}`, mismatch ? 'bad' : 'good'] : undefined,
    b ? ['Board SOG', `${b.away.sog ?? '—'} / ${b.home.sog ?? '—'}`] : undefined,
    b ? ['Board corners', `${b.away.corners ?? '—'} / ${b.home.corners ?? '—'}`] : undefined,
    ['Entries logged', String(g.counts?.effective ?? 0)]
  ].filter(Boolean));
}

function paintParsed(d) {
  const n = d.normalized || {};
  const owns = d.game?.feed?.owns || {};
  const connected = !!d.feed.connected;
  const body = $('#parsed tbody');
  body.innerHTML = '';
  let shown = 0;
  for (const [key, label] of FIELDS) {
    const v = n[key];
    const ownerKey = OWNER[key];
    const isManual = connected && ownerKey && owns[ownerKey] === false;
    // Hide fields this board simply does not send, unless they were switched
    // off by hand — that is worth seeing, because it explains the gap.
    if (v === undefined && !isManual) continue;
    shown++;
    const tr = el('tr', v === undefined ? 'miss' : (isManual ? 'manual' : ''));
    tr.appendChild(el('td', 'fld', label));
    let text;
    if (v === undefined) text = 'not sent';
    else if (key === 'clockMs' || key === 'auxClockMs') text = ms2clock(v);
    else if (typeof v === 'boolean') text = v ? 'yes' : 'no';
    else if (v && typeof v === 'object') text = JSON.stringify(v);
    else text = String(v);
    tr.appendChild(el('td', 'val', text));
    tr.appendChild(el('td', 'src', isManual ? 'set to Manual' : ''));
    body.appendChild(tr);
  }
  if (!shown) body.appendChild(el('tr', null, '')).appendChild(el('td', 'fld', 'Nothing read yet'));
}

function paintRaw(d) {
  const pre = $('#raw');
  if (!d.raw && !d.rawText) { pre.textContent = 'No message received yet.'; $('#raw-note').textContent = ''; return; }
  if (!d.raw) { pre.textContent = d.rawText; $('#raw-note').textContent = 'non-JSON topic'; return; }
  // Sorted, with the padding the board sends made visible: a field that looks
  // empty on screen is usually " " rather than missing, and that distinction
  // is the difference between "board sends nothing" and "we cannot read it".
  const keys = Object.keys(d.raw).sort();
  const blanks = [];
  const lines = keys.map((k) => {
    const v = d.raw[k];
    const isBlank = typeof v === 'string' && v.trim() === '';
    if (isBlank) blanks.push(k);
    const shown = isBlank ? `"${'·'.repeat(v.length)}"  (blank)` : JSON.stringify(v);
    return `  ${k.padEnd(20)} ${shown}`;
  });
  pre.textContent = lines.join('\n');
  $('#raw-note').textContent = `${keys.length} fields · ${blanks.length} blank`;
}

function paintRecent(d) {
  const wrap = $('#recent');
  wrap.innerHTML = '';
  const rows = d.game?.recent || [];
  if (!rows.length) { wrap.appendChild(el('div', 'empty', 'Nothing logged yet.')); return; }
  for (const r of rows) {
    const row = el('div', 'rec');
    row.appendChild(el('span', 'rt', `${r.periodLabel || r.period || ''} ${r.clock || ''}`.trim()));
    // `label` carries the human sentence; `text` is the detail line under it.
    const said = [r.label, r.text].filter(Boolean).join(' — ');
    row.appendChild(el('span', 'rx', said || r.type || ''));
    wrap.appendChild(row);
  }
  $('#log-note').textContent = `${d.game?.counts?.effective ?? 0} entries this game`;
}

async function tick() {
  if (S.paused) return;
  try {
    const res = await fetch('/api/monitor');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    $('#conn').classList.add('ok');
    paintLink(d); paintGame(d); paintParsed(d); paintRaw(d); paintRecent(d);
  } catch {
    $('#conn').classList.remove('ok');
    $('#link-pill').className = 'pill down';
    $('#link-pill').textContent = 'No server';
  }
}

$('#mon-pause').onchange = (e) => {
  S.paused = e.target.checked;
  if (!S.paused) tick();
};

tick();
setInterval(tick, 1000);
