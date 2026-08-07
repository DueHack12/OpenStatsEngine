import { randomUUID } from 'node:crypto';

export function id(prefix = '') {
  return prefix + randomUUID().replace(/-/g, '').slice(0, 12);
}

export function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'unnamed';
}

/** Local-time ISO-ish stamp, e.g. 2026-08-06 19:32:11 */
export function localStamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ms -> "12:34" (or "1:23.4" when under a minute and tenths requested) */
export function fmtClock(ms, tenths = false) {
  if (ms == null || !isFinite(ms)) return '--:--';
  ms = Math.max(0, ms);
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  if (tenths && m === 0) return `:${s.toFixed(1).padStart(4, '0')}`;
  return `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
}

/** "12:34" | "12:34.5" | "94" -> ms */
export function parseClock(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000);
  const m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return null;
  return Math.round((parseInt(m[1], 10) * 60 + parseFloat(m[2])) * 1000);
}

export function xmlEscape(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // strip control chars that are illegal in XML 1.0
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** RFC4180-ish CSV parser that tolerates tabs and semicolons as delimiters. */
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  let delim = ',';
  for (const d of ['\t', ';', '|']) {
    if (firstLine.split(d).length > firstLine.split(delim).length) delim = d;
  }
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === delim) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

export function bump(obj, key, n = 1) {
  obj[key] = (obj[key] || 0) + n;
  return obj[key];
}

export function maxInto(obj, key, n) {
  if (n == null || !isFinite(n)) return;
  if (obj[key] == null || n > obj[key]) obj[key] = n;
}

export function pct(num, den, digits = 1) {
  if (!den) return 0;
  return +((num / den) * 100).toFixed(digits);
}

export function avg(num, den, digits = 1) {
  if (!den) return 0;
  return +(num / den).toFixed(digits);
}

/** Sum of ms -> "MM:SS" for time-of-possession style display */
export function fmtDuration(ms) {
  ms = Math.max(0, Math.round(ms || 0));
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function clone(o) {
  return o == null ? o : JSON.parse(JSON.stringify(o));
}
