/**
 * Codex-fidelity render tests.
 *
 * These render {@link UsageView} from a fixed snapshot and assert the exact
 * strings Codex would print. They are the guard against the panel quietly
 * drifting away from the spec: every number here was taken from the Rust
 * function named beside it, not from this implementation's own output.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { build } from 'esbuild'
import {
  barGlyph,
  compactAmount,
  countValue,
  formatAbsoluteTime,
  formatContextWindow,
  formatDuration,
  formatLimitSummary,
  formatTokensCompact,
  percentOfContextWindowRemaining,
  renderLimitProgressBar,
  CODEX_BASELINE_TOKENS,
} from '../src/shared/format.ts'

// The panel is TSX, which Node's type stripping cannot load, so bundle it once
// with React left external. This also proves the component compiles under the
// same JSX settings the shipped bundle uses. The bundle has to live inside the
// package so its bare `react` imports still resolve.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, 'node_modules', '.cache')
fs.mkdirSync(cacheDir, { recursive: true })
const panelBundle = path.join(cacheDir, 'dsh-tdd-panel.mjs')
await build({
  entryPoints: [path.join(root, 'src/client/panel.tsx')],
  outfile: panelBundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  jsx: 'automatic',
  external: ['react', 'react-dom'],
  logLevel: 'silent',
})
const { UsageView, makeTranslate } = await import(pathToFileURL(panelBundle).href)
const { en, zh } = await import('../src/client/locales.ts')

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures++
    console.log(`  FAIL ${name}\n       ${error.message.split('\n')[0]}`)
  }
}

const t = makeTranslate(en, en)

// ---------------------------------------------------------------------------
// format_tokens_compact — tui/src/status/helpers.rs
// ---------------------------------------------------------------------------
check('formatTokensCompact: the 0 / <1000 / K / M / B / T decision tree', () => {
  assert.equal(formatTokensCompact(0), '0')
  assert.equal(formatTokensCompact(1), '1')
  assert.equal(formatTokensCompact(999), '999')
  assert.equal(formatTokensCompact(1000), '1K')
  assert.equal(formatTokensCompact(1200), '1.2K')
  assert.equal(formatTokensCompact(12350), '12.4K')
  // `128_500 / 1000` is exactly 128.5, and Rust's `{:.0}` rounds half to EVEN,
  // so this is 128K. JavaScript's toFixed would say 129 — see fixedHalfEven.
  assert.equal(formatTokensCompact(128500), '128K')
  assert.equal(formatTokensCompact(129500), '130K')
  assert.equal(formatTokensCompact(1003), '1K')
  assert.equal(formatTokensCompact(1000000), '1M')
  // Above 100 the status-card rule keeps ZERO decimals, so 142.3B collapses to
  // 142B here. `compact_amount` is the analytics variant that keeps one.
  assert.equal(formatTokensCompact(142300000000), '142B')
  assert.equal(formatTokensCompact(2500000000000), '2.5T')
  assert.equal(formatTokensCompact(-5), '0', 'negatives clamp like value.max(0)')
})

check('formatTokensCompact and compactAmount differ only in their decimals rule', () => {
  // Same magnitude, two rules: the card drops decimals above 100, the headline
  // never does. Mixing them up is the easiest way to look wrong next to Codex.
  assert.equal(formatTokensCompact(142300000000), '142B')
  assert.equal(compactAmount(142300000000), '142.3B')
  assert.equal(formatTokensCompact(128500), '128K')
  assert.equal(compactAmount(128500), '128.5K')
})

check('formatTokensCompact: trailing zeros are stripped (2/<10, 1/<100, 0/else)', () => {
  // Rust prints `{scaled:.decimals$}` then pops trailing '0' and a trailing '.'.
  assert.equal(formatTokensCompact(1050), '1.05K')
  assert.equal(formatTokensCompact(1001), '1K')
  assert.equal(formatTokensCompact(999999), '1000K', 'rounds up without promoting the unit')
  assert.equal(formatTokensCompact(999999999), '1000M')
})

// ---------------------------------------------------------------------------
// compact_amount / count_value / duration — tui/src/analytics/*
// ---------------------------------------------------------------------------
check('compactAmount: one decimal, promoting before it would print 1000K', () => {
  assert.equal(compactAmount(0), '0')
  assert.equal(compactAmount(999), '999')
  assert.equal(compactAmount(1000), '1K')
  assert.equal(compactAmount(7100), '7.1K')
  assert.equal(compactAmount(142300000000), '142.3B')
  // 999_950 / 1000 = 999.95, which would render as "1000K"; it promotes to M.
  assert.equal(compactAmount(999950), '1M')
})

check('countValue: manual grouping with an em dash for absent values', () => {
  assert.equal(countValue(0), '0')
  assert.equal(countValue(999), '999')
  assert.equal(countValue(1000), '1,000')
  assert.equal(countValue(1234567), '1,234,567')
  assert.equal(countValue(undefined), '\u2014')
})

check('formatDuration: the (h, m) match arms', () => {
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(45), '45s')
  assert.equal(formatDuration(90), '1m')
  assert.equal(formatDuration(3600), '1h')
  assert.equal(formatDuration(3870), '1h 4m')
  assert.equal(formatDuration(158820), '44h 7m')
})

// ---------------------------------------------------------------------------
// the progress bar — tui/src/status/rate_limits.rs
// ---------------------------------------------------------------------------
check('renderLimitProgressBar: 20 cells, round-half-away, brackets included', () => {
  assert.equal(renderLimitProgressBar(100), `[${'\u2588'.repeat(20)}]`)
  assert.equal(renderLimitProgressBar(0), `[${'\u2591'.repeat(20)}]`)
  assert.equal(renderLimitProgressBar(50), `[${'\u2588'.repeat(10)}${'\u2591'.repeat(10)}]`)
  assert.equal(renderLimitProgressBar(40), `[${'\u2588'.repeat(8)}${'\u2591'.repeat(12)}]`)
  for (const pct of [0, 1, 7, 33, 62, 99, 100, -5, 250]) {
    assert.equal(renderLimitProgressBar(pct).length, 22, `bar width at ${pct}% must be 22 characters`)
  }
  assert.equal(formatLimitSummary(40), '40% left')
  assert.equal(formatLimitSummary(62.4), '62% left', 'zero decimals, as in format!("{:.0}% left")')
})

// ---------------------------------------------------------------------------
// context occupancy — tui/src/token_usage.rs
// ---------------------------------------------------------------------------
check('percentOfContextWindowRemaining: remaining, zero decimals, clamped', () => {
  assert.equal(percentOfContextWindowRemaining(0, 272000), 100)
  assert.equal(percentOfContextWindowRemaining(272000, 272000), 0)
  assert.equal(percentOfContextWindowRemaining(136000, 272000), 50)
  assert.equal(percentOfContextWindowRemaining(999999, 272000), 0, 'over-full still reports 0, never negative')
  assert.equal(percentOfContextWindowRemaining(1000, 0), 0, 'no window means no percentage')
})

check('the 12K baseline is opt-in and off by default', () => {
  // Raw: 84K used of 272K leaves 188K, which is 69% of the window.
  assert.equal(percentOfContextWindowRemaining(84000, 272000), 69)
  // With Codex's own baseline the number changes, which is exactly why it is
  // not applied by default to DSH data.
  const codex = percentOfContextWindowRemaining(84000, 272000, { baselineTokens: CODEX_BASELINE_TOKENS })
  assert.equal(codex, 72, 'the 12K baseline shifts the ratio; Codex-only, so opt-in')
  assert.notEqual(codex, 69)
  // 103_200 / 1_000_000 is 103.2, and the zero-decimal rule above 100 gives 103K.
  assert.equal(formatContextWindow(103200, 1000000), '90% left (103K used / 1M)')
})

// ---------------------------------------------------------------------------
// reset timestamps — tui/src/status/helpers.rs
// ---------------------------------------------------------------------------
check('formatAbsoluteTime: absolute clock time, "on {d Mon}" across days', () => {
  const reference = new Date(2026, 4, 7, 12, 0, 0)
  assert.equal(formatAbsoluteTime(new Date(2026, 4, 7, 9, 25), reference, 'en-GB'), '09:25')
  assert.equal(formatAbsoluteTime(new Date(2026, 4, 8, 7, 8), reference, 'en-GB'), '07:08 on 8 May')
})

// ---------------------------------------------------------------------------
// the activity ramp — tui/src/analytics/plot/painting.rs
// ---------------------------------------------------------------------------
check('barGlyph: maps onto the 8-step ramp and never returns the blank cell', () => {
  assert.equal(barGlyph(0, 100), ' ', 'no activity is the blank cell')
  assert.equal(barGlyph(100, 100), '\u2588', 'the maximum is the full block')
  assert.equal(barGlyph(50, 0), ' ', 'a zero maximum cannot divide')
  const mid = barGlyph(50, 100)
  assert.ok('\u2581\u2582\u2583\u2584\u2585\u2586\u2587'.includes(mid), 'a mid value is an intermediate block')
})

// ---------------------------------------------------------------------------
// the card itself
// ---------------------------------------------------------------------------
const buckets = (uncached, output, cacheRead = 0, cacheWrite = 0, reasoning = 0) => ({
  uncachedInputTokens: uncached,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
  reasoningTokens: reasoning,
  totalTokens: uncached + output + cacheRead + cacheWrite,
})

const snapshot = {
  generatedAt: new Date(2026, 4, 7, 9, 25).getTime(),
  elapsedMs: 812,
  home: 'C:\\\\Users\\\\wu\\\\.dsh',
  timeZone: 'Asia/Shanghai',
  range: { kind: '30d' },
  totals: { ...buckets(2020422, 2380120, 529201664, 0, 41000), sessions: 7, turns: 348, responses: 2401 },
  previous: { ...buckets(1000000, 1000000), sessions: 5 },
  days: [
    { date: '2026-05-05', turns: 3, responses: 20, ...buckets(1000, 500) },
    { date: '2026-05-06', turns: 5, responses: 40, ...buckets(90000000, 600000) },
    { date: '2026-05-07', turns: 2, responses: 11, ...buckets(20000, 9000) },
  ],
  models: [
    { provider: 'deepseek-official', model: 'deepseek-flash', responses: 2300, ...buckets(2020422, 2380120, 529201664) },
    { provider: 'deepseek-official', model: 'deepseek-reasoner', responses: 101, ...buckets(40000, 90000) },
  ],
  workspaces: [
    { cwd: 'D:\\\\dsh-token-dashboard', name: 'dsh-token-dashboard', sessions: 4, ...buckets(2020422, 2380120, 529201664) },
  ],
  sessions: [
    {
      id: 'session-07ee0b86',
      title: 'Build the usage panel',
      cwd: 'D:\\\\dsh-token-dashboard',
      createdAt: new Date(2026, 4, 7, 8, 0).getTime(),
      updatedAt: new Date(2026, 4, 7, 9, 20).getTime(),
      turns: 12,
      responses: 61,
      routes: [{ provider: 'deepseek-official', model: 'deepseek-flash', responses: 61, ...buckets(1000, 2000) }],
      context: { tokensInContext: 103200, window: 1000000 },
      current: true,
      ...buckets(1000, 2000),
    },
  ],
  cache: { readTokens: 529201664, writeTokens: 0, promptTokens: 531222086, hitRate: 99.6 },
  allTime: { ...buckets(2020422, 2380120, 529201664), sessions: 20 },
  profile: {
    lifetimeTokens: 533603009,
    peakDailyTokens: 163512331,
    peakDay: '2026-05-06',
    longestTurnSeconds: 2033.084,
    currentStreakDays: 3,
    longestStreakDays: 5,
    sessions: 20,
    turns: 348,
    activeDays: 10,
  },
  warnings: [],
}

const markup = renderToStaticMarkup(
  createElement(UsageView, {
    t,
    locale: 'en-GB',
    snapshot,
    range: '30d',
    loading: false,
    onRangeChange: () => {},
    onRefresh: () => {},
  }),
)

/** Strip tags so the assertions read like the rendered page. */
const text = markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

