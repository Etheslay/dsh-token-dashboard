# dsh-token-dashboard

Token-usage profile panel for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — a Codex-style usage report inside **Settings**.

**English** | [中文](README.md)

## Install

```sh
dsh plugin add @etheslay/dsh-token-dashboard
```

Then open **Settings → Usage**.

npm page: <https://www.npmjs.com/package/@etheslay/dsh-token-dashboard> — version, publish date and file list live there.

- **By hand**: `npm install @etheslay/dsh-token-dashboard`, then list the package under `dsh.profile.bundles` in the profile's `package.json`
- **From source**: clone this repo, then `npm install && npm run build && npm run refresh:profile` (see [Develop](#develop))

Requires DSH 0.2.x and Node ≥ 22.18 (see [Compatibility](#compatibility)).

![Usage panel](docs/panel-dark.png)

> The screenshot is real output: `npm run preview` folds this machine's actual
> session logs and renders the panel with the theme tokens lifted verbatim from
> the DSH shell. See [`scripts/preview.mjs`](scripts/preview.mjs).

## What it shows

Top to bottom:

| Block | Content |
|---|---|
| Five numbers | `Lifetime tokens` · `Peak tokens` · `Longest chat` · `Longest streak` · `Current streak` |
| `Token activity` | A year of contribution cells, drawn as two stacked six-month blocks, with **Daily · Weekly · Cumulative** modes and a `Less ▢▢▢▢▢ More` ramp |
| `Insights` | `Most used reasoning` · `Most used model` · `Skills explored` · `Total skills used` · `Total chats` · `Total turns` · `Cache hit rate` |
| `Most used` | The skills invoked most often, as `$name` with a run count |

Everything is all-time, so there is no range control to set. The heatmap is the
only time axis.

The year is split into **two six-month blocks rather than one long row**. A
single row needs 53 columns, which at a readable cell size is wider than a
settings panel and turns into a horizontal scrollbar; halving it leaves ~26
columns per block, so the cells stay legible and a whole year fits without
scrolling at any panel width.

The window is **Sunday-aligned and an even number of weeks**, trimmed by up to
six days if it would otherwise be odd (`heatmapWindow` in `src/host/aggregate.ts`).
An odd column count cannot be halved: one block would come up a column short and
the two rows would end at different x positions, which reads as a table missing a
column. Trimming a few days off the start of a year of history is invisible next
to that.

The grid is padded forward to the end of the current week, so every column holds
seven days whatever weekday today is. Those trailing days are marked `future`:
they keep their place and their empty colour, and they claim nothing — no date in
the accessibility tree, no tooltip, no hover readout.

**A column is a week, in every mode.** Daily draws one day per cell, Weekly
repeats its column's total across all seven, and Cumulative carries a running
total forward. Weekly therefore names a cell by its week — `week of 3 May 2026` —
rather than by the weekday it happens to sit on.

### The layout is sized by the panel, not by a number

The heatmap's width is derived rather than hard-coded:

```css
width: min(100%, calc(var(--tdd-heat-columns) * (var(--tdd-heat-cell) + var(--tdd-heat-gap)) - var(--tdd-heat-gap)))
```

`--tdd-heat-columns` is set by the panel from the grid it actually built, so a
52-week year and a 53-week year both size correctly and the cells, the month axis
and the axis's idea of where column *i* starts are all one derivation. The grid
fills the panel up to a maximum cell size and stops there, which means it lines
up with the blocks above and below it at every window width instead of drifting
away from them behind a fixed pixel ceiling.

**The panel does not scroll.** The settings dialog already scrolls its own body,
so a `height:100%; overflow-y:auto` here produced a second scrollbar inside the
dialog's. Vertical overflow belongs to the host; scrolling is not the panel's to
own.

## Why it looks like Codex

The panel reproduces the **analytics Overview report** — the profile summary
Codex opens from `/usage`. (Codex has three usage surfaces; the `/status` card
is a different one, and it is not this.)

Every formatting rule is a port of a named Rust function, quoted in the doc
comment beside each one:

| This package | Codex source |
|---|---|
| `compactAmount`, `countValue`, `formatDuration` | `tui/src/analytics/{data,summary_panel}.rs` |
| `formatAbsoluteTime` | `tui/src/status/helpers.rs` |

Those four are what the layout renders. There is nothing else to list: a port of
a Codex surface this panel does not draw — the rate-limit bar, the context-window
meter, the bar-chart ramp — is not shipped, because describing it here would
promise a feature the panel does not have.

The activity ramp is the reference panel's **purple**, five steps from `#ddd0fb` to
`#5f21c9`. `tools/sample-shot.mjs` decodes a PNG with no dependency, so a swatch
of the reference graph can be measured rather than eyeballed.

**Darker means more.** Level 1 is the faintest purple and level 4 the deepest,
most saturated one, so the heaviest day is the visually heaviest cell. Both
themes run pale → deep: the dark theme does *not* brighten as usage rises, which
is a deliberate departure from the reference (it did) because brighter-for-more
reads backwards next to every other quota meter. `tests/render.test.mjs` asserts
the rule rather than the hex values — every level must be darker and more
saturated than the one below it, in both themes. Each theme's step 0 is its own
quiet nested surface, not the reference's `#181818`, which is nearly invisible on
DSH's dark background.

### Numbers follow the UI language

This is the one place a straight English port would have been visibly wrong. A
Chinese panel reads **`3.7亿`** and **`5317.1万`**, not `370M` and `53.2M`, and a
duration is **`46分59秒`**, not `46m 59s`. `localeCompact` / `localeDuration` /
`localeCount` own that split, and `tests/render.test.mjs` asserts the exact
strings from the reference screenshots.

### Four deliberate deviations

Copying Codex literally would have been wrong in these four places:

1. **Nothing is claimed that DSH cannot measure.** Codex's panel shows credits,
   a plan name, an account email, and 5-hour / weekly / monthly rate-limit
   windows. DSH has none of those, so none of them are here — not even as a
   placeholder bar with an invented denominator. The metrics that remain are
   each backed by a field the session log actually writes.
2. **English pluralization is fixed.** Codex prints `{days} days` with no
   singular, so a one-day streak reads `1 days`. That is grammar, not design.
3. **`Most used model` ranks by tokens, not by reply count.** A hundred cheap
   replies should not outrank the one model that spent the budget.
4. **A darker cell means a heavier day, in both themes.** Codex brightens its
   dark theme as usage rises; that reads backwards next to every other quota
   meter, so the dark ramp runs pale → deep like the light one.

## How it works

The package ships two halves, as `dsh.client` declares:

**Host half** (`lib/index.js`) reads `$DSH_HOME/sessions/**/session.v*.jsonl.zstd`, decodes them, and folds token usage. It registers one read-only route, `GET /dsh-token-dashboard/api/stats`, on `ctx.webServer`.

**Browser half** (`lib/client.js`) registers one `settings.section` page and renders the snapshot. It does no measuring of its own.

### The snapshot is a published type

The route answers with a `UsageSnapshot`, and that shape is exported from the package root, so a script, a test harness, or a second panel can type the payload instead of restating it:

```ts
import type { UsageSnapshot, StatsQuery } from '@etheslay/dsh-token-dashboard'
```

`lib/types/host/index.d.ts` is emitted from `src/host/index.ts` — the same module `lib/index.js` bundles — and the build fails outright rather than publishing declarations that do not match the code. The browser half's exports (`buildHeatmap`, `heatCellDescription`, …) resolve from the `./client` subpath.

### Four things the Host half has to get right

**Session logs are multi-frame zstd.** Each persistence flush appends its own zstd frame, and Node's `zstdDecompressSync` — and `createZstdDecompress` — decode only the *first* frame and return successfully. A naive reader sees a 6 MB log as one 196-byte header line and reports zero usage. This package splits the stream on frame magic and decodes each frame, treating only an undecodable final frame as normal (a live session's tail is written while you read it).

**Newer log-format versions are not automatically better.** A session directory accumulates `session.v3`, `session.v4`, … where the newer file is a rewrite of the same conversation. But a rewrite that was interrupted leaves a *shorter* newer file with undecodable frames. On the machine this was developed on, one session has a healthy 3563-event `v3` next to a truncated 245-event `v4` — taking the highest version silently discarded **191.7M tokens, 56% of the store's total**. Every version present is therefore decoded and the one with the furthest durable `seq` wins.

**Usage samples are replaced, not accumulated.** A streamed assistant message can report usage more than once for the same `(turn, step)`, and `llm/retry-started` closes that slot so a retried attempt counts again. The fold mirrors DSH's own `tokenUsage` projection exactly. Verified against a full store: the fold matches an independent naive sum of every `assistant/message` record on all four buckets, across 2,600+ records. The same rule governs the response counts: **one settlement is one response in every tally** — session, day, and route — so a streamed re-report *moves* a count rather than adding one, and only a retried step counts twice.

**A day is a day, not a session.** `Peak tokens` is the maximum over the *aggregated* day buckets. Reading each session's own busiest day instead under-reported the peak by 53% here, because two sessions had run on the same date.

### Updating

The two halves do not reload together. The module system hot-swaps the browser
bundle, but the Host half is a cached ES module that only a DSH restart replaces.
When the browser half sees a snapshot from an older Host it says **"restart
DSH"** rather than dereferencing a field that is not there and blanking the
settings dialog.

### Cost

The first scan of a 20-session, 600 MB store takes about a second. Results are memoized per `(size, mtimeMs)`, so later refreshes only decode logs that changed, and snapshots are reused for 5 seconds. The optional account lookup is cached for 5 minutes and is skipped entirely when the account subsystem is not mounted.

### Privacy

Read-only. The plugin never writes, never calls a model, and never sends prompt or message content anywhere — it reads only the numeric `usage` records. The HTTP route is served by the same local webserver as the rest of the DSH GUI.

## Compatibility

- DSH 0.2.x (`@deepseek-ai/dsh-web-app`, `dsh-client-ui-settings`)
- Node ≥ 22.18 (`engines`; the bundled-zstd APIs need ≥ 22.15, and the test and
  preview scripts import `src/**/*.ts` directly, which needs unflagged type
  stripping)
- No runtime dependencies: the package imports only `node:*` on the Host side and resolves React and the UI primitives from the shell's module table on the browser side

## Develop

```sh
npm install
npm run build            # lib/index.js + lib/client.js + lib/types
npm run typecheck
npm test                 # fold unit tests, Codex-format render tests, browser-bundle loader check, live-log cross-check
npm run preview          # write docs/panel.html from your own session store
npm run check:layout     # measure the real panel's geometry in headless Chrome
npm run refresh:profile  # repack + reinstall into the DSH profile the app loads
```

**Editing `src/` does not change what DSH runs.** A profile installs this package
from a packed tarball, so the app loads its own copy under
`<profile>/node_modules/@etheslay/dsh-token-dashboard/`. Until that copy is refreshed, a fix
is invisible — which is exactly how a repaired double scrollbar kept showing up in
the panel. `npm run refresh:profile` repacks and reinstalls it; reload the page
afterwards. (A change to the Host half also needs a DSH restart, since a replaced
ES module stays cached in the Node process.) See [`tools/README.md`](tools/README.md).

`tests/host-route.test.mjs` runs the built plugin against your real `$DSH_HOME/sessions` and asserts the fold matches an independent sum of the same logs. It skips cleanly when no session store exists.

`tests/fold.test.mjs` covers what a live store cannot: DSH writes one `assistant/message` per step, so the replacement path and its response counting never execute there. Synthetic events exercise a streamed re-report, a retry that must count twice, a replacement that lands on another local day, a usage sample that only exists inside the settlement's stream, and an unstamped event.

`tests/render.test.mjs` asserts the formatting rules against values taken from the Rust source and the localized units taken from the reference panel, then renders the whole report to check the five-cell bar, the heatmap's week alignment and three modes, the insights, the empty and error states, and both dictionaries.

`npm run check:layout` covers what markup assertions cannot: it renders the panel in headless Chrome and measures it, because the two-scrollbar bug and the heatmap that stopped short of the panel's edge were both invisible to a DOM check. Point it at `docs/panel.html` to measure with your own data. See [`tools/README.md`](tools/README.md).

`tools/sample-shot.mjs` decodes a PNG with no dependency so a screenshot can be measured rather than eyeballed — that is where the ramp comes from.

## License

MIT. The Codex formatting rules reproduced here originate in Apache-2.0 code; see [LICENSE](LICENSE) for the licence and [NOTICE](NOTICE) for what was reproduced and from where.
