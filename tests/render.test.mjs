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
const { UsageView, makeTranslate, buildHeatmap, heatCellAnchor, heatCellDescription, HEAT_TITLE_ID } = await import(
  pathToFileURL(panelBundle).href
)
const { en, zh } = await import('../src/client/locales.ts')
// The Host owns the heatmap window, so its arithmetic is checked here too —
// the panel's symmetry depends on the window it is handed.
const { heatmapWindow } = await import('../src/host/aggregate.ts')
// The stylesheet is plain TS, so Node can load it directly for the CSS
// invariants below.
const { PANEL_CSS, HEATMAP_RAMP, HEATMAP_GAP, HEATMAP_MAX_CELL } = await import('../src/client/styles.ts')

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
  // Rounding must not promote the VALUE past the UNIT: 99_999_999 / 10_000
  // rounds to 10000, and `10000万` is a worse label than the `1亿` it equals.
  assert.equal(localeCompact(99_999_999, 'zh-CN'), '1\u4ebf')
  assert.equal(localeCompact(99_990_000, 'zh-CN'), '9999\u4e07', 'a value that still rounds below 10000 keeps 万')
  assert.equal(localeCompact(999_999, 'zh-CN'), '100\u4e07', 'sub-亿 values are unaffected')
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
  // A full 12 months: 2025-11-01 is a Saturday, so the grid pads back to Sunday
  // 2025-10-26, and 2026-10-26 pads forward to Saturday 2026-10-31. 371 days =
  // 53 whole weeks, which is what a real year looks like.
  heatmap: { from: '2025-11-01', to: '2026-10-26' },
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

/** Every cell across every block, in reading order. */
const allCells = (grid) => grid.blocks.flatMap((block) => block.cells)
/** Every label slot across every block, with its block index. */
const allMonths = (grid) => grid.blocks.flatMap((block, blockIndex) => block.months.map((month) => ({ ...month, blockIndex })))

check('the year is split into two stacked six-month blocks', () => {
  const grid = buildHeatmap(snapshot, 'daily', 'en-GB')
  assert.equal(grid.blocks.length, 2, 'two blocks')
  const [first, second] = grid.blocks
  // A year is 52 or 53 weeks — odd, so the halves differ by one column unless
  // the short one is padded. Both blocks are drawn onto the SAME grid width, so
  // that difference would show up as two different cell sizes; padding is what
  // removes it.
  assert.equal(first.cells.length, second.cells.length, 'both blocks draw the same column count')
  assert.equal(first.cells.length / 7, grid.columnsPerBlock, 'every block draws the shared column count')
  const real = allCells(grid).filter((cell) => cell.trailing !== true)
  assert.equal(real.length % 7, 0, 'the year is whole weeks')
  assert.ok(real.length / 7 >= 52 && real.length / 7 <= 54, `a year is 52-53 weeks, got ${real.length / 7}`)
  for (const block of grid.blocks) {
    const padding = block.cells.filter((cell) => cell.trailing === true)
    assert.equal(padding.length % 7, 0, 'padding comes in whole columns')
    assert.equal(block.months.length, block.cells.length / 7, 'a padded block still has one label slot per column')
    const slot = block.months.length - padding.length / 7
    for (const month of block.months.slice(slot)) {
      assert.equal(month.label, '', 'a padding column is never labelled')
    }
    // Padding must not invent a date: it repeats the block's last column, which
    // keeps the tooltip and the hover readout honest. `key` still has to be
    // unique or React reuses the wrong node.
    const last = block.cells[block.cells.length - padding.length - 1]
    for (const cell of padding) {
      assert.equal(cell.date, last.date, 'padding repeats the last real day')
      assert.equal(cell.value, last.value, 'padding repeats the last real value')
      assert.notEqual(cell.key, last.key, 'padding needs its own key')
    }
  }
  assert.ok(first.cells.length / 7 >= 26 && first.cells.length / 7 <= 27, `a six-month block is 26-27 columns, got ${first.cells.length / 7}`)
})

