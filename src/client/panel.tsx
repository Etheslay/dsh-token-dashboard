/**
 * The usage panel.
 *
 * Layout is Codex's analytics **Overview** profile report, top to bottom:
 *
 *   1. a centred identity block — avatar, display name, handle;
 *   2. a five-cell bar of all-time headline figures;
 *   3. `Token activity`, a year-long contribution heatmap with a
 *      daily / weekly / cumulative switch;
 *   4. a two-column footer of `Insights` and the most-used list.
 *
 * The numbers are localized, which matters more than it sounds: a Chinese UI
 * reads `3.7亿` and `5317.1万`, not `370M` and `53.17M`, and a duration is
 * `46分59秒`, not `46m 59s`. {@link localeCompact} and {@link localeDuration}
 * own that split so the layout never has to care.
 *
 * @module dsh-token-dashboard/client/panel
 */
import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatAbsoluteTime, localeCompact, localeCount, localeDuration } from '../shared/format.ts'
import type { DayUsage, Share, UsageSnapshot } from '../shared/types.ts'
import { browserTimeZone, currentSessionId, fetchStats } from './api.ts'

/** Translate a key with `{name}` placeholder substitution. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/** How the heatmap aggregates each cell. */
export type HeatMode = 'daily' | 'weekly' | 'cumulative'

/** The heatmap modes, in the order the switch shows them. */
export const HEAT_MODES: readonly HeatMode[] = ['daily', 'weekly', 'cumulative']

/** Props the `settings.section` registration injects. */
export interface UsageSectionProps {
  /** Translator bound to this plugin's locale namespace. */
  t?: Translate
}

/** Substitute `{name}` placeholders. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  )
}

/** Build a translator from a dictionary, falling back to a second one. */
export function makeTranslate(dict: Record<string, string>, fallback: Record<string, string>): Translate {
  return (key, params) => interpolate(dict[key] ?? fallback[key] ?? key, params)
}

/** Shift a `YYYY-MM-DD` key by whole days through UTC, so DST cannot skip one. */
function shiftDay(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10)
}

/** Day of week for a key, `0` = Sunday. */
function weekdayOf(key: string): number {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Format a day key without letting a local time zone shift it. */
function dayLabel(key: string, locale: string | undefined, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  )
}

/** One cell of the heatmap. */
interface HeatCell {
  /** Stable key: the day this cell represents. */
  key: string
  /** The day the cell is anchored on. */
  date: string
  /** The value the cell encodes under the active mode. */
  value: number
  /** Ramp step, `0`-`4`. */
  level: number
}

