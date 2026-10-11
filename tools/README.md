# tools

Reconnaissance scripts. They are not part of the plugin and nothing imports
them — they are kept because they are the evidence behind two claims the plugin
depends on, and because re-deriving them from scratch is tedious.

Run any of them with plain `node`; each resolves the session store the way the
plugin does — `$DSH_HOME` when it names a directory, otherwise `~/.dsh` — through
`session-store.mjs`. `asar.mjs` takes `DSH_ASAR`, and `probe-client-bundles.mjs`
takes `DSH_PROFILE_DIR`, because those point outside the session store.

| Tool | What it establishes |
|---|---|
| `session-store.mjs` | Not a tool: the shared resolver (`$DSH_HOME` → `~/.dsh`), the recursive log walker, and the argument validation every probe below uses. It exists so the path rule and the walker have one definition instead of six. |
| `asar.mjs` | Reads the Electron `app.asar` container directly: `list <filter>` to find a path, `extract <prefix> <outDir>` to pull a package out. This is how the DSH packages referenced while writing the plugin were read, since the archive is not a directory and `read`/`glob` cannot open it. Entries flagged `unpacked` are copied from the sibling `app.asar.unpacked/` directory — they have no offset inside the archive. |
| `compare-decoders.mjs` | Decodes the same session log three ways — `zstdDecompressSync` on the whole buffer, magic-scan frame splitting, and a streaming `createZstdDecompress`. Proves that **both** built-in Node decoders stop at the first zstd frame and return a single 196-byte header line "successfully", which is why `src/host/session-log.ts` splits frames by hand. |
| `compare-versions.mjs` | Dumps every `session.v<N>` for a session side by side with frame, event, and `maxSeq` counts. This is how the truncated-rewrite bug was found: one session has a healthy 3563-event `v3` next to a 245-event `v4`. |
| `probe-sessions.mjs` | Event-type histogram per session, from the plugin's own frame-splitting decoder — `zstdDecompressSync` on the whole file reports one line and zero usage events, which is the mistake this tool exists to make visible. |
| `dump-events.mjs` | One trimmed example of each event type. This is the reference for the field names the fold reads: `assistant/message` → `data.usage.{inputTokens,outputTokens,totalTokens,cacheReadTokens,reasoningTokens}`, and the `session` header's **top-level** `id` / `cwd` / `createdAt` (not under `data` — reading `header.data.cwd` is the bug that made the panel show `(unknown)`). Header fields are dumped under a `header` key so that top-level shape is visible. |
| `probe-usage.mjs` | Counts `assistant/message` records that actually carry usage, across the largest logs. |
| `sample-shot.mjs` | Decodes a PNG with no dependency (IHDR/IDAT, inflate, per-scanline unfilter), so a colour can be measured instead of eyeballed. This is where `HEATMAP_RAMP` in `src/client/styles.ts` comes from — run it against a swatch of the graph whose palette you want. |
| `probe-client-bundles.mjs` | Shows how real client plugins (dsh-pet, dsh-market, dsh-codex-ui) wrap their bundle and which module ids they `require`, which is how this package's `window.__ModuleLoader__.load` wrapper was matched. |
| `check-panel-layout.mjs` (+ `panel-fixture.mjs`) | Renders the real panel through the real React in headless Chrome and asserts its **geometry** at several widths: one scrollbar and not two, the heatmap flush with the blocks above and below it, square cells of one size across both blocks, and every month label sitting on the track it names. |
| `verify-built-panel.mjs` | Mounts the **built** `lib/client.js` the way the shell does, captures the stylesheet it actually appends to `document.head`, and writes one self-contained page for `check-panel-layout.mjs --html`. This is the check that the fix reached the artifact, not just the source. |
| `refresh-profile.mjs` | Repacks this package and re-extracts it into a DSH profile's `node_modules`, which is the copy the app loads. |

## Editing source is not the same as changing the app

A profile installs this package from a packed tarball
(`"@etheslay/dsh-token-dashboard": "file:./etheslay-dsh-token-dashboard-0.1.0.tgz"`),
so the app loads `<profile>/node_modules/@etheslay/dsh-token-dashboard/` — its own
copy, not this checkout. A source fix stays invisible until the tarball is repacked
and re-extracted. That is exactly how a fixed double scrollbar kept showing up in
the panel: `src/client/styles.ts` no longer had the offending rule, and the
installed `lib/client.js` still did.

(npm names a scoped package's tarball after the scope and name with the `@` and
`/` flattened, which is why the file is `etheslay-dsh-token-dashboard-*.tgz`.)

```sh
npm run refresh:profile              # repack + reinstall into the desktop profile
npm run refresh:profile -- --profile web --dry-run
```

Then reload the page in DSH. A change to the **host** half additionally needs a
DSH restart, because a replaced ES module stays cached in the Node process.

To skip repacking altogether, point the profile at the checkout instead of the
tarball — `lib/` is then live:

```json
"@etheslay/dsh-token-dashboard": "file:D:/dsh-token-dashboard"
```

`refresh-profile.mjs` refuses that setup on purpose (the spec has to name a
`.tgz`): the directory name would otherwise be read as a tarball name, a stray
extensionless file would land in the profile, and the live link would be replaced
by a frozen extraction.

## check-panel-layout.mjs

Two of this panel's defects were invisible to both code review and the test
suite, because they only exist once a browser has resolved the grid, the flex
column and the settings dialog's own scroll geometry:

- the dialog showed **two scrollbars**, because the panel carried
  `height:100%; overflow-y:auto` inside a host that already scrolls; and
- the heatmap stopped at a hard-coded `max-width:660px` while the five-number bar
  and the footer ran to the panel's edge, so the graph did not line up with the
  blocks around it.

So this tool asserts measured pixels instead of markup. It needs a Chrome or Edge
binary — pass `--chrome <path>` or set `CHROME_PATH` if it is somewhere unusual.

```sh
npm run check:layout                                      # the fixed-data fixture
node tools/check-panel-layout.mjs --widths 560,720,1000    # chosen widths
node tools/check-panel-layout.mjs --days 344               # a different year length
node tools/check-panel-layout.mjs --html docs/panel.html   # real data + real DSH tokens
node tools/check-panel-layout.mjs --html docs/panel.html --widths 1180 --theme dark --bare --shot panel.png
```

`--days` picks the fixture's heatmap window length. It is worth varying, because
the window decides whether the year halves evenly: an even week count gives two
equal blocks, an odd one leaves a block a column short and it has to be padded.
Both cases have to render both rows at the same width — that is the check for the
"the lower table is missing a column" defect.

The fixture's dialog body mirrors the shell's own scroll rule (`overflow:auto`),
so a panel that starts scrolling itself shows up here as the second scrollbar it
would be in the harness — this is the regression gate for exactly that.

Measured against the built artifact:

```sh
node tools/verify-built-panel.mjs ~/.dsh/profiles/desktop/node_modules/@etheslay/dsh-token-dashboard/lib/client.js shipped.html
node tools/check-panel-layout.mjs --html shipped.html
```

None of these are covered by `npm test`. The tests that *are* run live in
`../tests/`.