check('padding columns are hidden, and never reach the accessibility tree', () => {
  assert.ok(markup.includes('data-trailing="true"'), 'the padded block marks its padding')
  const padded = markup.match(/data-trailing="true"[^>]*/g) ?? []
  assert.ok(padded.length > 0 && padded.length % 7 === 0, `padding is a whole column of cells, got ${padded.length}`)
  for (const cell of padded) {
    assert.ok(!/aria-label=/.test(cell), 'a padding cell must not announce a date it does not represent')
    assert.ok(!/title=/.test(cell), 'a padding cell must not offer a tooltip')
  }
  assert.ok(/\.tdd-cell\[data-trailing='true'\]\{visibility:hidden\}/.test(PANEL_CSS), 'padding must be invisible')
})

check('a cell past the window\'s last day never claims a date', () => {
  // The grid is padded forward to the end of the current week, so the last
  // column holds days that have not happened. They belong in the grid — that is
  // what keeps the column count independent of which weekday today is — but
  // they must stay silent, exactly like block padding.
  const grid = buildHeatmap(snapshot, 'daily', 'en-GB')
  const cells = allCells(grid)
  const { to } = snapshot.heatmap
  const future = cells.filter((cell) => cell.trailing !== true && cell.date > to)
  assert.ok(future.length > 0, 'the fixture window must end mid-week, or this check proves nothing')
  assert.ok(
    future.every((cell) => cell.future === true),
    'every past-the-window cell must be marked `future`',
  )

  // Pair the rendered tags with the built cells: both are in grid order, and the
  // legend's swatches are spans rather than divs.
  const tags = [...markup.matchAll(/<div class="tdd-cell"[^>]*>/g)].map((match) => match[0])
  assert.equal(tags.length, cells.length, 'every built cell must render exactly one element')
  const silent = markup.match(/data-future="true"[^>]*/g) ?? []
  assert.equal(silent.length, future.length, 'the markup must mark exactly the future cells')
  cells.forEach((cell, index) => {
    const inert = cell.trailing === true || cell.future === true
    const date = cell.date
    if (inert) {
      assert.ok(!/aria-label=/.test(tags[index]), `${date} is not a real observation and must not announce a date`)
      assert.ok(!/title=/.test(tags[index]), `${date} must not offer a tooltip`)
      assert.ok(!/onmouseenter/.test(tags[index].toLowerCase()), `${date} must not be hoverable`)
    } else {
      assert.ok(/aria-label=/.test(tags[index]), `the real day ${date} must announce its date`)
      assert.ok(/title=/.test(tags[index]), `the real day ${date} must offer a tooltip`)
    }
  })
})

check('every window length still gives both blocks one width and one cell size', () => {
  // The visible defect padding exists to prevent. The Host trims its window to
  // an even number of weeks (see `heatmapWindow`), so in practice the halves are
  // already equal and nothing is padded — but the panel is also rendered from
  // snapshots it did not produce, so an odd count must still come out even.
  const from = new Date(Date.UTC(2025, 9, 26)) // a Sunday
  let paddedCases = 0
  for (let days = 336; days <= 372; days++) {
    const to = new Date(from.getTime() + (days - 1) * 86_400_000)
    const window = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
    const grid = buildHeatmap({ ...snapshot, heatmap: window }, 'daily', 'en-GB')
    const columns = grid.blocks.map((block) => block.cells.length / 7)
    assert.equal(columns[0], columns[1], `${days} days: both blocks must draw ${columns[0]} columns, got ${columns.join(' and ')}`)
    // The shared count is the one the CSS is told to build, so `repeat(N, 1fr)`
    // gives every block the same width and `N` is what the width formula scales.
    assert.equal(columns[0], grid.columnsPerBlock, `${days} days: the grid must be built with the shared count`)
    assert.equal(grid.blocks[0].months.length, columns[0], `${days} days: one label slot per column`)
    for (const block of grid.blocks) {
      const real = block.cells.filter((cell) => cell.trailing !== true).length / 7
      const padded = columns[0] - real
      assert.ok(padded === 0 || padded === 1, `${days} days: at most one padding column, got ${padded}`)
      if (padded === 1) paddedCases++
    }
  }
  assert.ok(paddedCases > 0, 'the odd weeks in this range must exercise the padding path')
})