/** Quartile thresholds over the non-zero values, so the ramp spreads usefully. */
function quartiles(values: readonly number[]): [number, number, number] {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return [0, 0, 0]
  const at = (fraction: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!
  return [at(0.25), at(0.5), at(0.75)]
}

/** Map a value onto the five-step ramp. */
function levelOf(value: number, thresholds: readonly [number, number, number]): number {
  if (value <= 0) return 0
  if (value <= thresholds[0]) return 1
  if (value <= thresholds[1]) return 2
  if (value <= thresholds[2]) return 3
  return 4
}

/** One stacked heatmap block: six months of columns plus its own month axis. */
export interface HeatBlock {
  /** Cells in column-major fill order. */
  cells: HeatCell[]
  /** One entry per column, labelled only under the month it begins. */
  months: Array<{ key: string; label: string }>
}

/** The heatmap's built grid. */
export interface HeatGrid {
  /** The stacked blocks, earliest first. */
  blocks: HeatBlock[]
  /** Total columns across every block. */
  columnCount: number
}

/** How many stacked blocks a year is split into. Two blocks of six months. */
export const HEAT_BLOCKS = 2

/**
 * Label the column that contains a month's first day.
 *
 * Anchoring on "the first of the month is in this column" rather than "the
 * month changed since the previous column" is what makes the split safe: a
 * column is seven days, so it holds at most one first-of-month, each month is
 * named exactly once, and a block that starts mid-month simply stays unlabelled
 * until the next month begins rather than repeating the month its predecessor
 * already named.
 * @param cells - The block's cells, column-major.
 * @param windowFrom - First day the window covers.
 * @param windowTo - Last day the window covers.
 * @param locale - Locale for the month name.
 * @returns One label slot per column.
 */
function monthLabels(
  cells: readonly HeatCell[],
  windowFrom: string,
  windowTo: string,
  locale?: string,
): Array<{ key: string; label: string }> {
  const months: Array<{ key: string; label: string }> = []
  for (let index = 0; index < cells.length; index += 7) {
    const column = cells.slice(index, index + 7)
    const startsMonth = column.find(
      (cell) => cell.date.endsWith('-01') && cell.date >= windowFrom && cell.date <= windowTo,
    )
    months.push({
      key: column[0]!.date,
      label: startsMonth === undefined ? '' : dayLabel(startsMonth.date, locale, { month: 'short' }),
    })
  }
  return months
}

/**
 * Build the heatmap as stacked six-month blocks.
 *
 * Both ends are padded to whole weeks: the first column back to its Sunday and
 * the last forward to its Saturday. The grid fills column-major over exactly
 * seven rows, so an unpadded end would leave a short final column — harmless in
 * CSS, but it makes the grid's shape depend on which weekday "today" happens to
 * be. Cumulative padding carries the final total forward so the series stays
 * monotonic.
 *
 * The split is by COLUMN, not by calendar month. Twelve months is 52 or 53
 * weeks, which does not divide in half evenly; splitting on a month boundary
 * would put 27 columns in one block and 26 in the other, and because the
 * columns are fluid that would give the two blocks visibly different cell
 * sizes. Halving the week count keeps them within one column of each other.
 * @param snapshot - The snapshot carrying the day buckets and window.
 * @param mode - How each cell aggregates.
 * @param locale - Locale for the month names.
 * @returns The stacked blocks plus the total column count.
 */
export function buildHeatmap(snapshot: UsageSnapshot, mode: HeatMode, locale?: string): HeatGrid {
  const byDate = new Map<string, DayUsage>()
  for (const day of snapshot.days) byDate.set(day.date, day)

  const windowFrom = snapshot.heatmap.from
  const windowTo = snapshot.heatmap.to
  let cursor = shiftDay(windowFrom, -weekdayOf(windowFrom))

  const weekly = new Map<string, number>()
  if (mode === 'weekly') {
    for (const [date, day] of byDate) {
      const week = shiftDay(date, -weekdayOf(date))
      weekly.set(week, (weekly.get(week) ?? 0) + day.totalTokens)
    }
  }

  const days: Array<{ date: string; value: number }> = []
  let running = 0
  while (cursor <= windowTo) {
    const tokens = byDate.get(cursor)?.totalTokens ?? 0
    running += tokens
    const value = mode === 'weekly' ? (weekly.get(cursor) ?? 0) : mode === 'cumulative' ? running : tokens
    days.push({ date: cursor, value })
    cursor = shiftDay(cursor, 1)
  }
  while (days.length % 7 !== 0) {
    days.push({ date: cursor, value: mode === 'cumulative' ? running : 0 })
    cursor = shiftDay(cursor, 1)
  }

  const thresholds = quartiles(days.map((day) => day.value))
  const cells: HeatCell[] = days.map((day) => ({
    key: day.date,
    date: day.date,
    value: day.value,
    level: levelOf(day.value, thresholds),
  }))

  const columnCount = cells.length / 7
  const perBlock = Math.ceil(columnCount / HEAT_BLOCKS)
  const blocks: HeatBlock[] = []
  for (let column = 0; column < columnCount; column += perBlock) {
    const slice = cells.slice(column * 7, Math.min(columnCount, column + perBlock) * 7)
    blocks.push({ cells: slice, months: monthLabels(slice, windowFrom, windowTo, locale) })
  }
  return { blocks, columnCount }
}

/** Props for {@link UsageView}, the pure presentation component. */
export interface UsageViewProps {
  /** Translator bound to this plugin's locale namespace. */
  t: Translate
  /** Locale used for number and date formatting. */
  locale?: string
  /** The snapshot to render; `undefined` while the first read is in flight. */
  snapshot?: UsageSnapshot
  /** Whether a read is in flight. */
  loading: boolean
  /** Failure text from the last read, when it failed. */
  error?: string
  /** Whether the failure is a Host half older than this browser half. */
  staleHost?: boolean
  /** Called when the user asks for a fresh read. */
  onRefresh: () => void
}

/**
 * Render the usage page from an already-computed snapshot.
 *
 * Split from {@link UsageSection} on purpose: everything Codex-shaped lives
 * here and takes its data as a prop, so the layout can be rendered and asserted
 * without a Host, a network, or a browser.
 * @param props - Snapshot plus the refresh callback.
 * @returns The panel element.
 */
export function UsageView(props: UsageViewProps): ReactNode {
  const { t, snapshot, loading, error, staleHost, locale } = props
  const [mode, setMode] = useState<HeatMode>('daily')
  const [hovered, setHovered] = useState<string | undefined>(undefined)

  const header = createElement(
    'header',
    { className: 'tdd-head' },
    createElement(
      'div',
      null,
      createElement('h2', { className: 'tdd-title' }, t('title')),
      snapshot === undefined
        ? null
        : createElement(
            'div',
            { className: 'tdd-stamp' },
            `${interpolate(t('updatedAt'), {
              time: formatAbsoluteTime(new Date(snapshot.generatedAt), new Date(), locale),
            })} \u00b7 ${interpolate(t('scanTook'), { ms: String(snapshot.elapsedMs) })}`,
          ),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'tdd-btn',
        disabled: loading,
        onClick: () => {
          props.onRefresh()
        },
      },
      loading ? t('refreshing') : t('refresh'),
    ),
  )

  if (error !== undefined && snapshot === undefined) {
    // A Host half older than this browser half is not a failure the user can
    // retry away — it needs a DSH restart — so it says so instead of offering
    // a button that cannot help.
    return createElement(
      'div',
      { className: 'tdd' },
      header,
      createElement(
        'div',
        { className: 'tdd-error' },
        createElement('div', { className: 'tdd-error-title' }, staleHost === true ? t('staleHostTitle') : t('errTitle')),
        createElement('div', { className: 'tdd-sub' }, staleHost === true ? t('staleHostHint') : error),
        staleHost === true ? null : createElement('div', { className: 'tdd-sub' }, t('errHint')),
      ),
    )
  }

  if (snapshot === undefined) {
    return createElement(
      'div',
      { className: 'tdd' },
      header,
      createElement('div', { className: 'tdd-skeleton' }, t('refreshing')),
    )
  }

  return createElement(
    'div',
    { className: 'tdd' },
    header,
    createElement(Identity, { identity: snapshot.identity }),
    createElement(StatBar, { snapshot, t, locale }),
    createElement(Activity, { snapshot, t, locale, mode, setMode, hovered, setHovered }),
    createElement(Insights, { snapshot, t, locale }),
    snapshot.warnings.length === 0
      ? null
      : createElement(
          'div',
          { className: 'tdd-section' },
          createElement('div', { className: 'tdd-section-title' }, t('warningsTitle')),
          ...snapshot.warnings.slice(0, 4).map((warning, index) =>
            createElement('div', { className: 'tdd-warn', key: `${index}-${warning}` }, warning),
          ),
        ),
    error === undefined ? null : createElement('div', { className: 'tdd-warn' }, `${t('staleHint')} (${error})`),
  )
}

