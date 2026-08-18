import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store } from './src/store.js';
import { registerRoutes } from './src/api.js';
import { ScorebotClient } from './src/integrations/scorebot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- args ---------------- */
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const PORT = parseInt(arg('port', process.env.OSE_PORT || '8080'), 10);
const HOST = arg('host', process.env.OSE_HOST || '0.0.0.0');
const DATA = path.resolve(arg('data', process.env.OSE_DATA || path.join(__dirname, 'data')));
const PUBLIC = path.join(__dirname, 'public');

const store = new Store(DATA);

// Snapshot the season before doing anything else, so a bad day can be undone.
if (!argv.includes('--no-backup')) {
  try {
    const at = store.backup();
    if (at) console.log(`  Backed up to ${at}`);
  } catch (e) { console.error('  Backup failed (continuing):', e.message); }
}

/* ---------------- tiny router ---------------- */
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[A-Za-z0-9_]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  }).replace(/\*/g, '(.*)') + '$');
  routes.push({ method, rx, keys, handler });
}

/* ---------------- SSE bus ---------------- */
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

const scorebot = new ScorebotClient({
  store,
  onChange: (gameId) => broadcast('update', { gameId, source: 'scorebot' }),
  // A feed that dies mid-game is silent by nature — no events arrive, so the
  // 'update' channel above would never fire and the booth would just watch the
  // numbers quietly stop moving. Connection changes get their own channel.
  onStatus: (st) => broadcast('feed', {
    connected: !!st.connected,
    mode: st.mode,
    topic: st.topic || null,
    unexpected: !!st.unexpected,
    droppedAt: st.droppedAt || null,
    reason: st.dropReason || null,
    stalled: !!st.stalled,
    // Intent, so a listener can tell "the operator turned it off" from
    // "the operator wants it and it is gone".
    wanted: !!store.config.scorebot?.enabled
  })
});

const ctx = { store, broadcast, scorebot, DATA, PUBLIC };
registerRoutes(route, ctx);

/* ---------------- static ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json'
};

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

/* ---------------- request handling ---------------- */
async function readBody(req, limit = 20 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { res.writeHead(400).end('Bad URL'); return; }

  // Open CORS: vMix, browsers and other tools on the LAN all need to read this.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  const pathname = decodeURIComponent(url.pathname);

  // SSE endpoint
  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* dropped */ } }, 20000);
    req.on('close', () => { clearInterval(ka); sseClients.delete(res); });
    return;
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.rx.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    const query = Object.fromEntries(url.searchParams.entries());
    try {
      let body = null;
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const raw = await readBody(req);
        const ct = req.headers['content-type'] || '';
        if (ct.includes('application/json')) body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
        else body = raw.toString('utf8');
      }
      const out = await r.handler({ params, query, body, req, res, url });
      if (res.writableEnded || res.headersSent) return;
      if (out === undefined || out === null) { res.writeHead(204).end(); return; }
      if (out && out.__raw) {
        res.writeHead(out.status || 200, {
          'Content-Type': out.type || 'application/octet-stream',
          'Cache-Control': 'no-store',
          ...(out.filename ? { 'Content-Disposition': `attachment; filename="${out.filename}"` } : {}),
          ...(out.headers || {})
        });
        res.end(out.body);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out));
      return;
    } catch (e) {
      const status = e.status || (/unknown|no such|not found/i.test(e.message) ? 404 : 400);
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
      console.error(`[${req.method}] ${pathname} -> ${status}: ${e.message}`);
      return;
    } finally {
      if (process.env.OSE_LOG) console.log(`${req.method} ${pathname} ${Date.now() - started}ms`);
    }
  }

  // friendly URLs for the two front-ends
  if (req.method === 'GET' && (pathname === '/announcer' || pathname === '/booth')) {
    if (serveStatic(req, res, '/announcer.html')) return;
  }
  if (req.method === 'GET' && serveStatic(req, res, pathname)) return;
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
});

/**
 * Ports to stay away from on a vMix machine:
 *   8088 - vMix Web Controller / HTTP API
 *   8099 - vMix TCP API
 * We never default to those, but another app may still hold our port, so fall
 * forward rather than dying with a stack trace in front of the operator.
 */
const RESERVED = { 8088: 'vMix Web Controller / HTTP API', 8099: 'vMix TCP API' };
let attempts = 0;

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') { console.error('Server error:', e.message); process.exit(1); }
  const busy = PORT + attempts;
  attempts++;
  if (attempts > 10) {
    console.error(`\n  Ports ${PORT}-${busy} are all in use. Start with a specific port:\n` +
                  `    node server.js --port 9000\n`);
    process.exit(1);
  }
  const next = PORT + attempts;
  console.log(`  Port ${busy} is already in use${RESERVED[busy] ? ` (that is ${RESERVED[busy]})` : ''} — trying ${next}…`);
  server.listen(next, HOST);
});

if (RESERVED[PORT]) {
  console.log(`\n  WARNING: port ${PORT} is ${RESERVED[PORT]}. If vMix is running on this\n` +
              `  machine it already owns that port. Consider --port 8080.\n`);
}

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  const line = '='.repeat(64);
  console.log(`\n${line}`);
  console.log('  OpenStatsEngine — live stats server');
  console.log(line);
  const kb = Math.round(store.dataSize() / 1024);
  console.log(`  Data folder : ${DATA}${kb ? `  (${kb} KB, backups in _backups/)` : ''}`);
  const port = server.address().port;
  console.log(`  Local       : http://localhost:${port}`);
  for (const ip of ips) console.log(`  Network     : http://${ip}:${port}`);
  console.log(`\n  vMix XML (active game):`);
  const base = ips[0] ? `http://${ips[0]}:${port}` : `http://localhost:${port}`;
  for (const v of ['scoreboard', 'teamstats', 'leaders', 'players', 'scoring', 'plays']) {
    console.log(`    ${base}/vmix/live/${v}.xml`);
  }
  console.log(`\n  Stats entry   : ${base}/`);
  console.log(`  Announcer view: ${base}/announcer`);
  console.log(`\n  Open the Network URL on any phone or tablet on this Wi-Fi.`);
  console.log(`  Press Ctrl+C to stop.\n${line}\n`);

  if (store.config.activeGameId && store.config.scorebot?.enabled) {
    scorebot.start(store.config.activeGameId);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nShutting down…');
    scorebot.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}

process.on('uncaughtException', (e) => console.error('Uncaught:', e));
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