check('the card renders Codex\'s "{total} total ({input} input + {output} output)"', () => {
  const blended = 2020422 + 2380120
  assert.ok(
    text.includes(`${formatTokensCompact(blended)} total`),
    `expected "${formatTokensCompact(blended)} total" in: ${text.slice(0, 400)}`,
  )
  assert.ok(text.includes('input +'), 'the input/output parenthetical must be present')
  assert.ok(text.includes('output)'), 'the parenthetical must close')
})

check('the context row renders a 22-character bar and "{pct}% left"', () => {
  const bar = renderLimitProgressBar(percentOfContextWindowRemaining(103200, 1000000))
  assert.ok(text.includes(bar), 'the bar must appear verbatim in the value column')
  assert.ok(text.includes('90% left'), 'context occupancy must be reported as remaining')
  assert.ok(text.includes('103K used / 1M'), 'the dim parenthetical must use compact units')
})

check('the five Codex Overview headline fields are present', () => {
  for (const label of ['Lifetime tokens', 'Peak tokens', 'Longest chat', 'Current streak', 'Longest streak']) {
    assert.ok(text.includes(label), `missing headline field: ${label}`)
  }
  assert.ok(text.includes(compactAmount(533603009)), 'the lifetime figure must use compact_amount')
  assert.ok(text.includes(formatDuration(2033.084)), 'the longest chat must use duration()')
  assert.ok(text.includes('3 days') && text.includes('5 days'), 'streaks render as "{n} days"')
})

