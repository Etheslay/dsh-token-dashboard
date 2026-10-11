/**
 * Turning per-session summaries into one snapshot for the panel.
 *
 * There is no reporting window: the panel is a profile, so every figure is
 * all-time and the only time axis is the activity heatmap. That removes a whole
 * class of bug — a windowed number and an all-time number can no longer
 * disagree, because there is only one number.
 *
 * @module dsh-token-dashboard/host/aggregate
 */
import { addInto, zeroBuckets, type Buckets } from './fold.ts'
import type { SessionSummary } from './scan.ts'
import type {
  CacheStats,
  CountedBuckets,
  DayUsage,
  Insights,
  ProfileSummary,
  RouteUsage,
  SessionRow,
  Share,
  TokenBuckets,
  UsageCount,
  UsageSnapshot,
  WorkspaceUsage,
} from '../shared/types.ts'

/** Milliseconds in one local day, used for calendar and streak arithmetic. */
const DAY_MS = 86_400_000

/** How many months of history the activity heatmap covers. */
export const HEATMAP_MONTHS = 12

/** Total tokens in a bucket set. */
const totalOf = (buckets: TokenBuckets): number =>
  buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens

/** Detach a bucket accumulator with its total. */
const counted = (buckets: Buckets): CountedBuckets => ({ ...buckets, totalTokens: totalOf(buckets) })

/** Sum bucket values into a target. */
const addCounted = (target: Buckets, source: TokenBuckets): void => addInto(target, source, 1)

/**
 * Format an epoch millisecond instant as `YYYY-MM-DD` in a zone.
 * @param timeMs - Epoch milliseconds.
 * @param timeZone - IANA zone name.
 * @returns The local date key.
 */
