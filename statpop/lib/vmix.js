/**
 * Minimal vMix HTTP API client (Web Controller, default port 8088).
 * https://www.vmix.com/help29/DeveloperAPI.html
 */

const TIMEOUT_MS = 2000;

function base(url) { return String(url || 'http://localhost:8088').replace(/\/+$/, ''); }

/** Call one vMix function, e.g. fn(url, 'SetText', { Input, SelectedName, Value }). */
export async function vmixFunction(url, name, params = {}) {
  const q = new URLSearchParams({ Function: name });
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
  const res = await fetch(`${base(url)}/api/?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new Error(`vMix ${name} failed (${res.status}): ${text.slice(0, 120)}`);
  return text;
}

export const setText = (url, input, field, value) =>
  vmixFunction(url, 'SetText', { Input: input, SelectedName: field, Value: value ?? '' });

const decode = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

/** vMix's state: version plus every input with its title fields. */
export async function vmixState(url) {
  const res = await fetch(`${base(url)}/api`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`vMix answered ${res.status}`);
  return parseState(await res.text());
}

export function parseState(xml) {
  const version = (xml.match(/<version>([^<]*)<\/version>/) || [])[1] || '';
  const inputs = [];
  const block = (xml.match(/<inputs>([\s\S]*?)<\/inputs>/) || [])[1] || '';
  for (const m of block.matchAll(/<input\b([^>]*?)(\/>|>([\s\S]*?)<\/input>)/g)) {
    const a = attrs(m[1]);
    const body = m[3] || '';
    const fields = [];
    for (const t of body.matchAll(/<(text|image|color)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
      const ta = attrs(t[2]);
      fields.push({ kind: t[1], name: ta.name, index: ta.index, value: decode(t[3] || '') });
    }
    inputs.push({
      key: a.key, number: a.number, type: a.type, title: a.title, shortTitle: a.shortTitle, fields
    });
  }
  const overlays = [];
  for (const m of xml.matchAll(/<overlay number="(\d+)"[^>]*?(?:\/>|>([^<]*)<\/overlay>)/g)) {
    overlays.push({ number: +m[1], input: m[2] || '' });
  }
  return { version, inputs, overlays };
}

/** Find an input by key, number, exact title or short title. */
export function findInput(state, ref) {
  if (!ref) return null;
  const r = String(ref).trim().toLowerCase();
  return state.inputs.find((i) => i.key?.toLowerCase() === r) ||
    state.inputs.find((i) => i.number === r) ||
    state.inputs.find((i) => i.title?.toLowerCase() === r) ||
    state.inputs.find((i) => i.shortTitle?.toLowerCase() === r) || null;
}