check('an even week count halves exactly, with nothing padded', () => {
  // This is what the Host hands the panel: a Sunday-aligned window of an even
  // number of weeks. Both blocks then have the same real column count, so the
  // rows are identical without any hidden filler.
  const from = new Date(Date.UTC(2025, 10, 2)) // a Sunday
  for (const weeks of [48, 50, 52]) {
    // A Sunday-aligned run of N weeks spans N*7-1 days: the last day of week N is
    // six days past its Sunday.
    const days = weeks * 7 - 1
    const to = new Date(from.getTime() + (days - 1) * 86_400_000)
    const window = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
    const grid = buildHeatmap({ ...snapshot, heatmap: window }, 'daily', 'en-GB')
    assert.equal(grid.columnCount, weeks, `${weeks} weeks must build ${weeks} columns in the year`)
    assert.equal(grid.columnsPerBlock, weeks / 2, `${weeks} weeks must draw ${weeks / 2} columns per block`)
    assert.equal(grid.realColumnsPerBlock, weeks / 2, `${weeks} weeks: nothing rounded up`)
    assert.equal(grid.blocks.length, 2, 'still two blocks')
    for (const [index, block] of grid.blocks.entries()) {
      assert.equal(block.cells.length / 7, weeks / 2, `${weeks} weeks: block ${index} must draw ${weeks / 2} columns`)
      assert.equal(block.cells.filter((cell) => cell.trailing === true).length, 0, `${weeks} weeks: nothing to pad`)
      assert.equal(block.months.length, weeks / 2, `${weeks} weeks: one label slot per column`)
    }
  }
})

check('the cells and the month axis are labelled as one grid', () => {
  // The heatmap is a 7 x N table, and it now says so: rowcount, colcount and a
  // per-cell index, named by the heading directly above it.
  const grids = markup.match(/role="grid"/g) ?? []
  assert.equal(grids.length, 2, 'both blocks are grids')
  assert.ok(markup.includes(`aria-labelledby="${HEAT_TITLE_ID}"`), 'the grid names itself from the heading')
  assert.ok(markup.includes(`id="${HEAT_TITLE_ID}"`), 'that heading carries the id')
  assert.ok(markup.includes('aria-rowcount="7"'), 'the grid has seven weekday rows')
  assert.ok(/aria-colcount="\d+"/.test(markup), 'the grid reports its column count')
  assert.ok(markup.includes('aria-rowindex="1"') && markup.includes('aria-rowindex="7"'), 'cells carry row indexes 1-7')
  assert.ok(markup.includes('aria-colindex="1"'), 'cells carry column indexes')
  const cells = markup.match(/role="gridcell"/g) ?? []
  const grid = buildHeatmap(snapshot, 'daily', 'en-GB')
  assert.equal(cells.length, 2 * grid.columnsPerBlock * 7, 'every cell of both blocks is a gridcell')
  // The axis is decorative: its labels are the column headers, and reading them
  // a second time after the cells says nothing new.
  assert.ok(markup.includes('class="tdd-heat-months" aria-hidden="true"'), 'the axis stays decorative')
})

check('every block is a whole number of seven-row weeks starting on Sunday', () => {
  const grid = buildHeatmap(snapshot, 'daily')
  for (const [index, block] of grid.blocks.entries()) {
    assert.equal(block.cells.length % 7, 0, `block ${index} must fill complete weeks`)
    assert.equal(block.months.length, block.cells.length / 7, `block ${index} needs one label slot per column`)
    const [year, month, day] = block.cells[0].date.split('-').map(Number)
    assert.equal(new Date(Date.UTC(year, month - 1, day)).getUTCDay(), 0, `block ${index} must start on a Sunday`)
  }
})

check('the three heatmap modes differ and cumulative never decreases', () => {
  const daily = allCells(buildHeatmap(snapshot, 'daily'))
  const weekly = allCells(buildHeatmap(snapshot, 'weekly'))
  const cumulative = allCells(buildHeatmap(snapshot, 'cumulative'))
  assert.equal(daily.length, cumulative.length, 'all modes share one grid')

  for (let index = 1; index < cumulative.length; index++) {
    assert.ok(cumulative[index].value >= cumulative[index - 1].value, 'cumulative must be monotonic')
  }
  assert.notEqual(daily.at(-1).value, cumulative.at(-1).value, 'the modes must not agree everywhere')
})

