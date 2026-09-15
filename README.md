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
> - **It has run a handful of live games, not a season.** The test suite is
>   thorough (591 tests on a fresh clone, 603 with real exports in place), but
>   passing tests are not the same as a Friday night with a scoreboard operator,
>   and the first real match still turned up three feed-parsing bugs the
>   emulator never triggered. Expect to find more in a sport it has not seen.
> - **Verify the stat rules against your own rulebook.** Scoring conventions were
>   implemented to NFHS rules as understood at the time — sacks not counting as
>   pass attempts, 40/25 play clock, 35-second shot clock, NCAA passer rating.
>   Confirm anything you put on air.
> - **The Sportzcast ScoreConnect III / MQTT feed now runs against a real
>   scoreboard**, verified for soccer. Other sports have only been exercised
>   against the emulator, and every board model names its fields slightly
>   differently — paste one raw message into **Setup → Scorebot → Parse Sample**
>   before trusting a new venue. Field names are matched **case-insensitively**,
>   because Sportzcast capitalises them differently from one sport to the next.
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

## Install

No dependencies, no build step. You need [Node.js 18+](https://nodejs.org).

```bash
git clone https://github.com/DueHack12/OpenStatsEngine.git
cd OpenStatsEngine
node server.js
```

On Windows double-click `start-windows.bat`; on a Mac, `start-mac.command`.

The server prints the addresses it is listening on:

```
Local       : http://localhost:8080
Network     : http://192.168.1.42:8080
```

Open the **Network** address on any phone or tablet on the same Wi-Fi. That is
the whole install.

> Port 8080 does not clash with vMix. vMix uses 8088 for its Web Controller and
> 8099 for its TCP API. Run with `--port 9000` if you need another.

## Two-minute start

1. **Teams** tab → add the two schools. Pull a roster from a CIAC URL, paste a
   CSV, or type it in.
2. **Setup** tab → pick the sport and the two teams → **Create & Make Active**.
3. **Live** tab → tap a play, pick a player, done. Most plays are two taps.
4. **vMix** tab → copy a URL *and its XPath* into vMix → Settings → Data Sources.

That is enough to go on air. Everything else is optional.

## What it does

- **Six sports** — football, basketball, ice hockey, soccer, lacrosse and
  baseball/softball, each with its own play palette, stat rules and clock.
- **Entry in seconds.** The palette is built for one operator working at game
  speed, with sticky fields, undo, redo, and edit for fixing a play after the
  fact without losing the original.
- **Live XML for vMix**, following whichever game is active, so you configure
  vMix once for the season.
- **Scoreboard feed** — reads period, clock, score, possession, down &
  distance, shots and corners straight off a Sportzcast ScoreConnect III over
  MQTT, with a per-field switch for anything you would rather enter by hand.
- **An announcer page** at `/announcer` — big-play popups, milestones, and
  type-to-find for any number in the game.
- **A feed monitor** at `/monitor` — the raw scoreboard messages, what OSE made
  of them, and what actually reached the log.
- **Imports** from HUDL and MaxPreps CSV exports, for both teams.
- **Exports** — PDF game reports, box scores, play-by-play and season CSVs.
- **Season totals** that accumulate per team, so the second meeting knows about
  the first.

## Documentation

The **[full manual](docs/MANUAL.md)** covers everything in detail:

| | |
|---|---|
| [Quick start](docs/MANUAL.md#quick-start) | first game, step by step |
| [Game-day workflow](docs/MANUAL.md#game-day-workflow) | the entry screen, per sport |
| [vMix setup](docs/MANUAL.md#vmix-setup) | every feed, every field, and the XPath each one needs |
| [Scorebot / clock feed](docs/MANUAL.md#scorebot--clock-feed-optional) | MQTT, field mapping, per-field sources, feed-loss alerts |
| [The announcer view](docs/MANUAL.md#the-announcer-view) | booth page, popups, pinned stats |
| [Importing HUDL and MaxPreps](docs/MANUAL.md#importing-hudl-and-maxpreps) | formats that work, and one that does not |
| [Exports](docs/MANUAL.md#exports) · [Season history](docs/MANUAL.md#season-history--playing-a-team-twice) | reports, CSVs, playing a team twice |
| [Backups](docs/MANUAL.md#backups) · [How data is stored](docs/MANUAL.md#how-data-is-stored) | where your season lives |
| [Notes and limits](docs/MANUAL.md#notes-and-limits) | what it does not do |

## How it works, briefly

Every entry is appended to a per-game log; the stats are **replayed from that
log** rather than stored. That is why undo is exact, why the clock survives a
restart, and why a correction cannot leave a total out of step. There are **no
npm dependencies** — the PDF writer, CSV and HTML parsers, HTTP server and MQTT
client are all hand-rolled against Node builtins, so there is no `npm install`
to fail on a stadium laptop.

Data lives in `data/` next to the server, as plain JSON and JSONL you can read
in any editor. Rolling backups are taken on every start.

## Tests

```bash
npm test              # in a second terminal: npm run test:serve
```

591 tests on a fresh clone, covering clock maths, per-sport scoring, the
importers, scorebot normalisation, feed-loss detection, XML and PDF generation,
plus an end-to-end pass that drives the real HTTP API through a full game.

## License

MIT — see [LICENSE](LICENSE).
