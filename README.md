# Token Launch Radar

A submission for make.fun's token-radar-01 competition: it reads a DefiLlama protocol snapshot,
picks out the protocols whose records no token in this snapshot, ranks them by implied launch
value, and gives each one a farming plan, plus a zero-dependency static dashboard.

## The model

```
implied value = TVL x category multiple x growth adjustment x age adjustment
```

The category multiple is the median mcap/TVL of the protocols in the same category that do have a
token in this snapshot. A category with fewer than three samples falls back to the global median,
and every multiple is clamped to 0.05-20.

The growth adjustment is `1 + clamp(7d change, -30, +30) / 100 x 0.5`. The age adjustment adds at
most 20% for younger listings. The product filter drops CEXs, liquid staking and restaking
products, bridges, wrapped and staked variants, and exchange-branded names.

Throughout the board, "no token" always means: the records no token in this snapshot. It is a
statement about the data, not about the protocol's plans.

## Run

Node 22.18 or newer, no dependencies.

```
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the
output directory. Open `dashboard/index.html` from that directory directly in a browser.

## Layout

- `main.ts` — IO and assembly.
- `lib/model.ts` — the model and the board checks.
- `vendor/makefun-board.ts` — the official dossier library.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — three shots: the board, a detail view, a filtered view.

## License

MIT.
