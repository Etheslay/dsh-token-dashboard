/**
 * Panel fidelity tests.
 *
 * These render {@link UsageView} from a fixed snapshot and assert the exact
 * strings the reference panel prints. They are the guard against the panel
 * quietly drifting: every expected number here was taken from the Rust source
 * (for the formatting rules) or from the reference screenshots (for the
 * localized units), not from this implementation's own output.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { build } from 'esbuild'
import {
  compactAmount,
  countValue,
  formatAbsoluteTime,
  formatDuration,
  formatTokensCompact,
  localeCompact,
  localeCount,
  localeDuration,
  percentOfContextWindowRemaining,
  renderLimitProgressBar,
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
const { UsageView, makeTranslate, buildHeatmap, labelMonths } = await import(pathToFileURL(panelBundle).href)
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
// The formatting rules these layouts depend on.
// ---------------------------------------------------------------------------
check('formatTokensCompact: the 0 / <1000 / K / M / B / T decision tree', () => {
  assert.equal(formatTokensCompact(0), '0')
  assert.equal(formatTokensCompact(999), '999')
  assert.equal(formatTokensCompact(1200), '1.2K')
  assert.equal(formatTokensCompact(12350), '12.4K')
  // 128_500 / 1000 is exactly 128.5 and Rust's `{:.0}` rounds half to EVEN.
  assert.equal(formatTokensCompact(128500), '128K')
  assert.equal(formatTokensCompact(129500), '130K')
  assert.equal(formatTokensCompact(-5), '0', 'negatives clamp like value.max(0)')
})

check('compactAmount keeps one decimal where the card rule drops it', () => {
  assert.equal(compactAmount(142300000000), '142.3B')
  assert.equal(formatTokensCompact(142300000000), '142B')
  // 999_950 / 1000 would print "1000K"; the unit promotes first.
  assert.equal(compactAmount(999950), '1M')
})

check('countValue groups digits and renders an em dash when absent', () => {
  assert.equal(countValue(1234567), '1,234,567')
  assert.equal(countValue(undefined), '\u2014')
})

check('formatDuration follows the Rust (hours, minutes) match arms', () => {
  assert.equal(formatDuration(45), '45s')
  assert.equal(formatDuration(90), '1m')
  assert.equal(formatDuration(3600), '1h')
  assert.equal(formatDuration(158820), '44h 7m')
})

check('the Codex progress bar stays available and 22 cells wide', () => {
  assert.equal(renderLimitProgressBar(100), `[${'\u2588'.repeat(20)}]`)
  assert.equal(renderLimitProgressBar(0), `[${'\u2591'.repeat(20)}]`)
  for (const pct of [0, 7, 62, 100]) assert.equal(renderLimitProgressBar(pct).length, 22)
})

check('percentOfContextWindowRemaining reports remaining, not used', () => {
  assert.equal(percentOfContextWindowRemaining(0, 272000), 100)
  assert.equal(percentOfContextWindowRemaining(272000, 272000), 0)
  assert.equal(percentOfContextWindowRemaining(136000, 272000), 50)
})

check('formatAbsoluteTime is an absolute clock time, never a countdown', () => {
  const reference = new Date(2026, 4, 7, 12, 0, 0)
  assert.equal(formatAbsoluteTime(new Date(2026, 4, 7, 9, 25), reference, 'en-GB'), '09:25')
  assert.equal(formatAbsoluteTime(new Date(2026, 4, 8, 7, 8), reference, 'en-GB'), '07:08 on 8 May')
})

// ---------------------------------------------------------------------------
// Localized units. These are the values the Chinese reference panel prints, so
// they are the one place a pure English port would have been wrong.
// ---------------------------------------------------------------------------
check('localeCompact prints 万 / 亿 for Chinese and K / M for English', () => {
  // 3.7亿 and 5317.1万 are read straight off the reference screenshots.
  assert.equal(localeCompact(370_000_000, 'zh-CN'), '3.7\u4ebf')
  assert.equal(localeCompact(53_171_000, 'zh-CN'), '5317.1\u4e07')
  assert.equal(localeCompact(8_600, 'zh-CN'), '8600', 'below 万 it stays a plain count')
  assert.equal(localeCompact(100_000_000, 'zh-CN'), '1\u4ebf', 'trailing zeros are stripped')
  assert.equal(localeCompact(370_000_000, 'en-US'), '370M')
  assert.equal(localeCompact(53_171_000, 'en-US'), '53.2M')
})

check('localeDuration prints 46分59秒 for Chinese', () => {
  // 46 * 60 + 59, the value the reference panel shows.
  assert.equal(localeDuration(2819, 'zh-CN'), '46\u520659\u79d2')
  assert.equal(localeDuration(2819, 'en-US'), '46m')
  assert.equal(localeDuration(3600 + 180, 'zh-CN'), '1\u5c0f\u65f63\u5206')
  assert.equal(localeDuration(45, 'zh-CN'), '45\u79d2')
})

check('localeCount follows the same unit split', () => {
  assert.equal(localeCount(1234567, 'en-US'), '1,234,567')
  assert.equal(localeCount(1234567, 'zh-CN'), '123.5\u4e07', '1.23M is 123.5万, not yet an 亿')
  assert.equal(localeCount(123456789, 'zh-CN'), '1.2\u4ebf')
  assert.equal(localeCount(undefined, 'zh-CN'), '\u2014')
})

// ---------------------------------------------------------------------------
// The panel itself.
// ---------------------------------------------------------------------------
const buckets = (uncached, output, cacheRead = 0, reasoning = 0) => ({
  uncachedInputTokens: uncached,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: 0,
  reasoningTokens: reasoning,
  totalTokens: uncached + output + cacheRead,
})

/** A day key `offset` days before `2026-05-07`. */
const dayKey = (offset) => new Date(Date.UTC(2026, 4, 7) - offset * 86_400_000).toISOString().slice(0, 10)

