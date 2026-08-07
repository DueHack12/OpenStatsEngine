import { pct, avg, fmtDuration } from '../util.js';

const opp = (s) => (s === 'home' ? 'away' : 'home');
const PENALTIES = ['Tripping', 'Hooking', 'Slashing', 'Cross-Checking', 'Roughing', 'Interference',
  'High-Sticking', 'Holding', 'Boarding', 'Charging', 'Delay of Game', 'Too Many Men',
  'Checking from Behind', 'Misconduct', 'Other'];

export default {
  id: 'hockey',
  name: 'Ice Hockey',
  periods: { count: 3, lengthMs: 15 * 60000, otLengthMs: 8 * 60000, label: 'Period' },
  clockCountsDown: true,
  hasPossession: false,

  palette: [
    { group: 'Score', color: 'green', actions: [
      { key: 'goal', label: 'GOAL', fields: [
        { name: 'scorer', type: 'player', label: 'Scorer', primary: true },
        { name: 'assist1', type: 'player', label: 'Assist 1', optional: true },
        { name: 'assist2', type: 'player', label: 'Assist 2', optional: true },
        { name: 'strength', type: 'select', label: 'Strength', options: ['EV', 'PP', 'SH', 'EN', 'PS'], default: 'EV' },
        { name: 'onIce', type: 'players', label: 'On Ice (+)', optional: true },
        { name: 'onIceOpp', type: 'players_opp', label: 'On Ice (-)', optional: true }
      ] }
    ] },
    { group: 'Play', color: 'blue', actions: [
      { key: 'shot', label: 'Shot on Goal', fields: [
        { name: 'player', type: 'player', label: 'Shooter', primary: true },
        { name: 'goalie', type: 'player_opp', label: 'Goalie', optional: true, sticky: true } ] },
      { key: 'shot_miss', label: 'Shot Miss/Block', fields: [
        { name: 'player', type: 'player', label: 'Shooter', primary: true },
        { name: 'blockedBy', type: 'player_opp', label: 'Blocked by', optional: true } ] },
      { key: 'faceoff_win', label: 'Faceoff Win', fields: [
        { name: 'player', type: 'player', label: 'Won by', primary: true },
        { name: 'loser', type: 'player_opp', label: 'Lost by', optional: true } ] },
      { key: 'hit', label: 'Hit', fields: [{ name: 'player', type: 'player', label: 'Player', primary: true }] },
      { key: 'takeaway', label: 'Takeaway', fields: [{ name: 'player', type: 'player', label: 'Player', primary: true }] },
      { key: 'giveaway', label: 'Giveaway', fields: [{ name: 'player', type: 'player', label: 'Player', primary: true }] }
    ] },
    { group: 'Game', color: 'grey', actions: [
      { key: 'penalty', label: 'Penalty', color: 'orange', fields: [
        { name: 'player', type: 'player', label: 'On', primary: true },
        { name: 'kind', type: 'select', label: 'Infraction', options: PENALTIES },
        { name: 'minutes', type: 'select', label: 'Minutes', options: ['2', '4', '5', '10'], default: '2' },
        { name: 'servedBy', type: 'player', label: 'Served by', optional: true } ] },
      { key: 'goalie_in', label: 'Goalie In', fields: [{ name: 'player', type: 'player', label: 'Goalie', primary: true }] },
      { key: 'goalie_out', label: 'Goalie Pulled', fields: [{ name: 'player', type: 'player', label: 'Goalie', optional: true, primary: true }] },
      { key: 'timeout', label: 'Timeout', fields: [] },
      { key: 'note', label: 'Note', fields: [{ name: 'text', type: 'text', label: 'Note', primary: true }] }
    ] }
  ],

  playerStatTables: [
    { key: 'skaters', label: 'Skaters', when: (p) => !p.is_goalie,
      cols: [['g', 'G'], ['a', 'A'], ['pts', 'PTS'], ['plus_minus', '+/-'], ['sog', 'SOG'],
             ['pim', 'PIM'], ['fo_line', 'FO'], ['hits', 'HIT'], ['blocks', 'BLK']] },
    { key: 'goalies', label: 'Goalies', when: (p) => p.is_goalie,
      cols: [['sa', 'SA'], ['sv', 'SV'], ['ga', 'GA'], ['sv_pct', 'SV%'], ['toi', 'TOI']] }
  ],
  teamStatRows: [
    ['score', 'Goals'], ['sog', 'Shots on Goal'], ['pp_line', 'Power Play'], ['pp_pct', 'PP%'],
    ['pk_line', 'Penalty Kill'], ['fo_line', 'Faceoffs'], ['fo_pct', 'Faceoff %'],
    ['penalties', 'Penalties'], ['pim', 'PIM'], ['hits', 'Hits'], ['blocks', 'Blocks'],
    ['takeaways', 'Takeaways'], ['giveaways', 'Giveaways'], ['saves', 'Saves']
  ],
  leaderCategories: [
    { key: 'points', label: 'Points', sort: 'pts', line: (p) => `${p.g}G ${p.a}A — ${p.pts} PTS` },
    { key: 'goals', label: 'Goals', sort: 'g', line: (p) => `${p.g} G on ${p.sog} SOG` },
    { key: 'goalies', label: 'Goaltending', sort: 'sv', line: (p) => `${p.sv} SV, ${p.sv_pct} SV%` }
  ],

  initTeam: () => ({ points: 0, byPeriod: {}, sog: 0, shot_att: 0, pp_goals: 0, pp_opps: 0,
    sh_goals: 0, pk_kills: 0, pk_opps: 0, fo_won: 0, fo_lost: 0, penalties: 0, pim: 0,
    hits: 0, blocks: 0, takeaways: 0, giveaways: 0, saves: 0, ga: 0, timeouts_used: 0, possession_ms: 0 }),
  initPlayer: () => ({ g: 0, a: 0, sog: 0, shot_att: 0, pim: 0, penalties: 0, plus_minus: 0,
    fo_won: 0, fo_lost: 0, hits: 0, blocks: 0, takeaways: 0, giveaways: 0,
    is_goalie: false, sa: 0, sv: 0, ga: 0, toi_ms: 0 }),
  initExtra: () => ({ goalies: { home: null, away: null } }),

  apply(acc, ev, ctx) {
    const d = ev.data || {}, side = ev.team, other = opp(side);
    const T = ctx.T(side), O = ctx.T(other);
    switch (ev.action) {
      case 'goal': {
        const s = ctx.P(side, d.scorer);
        if (s) s.g++;
        for (const key of ['assist1', 'assist2']) {
          const a = ctx.P(side, d[key]); if (a) a.a++;
        }
        const strength = d.strength || 'EV';
        if (strength === 'PP') T.pp_goals++;
        if (strength === 'SH') T.sh_goals++;
        // goalie against
        const g = acc.extra.goalies[other] && ctx.P(other, acc.extra.goalies[other]);
        if (g && strength !== 'EN') { g.ga++; g.sa++; }
        O.ga++;
        // plus/minus for even-strength goals only
        if (strength === 'EV' || strength === 'SH') {
          for (const pid of (d.onIce || [])) { const p = ctx.P(side, pid); if (p) p.plus_minus++; }
          for (const pid of (d.onIceOpp || [])) { const p = ctx.P(other, pid); if (p) p.plus_minus--; }
        }
        T.sog++; if (s) s.sog++;
        ctx.score(side, 1, strength, ev,
          `${ctx.nameOf(side, d.scorer)}${d.assist1 ? ' (' + ctx.nameOf(side, d.assist1) + (d.assist2 ? ', ' + ctx.nameOf(side, d.assist2) : '') + ')' : ' (unassisted)'} ${strength}`);
        break;
      }
      case 'shot': {
        const p = ctx.P(side, d.player); if (p) { p.sog++; p.shot_att++; }
        T.sog++; T.shot_att++;
        const gid = d.goalie || acc.extra.goalies[other];
        if (gid) { acc.extra.goalies[other] = gid; const g = ctx.P(other, gid); if (g) { g.is_goalie = true; g.sa++; g.sv++; } }
        O.saves++;
        break;
      }
      case 'shot_miss': {
        const p = ctx.P(side, d.player); if (p) p.shot_att++;
        T.shot_att++;
        const b = ctx.P(other, d.blockedBy); if (b) { b.blocks++; O.blocks++; }
        break;
      }
      case 'faceoff_win': {
        const p = ctx.P(side, d.player); if (p) p.fo_won++; T.fo_won++;
        const l = ctx.P(other, d.loser); if (l) l.fo_lost++; O.fo_lost++;
        break;
      }
      case 'hit': { const p = ctx.P(side, d.player); if (p) p.hits++; T.hits++; break; }
      case 'takeaway': { const p = ctx.P(side, d.player); if (p) p.takeaways++; T.takeaways++; break; }
      case 'giveaway': { const p = ctx.P(side, d.player); if (p) p.giveaways++; T.giveaways++; break; }
      case 'penalty': {
        const mins = parseInt(d.minutes, 10) || 2;
        const p = ctx.P(side, d.player); if (p) { p.pim += mins; p.penalties++; }
        T.penalties++; T.pim += mins;
        T.pk_opps++; O.pp_opps++;
        break;
      }
      case 'goalie_in': {
        acc.extra.goalies[side] = d.player;
        const g = ctx.P(side, d.player); if (g) g.is_goalie = true;
        break;
      }
      case 'goalie_out': acc.extra.goalies[side] = null; break;
      case 'timeout': T.timeouts_used++; break;
      case 'note': break;
    }
  },

  finalize(acc) {
    for (const p of Object.values(acc.players)) {
      p.pts = p.g + p.a;
      p.fo_line = `${p.fo_won}-${p.fo_lost}`;
      p.fo_pct = pct(p.fo_won, p.fo_won + p.fo_lost);
      p.sv_pct = p.sa ? (p.sv / p.sa).toFixed(3).replace(/^0/, '') : '.000';
      p.toi = fmtDuration(p.toi_ms);
    }
    for (const side of ['home', 'away']) {
      const t = acc.teams[side], o = acc.teams[side === 'home' ? 'away' : 'home'];
      t.score = t.points;
      t.pp_line = `${t.pp_goals}/${t.pp_opps}`;
      t.pp_pct = pct(t.pp_goals, t.pp_opps);
      t.pk_line = `${Math.max(0, t.pk_opps - o.pp_goals)}/${t.pk_opps}`;
      t.pk_pct = pct(Math.max(0, t.pk_opps - o.pp_goals), t.pk_opps);
      t.fo_line = `${t.fo_won}-${t.fo_lost}`;
      t.fo_pct = pct(t.fo_won, t.fo_won + t.fo_lost);
      t.shooting_pct = pct(t.points, t.sog);
      t.save_pct = t.sog + t.ga ? avg(o.saves, o.saves + t.points, 3) : 0;
    }
  }
};
