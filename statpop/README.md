# StatPop

Fills a vMix GT **team comparison graphic** from OpenStatsEngine. Type a stat in
plain words in each row ("Total Yards", "yards dropped", "3rd down %", "TOP") and
StatPop finds it in the live OSE game, then pushes the label and both teams'
numbers into the title through vMix's API. Nothing to bind in Data Sources.

```
┌──────────────────────────────┐
│        HeaderTitle           │
├───────┬───────┬───────┬──────┤
│ logo  │ TeamA │ TeamB │ logo │   ← TeamAScore / TeamBScore
├───────┴──┬────┴───────┴──────┤
│ Row1ValA │ Row1Label │ Row1ValB │   ← row 1 is the top row
│   …      │    …      │   …      │
│ Row5ValA │ Row5Label │ Row5ValB │
└──────────────────────────────┘
```

Like OSE it has **no npm dependencies**. You need **Node.js 18+**.

## Start

On the vMix machine, with OpenStatsEngine running:

- **Windows:** double-click `start-windows.bat`
- **Mac:** double-click `start-mac.command`
- **Anything:** `node server.js` (options: `--port 8090`, `--data <folder>`)

Open <http://localhost:8090>. The **Network** address it prints works from a
tablet or phone on the same Wi-Fi.

Ports: StatPop 8090 · OSE 8080 · vMix 8088. They don't clash.

## First-time setup (Settings)

1. **OpenStatsEngine address:** `http://localhost:8080` if OSE is on the same PC.
   Leave **Game** on *Follow the active game*.
2. **vMix address:** `http://localhost:8088`. vMix's Web Controller must be on:
   vMix → Settings → Web Controller → **Enable**.
3. **Title input:** pick your GT title (e.g. `stats pop 1.gtzip`). StatPop reads
   its field names and warns you if any it plans to write don't exist.
4. **Title field names** default to the comparison graphic:
   `HeaderTitle.Text`, `TeamAScore.Text, TeamAScore1.Text`, `TeamBScore.Text, TeamBScore1.Text`,
   `Row{n}Label.Text`, `Row{n}ValA.Text`, `Row{n}ValB.Text`. `{n}` is the row number;
   commas send the same value to several fields.

**Left/right:** Team A (the `ValA` column) is the away team by default. **⇄ Swap**
flips it.

## Game night

- **Type a stat in each row.** A green tick shows what it found and the
  numbers appear underneath. If it picked the wrong stat, choose another from
  **Other matches…** and it sticks to that one (📌).
- **On-air label** is what you typed, unless you write something else in the
  label box. Click the green match name to use OSE's name for it instead.
- **Edit a number** by typing over it. It turns amber and stays put while OSE
  keeps updating. **↺** puts it back to the OSE value. A row that matches
  nothing works the same way: type both numbers yourself.
- **Send to vMix** pushes everything once. **Live** keeps pushing, sending only
  fields that changed. Live is always off after a restart, so nothing goes to
  air by surprise.
- **In / Out** takes the title on and off an overlay channel (it sends the
  latest numbers first).
- **Presets** save the header and rows under a name: *Offense*, *Halftime*,
  *Defense*, and so on.
- The header accepts `{A}` `{B}` (abbreviations), `{ANAME}` `{BNAME}`,
  `{AMASCOT}` `{BMASCOT}` and `{PERIOD}`.

If OSE drops out, StatPop keeps the last numbers it had instead of blanking the
graphic, and says so above the preview.

## What it can find

Everything on OSE's team stats sheet for the sport, plus:

- the raw team counters behind it (rushing yards, pass attempts, penalty
  yards, sack yards lost…);
- **team totals of player stats** OSE keeps only per player: drops, tackles,
  sacks made, TFL, interceptions (defense), pass breakups, forced fumbles,
  yards after catch, return yards…; and the team's longest run/pass/reception;
- a few calculated rates: completion %, yards per pass, fourth-down %.

**Every stat OSE has for this game** (right-hand panel) lists them all with
live values.

> OSE counts **dropped passes**, not yards on them, so "Yards dropped" finds
> **Drops**. If you want a different number there, type it over the value.

Matching ignores case, plurals and punctuation, knows common abbreviations
(yds, att, TD, INT, TOP, 3rd, %, YPC…), tolerates small typos ("tackels"), and
weighs rare words more heavily. That's why "yards dropped" goes to Drops and not
Total Yards. Typing an OSE key directly (`rush_yds`) also works.

## Settings file

`data/statpop.json` next to `server.js`: connections, rows and presets, plain
JSON.

## Tests

```bash
npm test
```
