# tools

Reconnaissance scripts. They are not part of the plugin and nothing imports
them — they are kept because they are the evidence behind two claims the plugin
depends on, and because re-deriving them from scratch is tedious.

Run any of them with plain `node`; each reaches into `$DSH_HOME` (or
`%USERPROFILE%\.dsh`) on its own.

| Tool | What it establishes |
|---|---|
| `asar.mjs` | Reads the Electron `app.asar` container directly: `list <filter>` to find a path, `extract <prefix> <outDir>` to pull a package out. This is how the DSH packages referenced while writing the plugin were read, since the archive is not a directory and `read`/`glob` cannot open it. |
| `compare-decoders.mjs` | Decodes the same session log three ways — `zstdDecompressSync` on the whole buffer, magic-scan frame splitting, and a streaming `createZstdDecompress`. Proves that **both** built-in Node decoders stop at the first zstd frame and return a single 196-byte header line "successfully", which is why `src/host/session-log.ts` splits frames by hand. |
| `compare-versions.mjs` | Dumps every `session.v<N>` for a session side by side with frame, event, and `maxSeq` counts. This is how the truncated-rewrite bug was found: one session has a healthy 3563-event `v3` next to a 245-event `v4`. |
| `probe-sessions.mjs` | Event-type histogram per session, from the real decoder. |
| `dump-events.mjs` | One trimmed example of each event type. This is the reference for the field names the fold reads: `assistant/message` → `data.usage.{inputTokens,outputTokens,totalTokens,cacheReadTokens,reasoningTokens}`, and the `session` header's **top-level** `id` / `cwd` / `createdAt` (not under `data` — reading `header.data.cwd` is the bug that made the panel show `(unknown)`). |
| `probe-usage.mjs` | Counts `assistant/message` records that actually carry usage, across the largest logs. |
| `sample-shot.mjs` | Decodes a PNG with no dependency (IHDR/IDAT, inflate, per-scanline unfilter), so a colour can be measured instead of eyeballed. This is where `HEATMAP_RAMP` in `src/client/styles.ts` comes from — run it against a swatch of the graph whose palette you want. |
| `probe-client-bundles.mjs` | Shows how real client plugins (dsh-pet, dsh-market, dsh-codex-ui) wrap their bundle and which module ids they `require`, which is how this package's `window.__ModuleLoader__.load` wrapper was matched. |

None of these are covered by `npm test`. The tests that *are* run live in
`../tests/`.