check('weekly mode paints a WHOLE column, not just its Sunday', () => {
  // The bug this pins: the week total was looked up by the cell's own date while
  // the map was keyed by the week's Sunday, so six cells in every seven read
  // zero. The old assertion checked the FIRST week of the fixture — a week with
  // no data, where seven zeros trivially form a one-value set — and could never
  // fail.
  const grid = buildHeatmap(snapshot, 'weekly')
  const cells = allCells(grid)
  for (let index = 0; index < cells.length; index += 7) {
    const column = cells.slice(index, index + 7)
    const values = column.map((cell) => cell.value)
    assert.equal(
      new Set(values).size,
      1,
      `column ${index / 7} (${column[0].date}) must carry one value, got ${values.join(', ')}`,
    )
  }

  // Every day of the window contributes to its own week's cell.
  const painted = cells.filter((cell) => cell.value > 0)
  assert.ok(painted.length >= 7, `weekly mode must paint whole columns, got ${painted.length} cells`)
  assert.equal(painted.length % 7, 0, 'a painted week is seven cells')
  for (const day of snapshot.days) {
    const cell = cells.find((candidate) => candidate.date === day.date)
    assert.ok(cell !== undefined, `${day.date} must appear in the grid`)
    assert.ok(cell.value >= day.totalTokens, `${day.date} must carry at least its own tokens in weekly mode`)
  }
})

check('a weekly cell is named by its week, not by its own weekday', () => {
  // `UsageView` owns the mode state, so a static render is always daily and the
  // weekly wording can only be asserted through the exported helpers.
  const cell = { key: '2026-05-07', date: '2026-05-07', value: 1234, level: 2 }
  assert.equal(heatCellAnchor(cell, 'daily', t, 'en-GB'), '7 May 2026')
  assert.equal(heatCellAnchor(cell, 'weekly', t, 'en-GB'), 'week of 3 May 2026', '3 May 2026 is that week\'s Sunday')
  assert.equal(heatCellAnchor(cell, 'cumulative', t, 'en-GB'), '7 May 2026')
  assert.ok(
    heatCellDescription(cell, 'weekly', t, 'en-GB').includes('week of 3 May 2026'),
    'the tooltip must say which week it reports',
  )
  // The hover readout now comes from the same dictionary, so the unit is
  // translated instead of the English literal `tokens`.
  assert.ok(heatCellDescription(cell, 'daily', t, 'en-GB').includes('tokens'))
  const zhT = makeTranslate(zh, en)
  assert.ok(
    !heatCellDescription(cell, 'daily', zhT, 'zh-CN').includes('tokens'),
    `the Chinese readout must not fall back to the English unit: ${heatCellDescription(cell, 'daily', zhT, 'zh-CN')}`,
  )
})

check('the ramp spreads across all five steps', () => {
  const levels = new Set(allCells(buildHeatmap(snapshot, 'daily')).map((cell) => cell.level))
  assert.ok(levels.has(0), 'empty days must use the neutral step')
  assert.ok([...levels].some((level) => level > 0), 'active days must use the ramp')
  for (const level of levels) assert.ok(level >= 0 && level <= 4, `level ${level} is off the ramp`)
})

check('each block names each month exactly once, and only the month it starts', () => {
  const grid = buildHeatmap(snapshot, 'daily', 'en-GB')
  const named = allMonths(grid).filter((month) => month.label.length > 0)
  assert.ok(named.length > 0, 'at least one month must be named')
  // 12 months, named once each — a block that starts mid-month stays unlabelled
  // until the next month begins rather than repeating its predecessor's month.
  assert.equal(named.length, 12, `a 12-month window names 12 months, got: ${named.map((m) => m.label).join(', ')}`)
  assert.equal(new Set(named.map((m) => m.label)).size, 12, 'no month may be named twice')

  // Each label sits on the column that actually contains the 1st of that month —
  // or, for the window's own opening column, the first day of the window, which
  // is the only anchor the month it falls in may have inside the window.
  for (const block of grid.blocks) {
    block.months.forEach((month, index) => {
      if (month.label === '') return
      const column = block.cells.slice(index * 7, index * 7 + 7)
      const anchor = column.find(
        (cell) => (cell.date.endsWith('-01') || cell.date === snapshot.heatmap.from) && cell.date >= snapshot.heatmap.from && cell.date <= snapshot.heatmap.to,
      )
      assert.ok(
        anchor !== undefined,
        `column ${index} labelled "${month.label}" must contain an in-window first-of-month or the window's first day`,
      )
    })
  }
})

