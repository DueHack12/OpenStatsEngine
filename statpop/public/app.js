const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let S = null;              // settings, as the server has them
let P = null;              // last preview
let saveTimer = null;
let pending = {};          // settings changes waiting to be saved

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status}`);
  return body;
}

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.className = ''; }, kind === 'bad' ? 6000 : 2500);
}

/* --------------------------------------------------------------- saving */

function queue(patch, delay = 350) {
  Object.assign(pending, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, delay);
}
async function flush() {
  clearTimeout(saveTimer);
  if (!Object.keys(pending).length) return;
  const body = pending;
  pending = {};
  try {
    S = await api('/api/settings', { method: 'PUT', body });
    await refresh();
  } catch (e) { toast('Could not save: ' + e.message, 'bad'); }
}

const rowsFromDom = () => $$('#rows .row').map((li) => ({
  query: $('.q', li).value, label: $('.label', li).value, pick: li.dataset.pick || '',
  a: $('.a', li).value, b: $('.b', li).value
}));
function saveRows(delay) {
  S.rows = rowsFromDom();
  queue({ rows: S.rows }, delay);
}

/* ----------------------------------------------------------------- rows */

function buildRows() {
  const ol = $('#rows');
  ol.innerHTML = '';
  for (let i = 0; i < S.rowCount; i++) {
    const r = S.rows[i] || {};
    const li = $('#rowTpl').content.firstElementChild.cloneNode(true);
    $('.n', li).textContent = i + 1;
    $('.q', li).value = r.query || '';
    $('.label', li).value = r.label || '';
    $('.a', li).value = r.a || '';
    $('.b', li).value = r.b || '';
    li.dataset.pick = r.pick || '';

    $('.q', li).addEventListener('input', () => { li.dataset.pick = ''; saveRows(); });
    for (const c of ['.label', '.a', '.b']) $(c, li).addEventListener('input', () => saveRows());
    $('.alt', li).addEventListener('change', (e) => { li.dataset.pick = e.target.value; saveRows(0); });
    $('.ra', li).addEventListener('click', () => { $('.a', li).value = ''; saveRows(0); });
    $('.rb', li).addEventListener('click', () => { $('.b', li).value = ''; saveRows(0); });
    $('.clear', li).addEventListener('click', () => {
      for (const c of ['.q', '.label', '.a', '.b']) $(c, li).value = '';
      li.dataset.pick = '';
      saveRows(0);
      $('.q', li).focus();
    });
    $('.chip', li).addEventListener('click', () => {
      const r = P?.rows[i];
      if (!r?.match) return;
      $('.label', li).value = r.match.label;
      saveRows(0);
    });
    $('.up', li).addEventListener('click', () => move(i, -1));
    $('.down', li).addEventListener('click', () => move(i, 1));
    ol.appendChild(li);
  }
}

function move(i, d) {
  const rows = rowsFromDom();
  const j = i + d;
  if (j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  S.rows = rows;
  buildRows();
  queue({ rows }, 0);
  if (P) paintRows();
}

const SOURCE = {
  team: 'OSE team stat', 'team-raw': 'OSE team stat', derived: 'calculated',
  'player-sum': 'sum of players', 'player-max': 'best player'
};

function paintRows() {
  $$('#rows .row').forEach((li, i) => {
    const r = P.rows[i];
    if (!r) return;
    const chip = $('.chip', li);
    const alt = $('.alt', li);
    li.classList.toggle('empty', r.empty);
    if (r.match) {
      chip.className = 'chip ok' + (r.pinned ? ' pinned' : '');
      chip.textContent = `${r.pinned ? '📌 ' : '✓ '}${r.match.label}`;
      chip.title = `${SOURCE[r.match.source] || r.match.source} · ${r.match.id} — click to use as the on-air label`;
    } else if (r.query.trim()) {
      chip.className = 'chip bad';
      chip.textContent = !P.game ? 'Waiting for OSE…'
        : r.alternatives.length ? 'No confident match — type the values, or pick one →' : 'No match — type the values yourself';
      chip.title = '';
    } else {
      chip.className = 'chip';
      chip.textContent = r.label ? 'Manual row' : '';
    }
    // alternatives
    const sig = JSON.stringify([r.pick, r.alternatives.map((a) => a.id)]);
    if (alt.dataset.sig !== sig && document.activeElement !== alt) {
      alt.dataset.sig = sig;
      alt.innerHTML = '';
      alt.append(new Option(r.pick ? 'Back to best match' : 'Other matches…', ''));
      for (const a of r.alternatives) {
        alt.append(new Option(`${a.label}  (${a.a || '–'} / ${a.b || '–'})`, a.id));
      }
      if (r.pick && !r.alternatives.some((a) => a.id === r.pick) && r.match) {
        alt.append(new Option(`${r.match.label}`, r.pick));
      }
      alt.value = r.pick || '';
      alt.hidden = !r.alternatives.length && !r.pick;
    }
    $('.a', li).placeholder = r.autoA || '—';
    $('.b', li).placeholder = r.autoB || '—';
    $('.label', li).placeholder = r.query || 'label';
    $('.ra', li).hidden = !r.overA;
    $('.rb', li).hidden = !r.overB;
    $('.a', li).classList.toggle('over', r.overA);
    $('.b', li).classList.toggle('over', r.overB);
  });
}

/* -------------------------------------------------------------- preview */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function paintPreview() {
  const { A, B } = P;
  $('#pvHeader').textContent = P.header || ' ';
  $('#pvAScore').textContent = S.sendScore && A ? A.score : '';
  $('#pvBScore').textContent = S.sendScore && B ? B.score : '';
  $('#pvALogo').textContent = A?.abbrev || 'A';
  $('#pvBLogo').textContent = B?.abbrev || 'B';
  $('#pvALogo').style.background = A?.color || '';
  $('#pvBLogo').style.background = B?.color || '';
  $('#pvBScore').style.background = B?.color || '';
  $('#pvRows').innerHTML = P.rows.map((r) => `
    <div class="gfx-row">
      <span class="${r.overA ? 'over' : ''}">${esc(r.valA)}</span>
      <span class="gl">${esc(r.label)}</span>
      <span class="${r.overB ? 'over' : ''}">${esc(r.valB)}</span>
    </div>`).join('');

  for (const [id, t, side] of [['#teamA', A, 'left'], ['#teamB', B, 'right']]) {
    $('b', $(id)).textContent = t ? `${t.abbrev || t.name} ${t.side === 'home' ? '(home)' : '(away)'}` : '—';
    $('.sw', $(id)).style.background = t?.color || 'transparent';
    $('small', $(id)).textContent = side;
  }
  $('#colA').textContent = A?.abbrev || 'Left';
  $('#colB').textContent = B?.abbrev || 'Right';

  $('#gameLine').textContent = P.game
    ? `${P.game.sport} · ${P.game.period || ''} ${P.game.clock || ''} · ${P.game.status || ''}`
    : '';
  $('#stale').textContent = P.stale ? '· OSE unreachable — showing last known stats' : '';

  $('#fieldsBody').innerHTML = P.fields
    .map((f) => `<tr><td>${esc(f.field)}</td><td>${esc(f.value)}</td></tr>`).join('');
}

function paintStatus() {
  const op = $('#osePill');
  op.className = 'pill ' + (P.ose.ok ? 'ok' : 'bad');
  $('span', op).textContent = P.ose.ok && P.game ? `OSE · ${P.A?.abbrev || ''} vs ${P.B?.abbrev || ''}` : 'OSE offline';
  op.title = P.ose.error || 'Connected to OpenStatsEngine';

  const vp = $('#vmixPill');
  const v = P.vmix;
  vp.className = 'pill ' + (v.ok === true ? 'ok' : v.ok === false ? 'bad' : '');
  $('span', vp).textContent = !S.vmix.input ? 'vMix · no input' : v.ok === false ? 'vMix error' : `vMix · ${S.vmix.input}`;
  vp.title = v.error || (v.lastPush ? `Last push ${new Date(v.lastPush).toLocaleTimeString()}` : 'Nothing sent yet');
  $('#live').checked = !!P.live;
  document.body.classList.toggle('is-live', !!P.live);
}

async function refresh() {
  try {
    P = await api('/api/preview');
    paintRows();
    paintPreview();
    paintStatus();
  } catch { /* server restarting */ }
}

/* ------------------------------------------------------------- catalog */

let catalog = [];
async function loadCatalog() {
  try {
    const c = await api('/api/catalog');
    catalog = c.entries;
    const dl = $('#statList');
    dl.innerHTML = '';
    for (const e of catalog) dl.append(new Option(e.label));
    paintBrowse();
  } catch { /* ignore */ }
}
function paintBrowse() {
  const f = $('#browseFilter').value.toLowerCase();
  $('#browseBody').innerHTML = catalog
    .filter((e) => !f || e.label.toLowerCase().includes(f) || e.key.includes(f))
    .map((e) => `<tr><td>${esc(e.label)}<small>${esc(SOURCE[e.source] || e.source)}</small></td><td class="num">${esc(e.a)}</td><td class="num">${esc(e.b)}</td></tr>`)
    .join('');
}

/* ------------------------------------------------------------ settings */

function fillSettings() {
  $('#header').value = S.header;
  $('#oseUrl').value = S.ose.url;
  $('#vmixUrl').value = S.vmix.url;
  $('#fHeader').value = S.fields.header;
  $('#fScoreA').value = S.fields.scoreA;
  $('#fScoreB').value = S.fields.scoreB;
  $('#fLabel').value = S.fields.label;
  $('#fValA').value = S.fields.valA;
  $('#fValB').value = S.fields.valB;
  $('#sendScore').checked = S.sendScore;
  $('#uppercase').checked = S.uppercaseLabels;
  $('#rowCount').value = S.rowCount;
  $('#interval').value = S.intervalMs / 1000;
  fillPresets();
}

function fillPresets() {
  const sel = $('#presetSel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— saved sets —</option>';
  for (const n of S.presetNames || []) sel.append(new Option(n, n));
  sel.value = (S.presetNames || []).includes(cur) ? cur : '';
}

async function loadGames() {
  const r = await api('/api/games');
  const sel = $('#oseGame');
  sel.innerHTML = '';
  const active = r.games.find((g) => g.id === r.activeGameId);
  sel.append(new Option(`Follow the active game${active ? ` (now: ${gameName(active)})` : ''}`, ''));
  for (const g of r.games.filter((g) => !g.archived)) sel.append(new Option(gameName(g), g.id));
  if (S.ose.gameId && ![...sel.options].some((o) => o.value === S.ose.gameId)) sel.append(new Option(S.ose.gameId, S.ose.gameId));
  sel.value = S.ose.gameId;
  $('#oseHint').textContent = r.ok ? `${r.games.length} game(s) in OSE` : r.error;
  $('#oseHint').className = r.ok ? 'hint' : 'warn';
}
const gameName = (g) => `${g.date || ''} ${g.awayName || g.awayTeamId || ''} at ${g.homeName || g.homeTeamId || ''} (${g.sport || ''})`.trim();

async function loadVmix() {
  const r = await api('/api/vmix');
  const sel = $('#vmixInput');
  sel.innerHTML = '<option value="">— choose —</option>';
  for (const i of r.inputs) sel.append(new Option(`${i.number}. ${i.title}`, i.title));
  if (S.vmix.input && ![...sel.options].some((o) => o.value === S.vmix.input)) sel.append(new Option(S.vmix.input + ' (not found)', S.vmix.input));
  sel.value = S.vmix.input;
  const hint = $('#vmixHint');
  if (!r.ok) { hint.textContent = r.error; hint.className = 'warn'; }
  else {
    hint.className = 'hint';
    hint.textContent = `vMix ${r.version} · ${r.inputs.length} title input(s)` +
      (r.selected ? ` · using #${r.selected.number}` : S.vmix.input ? ' · selected input not found' : '');
  }
  const miss = $('#missing');
  miss.hidden = !(r.ok && r.selected && r.missing.length);
  if (!miss.hidden) {
    miss.textContent = `This title has no field called: ${r.missing.join(', ')}. ` +
      `Its fields are: ${r.selected.fields.join(', ')}`;
  }
  return r;
}

