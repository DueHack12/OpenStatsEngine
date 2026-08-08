import net from 'node:net';
import tls from 'node:tls';

/**
 * Minimal MQTT 3.1.1 subscriber — no dependencies.
 *
 * Sportzcast ScoreConnect III runs a local MQTT broker and publishes the
 * scoreboard as JSON on `bot/<n>/json`, which is the cleanest way to get a
 * ScoreBot feed into OpenStatsEngine. Only the subscribe half of the protocol
 * is implemented, because that is all a read-only consumer needs.
 */

const CONNECT = 1, CONNACK = 2, PUBLISH = 3, PUBACK = 4,
      SUBSCRIBE = 8, SUBACK = 9, PINGREQ = 12, PINGRESP = 13, DISCONNECT = 14;

/** MQTT variable-byte integer (remaining length) */
function vbi(n) {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); } while (n > 0);
  return Buffer.from(out);
}
function mstr(s) {
  const b = Buffer.from(String(s), 'utf8');
  return Buffer.concat([Buffer.from([b.length >> 8, b.length & 0xff]), b]);
}
function packet(type, flags, body = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([(type << 4) | flags]), vbi(body.length), body]);
}

const CONNACK_ERRORS = {
  1: 'broker rejected the protocol version',
  2: 'broker rejected the client id',
  3: 'broker unavailable',
  4: 'bad username or password',
  5: 'not authorised'
};

/**
 * @param {object} opts
 *   url       mqtt://host:port/topic  (mqtts:// for TLS). The path is the topic.
 *   topic     overrides the path if given
 *   username / password  optional
 *   onMessage (topic, payloadString)
 *   onStatus  ({connected, error})
 */
export class MqttClient {
  constructor({ url, topic, username, password, onMessage = () => {}, onStatus = () => {} }) {
    const u = new URL(url);
    this.tls = u.protocol === 'mqtts:';
    this.host = u.hostname;
    this.port = parseInt(u.port, 10) || (this.tls ? 8883 : 1883);
    this.topic = topic || decodeURIComponent(u.pathname.replace(/^\//, '')) || '#';
    this.username = username || u.username || undefined;
    this.password = password || u.password || undefined;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.keepalive = 60;
    this.closed = false;
    this.buf = Buffer.alloc(0);
  }

  connect() {
    this.closed = false;
    const opts = { host: this.host, port: this.port };
    this.sock = this.tls
      ? tls.connect({ ...opts, rejectUnauthorized: false })
      : net.createConnection(opts);

    this.sock.on(this.tls ? 'secureConnect' : 'connect', () => this._sendConnect());
    this.sock.on('data', (c) => this._onData(c));
    this.sock.on('error', (e) => this.onStatus({ connected: false, error: e.message }));
    this.sock.on('close', () => {
      clearInterval(this.pinger);
      this.onStatus({ connected: false });
      if (!this.closed) this.retry = setTimeout(() => this.connect(), 3000);
    });
    return this;
  }

  end() {
    this.closed = true;
    clearInterval(this.pinger);
    clearTimeout(this.retry);
    try { this.sock?.write(packet(DISCONNECT, 0)); } catch { /* already gone */ }
    try { this.sock?.destroy(); } catch { /* already gone */ }
  }

  _sendConnect() {
    const clientId = 'openstatsengine-' + Math.random().toString(16).slice(2, 10);
    let flags = 0x02;                                    // clean session
    const extra = [];
    if (this.username) { flags |= 0x80; extra.push(mstr(this.username)); }
    if (this.password) { flags |= 0x40; extra.push(mstr(this.password)); }
    this.sock.write(packet(CONNECT, 0, Buffer.concat([
      mstr('MQTT'), Buffer.from([4]),                    // protocol level 3.1.1
      Buffer.from([flags]),
      Buffer.from([this.keepalive >> 8, this.keepalive & 0xff]),
      mstr(clientId), ...extra
    ])));
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length < 2) return;
      let mult = 1, len = 0, i = 1, b;
      do {
        if (i >= this.buf.length) return;               // length not fully arrived
        b = this.buf[i++];
        len += (b & 127) * mult;
        mult *= 128;
        if (mult > 128 ** 4) { this.sock.destroy(); return; }
      } while (b & 0x80);
      if (this.buf.length < i + len) return;             // body not fully arrived

      const type = this.buf[0] >> 4, flags = this.buf[0] & 0x0f;
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.subarray(i + len);
      this._handle(type, flags, body);
    }
  }

  _handle(type, flags, body) {
    switch (type) {
      case CONNACK: {
        const rc = body[1];
        if (rc !== 0) {
          this.onStatus({ connected: false, error: CONNACK_ERRORS[rc] || `broker refused (code ${rc})` });
          this.end();
          return;
        }
        this.sock.write(packet(SUBSCRIBE, 2, Buffer.concat([
          Buffer.from([0x00, 0x01]), mstr(this.topic), Buffer.from([0x00])
        ])));
        this.pinger = setInterval(() => {
          try { this.sock.write(packet(PINGREQ, 0)); } catch { /* closing */ }
        }, (this.keepalive / 2) * 1000);
        break;
      }
      case SUBACK: {
        // 0x80 means the broker refused this topic filter
        if (body[2] === 0x80) this.onStatus({ connected: false, error: `broker refused topic "${this.topic}"` });
        else this.onStatus({ connected: true, topic: this.topic });
        break;
      }
      case PUBLISH: {
        const tlen = body.readUInt16BE(0);
        const topic = body.subarray(2, 2 + tlen).toString('utf8');
        let off = 2 + tlen;
        const qos = (flags >> 1) & 0x03;
        let packetId = null;
        if (qos > 0) { packetId = body.readUInt16BE(off); off += 2; }
        const payload = body.subarray(off).toString('utf8');
        if (qos === 1 && packetId != null) {
          this.sock.write(packet(PUBACK, 0, Buffer.from([packetId >> 8, packetId & 0xff])));
        }
        this.onMessage(topic, payload);
        break;
      }
      case PINGRESP: break;
      default: break;
    }
  }
}

/** Connect, collect messages for a moment, disconnect. Used by the Test button. */
export function sampleMqtt({ url, topic, username, password, ms = 4000, max = 5 }) {
  return new Promise((resolve) => {
    const seen = [], topics = new Map();
    let error = null, connected = false;
    const client = new MqttClient({
      url, topic, username, password,
      onStatus: (s) => { if (s.error) error = s.error; if (s.connected) connected = true; },
      onMessage: (t, payload) => {
        topics.set(t, (topics.get(t) || 0) + 1);
        if (seen.length < max) seen.push({ topic: t, payload });
      }
    }).connect();
    setTimeout(() => {
      client.end();
      resolve({ connected, error, messages: seen, topics: [...topics.entries()].map(([t, n]) => ({ topic: t, count: n })) });
    }, ms);
  });
}
