import { pct, avg } from '../util.js';

const opp = (s) => (s === 'home' ? 'away' : 'home');
const P1 = (label) => [{ name: 'player', type: 'player', label, primary: true }];

export default {
  id: 'basketball',
  name: 'Basketball',
  periods: { count: 4, lengthMs: 8 * 60000, otLengthMs: 4 * 60000, label: 'Quarter' },
  clockCountsDown: true,
  hasPossession: true,

  /**
   * NFHS shot clock, 35 seconds where a state has adopted it. Linked to the
   * game clock, because a shot clock only ever runs while the game clock runs.
   *
   * NFHS resets to the full 35 on an offensive rebound. NCAA men's uses a
   * 20-second reset there instead, so 20 is offered as a manual preset — change
   * `auxFullMs` / `auxPresets` in the game's settings if your state differs.
   */
  auxClock: {
    key: 'shotClock',
    label: 'Shot Clock',
    presets: [35, 30, 20],
    defaultMs: 35000,
    linkedToGameClock: true,
    enabledByDefault: true,
    autoResetByDefault: true,
    autoReset: [
      { ms: 35000, actions: [
        'fg2_made', 'fg3_made', 'ft_made', 'rebound_def', 'rebound_off',
        'steal', 'turnover', 'foul', 'jump_ball'] }
    ]
  },

  palette: [
    { group: 'Score', color: 'green', actions: [
      { key: 'fg2_made', label: '2PT Make', fields: [
        { name: 'player', type: 'player', label: 'Shooter', primary: true },
        { name: 'assist', type: 'player', label: 'Assist', optional: true },
        { name: 'kind', type: 'select', label: 'Type', options: ['Jumper', 'Layup', 'Dunk', 'Putback', 'Post'], optional: true },
        { name: 'andOne', type: 'toggle', label: 'And-1' } ] },
      { key: 'fg3_made', label: '3PT Make', fields: [
        { name: 'player', type: 'player', label: 'Shooter', primary: true },
        { name: 'assist', type: 'player', label: 'Assist', optional: true } ] },
      { key: 'ft_made', label: 'FT Make', fields: P1('Shooter') },
      { key: 'fg2_miss', label: '2PT Miss', color: 'grey', fields: [
        { name: 'player', type: 'player', label: 'Shooter', primary: true },
        { name: 'blockedBy', type: 'player_opp', label: 'Blocked by', optional: true } ] },
      { key: 'fg3_miss', label: '3PT Miss', color: 'grey', fields: P1('Shooter') },
      { key: 'ft_miss', label: 'FT Miss', color: 'grey', fields: P1('Shooter') }
    ] },
    { group: 'Play', color: 'blue', actions: [
      { key: 'rebound_def', label: 'Def Reb', fields: P1('Player') },
      { key: 'rebound_off', label: 'Off Reb', fields: P1('Player') },
      { key: 'assist', label: 'Assist', fields: P1('Player') },
      { key: 'steal', label: 'Steal', fields: [
        { name: 'player', type: 'player', label: 'Stolen by', primary: true },
        { name: 'from', type: 'player_opp', label: 'From', optional: true } ] },
      { key: 'block', label: 'Block', fields: P1('Player') },
      { key: 'turnover', label: 'Turnover', color: 'orange', fields: [
        { name: 'player', type: 'player', label: 'Player', primary: true },
        { name: 'kind', type: 'select', label: 'Type', options: ['Bad Pass', 'Travel', 'Offensive Foul', 'Lost Ball', 'Shot Clock', '3 Sec'], optional: true } ] }
    ] },
    { group: 'Game', color: 'grey', actions: [
      { key: 'foul', label: 'Foul', fields: [
        { name: 'player', type: 'player', label: 'On', primary: true },
        { name: 'kind', type: 'select', label: 'Type', options: ['Personal', 'Shooting', 'Offensive', 'Technical', 'Flagrant'], default: 'Personal' } ] },
      { key: 'timeout', label: 'Timeout', fields: [] },
      { key: 'sub_in', label: 'Sub In', fields: P1('Player') },
      { key: 'sub_out', label: 'Sub Out', fields: P1('Player') },
      { key: 'jump_ball', label: 'Jump Ball', fields: [] },
      { key: 'note', label: 'Note', fields: [{ name: 'text', type: 'text', label: 'Note', primary: true }] }
    ] }
  ],

  playerStatTables: [
    { key: 'box', label: 'Box Score', when: () => true,
      cols: [['pts', 'PTS'], ['fg_line', 'FG'], ['fg3_line', '3PT'], ['ft_line', 'FT'],
             ['reb', 'REB'], ['oreb', 'OR'], ['ast', 'AST'], ['stl', 'STL'],
             ['blk', 'BLK'], ['to', 'TO'], ['pf', 'PF']] }
  ],
  teamStatRows: [
    ['score', 'Score'], ['fg_line', 'FG'], ['fg_pct', 'FG%'], ['fg3_line', '3PT'], ['fg3_pct', '3PT%'],
    ['ft_line', 'FT'], ['ft_pct', 'FT%'], ['reb', 'Rebounds'], ['oreb', 'Off Reb'],
    ['ast', 'Assists'], ['stl', 'Steals'], ['blk', 'Blocks'], ['to', 'Turnovers'],
    ['pf', 'Team Fouls'], ['pts_off_to', 'Points off TO'], ['bench_pts', 'Bench Points'],
    ['biggest_lead', 'Biggest Lead'], ['timeouts_used', 'Timeouts Used']
  ],
  leaderCategories: [
    { key: 'scoring', label: 'Points', sort: 'pts', line: (p) => `${p.pts} PTS, ${p.reb} REB, ${p.ast} AST` },
    { key: 'rebounds', label: 'Rebounds', sort: 'reb', line: (p) => `${p.reb} REB (${p.oreb} OFF)` },
    { key: 'assists', label: 'Assists', sort: 'ast', line: (p) => `${p.ast} AST, ${p.to} TO` }
  ],

  initTeam: () => ({ points: 0, byPeriod: {}, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0,
    oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, tech: 0, timeouts_used: 0,
    pts_off_to: 0, bench_pts: 0, biggest_lead: 0, possession_ms: 0 }),
  initPlayer: () => ({ pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0,
    oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, plus_minus: 0, starter: false }),
  initExtra: () => ({ lastTurnover: null }),

  apply(acc, ev, ctx) {
    const d = ev.data || {}, side = ev.team, other = opp(side);
    const T = ctx.T(side), p = ctx.P(side, d.player);
    const scoreAndCredit = (pts, kind, desc) => {
      ctx.score(side, pts, kind, ev, desc);
      if (acc.extra.lastTurnover === other) { T.pts_off_to += pts; }
    };
    switch (ev.action) {
      case 'fg2_made': {
        T.fgm++; T.fga++; if (p) { p.fgm++; p.fga++; p.pts += 2; }
        const a = ctx.P(side, d.assist); if (a) { a.ast++; T.ast++; }
        scoreAndCredit(2, 'FG', `${ctx.nameOf(side, d.player)} ${d.kind || 'field goal'}`);
        acc.extra.lastTurnover = null; break;
      }
      case 'fg3_made': {
        T.fgm++; T.fga++; T.fg3m++; T.fg3a++;
        if (p) { p.fgm++; p.fga++; p.fg3m++; p.fg3a++; p.pts += 3; }
        const a = ctx.P(side, d.assist); if (a) { a.ast++; T.ast++; }
        scoreAndCredit(3, '3PT', `${ctx.nameOf(side, d.player)} 3-pointer`);
        acc.extra.lastTurnover = null; break;
      }
      case 'ft_made': { T.ftm++; T.fta++; if (p) { p.ftm++; p.fta++; p.pts += 1; }
        scoreAndCredit(1, 'FT', `${ctx.nameOf(side, d.player)} free throw`); break; }
      case 'fg2_miss': { T.fga++; if (p) p.fga++;
        const b = ctx.P(other, d.blockedBy); if (b) { b.blk++; ctx.T(other).blk++; } break; }
      case 'fg3_miss': { T.fga++; T.fg3a++; if (p) { p.fga++; p.fg3a++; } break; }
      case 'ft_miss': { T.fta++; if (p) p.fta++; break; }
      case 'rebound_def': { T.dreb++; if (p) p.dreb++; break; }
      case 'rebound_off': { T.oreb++; if (p) p.oreb++; break; }
      case 'assist': { T.ast++; if (p) p.ast++; break; }
      case 'steal': { T.stl++; if (p) p.stl++;
        const v = ctx.P(other, d.from); if (v) { v.to++; ctx.T(other).to++; }
        acc.extra.lastTurnover = other; break; }
      case 'block': { T.blk++; if (p) p.blk++; break; }
      case 'turnover': { T.to++; if (p) p.to++; acc.extra.lastTurnover = side; break; }
      case 'foul': { if (d.kind === 'Technical') { T.tech++; } T.pf++; if (p) p.pf++; break; }
      case 'timeout': T.timeouts_used++; break;
      case 'note': case 'sub_in': case 'sub_out': case 'jump_ball': break;
    }
    const lead = acc.teams[side].points - acc.teams[other].points;
    if (lead > T.biggest_lead) T.biggest_lead = lead;
  },

  finalize(acc) {
    for (const p of Object.values(acc.players)) {
      p.reb = p.oreb + p.dreb;
      p.fg_line = `${p.fgm}-${p.fga}`;
      p.fg3_line = `${p.fg3m}-${p.fg3a}`;
      p.ft_line = `${p.ftm}-${p.fta}`;
      p.fg_pct = pct(p.fgm, p.fga);
      p.fg3_pct = pct(p.fg3m, p.fg3a);
      p.ft_pct = pct(p.ftm, p.fta);
      p.eff = p.pts + p.reb + p.ast + p.stl + p.blk - (p.fga - p.fgm) - (p.fta - p.ftm) - p.to;
      p.double_double = [p.pts, p.reb, p.ast, p.stl, p.blk].filter((v) => v >= 10).length >= 2;
    }
    for (const side of ['home', 'away']) {
      const t = acc.teams[side];
      t.score = t.points;
      t.reb = t.oreb + t.dreb;
      t.fg_line = `${t.fgm}-${t.fga}`;
      t.fg3_line = `${t.fg3m}-${t.fg3a}`;
      t.ft_line = `${t.ftm}-${t.fta}`;
      t.fg_pct = pct(t.fgm, t.fga);
      t.fg3_pct = pct(t.fg3m, t.fg3a);
      t.ft_pct = pct(t.ftm, t.fta);
      t.ppp = avg(t.points, t.fga + 0.44 * t.fta + t.to, 2);
      t.bench_pts = Object.values(acc.players)
        .filter((p) => p.side === side && !p.starter)
        .reduce((s, p) => s + p.pts, 0);
    }
  }
};
