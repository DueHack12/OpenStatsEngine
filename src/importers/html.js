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
/**
 * Every table on the page, each with only its own rows.
 *
 * Nesting is the whole difficulty. A non-greedy `<table>…</table>` match stops
 * at the *first* closing tag, which on a nested layout belongs to the inner
 * table — so the outer table came back holding the inner one's rows, the inner
 * table was never emitted on its own, and a page built the way ASP.NET builds
 * them (CIAC included) yielded one garbled table instead of several clean ones.
 *
 * So: find each table's real end by counting depth, then strip nested tables
 * out of its body before reading rows. Nested tables are still returned in
 * their own right, because the roster is usually one of them.
 */
export function parseHTMLTables(html, { withOffsets = false, minRows = 2 } = {}) {
  const out = [];
  const tagRe = /<(\/?)table\b[^>]*>/gi;
  const tags = [];
  let t;
  while ((t = tagRe.exec(html))) tags.push({ close: t[1] === '/', at: t.index, end: tagRe.lastIndex });

  // Pair every open tag with the close that actually belongs to it.
  const stack = [];
  const spans = [];
  for (const tag of tags) {
    if (!tag.close) stack.push(tag);
    else if (stack.length) {
      const open = stack.pop();
      spans.push({ at: open.at, inner: html.slice(open.end, tag.at) });
    }
  }
  spans.sort((a, b) => a.at - b.at);      // document order, outermost first

  for (const span of spans) {
    const rows = tableRows(stripNestedTables(span.inner));
    if (rows.length >= minRows) out.push(withOffsets ? { at: span.at, rows } : rows);
  }
  return out;
}

/** Remove complete nested `<table>…</table>` blocks, leaving this table's own. */
function stripNestedTables(inner) {
  const tagRe = /<(\/?)table\b[^>]*>/gi;
  let depth = 0, cutFrom = 0, out = '', m;
  while ((m = tagRe.exec(inner))) {
    if (m[1] !== '/') {
      if (depth === 0) { out += inner.slice(cutFrom, m.index); }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) cutFrom = tagRe.lastIndex;
    }
  }
  return depth === 0 ? out + inner.slice(cutFrom) : inner;
}

function tableRows(body) {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm;
  while ((rm = rowRe.exec(body))) {
    const cells = [];
    const cellRe = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) cells.push(stripTags(cm[2]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}
