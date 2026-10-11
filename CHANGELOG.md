# Changelog

Notable changes to `@etheslay/dsh-token-dashboard`. The version numbers are the
published npm versions; entries under **Unreleased** are in the repository but
not in a published tarball yet.

## Unreleased

Documentation and licence only — no functional change.

- `LICENSE` holds the MIT text alone; the Codex provenance paragraph moved to
  `NOTICE`, which is why GitHub and licensee now report **MIT** instead of
  `NOASSERTION`. `NOTICE` ships in the tarball.
- The README leads with the install route, and both languages carry the same
  sections. `tests/readme.test.mjs` enforces that they stay in step.
- The install command gained the `--profile` flag it always needed:
  `dsh plugin` rejects a missing `--profile`, so the previously documented
  command could not run.

## 0.1.0

First public release.

- `Token activity`: a year of contribution cells in two stacked six-month
  blocks, with Daily / Weekly / Cumulative modes. A column is a week in every
  mode; a weekly cell is named by its week.
- Five all-time figures: lifetime tokens, peak tokens, longest chat, longest
  streak, current streak.
- `Insights`: most used reasoning, most used model (ranked by tokens), skills
  explored, total skills used, total chats, total turns, cache hit rate.
- `Most used`: the skills invoked most often.
- Host half reads `$DSH_HOME/sessions/**/session.v*.jsonl.zstd` and folds usage
  exactly as DSH's own `tokenUsage` projection does — including the
  replacement rule for streamed re-reports and the retry rule for
  `llm/retry-started`. Verified against a full store: identical to an
  independent naive sum on all four buckets.
- Multi-frame zstd decoding, and seq-aware selection between `session.v<N>`
  rewrites, because a newer version can be a truncated one.
- One read-only route, `GET /dsh-token-dashboard/api/stats`, plus
  `GET /dsh-token-dashboard/api/health`.
- Bilingual panel (zh / en) with numbers and durations following the active UI
  language.
