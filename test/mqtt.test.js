/* MQTT client + Sportzcast ScoreConnect III field mapping.
   Runs against a fake broker started here, so no ScoreConnect needed. */
import net from 'node:net';
import { MqttClient, sampleMqtt } from '../src/integrations/mqtt.js';
import { normalizeFeed, ScorebotClient } from '../src/integrations/scorebot.js';

let pass = 0, fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};
const ok = (l, c, x = '') => { console.log(`${c ? '  ok  ' : '  FAIL'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

/* ---------- a fake MQTT broker ---------- */
const vbi = (n) => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; o.push(b); } while (n > 0); return Buffer.from(o); };
const mstr = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 0xff]), b]); };
const pk = (t, f, b) => Buffer.concat([Buffer.from([(t << 4) | f]), vbi(b.length), b]);

function fakeBroker({ publish = [], connackCode = 0, subackCode = 0 } = {}) {
  const seen = { connects: 0, subscriptions: [], clientIds: [], credentials: [] };
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      for (;;) {
        if (buf.length < 2) return;
        let m = 1, len = 0, i = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * m; m *= 128; } while (b & 0x80);
        if (buf.length < i + len) return;
        const type = buf[0] >> 4, body = buf.subarray(i, i + len);
        buf = buf.subarray(i + len);

        if (type === 1) {                                   // CONNECT
          seen.connects++;
          const plen = body.readUInt16BE(0);
          let off = 2 + plen;
          off += 1;                                          // protocol level
          const flags = body[off]; off += 1;
          off += 2;                                          // keepalive
          const idLen = body.readUInt16BE(off);
          seen.clientIds.push(body.subarray(off + 2, off + 2 + idLen).toString());
          off += 2 + idLen;
          if (flags & 0x80) {                                // username
            const ul = body.readUInt16BE(off);
            seen.credentials.push(body.subarray(off + 2, off + 2 + ul).toString());
            off += 2 + ul;
          }
          sock.write(pk(2, 0, Buffer.from([0, connackCode])));
        } else if (type === 8) {                             // SUBSCRIBE
          const tl = body.readUInt16BE(2);
          seen.subscriptions.push(body.subarray(4, 4 + tl).toString());
          sock.write(pk(9, 0, Buffer.concat([body.subarray(0, 2), Buffer.from([subackCode])])));
          for (const [topic, payload, qos = 0] of publish) {
            const vh = qos > 0
              ? Buffer.concat([mstr(topic), Buffer.from([0, 7])])
              : mstr(topic);
            sock.write(pk(3, qos << 1, Buffer.concat([vh, Buffer.from(payload, 'utf8')])));
          }
        } else if (type === 12) {                            // PINGREQ
          sock.write(pk(13, 0, Buffer.alloc(0)));
        }
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port, seen })));
}

/* ---------- a real ScoreConnect III payload (field names verbatim) ---------- */
const SPORTZCAST = JSON.stringify({
  PlayClockTens: '2', PlayClockOnes: '5', PlayClock: '25', PlayClockStatus: ' ',
  HomeScore: '9', GuestScore: '12', ToGo: '05', BallOn: '33', Down: '2',
  Quarter: '1', QuarterOrdinal: '1st',
  Clock: '7:57', FullClock: '07:57.0', ClockStatus: ' ', ClockMode: ':',
  HomePossession: '<', GuestPossession: ' ',
  HomeTimeouts: '3', GuestTimeouts: '3',
  Flag: ' ', Horn: ' ', HomeTeamName: null, GuestTeamName: null,
  HomeYardsRushing: null, VisitorTotalYards: null
});

(async () => {
  console.log('\n== MQTT protocol ==');
  const b1 = await fakeBroker({ publish: [['bot/0/json', SPORTZCAST]] });
  const got = await new Promise((res) => {
    const msgs = [];
    const c = new MqttClient({
      url: `mqtt://127.0.0.1:${b1.port}/bot/0/json`,
      onMessage: (t, p) => { msgs.push({ t, p }); if (msgs.length === 1) { c.end(); res(msgs); } }
    }).connect();
    setTimeout(() => { c.end(); res(msgs); }, 3000);
  });
  eq('a published message arrives', got.length, 1);
  eq('topic preserved', got[0]?.t, 'bot/0/json');
  eq('the topic comes from the URL path', b1.seen.subscriptions, ['bot/0/json']);
  ok('a client id is sent', (b1.seen.clientIds[0] || '').startsWith('openstatsengine-'), b1.seen.clientIds[0]);
  b1.server.close();

  console.log('\n== QoS 1 (packet id must be skipped before the payload) ==');
  const b2 = await fakeBroker({ publish: [['bot/0/json', '{"Quarter":"3"}', 1]] });
  const q1 = await new Promise((res) => {
    const c = new MqttClient({ url: `mqtt://127.0.0.1:${b2.port}/bot/0/json`, onMessage: (t, p) => { c.end(); res(p); } }).connect();
    setTimeout(() => { c.end(); res(null); }, 3000);
  });
  eq('QoS 1 payload parsed cleanly', q1, '{"Quarter":"3"}');
  b2.server.close();

  console.log('\n== broker refusals are reported, not swallowed ==');
  const b3 = await fakeBroker({ connackCode: 5 });
  const refused = await new Promise((res) => {
    const c = new MqttClient({ url: `mqtt://127.0.0.1:${b3.port}/x`, onStatus: (s) => { if (s.error) { c.end(); res(s.error); } } }).connect();
    setTimeout(() => { c.end(); res(null); }, 3000);
  });
  ok('CONNACK refusal surfaces a readable reason', /not authorised/i.test(refused || ''), refused);
  b3.server.close();

  const b4 = await fakeBroker({ subackCode: 0x80 });
  const badTopic = await new Promise((res) => {
    const c = new MqttClient({ url: `mqtt://127.0.0.1:${b4.port}/nope`, onStatus: (s) => { if (s.error) { c.end(); res(s.error); } } }).connect();
    setTimeout(() => { c.end(); res(null); }, 3000);
  });
  ok('a refused topic is reported', /refused topic/i.test(badTopic || ''), badTopic);
  b4.server.close();

  console.log('\n== credentials ==');
  const b5 = await fakeBroker({ publish: [['t', '{}']] });
  await new Promise((res) => {
    const c = new MqttClient({ url: `mqtt://127.0.0.1:${b5.port}/t`, username: 'bot', password: 'secret', onMessage: () => { c.end(); res(); } }).connect();
    setTimeout(() => { c.end(); res(); }, 2500);
  });
  eq('username is sent when supplied', b5.seen.credentials, ['bot']);
  b5.server.close();

  console.log('\n== sampleMqtt (the Test Feed button) ==');
  const b6 = await fakeBroker({ publish: [['bot/0/json', SPORTZCAST], ['bot/0/sbdata', '0208 25 09']] });
  const sample = await sampleMqtt({ url: `mqtt://127.0.0.1:${b6.port}/#`, ms: 1200 });
  ok('reports connected', sample.connected);
  eq('both topics discovered', sample.topics.map((t) => t.topic).sort(), ['bot/0/json', 'bot/0/sbdata']);
  b6.server.close();

  console.log('\n== Sportzcast field mapping ==');
  const f = normalizeFeed(JSON.parse(SPORTZCAST));
  eq('Quarter -> period', f.period, 1);
  eq('Clock "7:57" -> ms', f.clockMs, 477000);
  eq('HomeScore', f.homeScore, 9);
  eq('GuestScore -> away score', f.awayScore, 12);
  eq('Down', f.down, 2);
  eq('ToGo "05" -> distance', f.distance, 5);
  eq('BallOn', f.ballOn, 33);
  eq('PlayClock "25" -> 25 seconds', f.auxClockMs, 25000);
  eq('possession from the marker character', f.possession, 'home');

  console.log('\n== blank scoreboard fields are absent, not values ==');
  eq('ClockStatus " " does not become running:false', f.running, undefined);
  eq('PlayClockStatus " " likewise', f.auxRunning, undefined);
  eq('GuestPossession " " does not claim possession', normalizeFeed({ GuestPossession: ' ', HomePossession: '<' }).possession, 'home');
  eq('the other way round', normalizeFeed({ GuestPossession: '<', HomePossession: ' ' }).possession, 'away');
  eq('neither marked -> unknown', normalizeFeed({ GuestPossession: ' ', HomePossession: ' ' }).possession, undefined);

  console.log('\n== running inferred when the feed will not say ==');
  const c = new ScorebotClient({ store: { config: { scorebot: {} } } });
  const step = (ms) => { const feed = { clockMs: ms }; c._inferRunning(feed); return feed.running; };
  eq('first reading cannot know yet', step(477000), undefined);
  eq('a changed clock means running', step(476000), true);
  eq('still running', step(475000), true);
  eq('one identical reading is not enough to call it stopped', step(475000), undefined);
  eq('nor two', step(475000), undefined);
  eq('three in a row is a stopped clock', step(475000), false);
  eq('and it comes back when the clock moves', step(474000), true);

  console.log('\n== clock status values a real board might send ==');
  const run = (v) => normalizeFeed({ Clock: '5:00', ClockStatus: v }).running;
  eq('boolean true', run(true), true);
  eq('boolean false', run(false), false);
  eq('"true"', run('true'), true);
  eq('"1"', run('1'), true);
  eq('numeric 0', run(0), false);
  eq('"Y"', run('Y'), true);
  eq('"N"', run('N'), false);
  eq('"Running"', run('Running'), true);
  eq('"Stopped"', run('Stopped'), false);
  // The important one: never guess "stopped" from something unrecognised, or a
  // running clock silently freezes and time of possession is wrong all night.
  eq('unrecognised "R" -> unknown, not stopped', run('R'), undefined);
  eq('unrecognised "S" -> unknown, not stopped', run('S'), undefined);
  eq('unrecognised junk -> unknown', run('XYZ'), undefined);
  eq('blank -> unknown', run(' '), undefined);
  ok('an unreadable status is reported so it can be mapped',
    normalizeFeed({ ClockStatus: 'R' })._unreadRunning === 'R');

  console.log('\n== a venue can teach it a marker without a code change ==');
  eq('runningValues true', normalizeFeed({ ClockStatus: 'R' }, {}, { runningValues: { true: ['R'], false: ['S'] } }).running, true);
  eq('runningValues false', normalizeFeed({ ClockStatus: 'S' }, {}, { runningValues: { true: ['R'], false: ['S'] } }).running, false);

  console.log('\n== a reported status always beats the inference ==');
  const c2 = new ScorebotClient({ store: { config: { scorebot: {} } } });
  let stuckButRunning;
  for (let i = 0; i < 5; i++) {
    stuckButRunning = normalizeFeed({ Clock: '5:00', ClockStatus: true });
    c2._inferRunning(stuckButRunning);
  }
  eq('board says running, clock not visibly moving -> still running', stuckButRunning.running, true);
  const c3 = new ScorebotClient({ store: { config: { scorebot: {} } } });
  let movingButStopped;
  for (const clk of ['5:00', '4:59', '4:58']) {
    movingButStopped = normalizeFeed({ Clock: clk, ClockStatus: false });
    c3._inferRunning(movingButStopped);
  }
  eq('board says stopped, clock moving -> still stopped', movingButStopped.running, false);

  console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}\n`);
  process.exit(fail ? 1 : 0);
})();
