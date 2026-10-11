# dsh-token-dashboard

Token-usage profile panel for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — a Codex-style usage report inside **Settings**.

English | [中文](README.zh.md)

![Usage panel](docs/panel-dark.png)

> The screenshot is real output: `npm run preview` folds this machine's actual
> session logs and renders the panel with the theme tokens lifted verbatim from
> the DSH shell. See [`scripts/preview.mjs`](scripts/preview.mjs).

## What it shows

Top to bottom:

| Block | Content |
|---|---|
| Identity | Avatar, display name, and handle from the signed-in DeepSeek account. Hidden when signed out. |
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

## Why it looks like Codex

The panel reproduces the **analytics Overview report** — the profile summary
Codex opens from `/usage`. (Codex has three usage surfaces; the `/status` card
is a different one, and it is not this.)

Every formatting rule is a port of a named Rust function, quoted in the doc
comment beside each one:

| This package | Codex source |
|---|---|
| `compactAmount`, `countValue`, `formatDuration` | `tui/src/analytics/{data,summary_panel}.rs` |
| `formatTokensCompact` | `tui/src/status/helpers.rs` |
| `renderLimitProgressBar` | `tui/src/status/rate_limits.rs` |
| `percentOfContextWindowRemaining` | `tui/src/token_usage.rs` |
| `formatAbsoluteTime` | `tui/src/status/helpers.rs` |

The activity ramp is **GitHub's contribution green**, read out of a swatch of the
real graph with `tools/sample-shot.mjs`: `#033a16` → `#196c2e` → `#2ea043` →
`#56d364` on `#151b23`, with GitHub's light palette for the light theme.

### Numbers follow the UI language

This is the one place a straight English port would have been visibly wrong. A
Chinese panel reads **`3.7亿`** and **`5317.1万`**, not `370M` and `53.2M`, and a
duration is **`46分59秒`**, not `46m 59s`. `localeCompact` / `localeDuration` /
`localeCount` own that split, and `tests/render.test.mjs` asserts the exact
strings from the reference screenshots.

### Three deliberate deviations

Copying Codex literally would have been wrong in these three places:

1. **Nothing is claimed that DSH cannot measure.** Codex's panel shows credits,
   a plan name, an account email, and 5-hour / weekly / monthly rate-limit
   windows. DSH has none of those, so none of them are here — not even as a
   placeholder bar with an invented denominator. The metrics that remain are
   each backed by a field the session log actually writes.
2. **English pluralization is fixed.** Codex prints `{days} days` with no
   singular, so a one-day streak reads `1 days`. That is grammar, not design.
3. **`Most used model` ranks by tokens, not by reply count.** A hundred cheap
   replies should not outrank the one model that spent the budget.

## Install

```sh
dsh plugin add dsh-token-dashboard
```

Then open **Settings → Usage**.

To install by hand, add the package to your profile and list it under `dsh.profile.bundles` in the profile's `package.json`.

## How it works

The package ships two halves, as `dsh.client` declares:

**Host half** (`lib/index.js`) reads `$DSH_HOME/sessions/**/session.v*.jsonl.zstd`, decodes them, and folds token usage. It registers one read-only route, `GET /dsh-token-dashboard/api/stats`, on `ctx.webServer`.

**Browser half** (`lib/client.js`) registers one `settings.section` page and renders the snapshot. It does no measuring of its own.

### Three things the Host half has to get right

**Session logs are multi-frame zstd.** Each persistence flush appends its own zstd frame, and Node's `zstdDecompressSync` — and `createZstdDecompress` — decode only the *first* frame and return successfully. A naive reader sees a 6 MB log as one 196-byte header line and reports zero usage. This package splits the stream on frame magic and decodes each frame, treating only an undecodable final frame as normal (a live session's tail is written while you read it).

**Newer log-format versions are not automatically better.** A session directory accumulates `session.v3`, `session.v4`, … where the newer file is a rewrite of the same conversation. But a rewrite that was interrupted leaves a *shorter* newer file with undecodable frames. On the machine this was developed on, one session has a healthy 3563-event `v3` next to a truncated 245-event `v4` — taking the highest version silently discarded **191.7M tokens, 56% of the store's total**. Every version present is therefore decoded and the one with the furthest durable `seq` wins.

**Usage samples are replaced, not accumulated.** A streamed assistant message can report usage more than once for the same `(turn, step)`, and `llm/retry-started` closes that slot so a retried attempt counts again. The fold mirrors DSH's own `tokenUsage` projection exactly. Verified against a full store: the fold matches an independent naive sum of every `assistant/message` record on all four buckets, across 2,600+ records.

**A day is a day, not a session.** `Peak tokens` is the maximum over the *aggregated* day buckets. Reading each session's own busiest day instead under-reported the peak by 53% here, because two sessions had run on the same date.

### Updating

The two halves do not reload together. The module system hot-swaps the browser
bundle, but the Host half is a cached ES module that only a DSH restart replaces.
When the browser half sees a snapshot from an older Host it says **"restart
DSH"** rather than dereferencing a field that is not there and blanking the
settings dialog.

### Cost

The first scan of a 20-session, 600 MB store takes about a second. Results are memoized per `(size, mtimeMs)`, so later refreshes only decode logs that changed, and snapshots are reused for 5 seconds. The account lookup that feeds the identity block is cached for 5 minutes and is skipped entirely when no account service is present.

### Privacy

Read-only. The plugin never writes, never calls a model, and never sends prompt or message content anywhere — it reads only the numeric `usage` records. The HTTP route is served by the same local webserver as the rest of the DSH GUI.

## Compatibility

- DSH 0.2.x (`@deepseek-ai/dsh-web-app`, `dsh-client-ui-settings`)
- Node ≥ 22.15 for the bundled-zstd APIs
- No runtime dependencies: the package imports only `node:*` on the Host side and resolves React and the UI primitives from the shell's module table on the browser side

## Develop

```sh
npm install
npm run build     # lib/index.js + lib/client.js + lib/types
npm run typecheck
npm test          # browser-bundle loader check, Codex-format render tests, live-log cross-check
npm run preview   # write docs/panel.html from your own session store
```

`tests/host-route.test.mjs` runs the built plugin against your real `$DSH_HOME/sessions` and asserts the fold matches an independent sum of the same logs. It skips cleanly when no session store exists.

`tests/render.test.mjs` asserts the formatting rules against values taken from the Rust source and the localized units taken from the reference panel, then renders the whole report to check the identity block, the five-cell bar, the heatmap's week alignment and three modes, the insights, the empty and error states, and both dictionaries.

`tools/analyze-heatmap.mjs` is how the ramp was derived; `tools/sample-shot.mjs` decodes a PNG with no dependency so a screenshot can be measured rather than eyeballed. See [`tools/README.md`](tools/README.md).

## License

MIT. The Codex formatting rules reproduced here originate in Apache-2.0 code; see [LICENSE](LICENSE).
