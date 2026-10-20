import zlib from 'node:zlib';

/**
 * Minimal PDF text extraction — no dependencies.
 *
 * Enough to read a report that a web page printed to PDF: walk the page tree,
 * inflate each content stream, decode the text through the font's ToUnicode
 * map, and hand back every run of text with its position on the page. Callers
 * rebuild table rows and columns from that geometry, not from the order the
 * text happens to be drawn in — which is what goes wrong when a PDF report
 * leaves a cell empty and every value after it slides one column left.
 *
 * Not supported, because no stat export we have seen uses them: encryption,
 * stream predictors, and fonts with neither a ToUnicode map nor a plain
 * single-byte encoding. Such text comes back as "?" rather than as a guess.
 */

class Ref { constructor(num, gen) { this.num = num; this.gen = gen; } }
/** A PDF string, kept as raw bytes (one char per byte) until a font decodes it. */
class PStr { constructor(bytes) { this.bytes = bytes; } }
class Op { constructor(name) { this.name = name; } }

const isDict = (v) => v != null && typeof v === 'object' && !Array.isArray(v) &&
  !(v instanceof Ref) && !(v instanceof PStr) && !(v instanceof Op);
const isWS = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\x00';
const isDelim = (c) => c === '(' || c === ')' || c === '<' || c === '>' || c === '[' || c === ']' ||
  c === '{' || c === '}' || c === '/' || c === '%';

/* ------------------------------------------------------------------ *
 * Lexer / object parser                                               *
 * ------------------------------------------------------------------ */

class Lexer {
  /** `s` is the file (or a stream) as a latin1 string: one char per byte. */
  constructor(s, i = 0, { refs = true } = {}) { this.s = s; this.i = i; this.refs = refs; }

  skip() {
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i];
      if (isWS(c)) { this.i++; continue; }
      if (c === '%') { while (this.i < s.length && s[this.i] !== '\n' && s[this.i] !== '\r') this.i++; continue; }
      break;
    }
  }

  word() {
    const s = this.s, start = this.i;
    while (this.i < s.length && !isWS(s[this.i]) && !isDelim(s[this.i])) this.i++;
    return s.slice(start, this.i);
  }

  /** Next value, or an Op for a bare keyword. Returns undefined at the end. */
  value() {
    this.skip();
    const s = this.s;
    if (this.i >= s.length) return undefined;
    const c = s[this.i];

    if (c === '/') {
      this.i++;
      return '/' + this.word().replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
    if (c === '(') return this.literal();
    if (c === '<') {
      if (s[this.i + 1] === '<') {
        this.i += 2;
        const dict = {};
        for (;;) {
          this.skip();
          if (this.i >= s.length) return dict;
          if (s.startsWith('>>', this.i)) { this.i += 2; return dict; }
          const k = this.value();
          if (typeof k !== 'string' || !k.startsWith('/')) continue;   // tolerate junk
          dict[k.slice(1)] = this.value();
        }
      }
      const end = s.indexOf('>', this.i);
      const hex = s.slice(this.i + 1, end < 0 ? s.length : end).replace(/[^0-9a-fA-F]/g, '');
      this.i = end < 0 ? s.length : end + 1;
      let bytes = '';
      for (let k = 0; k < hex.length; k += 2) bytes += String.fromCharCode(parseInt((hex[k] + (hex[k + 1] || '0')), 16));
      return new PStr(bytes);
    }
    if (c === '[') {
      this.i++;
      const arr = [];
      for (;;) {
        this.skip();
        if (this.i >= s.length) return arr;
        if (s[this.i] === ']') { this.i++; return arr; }
        const v = this.value();
        if (v === undefined) return arr;
        arr.push(v);
      }
    }
    if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') { this.i++; return new Op(c); }

    if (/[0-9+\-.]/.test(c)) {
      const w = this.word();
      const n = parseFloat(w.replace(/^([+-])[+-]+/, '$1'));
      if (this.refs && /^\d+$/.test(w)) {
        // "12 0 R" is a reference; anything else is just a number
        const m = /^[\x00\t\n\f\r ]+(\d+)[\x00\t\n\f\r ]+R(?=[\x00\t\n\f\r ()<>[\]{}/%]|$)/.exec(s.slice(this.i, this.i + 32));
        if (m) { this.i += m[0].length; return new Ref(n, +m[1]); }
      }
      return isFinite(n) ? n : 0;
    }

    const w = this.word();
    if (!w) { this.i++; return new Op(c); }
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return new Op(w);
  }

  literal() {
    const s = this.s;
    let depth = 1, out = '';
    this.i++;
    while (this.i < s.length) {
      const c = s[this.i++];
      if (c === '\\') {
        const e = s[this.i++];
        if (e === 'n') out += '\n';
        else if (e === 'r') out += '\r';
        else if (e === 't') out += '\t';
        else if (e === 'b') out += '\b';
        else if (e === 'f') out += '\f';
        else if (e === '\r') { if (s[this.i] === '\n') this.i++; }
        else if (e === '\n') { /* line continuation */ }
        else if (e >= '0' && e <= '7') {
          let o = e;
          while (o.length < 3 && s[this.i] >= '0' && s[this.i] <= '7') o += s[this.i++];
          out += String.fromCharCode(parseInt(o, 8) & 0xff);
        } else if (e !== undefined) out += e;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
      out += c;
    }
    return new PStr(out);
  }
}

/* ------------------------------------------------------------------ *
 * Document: objects, streams, pages                                   *
 * ------------------------------------------------------------------ */

function inflate(buf) {
  try { return zlib.inflateSync(buf); }
  // A stream cut short still holds every complete block before the cut.
  catch { return zlib.inflateSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
}

function ascii85(buf) {
  const s = buf.toString('latin1').replace(/\s+/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out = [];
  let group = [];
  const flush = (n) => {
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const d of group) v = v * 85 + d;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n));
    group = [];
  };
  for (const ch of s) {
    if (ch === 'z' && !group.length) { out.push(0, 0, 0, 0); continue; }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) flush(4);
  }
  if (group.length) flush(group.length - 1);
  return Buffer.from(out);
}

