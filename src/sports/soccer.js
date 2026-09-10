import { pct, fmtDuration } from '../util.js';

const opp = (s) => (s === 'home' ? 'away' : 'home');

export default {
  id: 'soccer',
  name: 'Soccer',
  periods: { count: 2, lengthMs: 40 * 60000, otLengthMs: 10 * 60000, label: 'Half', maxOvertimes: 3 },
  // NFHS high-school soccer counts down from 40:00 a half, which is also what
  // the ScoreConnect board sends. (FIFA counts up; change this if you ever
  // run a club match off a counting-up clock.)
  clockCountsDown: true,
  hasPossession: true,

  palette: [
    { group: 'Score', color: 'green', actions: [
      { key: 'goal', label: 'GOAL', fields: [
        { name: 'scorer', type: 'player', label: 'Scorer', primary: true },
        { name: 'assist', type: 'player', label: 'Assist', optional: true },
        { name: 'kind', type: 'select', label: 'Type', options: ['Open Play', 'Header', 'Free Kick', 'Penalty', 'Corner', 'Own Goal'], default: 'Open Play' } ] },
      { key: 'pk_miss', label: 'PK Missed', fields: [
        { name: 'player', type: 'player', label: 'Taker', primary: true },
        { name: 'goalie', type: 'player_opp', label: 'Keeper', optional: true, sticky: true } ] }
    ] },
    { group: 'Play', color: 'blue', actions: [
      { key: 'shot_on', label: 'Shot on Goal', fields: [
        { name: 'player', type: 'player', label: 'Shooter', primary: true },
        { name: 'goalie', type: 'player_opp', label: 'Keeper', optional: true, sticky: true } ] },
      { key: 'shot_off', label: 'Shot Off Target', fields: [{ name: 'player', type: 'player', label: 'Shooter', primary: true }] },
      { key: 'corner', label: 'Corner', fields: [{ name: 'player', type: 'player', label: 'Taken by', optional: true, primary: true }] },
      { key: 'offside', label: 'Offside', fields: [{ name: 'player', type: 'player', label: 'Player', optional: true, primary: true }] },
      { key: 'foul', label: 'Foul', fields: [{ name: 'player', type: 'player', label: 'By', primary: true }] },
      { key: 'save', label: 'Save', fields: [{ name: 'player', type: 'player', label: 'Keeper', sticky: true, primary: true }] }
    ] },
    { group: 'Game', color: 'grey', actions: [
      { key: 'yellow', label: 'Yellow Card', color: 'orange', fields: [
        { name: 'player', type: 'player', label: 'Player', primary: true },
        { name: 'reason', type: 'text', label: 'Reason', optional: true } ] },
      { key: 'red', label: 'Red Card', color: 'red', fields: [
        { name: 'player', type: 'player', label: 'Player', primary: true },
        { name: 'reason', type: 'text', label: 'Reason', optional: true } ] },
      { key: 'sub', label: 'Substitution', fields: [
        { name: 'player', type: 'player', label: 'On', primary: true },
        { name: 'player2', type: 'player', label: 'Off', optional: true } ] },
      { key: 'goalie_in', label: 'Keeper In', fields: [{ name: 'player', type: 'player', label: 'Keeper', primary: true }] },
      { key: 'note', label: 'Note', fields: [{ name: 'text', type: 'text', label: 'Note', primary: true }] }
    ] }
  ],

  playerStatTables: [
    { key: 'field', label: 'Field Players', when: (p) => !p.is_goalie,
      cols: [['g', 'G'], ['a', 'A'], ['pts', 'PTS'], ['sh', 'SH'], ['sog', 'SOG'],
             ['fouls', 'F'], ['yc', 'YC'], ['rc', 'RC']] },
    { key: 'keepers', label: 'Goalkeepers', when: (p) => p.is_goalie,
      cols: [['saves', 'SV'], ['ga', 'GA'], ['sv_pct', 'SV%'], ['shutout', 'SO']] }
  ],
  teamStatRows: [
    ['score', 'Goals'], ['sh', 'Shots'], ['sog', 'Shots on Goal'], ['corners', 'Corner Kicks'],
    ['fouls', 'Fouls'], ['offsides', 'Offsides'], ['yc', 'Yellow Cards'], ['rc', 'Red Cards'],
    ['saves', 'Saves'], ['top', 'Possession'], ['possession_pct', 'Possession %']
  ],
  leaderCategories: [
    { key: 'scoring', label: 'Scoring', sort: 'pts', line: (p) => `${p.g}G ${p.a}A — ${p.pts} PTS` },
    { key: 'keeping', label: 'Goalkeeping', sort: 'saves', line: (p) => `${p.saves} SV, ${p.ga} GA` }
  ],

  initTeam: () => ({ points: 0, byPeriod: {}, sh: 0, sog: 0, corners: 0, fouls: 0, offsides: 0,
    yc: 0, rc: 0, saves: 0, ga: 0, pk_a: 0, pk_m: 0, possession_ms: 0 }),
  initPlayer: () => ({ g: 0, a: 0, sh: 0, sog: 0, fouls: 0, yc: 0, rc: 0,
    is_goalie: false, saves: 0, ga: 0, minutes_ms: 0 }),
  initExtra: () => ({ goalies: { home: null, away: null } }),

  apply(acc, ev, ctx) {
    const d = ev.data || {}, side = ev.team, other = opp(side);
    const T = ctx.T(side), O = ctx.T(other);
    const p = ctx.P(side, d.player);
    switch (ev.action) {
      case 'goal': {
        const own = d.kind === 'Own Goal';
        const credited = own ? other : side;
        if (!own) {
          const s = ctx.P(side, d.scorer); if (s) { s.g++; s.sh++; s.sog++; }
          const a = ctx.P(side, d.assist); if (a) a.a++;
          T.sh++; T.sog++;
        }
        if (d.kind === 'Penalty') { T.pk_a++; T.pk_m++; }
        const gid = acc.extra.goalies[own ? side : other];
        if (gid) { const g = ctx.P(own ? side : other, gid); if (g) g.ga++; }
        (own ? T : O).ga++;
        ctx.score(credited, 1, d.kind || 'Goal', ev,
          own ? 'Own goal' : `${ctx.nameOf(side, d.scorer)}${d.assist ? ' (' + ctx.nameOf(side, d.assist) + ')' : ''} — ${d.kind || 'Open Play'}`);
        break;
      }
      case 'pk_miss': { T.pk_a++; T.sh++; if (p) p.sh++; break; }
      case 'shot_on': {
        T.sh++; T.sog++; if (p) { p.sh++; p.sog++; }
        const gid = d.goalie || acc.extra.goalies[other];
        if (gid) { acc.extra.goalies[other] = gid; const g = ctx.P(other, gid); if (g) { g.is_goalie = true; g.saves++; } }
        O.saves++;
        break;
      }
      case 'shot_off': { T.sh++; if (p) p.sh++; break; }
      case 'corner': T.corners++; break;
      case 'offside': T.offsides++; break;
      case 'foul': { T.fouls++; if (p) p.fouls++; break; }
      case 'save': { T.saves++; if (p) { p.is_goalie = true; p.saves++; acc.extra.goalies[side] = d.player; } break; }
      case 'yellow': { T.yc++; if (p) p.yc++; break; }
      case 'red': { T.rc++; if (p) p.rc++; break; }
      case 'goalie_in': { acc.extra.goalies[side] = d.player; const g = ctx.P(side, d.player); if (g) g.is_goalie = true; break; }
      case 'sub': case 'note': break;
    }
  },

  finalize(acc) {
    for (const p of Object.values(acc.players)) {
      p.pts = p.g * 2 + p.a; // NFHS soccer scoring: goal = 2 points, assist = 1
      p.sv_pct = (p.saves + p.ga) ? (p.saves / (p.saves + p.ga)).toFixed(3).replace(/^0/, '') : '.000';
      p.shutout = p.is_goalie && p.ga === 0 ? 1 : 0;
    }
    const totalPoss = acc.teams.home.possession_ms + acc.teams.away.possession_ms;
    for (const side of ['home', 'away']) {
      const t = acc.teams[side];
      t.score = t.points;
      t.top = fmtDuration(t.possession_ms);
      t.possession_pct = pct(t.possession_ms, totalPoss);
      t.shooting_pct = pct(t.points, t.sh);
      t.pk_line = `${t.pk_m}/${t.pk_a}`;
    }
  }
};
