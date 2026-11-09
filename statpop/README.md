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

Like OSE it has **no npm dependencies**.

## Start

StatPop runs on **its own computer**, normally the vMix machine. OSE stays on
whichever computer the stats operator uses. They only need to be on the same
network.

```
 Stats computer                 vMix computer
┌──────────────────┐          ┌───────────────────────────────┐
│ OpenStatsEngine  │  Wi-Fi/  │ StatPop  ──SetText──▶  vMix   │
│ :8080            │◀─LAN────▶│ :8700                 :8088   │
└──────────────────┘          └───────────────────────────────┘
```

You only need the `statpop` folder on the vMix computer, plus **Node.js 18+**
(<https://nodejs.org>, LTS). OSE doesn't need to be installed there.

- **Windows:** double-click `start-windows.bat`
- **Mac:** double-click `start-mac.command`
- **Anything:** `node server.js`

Open <http://localhost:8700>. The **Network** address it prints also works from
a tablet or phone on the same network.

Startup options (all optional; everything can also be set in Settings):

| Option | |
|---|---|
| `--ose 192.168.1.50` | OSE computer's address (port 8080 is assumed if you leave it off) |
| `--vmix localhost` | vMix address (port 8088 assumed) |
| `--port 8700` | StatPop's own port (default 8700; if it's taken, StatPop uses the next free one and says so) |
| `--open` | Open the control page in a browser on start (the start scripts do this) |
| `--data <folder>` | Where settings and presets are kept |

On Windows you can put these on the end of the `node server.js` line in
`start-windows.bat`.

## First-time setup (Settings)

1. **OpenStatsEngine address:** the stats computer's **Network** address, the
   one OSE prints when it starts (e.g. `192.168.1.50:8080`). Just the IP works
   too. Leave **Game** on *Follow the active game*. If it says it can't reach
   OSE, check:
   - On the OSE computer, Windows Firewall must allow OSE on **Private
     networks**. That's the prompt on OSE's first launch; if you missed it,
     go to Windows Security → Firewall → Allow an app.
   - Both computers are on the same network, and that network is set to
     Private, not Public, in Windows.
   - The OSE computer's IP hasn't changed. A DHCP reservation in the router
     keeps it fixed.
2. **vMix address:** `localhost:8088` when StatPop is on the vMix computer.
   vMix's Web Controller must be on: vMix → Settings → Web Controller →
   **Enable**. If StatPop runs on a third computer, use the vMix computer's IP
   here instead.
3. **Title input:** pick your GT title (e.g. `stats pop 1.gtzip`). StatPop reads
   its field names and warns you if any it plans to write don't exist.
4. **Title field names** default to the comparison graphic:
   `HeaderTitle.Text`, `TeamAScore.Text, TeamAScore1.Text`, `TeamBScore.Text, TeamBScore1.Text`,
   `Row{n}Label.Text`, `Row{n}ValA.Text`, `Row{n}ValB.Text`. `{n}` is the row number;
   commas send the same value to several fields.

**Left/right:** Team A (the `ValA` column) is the away team by default. **⇄ Swap**
flips it.

### Score colours

Under the header, each team has two settings:

- **Score box:** *Team colour* uses the team's colour from OSE (its primary
  colour in the Teams tab). *Custom* uses the colour you pick. *Don't change*
  leaves the title as designed. Clicking the colour swatch switches to Custom.
- **Score text:** *Auto* picks black or white, whichever reads better on the
  box. *Custom* uses the colour you pick. *Don't change* leaves it alone.

Colours stay with the team, not the side, so Swap moves them too.

For box colours, StatPop needs the names of the shapes behind each score:
**Settings → Title field names → Score box colour**. They're in vMix's Title
Editor under the **Color** tab, and look like `Rectangle3.Fill.Color`. vMix 25
and later list them, so StatPop suggests them as you type and warns about any
name the title doesn't have. Text colour goes to the score fields that are
already set up. In GT Title Designer, a shape must not be set to *Hidden* in its
Data settings, or vMix won't offer its colour.

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

If OSE drops out (Wi-Fi blip, laptop asleep), StatPop keeps the last numbers it
had instead of blanking the graphic, says so above the preview, and picks up
again as soon as OSE answers.

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