class PdfDoc {
  constructor(buf) {
    this.s = buf.toString('latin1');
    this.objs = new Map();
    this._index();
  }

  /**
   * Find objects by scanning for "N G obj" rather than trusting the xref
   * table, so a file with stale offsets — common after a browser "Save as
   * PDF" is edited or truncated — still opens. Later definitions win, which is
   * also what an incremental update means.
   */
  _index() {
    const s = this.s;
    const re = /(\d+)[\x00\t\n\f\r ]+(\d+)[\x00\t\n\f\r ]+obj(?=[\x00\t\n\f\r ()<>[\]{}/%])/g;
    let m;
    while ((m = re.exec(s))) {
      const lex = new Lexer(s, re.lastIndex);
      let value;
      try { value = lex.value(); } catch { continue; }
      let stream = null;
      lex.skip();
      if (isDict(value) && s.startsWith('stream', lex.i)) {
        let start = lex.i + 6;
        if (s[start] === '\r') start++;
        if (s[start] === '\n') start++;
        let end = -1;
        if (typeof value.Length === 'number') {
          const after = new Lexer(s, start + value.Length);
          after.skip();
          if (s.startsWith('endstream', after.i)) end = start + value.Length;
        }
        if (end < 0) {
          // Length missing, wrong, or an indirect reference: fall back to the marker.
          let e = s.indexOf('endstream', start);
          if (e < 0) e = s.length;
          end = e;
          if (s[end - 1] === '\n') end--;
          if (s[end - 1] === '\r') end--;
        }
        stream = { start, end };
        re.lastIndex = end;
      } else {
        re.lastIndex = Math.max(lex.i, re.lastIndex);
      }
      this.objs.set(+m[1], { value, stream });
    }

    // Objects packed into object streams (PDF 1.5+). Direct definitions win.
    for (const o of [...this.objs.values()]) {
      if (!o.stream || this.get(o.value.Type) !== '/ObjStm') continue;
      let data;
      try { data = this.streamData(o).toString('latin1'); } catch { continue; }
      const n = this.get(o.value.N) || 0, first = this.get(o.value.First) || 0;
      const head = new Lexer(data, 0, { refs: false });
      const pairs = [];
      for (let k = 0; k < n; k++) pairs.push([head.value(), head.value()]);
      for (const [num, off] of pairs) {
        if (typeof num !== 'number' || this.objs.has(num)) continue;
        try { this.objs.set(num, { value: new Lexer(data, first + off).value(), stream: null }); } catch { /* skip */ }
      }
    }
  }

