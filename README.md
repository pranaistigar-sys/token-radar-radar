# Token Launch Radar

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/pranaistigar-sys/token-radar-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/pranaistigar-sys/token-radar-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for make.fun's **token-radar-01** bounty ("Build the best token launch radar",
$1,325 in prizes). It reads a frozen DefiLlama snapshot, ranks every protocol that records no
token by an implied value derived from the snapshot's own figures, and shows a reader how to farm
each one.

## What it does

- **Board** — 198 pre-token protocols (all 40 on the snapshot's watchlist, plus 158 clean
  pre-token protocols below the $50M floor), ranked by implied value.
- **Value model** — `implied value = TVL × category multiple × growth factor × age factor × chain factor`.
  The category multiple is the median market-cap/TVL of token-bearing protocols in the same category
  (global median when a category has fewer than 3 trading comparables), clamped to 0.02–3.00.
  Growth uses the 7-day TVL change, age the years listed with no token recorded (6% per year, capped
  at 5 years), chains the number of chains (2% per extra chain, capped at 4). No protocol name is
  hardcoded into the ranking.
- **Farm plans** — six concrete steps per protocol, built from its own chains, category, TVL and
  7-day change, with amounts, cadence and cost estimates.
- **Dashboard** — a static page (no network): sortable/filterable board, a detail view for every
  protocol with its value breakdown and nearest trading comparables, and a comparables table.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json` by default and writes
`board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` under `/output`.
It runs twice with identical bytes.

## Layout

- `main.ts` — entrypoint: read snapshot, build board, write outputs, write the dossier.
- `lib/radar.ts` — the value model, farm-plan generator and board builder.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte-for-byte from the kit.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`).
- `screenshots/` — board, detail and filtered views of the dashboard.