/** The centred avatar / display name / handle block. */
function Identity({ identity }: { identity: UsageSnapshot['identity'] }): ReactNode {
  if (identity === undefined) return null
  const initial = (identity.name ?? identity.handle ?? '').trim().slice(0, 1)
  const avatar =
    identity.avatarUrl === undefined
      ? createElement('div', { className: 'tdd-avatar tdd-avatar-fallback' }, initial)
      : createElement('img', {
          className: 'tdd-avatar',
          src: identity.avatarUrl,
          alt: identity.name ?? 'avatar',
          referrerPolicy: 'no-referrer',
        })
  return createElement(
    'div',
    { className: 'tdd-identity' },
    avatar,
    identity.name === undefined ? null : createElement('div', { className: 'tdd-name' }, identity.name),
    identity.handle === undefined ? null : createElement('div', { className: 'tdd-handle' }, identity.handle),
  )
}

/** The five-cell all-time headline bar. */
function StatBar({ snapshot, t, locale }: { snapshot: UsageSnapshot; t: Translate; locale?: string }): ReactNode {
  const { profile } = snapshot
  const dayCount = (n: number): string => interpolate(t(n === 1 ? 'dayOne' : 'days'), { n: localeCount(n, locale) })
  const stats: Array<{ value: string; label: string }> = [
    { value: localeCompact(profile.lifetimeTokens, locale), label: t('statLifetime') },
    { value: localeCompact(profile.peakDailyTokens, locale), label: t('statPeak') },
    { value: localeDuration(profile.longestTurnSeconds, locale), label: t('statLongest') },
    { value: dayCount(profile.longestStreakDays), label: t('statLongestStreak') },
    { value: dayCount(profile.currentStreakDays), label: t('statCurrentStreak') },
  ]
  return createElement(
    'div',
    { className: 'tdd-stats' },
    ...stats.map((stat) =>
      createElement(
        'div',
        { className: 'tdd-stat', key: stat.label },
        createElement('div', { className: 'tdd-stat-value' }, stat.value),
        createElement('div', { className: 'tdd-stat-label' }, stat.label),
      ),
    ),
  )
}