  get(v) {
    for (let hops = 0; v instanceof Ref && hops < 32; hops++) v = this.objs.get(v.num)?.value ?? null;
    return v;
  }

  streamData(o) {
    if (o instanceof Ref) o = this.objs.get(o.num);
    if (!o?.stream) return Buffer.alloc(0);
    let buf = Buffer.from(this.s.slice(o.stream.start, o.stream.end), 'latin1');
    let filters = this.get(o.value.Filter);
    if (!filters) return buf;
    if (!Array.isArray(filters)) filters = [filters];
    for (const f of filters.map((x) => this.get(x))) {
      if (f === '/FlateDecode' || f === '/Fl') buf = inflate(buf);
      else if (f === '/ASCIIHexDecode' || f === '/AHx') {
        const hex = buf.toString('latin1').replace(/>.*$/s, '').replace(/[^0-9a-fA-F]/g, '');
        buf = Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex');
      } else if (f === '/ASCII85Decode' || f === '/A85') buf = ascii85(buf);
      else throw new Error(`PDF uses the ${f} filter, which this reader does not support`);
    }
    return buf;
  }

  /** Pages in reading order, each with the resources it inherits. */
  pages() {
    let root = null;
    for (const o of this.objs.values()) if (isDict(o.value) && this.get(o.value.Type) === '/Catalog') root = o.value;
    const out = [];
    const seen = new Set();
    const walk = (node, inherited) => {
      node = this.get(node);
      if (!isDict(node) || seen.has(node)) return;
      seen.add(node);
      const res = node.Resources !== undefined ? this.get(node.Resources) : inherited.res;
      const box = node.MediaBox !== undefined ? this.get(node.MediaBox) : inherited.box;
      if (Array.isArray(node.Kids) || this.get(node.Type) === '/Pages') {
        for (const k of this.get(node.Kids) || []) walk(k, { res, box });
      } else {
        out.push({ dict: node, res: res || {}, box: (box || [0, 0, 612, 792]).map((v) => this.get(v)) });
      }
    };
    if (root) walk(root.Pages, { res: null, box: null });
    if (!out.length) {
      // No usable page tree: take page objects in the order they were written.
      for (const o of this.objs.values()) {
        if (isDict(o.value) && this.get(o.value.Type) === '/Page') walk(o.value, { res: null, box: null });
      }
    }
    return out;
  }
}

/* ------------------------------------------------------------------ *
 * Fonts                                                               *
 * ------------------------------------------------------------------ */