check('the Sunday padding before the window is not labelled', () => {
  // 2025-11-01 is a Saturday, so the grid pads back to Sunday 2025-10-26. That
  // padding is October, and labelling it printed a bare "10月" ahead of the real
  // "11月".
  const grid = buildHeatmap(snapshot, 'daily', 'en-GB')
  const first = grid.blocks[0]
  assert.equal(first.cells[0].date, '2025-10-26', 'the first column is padded to its Sunday')
  assert.equal(first.months[0].label, 'Nov', 'the first column is labelled for the window, not the padding')
})

check('a month opening in the window\'s own first column is still named', () => {
  // 29 January 2023 is a Sunday, so a window opening there has one column
  // holding BOTH the window's first day and 1 February. There is one label slot
  // for the two candidates, and letting the opening day win named the
  // three-day January stub twice over while February vanished from the axis.
  const window = { from: '2023-01-29', to: '2024-01-07' }
  const grid = buildHeatmap({ ...snapshot, heatmap: window }, 'daily', 'en-GB')
  const labelled = allMonths(grid)
    .map((month) => month.label)
    .filter((label) => label.length > 0)
  assert.ok(labelled.includes('Feb'), `February must be named, got: ${labelled.join(', ')}`)
  assert.equal(new Set(labelled).size, labelled.length, `no month may be named twice: ${labelled.join(', ')}`)

  // A label must name the month its own column anchors: the first-of-month the
  // column contains, or — only when it holds none — the window's opening day.
  // (A column runs Sunday to Saturday, so its first DAY can belong to the
  // previous month even when it names the next one.)
  const shortMonth = (key) => {
    const [year, month, day] = key.split('-').map(Number)
    return new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)))
  }
  const namedMonths = new Set()
  for (const block of grid.blocks) {
    block.months.forEach((month, index) => {
      if (month.label === '') return
      const column = block.cells
        .slice(index * 7, index * 7 + 7)
        .filter((cell) => cell.date >= window.from && cell.date <= window.to)
      const anchor = column.find((cell) => cell.date.endsWith('-01')) ?? column.find((cell) => cell.date === window.from)
      assert.ok(anchor !== undefined, `the label "${month.label}" must sit on a column holding an anchor`)
      assert.equal(month.label, shortMonth(anchor.date), `column ${index} must name the month it anchors`)
      namedMonths.add(anchor.date.slice(0, 7))
    })
  }
  // Every month that starts inside the window must be named. The window's own
  // truncated opening month may lose the shared slot — one slot, two
  // candidates, and the whole month is worth more than the stub.
  for (let day = Date.parse(`${window.from}T00:00:00Z`); day <= Date.parse(`${window.to}T00:00:00Z`); day += 86_400_000) {
    const key = new Date(day).toISOString().slice(0, 10)
    if (key.endsWith('-01')) {
      assert.ok(namedMonths.has(key.slice(0, 7)), `${key.slice(0, 7)} starts inside the window and must be named`)
    }
  }
  assert.equal(namedMonths.size, 12, `a 12-month window names 12 months, got ${[...namedMonths].join(', ')}`)
})

check('a window opening mid-month still names the month it opens in', () => {
  // The mirror case: 2 November 2025 is a Sunday and November's 1st is outside
  // the window, so the opening column is November's ONLY anchor and must keep
  // the slot.
  const grid = buildHeatmap({ ...snapshot, heatmap: { from: '2025-11-02', to: '2026-10-11' } }, 'daily', 'en-GB')
  const named = allMonths(grid)
    .map((month) => month.label)
    .filter((label) => label.length > 0)
  assert.equal(named[0], 'Nov', `the opening column must name November, got: ${named.join(', ')}`)
  assert.equal(new Set(named).size, named.length, 'no month may be named twice')
})