/** The `Token activity` heatmap and its daily / weekly / cumulative switch. */
function Activity({
  snapshot,
  t,
  locale,
  mode,
  setMode,
  hovered,
  setHovered,
}: {
  snapshot: UsageSnapshot
  t: Translate
  locale?: string
  mode: HeatMode
  setMode: (mode: HeatMode) => void
  hovered: string | undefined
  setHovered: (key: string | undefined) => void
}): ReactNode {
  const grid = useMemo(() => buildHeatmap(snapshot, mode, locale), [snapshot, mode, locale])
  const active = grid.blocks.flatMap((block) => block.cells).find((cell) => cell.key === hovered)

  return createElement(
    'section',
    { className: 'tdd-section' },
    createElement(
      'div',
      { className: 'tdd-section-head' },
      createElement('div', { className: 'tdd-section-title' }, t('activity')),
      createElement(
        'div',
        { className: 'tdd-tabs', role: 'group' },
        ...HEAT_MODES.map((candidate) =>
          createElement(
            'button',
            {
              key: candidate,
              type: 'button',
              className: 'tdd-tab',
              'aria-pressed': candidate === mode,
              onClick: () => {
                setMode(candidate)
              },
            },
            t(candidate === 'daily' ? 'modeDaily' : candidate === 'weekly' ? 'modeWeekly' : 'modeCumulative'),
          ),
        ),
      ),
    ),
    createElement(
      'div',
      { className: 'tdd-heat' },
      // Two stacked six-month blocks. Splitting the year in half is what lets
      // every column stay wide enough to read without the row overflowing.
      createElement(
        'div',
        { className: 'tdd-heat-blocks' },
        ...grid.blocks.map((block, blockIndex) =>
          createElement(
            'div',
            { className: 'tdd-heat-block', key: block.cells[0]?.date ?? blockIndex },
            createElement(
              'div',
              { className: 'tdd-heat-grid', role: 'img', 'aria-label': t('activity') },
              ...block.cells.map((cell) =>
                createElement('div', {
                  key: cell.key,
                  className: 'tdd-cell',
                  'data-level': cell.level,
                  title: interpolate(t('cellTooltip'), {
                    date: dayLabel(cell.date, locale, { year: 'numeric', month: 'short', day: 'numeric' }),
                    value: localeCount(cell.value, locale),
                  }),
                  onMouseEnter: () => {
                    setHovered(cell.key)
                  },
                  onMouseLeave: () => {
                    setHovered(undefined)
                  },
                }),
              ),
            ),
            createElement(
              'div',
              { className: 'tdd-heat-months', 'aria-hidden': 'true' },
              ...block.months.map((month) =>
                createElement('span', { className: 'tdd-heat-month', key: month.key }, month.label),
              ),
            ),
          ),
        ),
      ),
      createElement(
        'div',
        { className: 'tdd-heat-foot' },
        createElement(
          'span',
          null,
          active === undefined
            ? ''
            : `${dayLabel(active.date, locale, { year: 'numeric', month: 'short', day: 'numeric' })} \u00b7 ${localeCount(active.value, locale)} tokens`,
        ),
        createElement(
          'span',
          { className: 'tdd-heat-legend' },
          createElement('span', null, t('less')),
          ...[0, 1, 2, 3, 4].map((level) =>
            createElement('span', { key: level, className: 'tdd-cell', 'data-level': level }),
          ),
          createElement('span', null, t('more')),
        ),
      ),
    ),
  )
}

/** One `label  value` row. */
function Row({ name, value }: { name: string; value: string }): ReactNode {
  return createElement(
    'div',
    { className: 'tdd-row' },
    createElement('div', { className: 'tdd-row-name', title: name }, name),
    createElement('div', { className: 'tdd-row-value' }, value),
  )
}