/* ------------------------------------------------------------- wiring */

function wire() {
  $('#header').addEventListener('input', (e) => queue({ header: e.target.value }));
  $('#swap').addEventListener('click', () => queue({ teamA: S.teamA === 'home' ? 'away' : 'home' }, 0));
  $('#live').addEventListener('change', (e) => {
    queue({ live: e.target.checked }, 0);
    toast(e.target.checked ? 'Live: changes go to vMix automatically' : 'Live off — use Send to vMix');
  });
  $('#sendBtn').addEventListener('click', async () => {
    await flush();
    const r = await api('/api/send', { method: 'POST' });
    if (r.errors?.length) toast(r.errors[0], 'bad');
    else toast(`Sent ${r.sent} field(s) to vMix`, 'good');
    refresh();
  });
  for (const [id, action] of [['#ovlIn', 'In'], ['#ovlOut', 'Out']]) {
    $(id).addEventListener('click', async () => {
      await flush();
      const r = await api('/api/overlay', { method: 'POST', body: { channel: $('#ovl').value, action } });
      if (!r.ok) toast(r.error, 'bad');
      refresh();
    });
  }
  $('#settingsBtn').addEventListener('click', async () => {
    const box = $('#settings');
    box.hidden = !box.hidden;
    $('#settingsBtn').setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) { loadGames().catch(() => {}); loadVmix().catch(() => {}); }
  });

  const onChange = (sel, fn) => $(sel).addEventListener('change', fn);
  onChange('#oseUrl', (e) => { queue({ ose: { url: e.target.value } }, 0); setTimeout(() => { loadGames().catch(() => {}); loadCatalog(); }, 400); });
  onChange('#oseGame', (e) => { queue({ ose: { gameId: e.target.value } }, 0); setTimeout(loadCatalog, 400); });
  onChange('#vmixUrl', (e) => { queue({ vmix: { url: e.target.value } }, 0); setTimeout(() => loadVmix().catch(() => {}), 400); });
  onChange('#vmixInput', (e) => { queue({ vmix: { input: e.target.value } }, 0); setTimeout(() => loadVmix().catch(() => {}), 400); });
  $('#vmixRefresh').addEventListener('click', () => loadVmix().catch(() => {}));
  const fieldMap = { fHeader: 'header', fScoreA: 'scoreA', fScoreB: 'scoreB', fLabel: 'label', fValA: 'valA', fValB: 'valB' };
  for (const [id, k] of Object.entries(fieldMap)) {
    onChange('#' + id, (e) => { queue({ fields: { [k]: e.target.value } }, 0); setTimeout(() => loadVmix().catch(() => {}), 400); });
  }
  onChange('#sendScore', (e) => queue({ sendScore: e.target.checked }, 0));
  onChange('#uppercase', (e) => queue({ uppercaseLabels: e.target.checked }, 0));
  onChange('#rowCount', async (e) => {
    S.rows = rowsFromDom();
    queue({ rowCount: e.target.value, rows: S.rows }, 0);
    await flush();
    buildRows();
    refresh();
  });
  onChange('#interval', (e) => queue({ intervalMs: Math.round(parseFloat(e.target.value) * 1000) }, 0));

  $('#presetSave').addEventListener('click', async () => {
    const name = $('#presetName').value.trim() || $('#presetSel').value;
    if (!name) return toast('Type a name for this set first', 'bad');
    await flush();
    S = await api('/api/presets', { method: 'POST', body: { name } });
    fillPresets();
    $('#presetSel').value = name;
    $('#presetName').value = '';
    toast(`Saved "${name}"`, 'good');
  });
  $('#presetLoad').addEventListener('click', async () => {
    const name = $('#presetSel').value;
    if (!name) return;
    await flush();
    S = await api('/api/presets/' + encodeURIComponent(name), { method: 'POST' });
    $('#header').value = S.header;
    $('#rowCount').value = S.rowCount;
    buildRows();
    refresh();
    toast(`Loaded "${name}"`, 'good');
  });
  $('#presetDel').addEventListener('click', async () => {
    const name = $('#presetSel').value;
    if (!name || !confirm(`Delete the preset "${name}"?`)) return;
    S = await api('/api/presets/' + encodeURIComponent(name), { method: 'DELETE' });
    fillPresets();
  });
  $('#browseFilter').addEventListener('input', paintBrowse);
  window.addEventListener('beforeunload', () => { if (Object.keys(pending).length) navigator.sendBeacon?.('/api/settings', new Blob([JSON.stringify(pending)], { type: 'application/json' })); });
}

(async function init() {
  S = await api('/api/settings');
  fillSettings();
  buildRows();
  wire();
  await refresh();
  loadCatalog();
  if (!S.vmix.input) { $('#settingsBtn').click(); }
  setInterval(refresh, 1500);
  setInterval(loadCatalog, 10000);
})();