const snapshot = {
  generatedAt: new Date(2026, 4, 7, 9, 25).getTime(),
  elapsedMs: 812,
  home: 'C:\\\\Users\\\\wu\\\\.dsh',
  timeZone: 'Asia/Shanghai',
  agentPreset: 'cordis',
  identity: { name: 'Etheslay', handle: '@etheslay', avatarUrl: 'https://example.invalid/a.png' },
  totals: { ...buckets(2_075_755, 2_435_802, 563_335_040, 41_000), sessions: 15, turns: 84, responses: 2501 },
  days: [
    { date: dayKey(40), turns: 3, responses: 20, ...buckets(1000, 500) },
    { date: dayKey(2), turns: 5, responses: 40, ...buckets(900_000_000, 600_000) },
    { date: dayKey(1), turns: 2, responses: 11, ...buckets(20_000, 9_000) },
    { date: dayKey(0), turns: 4, responses: 30, ...buckets(120_000, 44_000) },
  ],
  heatmap: { from: '2025-11-01', to: dayKey(0) },
  models: [
    { provider: 'deepseek-official', model: 'deepseek-flash', responses: 2400, ...buckets(2_075_755, 2_435_802, 563_335_040) },
    { provider: 'deepseek-official', model: 'deepseek-v4-pro', responses: 101, ...buckets(40_000, 90_000) },
  ],
  workspaces: [
    { cwd: 'D:\\\\dsh-token-dashboard', name: 'dsh-token-dashboard', sessions: 4, ...buckets(1000, 2000) },
  ],
  sessions: [],
  cache: { readTokens: 563_335_040, writeTokens: 0, promptTokens: 565_410_795, hitRate: 99.63 },
  profile: {
    lifetimeTokens: 617_600_000,
    peakDailyTokens: 53_171_000,
    peakDay: dayKey(2),
    longestTurnSeconds: 2819,
    currentStreakDays: 2,
    longestStreakDays: 5,
    sessions: 15,
    turns: 84,
    activeDays: 11,
  },
  insights: {
    reasoning: [
      { label: 'high', count: 18, share: 72.5 },
      { label: 'max', count: 5, share: 27.5 },
    ],
    skillsExplored: 8,
    skillsTotal: 10,
    topSkills: [
      { name: 'remotion-best-practices', runs: 2 },
      { name: 'brainstorming', runs: 1 },
    ],
    models: [
      { label: 'deepseek-flash', count: 617_500_000, share: 99.9 },
      { label: 'deepseek-v4-pro', count: 130_000, share: 0.1 },
    ],
  },
  warnings: [],
}

const render = (props) =>
  renderToStaticMarkup(createElement(UsageView, { t, snapshot, loading: false, onRefresh: () => {}, ...props }))
const markup = render({ locale: 'en-GB' })
const text = markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

