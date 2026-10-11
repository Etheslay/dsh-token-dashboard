# Changelog

Notable changes to `@etheslay/dsh-token-dashboard`. The version numbers are the
published npm versions.

## 0.1.4

Documentation only — `src/` is untouched.

- The README screenshots are real captures of the panel running inside DSH now:
  the five all-time figures with a year of activity, and the insights and
  most-used blocks. The caption says where they came from — 18 chats and 1.05
  billion tokens on this machine — rather than describing a render pipeline.
- `docs/panel-dark.png` and `docs/panel-light.png` are gone with it. So is the
  old caption's claim that the pictures came out of `npm run preview`: that
  command renders `docs/panel.html` for layout measurements, and the two theme
  renders it produced were not what a user actually sees.

## 0.1.3

Documentation only — `src/` is untouched.

- The npm downloads badge is gone. npm's download API has no data for a package
  published the same day, so `npm/dm` rendered **package not found or too new**
  in red wherever the badges appear. Worth adding back once npm has aggregated a
  full day.
- The licence badge reads npm rather than GitHub: `npm/l` takes the `license`
  field straight from `package.json`, while `github/license` depends on GitHub's
  licence detection — which reported `NOASSERTION` while the MIT text shared a
  file with the Codex notice, and left a cached **invalid** badge behind after
  the two were split. Badge images are cached per URL by GitHub's image proxy as
  well as by the browser, so the stale picture outlived the fix.

## 0.1.2

Documentation only — no functional change, `src/` is untouched.

- The READMEs are rewritten in the shape the rest of this ecosystem uses:
  badges, a one-line pitch, then install, features, screenshots, other install
  routes, uninstall, troubleshooting and development, across eight emoji-headed
  sections. Both files are 89 lines; they were 230 and 269. The install command
  is still the first thing after the pitch.
- The engineering notes that had accumulated in the READMEs moved to
  `docs/design.md` — panel geometry and why a year is two six-month blocks, the
  four host-side invariants, the Codex provenance tables, the four deliberate
  deviations, and what each test suite covers. Nothing was deleted.
- Cross-file links are absolute GitHub URLs: relative links render on GitHub but
  resolve against npmjs.com on the package page, where they 404.
- Both screenshots are embedded, so `docs/panel-light.png` joins `files`.

## 0.1.1

Documentation, metadata and licence only — no functional change. `src/` and
`cordis.patch.yml` are byte-identical to 0.1.0.

- The install command gained the `--profile` flag it always needed. `dsh plugin`
  rejects a missing `--profile` — `error: required option '--profile <name>' not
  specified` — so the command 0.1.0 documented could not run. `--registry` is
  shown explicitly as well: the default registry in mainland China had not yet
  synced this scoped package when it was published.
- The READMEs lead with the install route and gained **Updates** and
  **Verifying the install** sections plus an "ask an agent to install it"
  prompt. Both languages carry the same nine sections; `tests/readme.test.mjs`
  enforces that, along with a check that every file the READMEs link or embed
  is listed in `files`.
- `engines.dsh` now declares the Host range this version was verified against,
  so the plugin market can show it on the card. The `@deepseek-ai/dsh-*` peers
  stay at `*` on purpose: the Host install gate checks those peers and ignores
  `optional`, so a permissive range there means a future Host never silently
  disables the plugin.
- The package description no longer advertises a context-occupancy readout the
  panel does not render.
- `LICENSE` holds the MIT text alone; the Codex provenance paragraph moved to
  `NOTICE`, which is why GitHub and licensee report **MIT** instead of
  `NOASSERTION`. `NOTICE` and `CHANGELOG.md` ship in the tarball.

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
