import { pct, fmtDuration } from '../util.js';

const opp = (s) => (s === 'home' ? 'away' : 'home');

export default {
  id: 'lacrosse',
  name: 'Lacrosse',
  periods: { count: 4, lengthMs: 12 * 60000, otLengthMs: 4 * 60000, label: 'Quarter' },
  clockCountsDown: true,
  hasPossession: true,

  palette: [
    { group: 'Score', color: 'green', actions: [
      { key: 'goal', label: 'GOAL', fields: [
        { name: 'scorer', type: 'player', label: 'Scorer', primary: true },
        { name: 'assist', type: 'player', label: 'Assist', optional: true },
        { name: 'strength', type: 'select', label: 'Strength', options: ['EV', 'EMO', 'Man-Down'], default: 'EV' },
        { name: 'goalie', type: 'player_opp', label: 'On Keeper', optional: true, sticky: true } ] }
    ] },
    { group: 'Play', color: 'blue', actions: [
      { key: 'shot_on', label: 'Shot on Goal', fields: [
        { name: 'player', type: 'player', label: 'Shooter', primary: true },
        { name: 'goalie', type: 'player_opp', label: 'Keeper', optional: true, sticky: true } ] },
      { key: 'shot_off', label: 'Shot Off', fields: [{ name: 'player', type: 'player', label: 'Shooter', primary: true }] },
      { key: 'ground_ball', label: 'Ground Ball', fields: [{ name: 'player', type: 'player', label: 'Player', primary: true }] },
      { key: 'faceoff_win', label: 'Faceoff Win', fields: [
        { name: 'player', type: 'player', label: 'Won by', primary: true, sticky: true },
        { name: 'loser', type: 'player_opp', label: 'Lost by', optional: true, sticky: true } ] },
      { key: 'turnover', label: 'Turnover', color: 'orange', fields: [
        { name: 'player', type: 'player', label: 'By', primary: true },
        { name: 'causedBy', type: 'player_opp', label: 'Caused by', optional: true } ] },
      { key: 'save', label: 'Save', fields: [{ name: 'player', type: 'player', label: 'Keeper', sticky: true, primary: true }] },
      { key: 'clear', label: 'Clear', fields: [{ name: 'success', type: 'toggle', label: 'Successful', default: true, primary: true }] }
    ] },
    { group: 'Game', color: 'grey', actions: [
      { key: 'penalty', label: 'Penalty', color: 'orange', fields: [
        { name: 'player', type: 'player', label: 'On', primary: true },
        { name: 'kind', type: 'select', label: 'Type', options: ['Slashing', 'Holding', 'Push', 'Offside', 'Cross-Check', 'Illegal Body Check', 'Unsportsmanlike', 'Warding', 'Other'] },
        { name: 'seconds', type: 'select', label: 'Time', options: ['30', '60', '120', '180'], default: '30' },
        { name: 'releasable', type: 'toggle', label: 'Releasable', default: true } ] },
      { key: 'timeout', label: 'Timeout', fields: [] },
      { key: 'goalie_in', label: 'Keeper In', fields: [{ name: 'player', type: 'player', label: 'Keeper', primary: true }] },
      { key: 'note', label: 'Note', fields: [{ name: 'text', type: 'text', label: 'Note', primary: true }] }
    ] }
  ],

  playerStatTables: [
    { key: 'field', label: 'Field Players', when: (p) => !p.is_goalie,
      cols: [['g', 'G'], ['a', 'A'], ['pts', 'PTS'], ['sh', 'SH'], ['sog', 'SOG'],
             ['gb', 'GB'], ['to', 'TO'], ['ct', 'CT'], ['fo_line', 'FO'], ['pen_time', 'PEN']] },
    { key: 'keepers', label: 'Goalies', when: (p) => p.is_goalie,
      cols: [['saves', 'SV'], ['ga', 'GA'], ['sv_pct', 'SV%'], ['gb', 'GB']] }
  ],
  teamStatRows: [
    ['score', 'Goals'], ['sh', 'Shots'], ['sog', 'Shots on Goal'], ['shooting_pct', 'Shot %'],
    ['gb', 'Ground Balls'], ['fo_line', 'Faceoffs'], ['fo_pct', 'Faceoff %'],
    ['to', 'Turnovers'], ['ct', 'Caused Turnovers'], ['clear_line', 'Clears'], ['clear_pct', 'Clear %'],
    ['emo_line', 'Extra-Man'], ['penalties', 'Penalties'], ['pen_time', 'Penalty Time'], ['saves', 'Saves']
  ],
  leaderCategories: [
    { key: 'scoring', label: 'Points', sort: 'pts', line: (p) => `${p.g}G ${p.a}A — ${p.pts} PTS` },
    { key: 'groundballs', label: 'Ground Balls', sort: 'gb', line: (p) => `${p.gb} GB, ${p.ct} CT` },
    { key: 'goalies', label: 'Goaltending', sort: 'saves', line: (p) => `${p.saves} SV, ${p.sv_pct} SV%` }
  ],

  initTeam: () => ({ points: 0, byPeriod: {}, sh: 0, sog: 0, gb: 0, fo_won: 0, fo_lost: 0,
    to: 0, ct: 0, clears_a: 0, clears_m: 0, emo_a: 0, emo_m: 0, penalties: 0, pen_seconds: 0,
    saves: 0, ga: 0, timeouts_used: 0, possession_ms: 0 }),
  initPlayer: () => ({ g: 0, a: 0, sh: 0, sog: 0, gb: 0, to: 0, ct: 0, fo_won: 0, fo_lost: 0,
    penalties: 0, pen_seconds: 0, is_goalie: false, saves: 0, ga: 0 }),
  initExtra: () => ({ goalies: { home: null, away: null } }),

  apply(acc, ev, ctx) {
    const d = ev.data || {}, side = ev.team, other = opp(side);
    const T = ctx.T(side), O = ctx.T(other), p = ctx.P(side, d.player);
    switch (ev.action) {
      case 'goal': {
        const s = ctx.P(side, d.scorer); if (s) { s.g++; s.sh++; s.sog++; }
        const a = ctx.P(side, d.assist); if (a) a.a++;
        T.sh++; T.sog++;
        if (d.strength === 'EMO') { T.emo_a++; T.emo_m++; }
        const gid = d.goalie || acc.extra.goalies[other];
        if (gid) { acc.extra.goalies[other] = gid; const g = ctx.P(other, gid); if (g) { g.is_goalie = true; g.ga++; } }
        O.ga++;
        ctx.score(side, 1, d.strength || 'EV', ev,
          `${ctx.nameOf(side, d.scorer)}${d.assist ? ' (' + ctx.nameOf(side, d.assist) + ')' : ' (unassisted)'}`);
        break;
      }
      case 'shot_on': {
        T.sh++; T.sog++; if (p) { p.sh++; p.sog++; }
        const gid = d.goalie || acc.extra.goalies[other];
        if (gid) { acc.extra.goalies[other] = gid; const g = ctx.P(other, gid); if (g) { g.is_goalie = true; g.saves++; } }
        O.saves++;
        break;
      }
      case 'shot_off': { T.sh++; if (p) p.sh++; break; }
      case 'ground_ball': { T.gb++; if (p) p.gb++; break; }
      case 'faceoff_win': {
        T.fo_won++; if (p) p.fo_won++;
        const l = ctx.P(other, d.loser); if (l) l.fo_lost++; O.fo_lost++;
        break;
      }
      case 'turnover': {
        T.to++; if (p) p.to++;
        const c = ctx.P(other, d.causedBy); if (c) { c.ct++; O.ct++; }
        break;
      }
      case 'save': { T.saves++; if (p) { p.is_goalie = true; p.saves++; acc.extra.goalies[side] = d.player; } break; }
      case 'clear': { T.clears_a++; if (d.success !== false) T.clears_m++; break; }
      case 'penalty': {
        const secs = parseInt(d.seconds, 10) || 30;
        T.penalties++; T.pen_seconds += secs;
        if (p) { p.penalties++; p.pen_seconds += secs; }
        O.emo_a++;
        break;
      }
      case 'timeout': T.timeouts_used++; break;
      case 'goalie_in': { acc.extra.goalies[side] = d.player; const g = ctx.P(side, d.player); if (g) g.is_goalie = true; break; }
      case 'note': break;
    }
  },

  finalize(acc) {
    for (const p of Object.values(acc.players)) {
      p.pts = p.g + p.a;
      p.fo_line = `${p.fo_won}-${p.fo_lost}`;
      p.fo_pct = pct(p.fo_won, p.fo_won + p.fo_lost);
      p.sv_pct = (p.saves + p.ga) ? (p.saves / (p.saves + p.ga)).toFixed(3).replace(/^0/, '') : '.000';
      p.pen_time = fmtDuration(p.pen_seconds * 1000);
    }
    for (const side of ['home', 'away']) {
      const t = acc.teams[side];
      t.score = t.points;
      t.fo_line = `${t.fo_won}-${t.fo_lost}`;
      t.fo_pct = pct(t.fo_won, t.fo_won + t.fo_lost);
      t.clear_line = `${t.clears_m}/${t.clears_a}`;
      t.clear_pct = pct(t.clears_m, t.clears_a);
      t.emo_line = `${t.emo_m}/${t.emo_a}`;
      t.emo_pct = pct(t.emo_m, t.emo_a);
      t.shooting_pct = pct(t.points, t.sh);
      t.pen_time = fmtDuration(t.pen_seconds * 1000);
      t.top = fmtDuration(t.possession_ms);
    }
  }
};
