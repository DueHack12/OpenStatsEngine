import zlib from 'node:zlib';

/**
 * Minimal PDF 1.4 writer — no dependencies.
 * Supports the base-14 Helvetica family, filled rectangles and lines, which is
 * everything a box score needs.
 */
const W_REG = ' 278!278"355#556$556%889&667\'191(333)333*389+584,278-333.278/278005560556055605560556055605560556055605560:278;278<584=584>584?556@1015A667B667C722D722E667F611G778H722I278J500K667L556M833N722O778P667Q778R722S667T611U722V667W944X667Y667Z611[278\\278]278^469_556`333a556b556c500d556e556f278g556h556i222j222k500l222m833n556o556p556q556r333s500t278u556v500w722x500y500z500{334|260}334~584';
const W_BOLD = ' 278!333"474#556$556%889&722\'238(333)333*389+584,278-333.278/278005560556055605560556055605560556055605560:333;333<584=584>584?611@975A722B722C722D722E667F611G778H722I278J556K722L611M833N722O778P667Q778R722S667T611U722V667W944X667Y667Z611[333\\278]333^584_556`333a556b611c556d611e556f333g611h611i278j278k556l278m889n611o611p611q611r389s556t333u611v556w778x556y556z500{389|280}389~584';

function widthTable(src) {
  const t = new Array(256).fill(556);
  for (let i = 0; i < src.length;) {
    const ch = src.charCodeAt(i); i += 1;
    t[ch] = parseInt(src.substr(i, 3), 10); i += 3;
  }
  return t;
}
const WIDTHS = { reg: widthTable(W_REG), bold: widthTable(W_BOLD) };

export function textWidth(str, size, bold = false) {
  const t = WIDTHS[bold ? 'bold' : 'reg'];
  let w = 0;
  for (const ch of String(str)) w += t[ch.charCodeAt(0) & 0xff] || 556;
  return (w * size) / 1000;
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  // PDF's WinAnsi encoding has no room for exotic glyphs; degrade rather than corrupt
  .replace(/[^\x20-\x7E]/g, (c) => ({ '—': '-', '–': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '·': '-' }[c] || '?'));

export class PDF {
  constructor({ width = 792, height = 612, margin = 36 } = {}) {
    this.w = width; this.h = height; this.margin = margin;
    this.pages = [];
    this.newPage();
  }

  newPage() { this.ops = []; this.pages.push(this.ops); this.y = this.margin; return this; }
  get bottom() { return this.h - this.margin; }
  get right() { return this.w - this.margin; }

  /** y is measured from the top of the page for sanity. */
  text(x, y, str, { size = 9, bold = false, align = 'left', color = null, maxWidth = null } = {}) {
    let s = String(str ?? '');
    if (maxWidth) {
      while (s.length > 1 && textWidth(s, size, bold) > maxWidth) s = s.slice(0, -1);
    }
    let tx = x;
    if (align === 'right') tx = x - textWidth(s, size, bold);
    else if (align === 'center') tx = x - textWidth(s, size, bold) / 2;
    const c = color ? `${color[0]} ${color[1]} ${color[2]} rg\n` : '0 0 0 rg\n';
    this.ops.push(`${c}BT /F${bold ? 2 : 1} ${size} Tf ${f(tx)} ${f(this.h - y)} Td (${esc(s)}) Tj ET`);
    return this;
  }

  line(x1, y1, x2, y2, { width = 0.5, color = [0.75, 0.75, 0.75] } = {}) {
    this.ops.push(`${color.join(' ')} RG ${f(width)} w ${f(x1)} ${f(this.h - y1)} m ${f(x2)} ${f(this.h - y2)} l S`);
    return this;
  }

  rect(x, y, w, h, { color = [0.93, 0.93, 0.93] } = {}) {
    this.ops.push(`${color.join(' ')} rg ${f(x)} ${f(this.h - y - h)} ${f(w)} ${f(h)} re f`);
    return this;
  }

  /**
   * Draw a table. `cols` = [{ label, key, w, align }]. Returns the y after it.
   * Automatically paginates, repeating the header row.
   */
  table(y, cols, rows, { size = 8, headSize = 8, rowH = 12, zebra = true, title = null, x = null } = {}) {
    const x0 = x == null ? this.margin : x;
    const total = cols.reduce((s, c) => s + c.w, 0);
    const drawHead = (yy) => {
      this.rect(x0, yy - 9, total, 12, { color: [0.16, 0.19, 0.27] });
      let x = x0;
      for (const c of cols) {
        const tx = c.align === 'right' ? x + c.w - 3 : (c.align === 'center' ? x + c.w / 2 : x + 3);
        this.text(tx, yy, c.label, { size: headSize, bold: true, align: c.align || 'left', color: [1, 1, 1], maxWidth: c.w - 6 });
        x += c.w;
      }
      return yy + rowH;
    };
    if (title) { this.text(x0, y, title, { size: 10, bold: true }); y += 13; }
    y = drawHead(y);
    let i = 0;
    for (const r of rows) {
      if (y > this.bottom - 20) { this.newPage(); y = this.margin + 10; y = drawHead(y); i = 0; }
      if (zebra && i % 2 === 1) this.rect(x0, y - 9, total, rowH, { color: [0.96, 0.96, 0.97] });
      let x = x0;
      for (const c of cols) {
        const v = r[c.key];
        const tx = c.align === 'right' ? x + c.w - 3 : (c.align === 'center' ? x + c.w / 2 : x + 3);
        this.text(tx, y, v == null ? '' : v, { size, align: c.align || 'left', bold: !!c.bold, maxWidth: c.w - 6 });
        x += c.w;
      }
      y += rowH; i++;
    }
    this.line(x0, y - 9, x0 + total, y - 9);
    return y + 6;
  }

  build() {
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const pageIds = [];
    const contentIds = [];
    for (const ops of this.pages) {
      const raw = Buffer.from(ops.join('\n'), 'latin1');
      const gz = zlib.deflateSync(raw);
      contentIds.push(add(`<< /Length ${gz.length} /Filter /FlateDecode >>\nstream\n${gz.toString('latin1')}\nendstream`));
    }
    const fontReg = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pagesId = objs.length + this.pages.length + 1;
    for (let i = 0; i < this.pages.length; i++) {
      pageIds.push(add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f(this.w)} ${f(this.h)}] ` +
        `/Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`
      ));
    }
    const realPagesId = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    const catalogId = add(`<< /Type /Catalog /Pages ${realPagesId} 0 R >>`);
    // page /Parent was written assuming realPagesId; fix if the guess was off
    for (const pid of pageIds) {
      objs[pid - 1] = objs[pid - 1].replace(/\/Parent \d+ 0 R/, `/Parent ${realPagesId} 0 R`);
    }

    let out = '%PDF-1.4\n';
    const offsets = [0];
    for (let i = 0; i < objs.length; i++) {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xrefAt = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objs.length; i++) {
      out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

const f = (n) => (Math.round(n * 100) / 100).toString();
