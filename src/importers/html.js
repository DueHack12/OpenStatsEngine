/** Minimal HTML table extraction — enough for roster pages and saved stat pages. */

export function stripTags(s) {
  return String(s)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull every <table> out of an HTML document.
 * @param {object} opts withOffsets - return { at, rows } so callers can match a
 *        table to the heading that precedes it in the document.
 */
export function parseHTMLTables(html, { withOffsets = false, minRows = 2 } = {}) {
  const out = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = tableRe.exec(html))) {
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(m[1]))) {
      const cells = [];
      const cellRe = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let cm;
      while ((cm = cellRe.exec(rm[1]))) cells.push(stripTags(cm[2]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length >= minRows) out.push(withOffsets ? { at: m.index, rows } : rows);
  }
  return out;
}