export function dayKeyInZone(timeMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timeMs))
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '01'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Shift a `YYYY-MM-DD` key by whole days through UTC, so DST cannot skip one. */
function shiftDay(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Compute the current activity streak, in consecutive local days.
 *
 * A streak is counted back from today, or from yesterday when today has no
 * activity yet — a day still in progress is not a broken streak.
 * @param activeDays - Set of `YYYY-MM-DD` keys with any activity.
 * @param todayKey - Today's key.
 * @returns `{ current, longest }` in days.
 */
export function computeStreaks(activeDays: ReadonlySet<string>, todayKey: string): { current: number; longest: number } {
  let current = 0
  let cursor = activeDays.has(todayKey) ? 0 : 1
  if (cursor === 1 && !activeDays.has(shiftDay(todayKey, -1))) current = 0
  else {
    while (activeDays.has(shiftDay(todayKey, -cursor))) {
      current++
      cursor++
    }
  }

  const sorted = [...activeDays].sort()
  let longest = 0
  let run = 0
  let previous: string | undefined
  for (const key of sorted) {
    run = previous !== undefined && shiftDay(previous, 1) === key ? run + 1 : 1
    previous = key
    if (run > longest) longest = run
  }
  return { current, longest }
}

/** Turn a tally into a share list, heaviest first. */
function shares(tally: ReadonlyMap<string, number>): Share[] {
  let total = 0
  for (const count of tally.values()) total += count
  if (total === 0) return []
  return [...tally.entries()]
    .map(([label, count]) => ({ label, count, share: (count / total) * 100 }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
}

/** Turn a tally into a usage list, heaviest first. */
function counts(tally: ReadonlyMap<string, number>): UsageCount[] {
  return [...tally.entries()]
    .map(([name, runs]) => ({ name, runs }))
    .sort((left, right) => right.runs - left.runs || left.name.localeCompare(right.name))
}

/** Inputs for {@link buildSnapshot}. */
export interface AggregateInput {
  /** Every session summary read from disk. */
  summaries: readonly SessionSummary[]
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
  /** Resolved account identity, when the harness has one. */
  identity?: UsageSnapshot['identity']
}

/**
 * Build the panel's complete snapshot.
 * @param input - Summaries plus the environment facts.
 * @returns The wire snapshot.
 */
export function buildSnapshot(input: AggregateInput): UsageSnapshot {
  const { summaries, timeZone, home, todayKey, warnings, elapsedMs } = input

  const days = new Map<string, { buckets: Buckets; turns: number; responses: number }>()
  const models = new Map<string, { provider: string; model: string; responses: number; buckets: Buckets }>()
  const effortTally = new Map<string, number>()
  const skillTally = new Map<string, number>()
  const modelTally = new Map<string, number>()
  const activeDays = new Set<string>()
  const totals = zeroBuckets()
  const byWorkspace = new Map<string, { buckets: Buckets; sessions: number }>()

  let turns = 0
  let responses = 0
  let lifetimeSessions = 0
  let longestTurnSeconds = 0

  for (const summary of summaries) {
    turns += summary.turns
    responses += summary.responses
    longestTurnSeconds = Math.max(longestTurnSeconds, summary.longestTurnMs / 1000)
    if (summary.totals.totalTokens > 0) lifetimeSessions++
    addCounted(totals, summary.totals)

    for (const [label, count] of Object.entries(summary.efforts)) {
      effortTally.set(label, (effortTally.get(label) ?? 0) + count)
    }
    for (const [name, count] of Object.entries(summary.skills)) {
      skillTally.set(name, (skillTally.get(name) ?? 0) + count)
    }

    const cwd = summary.cwd.length > 0 ? summary.cwd : ''
    const workspace = byWorkspace.get(cwd) ?? { buckets: zeroBuckets(), sessions: 0 }
    workspace.sessions++
    byWorkspace.set(cwd, workspace)

    for (const day of summary.days) {
      const entry = days.get(day.date) ?? { buckets: zeroBuckets(), turns: 0, responses: 0 }
      addCounted(entry.buckets, day)
      entry.turns += day.turns
      entry.responses += day.responses
      days.set(day.date, entry)
      addCounted(workspace.buckets, day)
      if (day.totalTokens > 0 || day.turns > 0) activeDays.add(day.date)
    }

    for (const route of summary.routes) {
      const key = `${route.provider}\u0000${route.model}`
      const entry = models.get(key) ?? { provider: route.provider, model: route.model, responses: 0, buckets: zeroBuckets() }
      addCounted(entry.buckets, route)
      entry.responses += route.responses
      models.set(key, entry)
    }
  }

  const modelList: RouteUsage[] = [...models.values()]
    .map((entry) => ({ provider: entry.provider, model: entry.model, responses: entry.responses, ...counted(entry.buckets) }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
  // Ranked by tokens, not by response count: a hundred cheap replies should not
  // outrank the one expensive model that actually spent the budget.
  for (const model of modelList) {
    modelTally.set(model.model, (modelTally.get(model.model) ?? 0) + model.totalTokens)
  }

  const workspaceList: WorkspaceUsage[] = [...byWorkspace.entries()]
    .map(([cwd, entry]) => ({
      cwd: cwd.length > 0 ? cwd : '(unknown)',
      name: cwd.length > 0 ? (cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd) : '(unknown)',
      sessions: entry.sessions,
      ...counted(entry.buckets),
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)

  const dayList: DayUsage[] = [...days.entries()]
    .map(([date, entry]) => ({ date, turns: entry.turns, responses: entry.responses, ...counted(entry.buckets) }))
    .sort((left, right) => left.date.localeCompare(right.date))

  const streaks = computeStreaks(activeDays, todayKey)
  const lifetimeTokens = totalOf(totals)

  // The peak is taken over the AGGREGATED day buckets, not over each session's
  // own days. Two sessions sharing a date are one day to a user, and reading
  // the per-session values would silently under-report the busiest day.
  let peakDailyTokens = 0
  let peakDay: string | undefined
  for (const day of dayList) {
    if (day.totalTokens > peakDailyTokens) {
      peakDailyTokens = day.totalTokens
      peakDay = day.date
    }
  }

  const profile: ProfileSummary = {
    lifetimeTokens,
    peakDailyTokens,
    ...(peakDay === undefined ? {} : { peakDay }),
    longestTurnSeconds,
    currentStreakDays: streaks.current,
    longestStreakDays: streaks.longest,
    sessions: lifetimeSessions,
    turns,
    activeDays: activeDays.size,
  }

  const insights: Insights = {
    reasoning: shares(effortTally),
    skillsExplored: skillTally.size,
    skillsTotal: [...skillTally.values()].reduce((sum, value) => sum + value, 0),
    topSkills: counts(skillTally),
    models: shares(modelTally),
  }

  return {
    generatedAt: Date.now(),
    elapsedMs,
    home,
    timeZone,
    ...(input.identity === undefined ? {} : { identity: input.identity }),
    totals: { ...counted(totals), sessions: lifetimeSessions, turns, responses },
    days: dayList,
    heatmap: { from: shiftDay(firstOfMonth(todayKey, HEATMAP_MONTHS - 1), 0), to: todayKey },
    models: modelList,
    workspaces: workspaceList,
    sessions: buildSessionRows(summaries, input.sessionLimit ?? 12, input.currentSession),
    cache: buildCacheStats(totals),
    profile,
    insights,
    warnings,
  }
}

/** The first day of the month `monthsAgo` months before `key`'s month. */
function firstOfMonth(key: string, monthsAgo: number): string {
  const [year, month] = key.split('-').map(Number) as [number, number]
  const zeroBased = month - 1 - monthsAgo
  const shiftedYear = year + Math.floor(zeroBased / 12)
  const shiftedMonth = ((zeroBased % 12) + 12) % 12
  return `${shiftedYear}-${String(shiftedMonth + 1).padStart(2, '0')}-01`
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

/** Build the recent-session list, newest first. */
function buildSessionRows(
  summaries: readonly SessionSummary[],
  limit: number,
  currentSession: string | undefined,
): SessionRow[] {
  return [...summaries]
    .filter((summary) => summary.totals.totalTokens > 0 || summary.turns > 0)
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
