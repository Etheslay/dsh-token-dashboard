/**
 * The usage panel.
 *
 * The shape is Codex's `/status` card: a two-column label/value list with a
 * dim label column, a blank-line section break, `% left` phrasing with zero
 * decimals, and the 20-cell `[███░░░]` bar. What changes is the content — DSH
 * has no provider rate-limit windows, credits, or plan, so those rows are gone.
 * The bar is kept, because context occupancy is a genuine 0-100% remaining
 * quantity and is exactly what the bar was built for.
 *
 * The big-numbers block and the activity chart are Codex's analytics Overview
 * (`summary_panel.rs`), whose five headline fields — `Lifetime tokens`,
 * `Peak tokens`, `Longest chat`, `Current streak`, `Longest streak` — every one
 * of them derivable from a DSH session log.
 *
 * @module dsh-token-dashboard/client/panel
 */
import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  barGlyph,
  compactAmount,
  countValue,
  formatAbsoluteTime,
  formatDuration,
  formatLimitSummary,
  formatPercent,
  formatTokensCompact,
  formatWithSeparators,
  percentOfContextWindowRemaining,
  renderLimitProgressBar,
  MISSING,
} from '../shared/format.ts'
import type { RangeKind, SessionRow, UsageSnapshot } from '../shared/types.ts'
import { RANGES, browserTimeZone, currentSessionId, fetchStats } from './api.ts'

/** Translate a key with `{name}` placeholder substitution. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/** Props the `settings.section` registration injects. */
export interface UsageSectionProps {
  /** Translator bound to this plugin's locale namespace. */
  t?: Translate
}

/** One row of the Codex label/value card. */
interface CardRow {
  label: string
  value: ReactNode
  /** Dim parenthetical appended after the value, Codex's `(…)` convention. */
  detail?: ReactNode
}

/** Substitute `{name}` placeholders. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  )
}

/** Build a translator from a dictionary, falling back to the key itself. */
export function makeTranslate(dict: Record<string, string>, fallback: Record<string, string>): Translate {
  return (key, params) => interpolate(dict[key] ?? fallback[key] ?? key, params)
}

/** Signed percentage change, or `undefined` when there is no baseline. */
function percentChange(current: number, previous: number): number | undefined {
  if (previous <= 0) return undefined
  return ((current - previous) / previous) * 100
}

