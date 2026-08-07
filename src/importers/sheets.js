import { parseCSV } from '../util.js';

/**
 * Bulk team import from a Google Sheet.
 *
 * Built for the CIAC broadcast sheet, which keeps two tabs:
 *   Validation — the team master list (Team, Mascot, Abrv, Stat Name, Shorthand)
 *                sitting in a block of columns partway across the sheet, next to
 *                unrelated validation lists.
 *   Pics       — asset rows; the ones labelled "TD Color" carry the team's hex
 *                colour. That tab changes column layout partway down (the Logo
 *                section inserts an Abrv column), so rows are matched on the
 *                "TD Color" marker rather than on fixed positions.
 *
 * The sheet must be shared as "anyone with the link can view" — this uses the
 * public CSV export endpoint, no credentials.
 */

const DEFAULT_GIDS = { validation: '681600433', pics: '482301100' };

/** Accepts a full Sheets URL or a bare document id. */
export function sheetId(urlOrId) {
  const s = String(urlOrId || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  throw new Error('That does not look like a Google Sheets link or document id.');
}

export const csvExportUrl = (id, gid) =>
  `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;

async function fetchCsv(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { Accept: 'text/csv,*/*' } });
  const body = await res.text();
  if (!res.ok) throw new Error(`Sheet fetch failed: HTTP ${res.status}`);
  if (/<html/i.test(body.slice(0, 400))) {
    throw new Error(
      'Google returned a sign-in page instead of the sheet. Open the sheet, ' +
      'File → Share → General access → "Anyone with the link" (Viewer), then retry.'
    );
  }
  return body;
}

const norm = (s) => String(s || '').trim().toLowerCase();
const HEX = /^#?([0-9A-Fa-f]{6})$/;

/**
 * Pull team rows out of the Validation tab. The team block is located by
 * finding the header cell "Team" rather than assuming a column position.
 */
export function parseValidationTeams(csv) {
  const rows = parseCSV(csv);
  const warnings = [];
  let headerRow = -1, col = {};

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const idx = rows[i].findIndex((c) => norm(c) === 'team');
    if (idx === -1) continue;
    headerRow = i;
    rows[i].forEach((c, j) => {
      const n = norm(c);
      if (j < idx) return; // columns to the left are unrelated validation lists
      if (n === 'team') col.name = j;
      else if (n === 'mascot') col.mascot = j;
      else if (n === 'abrv' || n === 'abbrev' || n === 'abbreviation') col.abbrev = j;
      else if (n === 'stat name') col.statName = j;
      else if (n === 'shorthand') col.shortName = j;
    });
    break;
  }
  if (headerRow === -1) {
    throw new Error('No "Team" column found on the Validation tab. Check the gid points at that tab.');
  }

  const teams = [];
  const seen = new Set();
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[col.name] ?? '').trim();
    if (!name) continue;
    const key = norm(name);
    if (seen.has(key)) { warnings.push(`Duplicate team row skipped: ${name}`); continue; }
    seen.add(key);
    const pick = (j) => (j == null ? '' : String(r[j] ?? '').trim());
    teams.push({
      name,
      mascot: titleCase(pick(col.mascot)),
      abbrev: pick(col.abbrev).toUpperCase(),
      shortName: pick(col.shortName) || name,
      statName: pick(col.statName)
    });
  }
  return { teams, warnings };
}

/** School -> hex colour, from the rows on the Pics tab labelled "TD Color". */
export function parsePicsColors(csv) {
  const rows = parseCSV(csv);
  const colors = new Map();
  for (const r of rows) {
    if (!r.some((c) => norm(c) === 'td color')) continue;
    const school = String(r[0] ?? '').trim();
    if (!school) continue;
    // The colour is whichever cell on the row looks like a hex triplet; the
    // column it sits in moves between sections of this tab.
    const hex = r.map((c) => String(c).trim()).find((c) => HEX.test(c));
    if (!hex) continue;
    colors.set(norm(school), '#' + hex.replace('#', '').toLowerCase());
  }
  return colors;
}

/** Fetch both tabs and produce ready-to-save team records. */
export async function importTeamsFromSheet(urlOrId, { validationGid, picsGid } = {}) {
  const id = sheetId(urlOrId);
  const vGid = validationGid || DEFAULT_GIDS.validation;
  const pGid = picsGid || DEFAULT_GIDS.pics;

  const [vCsv, pCsv] = await Promise.all([
    fetchCsv(csvExportUrl(id, vGid)),
    fetchCsv(csvExportUrl(id, pGid)).catch(() => '')  // colours are optional
  ]);

  const { teams, warnings } = parseValidationTeams(vCsv);
  const colors = pCsv ? parsePicsColors(pCsv) : new Map();
  if (!pCsv) warnings.push('Could not read the Pics tab, so no colours were imported.');

  let withColor = 0;
  for (const t of teams) {
    const c = colors.get(norm(t.name));
    if (c) { t.primaryColor = c; withColor++; }
  }
  const missing = teams.length - withColor;
  if (missing) {
    warnings.push(`${missing} of ${teams.length} teams have no "TD Color" set in the sheet — those keep the default colour and can be edited on the Teams tab.`);
  }
  return { teams, colorsFound: colors.size, withColor, warnings, sheetId: id };
}

function titleCase(s) {
  if (!s) return '';
  // The sheet stores mascots shouted (JESUITS); graphics read better in caps-first.
  return s.length > 3 && s === s.toUpperCase()
    ? s.charAt(0) + s.slice(1).toLowerCase()
    : s;
}
