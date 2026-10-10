# dsh-token-dashboard

Token-usage dashboard for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — a Codex-style usage panel inside **Settings**.

English | [中文](README.zh.md)

![Usage panel](docs/panel-dark.png)

> The screenshot is real output: `npm run preview` folds this machine's actual
> session logs and renders the panel with the theme tokens lifted verbatim from
> the DSH shell. See [`scripts/preview.mjs`](scripts/preview.mjs).

## What it shows

| Row | Value |
|---|---|
| `Model` / `Model provider` | The dominant route in the selected window |
| `Directory` | The directory with the most usage |
| `Session` | Sessions and turns in the window |
| `Token usage` | `533.6M total  (2.02M input + 2.38M output)` |
| `Context window` | `[████████████████░░░░] 82% left (180.4K used / 1M)` |
| `Cache` | `[███████████████░░░░░] 75% hit (529.2M read / 706.0M prompt)` |
| `Reasoning` | Reasoning tokens, with their share of output |
| `In range` | Change against the previous equal-length window |

Below the card: five all-time headline figures (`Lifetime tokens`, `Peak tokens`, `Longest chat`, `Current streak`, `Longest streak`), a daily token-activity chart, per-model and per-directory breakdowns, and a recent-session table.

Ranges: **Today · 7d · 30d · All**.

## Why it looks like Codex

The panel reproduces OpenAI Codex's `/status` card. Every formatting rule is a line-by-line port of a named Rust function, and the source is quoted in the doc comment beside each one:

| This package | Codex source |
|---|---|
| `formatTokensCompact` | `tui/src/status/helpers.rs` |
| `compactAmount`, `countValue`, `formatDuration` | `tui/src/analytics/{data,summary_panel}.rs` |
| `renderLimitProgressBar` | `tui/src/status/rate_limits.rs` |
| `percentOfContextWindowRemaining` | `tui/src/token_usage.rs` |
| `formatAbsoluteTime` | `tui/src/status/helpers.rs` |
| the label/value grid | `tui/src/status/format.rs` |

That gives you Codex's recognisable `1.2K` / `128.5K` / `1.2M` compaction (2 decimals below 10, 1 below 100, none above, trailing zeros stripped), its 20-cell `[███░░░]` bar, its `{n}% left` phrasing, its dim parentheticals, and its dynamic label column.

**Three deliberate deviations**, because copying Codex literally would have been wrong here:

1. **The token row is always shown.** Codex hides it for ChatGPT subscribers, who are billed by rate-limit windows rather than tokens. DSH has no such windows, so hiding it would hide the entire point of the panel.
2. **The 12,000-token context baseline is not applied.** Codex subtracts a fixed 12K to discount its own system prompt. DSH's prompt overhead is a different size, so the same constant would produce a confidently wrong percentage. Occupancy is reported raw.
3. **Rate-limit bars became a context-occupancy bar.** Codex's bars encode a provider quota, which DSH has no equivalent of. Context occupancy is a genuine 0–100% remaining quantity, so the bar is reused there — its original purpose — rather than drawn against an invented denominator.

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

**Usage samples are replaced, not accumulated.** A streamed assistant message can report usage more than once for the same `(turn, step)`, and `llm/retry-started` closes that slot so a retried attempt counts again. The fold mirrors DSH's own `tokenUsage` projection exactly. Verified against a full store: the fold matches an independent naive sum of every `assistant/message` record on all four buckets, across 2,401 records.

### Cost

The first scan of a 20-session, 500 MB store takes about a second. Results are memoized per `(size, mtimeMs)`, so later refreshes only decode logs that changed, and snapshots are reused for 5 seconds.

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

`tests/render.test.mjs` asserts the Codex formatting rules against values taken from the Rust source, and renders the panel to check the card, the bars, the headline figures, the empty and error states, and both dictionaries.

## License

MIT. The Codex formatting rules reproduced here originate in Apache-2.0 code; see [LICENSE](LICENSE).