/** Parse a ToUnicode CMap into code -> string. */
function parseToUnicode(text) {
  const map = new Map();
  const hexToStr = (h) => {
    let out = '';
    for (let k = 0; k < h.length; k += 4) {
      const unit = parseInt(h.slice(k, k + 4).padEnd(4, '0'), 16);
      if (!isNaN(unit)) out += String.fromCharCode(unit);
    }
    return out;
  };
  const strCode = (p) => { let n = 0; for (const ch of p.bytes) n = n * 256 + ch.charCodeAt(0); return n; };
  const strHex = (p) => [...p.bytes].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const lex = new Lexer(text, 0, { refs: false });
  const stack = [];
  for (let v = lex.value(); v !== undefined; v = lex.value()) {
    if (!(v instanceof Op)) { stack.push(v); continue; }
    if (v.name === 'endbfchar') {
      for (let k = 0; k + 1 < stack.length; k += 2) {
        if (stack[k] instanceof PStr && stack[k + 1] instanceof PStr) map.set(strCode(stack[k]), hexToStr(strHex(stack[k + 1])));
      }
    } else if (v.name === 'endbfrange') {
      for (let k = 0; k + 2 < stack.length; k += 3) {
        const [lo, hi, dst] = stack.slice(k, k + 3);
        if (!(lo instanceof PStr) || !(hi instanceof PStr)) continue;
        const a = strCode(lo), b = strCode(hi);
        if (Array.isArray(dst)) {
          for (let c = a; c <= b && c - a < dst.length; c++) if (dst[c - a] instanceof PStr) map.set(c, hexToStr(strHex(dst[c - a])));
        } else if (dst instanceof PStr) {
          const base = strHex(dst);
          const lastUnit = parseInt(base.slice(-4), 16);
          for (let c = a; c <= b && c - a < 65536; c++) {
            map.set(c, hexToStr(base.slice(0, -4)) + String.fromCharCode(lastUnit + (c - a)));
          }
        }
      }
    }
    if (/^(begin|end)(bfchar|bfrange|codespacerange|cidrange|notdefrange)$/.test(v.name) || v.name === 'def') stack.length = 0;
  }
  return map;
}