check('the five-cell stat bar carries the reference labels', () => {
  for (const label of ['Lifetime tokens', 'Peak tokens', 'Longest chat', 'Longest streak', 'Current streak']) {
    assert.ok(text.includes(label), `missing stat: ${label}`)
  }
  assert.ok(text.includes(compactAmount(617_600_000)), 'lifetime must use the one-decimal rule')
  assert.ok(text.includes(formatDuration(2819)), 'longest chat must use duration()')
  assert.ok(text.includes('5 days') && text.includes('2 days'), 'streaks render as "{n} days"')
  assert.ok(!text.includes('1 days'), 'a singular streak must not read "1 days"')
})

check('the identity block renders avatar, name and handle', () => {
  assert.ok(markup.includes('src="https://example.invalid/a.png"'), 'the avatar image must be used')
  assert.ok(text.includes('Etheslay'), 'the display name must render')
  assert.ok(text.includes('@etheslay'), 'the handle must render')
})

check('the identity block disappears when no account is available', () => {
  const bare = render({ snapshot: { ...snapshot, identity: undefined } })
  assert.ok(!bare.includes('tdd-avatar'), 'no identity means no avatar element')
})

check('the stat bar is a bordered grid of five cells with dividers', () => {
  const cells = markup.match(/class="tdd-stat"/g) ?? []
  assert.equal(cells.length, 5, 'exactly five stat cells')
  assert.ok(markup.includes('class="tdd-stats"'), 'the bar is one bordered container')
})

check('no range control remains: the panel reports a profile, not a window', () => {
  for (const label of ['Today', 'All', '30d', '7d']) {
    assert.ok(!new RegExp(`>\\s*${label}\\s*<`).test(markup), `the range control still renders "${label}"`)
  }
})

check('the activity section offers daily, weekly and cumulative', () => {
  assert.ok(text.includes('Token activity'), 'the section title must render')
  for (const label of ['Daily', 'Weekly', 'Cumulative']) {
    assert.ok(text.includes(label), `missing heatmap mode: ${label}`)
  }
  const pressed = markup.match(/aria-pressed="true"/g) ?? []
  assert.equal(pressed.length, 1, 'exactly one mode is active')
})

check('the heatmap is a whole number of seven-row weeks starting on Sunday', () => {
  const grid = buildHeatmap(snapshot, 'daily')
  assert.equal(grid.cells.length % 7, 0, 'the grid must fill complete weeks')
  assert.equal(grid.months.length, grid.cells.length / 7, 'one label slot per column')
  const [year, month, day] = grid.cells[0].date.split('-').map(Number)
  assert.equal(new Date(Date.UTC(year, month - 1, day)).getUTCDay(), 0, 'the grid must start on a Sunday')
})

check('the three heatmap modes differ and cumulative never decreases', () => {
  const daily = buildHeatmap(snapshot, 'daily').cells
  const weekly = buildHeatmap(snapshot, 'weekly').cells
  const cumulative = buildHeatmap(snapshot, 'cumulative').cells
  assert.equal(daily.length, cumulative.length, 'all modes share one grid')

  for (let index = 1; index < cumulative.length; index++) {
    assert.ok(cumulative[index].value >= cumulative[index - 1].value, 'cumulative must be monotonic')
  }
  // Weekly repeats a whole week's total across its seven days.
  const firstWeek = weekly.slice(0, 7).map((cell) => cell.value)
  assert.equal(new Set(firstWeek).size, 1, 'one week is one value in weekly mode')
  assert.notEqual(daily.at(-1).value, cumulative.at(-1).value, 'the modes must not agree everywhere')
})

check('the ramp spreads across all five steps', () => {
  const levels = new Set(buildHeatmap(snapshot, 'daily').cells.map((cell) => cell.level))
  assert.ok(levels.has(0), 'empty days must use the neutral step')
  assert.ok([...levels].some((level) => level > 0), 'active days must use the ramp')
  for (const level of levels) assert.ok(level >= 0 && level <= 4, `level ${level} is off the ramp`)
})

check('month labels appear only where the month changes', () => {
  const labelled = labelMonths(buildHeatmap(snapshot, 'daily'), 'en-GB')
  const named = labelled.months.filter((month) => month.label.length > 0)
  assert.ok(named.length > 0, 'at least one month must be named')
  assert.ok(named.length <= 13, 'a year has at most 13 labelled columns')
  for (let index = 1; index < labelled.months.length; index++) {
    const current = labelled.months[index]
    const previous = labelled.months[index - 1]
    assert.ok(current.label === '' || current.label !== previous.label, 'a month must not be labelled twice in a row')
  }
})