check('the range control and freshness stamp are wired', () => {
  for (const label of ['Today', '7d', '30d', 'All']) assert.ok(text.includes(label), `missing range: ${label}`)
  assert.ok(text.includes('updated 09:25'), 'the freshness stamp is an absolute clock time')
  assert.ok(text.includes('scan took 812 ms'), 'the scan duration is surfaced')
})

check('a warning row appears only when the Host reports one', () => {
  const clean = renderToStaticMarkup(
    createElement(UsageView, { t, snapshot, range: '30d', loading: false, onRangeChange: () => {}, onRefresh: () => {} }),
  )
  assert.ok(!clean.includes('Warnings'), 'no warnings must render no section')
  const noisy = renderToStaticMarkup(
    createElement(UsageView, {
      t,
      snapshot: { ...snapshot, warnings: ['session-x: newest log version has 2 undecodable frame(s)'] },
      range: '30d',
      loading: false,
      onRangeChange: () => {},
      onRefresh: () => {},
    }),
  )
  assert.ok(noisy.includes('Warnings'), 'a warning must render its section')
})

check('the empty and error states render without a snapshot', () => {
  const loadingView = renderToStaticMarkup(
    createElement(UsageView, { t, range: '30d', loading: true, onRangeChange: () => {}, onRefresh: () => {} }),
  )
  assert.ok(loadingView.includes('Measuring'), 'the loading state must render')
  const errorView = renderToStaticMarkup(
    createElement(UsageView, { t, range: '30d', loading: false, error: 'HTTP 503', onRangeChange: () => {}, onRefresh: () => {} }),
  )
  assert.ok(errorView.includes('Usage data unavailable'), 'the error state must render')
  assert.ok(errorView.includes('HTTP 503'), 'the error text must be shown')
})