/** The two-column `Insights` / most-used footer. */
function Insights({ snapshot, t, locale }: { snapshot: UsageSnapshot; t: Translate; locale?: string }): ReactNode {
  const { insights, profile, cache } = snapshot
  const topReasoning = insights.reasoning[0]
  const topModel = insights.models[0]
  /** A reasoning share is a share of outgoing requests. */
  const requestShare = (share: Share): string =>
    interpolate(t('shareRequests'), { value: share.label, pct: share.share.toFixed(0) })
  /** A model share is a share of tokens, which is what a usage panel ranks on. */
  const tokenShare = (share: Share): string =>
    interpolate(t('shareTokens'), { value: share.label, pct: share.share.toFixed(0) })

  const insightRows: ReactNode[] = [
    createElement(Row, {
      key: 'reasoning',
      name: t('statReasoning'),
      value: topReasoning === undefined ? t('none') : requestShare(topReasoning),
    }),
    createElement(Row, {
      key: 'model',
      name: t('statModels'),
      value: topModel === undefined ? t('none') : tokenShare(topModel),
    }),
    createElement(Row, {
      key: 'explored',
      name: t('statSkillsExplored'),
      value: localeCount(insights.skillsExplored, locale),
    }),
    createElement(Row, {
      key: 'skills',
      name: t('statSkillsTotal'),
      value: localeCount(insights.skillsTotal, locale),
    }),
    createElement(Row, { key: 'chats', name: t('statChats'), value: localeCount(profile.sessions, locale) }),
    createElement(Row, { key: 'turns', name: t('statTurns'), value: localeCount(profile.turns, locale) }),
    ...(cache.hitRate === undefined
      ? []
      : [
          createElement(Row, {
            key: 'cache',
            name: t('statCache'),
            value: `${cache.hitRate.toFixed(1)}%`,
          }),
        ]),
  ]

  const usedRows: ReactNode[] =
    insights.topSkills.length === 0
      ? [createElement('div', { className: 'tdd-empty', key: 'empty' }, t('none'))]
      : insights.topSkills.slice(0, 8).map((skill) =>
          createElement(Row, {
            key: skill.name,
            name: `$${skill.name}`,
            value: interpolate(t(skill.runs === 1 ? 'runOne' : 'runs'), { n: localeCount(skill.runs, locale) }),
          }),
        )

  return createElement(
    'div',
    { className: 'tdd-cols' },
    createElement(
      'div',
      { className: 'tdd-col' },
      createElement('div', { className: 'tdd-col-title' }, t('insights')),
      createElement('div', { className: 'tdd-rows' }, ...insightRows),
    ),
    createElement(
      'div',
      { className: 'tdd-col' },
      createElement('div', { className: 'tdd-col-title' }, t('mostUsed')),
      createElement('div', { className: 'tdd-rows' }, ...usedRows),
    ),
  )
}

/** Props for {@link UsageSection}. */
export interface UsageSectionOptions extends UsageSectionProps {
  /** Dictionary resolved for the active language. */
  dictionary?: Record<string, string>
  /** Fallback dictionary, normally English. */
  fallbackDictionary?: Record<string, string>
}

/**
 * The settings page: fetch a snapshot, then hand it to {@link UsageView}.
 * @param props - Injected translator and dictionaries.
 * @returns The panel element.
 */
export function UsageSection(props: UsageSectionOptions): ReactNode {
  const t = useMemo<Translate>(
    () => props.t ?? makeTranslate(props.dictionary ?? {}, props.fallbackDictionary ?? {}),
    [props.t, props.dictionary, props.fallbackDictionary],
  )

  const [snapshot, setSnapshot] = useState<UsageSnapshot | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [staleHost, setStaleHost] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  const locale = typeof navigator === 'undefined' ? undefined : navigator.language

  const sessionId = useMemo(() => currentSessionId(), [])
  const timeZone = useMemo(() => browserTimeZone(), [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    void fetchStats(timeZone, sessionId, controller.signal)
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setSnapshot(result.snapshot)
          setError(undefined)
          setStaleHost(false)
        } else {
          setError(result.error)
          setStaleHost(result.staleHost === true)
        }
      })
      .catch(() => {
        /* aborted by a newer request; the newer one owns the state */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [timeZone, sessionId, reloadToken])

  return createElement(UsageView, {
    t,
    locale,
    snapshot,
    loading,
    error,
    staleHost,
    onRefresh: () => {
      setReloadToken((token) => token + 1)
    },
  })
}
