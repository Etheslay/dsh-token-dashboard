/**
 * Verify the SHIPPED bundle, not the source.
 *
 * The two-scrollbar fix only counts if the browser loading the installed package
 * sees it. That package is a copy inside the DSH profile, installed from a packed
 * tarball — so "I edited src/" proves nothing about what the app runs.
 *
 * This script mounts `lib/client.js` the way the shell does, captures the real
 * stylesheet the plugin appends to `document.head`, renders the real registered
 * section component with the fixture snapshot, and writes one self-contained
 * page. Run `check-panel-layout.mjs --html` against that page to measure what
 * users actually get.
 *
 * Usage:
 *   node tools/verify-built-panel.mjs <lib/client.js> <out.html>
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { FIXTURE_SNAPSHOT } from './panel-fixture.mjs'
import { en } from '../src/client/locales.ts'

const [, , bundleArg, outArg] = process.argv
if (bundleArg === undefined || outArg === undefined) {
  console.error('usage: node tools/verify-built-panel.mjs <lib/client.js> <out.html>')
  process.exit(2)
}
const root = path.resolve(import.meta.dirname, '..')
const require$ = createRequire(path.join(root, 'package.json'))

/** Everything the bundle touched, so the harness can prove it really ran. */
const seen = { effects: [], appended: [], injections: [], requires: [] }

// The bundle is a `window.__ModuleLoader__.load({ id, factory })` call, so hand
// it the loader it expects and keep what the factory exports.
let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded = { id: entry.id, exports: entry.factory(fakeRequire) }
    },
  },
}

/** The smallest `document` the mount path needs. */
globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild: (node) => seen.appended.push(node) },
  querySelector: () => null,
  querySelectorAll: () => [],
}
// Node already defines `navigator` (with `language`) as a getter-only global.

/** Enough of the shell's frozen module table for the plugin to mount. */
function fakeRequire(id) {
  seen.requires.push(id)
  if (id === 'react' || id === 'react/jsx-runtime') return require$(id)
  throw new Error(`unexpected require(${JSON.stringify(id)})`)
}

await import(pathToFileURL(path.resolve(bundleArg)).href)
if (loaded === undefined) throw new Error('the bundle never called window.__ModuleLoader__.load')

/**
 * Mount the way the shell does.
 *
 * `ctx.effect` is run immediately rather than recorded: that is what installs
 * the stylesheet, and the stylesheet is the whole point of this check.
 */
loaded.exports.apply({
  effect: (run) => {
    seen.effects.push(run())
  },
  locale: {
    register: () => ({}),
    bind: () => (key) => en[key] ?? key,
  },
  slots: {
    inject: (slot, register) => seen.injections.push({ slot, registered: register() }),
    register: (meta, component) => ({ meta, component }),
  },
})

if (seen.injections.length === 0) throw new Error('the plugin registered no slot')
const { meta, component } = seen.injections[0].registered
if (meta.name !== 'settings.section') throw new Error(`unexpected slot ${meta.name}`)

const injected = typeof meta.inject === 'function' ? meta.inject() : {}
const translate = typeof injected.t === 'function' ? injected.t : (key) => key
const style = seen.appended.map((node) => node.textContent).join('\n')
if (style.length === 0) throw new Error('the plugin appended no stylesheet')

// Render the pure view, not the registered section: the section fetches its own
// snapshot, which a static render has no way to satisfy.
const { UsageView } = loaded.exports
if (typeof UsageView !== 'function') throw new Error('the bundle does not export UsageView')

const { createElement } = require$('react')
const { renderToStaticMarkup } = require$('react-dom/server')
const panel = renderToStaticMarkup(
  createElement(UsageView, {
    t: translate,
    locale: 'en-GB',
    snapshot: FIXTURE_SNAPSHOT,
    loading: false,
    onRefresh: () => {},
  }),
)

const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>shipped bundle — panel layout</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #eee; background: #151517; font-size: 13px;
  --dsw-alias-bg-base: #151517; --dsw-alias-bg-layer-1: #1f1f22; --dsw-alias-bg-layer-2: #232326;
  --dsw-alias-label-primary: #eee; --dsw-alias-label-secondary: #9a9a9f;
  --dsw-alias-border-l1: #2c2c2f; --dsw-alias-border-l2: #3a3a3e;
  --dsw-alias-state-error-primary: #f25a5a; --dsw-alias-state-warn-primary: #e8a33d; }
/* The settings dialog: its own scroll body is the ONE scrollbar the panel may rely on. */
.dialog { width: min(1180px, 100%); height: 100vh; margin: 0 auto; display: flex; flex-direction: column;
  overflow: hidden; background: var(--dsw-alias-bg-layer-2); }
.dialog-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 22px; }
${style}
</style></head>
<body><div class="dialog"><div class="dialog-scroll">${panel}</div></div></body>
</html>
`

const out = path.resolve(outArg)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, html, 'utf8')

console.log(`bundle   : ${path.resolve(bundleArg)}`)
console.log(`id       : ${loaded.id}`)
console.log(`requires : ${[...new Set(seen.requires)].join(', ')}`)
console.log(`effects  : ${seen.effects.length} run`)
console.log(`style    : ${style.length} bytes, taken from the plugin's own <style>`)

/**
 * The stylesheet invariants this script exists to prove, split by direction:
 * the scroll-container patterns must be GONE from the shipped CSS and the
 * derived-geometry tokens must be IN it. Printing a table without asserting it
 * was the bug — three of the five rows were rules that had been deliberately
 * deleted, so the table could never read all-PRESENT and never failed.
 */
const ABSENT = [
  ['max-width:660px', 'a fixed heatmap ceiling'],
  ['overflow-y:auto', 'a panel-owned vertical scrollbar'],
  ['overflow:auto', 'a panel-owned scroll container'],
  ['height:100%', 'a fixed panel height'],
  ['overflow-x:hidden', 'a clip guard that coerces overflow-y to auto'],
]
const PRESENT = [
  ['--tdd-heat-columns', 'the derived column count'],
  ['min(100%,calc(', 'the derived grid width'],
  ['grid-auto-flow:column', 'column-major cell fill'],
]

let failed = 0
for (const [token, why] of ABSENT) {
  const found = style.includes(token)
  if (found) failed++
  console.log(`  ${found ? 'FAIL' : 'ok  '} absent   ${token.padEnd(18)} (${why})`)
}
for (const [token, why] of PRESENT) {
  const found = style.includes(token)
  if (!found) failed++
  console.log(`  ${found ? 'ok  ' : 'FAIL'} present  ${token.padEnd(18)} (${why})`)
}

// The panel must also be in the rendered markup, not just the stylesheet: a
// bundle that mounts and then renders nothing would pass every check above.
if (!html.includes('tdd-heat-grid')) {
  failed++
  console.log('  FAIL rendered  the fixture snapshot produced no heatmap grid')
} else {
  console.log('  ok   rendered  heatmap grid present in the shipped render')
}
console.log(`html     : ${out}`)
if (failed > 0) {
  console.error(`\nverify-built-panel: ${failed} check(s) FAILED — the shipped bundle does not carry the fix`)
  process.exit(1)
}
console.log('\nverify-built-panel: the shipped bundle carries every invariant')