check('the Chinese dictionary renders the same structure', () => {
  const zhT = makeTranslate(zh, en)
  const zhMarkup = renderToStaticMarkup(
    createElement(UsageView, { t: zhT, snapshot, range: '30d', loading: false, onRangeChange: () => {}, onRefresh: () => {} }),
  )
  assert.ok(zhMarkup.includes('用量统计'), 'the Chinese title must render')
  assert.ok(zhMarkup.includes('累计 token'), 'the Chinese headline label must render')
  // The numbers are language-independent.
  assert.ok(zhMarkup.includes(renderLimitProgressBar(90)), 'the bar is identical across languages')
})

check('every dictionary key the panel asks for exists in both languages', () => {
  for (const key of Object.keys(en)) {
    assert.ok(typeof zh[key] === 'string' && zh[key].length > 0, `zh is missing the key "${key}"`)
    assert.ok(en[key].length > 0, `en is missing the value for "${key}"`)
  }
})

// A key with no dictionary entry falls back to the key itself, which is how a
// gap shows up on screen. Only keys whose English copy differs from the key
// name can be detected this way, so compare whole text nodes, not substrings —
// "By model" legitimately contains the word "model".
check('no untranslated locale key reaches the rendered panel', () => {
  const nodes = [...markup.matchAll(/>([^<>]+)</g)].map((match) => match[1].trim())
  for (const key of Object.keys(en)) {
    if (en[key] === key) continue
    assert.ok(!nodes.includes(key), `the untranslated key "${key}" was rendered as a text node`)
  }
  assert.ok(nodes.length > 10, 'the panel must render a meaningful number of text nodes')
})

console.log(failures === 0 ? '\nrender: all checks passed' : `\nrender: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