check('the footer reports insights and the most-used skills', () => {
  assert.ok(text.includes('Insights'), 'the insights column must render')
  assert.ok(text.includes('Most used'), 'the most-used column must render')
  for (const label of [
    'Most used reasoning',
    'Skills explored',
    'Total skills used',
    'Total chats',
    'Total turns',
    'Cache hit rate',
  ]) {
    assert.ok(text.includes(label), `missing insight: ${label}`)
  }
  assert.ok(text.includes('high · 73% of requests'), 'the reasoning share must render')
  assert.ok(text.includes('$remotion-best-practices'), 'skills carry the $ prefix')
  assert.ok(text.includes('2 runs') && text.includes('1 run'), 'run counts must pluralize')
  assert.ok(!text.includes('1 runs'), 'a single run must not read "1 runs"')
})

check('the empty and error states render without a snapshot', () => {
  const loading = renderToStaticMarkup(createElement(UsageView, { t, loading: true, onRefresh: () => {} }))
  assert.ok(loading.includes('tdd-skeleton'), 'the loading state must render')
  const failed = renderToStaticMarkup(
    createElement(UsageView, { t, loading: false, error: 'HTTP 503', onRefresh: () => {} }),
  )
  assert.ok(failed.includes('Usage data unavailable'), 'the error state must render')
  assert.ok(failed.includes('HTTP 503'), 'the error text must be shown')
})

check('a warning row appears only when the Host reports one', () => {
  assert.ok(!markup.includes('Warnings'), 'a clean snapshot renders no warning section')
  const noisy = render({ snapshot: { ...snapshot, warnings: ['session-x: truncated rewrite'] } })
  assert.ok(noisy.includes('Warnings'), 'a warning must render its section')
})

check('the Chinese dictionary renders the reference panel text', () => {
  const zhT = makeTranslate(zh, en)
  const zhMarkup = renderToStaticMarkup(
    createElement(UsageView, { t: zhT, snapshot, loading: false, onRefresh: () => {}, locale: 'zh-CN' }),
  )
  const zhText = zhMarkup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const statLabels = [
    '\u7d2f\u8ba1 Token \u6570',
    'Token \u4f7f\u7528\u5cf0\u503c',
    '\u6700\u957f\u4efb\u52a1\u7528\u65f6',
    '\u6700\u957f\u8fde\u7eed\u5929\u6570',
    '\u5f53\u524d\u8fde\u7eed\u5929\u6570',
  ]
  for (const label of statLabels) assert.ok(zhText.includes(label), `missing Chinese stat: ${label}`)
  const sectionLabels = [
    'Token \u6d3b\u52a8',
    '\u6bcf\u5929',
    '\u6bcf\u5468',
    '\u7d2f\u8ba1\u603b\u91cf',
    '\u6d1e\u5bdf',
    '\u6700\u5e38\u4f7f\u7528',
  ]
  for (const label of sectionLabels) assert.ok(zhText.includes(label), `missing Chinese label: ${label}`)
  // The whole point of the locale split: Chinese units, not K / M.
  assert.ok(zhText.includes('6.2\u4ebf'), `expected 6.2亿 in: ${zhText.slice(0, 200)}`)
  assert.ok(zhText.includes('46\u520659\u79d2'), 'the duration must use Chinese units')
  assert.ok(!zhText.includes('617.6M'), 'the English unit must not leak into the Chinese panel')
})

check('both dictionaries cover every key the panel asks for', () => {
  for (const key of Object.keys(en)) {
    assert.ok(typeof zh[key] === 'string' && zh[key].length > 0, `zh is missing the key "${key}"`)
    assert.ok(en[key].length > 0, `en is missing the value for "${key}"`)
  }
})

check('no untranslated locale key reaches the rendered panel', () => {
  const nodes = [...markup.matchAll(/>([^<>]+)</g)].map((match) => match[1].trim())
  for (const key of Object.keys(en)) {
    if (en[key] === key) continue
    assert.ok(!nodes.includes(key), `the untranslated key "${key}" was rendered as a text node`)
  }
})

console.log(failures === 0 ? '\nrender: all checks passed' : `\nrender: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