/** `+18.4%` / `-3%`, always signed. */
function signedPercent(value: number): string {
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${value > 0 ? '+' : ''}${rounded}%`
}

/** The Codex token-usage value: `{total} total ` plus a dim `({i} input + {o} output)`. */
function tokenUsageParts(
  t: Translate,
  buckets: { uncachedInputTokens: number; outputTokens: number; totalTokens: number },
): { value: ReactNode; detail: ReactNode } {
  const blended = buckets.uncachedInputTokens + buckets.outputTokens
  return {
    value: interpolate(t('tokenUsageValue'), { total: formatTokensCompact(blended) }),
    detail: interpolate(t('tokenUsageDetail'), {
      input: formatTokensCompact(buckets.uncachedInputTokens),
      output: formatTokensCompact(buckets.outputTokens),
    }),
  }
}

/** Format a `YYYY-MM-DD` key as a short local date, without shifting the day. */
function shortDay(key: string, locale: string | undefined): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  )
}

/** Props for {@link UsageView}, the pure presentation component. */
export interface UsageViewProps {
  /** Translator bound to this plugin's locale namespace. */
  t: Translate
  /** Locale used for date and number formatting. */
  locale?: string
  /** The snapshot to render; `undefined` while the first read is in flight. */
  snapshot?: UsageSnapshot
  /** Selected window. */
  range: RangeKind
  /** Called when the user picks another window. */
  onRangeChange: (range: RangeKind) => void
  /** Called when the user asks for a fresh read. */
  onRefresh: () => void
  /** Whether a read is in flight. */
  loading: boolean
  /** Failure text from the last read, when it failed. */
  error?: string
}

/**
 * Render the usage page from an already-computed snapshot.
 *
 * Split from {@link UsageSection} on purpose: everything Codex-shaped lives
 * here and takes its data as a prop, so the formatting rules can be rendered and
 * asserted without a Host, a network, or a browser.
 * @param props - Snapshot plus control callbacks.
 * @returns The panel element.
 */
export function UsageView(props: UsageViewProps): ReactNode {
  const { t, snapshot, range, loading, error, locale } = props
  // Which day the activity chart calls out. Local to the view, so hovering a
  // bar never refetches anything.
  const [activeDay, setActiveDay] = useState<string | undefined>(undefined)

  const header = createElement(
    'header',
    { className: 'tdd-head' },
    createElement(
      'div',
      { className: 'tdd-headtext' },
      createElement('h2', { className: 'tdd-title' }, t('title')),
      createElement('p', { className: 'tdd-sub' }, t('subtitle')),
    ),
    createElement(
      'div',
      { className: 'tdd-controls' },
      createElement(
        'div',
        { className: 'tdd-ranges', role: 'group' },
        ...RANGES.map((kind) =>
          createElement(
            'button',
            {
              key: kind,
              type: 'button',
              className: 'tdd-range',
              'aria-pressed': kind === range,
              onClick: () => {
                props.onRangeChange(kind)
              },
            },
            t(`range${kind === 'today' ? 'Today' : kind === '7d' ? '7d' : kind === '30d' ? '30d' : 'All'}`),
          ),
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
      snapshot === undefined
        ? null
        : createElement(
            'span',
            { className: 'tdd-stamp' },
            `${interpolate(t('updatedAt'), {
              time: formatAbsoluteTime(new Date(snapshot.generatedAt), new Date(), locale),
            })} · ${interpolate(t('scanTook'), { ms: String(snapshot.elapsedMs) })}`,
          ),
    ),
  )

  if (error !== undefined && snapshot === undefined) {
    return createElement(
      'div',
      { className: 'tdd' },
      header,
      createElement(
        'div',
        { className: 'tdd-error' },
        createElement('div', { className: 'tdd-error-title' }, t('errTitle')),
        createElement('div', { className: 'tdd-sub' }, error),
        createElement('div', { className: 'tdd-sub' }, t('errHint')),
        createElement(
          'button',
          {
            type: 'button',
            className: 'tdd-btn',
            style: { marginTop: '10px' },
            onClick: () => {
              props.onRefresh()
            },
          },
          t('retry'),
        ),
      ),
    )
  }

  if (snapshot === undefined) {
    return createElement(
      'div',
      { className: 'tdd' },
      header,
      createElement('div', { className: 'tdd-skeleton' }, t('loading')),
    )
  }

  return createElement(
    'div',
    { className: 'tdd' },
    header,
    createElement(Card, { snapshot, t }),
    createElement(Figures, { snapshot, t }),
    createElement(Activity, { snapshot, t, locale, activeDay, setActiveDay }),
    createElement(Breakdowns, { snapshot, t }),
    createElement(RecentSessions, { snapshot, t, locale }),
    snapshot.warnings.length === 0
      ? null
      : createElement(
          'div',
          { className: 'tdd-section' },
          createElement('div', { className: 'tdd-section-title' }, t('warningsTitle')),
          ...snapshot.warnings.slice(0, 6).map((warning, index) =>
            createElement('div', { className: 'tdd-warn', key: `${index}-${warning}` }, warning),
          ),
        ),
    error === undefined ? null : createElement('div', { className: 'tdd-warn' }, `${t('staleHint')} (${error})`),
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

  const [range, setRange] = useState<RangeKind>('30d')
  const [snapshot, setSnapshot] = useState<UsageSnapshot | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  const locale = typeof navigator === 'undefined' ? undefined : navigator.language

  const sessionId = useMemo(() => currentSessionId(), [])
  const timeZone = useMemo(() => browserTimeZone(), [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    void fetchStats(range, timeZone, sessionId, controller.signal)
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setSnapshot(result.snapshot)
          setError(undefined)
        } else {
          setError(result.error)
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
  }, [range, timeZone, sessionId, reloadToken])

  return createElement(UsageView, {
    t,
    locale,
    snapshot,
    range,
    loading,
    error,
    onRangeChange: setRange,
    onRefresh: () => {
      setReloadToken((token) => token + 1)
    },
  })
}

/** The dominant model route in the window, if any. */
function dominantRoute(snapshot: UsageSnapshot): { provider: string; model: string } | undefined {
  const top = snapshot.models[0]
  return top === undefined ? undefined : { provider: top.provider, model: top.model }
}

/** The session whose context occupancy the card reports. */
function contextSession(snapshot: UsageSnapshot): SessionRow | undefined {
  return snapshot.sessions.find((session) => session.current === true && session.context !== undefined)
    ?? snapshot.sessions.find((session) => session.context !== undefined)
}

/** The Codex `/status` label/value card. */
function Card({ snapshot, t }: { snapshot: UsageSnapshot; t: Translate }): ReactNode {
  const rows: CardRow[] = []
  const route = dominantRoute(snapshot)
  const topWorkspace = snapshot.workspaces[0]

  rows.push({ label: t('model'), value: route?.model ?? MISSING })
  rows.push({ label: t('modelProvider'), value: route?.provider ?? MISSING })
  if (snapshot.agentPreset !== undefined) rows.push({ label: t('preset'), value: snapshot.agentPreset })
  rows.push({
    label: t('directory'),
    value: topWorkspace?.cwd || MISSING,
    detail:
      snapshot.workspaces.length > 1
        ? interpolate(t('moreDirectories'), { n: countValue(snapshot.workspaces.length - 1) })
        : undefined,
  })
  rows.push({
    label: t('session'),
    value: `${countValue(snapshot.totals.sessions)} · ${countValue(snapshot.totals.turns)} ${t('turnsCount').toLowerCase()}`,
  })

  const usage = tokenUsageParts(t, snapshot.totals)
  rows.push({ label: t('tokenUsage'), value: usage.value, detail: usage.detail })

  const withContext = contextSession(snapshot)
  if (withContext?.context?.window !== undefined) {
    const { tokensInContext, window: contextWindow } = withContext.context
    const percent = percentOfContextWindowRemaining(tokensInContext, contextWindow)
    rows.push({
      label: t('contextWindow'),
      value: createElement(
        'span',
        { className: 'tdd-mono' },
        `${renderLimitProgressBar(percent)} ${formatLimitSummary(percent)}`,
      ),
      detail: `(${formatTokensCompact(tokensInContext)} used / ${formatTokensCompact(contextWindow)})`,
    })
  } else {
    rows.push({ label: t('contextWindow'), value: createElement('span', { className: 'tdd-dim' }, t('noContext')) })
  }

  if (snapshot.cache.hitRate !== undefined) {
    const percent = Math.max(0, Math.min(100, snapshot.cache.hitRate))
    rows.push({
      label: t('cache'),
      value: createElement(
        'span',
        { className: 'tdd-mono' },
        `${renderLimitProgressBar(percent)} ${percent.toFixed(0)}% hit`,
      ),
      detail: interpolate(t('cacheDetail'), {
        read: formatTokensCompact(snapshot.cache.readTokens),
        prompt: formatTokensCompact(snapshot.cache.promptTokens),
      }),
    })
  }

  if (snapshot.totals.reasoningTokens > 0) {
    rows.push({
      label: t('reasoning'),
      value: `${formatTokensCompact(snapshot.totals.reasoningTokens)} tokens`,
      detail: formatPercent((snapshot.totals.reasoningTokens / Math.max(1, snapshot.totals.outputTokens)) * 100),
    })
  }

  // A comparison against a zero baseline says nothing, so the row is omitted
  // rather than rendered as "— 0 vs previous".
  if (snapshot.previous !== undefined && snapshot.previous.totalTokens > 0) {
    const change = percentChange(snapshot.totals.totalTokens, snapshot.previous.totalTokens)
    rows.push({
      label: t('rangeOf'),
      value:
        change === undefined
          ? MISSING
          : createElement(
              'span',
              { className: change >= 0 ? 'tdd-accent' : 'tdd-dim' },
              signedPercent(change),
            ),
      detail: interpolate(t('rangeCompare'), { delta: formatTokensCompact(snapshot.previous.totalTokens) }),
    })
  }

  return createElement(
    'div',
    { className: 'tdd-card' },
    ...rows.flatMap((row) => [
      createElement('span', { className: 'tdd-label', key: `${row.label}-l` }, row.label),
      createElement(
        'span',
        { className: 'tdd-value', key: `${row.label}-v` },
        row.value,
        row.detail === undefined ? null : createElement('span', { className: 'tdd-dim' }, ' ', row.detail),
      ),
    ]),
  )
}

/** Codex's analytics headline row: five big numbers with captions. */
function Figures({ snapshot, t }: { snapshot: UsageSnapshot; t: Translate }): ReactNode {
  const { profile } = snapshot
  /** `1 day` rather than `1 days`; other locales use the same key for both. */
  const dayCount = (n: number): string => interpolate(t(n === 1 ? 'dayOne' : 'days'), { n: countValue(n) })
  const figures: Array<{ value: string; label: string }> = [
    { value: compactAmount(profile.lifetimeTokens), label: t('lifetimeTokens') },
    { value: compactAmount(profile.peakDailyTokens), label: t('peakTokens') },
    { value: formatDuration(profile.longestTurnSeconds), label: t('longestChat') },
    { value: dayCount(profile.currentStreakDays), label: t('currentStreak') },
    { value: dayCount(profile.longestStreakDays), label: t('longestStreak') },
  ]
  return createElement(
    'div',
    { className: 'tdd-figures' },
    ...figures.map((figure) =>
      createElement(
        'div',
        { className: 'tdd-figure', key: figure.label },
        createElement('div', { className: 'tdd-figure-value' }, figure.value),
        createElement('div', { className: 'tdd-figure-label' }, figure.label),
      ),
    ),
  )
}

/** Codex's `Token activity` chart, drawn with the same glyph ramp. */
function Activity({
  snapshot,
  t,
  locale,
  activeDay,
  setActiveDay,
}: {
  snapshot: UsageSnapshot
  t: Translate
  locale?: string
  activeDay: string | undefined
  setActiveDay: (day: string | undefined) => void
}): ReactNode {
  const days = snapshot.days
  const max = days.reduce((peak, day) => Math.max(peak, day.totalTokens), 0)

  if (days.length === 0) {
    return createElement(
      'section',
      { className: 'tdd-section' },
      createElement('div', { className: 'tdd-section-title' }, t('activityTitle')),
      createElement('div', { className: 'tdd-empty' }, t('activityEmpty')),
    )
  }

  const selected = days.find((day) => day.date === activeDay) ?? days[days.length - 1]
  const first = days[0]
  const last = days[days.length - 1]

  return createElement(
    'section',
    { className: 'tdd-section' },
    createElement('div', { className: 'tdd-section-title' }, t('activityTitle')),
    createElement('div', { className: 'tdd-section-note' }, interpolate(t('activitySince'), { n: countValue(days.length) })),
    createElement(
      'div',
      { className: 'tdd-chart' },
      createElement(
        'div',
        { className: 'tdd-chart-row', role: 'img' },
        ...days.map((day) =>
          createElement(
            'button',
            {
              key: day.date,
              type: 'button',
              className: 'tdd-bar',
              'data-active': day.date === selected?.date,
              title: `${day.date} · ${formatWithSeparators(day.totalTokens, locale)} tokens`,
              onMouseEnter: () => {
                setActiveDay(day.date)
              },
              onFocus: () => {
                setActiveDay(day.date)
              },
            },
            barGlyph(day.totalTokens, max),
          ),
        ),
      ),
      // The baseline shares the bars' flex geometry so it lines up under them
      // instead of running past the last column.
      createElement(
        'div',
        { className: 'tdd-chart-row tdd-baseline', 'aria-hidden': 'true' },
        ...days.map((day) => createElement('span', { className: 'tdd-axis', key: day.date }, '\u2500')),
      ),
      createElement(
        'div',
        { className: 'tdd-legend' },
        createElement('span', null, t('activityLess')),
        createElement('span', { className: 'tdd-mono', style: { color: 'var(--tdd-accent)' } }, '\u2581\u2583\u2585\u2587\u2588'),
        createElement('span', null, t('activityMore')),
        createElement(
          'span',
          { style: { marginLeft: '10px' } },
          `${first === undefined ? '' : shortDay(first.date, locale)} \u2192 ${last === undefined ? '' : shortDay(last.date, locale)}`,
        ),
      ),
      createElement(
        'div',
        { className: 'tdd-callout' },
        selected === undefined
          ? MISSING
          : createElement(
              'span',
              null,
              createElement('strong', null, shortDay(selected.date, locale)),
              ` · ${formatWithSeparators(selected.totalTokens, locale)} tokens`,
              createElement(
                'span',
                { className: 'tdd-dim' },
                ` · ${countValue(selected.turns)} ${t('turnsCount').toLowerCase()} · ${countValue(selected.responses)} responses`,
              ),
            ),
      ),
    ),
  )
}

/** Codex's `● {name} {pct}%` legend rows, for models and directories. */
function Breakdowns({ snapshot, t }: { snapshot: UsageSnapshot; t: Translate }): ReactNode {
  const total = Math.max(1, snapshot.totals.totalTokens)
  const section = (title: string, rows: Array<{ key: string; name: string; sub: string; tokens: number }>): ReactNode =>
    createElement(
      'section',
      { className: 'tdd-section', key: title },
      createElement('div', { className: 'tdd-section-title' }, title),
      createElement(
        'div',
        { className: 'tdd-legend-list' },
        ...rows.map((row) =>
          createElement(
            'div',
            { className: 'tdd-legend-row', key: row.key },
            createElement(
              'div',
              { className: 'tdd-legend-name' },
              createElement('span', { className: 'tdd-dot' }, '\u25CF'),
              createElement('span', { title: row.name }, row.name),
              createElement('span', { className: 'tdd-legend-sub' }, row.sub),
            ),
            createElement('div', { className: 'tdd-legend-pct' }, `${((row.tokens / total) * 100).toFixed(1)}%`),
          ),
        ),
      ),
    )

  const models = snapshot.models.slice(0, 8).map((model) => ({
    key: `${model.provider}/${model.model}`,
    name: model.model,
    sub: `${model.provider} · ${formatTokensCompact(model.totalTokens)} · ${countValue(model.responses)}`,
    tokens: model.totalTokens,
  }))
  const workspaces = snapshot.workspaces.slice(0, 6).map((workspace) => ({
    key: workspace.cwd,
    name: workspace.name,
    sub: `${formatTokensCompact(workspace.totalTokens)} · ${countValue(workspace.sessions)}`,
    tokens: workspace.totalTokens,
  }))

  if (models.length === 0 && workspaces.length === 0) {
    return createElement('div', { className: 'tdd-empty' }, t('breakdownEmpty'))
  }
  return createElement(
    'div',
    { className: 'tdd-block' },
    models.length === 0 ? null : section(t('byModel'), models),
    workspaces.length === 0 ? null : section(t('byWorkspace'), workspaces),
  )
}

/** The recent-session table. */
function RecentSessions({ snapshot, t, locale }: { snapshot: UsageSnapshot; t: Translate; locale?: string }): ReactNode {
  // A session that recorded neither tokens nor turns carries no information
  // worth a row; the store keeps plenty of those from aborted starts.
  const rows = snapshot.sessions.filter((session) => session.totalTokens > 0 || session.turns > 0)
  if (rows.length === 0) return null
  const header = createElement(
    'tr',
    null,
    createElement('th', null, t('session')),
    createElement('th', null, t('colTokens')),
    createElement('th', null, t('colTurns')),
    createElement('th', null, t('colModel')),
    createElement('th', null, t('colUpdated')),
  )
  const body = rows.map((session) =>
    createElement(
      'tr',
      { key: session.id },
      createElement(
        'td',
        null,
        createElement(
          'div',
          { className: 'tdd-session-name' },
          createElement(
            'span',
            { className: 'tdd-session-title', title: session.title ?? session.id },
            session.title ?? t('untitled'),
          ),
          session.current === true ? createElement('span', { className: 'tdd-tag' }, t('currentSession')) : null,
        ),
        createElement('div', { className: 'tdd-path', title: session.cwd }, session.cwd),
      ),
      createElement('td', { className: 'tdd-num' }, formatTokensCompact(session.totalTokens)),
      createElement('td', { className: 'tdd-num' }, countValue(session.turns)),
      createElement('td', { className: 'tdd-num' }, session.routes[0]?.model ?? MISSING),
      createElement(
        'td',
        { className: 'tdd-num' },
        formatAbsoluteTime(new Date(session.updatedAt), new Date(), locale),
      ),
    ),
  )
  return createElement(
    'section',
    { className: 'tdd-section' },
    createElement('div', { className: 'tdd-section-title' }, t('recentSessions')),
    createElement('table', { className: 'tdd-table' }, createElement('thead', null, header), createElement('tbody', null, ...body)),
  )
}

/** Ref kept for future polling work; deliberately unused for now. */
