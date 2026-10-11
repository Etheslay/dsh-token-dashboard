/**
 * The layout fixture: the real panel inside a stand-in for the settings dialog.
 *
 * The page reproduces the two things the panel depends on and cannot see from
 * the inside:
 *
 *   1. the DSH dark palette, so the ramp and the theme surfaces are the real
 *      ones; and
 *   2. a dialog body that owns the scroll, which is what the panel is dropped
 *      into. The `main` element mirrors the shell's `_floatBody_` rule
 *      (`overflow:auto`) — so if the panel ever scrolls itself again, a second
 *      scrollbar shows up here exactly as it does in the harness.
 *
 * @module dsh-token-dashboard/tools/panel-fixture
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { build } from 'esbuild'
import { en } from '../src/client/locales.ts'
import { PANEL_CSS } from '../src/client/styles.ts'

/**
 * A snapshot exercising every layout-sensitive branch at once.
 *
 * The window starts on a Sunday and runs for a fixed number of days, so the grid
 * is the same shape on every run and the week padding never moves. The LENGTH is
 * a parameter because it decides the block split: an even number of weeks halves
 * evenly, an odd one leaves a block a column short and has to be padded, and both
 * cases are worth rendering.
 * @param days - Length of the heatmap window in days. Defaults to 371 (53 weeks).
 * @returns A snapshot whose heatmap window is exactly `days` days long.
 */
export const fixtureSnapshot = (days = 371) => {
  const buckets = (uncached, output, cacheRead = 0) => ({
    uncachedInputTokens: uncached,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: uncached + output + cacheRead,
  })
  const dayKey = (offset) => new Date(Date.UTC(2026, 4, 7) - offset * 86_400_000).toISOString().slice(0, 10)
  const from = new Date(Date.UTC(2025, 9, 26)) // a Sunday
  const to = new Date(from.getTime() + (days - 1) * 86_400_000)
  const isoDay = (date) => date.toISOString().slice(0, 10)
  return {
    generatedAt: new Date(2026, 4, 7, 9, 25).getTime(),
    elapsedMs: 812,
    home: 'C:\\\\Users\\\\wu\\\\.dsh',
    timeZone: 'Asia/Shanghai',
    agentPreset: 'cordis',
    identity: { name: 'Etheslay', handle: '@etheslay' },
    totals: { ...buckets(2_075_755, 2_435_802, 563_335_040), sessions: 15, turns: 84, responses: 2501 },
    days: [
      { date: dayKey(40), turns: 3, responses: 20, ...buckets(1000, 500) },
      { date: dayKey(2), turns: 5, responses: 40, ...buckets(900_000_000, 600_000) },
      { date: dayKey(1), turns: 2, responses: 11, ...buckets(20_000, 9_000) },
      { date: dayKey(0), turns: 4, responses: 30, ...buckets(120_000, 44_000) },
    ],
    heatmap: { from: isoDay(from), to: isoDay(to) },
    models: [],
    workspaces: [],
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
      reasoning: [{ label: 'high', count: 18, share: 71 }],
      skillsExplored: 8,
      skillsTotal: 10,
      topSkills: [
        { name: 'remotion-best-practices', runs: 2 },
        { name: 'remotion-create', runs: 2 },
        { name: 'brainstorming', runs: 1 },
        { name: 'diagnose-windows-sandbox-acl', runs: 1 },
      ],
      models: [{ label: 'deepseek-flash', count: 617_500_000, share: 100 }],
    },
    warnings: [],
  }
}

/** The default fixture: a full 53-week year. */
export const FIXTURE_SNAPSHOT = fixtureSnapshot(371)

/** Bundle the TSX panel once so Node can render it. */
async function loadPanel(root) {
  const cacheDir = path.join(root, 'node_modules/.cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const bundle = path.join(cacheDir, 'dsh-tdd-fixture-panel.mjs')
  await build({
    entryPoints: [path.join(root, 'src/client/panel.tsx')],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    jsx: 'automatic',
    external: ['react', 'react-dom'],
    logLevel: 'silent',
  })
  return import(pathToFileURL(bundle).href)
}

/**
 * Render the fixture page.
 * @param root - Repository root.
 * @param days - Length of the heatmap window in days.
 * @returns The HTML text.
 */
export async function buildFixtureHtml(root, days = 371) {
  const { UsageView, makeTranslate } = await loadPanel(root)
  const panel = renderToStaticMarkup(
    createElement(UsageView, {
      t: makeTranslate(en, en),
      locale: 'en-GB',
      snapshot: fixtureSnapshot(days),
      loading: false,
      onRefresh: () => {},
    }),
  )
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>dsh-token-dashboard — panel layout fixture</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font-family: -apple-system, "Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #eee; background: #151517; font-size: 13px;
  /* The real DSH dark palette, enough of it for the panel. */
  --dsw-alias-bg-base: #151517;
  --dsw-alias-bg-layer-1: #1f1f22;
  --dsw-alias-bg-layer-2: #232326;
  --dsw-alias-label-primary: #eee;
  --dsw-alias-label-secondary: #9a9a9f;
  --dsw-alias-border-l1: #2c2c2f;
  --dsw-alias-border-l2: #3a3a3e;
  --dsw-alias-state-error-primary: #f25a5a;
  --dsw-alias-state-warn-primary: #e8a33d;
}
/* The settings dialog: fixed height, and ITS OWN scroll body — the scrollbar the
   user already has, which the panel must not duplicate. */
.dialog {
  width: min(1180px, 100%);
  height: 100vh;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
  border-left: 1px solid var(--dsw-alias-border-l1);
  border-right: 1px solid var(--dsw-alias-border-l1);
}
.dialog-head { display: flex; align-items: center; justify-content: flex-end; padding: 12px 16px 0; }
.dialog-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 22px;
}
.dialog-scroll::-webkit-scrollbar { width: 10px; }
.dialog-scroll::-webkit-scrollbar-thumb { background: #3a3a3e; border-radius: 5px; }
${PANEL_CSS}
</style>
</head>
<body>
<div class="dialog">
  <div class="dialog-head"><button type="button" class="tdd-btn">Open config</button></div>
  <div class="dialog-scroll">${panel}</div>
</div>
</body>
</html>
`
}
