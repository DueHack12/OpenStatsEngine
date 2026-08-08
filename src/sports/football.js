import { maxInto, pct, avg, fmtDuration } from '../util.js';

const opp = (s) => (s === 'home' ? 'away' : 'home');

/**
 * Field types understood by the entry UI:
 *   player     - jersey grid, own team
 *   player_opp - jersey grid, opposing team
 *   number     - big numpad (neg: allow minus)
 *   toggle     - on/off chip
 *   select     - chip row
 *   text       - free text
 * `primary: true` marks the field the operator hits first.
 */
const PENALTIES = ['False Start', 'Holding', 'Offside', 'Pass Interference', 'Face Mask',
  'Illegal Block', 'Delay of Game', 'Unsportsmanlike', 'Illegal Formation',
  'Roughing Passer', 'Personal Foul', 'Illegal Motion', 'Encroachment', 'Other'];

export default {
  id: 'football',
  name: 'Football',
  periods: { count: 4, lengthMs: 12 * 60000, otLengthMs: 0, label: 'Quarter', maxOvertimes: 3 },
  clockCountsDown: true,
  hasPossession: true,
  trackDownDistance: true,

  /**
   * NFHS play clock: 40 seconds after a play ends normally, 25 after an
   * administrative stoppage (penalty, timeout, change of possession, score).
   * Not linked to the game clock — the play clock's whole job is to run while
   * the game clock is stopped between plays.
   */
  auxClock: {
    key: 'playClock',
    label: 'Play Clock',
    presets: [40, 25],
    defaultMs: 40000,
    linkedToGameClock: false,
    enabledByDefault: true,
    autoResetByDefault: true,
    autoReset: [
      { ms: 40000, actions: ['rush', 'pass_complete', 'pass_incomplete', 'sack'] },
      { ms: 25000, actions: [
        'penalty', 'timeout', 'turnover_downs', 'pass_int', 'punt', 'kickoff',
        'fg_good', 'fg_miss', 'xp_good', 'xp_miss', 'two_pt_good', 'two_pt_fail',
        'punt_return', 'kick_return', 'fumble_recovery', 'safety'] }
    ]
  },

  palette: [
    {
      group: 'Pass', color: 'blue', actions: [
        { key: 'pass_complete', label: 'Complete', fields: [
          { name: 'passer', type: 'player', label: 'QB', sticky: true, primary: true },
          { name: 'receiver', type: 'player', label: 'Receiver' },
          { name: 'yards', type: 'number', label: 'Yards', neg: true, default: 0 },
          { name: 'td', type: 'toggle', label: 'TD' },
          { name: 'first', type: 'toggle', label: '1st Down' },
          { name: 'yac', type: 'number', label: 'YAC', optional: true },
          { name: 'fumbleLost', type: 'toggle', label: 'Fumble Lost' }
        ] },
        { key: 'pass_incomplete', label: 'Incomplete', fields: [
          { name: 'passer', type: 'player', label: 'QB', sticky: true, primary: true },
          { name: 'receiver', type: 'player', label: 'Target', optional: true },
          { name: 'defendedBy', type: 'player_opp', label: 'Broken up by', optional: true },
          { name: 'drop', type: 'toggle', label: 'Drop' }
        ] },
        { key: 'pass_int', label: 'INT', color: 'red', fields: [
          { name: 'passer', type: 'player', label: 'QB', sticky: true, primary: true },
          { name: 'by', type: 'player_opp', label: 'Intercepted by' },
          { name: 'returnYards', type: 'number', label: 'Return Yds', default: 0 },
          { name: 'td', type: 'toggle', label: 'Pick 6' }
        ] },
        { key: 'sack', label: 'Sack', color: 'red', fields: [
          { name: 'passer', type: 'player', label: 'QB', sticky: true, primary: true },
          { name: 'by', type: 'player_opp', label: 'Sacked by' },
          { name: 'by2', type: 'player_opp', label: 'Assist', optional: true },
          { name: 'yards', type: 'number', label: 'Yards Lost', default: 0 },
          { name: 'fumbleLost', type: 'toggle', label: 'Fumble Lost' }
        ] }
      ]
    },
    {
      group: 'Run', color: 'green', actions: [
        { key: 'rush', label: 'Rush', fields: [
          { name: 'rusher', type: 'player', label: 'Ball Carrier', primary: true },
          { name: 'yards', type: 'number', label: 'Yards', neg: true, default: 0 },
          { name: 'td', type: 'toggle', label: 'TD' },
          { name: 'first', type: 'toggle', label: '1st Down' },
          { name: 'tackledBy', type: 'player_opp', label: 'Tackle', optional: true },
          { name: 'tfl', type: 'toggle', label: 'TFL' },
          { name: 'fumbleLost', type: 'toggle', label: 'Fumble Lost' }
        ] }
      ]
    },
    {
      group: 'Kick', color: 'purple', actions: [
        { key: 'fg_good', label: 'FG Good', fields: [
          { name: 'kicker', type: 'player', label: 'Kicker', sticky: true, primary: true },
          { name: 'distance', type: 'number', label: 'Distance', default: 30 }
        ] },
        { key: 'fg_miss', label: 'FG Miss', fields: [
          { name: 'kicker', type: 'player', label: 'Kicker', sticky: true, primary: true },
          { name: 'distance', type: 'number', label: 'Distance', default: 30 },
          { name: 'blocked', type: 'toggle', label: 'Blocked' },
          { name: 'blockedBy', type: 'player_opp', label: 'Blocked by', optional: true }
        ] },
        { key: 'xp_good', label: 'XP Good', fields: [
          { name: 'kicker', type: 'player', label: 'Kicker', sticky: true, primary: true }] },
        { key: 'xp_miss', label: 'XP Miss', fields: [
          { name: 'kicker', type: 'player', label: 'Kicker', sticky: true, primary: true }] },
        { key: 'two_pt_good', label: '2PT Good', fields: [
          { name: 'player', type: 'player', label: 'Scorer', primary: true },
          { name: 'kind', type: 'select', label: 'Type', options: ['Run', 'Pass'], default: 'Run' }] },
        { key: 'two_pt_fail', label: '2PT Fail', fields: [
          { name: 'player', type: 'player', label: 'Attempt by', optional: true, primary: true }] },
        { key: 'punt', label: 'Punt', fields: [
          { name: 'punter', type: 'player', label: 'Punter', sticky: true, primary: true },
          { name: 'yards', type: 'number', label: 'Yards', default: 35 },
          { name: 'in20', type: 'toggle', label: 'Inside 20' },
          { name: 'touchback', type: 'toggle', label: 'Touchback' },
          { name: 'fairCatch', type: 'toggle', label: 'Fair Catch' },
          { name: 'blocked', type: 'toggle', label: 'Blocked' }
        ] },
        { key: 'kickoff', label: 'Kickoff', fields: [
          { name: 'kicker', type: 'player', label: 'Kicker', sticky: true, primary: true },
          { name: 'yards', type: 'number', label: 'Yards', default: 55 },
          { name: 'touchback', type: 'toggle', label: 'Touchback' },
          { name: 'onside', type: 'toggle', label: 'Onside' }
        ] },
        { key: 'punt_return', label: 'Punt Ret', fields: [
          { name: 'returner', type: 'player', label: 'Returner', primary: true },
          { name: 'yards', type: 'number', label: 'Yards', neg: true, default: 0 },
          { name: 'td', type: 'toggle', label: 'TD' }
        ] },
        { key: 'kick_return', label: 'Kick Ret', fields: [
          { name: 'returner', type: 'player', label: 'Returner', primary: true },
          { name: 'yards', type: 'number', label: 'Yards', neg: true, default: 0 },
          { name: 'td', type: 'toggle', label: 'TD' }
        ] }
      ]
    },
    {
      group: 'Defense', color: 'orange', actions: [
        { key: 'tackle', label: 'Tackle', fields: [
          { name: 'player', type: 'player', label: 'Tackler', primary: true },
          { name: 'assist', type: 'toggle', label: 'Assisted' },
          { name: 'player2', type: 'player', label: 'With', optional: true },
          { name: 'tfl', type: 'toggle', label: 'TFL' },
          { name: 'yards', type: 'number', label: 'Yds Lost', optional: true, default: 0 }
        ] },
        { key: 'pass_defended', label: 'PBU', fields: [
          { name: 'player', type: 'player', label: 'Defender', primary: true }] },
        { key: 'forced_fumble', label: 'Forced Fum', fields: [
          { name: 'player', type: 'player', label: 'Forced by', primary: true }] },
        { key: 'fumble_recovery', label: 'Fum Rec', fields: [
          { name: 'player', type: 'player', label: 'Recovered by', primary: true },
          { name: 'yards', type: 'number', label: 'Return Yds', default: 0 },
          { name: 'td', type: 'toggle', label: 'TD' }
        ] },
        { key: 'safety', label: 'Safety', fields: [
          { name: 'player', type: 'player', label: 'By', optional: true, primary: true }] }
      ]
    },
    {
      group: 'Game', color: 'grey', actions: [
        { key: 'penalty', label: 'Penalty', fields: [
          { name: 'kind', type: 'select', label: 'Foul', options: PENALTIES, primary: true },
          { name: 'player', type: 'player', label: 'On', optional: true },
          { name: 'yards', type: 'number', label: 'Yards', default: 10 },
          { name: 'autoFirst', type: 'toggle', label: 'Auto 1st' },
          { name: 'declined', type: 'toggle', label: 'Declined' }
        ] },
        { key: 'timeout', label: 'Timeout', fields: [] },
        { key: 'turnover_downs', label: 'Turnover on Downs', fields: [] },
        { key: 'possession_set', label: 'Set Possession', fields: [] },
        { key: 'note', label: 'Note', fields: [
          { name: 'text', type: 'text', label: 'Note', primary: true }] }
      ]
    }
  ],

  playerStatTables: [
    { key: 'passing', label: 'Passing', when: (p) => p.pass_att > 0,
      cols: [['comp_att', 'C/A'], ['pass_yds', 'YDS'], ['pass_td', 'TD'], ['pass_int', 'INT'],
             ['pass_long', 'LNG'], ['pass_pct', 'PCT'], ['rating', 'RTG']] },
    { key: 'rushing', label: 'Rushing', when: (p) => p.rush_att > 0,
      cols: [['rush_att', 'ATT'], ['rush_yds', 'YDS'], ['rush_avg', 'AVG'], ['rush_td', 'TD'], ['rush_long', 'LNG']] },
    { key: 'receiving', label: 'Receiving', when: (p) => p.rec > 0 || p.targets > 0,
      cols: [['rec', 'REC'], ['rec_yds', 'YDS'], ['rec_avg', 'AVG'], ['rec_td', 'TD'], ['rec_long', 'LNG'], ['targets', 'TGT']] },
    { key: 'defense', label: 'Defense', when: (p) => p.tackles_total > 0 || p.sacks > 0 || p.def_int > 0 || p.pbu > 0,
      cols: [['tackles_total', 'TOT'], ['tackles_solo', 'SOLO'], ['tackles_ast', 'AST'], ['sacks', 'SK'],
             ['tfl', 'TFL'], ['def_int', 'INT'], ['pbu', 'PBU'], ['ff', 'FF'], ['fr', 'FR']] },
    { key: 'kicking', label: 'Kicking', when: (p) => p.fga > 0 || p.xpa > 0,
      cols: [['fg_line', 'FG'], ['fg_long', 'LNG'], ['xp_line', 'XP'], ['kick_pts', 'PTS']] },
    { key: 'punting', label: 'Punting', when: (p) => p.punts > 0,
      cols: [['punts', 'NO'], ['punt_yds', 'YDS'], ['punt_avg', 'AVG'], ['punt_long', 'LNG'], ['punt_in20', 'IN20']] },
    { key: 'returns', label: 'Returns', when: (p) => p.kr > 0 || p.pr > 0,
      cols: [['kr', 'KR'], ['kr_yds', 'KRYDS'], ['pr', 'PR'], ['pr_yds', 'PRYDS'], ['ret_td', 'TD']] }
  ],

  teamStatRows: [
    ['score', 'Score'], ['first_downs', 'First Downs'], ['fd_detail', 'FD (R-P-X)'],
    ['total_plays', 'Total Plays'], ['total_yards', 'Total Yards'], ['yards_per_play', 'Yards/Play'],
    ['rush_line', 'Rushing (Att-Yds)'], ['rush_avg', 'Rush Avg'],
    ['pass_line', 'Passing (C-A-I)'], ['pass_yds', 'Passing Yards'],
    ['sacks_allowed', 'Sacks Allowed'],
    ['third_line', '3rd Down'], ['third_pct', '3rd Down %'],
    ['fourth_line', '4th Down'],
    ['redzone_line', 'Red Zone'],
    ['penalty_line', 'Penalties (No-Yds)'],
    ['turnovers', 'Turnovers'], ['fumbles_lost', 'Fumbles Lost'], ['int_thrown', 'INT Thrown'],
    ['punt_line', 'Punts (No-Avg)'],
    ['top', 'Time of Possession'],
    ['timeouts_used', 'Timeouts Used']
  ],

  leaderCategories: [
    { key: 'passing', label: 'Passing', sort: 'pass_yds', line: (p) => `${p.comp_att}, ${p.pass_yds} YDS, ${p.pass_td} TD` },
    { key: 'rushing', label: 'Rushing', sort: 'rush_yds', line: (p) => `${p.rush_att} CAR, ${p.rush_yds} YDS, ${p.rush_td} TD` },
    { key: 'receiving', label: 'Receiving', sort: 'rec_yds', line: (p) => `${p.rec} REC, ${p.rec_yds} YDS, ${p.rec_td} TD` },
    { key: 'defense', label: 'Tackles', sort: 'tackles_total', line: (p) => `${p.tackles_total} TKL, ${p.sacks} SK` }
  ],

  initTeam: () => ({
    points: 0, byPeriod: {},
    first_downs_rush: 0, first_downs_pass: 0, first_downs_pen: 0,
    rush_att: 0, rush_yds: 0, rush_td: 0,
    pass_comp: 0, pass_att: 0, pass_yds: 0, pass_td: 0, pass_int: 0,
    sacks_allowed: 0, sack_yds_lost: 0,
    third_att: 0, third_conv: 0, fourth_att: 0, fourth_conv: 0,
    redzone_att: 0, redzone_td: 0, redzone_fg: 0,
    penalties: 0, penalty_yds: 0,
    fumbles: 0, fumbles_lost: 0,
    punts: 0, punt_yds: 0,
    fga: 0, fgm: 0, xpa: 0, xpm: 0, two_pt_a: 0, two_pt_m: 0, safeties: 0,
    timeouts_used: 0, possession_ms: 0, plays: 0
  }),

  initPlayer: () => ({
    pass_att: 0, pass_comp: 0, pass_yds: 0, pass_td: 0, pass_int: 0, pass_long: 0, sacked: 0,
    rush_att: 0, rush_yds: 0, rush_td: 0, rush_long: 0,
    rec: 0, targets: 0, rec_yds: 0, rec_td: 0, rec_long: 0, drops: 0, yac: 0,
    tackles_solo: 0, tackles_ast: 0, sacks: 0, tfl: 0, def_int: 0, int_yds: 0,
    pbu: 0, ff: 0, fr: 0, def_td: 0, safeties: 0,
    fga: 0, fgm: 0, fg_long: 0, xpa: 0, xpm: 0, blocks: 0,
    punts: 0, punt_yds: 0, punt_long: 0, punt_in20: 0,
    kr: 0, kr_yds: 0, pr: 0, pr_yds: 0, ret_td: 0
  }),

  initExtra: () => ({
    situation: { down: 1, distance: 10, ballOn: null, possession: null }
  }),

  /**
   * Apply one event. `ctx` supplies { P(side, playerId), T(side), period,
   * elapsedMs, score(side, pts, kind, ev) }.
   */
  apply(acc, ev, ctx) {
    const d = ev.data || {};
    const side = ev.team;
    const other = opp(side);
    const T = ctx.T(side), D = ctx.T(other);
    const sit = acc.extra.situation;
    const yards = Number(d.yards) || 0;
    const isOffensivePlay = ['pass_complete', 'pass_incomplete', 'pass_int', 'sack', 'rush'].includes(ev.action);

    // Down & distance bookkeeping happens before the play is scored so that
    // "was this a 3rd down conversion" reflects the down the play started on.
    let startDown = sit.down, startDist = sit.distance;
    if (isOffensivePlay && sit.possession && sit.possession !== side) {
      // possession implied by whoever ran the play
      sit.possession = side; sit.down = 1; sit.distance = 10;
      startDown = 1; startDist = 10;
    }
    if (!sit.possession) sit.possession = side;

    switch (ev.action) {
      case 'pass_complete': {
        const p = ctx.P(side, d.passer), r = ctx.P(side, d.receiver);
        T.plays++; T.pass_att++; T.pass_comp++; T.pass_yds += yards;
        if (p) { p.pass_att++; p.pass_comp++; p.pass_yds += yards; maxInto(p, 'pass_long', yards); }
        if (r) { r.rec++; r.targets++; r.rec_yds += yards; r.yac += Number(d.yac) || 0; maxInto(r, 'rec_long', yards); }
        if (d.td) {
          T.pass_td++; if (p) p.pass_td++; if (r) r.rec_td++;
          ctx.score(side, 6, 'TD', ev, `${ctx.nameOf(side, d.passer)} pass to ${ctx.nameOf(side, d.receiver)} ${yards} yds`);
        }
        this._advance(acc, ctx, side, yards, d.td || d.first, startDown, startDist, T, 'pass');
        if (d.fumbleLost) { T.fumbles++; T.fumbles_lost++; this._turnover(acc, ctx, side); }
        break;
      }
      case 'pass_incomplete': {
        const p = ctx.P(side, d.passer);
        T.plays++; T.pass_att++;
        if (p) p.pass_att++;
        const r = ctx.P(side, d.receiver);
        if (r) { r.targets++; if (d.drop) r.drops++; }
        const def = ctx.P(other, d.defendedBy);
        if (def) { def.pbu++; }
        this._advance(acc, ctx, side, 0, false, startDown, startDist, T, 'pass');
        break;
      }
      case 'pass_int': {
        const p = ctx.P(side, d.passer);
        T.plays++; T.pass_att++; T.pass_int++;
        if (p) { p.pass_att++; p.pass_int++; }
        const def = ctx.P(other, d.by);
        const rY = Number(d.returnYards) || 0;
        if (def) { def.def_int++; def.int_yds += rY; }
        if (d.td) {
          if (def) def.def_td++;
          ctx.score(other, 6, 'TD', ev, `${ctx.nameOf(other, d.by)} ${rY} yd interception return`);
        }
        this._turnover(acc, ctx, side);
        break;
      }
      case 'sack': {
        const p = ctx.P(side, d.passer);
        const lost = Math.abs(yards);
        T.plays++; T.sacks_allowed++; T.sack_yds_lost += lost;
        // NFHS/NCAA convention: sack yardage counts against team rushing
        T.rush_yds -= lost;
        if (p) p.sacked++;
        const a = ctx.P(other, d.by), b = ctx.P(other, d.by2);
        if (a && b) { a.sacks += 0.5; b.sacks += 0.5; a.tackles_solo++; b.tackles_ast++; a.tfl++; }
        else if (a) { a.sacks++; a.tackles_solo++; a.tfl++; }
        this._advance(acc, ctx, side, -lost, false, startDown, startDist, T, 'pass');
        if (d.fumbleLost) { T.fumbles++; T.fumbles_lost++; this._turnover(acc, ctx, side); }
        break;
      }
      case 'rush': {
        const p = ctx.P(side, d.rusher);
        T.plays++; T.rush_att++; T.rush_yds += yards;
        if (p) { p.rush_att++; p.rush_yds += yards; maxInto(p, 'rush_long', yards); }
        if (d.td) { T.rush_td++; if (p) p.rush_td++;
          ctx.score(side, 6, 'TD', ev, `${ctx.nameOf(side, d.rusher)} ${yards} yd run`); }
        const tk = ctx.P(other, d.tackledBy);
        if (tk) { tk.tackles_solo++; if (d.tfl) tk.tfl++; }
        this._advance(acc, ctx, side, yards, d.td || d.first, startDown, startDist, T, 'rush');
        if (d.fumbleLost) { T.fumbles++; T.fumbles_lost++; this._turnover(acc, ctx, side); }
        break;
      }
      case 'fg_good': {
        const k = ctx.P(side, d.kicker); const dist = Number(d.distance) || 0;
        T.fga++; T.fgm++;
        if (k) { k.fga++; k.fgm++; maxInto(k, 'fg_long', dist); }
        if (acc.extra._inRedzone === side) T.redzone_fg++;
        ctx.score(side, 3, 'FG', ev, `${ctx.nameOf(side, d.kicker)} ${dist} yd field goal`);
        this._turnover(acc, ctx, side);
        break;
      }
      case 'fg_miss': {
        const k = ctx.P(side, d.kicker);
        T.fga++; if (k) k.fga++;
        const bl = ctx.P(other, d.blockedBy); if (bl) bl.blocks++;
        this._turnover(acc, ctx, side);
        break;
      }
      case 'xp_good': { const k = ctx.P(side, d.kicker); T.xpa++; T.xpm++; if (k) { k.xpa++; k.xpm++; } ctx.score(side, 1, 'XP', ev, `${ctx.nameOf(side, d.kicker)} extra point`); break; }
      case 'xp_miss': { const k = ctx.P(side, d.kicker); T.xpa++; if (k) k.xpa++; break; }
      case 'two_pt_good': { T.two_pt_a++; T.two_pt_m++; ctx.score(side, 2, '2PT', ev, `${ctx.nameOf(side, d.player)} two-point conversion`); break; }
      case 'two_pt_fail': { T.two_pt_a++; break; }
      case 'punt': {
        const k = ctx.P(side, d.punter);
        T.punts++; T.punt_yds += yards;
        if (k) { k.punts++; k.punt_yds += yards; maxInto(k, 'punt_long', yards); if (d.in20) k.punt_in20++; }
        this._turnover(acc, ctx, side);
        break;
      }
      case 'kickoff': break;
      case 'punt_return': {
        const p = ctx.P(side, d.returner);
        if (p) { p.pr++; p.pr_yds += yards; if (d.td) { p.ret_td++; } }
        if (d.td) ctx.score(side, 6, 'TD', ev, `${ctx.nameOf(side, d.returner)} ${yards} yd punt return`);
        break;
      }
      case 'kick_return': {
        const p = ctx.P(side, d.returner);
        if (p) { p.kr++; p.kr_yds += yards; if (d.td) { p.ret_td++; } }
        if (d.td) ctx.score(side, 6, 'TD', ev, `${ctx.nameOf(side, d.returner)} ${yards} yd kick return`);
        break;
      }
      case 'tackle': {
        const a = ctx.P(side, d.player), b = ctx.P(side, d.player2);
        if (a && b) { a.tackles_ast++; b.tackles_ast++; }
        else if (a) { if (d.assist) a.tackles_ast++; else a.tackles_solo++; }
        if (d.tfl && a) a.tfl++;
        break;
      }
      case 'pass_defended': { const a = ctx.P(side, d.player); if (a) a.pbu++; break; }
      case 'forced_fumble': { const a = ctx.P(side, d.player); if (a) a.ff++; ctx.T(other).fumbles++; break; }
      case 'fumble_recovery': {
        const a = ctx.P(side, d.player); if (a) { a.fr++; if (d.td) a.def_td++; }
        ctx.T(other).fumbles_lost++;
        if (d.td) ctx.score(side, 6, 'TD', ev, `${ctx.nameOf(side, d.player)} ${yards} yd fumble return`);
        sit.possession = side; sit.down = 1; sit.distance = 10;
        break;
      }
      case 'safety': {
        const a = ctx.P(side, d.player); if (a) a.safeties++;
        T.safeties++;
        ctx.score(side, 2, 'SAF', ev, `Safety${d.player ? ', ' + ctx.nameOf(side, d.player) : ''}`);
        break;
      }
      case 'penalty': {
        if (!d.declined) {
          T.penalties++; T.penalty_yds += Math.abs(Number(d.yards) || 0);
          if (d.autoFirst) { const O = ctx.T(other); O.first_downs_pen++; }
        }
        break;
      }
      case 'timeout': T.timeouts_used++; break;
      case 'turnover_downs': this._turnover(acc, ctx, side); break;
      case 'possession_set':
        acc.extra.situation.possession = side;
        acc.extra.situation.down = d.down || 1;
        acc.extra.situation.distance = d.distance || 10;
        break;
      case 'situation_set':
        if (d.down != null) sit.down = d.down;
        if (d.distance != null) sit.distance = d.distance;
        if (d.ballOn != null) sit.ballOn = d.ballOn;
        if (d.possession) sit.possession = d.possession;
        break;
      case 'note': break;
    }
  },

  _advance(acc, ctx, side, yards, gotFirst, startDown, startDist, T, playType) {
    const sit = acc.extra.situation;
    if (startDown === 3) { T.third_att++; if (gotFirst || yards >= startDist) T.third_conv++; }
    if (startDown === 4) { T.fourth_att++; if (gotFirst || yards >= startDist) T.fourth_conv++; }
    const made = gotFirst || yards >= startDist;
    if (made) {
      sit.down = 1; sit.distance = 10;
      if (playType === 'rush') T.first_downs_rush++;
      else T.first_downs_pass++;
    } else if (startDown >= 4) {
      this._turnover(acc, ctx, side);
    } else {
      sit.down = startDown + 1;
      sit.distance = Math.max(1, startDist - yards);
    }
  },

  _turnover(acc, ctx, side) {
    const sit = acc.extra.situation;
    sit.possession = opp(side);
    sit.down = 1; sit.distance = 10;
  },

  /** Derived / display-ready values computed once at the end of a replay. */
  finalize(acc) {
    for (const p of Object.values(acc.players)) {
      p.comp_att = `${p.pass_comp}/${p.pass_att}`;
      p.pass_pct = pct(p.pass_comp, p.pass_att);
      p.rush_avg = avg(p.rush_yds, p.rush_att);
      p.rec_avg = avg(p.rec_yds, p.rec);
      p.tackles_total = p.tackles_solo + p.tackles_ast;
      p.fg_line = `${p.fgm}/${p.fga}`;
      p.xp_line = `${p.xpm}/${p.xpa}`;
      p.kick_pts = p.fgm * 3 + p.xpm;
      p.punt_avg = avg(p.punt_yds, p.punts);
      p.rating = passerRating(p);
      p.all_purpose = p.rush_yds + p.rec_yds + p.kr_yds + p.pr_yds;
      p.total_td = p.rush_td + p.rec_td + p.pass_td + p.def_td + p.ret_td;
      // touchdowns this player personally scored — a QB's throws are not his TDs
      p.scored_td = p.rush_td + p.rec_td + p.def_td + p.ret_td;
    }
    for (const side of ['home', 'away']) {
      const t = acc.teams[side];
      t.score = t.points;
      t.first_downs = t.first_downs_rush + t.first_downs_pass + t.first_downs_pen;
      t.fd_detail = `${t.first_downs_rush}-${t.first_downs_pass}-${t.first_downs_pen}`;
      t.total_plays = t.plays;
      t.total_yards = t.rush_yds + t.pass_yds;
      t.yards_per_play = avg(t.total_yards, t.plays);
      // parenthesise negative team rushing so "1--3" doesn't read as a range
      t.rush_line = `${t.rush_att}-${t.rush_yds < 0 ? `(${t.rush_yds})` : t.rush_yds}`;
      t.rush_avg = avg(t.rush_yds, t.rush_att);
      t.pass_line = `${t.pass_comp}-${t.pass_att}-${t.pass_int}`;
      t.third_line = `${t.third_conv}/${t.third_att}`;
      t.third_pct = pct(t.third_conv, t.third_att);
      t.fourth_line = `${t.fourth_conv}/${t.fourth_att}`;
      t.redzone_line = `${t.redzone_td + t.redzone_fg}/${t.redzone_att}`;
      t.penalty_line = `${t.penalties}-${t.penalty_yds}`;
      t.turnovers = t.fumbles_lost + t.pass_int;
      t.int_thrown = t.pass_int;
      t.punt_line = `${t.punts}-${avg(t.punt_yds, t.punts)}`;
      t.top = fmtDuration(t.possession_ms);
      t.fg_line = `${t.fgm}/${t.fga}`;
    }
  }
};

/** NCAA passer efficiency rating — the standard for HS broadcast. */
function passerRating(p) {
  if (!p.pass_att) return 0;
  const r = (8.4 * p.pass_yds + 330 * p.pass_td - 200 * p.pass_int + 100 * p.pass_comp) / p.pass_att;
  return +r.toFixed(1);
}
