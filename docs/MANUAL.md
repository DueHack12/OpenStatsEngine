# OpenStatsEngine — Manual

Full reference: every screen, every field, every setup option.
For installation and a two-minute overview, see the [README](../README.md).

## Contents

- [Quick start](#quick-start)
- [Game-day workflow](#game-day-workflow)
- [The announcer view](#the-announcer-view)
- [vMix setup](#vmix-setup)
- [Scorebot / clock feed](#scorebot--clock-feed-optional)
- [Importing HUDL and MaxPreps](#importing-hudl-and-maxpreps)
- [Archiving finished games](#archiving-finished-games)
- [Exports](#exports)
- [Season history — playing a team twice](#season-history--playing-a-team-twice)
- [Backups](#backups)
- [How data is stored](#how-data-is-stored)
- [Tests](#tests)
- [Notes and limits](#notes-and-limits)

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

In vMix: **Settings → Data Sources → Add → XML**, paste a URL, **set the XPath**,
set a refresh interval (1 second is fine), then bind columns to your GT title
fields.

> **The XPath is not optional.** Every document is a set of repeating `<Row>`
> elements, and vMix needs the XPath pointed at those rows — `TeamStats/Row`,
> not `TeamStats`. Aim it at the document instead and vMix returns a single row
> whose one cell reads like `Timeouts Usedtimeouts_used00PREPSHS`: that is one
> row's fields concatenated, and it means the XPath selected the document rather
> than the rows inside it.

Use the `/vmix/live/` URLs — they always follow whichever game is active, so you
configure vMix **once for the whole season**:

| Feed | URL | XPath |
|---|---|---|
| Scoreboard | `http://<server-ip>:8080/vmix/live/scoreboard.xml` | `Scoreboard/Row` |
| Team stats (one row per stat) | `http://<server-ip>:8080/vmix/live/teamstats.xml` | `TeamStats/Row` |
| Team stats (one wide row) | `http://<server-ip>:8080/vmix/live/teamstatsflat.xml` | `TeamStatsFlat/Row` |
| Leaders | `http://<server-ip>:8080/vmix/live/leaders.xml` | `Leaders/Row` |
| Players | `http://<server-ip>:8080/vmix/live/players.xml` | `Players/Row` |
| Scoring summary | `http://<server-ip>:8080/vmix/live/scoring.xml` | `Scoring/Row` |
| Recent plays | `http://<server-ip>:8080/vmix/live/plays.xml` | `Plays/Row` |
| Roster | `http://<server-ip>:8080/vmix/live/roster.xml` | `Roster/Row` |
| Everything | `http://<server-ip>:8080/vmix/live/all.xml` | `Game/TeamStats/Row` etc. |

The **vMix** tab in the app lists these with copy buttons for both the URL and
the XPath, and the correct IP already filled in.

`all.xml` is the exception to the flat shape: it nests every section under a
`<Game>` element, so point the XPath at the section you want —
`Game/Scoreboard/Row`, `Game/TeamStats/Row`, and so on. Each single-purpose
document has its rows at the top level.

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
`BoardHomeSOG` `BoardHomeCorners` `BoardHomeSaves` and the `BoardAway*` equivalents
(when the scoreboard counts them itself),
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
- **Run/stop flag.** On the emulator, `ClockStatus` stays blank the whole time —
  over 30 seconds with the clock visibly counting down, all 30 messages had
  `" "`. A real ScoreBot may well populate it. Both cases work:
  - **If the feed reports a status, it wins.** `true`/`false`, `1`/`0`,
    `Y`/`N`, `running`/`stopped`, `on`/`off` are all understood, and inference
    never overrides a reported value.
  - **If it doesn't, or sends something unrecognised, the clock movement decides.**
    A changing clock is running; one that holds for three messages is stopped.

  An unrecognised marker is deliberately treated as *unknown* rather than
  "stopped". Guessing stopped is the worst failure available here — the game
  clock silently freezes while the board counts down and time of possession is
  wrong for the rest of the night. If your board uses its own markers, teach it
  rather than relying on the fallback:

  ```json
  "runningValues": { "true": ["R"], "false": ["S"] }
  ```

  The Scorebot status panel names any value it could not read, so you will see
  what to map. Turn the fallback off entirely with `"inferRunning": false`.

### While it is connected, the manual controls grey out

Anything the feed is driving is disabled in the entry UI, with a green
**⛓ Scorebot** badge on the bar and a tooltip saying which field it is and where
to take it back. So if the board owns the clock, the operator is not fighting it
with the −10s button.

This follows the per-field sources exactly: set *Game Clock* to Manual and the
clock buttons come back while the rest stay locked. It also follows the
**connection**, not just the setting — if the broker drops, the controls unlock
immediately rather than stranding the operator on a clock nothing is updating.

Undo, Redo and the play-clock **Show** toggle never lock, because they are not
feed data.

### Turning it off

The **Enabled** switch acts immediately — untick it and the feed disconnects,
no separate Save step. There is also a **Disconnect** button next to the status
light, which shows `● Connected — MQTT · bot/0/json` or `● Disconnected` at a
glance.

Disconnecting is **persistent**: it stays off through activating a game, creating
a game, saving other settings and restarting the server, until you press Connect
again. Your feed URL and other settings are kept, so reconnecting is one click.

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
| Period / Inning, Game Clock, Clock Running, Home/Away Score, Possession, Play / Shot Clock, Down, Distance, Ball On, Shots on Goal, Corner Kicks, Saves | Scorebot |
| Top / Bottom, Outs, Balls, Strikes, Runners on Base | Manual |

A manual entry always wins over an earlier feed value, so you can correct a field
mid-game even while it is set to Scorebot.

### Score handling

The score on your graphics comes from the plays you log. **Entering a touchdown
never adds to a score arriving from the feed** — the two are kept as separate
numbers and are only ever compared, never summed. A board reading replaces the
previous one rather than accumulating, so a scoreboard repeating `HomeScore: 14`
once a second does not run the score away.

#### Counting stats the board keeps

Soccer, hockey and lacrosse scoreboards often track shots on goal, corner kicks
and saves themselves. **Shots on Goal**, **Corner Kicks** and **Saves** are feed
fields like any other — one switch each, covering both sides, since nobody wants
the board's home corners next to their own away corners.

They are stored as the *board's* figures rather than folded into the team totals.
Four shots on a scoreboard cannot be turned into four shot events, and
overwriting a total the operator has been logging by hand would lose real work.
They appear in **Stats → Team** under *From the Scoreboard*, and in the
scoreboard XML as `BoardHomeSOG` / `BoardHomeCorners` / `BoardHomeSaves` (and the
away equivalents), so a title can bind whichever number the crew trusts for that
sport.

The feed's own figure is stored alongside as `OfficialHomeScore` /
`OfficialAwayScore`, with `ScoreMismatch` set to 1 when the two disagree. Bind
`ScoreMismatch` to a small warning element in a GT title if you want it on air.

**In the entry console**, a disagreement shows as a red `BOARD 14 (+1)` chip
under the affected team's score. It appears only while the feed is actually
driving that score, so a stale figure left behind by a dead feed is not reported
as a mismatch. Expect the chip briefly on every score — the board updates the
instant the official signals, seconds before the play is entered — so treat it
as a prompt, not an alarm: it means *the scoring play has not been logged yet*,
or, if it reads negative, that something was logged twice or to the wrong team.

### Feed monitor

**`/monitor`** (also `/feed`, and the **📡 Feed** link in the top bar) is a
read-only page for watching the scoreboard link during a game:

- **Scorebot Link** — connected or not, transport, topic, message count, how
  long since the last message, and this server's own addresses and port.
- **Game** — the clock and score as OSE currently has them, whether the clock
  and period come from the board or are being entered by hand, and the board's
  own score, shots and corners beside them.
- **What OSE Read** — every field pulled out of the last message. A field the
  board does not send is left out; one switched to **Manual** is shown greyed
  and labelled, so a gap is never a mystery.
- **Raw Message** — the message itself, keys sorted, with space-padded fields
  rendered as `"···"  (blank)`. Boards pad unused fields with spaces rather
  than omitting them, and telling "sends nothing" apart from "we cannot read
  it" is usually the whole diagnosis.
- **Recently Logged** — the last dozen entries actually written to the game
  log, newest first.

It polls one endpoint once a second and has a **Pause** switch for reading a
message without it moving.

### If the feed drops

A dead feed is silent by nature: no events arrive, so without something watching
the connection the only symptom is a screen that quietly stops changing. When a
feed that was connected goes away on its own, a red banner drops in under the
top bar naming the topic and the cause, with **Reconnect** and **Dismiss**. The
controls it was driving unlock at the same moment, so the operator can keep
working by hand.

**A board that stops sending counts as a drop.** This is the failure that hides:
switch the ScoreConnect emulator off and MQTT keeps its TCP connection and its
keepalives, so nothing looks wrong while every number on screen quietly freezes.
Silence for more than **five seconds** (Setup → Scorebot → *Warn if silent for*)
raises the banner under its own heading — *Scorebot has stopped sending*, saying
the connection is open but the board has gone quiet, so you are not hunting a
network problem that isn't there.

The link is left running, so recovery needs nothing from the operator: the next
message that arrives marks the feed live and clears the banner. Set the value to
**0** to switch the check off, which is the right thing for a board that only
publishes when something changes and is legitimately silent between plays.

It is deliberately narrow about what counts as a fault:

- Pressing **Disconnect** yourself never raises it.
- Neither does the moment you press **Connect** — not-yet-connected is not the
  same as dropped. The Setup status pill shows *Connecting…* for that.
- If the feed comes back on its own, the banner turns green, says so, and clears
  itself after a few seconds rather than leaving a warning to be dismissed about
  a problem that has already fixed itself.

The banner sits in the page flow rather than floating over it, so it never
covers the scoreboard, and it survives a page reload while the feed is still
down.

### Notes

- **A running clock writes almost nothing.** A board and a locally-projected
  clock always disagree slightly, and logging a correction each time turns the
  game log into a per-second firehose — one real match finished with 5458
  `clock_set` events against 18 actual entries, 99% of the file. A genuine jump
  (a referee resetting the clock) is written the instant it happens, judged
  against the board's own previous reading rather than against our projection,
  since drift accumulates until it *looks* like a jump. Ordinary drift is
  re-synced at most every ten seconds. Ten minutes of 1 Hz messages now costs
  one event. Tunable with `clockJumpMs` (default 3000) and `clockResyncMs`
  (default 10000).
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

## Archiving finished games

The games list in **Setup** shows every game you have created. Over a season
that becomes unwieldy, so a finished game can be **archived**: it disappears
from the list, and nothing else about it changes.

Archiving is a visibility flag and nothing more. The play-by-play, the PDF and
CSV exports, the vMix XML and the season totals are all exactly as they were,
and **Unarchive** puts the game straight back. It is the safe alternative to
**Delete**, which removes the event log for good.

Two deliberate details:

- **The active game always stays visible**, archived or not. Nobody should have
  to hunt for the game currently on air.
- **Archiving does not deactivate a game.** Archiving right after the final
  whistle is the normal case, and the crew is often still holding a final-score
  graphic — pulling the vMix feed to tidy a list would be a poor trade.

**Mark Final & Commit to Season** offers to archive as soon as it has committed,
because that is when you usually want it gone. Say *Keep it in the list* if you
still have exports to pull; the game can be archived later from **Setup →
Games** at any time.

Archived games are revealed with **Show N archived** at the top of the list.

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

Runs 577 tests on a fresh clone (589 with real HUDL/MaxPreps exports present): unit tests (clock maths, time of possession, droughts, importers,
scorebot normalisation, field-source gating, feed-loss and stalled-feed detection,
board-vs-entered score separation, baseball bases/count, per-sport scoring), tests against the real HUDL exports in this folder, and an end-to-end
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
