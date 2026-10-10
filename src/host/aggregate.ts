/**
 * Turning per-session summaries into one snapshot for the panel.
 *
 * Range filtering happens on the per-day buckets rather than on event
 * timestamps. Those buckets are produced by the same fold that produces the
 * totals, so a windowed number and an all-time number can never disagree about
 * a token — they are sums over the same records, not two independent passes.
 *
 * @module dsh-token-dashboard/host/aggregate
 */
import { addInto, zeroBuckets, type Buckets } from './fold.ts'
import type { SessionSummary } from './scan.ts'
import type {
  CacheStats,
  CountedBuckets,
  DayUsage,
  RangeKind,
  RouteUsage,
  SessionRow,
  TokenBuckets,
  UsageSnapshot,
  WorkspaceUsage,
} from '../shared/types.ts'

/** Milliseconds in one local day, used only for the preceding-window bound. */
const DAY_MS = 86_400_000

/**
 * Compute the inclusive lower bound of a range in local-day terms.
 * @param kind - The requested window.
 * @param todayKey - Today's `YYYY-MM-DD` key.
 * @returns The first day key inside the window; `undefined` for `all`.
 */
export function rangeStartKey(kind: RangeKind, todayKey: string): string | undefined {
  if (kind === 'all') return undefined
  const days = kind === 'today' ? 1 : kind === '7d' ? 7 : 30
  const [year, month, day] = todayKey.split('-').map(Number) as [number, number, number]
  // Day arithmetic through UTC avoids DST making a "24 hour" step skip a day.
  const anchor = Date.UTC(year, month - 1, day)
  return new Date(anchor - (days - 1) * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Compute the equal-length window immediately before `kind`'s window.
 * @param kind - The requested window.
 * @param startKey - The window's first day key; `undefined` for `all`.
 * @returns Inclusive start and exclusive end day keys, or `undefined`.
 */
export function previousRangeKeys(
  kind: RangeKind,
  startKey: string | undefined,
): { start: string; end: string } | undefined {
  if (kind === 'all' || startKey === undefined) return undefined
  const days = kind === 'today' ? 1 : kind === '7d' ? 7 : 30
  const [sy, sm, sd] = startKey.split('-').map(Number) as [number, number, number]
  const startAnchor = Date.UTC(sy, sm - 1, sd)
  const previousEnd = new Date(startAnchor - DAY_MS).toISOString().slice(0, 10)
  const previousStart = new Date(startAnchor - days * DAY_MS).toISOString().slice(0, 10)
  return { start: previousStart, end: previousEnd }
}

/** Sum two bucket values. */
const addCounted = (target: Buckets, source: TokenBuckets): void => addInto(target, source, 1)

/** Total tokens in a bucket set. */
const totalOf = (buckets: TokenBuckets): number =>
  buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens

/** Detach a bucket accumulator with its total. */
const counted = (buckets: Buckets): CountedBuckets => ({ ...buckets, totalTokens: totalOf(buckets) })

/** Whether a day key falls inside `[start, end]`, with either bound open. */
const inRange = (key: string, start: string | undefined, end: string | undefined): boolean =>
  (start === undefined || key >= start) && (end === undefined || key <= end)

/** Accumulate the day buckets of every session that fall inside the window. */
function collectDays(
  summaries: readonly SessionSummary[],
  start: string | undefined,
  end: string | undefined,
): Map<string, { buckets: Buckets; turns: number; responses: number }> {
  const days = new Map<string, { buckets: Buckets; turns: number; responses: number }>()
  for (const summary of summaries) {
    for (const day of summary.days) {
      if (!inRange(day.date, start, end)) continue
      let entry = days.get(day.date)
      if (entry === undefined) {
        entry = { buckets: zeroBuckets(), turns: 0, responses: 0 }
        days.set(day.date, entry)
      }
      addCounted(entry.buckets, day)
      entry.turns += day.turns
      entry.responses += day.responses
    }
  }
  return days
}

/** Accumulate per-route totals over the window from the `(day, route)` cells. */
function collectRoutes(
  summaries: readonly SessionSummary[],
  start: string | undefined,
  end: string | undefined,
): Map<string, { provider: string; model: string; responses: number; buckets: Buckets }> {
  const routes = new Map<string, { provider: string; model: string; responses: number; buckets: Buckets }>()
  for (const summary of summaries) {
    for (const cell of summary.dayRoutes) {
      if (!inRange(cell.date, start, end)) continue
      const key = `${cell.provider}\u0000${cell.model}`
      let entry = routes.get(key)
      if (entry === undefined) {
        entry = { provider: cell.provider, model: cell.model, responses: 0, buckets: zeroBuckets() }
        routes.set(key, entry)
      }
      addCounted(entry.buckets, cell)
      entry.responses += cell.responses
    }
  }
  return routes
}

/**
 * Compute the current activity streak, in consecutive local days.
 *
 * A streak is counted back from today (or from yesterday, when today has no
 * activity yet — a day in progress is not a broken streak).
 * @param activeDays - Set of `YYYY-MM-DD` keys with any activity.
 * @param todayKey - Today's key.
 * @returns `{ current, longest }` in days.
 */
export function computeStreaks(activeDays: ReadonlySet<string>, todayKey: string): { current: number; longest: number } {
  const [ty, tm, td] = todayKey.split('-').map(Number) as [number, number, number]
  const todayAnchor = Date.UTC(ty, tm - 1, td)
  const keyAt = (offsetDays: number): string => new Date(todayAnchor - offsetDays * DAY_MS).toISOString().slice(0, 10)

  let current = 0
  // Today may legitimately be empty; start from yesterday in that case.
  let cursor = activeDays.has(keyAt(0)) ? 0 : 1
  if (cursor === 1 && !activeDays.has(keyAt(1))) current = 0
  else {
    while (activeDays.has(keyAt(cursor))) {
      current++
      cursor++
    }
  }

  const sorted = [...activeDays].sort()
  let longest = 0
  let run = 0
  let previousAnchor: number | undefined
  for (const key of sorted) {
    const [y, m, d] = key.split('-').map(Number) as [number, number, number]
    const anchor = Date.UTC(y, m - 1, d)
    run = previousAnchor !== undefined && anchor - previousAnchor === DAY_MS ? run + 1 : 1
    previousAnchor = anchor
    if (run > longest) longest = run
  }
  return { current, longest }
}

/** Inputs for {@link buildSnapshot}. */
export interface AggregateInput {
  /** Every session summary read from disk. */
  summaries: readonly SessionSummary[]
  /** The requested window. */
  range: RangeKind
  /** IANA zone the day keys were built in. */
  timeZone: string
  /** Absolute `$DSH_HOME`. */
  home: string
  /** Today's `YYYY-MM-DD` key in `timeZone`. */
  todayKey: string
  /** Session id the browser has open, highlighted in the list. */
  currentSession?: string
  /** Non-fatal read problems carried through from the scan. */
  warnings: string[]
  /** Wall-clock milliseconds the scan took. */
  elapsedMs: number
  /** How many sessions to return in the list. */
  sessionLimit?: number
}

/**
 * Build the panel's complete snapshot.
 * @param input - Summaries plus the requested window.
 * @returns The wire snapshot.
 */
export function buildSnapshot(input: AggregateInput): UsageSnapshot {
  const { summaries, range, timeZone, home, todayKey, warnings, elapsedMs } = input
  const start = rangeStartKey(range, todayKey)
  const end = todayKey

  const days = collectDays(summaries, start, end)
  const routes = collectRoutes(summaries, start, end)

  const totals = zeroBuckets()
  let turns = 0
  let responses = 0
  for (const entry of days.values()) {
    addInto(totals, entry.buckets, 1)
    turns += entry.turns
    responses += entry.responses
  }

  const contributingSessions = new Set<string>()
  for (const summary of summaries) {
    if (summary.days.some((day) => inRange(day.date, start, end) && day.totalTokens > 0)) {
      contributingSessions.add(summary.id)
    }
  }

  const allTime = zeroBuckets()
  const activeDays = new Set<string>()
  let lifetimeSessions = 0
  for (const summary of summaries) {
    addCounted(allTime, summary.totals)
    for (const day of summary.days) if (day.totalTokens > 0 || day.turns > 0) activeDays.add(day.date)
    if (summary.totals.totalTokens > 0) lifetimeSessions++
  }

  const previousKeys = previousRangeKeys(range, start)
  let previous: (CountedBuckets & { sessions: number }) | undefined
  if (previousKeys !== undefined) {
    const previousDays = collectDays(summaries, previousKeys.start, previousKeys.end)
    const buckets = zeroBuckets()
    for (const entry of previousDays.values()) addInto(buckets, entry.buckets, 1)
    const sessions = new Set<string>()
    for (const summary of summaries) {
      if (
        summary.days.some(
          (day) => inRange(day.date, previousKeys.start, previousKeys.end) && day.totalTokens > 0,
        )
      ) {
        sessions.add(summary.id)
      }
    }
    previous = { ...counted(buckets), sessions: sessions.size }
  }

  const cache = buildCacheStats(totals)
  const streaks = computeStreaks(activeDays, todayKey)

  let peakDailyTokens = 0
  let peakDay: string | undefined
  for (const summary of summaries) {
    for (const day of summary.days) {
      if (day.totalTokens > peakDailyTokens) {
        peakDailyTokens = day.totalTokens
        peakDay = day.date
      }
    }
  }

  let longestTurnSeconds = 0
  let lifetimeTurns = 0
  for (const summary of summaries) {
    longestTurnSeconds = Math.max(longestTurnSeconds, summary.longestTurnMs / 1000)
    lifetimeTurns += summary.turns
  }

  const dayList: DayUsage[] = [...days.entries()]
    .map(([date, entry]) => ({ date, turns: entry.turns, responses: entry.responses, ...counted(entry.buckets) }))
    .sort((left, right) => left.date.localeCompare(right.date))

  const modelList: RouteUsage[] = [...routes.values()]
    .map((entry) => ({
      provider: entry.provider,
      model: entry.model,
      responses: entry.responses,
      ...counted(entry.buckets),
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)

  const workspaces = buildWorkspaces(summaries, start, end)
  const sessions = buildSessionRows(summaries, input.sessionLimit ?? 40, input.currentSession)
  const presets = new Map<string, number>()
  for (const summary of summaries) {
    if (summary.agentPreset === undefined) continue
    presets.set(summary.agentPreset, (presets.get(summary.agentPreset) ?? 0) + 1)
  }
  const topPreset = [...presets.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]

  return {
    generatedAt: Date.now(),
    elapsedMs,
    home,
    timeZone,
    ...(topPreset === undefined ? {} : { agentPreset: topPreset }),
    range: {
      kind: range,
      ...(start === undefined ? {} : { since: Date.parse(`${start}T00:00:00Z`) }),
      until: Date.parse(`${end}T23:59:59.999Z`),
    },
    totals: {
      ...counted(totals),
      sessions: contributingSessions.size,
      turns,
      responses,
    },
    ...(previous === undefined ? {} : { previous }),
    days: dayList,
    models: modelList,
    workspaces,
    sessions,
    cache,
    allTime: { ...counted(allTime), sessions: lifetimeSessions },
    profile: {
      lifetimeTokens: allTime.uncachedInputTokens + allTime.cacheReadTokens + allTime.cacheWriteTokens + allTime.outputTokens,
      peakDailyTokens,
      ...(peakDay === undefined ? {} : { peakDay }),
      longestTurnSeconds,
      currentStreakDays: streaks.current,
      longestStreakDays: streaks.longest,
      sessions: lifetimeSessions,
      turns: lifetimeTurns,
      activeDays: activeDays.size,
    },
    warnings,
  }
}

/** Derive cache effectiveness from a bucket set. */
function buildCacheStats(buckets: TokenBuckets): CacheStats {
  const promptTokens = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  return {
    readTokens: buckets.cacheReadTokens,
    writeTokens: buckets.cacheWriteTokens,
    promptTokens,
    ...(promptTokens === 0 ? {} : { hitRate: (buckets.cacheReadTokens / promptTokens) * 100 }),
  }
}

/** Group sessions by working directory and sum each group's windowed usage. */
function buildWorkspaces(
  summaries: readonly SessionSummary[],
  start: string | undefined,
  end: string | undefined,
): WorkspaceUsage[] {
  const byCwd = new Map<string, { buckets: Buckets; sessions: number }>()
  for (const summary of summaries) {
    const cwd = summary.cwd.length > 0 ? summary.cwd : '(unknown)'
    let entry = byCwd.get(cwd)
    if (entry === undefined) {
      entry = { buckets: zeroBuckets(), sessions: 0 }
      byCwd.set(cwd, entry)
    }
    entry.sessions++
    for (const day of summary.days) {
      if (inRange(day.date, start, end)) addCounted(entry.buckets, day)
    }
  }
  return [...byCwd.entries()]
    .map(([cwd, entry]) => ({
      cwd,
      name: cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd,
      sessions: entry.sessions,
      ...counted(entry.buckets),
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
}

/** Build the recent-session list, newest first, with per-session route detail. */
function buildSessionRows(
  summaries: readonly SessionSummary[],
  limit: number,
  currentSession: string | undefined,
): SessionRow[] {
  return [...summaries]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit)
    .map((summary) => ({
      id: summary.id,
      ...(summary.title === undefined ? {} : { title: summary.title }),
      cwd: summary.cwd,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      turns: summary.turns,
      responses: summary.responses,
      routes: summary.routes,
      ...(summary.context === undefined ? {} : { context: summary.context }),
      ...(currentSession !== undefined && currentSession === summary.id ? { current: true } : {}),
      ...summary.totals,
    }))
}
