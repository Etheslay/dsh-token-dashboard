/**
 * Render a visual preview of the settings panel.
 *
 * The preview is deliberately faithful rather than illustrative:
 *
 *   - it renders the real `UsageView` component through the real React,
 *   - it feeds it a snapshot produced by the real Host fold over the real
 *     session store, and
 *   - it styles it with the actual DSH theme tokens lifted out of the shell
 *     bundle, under both `body` (light) and `body[data-ds-dark-theme]` (dark).
 *
 * That makes it a genuine check on how the panel looks inside the harness,
 * without editing the harness or restarting it.
 *
 * @module dsh-token-dashboard/scripts/preview
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { build } from 'esbuild'
import { SessionScanner } from '../src/host/scan.ts'
import { buildSnapshot } from '../src/host/aggregate.ts'
import { dayKeyInZone } from '../src/host/fold.ts'
import { resolveDshHome } from '../src/host/home.ts'
import { en } from '../src/client/locales.ts'
import { PANEL_CSS } from '../src/client/styles.ts'
import { markUrl } from '../src/client/nav-icon.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Bundle the TSX panel so Node can import it. */
async function loadPanel() {
  const cacheDir = path.join(root, 'node_modules', '.cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const outfile = path.join(cacheDir, 'dsh-tdd-panel.mjs')
  await build({
    entryPoints: [path.join(root, 'src/client/panel.tsx')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    jsx: 'automatic',
    external: ['react', 'react-dom'],
    logLevel: 'silent',
  })
  return import(pathToFileURL(outfile).href)
}

/**
 * Lift the DSH token definitions out of the theme plugin's browser bundle.
 *
 * They live in CSS templates inside the minified bundle, as a two-layer
 * cascade: `body{…}` rules carry the light palette and
 * `body[data-ds-dark-theme]{…}` rules override it. The dark layer is itself
 * split across two rules — one redefines the `--dsw-static-*` palette, a later
 * one rebinds the `--dsw-alias-*` names to it — so taking a single rule per
 * theme leaves alias names pointing at statics that were never redefined, and
 * the preview renders a light page wearing a dark ramp.
 *
 * Every token-bearing rule is therefore collected in document order, which
 * reproduces the real cascade instead of guessing at it.
 * @returns The CSS text and the bundle it came from.
 */
function dshThemeCss() {
  const candidates = [
    process.env.DSH_THEME_BUNDLE,
    path.join(root, '.reference/dsh-theme/client.js'),
  ].filter(Boolean)
  const bundle = candidates.find((candidate) => fs.existsSync(candidate))
  if (bundle === undefined) return undefined
  const text = fs.readFileSync(bundle, 'utf8')

  const rules = []
  for (const match of text.matchAll(/body(?:\[data-ds-dark-theme\])?\{/g)) {
    const start = match.index
    const end = text.indexOf('}', start)
    if (end < 0) continue
    const rule = text.slice(start, end + 1)
    if (rule.includes('--dsw-')) rules.push(rule)
  }
  const light = rules.filter((rule) => rule.startsWith('body{')).join('')
  const dark = rules.filter((rule) => rule.startsWith('body[data-ds-dark-theme]{')).join('')
  if (light.length === 0 || dark.length === 0) return undefined
  return { light, dark, source: bundle }
}

const { UsageView, makeTranslate } = await loadPanel()
const t = makeTranslate(en, en)

// --- real data --------------------------------------------------------------
const home = resolveDshHome()
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const scanner = new SessionScanner(path.join(home, 'sessions'))
const started = Date.now()
const { summaries, warnings } = scanner.read(timeZone)
const snapshot = buildSnapshot({
  summaries,
  timeZone,
  home,
  todayKey: dayKeyInZone(Date.now(), timeZone),
  warnings,
  elapsedMs: Date.now() - started,
})

const panel = renderToStaticMarkup(
  createElement(UsageView, {
    t,
    locale: 'en-GB',
    snapshot,
    loading: false,
    onRefresh: () => {},
  }),
)

const theme = dshThemeCss()

/** One settings nav row, mirroring the shell's markup closely enough to style. */
const navRow = (label, active) =>
  `<button type="button"${active ? ' data-active=""' : ''}${active ? ` data-dsh-token-dashboard-nav-icon=""` : ''}>` +
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor"/></svg>` +
  `<span>${label}</span></button>`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-token-dashboard — panel preview</title>
<style>
/* ---- real DSH theme tokens, lifted from the shell bundle ---- */
${theme?.light ?? 'body{--dsw-alias-bg-base:#fff;--dsw-alias-label-primary:#111;--dsw-alias-label-secondary:#666;--dsw-alias-border-l1:#e3e3e3;--dsw-alias-border-l2:#ccc;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f6f6;--dsw-alias-state-error-primary:#ec1313;--dsw-alias-state-warn-primary:#e8a33d;--dsw-specific-sidebar-fill:#f6f6f6}'}
${theme?.dark ?? 'body[data-ds-dark-theme]{--dsw-alias-bg-base:#151517;--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#9a9a9f;--dsw-alias-border-l1:#2c2c2f;--dsw-alias-border-l2:#3a3a3e;--dsw-alias-bg-layer-1:#1f1f22;--dsw-alias-bg-layer-2:#232326;--dsw-alias-state-error-primary:#f25a5a;--dsw-alias-state-warn-primary:#e8a33d;--dsw-specific-sidebar-fill:#1b1b1c}'}

/* ---- preview chrome ---- */
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font-family: -apple-system, "Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  -webkit-font-smoothing: antialiased;
}
.dialog {
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  gap: 0;
  height: 100vh;
  max-width: 1180px;
  margin: 0 auto;
  border-left: 1px solid var(--dsw-alias-border-l1);
  border-right: 1px solid var(--dsw-alias-border-l1);
}
nav {
  background: var(--dsw-specific-sidebar-fill);
  border-right: 1px solid var(--dsw-alias-border-l1);
  padding: 18px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
nav .navtitle {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  letter-spacing: .06em;
  text-transform: uppercase;
  padding: 0 10px 8px;
}
nav button {
  appearance: none; border: 0; background: transparent; cursor: default;
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px;
  display: flex; align-items: center; gap: 9px;
  padding: 6px 10px; border-radius: 7px; text-align: left; width: 100%;
}
nav button[data-active] { background: var(--dsw-alias-bg-layer-2); font-weight: 500; }
main { padding: 22px 26px 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; }
.hint {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  margin-top: 12px; padding: 8px 0 12px;
}
${PANEL_CSS}
${`[data-dsh-token-dashboard-nav-icon] > svg{display:none}[data-dsh-token-dashboard-nav-icon]::before{content:'';flex:none;width:16px;height:16px;background-color:currentColor;-webkit-mask-image:url("${markUrl()}");mask-image:url("${markUrl()}");-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:16px 16px;mask-size:16px 16px}`}
</style>
</head>
<body>
<div class="dialog">
  <nav>
    <div class="navtitle">Settings</div>
    ${navRow('General', false)}
    ${navRow('Models', false)}
    ${navRow('Plugins', false)}
    ${navRow(en.nav, true)}
    ${navRow('About', false)}
  </nav>
  <main>
    ${panel}
    <div class="hint">
      Live preview rendered from ${summaries.length} session logs in ${home} · theme tokens taken verbatim from the DSH shell.
    </div>
  </main>
</div>
</body>
</html>
`

const outDir = path.join(root, 'docs')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'panel.html')
fs.writeFileSync(outFile, html, 'utf8')

console.log(`preview: ${outFile}`)
console.log(`  sessions : ${summaries.length}`)
console.log(`  lifetime : ${snapshot.profile.lifetimeTokens.toLocaleString('en-US')} tokens`)
console.log(`  theme css: ${theme === undefined ? 'FALLBACK (shell bundle not found)' : path.basename(theme.source)}`)
console.log(`  html size: ${(html.length / 1024).toFixed(1)} KiB`)