/** The declaration body of one rule, anchored so a shared selector cannot match. */
const ruleBody = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|})${escaped}\\{([^}]*)\\}`).exec(css)
  assert.ok(match, `no rule found for ${selector}`)
  return match[1]
}

/** Every rule in the stylesheet whose SELECTOR mentions a token. */
const rulesMentioning = (css, token) =>
  [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)]
    .filter((match) => !match[1].includes(`--${token}`))
    .map((match) => match[0])
    .filter((rule) => rule.includes(token))

check('the panel leaves scrolling to the settings dialog', () => {
  // Two scrollbars appeared in a real settings window: the dialog's own, and a
  // second one this panel created with `height:100%; overflow-y:auto`. Measured
  // there: this element scrolled 1123px of content inside an 864px box while the
  // dialog scrolled the same page.
  const panel = ruleBody(PANEL_CSS, '.tdd')
  for (const property of ['height', 'max-height']) {
    assert.ok(!new RegExp(`(?:^|;)${property}:`).test(panel), `the panel must not be given a fixed ${property}`)
  }
  for (const property of ['overflow:auto', 'overflow:scroll', 'overflow-y:auto', 'overflow-y:scroll']) {
    assert.ok(!panel.includes(property), `the panel must not scroll itself: found ${property}`)
  }
  // The trap that put it back: CSS coerces a computed `overflow-y:visible` to
  // `auto` as soon as the other axis is anything but `visible`, so even an
  // `overflow-x:hidden` clip guard silently recreates the scrollbar. Measured on
  // the real preview page: `overflow-x:hidden` computed `overflow-y:auto` and
  // scrolled 1087px inside an 830px box. Nothing here may set an overflow, so
  // the only way to reintroduce one is to write it out in full.
  for (const match of panel.matchAll(/overflow[^:;]*:[^;]*/g)) {
    assert.equal(match[0], 'overflow-y:visible', `the panel must not set ${match[0]}`)
  }
})

check('the heatmap grid is sized by the panel, not by a fixed width', () => {
  // The grid used to stop at `max-width: 660px` while the five-number bar and
  // the footer kept going to the panel's edge — the misalignment this fixes.
  const shared = ruleBody(PANEL_CSS, '.tdd-heat-grid,.tdd-heat-months')
  assert.ok(shared.includes('width:min(100%,calc('), 'the grid must be fluid up to a derived ceiling')
  assert.ok(shared.includes('--tdd-heat-columns'), 'the ceiling must be derived from the column count')
  assert.ok(!/max-width/.test(shared), 'a second, fixed ceiling is what broke the alignment')
  for (const rule of rulesMentioning(PANEL_CSS, 'tdd-heat-grid')) {
    assert.ok(!/max-width:\s*\d+px/.test(rule), `no fixed heatmap ceiling: ${rule.slice(0, 90)}`)
  }
  assert.ok(PANEL_CSS.includes(`--tdd-heat-cell:${HEATMAP_MAX_CELL}px`), 'the cell ceiling is a declared token')
  assert.ok(PANEL_CSS.includes(`--tdd-heat-gap:${HEATMAP_GAP}px`), 'the gap is a declared token')
})

check('the label row and the cell grid declare identical column geometry', () => {
  // This is the invariant month alignment rests on. The cells and the axis are
  // separate grids — two of each — so a label can only sit under its column if
  // EVERY one declares the same track sizing and the same gap. The first version
  // let the label grid size its columns to their own text and the months drifted
  // out from under the cells; a CSS edit can reintroduce exactly that.
  const shared = ruleBody(PANEL_CSS, '.tdd-heat-grid,.tdd-heat-months')
  for (const property of ['grid-template-columns', 'gap', 'width']) {
    assert.ok(shared.includes(`${property}:`), `the shared rule must set ${property}`)
  }
  assert.ok(
    shared.includes('grid-template-columns:repeat(var(--tdd-heat-columns),minmax(0,1fr))'),
    'columns must be one fluid track per column of the grid it built',
  )
  assert.ok(shared.includes('gap:var(--tdd-heat-gap)'), 'both grids must share one gap')

  const labels = ruleBody(PANEL_CSS, '.tdd-heat-months')
  assert.ok(!labels.includes('grid-template-columns'), 'the label row must not override the shared track sizing')
  assert.ok(!labels.includes('width:'), 'the label row must not override the shared width')
  // Square cells keep rows and columns in step as the panel resizes.
  assert.ok(ruleBody(PANEL_CSS, '.tdd-cell').includes('aspect-ratio:1'), 'cells must stay square')
  // Cells arrive column-major, so the seven rows have to fill before the next
  // column starts. Dropping this puts a whole year on one row.
  assert.ok(ruleBody(PANEL_CSS, '.tdd-heat-grid').includes('grid-auto-flow:column'), 'cells fill a column of seven first')
  // A label wider than its column must grow RIGHTWARDS from the column's left
  // edge. Left to itself it would be centred on the track, so a wide label would
  // start before its own column and read as the previous month's.
  assert.ok(ruleBody(PANEL_CSS, '.tdd-heat-month').includes('justify-self:start'), 'a month label anchors to its own track')
})

check('nothing about the heatmap can produce a horizontal scrollbar', () => {
  // `width: max-content` on either row is exactly what produced one: 53 columns
  // of fixed 16px cells are wider than a narrow settings panel. The split into
  // two blocks removed the need for a minimum width as well, so there must be
  // neither a content width nor an overflow container left — and the one width
  // the grid does carry is `min(100%, …)`, which can never exceed the panel.
  const heatmapRules = rulesMentioning(PANEL_CSS, 'tdd-heat-grid')
  assert.ok(heatmapRules.length > 0, 'the heatmap rules must exist')
  for (const rule of heatmapRules) {
    assert.ok(!rule.includes('max-content'), `the heatmap must not size to content: ${rule.slice(0, 80)}`)
    assert.ok(!rule.includes('overflow-x'), `no heatmap row may scroll: ${rule.slice(0, 80)}`)
  }
  assert.ok(!/min-width:\s*\d/.test(ruleBody(PANEL_CSS, '.tdd-heat-grid,.tdd-heat-months')), 'the grid needs no minimum width')
  assert.ok(ruleBody(PANEL_CSS, '.tdd-heat-grid,.tdd-heat-months').includes('min(100%'), 'the grid is fluid up to its ceiling')
})

check('the activity ramp gets deeper as usage rises, in both themes', () => {
  // The ramp is the reference panel's purple, but the DIRECTION is a deliberate
  // departure from it: darker means more. The reference brightened its dark theme
  // as usage rose, which reads backwards next to every other meter. Rather than
  // restating hex values — which the next palette change would have to edit twice
  // — this asserts the rule the design depends on, so any replacement palette has
  // to keep it.
  const parsed = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
  const luminance = (hex) => {
    const [r, g, b] = parsed(hex)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  for (const [theme, ramp] of Object.entries(HEATMAP_RAMP)) {
    assert.equal(ramp.length, 5, `${theme}: five steps, index 0 is "no activity"`)
    for (const step of ramp) {
      assert.ok(/^#[0-9a-f]{6}$/.test(step), `${theme}: ${step} must be a 6-digit hex colour`)
    }

    // Darker = more. Each level must be darker than the one below it, which is
    // what makes a heavy day the visually heaviest cell in the grid — in BOTH
    // themes, so the two never read as opposite scales.
    const steps = ramp.slice(1).map(luminance)
    for (let level = 2; level <= 4; level++) {
      assert.ok(
        steps[level - 1] < steps[level - 2],
        `${theme}: step ${level} (${ramp[level]}) must be darker than step ${level - 1} (${ramp[level - 1]})`,
      )
    }

    // Level 1 is the faintest step, but it still has to be visible: level 0 is
    // the one that means "nothing happened here".
    const surface = theme === 'dark' ? '#151517' : '#ffffff'
    const distance = (a, b) => Math.abs(luminance(a) - luminance(b))
    assert.ok(
      distance(ramp[1], surface) > distance(ramp[0], surface),
      `${theme}: step 1 (${ramp[1]}) must be more visible than the empty step (${ramp[0]})`,
    )

    // Depth is carried by saturation as well as lightness, so every rise in level
    // must also be a rise in saturation — otherwise "deeper" would just mean
    // "greyer" and the ramp would stop reading as one hue. Only the legend and
    // the four active steps are compared; step 0 is a surface, not a colour.
    const saturation = (hex) => {
      const [r, g, b] = parsed(hex)
      const max = Math.max(r, g, b)
      return max === 0 ? 0 : (max - Math.min(r, g, b)) / max
    }
    const saturations = ramp.map(saturation)
    for (let level = 2; level <= 4; level++) {
      assert.ok(
        saturations[level] > saturations[level - 1],
        `${theme}: step ${level} (${ramp[level]}) must be more saturated than step ${level - 1} (${ramp[level - 1]})`,
      )
    }

    // One hue, not one colour: every ramp step leans the same way, which is what
    // makes the five steps read as a single scale instead of five swatches.
    const leaning = ramp.slice(1).map((step) => {
      const [r, g, b] = parsed(step)
      return b > r && b > g ? 'blue' : r > g && r > b ? 'red' : 'green'
    })
    assert.equal(new Set(leaning).size, 1, `${theme}: the ramp must be one hue, got ${leaning.join(', ')}`)
  }

  assert.notEqual(HEATMAP_RAMP.dark[0], HEATMAP_RAMP.light[0], 'step 0 is per theme')
})

check('the CSS carries the sampled ramp into every step', () => {
  for (const step of HEATMAP_RAMP.dark) assert.ok(PANEL_CSS.includes(step), `the ramp step ${step} must reach the CSS`)
  for (let level = 0; level <= 4; level++) {
    assert.ok(PANEL_CSS.includes(`--tdd-ramp-${level}:`), `ramp step ${level} must be declared`)
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
  assert.ok(text.includes('high · 73%'), 'the reasoning share must render')
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

check('every day of the year yields a window the panel can halve', () => {
  // The Host owns this, and the panel's symmetry depends on it: a Sunday-aligned
  // window spanning an EVEN number of weeks halves into two equal rows. An odd
  // one cannot be halved at all, so one row would come up a column short — the
  // "the lower table is missing a column" defect. Walking every date is the only
  // way to be sure the trim lands correctly for leap years and month lengths.
  const DAY_MS = 86_400_000
  let padded = 0
  for (let cursor = Date.UTC(2025, 0, 1); cursor <= Date.UTC(2027, 11, 31); cursor += DAY_MS) {
    const today = new Date(cursor).toISOString().slice(0, 10)
    const window = heatmapWindow(today)
    assert.equal(window.to, today, `${today}: the window must end today`)
    assert.ok(window.from <= today, `${today}: the window must not start in the future`)
    assert.equal(new Date(`${window.from}T00:00:00Z`).getUTCDay(), 0, `${today}: the window must start on a Sunday`)
    const days = Math.round((cursor - Date.parse(`${window.from}T00:00:00Z`)) / DAY_MS) + 1
    const columns = Math.ceil(days / 7)
    assert.equal(columns % 2, 0, `${today}: ${window.from}..${window.to} is ${columns} columns, which cannot be halved`)
    // A year of history, give or take the trim. Not a fixed 364: the window
    // follows the calendar month a year back, so its length varies.
    assert.ok(days >= 330 && days <= 372, `${today}: ${days} days is not about a year`)
    if (days % 7 !== 0) padded++
  }
  // The trim is real: the raw month-aligned span is an odd number of weeks about
  // half the time, so some dates must exercise it.
  assert.ok(padded > 0, 'the even-week trim must fire for some dates in this range')
})

check('both dictionaries cover every key the panel asks for', () => {
  for (const key of Object.keys(en)) {
    assert.ok(typeof zh[key] === 'string' && zh[key].length > 0, `zh is missing the key "${key}"`)
    assert.ok(en[key].length > 0, `en is missing the value for "${key}"`)
  }
})

check('the nav label is a distinct, non-empty row name', () => {
  // The settings nav renders `nav` as the row's visible text, and the glyph
  // claimer finds its row by matching that text exactly (`isOwnNavRow`). So the
  // label has to be non-blank and compared verbatim — a blank or padded label
  // matches nothing and the row keeps the shell's default gear.
  for (const [locale, dictionary] of [['zh', zh], ['en', en]]) {
    assert.equal(typeof dictionary.nav, 'string', `${locale}: nav must be a string`)
    assert.ok(dictionary.nav.trim().length > 0, `${locale}: nav must not be blank`)
    assert.equal(dictionary.nav, dictionary.nav.trim(), `${locale}: nav must not carry padding, it is compared verbatim`)
  }
  // The wording is a product decision, not an implementation detail, so it is
  // pinned: the row names the page, which is a statistics report.
  assert.equal(zh.nav, '\u7528\u91cf\u7edf\u8ba1')
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