function loadFont(doc, ref) {
  const dict = doc.get(ref);
  if (!isDict(dict)) return { twoByte: false, toUni: null, width: () => 500, name: '' };
  const subtype = doc.get(dict.Subtype);
  const twoByte = subtype === '/Type0';
  let toUni = null;
  if (dict.ToUnicode) {
    try { toUni = parseToUnicode(doc.streamData(dict.ToUnicode).toString('latin1')); } catch { toUni = null; }
  }

  let width;
  if (twoByte) {
    const desc = doc.get((doc.get(dict.DescendantFonts) || [])[0]) || {};
    const dw = doc.get(desc.DW) ?? 1000;
    const w = new Map();
    const arr = doc.get(desc.W) || [];
    for (let k = 0; k < arr.length;) {
      const first = doc.get(arr[k]);
      const next = doc.get(arr[k + 1]);
      if (Array.isArray(next)) { next.forEach((x, j) => w.set(first + j, doc.get(x))); k += 2; }
      else { const wv = doc.get(arr[k + 2]); for (let c = first; c <= next; c++) w.set(c, wv); k += 3; }
    }
    width = (code) => w.get(code) ?? dw;
  } else {
    const first = doc.get(dict.FirstChar) ?? 0;
    const widths = doc.get(dict.Widths) || [];
    const missing = doc.get(doc.get(dict.FontDescriptor)?.MissingWidth) ?? 500;
    width = (code) => doc.get(widths[code - first]) ?? missing;
  }
  return { twoByte, toUni, width, name: String(doc.get(dict.BaseFont) || '').replace(/^\//, '') };
}

/* ------------------------------------------------------------------ *
 * Content streams                                                     *
 * ------------------------------------------------------------------ */

const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
];
const ID = [1, 0, 0, 1, 0, 0];

function runPage(doc, page, pageNo) {
  const glyphs = [];
  const fontCache = new Map();
  let segment = 0;

  const exec = (content, res, ctm0, depth) => {
    const fonts = doc.get(res?.Font) || {};
    const xobjs = doc.get(res?.XObject) || {};
    let gs = { ctm: ctm0, font: null, size: 0, Tc: 0, Tw: 0, Th: 1, TL: 0, rise: 0 };
    const stack = [];
    let Tm = ID, Tlm = ID;
    const lex = new Lexer(content, 0, { refs: false });
    let ops = [];

    const fontFor = (name) => {
      const ref = fonts[name.slice(1)];
      const key = ref instanceof Ref ? `r${ref.num}` : `n${name}`;
      if (!fontCache.has(key)) fontCache.set(key, loadFont(doc, ref));
      return fontCache.get(key);
    };

    const show = (str) => {
      const f = gs.font;
      if (!f) return;
      const b = str.bytes;
      const step = f.twoByte ? 2 : 1;
      for (let k = 0; k + step - 1 < b.length; k += step) {
        const code = step === 2 ? (b.charCodeAt(k) << 8) | b.charCodeAt(k + 1) : b.charCodeAt(k);
        let ch = f.toUni?.get(code);
        if (ch == null) ch = step === 1 ? String.fromCharCode(code) : '?';
        const w0 = f.width(code) / 1000;
        const trm = mul(mul([gs.size * gs.Th, 0, 0, gs.size, 0, gs.rise], Tm), gs.ctm);
        const adv = w0 * gs.size * gs.Th;
        const end = mul(mul([1, 0, 0, 1, adv, 0], Tm), gs.ctm);
        glyphs.push({
          ch, x: trm[4], y: trm[5], x2: end[4],
          size: Math.hypot(trm[2], trm[3]) || gs.size,
          seg: segment, font: f.name
        });
        const tx = adv + (gs.Tc + (step === 1 && code === 32 ? gs.Tw : 0)) * gs.Th;
        Tm = mul([1, 0, 0, 1, tx, 0], Tm);
      }
    };

    for (let v = lex.value(); v !== undefined; v = lex.value()) {
      if (!(v instanceof Op)) { ops.push(v); continue; }
      const a = ops;
      ops = [];
      switch (v.name) {
        case 'q': stack.push({ ...gs }); break;
        case 'Q': if (stack.length) gs = stack.pop(); break;
        case 'cm': if (a.length >= 6) gs.ctm = mul(a.slice(-6), gs.ctm); break;
        case 'BT': Tm = Tlm = ID; segment++; break;
        case 'ET': segment++; break;
        case 'Tf': if (a.length >= 2) { gs.font = fontFor(String(a[a.length - 2])); gs.size = a[a.length - 1]; } break;
        case 'Tc': gs.Tc = a[0] ?? 0; break;
        case 'Tw': gs.Tw = a[0] ?? 0; break;
        case 'Tz': gs.Th = (a[0] ?? 100) / 100; break;
        case 'TL': gs.TL = a[0] ?? 0; break;
        case 'Ts': gs.rise = a[0] ?? 0; break;
        case 'Td': Tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], Tlm); Tm = Tlm; break;
        case 'TD': gs.TL = -(a[1] || 0); Tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], Tlm); Tm = Tlm; break;
        case 'Tm': if (a.length >= 6) { Tlm = a.slice(-6); Tm = Tlm; } break;
        case 'T*': Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm; break;
        case 'Tj': if (a[0] instanceof PStr) show(a[0]); break;
        case "'":
          Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm;
          if (a[0] instanceof PStr) show(a[0]);
          break;
        case '"':
          gs.Tw = a[0] ?? gs.Tw; gs.Tc = a[1] ?? gs.Tc;
          Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm;
          if (a[2] instanceof PStr) show(a[2]);
          break;
        case 'TJ':
          for (const el of Array.isArray(a[0]) ? a[0] : []) {
            if (el instanceof PStr) show(el);
            else if (typeof el === 'number') Tm = mul([1, 0, 0, 1, (-el / 1000) * gs.size * gs.Th, 0], Tm);
          }
          break;
        case 'BI': {
          // Inline image: its data is binary, so step over it to the EI marker.
          const id = content.indexOf('ID', lex.i);
          const ei = id < 0 ? -1 : content.slice(id + 3).search(/[\x00\t\n\f\r ]EI(?=[\x00\t\n\f\r ]|$)/);
          lex.i = ei < 0 ? content.length : id + 3 + ei + 3;
          break;
        }
        case 'Do': {
          if (depth > 8) break;
          const ref = xobjs[String(a[0] || '').slice(1)];
          const xo = ref instanceof Ref ? doc.objs.get(ref.num) : null;
          if (!xo?.stream || doc.get(xo.value.Subtype) !== '/Form') break;
          const mtx = doc.get(xo.value.Matrix);
          const m = Array.isArray(mtx) && mtx.length === 6 ? mtx.map((x) => doc.get(x)) : ID;
          let data;
          try { data = doc.streamData(xo).toString('latin1'); } catch { break; }
          exec(data, doc.get(xo.value.Resources) || res, mul(m, gs.ctm), depth + 1);
          segment++;
          break;
        }
        default: break;
      }
    }
  };

  let contents = doc.get(page.dict.Contents);
  if (!Array.isArray(contents)) contents = contents ? [page.dict.Contents] : [];
  // A page's content may be split across streams at any token boundary, so
  // they are joined before parsing rather than run one at a time.
  const parts = [];
  for (const c of contents) {
    try { parts.push(doc.streamData(c).toString('latin1')); } catch { /* unreadable stream: skip it */ }
  }
  exec(parts.join('\n'), page.res, ID, 0);
  return glyphs.map((g) => ({ ...g, page: pageNo }));
}

