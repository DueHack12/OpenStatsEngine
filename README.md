# OpenStatsEngine

> ### ⚠️ Heavily AI-generated code
>
> **Essentially all of this repository was written by Claude (Anthropic's AI),**
> working from a spec and iterating against real files and a live browser. I
> directed the work, supplied the requirements and sample exports, and reviewed the
> output, but I did not hand-write the implementation.
>
> What that means for you:
>
> - **It has not yet run a live game.** The test suite is thorough (391 tests on a
>   fresh clone, 403 with real exports in place), but
>   passing tests are not the same as a Friday night with a scoreboard operator.
> - **Verify the stat rules against your own rulebook.** Scoring conventions were
>   implemented to NFHS rules as understood at the time — sacks not counting as
>   pass attempts, 40/25 play clock, 35-second shot clock, NCAA passer rating.
>   Confirm anything you put on air.
> - **The Sportzcast ScoreConnect III / MQTT feed has been verified against a
>   live emulator**, but not yet against a real scoreboard in a stadium.
> - Treat it as a solid starting point you own and can read, not as battle-tested
>   broadcast software.
>
> Reviews, bug reports and corrections are very welcome. The first game I'll be able to test it on will be in late September.

---

Live multi-sport stats entry for high school broadcast, with XML output for vMix
GT Title Designer.

One person enters plays from a phone, tablet or laptop. The server runs on the
same Windows or Mac machine as vMix (or any machine on the same network) and
publishes the stats as XML over HTTP — no SMB, no shared folders, no cloud.

**Sports:** Football · Basketball · Ice Hockey · Soccer · Lacrosse · Baseball/Softball

---

## Quick start

You need **Node.js 18 or newer** (get the LTS build from <https://nodejs.org>).
There are no other dependencies — nothing to `npm install`.

| Platform | How to start |
|---|---|
| macOS | Double-click **`start-mac.command`** |
| Windows | Double-click **`start-windows.bat`** |
| Any | `node server.js` |

The console prints the URLs to use:

```
  Local       : http://localhost:8080
  Network     : http://192.168.1.50:8080
```

Open the **Network** URL on any device on the same Wi-Fi. That is the entry page.

> **Windows firewall:** the first launch pops a Windows Defender prompt. Click
> **Allow access** and make sure **Private networks** is ticked, or phones and
> tablets will not be able to connect.

> **Running alongside vMix?** No conflict. vMix uses **8088** (Web Controller /
> HTTP API) and **8099** (TCP API); OpenStatsEngine defaults to **8080** and
> refuses to sit on either of those by accident. If something else already holds
> the port it steps forward to the next free one and tells you, rather than
> dying with a stack trace mid-setup.

Options:

```bash
node server.js --port 8080 --data "D:\Broadcast\stats-2026"
```

`--data` is where everything is stored. Point it at a Dropbox/OneDrive folder and
your season backs itself up.

---

## Game-day workflow

### Before the season — set up teams once

**Fastest way:** **Teams** tab → *Import all teams from a Google Sheet* → paste the
link → **Import All Teams**. It reads every school from the **Validation** tab
(name, mascot, abbreviation, short name) and team colours from the **Pics** tab
(the rows marked `TD Color`). The sheet must be shared as "Anyone with the link".

Re-run it any time — teams merge by name, so it refreshes colours and
abbreviations without touching rosters or anything you have already logged.
Schools with no `TD Color` in the sheet keep the default colour; set those by
hand. Duplicate abbreviations are reported, since two schools sharing "CHS" will
look identical on a graphic.

**Or one at a time:** enter name, abbreviation, mascot, colors → Save.

> Everything else on the Teams tab is scoped to the team in the **Team**
> dropdown, so a team has to exist before you can import a roster onto it.

### Before each game — rosters

**Teams** tab → pick team + sport → import the roster one of three ways:

1. **From a URL.** Paste a CIAC roster page such as
   `https://ciac.fpsports.org/DashboardTeamRoster.aspx?SeasonRoster=1`
   and hit **Preview from URL** to check it before saving, then **Import from URL**.
   Any page with an HTML roster table works — the parser finds the table with a
   name column and reads Number / Name / Position / Grade / Level.
2. **Paste CSV/TSV** from HUDL, MaxPreps or a spreadsheet. Headers are detected
   automatically, including `Jersey`/`No`/`#`, split `First Name`/`Last Name`
   columns, and `Last, First` name order.
3. **Type it in** — **+ Add Player**, then **Save Roster**.

Imports **merge** by default, so re-importing an updated export refreshes existing
players (matched on name, so a jersey change updates rather than duplicates)
without wiping anyone you added by hand. Tick **Replace instead of merge** to
start clean.

Season stats from a HUDL/MaxPreps export can be brought in with **Import Season
Stats CSV** — useful for having opponent numbers ready before kickoff. Ambiguous
columns (a bare `TD` could be passing, rushing or receiving) are resolved to the
sport's leading category and the choice is reported back to you.

### Create the game

**Setup** tab → sport, date, teams, level, venue, operator → **Create & Make Active**.

Period length defaults to the NFHS standard per sport; override it in the form if
your league differs.

### During the game — the Live tab

The scoreboard, clock and situation sit at the top. Below that:

1. **Pick the team** (AWAY / HOME) — it stays selected, so you usually skip this.
2. **Tap the play type** — Complete, Rush, Sack, Tackle, Goal, 2PT Make…
3. **Fill the sheet** — jersey grid for players, big numpad for yards, chips for
   TD / 1st Down / etc. Everything is on one screen.
4. **Save Entry.**

A typical football play is four taps. Fields marked *optional* stay collapsed
behind **+ add** so the common case stays fast, and an optional field you never
touch is not recorded.

Fields marked sticky (the QB, the kicker, the goalie) remember the last player you
picked for that team, so a passing series is receiver + yards + save.

**Keyboard shortcuts** (desktop):

| Key | Action |
|---|---|
| `1`–`9` | Open the corresponding play button |
| `0`–`9` | Type into the numpad while a sheet is open |
| `Enter` | Save the entry |
| `Esc` | Cancel |
| `Space` | Start / stop the clock |
| `A` / `H` | Switch to away / home |
| `U` or `Z` | Undo the last entry |
| `Y` or `Shift`+`Z` | Redo the last undo |
| `R` | Reset the play/shot clock to full |
| `P` | Start / stop the play clock (football) |

**Getting it wrong is fine.** *Undo* on any line in Recent Entries reverses it, and
**Redo** puts it back — either the last undo (the toolbar button, or `Y`) or a
specific one, since undone entries stay visible at the top of Recent Entries with
their own *↷ redo* button. Nothing is ever deleted: undo and redo are both
recorded, so the audit trail stays complete and `pbp.csv` shows exactly what was
entered, undone, restored and when.

**Periods go both ways.** *◂ Per* steps back if you advanced by mistake, *Per ▸*
goes forward, and both stop at the limits — you cannot go before the 1st, and
overtime is capped at **3** for football, basketball, hockey, soccer and lacrosse.
Baseball is different in kind: extra innings are ordinary play, so they read as
"8th", "9th", "10th" rather than "OT" and run to 32 before the guard trips. Raise
`maxOvertimes` in a game's settings if your league needs more.

**Down & distance** (football) advances itself from the yardage you enter and
flips possession on punts, turnovers and scores. Use **Set Possession** if it
ever drifts.

**Football and basketball** get a secondary clock bar. Football's is the NFHS
**play clock** (40 seconds after a normal play, 25 after a penalty, timeout,
change of possession or score) — it is *not* tied to the game clock, because its
whole job is to run between plays while the game clock is stopped. Basketball's is
the **shot clock** (NFHS 35 seconds), which *is* tied to the game clock, so
starting and stopping the game clock drives both and you manage one clock.

**Usually this comes from the Scorebot.** *Play / Shot Clock* is a feed field like
any other, on **Scorebot** by default, and it is normally the easiest way to run
it — the scoreboard already knows the number. Candidate paths (`playClock`,
`shotClock`, `data.shotClock`, …) are auto-discovered by **Parse Sample**, and a
bare number is read as **seconds**, so `24` means 24 seconds rather than 24 ms.
`playClockRunning` / `shotClockRunning` drive the running state if the feed sends
them.

A steady countdown writes nothing to the log — the value is extrapolated locally
between polls, and only a reset or a real disagreement is recorded. When the feed
is supplying the clock, auto-reset from logged plays switches itself **off**, so
the two never fight and you never see a wrong number flash on air; the bar shows
"from Scorebot" while that is the case. Set the field back to **Manual** and
auto-reset comes back on. Manual controls still work as an override at any time —
the next poll will correct them.

If you drive it yourself, both clocks reset from the plays you log —
**Auto-reset** is on by default and can be switched off. Preset buttons set a
specific value, **Show** hides it from the graphics without stopping it, and
`R` resets to full (`P` starts/stops the play clock).

For a state that uses a 30-second shot clock, set `auxFullMs` in the game's
settings; 20 is offered as a preset for rulesets that use a short reset after an
offensive rebound. NFHS itself resets to the full 35 there, which is the default.

**Baseball** gets an extra strip above the team switch: TOP/BOT, a B/S/O counter
that cycles on tap, and a diamond for the runners. All of it lands in
`scoreboard.xml` as `Count`, `Outs`, `HalfArrow`, `InningHalf`, `BasesCode`,
`BasesDisplay`, `RunnerFirst/Second/Third` and `AtBatTeam`. The count clears
itself when a plate appearance is logged.

### After the game

**Export** tab → **Mark Final & Commit to Season**. This rolls the game into both
teams' season totals. You can keep editing and commit again to refresh.

---

## The announcer view

A second, read-only page built for the people on the mic rather than the person
entering data. Open it on a laptop or tablet in the booth:

```
http://<server-ip>:8080/announcer
```

There is a **🎙️ Booth** link in the top bar of the operator console, and the URL
is listed with a copy button on the **vMix** tab. It updates live over the same
event stream and can never change a stat.

### Big-play popups

Touchdowns, interceptions, sacks, field goals, home runs, goals, threes, red
cards and the rest raise a banner across the top with the team, the headline and
who did it.

**Timeouts and penalties** raise one too, in a quieter green: *"TIMEOUT —
Fairfield Prep, timeout 2"* (they are counted), *"PENALTY — PREP, False Start,
5 yards"*. A penalty carrying an automatic first down or 15+ yards is promoted to
the louder blue because it changes the drive; a declined penalty raises nothing.
Ordinary basketball fouls never pop — only technicals and flagrants — since they
are far too frequent to interrupt for.

Three levels: gold for scores and turnovers, blue for other big plays, green for
timeouts and minor penalties. They stack up to three and clear themselves — 14
seconds for a score, 9 for a big play, 7 for a note — or click the ✕.

Opening the page mid-game does **not** replay everything that already happened;
only plays that land after you open it pop. Press **P** or use the footer button
to mute them entirely if the crew finds them distracting.

Plays are credited to the team that **made** them, not the team the entry was
logged against — a sack and a pick-six show the defence's badge, which is what
you would say out loud.

### Key stats at a glance

Four columns, no scrolling on a normal laptop:

- **Storylines** — scoring droughts, unanswered runs, time-of-possession gaps,
  third-down extremes, turnover counts. The context that makes a broadcast sound
  informed, computed rather than remembered.
- **Watch For** — who is close to a milestone, e.g. *"S. Calder needs 8 for 100
  rushing yards"*. Yardage chases are listed first because they make better air.
- **Milestones** — 100-yard games, 200/300 passing, hat tricks, double-figure
  tackles, and so on, the moment they land.
- **Leaders**, **Team Comparison**, **Scoring** and **Recent Plays**.

In Team Comparison the better number is tinted green — and for turnovers,
penalties and the like *fewer* counts as better. Composite values such as
`5-4-0` are never tinted, because there is no honest way to say which side won
them.

### Type to find any stat

The search box is focused on load and takes plain language. It searches players,
jersey numbers, teams, every team-stat row, every leader board and the
situational numbers at once:

| Type | You get |
|---|---|
| `riverton` or `11` | that player's full line, split by category |
| `third down` | both teams' third-down conversions |
| `rushing` | team rushing plus the rushing leader board |
| `possession` | time of possession, both teams |
| `prep` | every player on that team with a stat |

### Pinned panel

Every search result has a **📌 pin** button. Pinned items sit in a panel above the
columns and update live, so the crew can build the exact set they want up all
night — third down, time of possession, the running back's line — and stop
searching for them.

Pins are saved per **sport**, not per game, so the panel is already built the next
week. A pin that no longer resolves (last week's player) shows greyed as *"Not in
this game yet"* rather than vanishing, and **Clear all** empties the panel.
Pressing **Enter** pins the highlighted search result without reaching for the
mouse.

Press **/** from anywhere to jump into the box, **Esc** to clear it, and the
arrow keys to move through results. Quick chips under the box cover the usual
suspects for the sport in play, and **F** goes full screen for a booth monitor.

---

## vMix setup

### Option A — HTTP (recommended)

In vMix: **Settings → Data Sources → Add → XML**, paste a URL, set a refresh
interval (1 second is fine), then bind columns to your GT title fields.

Use the `/vmix/live/` URLs — they always follow whichever game is active, so you
configure vMix **once for the whole season**:

| Feed | URL |
|---|---|
| Scoreboard | `http://<server-ip>:8080/vmix/live/scoreboard.xml` |
| Team stats (one row per stat) | `http://<server-ip>:8080/vmix/live/teamstats.xml` |
| Team stats (one wide row) | `http://<server-ip>:8080/vmix/live/teamstatsflat.xml` |
| Leaders | `http://<server-ip>:8080/vmix/live/leaders.xml` |
| Players | `http://<server-ip>:8080/vmix/live/players.xml` |
| Scoring summary | `http://<server-ip>:8080/vmix/live/scoring.xml` |
| Recent plays | `http://<server-ip>:8080/vmix/live/plays.xml` |
| Roster | `http://<server-ip>:8080/vmix/live/roster.xml` |
| Everything | `http://<server-ip>:8080/vmix/live/all.xml` |

The **vMix** tab in the app lists these with copy buttons and the correct IP
already filled in.

Every document is a flat list of `<Row>` elements, which is the shape vMix's XML
data source expects.

**Filters** — narrow a feed with query parameters:

```
/vmix/live/players.xml?side=home&cat=passing&limit=5
/vmix/live/leaders.xml?cat=rushing&side=away&limit=3
/vmix/live/plays.xml?n=6
/vmix/live/roster.xml?side=away
```

`cat` accepts any stat table for the sport — for football: `passing`, `rushing`,
`receiving`, `defense`, `kicking`, `punting`, `returns`.

**Per-game URLs** are also available if you need a finished game rather than the
live one: `/vmix/<game-id>/scoreboard.xml`.

### Option B — files on disk

The same XML is written to `data/vmix/`, so vMix can read it as a local file with
no networking at all:

```
data/vmix/_live/scoreboard.xml      always the active game
data/vmix/<game-id>/scoreboard.xml  per-game copy
```

### Useful scoreboard fields

`scoreboard.xml` gives you one row with everything a lower third needs:

`HomeName` `HomeShort` `HomeAbbrev` `HomeMascot` `HomeColor` `HomeScore`
(and the `Away*` equivalents), `ScoreLine`, `LeaderAbbrev`, `Margin`,
`Period` `PeriodLabel` `Clock` `ClockRunning`, `Possession` `PossessionAbbrev`,
`Down` `Distance` `DownDistance` (football),
`Count` `Balls` `Strikes` `Outs` `Half` `HalfArrow` `InningHalf` `BasesCode`
`BasesDisplay` `BasesLoaded` `RunnersOn` `RunnerFirst` `RunnerSecond`
`RunnerThird` `AtBatTeam` (baseball),
`PlayClock` `PlayClockRunning` (football), `ShotClock` `ShotClockRunning`
(basketball), plus sport-neutral `AuxClock` `AuxClockLabel` `AuxClockRunning`
`AuxClockExpired` `AuxClockVisible` so one GT template can serve both,
`OfficialHomeScore` `OfficialAwayScore` `ScoreMismatch` (when a feed is connected),
`HomeTOP` `AwayTOP` (time of possession), `HomeDrought` `AwayDrought`
(time since that team last scored), and `HomeP1…HomeP7` / `AwayP1…` for the
linescore.

---

## Scorebot / clock feed (optional)

**Setup → Scorebot** connects a scoreboard feed so period, clock, score,
possession and down & distance update themselves.

### Sportzcast ScoreConnect III (tested)

ScoreConnect III runs a local MQTT broker and publishes the whole scoreboard as
JSON. With ScoreConnect running on the same machine, this is the entire setup:

| Setting | Value |
|---|---|
| Feed URL | `mqtt://127.0.0.1:1883/bot/0/json` |
| Enabled | ✓ |

The URL path is the **topic**. If you are not sure what a broker is publishing,
put `mqtt://127.0.0.1:1883/#` in the URL and press **Test Live Feed** — it
subscribes for a few seconds and lists every topic it saw, with the first JSON
message normalised. ScoreConnect publishes two: `bot/0/json` (what you want) and
`bot/0/sbdata` (the raw scoreboard string, ignored).

If ScoreConnect runs on a different machine, swap in its IP. `mqtts://` and
username/password are supported for brokers that need them.

Its field names are mapped out of the box — `Quarter`, `Clock`, `HomeScore`,
`GuestScore` (note: *Guest*, not Away), `Down`, `ToGo`, `BallOn`, `PlayClock`,
and possession from the `HomePossession` / `GuestPossession` marker characters.
So a football game arrives with the clock, the score, the play clock **and down
& distance** already filled in.

Two quirks worth knowing, both handled:

- **Blank fields.** ScoreConnect pads unused fields with a space. `" "` is
  treated as absent rather than as a value — otherwise `ClockStatus: " "` would
  read as "clock stopped" and freeze the game clock.
- **No run/stop flag.** It publishes a clock value but never says whether it is
  running. OpenStatsEngine infers it: a clock that is changing is running, one
  that holds the same value for three messages is stopped. Turn this off with
  `"inferRunning": false` in the scorebot config if your feed does report it.

### Other feeds

HTTP polling and plain-JSON WebSocket feeds work the same way — put an
`https://` or `wss://` URL in the same box.

Everything works without it; the manual clock is always available.

### Work out the mapping from a raw message

You do not need a live connection to set this up. Paste one raw JSON message into
**Paste a raw message** and hit **Parse Sample**. It shows what OpenStatsEngine
read from that message, and suggests the path for every field it can find:

```
WHAT OPENSTATSENGINE READ FROM THIS MESSAGE

  Period / Inning    4
  Game Clock         167000
  Clock Running      true
  Home Score         21
  Away Score         17
  Possession         home
  Top / Bottom       - not found -
  Runners on Base    - not found -

SUGGESTED FIELD MAP
{ "period": "data.period", "clock": "data.gameClock", ... }
```

**Use Suggested Map** fills the field map in and flips anything the message did
not contain over to Manual. Review, then **Save Settings**.

### Per-field sources

Every field has its own **Scorebot / Manual** switch. A field set to Manual is
never written by the feed, so an operator entry is never overwritten by the next
poll a second later.

This is exactly the baseball case: leave period, clock and score on **Scorebot**,
and set **Top / Bottom**, **Outs**, **Balls**, **Strikes** and **Runners on Base**
to **Manual** — the scoreboard doesn't send those, so the stats operator enters
them on the diamond strip instead.

| Field | Default |
|---|---|
| Period / Inning, Game Clock, Clock Running, Home/Away Score, Possession, Play / Shot Clock, Down, Distance, Ball On | Scorebot |
| Top / Bottom, Outs, Balls, Strikes, Runners on Base | Manual |

A manual entry always wins over an earlier feed value, so you can correct a field
mid-game even while it is set to Scorebot.

### Score handling

The score on your graphics comes from the plays you log. When the feed also sends
a score it is stored *alongside* as `OfficialHomeScore` / `OfficialAwayScore`,
with `ScoreMismatch` set to 1 when the two disagree — so a missed entry shows up
instead of silently overwriting your box score. Bind `ScoreMismatch` to a small
warning element in a GT title if you want to see it on the operator's preview.

### Notes

- Only genuine changes are written to the log, so it records clock transitions
  rather than a per-second firehose.
- Sub-second drift between the feed and the local clock is ignored
  (`toleranceMs`, default 1200).
- **Test Live Feed** does the same thing as Parse Sample but connects to the URL
  — subscribing briefly for MQTT, fetching once for HTTP.
- The MQTT path was built and verified against a live ScoreConnect III emulator.
  Other feeds are still worth checking with Parse Sample first.

---

## Importing HUDL and MaxPreps

**Teams** tab → **Import**. Choose a file or paste text — the format is detected
for you, and **Preview Stats** shows what will happen before anything is saved.

### HUDL per-game export (pipe-delimited `.txt`)

Recognised by its `Jersey|RushingNum|RushingYards|…` header. Two things about
this format are worth knowing:

- **It identifies players by jersey number only — there are no names.** Numbers
  are matched against the roster of the team you selected, so load the roster
  first.
- **It usually contains both teams**, and one player can span several rows
  (HUDL splits by stat group). Rows whose jersey is not on the selected roster
  are reported as belonging to the other team rather than silently dropped —
  import the opponent separately with their roster selected.

Repeated jerseys are combined by default; "long" columns take the maximum rather
than the sum. Since two players on a roster can legitimately share a number, any
merge is listed in the notes so you can check it.

### HUDL season page (saved `.html`)

Open the HUDL cumulative-stats page, **Save Page As → Webpage, Complete**, then
load the `.html` file. All eight sections import — passing, rushing, receiving,
defense, kicking, punting, kickoff returns and punt returns. `1,595` and `55.67 %`
and `7 / 11` are all handled, `-` is read as absent, and "Rest of team" / "Total"
rows are skipped.

Kickoff-return and punt-return tables have identical column headers, so they are
told apart by the heading above each table — don't reorder the page.

### MaxPreps

Use the **CSV / Excel export**, or copy the stats table off the web page and
paste it in. Both import cleanly.

**MaxPreps PDF reports are refused on purpose.** That layout drops empty cells
entirely, so a player with no passing stats has nine values in a thirteen-column
table and the remaining numbers no longer line up with their headings. Parsing it
would put confidently wrong numbers on your graphics, so the importer stops and
tells you to use the CSV instead.

### Roster imports

The same box imports rosters — **Import as Roster** — from a CIAC page URL,
a HUDL or MaxPreps CSV, or a spreadsheet. Merging is by name, so a jersey change
updates a player rather than duplicating them.

---

## Exports

Per game, from the **Export** tab:

| File | Contents |
|---|---|
| `report.pdf` | Full report: linescore, team comparison, scoring summary, box scores, play-by-play |
| `summary.pdf` | Same without play-by-play |
| `boxscore.csv` | One row per player, every stat column |
| `teamstats.csv` | Team comparison |
| `scoring.csv` | Scoring plays |
| `pbp.csv` | Every entry with the wall-clock time it was logged, plus undos and corrections |

Per team, per season: `season.csv` — every game plus computed season totals.

---

## Season history — playing a team twice

Yes: every game is kept per team for the whole season. When you hit **Mark Final
& Commit to Season**, the game's team line and every player's numbers are written
onto *both* teams' records.

**Teams** tab → pick the team and sport → **Load History**. You get every game
you have logged against them — date, opponent, home/away, result, a link to that
game's PDF — plus season totals aggregated across those games, and any HUDL or
MaxPreps set you imported for them.

So when you play them again in November, their September numbers are one click
away. Nothing is overwritten by a later import: live-logged games and imported
season sets are stored separately on the team record.

---

## Backups

On every start the server copies `teams/`, `games/` and `config.json` into
`data/_backups/<timestamp>/`, keeping the last 10. The files are small plain
text, so this costs almost nothing and means a stray delete, a mistyped
`--data`, or a bad import never costs you a season.

To restore, stop the server and copy a snapshot back over the live folders:

```bash
cp -R data/_backups/2026-09-11-18-30-00/teams data/
cp -R data/_backups/2026-09-11-18-30-00/games data/
```

`vmix/` is not backed up because it is regenerated from the event log. Start with
`--no-backup` to skip the snapshot.

The startup banner shows the data folder size so you can see it growing across
the season.

---

## How data is stored

Everything is plain text under `data/` and safe to copy, zip or sync.

```
data/
  config.json                    settings, active game, scorebot config
  teams/<team-id>.json           profile, rosters per sport, season totals
  games/<game-id>/meta.json      matchup, date, venue, level
  games/<game-id>/events.jsonl   append-only log — the source of truth
  vmix/…                         mirrored XML
```

The event log is **append-only**. Every entry carries an ISO timestamp, a local
timestamp, the period and the game clock it was entered at. Stats are *derived* by
replaying the log, never stored as running totals — which is why undo is exact,
why a mid-game restart recovers the clock, and why a power cut costs you at most
the entry in flight. A torn final line is skipped rather than failing the game.

Nothing is overwritten in place: JSON files are written to a temp file and
renamed, so an interrupted write cannot corrupt a team or a game.

---

## Tests

```bash
npm test
```

Runs 391 tests on a fresh clone (403 with real HUDL/MaxPreps exports present): unit tests (clock maths, time of possession, droughts, importers,
scorebot normalisation and field-source gating, baseball bases/count, per-sport
scoring), tests against the real HUDL exports in this folder, and an end-to-end
test that drives the live HTTP API through a football drive, undo, all six sports,
XML, CSV and PDF generation.

The server must be running on port 8770 for the end-to-end half:

```bash
node server.js --port 8770 --data "$TMPDIR/ose-test-data" --no-backup
```

---

## Notes and limits

- **Anyone on the network can open the entry page.** There is no login. That is
  deliberate for a truck/booth environment on a private network — do not expose
  the port to the internet.
- **Time of possession** is exact for football, where possession is implied by the
  play flow. For soccer and lacrosse it only moves when possession is logged
  explicitly, so treat it as indicative unless you are feeding it from Scorebot.
- **Plus/minus** (hockey) needs the on-ice players entered on the goal, which is
  slower than the 15-second target — it is an optional field, so skip it and the
  rest of the goal still records.
- **Baseball** has no clock; innings, outs and the half-inning advance from the
  plate appearances you log.
- Basketball minutes played are not tracked — substitutions are recorded but not
  timed.

---

## How this was built

Written by **Claude Opus** (Anthropic) in a series of sessions with a human
directing scope, supplying real HUDL/MaxPreps exports and a CIAC roster page, and
reviewing behaviour. The AI wrote the implementation, the tests, and this README.

Design decisions that came out of that process and are worth knowing before you
change anything:

- **Zero npm dependencies.** Node builtins only, including the PDF writer, the
  CSV/HTML parsers and the HTTP server. The target is a stadium laptop where
  `npm install` failing on venue Wi-Fi is a real risk.
- **Event sourcing.** `data/games/<id>/events.jsonl` is append-only and is the
  only source of truth; every stat is derived by replaying it. That is what makes
  undo exact, lets a mid-game restart recover the clock, and limits a power cut to
  the entry in flight.
- **Refusing to guess.** Where input is genuinely ambiguous the code stops and
  says so rather than producing plausible-looking numbers — MaxPreps PDFs are
  rejected outright because their layout drops empty cells, and ambiguous CSV
  columns are reported rather than silently mapped.

### Not included in this repository

Real HUDL and MaxPreps exports contain named high-school athletes and are
deliberately excluded (see `.gitignore`). `test/fixtures/` holds scrubbed
equivalents with invented names that reproduce the same formats and quirks, so
the parser tests run on a fresh clone. `test/real-data.test.js` runs the same
checks against real exports if you drop them in the project root, and skips
cleanly if you do not.

## License

MIT — see [LICENSE](LICENSE).
