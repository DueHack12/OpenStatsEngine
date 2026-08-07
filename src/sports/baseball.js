import { avg } from '../util.js';

const opp = (s) => (s === 'home' ? 'away' : 'home');
const B = (extra = []) => [
  { name: 'batter', type: 'player', label: 'Batter', primary: true },
  { name: 'rbi', type: 'number', label: 'RBI', default: 0 },
  ...extra
];
const fmt3 = (n) => (isFinite(n) ? n.toFixed(3).replace(/^0\./, '.') : '.000');

export default {
  id: 'baseball',
  name: 'Baseball / Softball',
  periods: { count: 7, lengthMs: 0, otLengthMs: 0, label: 'Inning' },
  clockCountsDown: false,
  hasClock: false,
  hasPossession: false,
  hasCount: true, // balls / strikes / outs instead of a clock

  palette: [
    { group: 'Hits', color: 'green', actions: [
      { key: 'single', label: '1B', fields: B([{ name: 'scorers', type: 'players', label: 'Runs Scored By', optional: true }]) },
      { key: 'double', label: '2B', fields: B([{ name: 'scorers', type: 'players', label: 'Runs Scored By', optional: true }]) },
      { key: 'triple', label: '3B', fields: B([{ name: 'scorers', type: 'players', label: 'Runs Scored By', optional: true }]) },
      { key: 'home_run', label: 'HR', fields: B([{ name: 'scorers', type: 'players', label: 'Also Scored', optional: true }]) }
    ] },
    { group: 'On Base', color: 'blue', actions: [
      { key: 'walk', label: 'BB', fields: B() },
      { key: 'hbp', label: 'HBP', fields: B() },
      { key: 'error_reach', label: 'Reached on E', fields: B([
        { name: 'by', type: 'player_opp', label: 'Error by', optional: true } ]) },
      { key: 'fielders_choice', label: "Fielder's Choice", fields: B() }
    ] },
    { group: 'Outs', color: 'orange', actions: [
      { key: 'strikeout_swinging', label: 'K (swing)', fields: B() },
      { key: 'strikeout_looking', label: 'ꓘ (looking)', fields: B() },
      { key: 'groundout', label: 'Groundout', fields: B() },
      { key: 'flyout', label: 'Flyout', fields: B() },
      { key: 'lineout', label: 'Lineout', fields: B() },
      { key: 'popout', label: 'Popout', fields: B() },
      { key: 'sac_fly', label: 'Sac Fly', fields: B() },
      { key: 'sac_bunt', label: 'Sac Bunt', fields: B() },
      { key: 'double_play', label: 'Double Play', fields: B() }
    ] },
    { group: 'Running', color: 'purple', actions: [
      { key: 'stolen_base', label: 'Stolen Base', fields: [{ name: 'player', type: 'player', label: 'Runner', primary: true }] },
      { key: 'caught_stealing', label: 'Caught Stealing', fields: [{ name: 'player', type: 'player', label: 'Runner', primary: true }] },
      { key: 'run_scored', label: 'Run (no RBI)', fields: [
        { name: 'player', type: 'player', label: 'Scored', primary: true },
        { name: 'earned', type: 'toggle', label: 'Earned', default: true } ] }
    ] },
    { group: 'Game', color: 'grey', actions: [
      { key: 'pitcher_in', label: 'Pitcher In', fields: [{ name: 'player', type: 'player', label: 'Pitcher', primary: true }] },
      { key: 'error', label: 'Error', fields: [{ name: 'player', type: 'player', label: 'On', primary: true }] },
      { key: 'wild_pitch', label: 'Wild Pitch', fields: [{ name: 'player', type: 'player', label: 'Pitcher', optional: true, primary: true }] },
      { key: 'passed_ball', label: 'Passed Ball', fields: [{ name: 'player', type: 'player', label: 'Catcher', optional: true, primary: true }] },
      { key: 'balk', label: 'Balk', fields: [{ name: 'player', type: 'player', label: 'Pitcher', optional: true, primary: true }] },
      { key: 'note', label: 'Note', fields: [{ name: 'text', type: 'text', label: 'Note', primary: true }] }
    ] }
  ],

  playerStatTables: [
    { key: 'batting', label: 'Batting', when: (p) => p.pa > 0,
      cols: [['ab', 'AB'], ['r', 'R'], ['h', 'H'], ['rbi', 'RBI'], ['b2', '2B'], ['b3', '3B'],
             ['hr', 'HR'], ['bb', 'BB'], ['so', 'K'], ['sb', 'SB'], ['avg_disp', 'AVG']] },
    { key: 'pitching', label: 'Pitching', when: (p) => p.outs_recorded > 0 || p.bf > 0,
      cols: [['ip', 'IP'], ['h_allowed', 'H'], ['r_allowed', 'R'], ['er', 'ER'],
             ['bb_allowed', 'BB'], ['k', 'K'], ['hr_allowed', 'HR'], ['era_disp', 'ERA']] }
  ],
  teamStatRows: [
    ['score', 'Runs'], ['hits', 'Hits'], ['errors', 'Errors'], ['lob', 'LOB'],
    ['b2', 'Doubles'], ['b3', 'Triples'], ['hr', 'Home Runs'],
    ['bb', 'Walks'], ['so', 'Strikeouts'], ['sb_line', 'Stolen Bases'], ['avg_disp', 'Team AVG']
  ],
  leaderCategories: [
    { key: 'batting', label: 'Batting', sort: 'h', line: (p) => `${p.h}-for-${p.ab}, ${p.rbi} RBI` },
    { key: 'pitching', label: 'Pitching', sort: 'k', line: (p) => `${p.ip} IP, ${p.h_allowed} H, ${p.er} ER, ${p.k} K` }
  ],

  initTeam: () => ({ points: 0, byPeriod: {}, hits: 0, errors: 0, lob: 0, ab: 0,
    b2: 0, b3: 0, hr: 0, bb: 0, so: 0, sb: 0, cs: 0, sac: 0, hbp: 0 }),
  initPlayer: () => ({ pa: 0, ab: 0, r: 0, h: 0, rbi: 0, b2: 0, b3: 0, hr: 0, bb: 0, so: 0,
    hbp: 0, sac: 0, sb: 0, cs: 0, errors: 0,
    outs_recorded: 0, bf: 0, h_allowed: 0, r_allowed: 0, er: 0, bb_allowed: 0, k: 0, hr_allowed: 0, is_pitcher: false }),
  initExtra: () => ({ outs: 0, half: 'top', balls: 0, strikes: 0,
    bases: { first: null, second: null, third: null },
    pitchers: { home: null, away: null } }),

  apply(acc, ev, ctx) {
    const d = ev.data || {}, side = ev.team, other = opp(side);
    const T = ctx.T(side);
    const b = ctx.P(side, d.batter || d.player);
    const rbi = Number(d.rbi) || 0;
    const x = acc.extra;
    x.half = side === 'away' ? 'top' : 'bottom';

    const pitcherId = x.pitchers[other];
    const pitcher = pitcherId ? ctx.P(other, pitcherId) : null;
    if (pitcher) pitcher.is_pitcher = true;

    const HIT = { single: 0, double: 2, triple: 3, home_run: 4 };
    const OUTS = ['strikeout_swinging', 'strikeout_looking', 'groundout', 'flyout',
      'lineout', 'popout', 'sac_fly', 'sac_bunt', 'double_play', 'caught_stealing'];
    const isPA = Object.keys(HIT).concat(['walk', 'hbp', 'error_reach', 'fielders_choice'])
      .concat(OUTS.filter((o) => o !== 'caught_stealing')).includes(ev.action);

    if (isPA) { if (b) b.pa++; if (pitcher) pitcher.bf++; }

    // At-bats exclude walks, HBP and sacrifices
    const noAB = ['walk', 'hbp', 'sac_fly', 'sac_bunt'];
    if (isPA && !noAB.includes(ev.action)) { if (b) b.ab++; T.ab++; }

    if (ev.action in HIT) {
      T.hits++; if (b) b.h++; if (pitcher) pitcher.h_allowed++;
      if (ev.action === 'double') { T.b2++; if (b) b.b2++; }
      if (ev.action === 'triple') { T.b3++; if (b) b.b3++; }
      if (ev.action === 'home_run') {
        T.hr++; if (b) { b.hr++; b.r++; } if (pitcher) pitcher.hr_allowed++;
      }
    }

    switch (ev.action) {
      case 'walk': T.bb++; if (b) b.bb++; if (pitcher) pitcher.bb_allowed++; break;
      case 'hbp': T.hbp++; if (b) b.hbp++; break;
      case 'strikeout_swinging': case 'strikeout_looking':
        T.so++; if (b) b.so++; if (pitcher) pitcher.k++; break;
      case 'sac_fly': case 'sac_bunt': T.sac++; if (b) b.sac++; break;
      case 'error_reach': {
        const f = ctx.P(other, d.by); if (f) f.errors++; ctx.T(other).errors++; break;
      }
      case 'error': { if (b) b.errors++; T.errors++; break; }
      case 'stolen_base': T.sb++; if (b) b.sb++; break;
      case 'caught_stealing': T.cs++; if (b) b.cs++; break;
      case 'run_scored':
        if (b) b.r++;
        ctx.score(side, 1, 'R', ev, `${ctx.nameOf(side, d.player)} scores`);
        if (pitcher) { pitcher.r_allowed++; if (d.earned !== false) pitcher.er++; }
        break;
      case 'pitcher_in': {
        x.pitchers[side] = d.player;
        const p = ctx.P(side, d.player); if (p) p.is_pitcher = true;
        break;
      }
      case 'note': case 'wild_pitch': case 'passed_ball': case 'balk': break;
    }

    if (rbi > 0) {
      if (b) b.rbi += rbi;
      ctx.score(side, rbi, 'RBI', ev,
        `${ctx.nameOf(side, d.batter)} ${labelFor(ev.action)}${rbi > 1 ? `, ${rbi} RBI` : ''}`);
      if (pitcher) { pitcher.r_allowed += rbi; pitcher.er += rbi; }
      for (const pid of (d.scorers || [])) { const s = ctx.P(side, pid); if (s) s.r++; }
    }

    if (isPA) { x.balls = 0; x.strikes = 0; } // a finished plate appearance clears the count

    // Outs and half-inning advance
    let outsAdded = 0;
    if (OUTS.includes(ev.action)) outsAdded = ev.action === 'double_play' ? 2 : 1;
    if (outsAdded) {
      x.outs += outsAdded;
      if (pitcher) pitcher.outs_recorded += outsAdded;
      if (x.outs >= 3) { x.outs = 0; x.half = x.half === 'top' ? 'bottom' : 'top'; }
    }
  },

  finalize(acc) {
    for (const p of Object.values(acc.players)) {
      p.avg = p.ab ? p.h / p.ab : 0;
      p.avg_disp = fmt3(p.avg);
      const ab_bb_hbp_sac = p.ab + p.bb + p.hbp + p.sac;
      p.obp_disp = fmt3(ab_bb_hbp_sac ? (p.h + p.bb + p.hbp) / ab_bb_hbp_sac : 0);
      const tb = (p.h - p.b2 - p.b3 - p.hr) + p.b2 * 2 + p.b3 * 3 + p.hr * 4;
      p.tb = tb;
      p.slg_disp = fmt3(p.ab ? tb / p.ab : 0);
      const whole = Math.floor(p.outs_recorded / 3), rem = p.outs_recorded % 3;
      p.ip = `${whole}.${rem}`;
      p.ip_num = whole + rem / 3;
      p.era = p.ip_num ? (p.er * 7) / p.ip_num : 0; // 7-inning HS game
      p.era_disp = p.ip_num ? p.era.toFixed(2) : '-';
      p.whip = p.ip_num ? +(((p.bb_allowed + p.h_allowed) / p.ip_num).toFixed(2)) : 0;
    }
    for (const side of ['home', 'away']) {
      const t = acc.teams[side];
      t.score = t.points;
      t.sb_line = `${t.sb}-${t.sb + t.cs}`;
      t.avg = t.ab ? t.hits / t.ab : 0;
      t.avg_disp = fmt3(t.avg);
      t.rhe = `${t.points}-${t.hits}-${t.errors}`;
    }
  }
};

function labelFor(action) {
  return ({
    single: 'singles', double: 'doubles', triple: 'triples', home_run: 'homers',
    walk: 'walks', hbp: 'hit by pitch', sac_fly: 'sacrifice fly', sac_bunt: 'sacrifice bunt',
    groundout: 'groundout', flyout: 'flyout', fielders_choice: "fielder's choice",
    error_reach: 'reaches on error'
  })[action] || action;
}