/* ------------------------------------------------------------------ *
 * Public API                                                          *
 * ------------------------------------------------------------------ */

/**
 * Group one page's glyphs into runs of text. A run never crosses a BT/ET
 * block or a line, and breaks at a wide gap, so table cells drawn next to each
 * other stay apart even when the PDF gives them no space character.
 */
function toRuns(glyphs) {
  const runs = [];
  let cur = null;
  for (const g of glyphs) {
    const sameLine = cur && Math.abs(g.y - cur.y) < cur.size * 0.4;
    const gap = cur ? g.x - cur.x2 : 0;
    if (!cur || g.seg !== cur.seg || !sameLine || gap > cur.size * 1.2 || gap < -cur.size * 0.5) {
      if (cur) runs.push(cur);
      cur = { page: g.page, x: g.x, x2: g.x2, y: g.y, size: g.size, font: g.font, seg: g.seg, text: '' };
    } else if (gap > cur.size * 0.2 && !/\s$/.test(cur.text) && g.ch !== ' ') {
      cur.text += ' ';
    }
    cur.text += g.ch;
    cur.x2 = Math.max(cur.x2, g.x2);
  }
  if (cur) runs.push(cur);
  return runs
    .map(({ seg, ...r }) => ({ ...r, text: r.text.replace(/\s+/g, ' ').trim() }))
    .filter((r) => r.text);
}

/**
 * Extract the text of a PDF as positioned runs.
 * @returns {{ pages: { width:number, height:number, runs:{text,x,x2,y,size,font,page}[] }[] }}
 *   Coordinates are PDF points with y measured up from the bottom of the page.
 */
export function extractPdfText(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(String(buf), 'latin1');
  if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new Error('Not a PDF file');
  const doc = new PdfDoc(buf);
  if ([...doc.objs.values()].some((o) => isDict(o.value) && o.value.Filter === '/Standard')) {
    throw new Error('That PDF is password-protected or encrypted and cannot be read. Export it again without a password.');
  }
  return {
    pages: doc.pages().map((p, i) => ({
      width: (p.box[2] - p.box[0]) || 612,
      height: (p.box[3] - p.box[1]) || 792,
      runs: toRuns(runPage(doc, p, i + 1))
    }))
  };
}

/**
 * Every line of text in reading order — top to bottom, page by page — with
 * its runs left to right. Runs whose baselines sit within a fraction of the
 * text height of each other share a line.
 */
export function pdfLines(extracted) {
  const lines = [];
  for (const page of extracted.pages) {
    const runs = [...page.runs].sort((a, b) => b.y - a.y || a.x - b.x);
    const pageLines = [];
    for (const r of runs) {
      const line = pageLines.find((l) => Math.abs(l.y - r.y) < Math.min(l.size, r.size) * 0.4);
      if (line) line.runs.push(r);
      else pageLines.push({ page: r.page, y: r.y, size: r.size, runs: [r] });
    }
    for (const l of pageLines) {
      l.runs.sort((a, b) => a.x - b.x);
      l.text = l.runs.map((r) => r.text).join(' ');
    }
    lines.push(...pageLines.sort((a, b) => b.y - a.y));
  }
  return lines;
}
