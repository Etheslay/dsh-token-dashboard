/**
 * Folding a decoded session log into usage numbers.
 *
 * The bucket arithmetic is a deliberate line-by-line port of DSH's own
 * `tokenUsageProjectionDefinition` (`@deepseek-ai/dsh-token-meter`,
 * `src/usage-projection.ts`). Two rules from that projection are the whole
 * reason this module exists rather than a simpler sum:
 *
 *   - A later settlement in the SAME `(turn, step)` REPLACES the earlier
 *     sample instead of adding to it. A streamed message reports usage more
 *     than once; summing them double-counts the same call.
 *   - `llm/retry-started` closes the replacement slot, so the retried attempt
 *     contributes a second, separately billed sample for that step.
 *
 * Ignoring either rule produces totals that disagree with what the harness
 * itself reports, which is exactly the bug a usage dashboard cannot afford.
 *
 * Beyond the totals, this fold also attributes each contribution to a local
 * day and to a model route so the panel can chart history. Those are extra
 * indexes over the same arithmetic — the totals never depend on them.
 *
 * @module dsh-token-dashboard/host/fold
 */
import type { RawLogEvent } from './session-log.ts'
import type {
  ContextPressure,
  CountedBuckets,
  DayRouteUsage,
  DayUsage,
  RouteUsage,
  TokenBuckets,
} from '../shared/types.ts'

/** Mutable accumulator with the raw projection bucket names. */
interface Buckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/** A contribution the fold may later have to reverse. */
interface Contribution {
  turn: number
  step: number
  buckets: Buckets
  /** Local day key the contribution was charged to. */
  day: string
  /** Provider the contribution was charged to. */
  provider: string
  /** Model the contribution was charged to. */
  model: string
}

/** One route's running totals, plus its display identity. */
interface RouteAccumulator {
  provider: string
  model: string
  responses: number
  buckets: Buckets
}

/** One day's running totals. */
interface DayAccumulator {
  buckets: Buckets
  turns: number
  responses: number
}

/** One `(day, route)` cell, so a range-filtered model breakdown stays exact. */
interface DayRouteAccumulator {
  date: string
  provider: string
  model: string
  responses: number
  buckets: Buckets
}

/** The fold's complete result for one session. */
export interface SessionFold {
  /** Projection-equivalent totals for the whole log. */
  totals: CountedBuckets
  /** Per-route totals, insertion-ordered by first appearance. */
  routes: Map<string, RouteAccumulator>
  /** Per-day totals keyed by `YYYY-MM-DD` in the requested zone. */
  days: Map<string, DayAccumulator>
  /**
   * Per-`(day, route)` totals, keyed by `date\0provider\0model`.
   *
   * Kept separately from {@link SessionFold.routes} because a range-filtered
   * model breakdown must not attribute the whole log's tokens to the days that
   * happen to fall inside the window.
   */
  dayRoutes: Map<string, DayRouteAccumulator>
  /** Turns started in the log. */
  turns: number
  /** Turns that reached a `turn/end`, and so have a measurable duration. */
  completedTurns: number
  /** Assistant settlements recorded in the log. */
  responses: number
  /** Wall-clock duration of the longest completed turn, in milliseconds. */
  longestTurnMs: number
  /** Newest observed context occupancy. */
  context?: ContextPressure
  /** Session title, when the log carries one. */
  title?: string
  /**
   * Reasoning effort per request, keyed by the configured label.
   *
   * Read from `request/header`, which is written once per outgoing request
   * envelope, so the tally counts requests rather than messages.
   */
  efforts: Map<string, number>
  /** Skill invocations, keyed by skill name. */
  skills: Map<string, number>
  /** Epoch milliseconds of the newest event. */
  updatedAt: number
  /** Lines that failed to parse; a truncated live tail is normal. */
  malformed: number
}

/** Options controlling day bucketing. */
export interface FoldOptions {
  /** IANA zone used to derive day keys. */
  timeZone: string
}

const zeroBuckets = (): Buckets => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
})

/** Sum the four billed buckets plus reasoning; reasoning is not added twice. */
function totalOf(buckets: Buckets): number {
  return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens
}

/** Detach a mutable bucket record for storage on the wire. */
function counted(buckets: Buckets): CountedBuckets {
  return { ...buckets, totalTokens: totalOf(buckets) }
}

const addInto = (target: Buckets, delta: Buckets, sign: 1 | -1): void => {
  target.uncachedInputTokens += sign * delta.uncachedInputTokens
  target.outputTokens += sign * delta.outputTokens
  target.cacheReadTokens += sign * delta.cacheReadTokens
  target.cacheWriteTokens += sign * delta.cacheWriteTokens
  target.reasoningTokens += sign * delta.reasoningTokens
}

const bucketsEqual = (left: Buckets, right: Buckets): boolean =>
  left.uncachedInputTokens === right.uncachedInputTokens &&
  left.outputTokens === right.outputTokens &&
  left.cacheReadTokens === right.cacheReadTokens &&
  left.cacheWriteTokens === right.cacheWriteTokens &&
  left.reasoningTokens === right.reasoningTokens

/** Read a finite non-negative integer, or `undefined`. */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Narrow an unknown value to a plain object. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

/**
 * Codex/Dsh bucket mapping: DSH reports `inputTokens` ALREADY excluding cache
 * traffic, so it lands directly on `uncachedInputTokens` with no subtraction.
 */
function bucketsFrom(usage: Record<string, unknown>): Buckets {
  return {
    uncachedInputTokens: count(usage['inputTokens']) ?? 0,
    outputTokens: count(usage['outputTokens']) ?? 0,
    cacheReadTokens: count(usage['cacheReadTokens']) ?? 0,
    cacheWriteTokens: count(usage['cacheWriteTokens']) ?? 0,
    reasoningTokens: count(usage['reasoningTokens']) ?? 0,
  }
}

/**
 * Port of `lastAssistantStreamChunk(stream, 'usage')?.usage`.
 *
 * A settlement that carries no top-level `usage` embeds the provider sample in
 * its stream instead; the LAST such record wins.
 * @param stream - The settlement's compact stream records.
 * @returns The usage object, or `undefined`.
 */
function streamUsage(stream: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index--) {
    const record = asRecord(stream[index])
    if (record?.['type'] !== 'chunk') continue
    const chunk = asRecord(record['chunk'])
    if (chunk?.['type'] !== 'usage') continue
    return asRecord(chunk['usage'])
  }
  return undefined
}

/**
 * Port of the projection's `usageOf(event)`.
 * @param event - A durable event.
 * @returns The usage sample this event reports, if any.
 */
function usageOf(event: RawLogEvent): Record<string, unknown> | undefined {
  const data = asRecord(event.data)
  if (data === undefined) return undefined
  if (event.type === 'assistant/message') {
    const direct = asRecord(data['usage'])
    if (direct !== undefined) return direct
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return streamUsage(data['stream'])
}

/** The `{provider, model}` a settlement was served by, when recorded. */
function messageRoute(event: RawLogEvent): { provider: string; model: string } | undefined {
  const source = asRecord(asRecord(asRecord(event.data)?.['message'])?.['source'])
  const provider = source?.['provider']
  const model = source?.['model']
  if (typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0) {
    return { provider, model }
  }
  return undefined
}

/** The route a `request/header` selected, used to attribute route-less attempts. */
function headerRoute(event: RawLogEvent): { provider: string; model: string } | undefined {
  const config = asRecord(asRecord(asRecord(event.data)?.['header'])?.['config'])
  const provider = config?.['provider']
  const model = config?.['model']
  if (typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0) {
    return { provider, model }
  }
  return undefined
}

/** The reasoning effort a `request/header` requested, when it named one. */
function headerEffort(event: RawLogEvent): string | undefined {
  const config = asRecord(asRecord(asRecord(event.data)?.['header'])?.['config'])
  const effort = config?.['reasoningEffort']
  return typeof effort === 'string' && effort.length > 0 ? effort : undefined
}

/** The reasoning effort a `model/selection` recorded, when it named one. */
function selectionEffort(event: RawLogEvent): string | undefined {
  const data = asRecord(event.data)
  const effort = data?.['reasoningEffort']
  return typeof effort === 'string' && effort.length > 0 ? effort : undefined
}

/**
 * The skill a `tool/call` invoked.
 *
 * The `skill` tool takes its target as a JSON string in `arguments`, so the
 * payload has to be parsed a second time; a malformed payload yields no
 * attribution rather than a bogus skill named after the raw text.
 */
function skillName(event: RawLogEvent): string | undefined {
  const data = asRecord(event.data)
  if (data?.['name'] !== 'skill') return undefined
  const raw = data['arguments']
  if (typeof raw !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    const name = asRecord(parsed)?.['name']
    return typeof name === 'string' && name.length > 0 ? name : undefined
  } catch {
    return undefined
  }
}

const routeKey = (provider: string, model: string): string => `${provider}\u0000${model}`

/**
 * Format an epoch millisecond instant as `YYYY-MM-DD` in a zone.
 *
 * `Intl.DateTimeFormat` is used rather than manual offset math so DST
 * transitions and half-hour zones bucket correctly.
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

/**
 * Fold one session's decoded events into usage numbers.
 *
 * Events are expected in log order; the fold is order-sensitive by design,
 * because replacement depends on seeing a settlement's predecessor first.
 * @param events - Durable events in log order, header included.
 * @param options - Day-bucketing options.
 * @returns The session's folded usage.
 */
export function foldSession(events: readonly RawLogEvent[], options: FoldOptions): SessionFold {
  const totals = zeroBuckets()
  const routes = new Map<string, RouteAccumulator>()
  const days = new Map<string, DayAccumulator>()
  const dayRoutes = new Map<string, DayRouteAccumulator>()
  let last: Contribution | null = null
  let turns = 0
  let completedTurns = 0
  let responses = 0
  let longestTurnMs = 0
  let updatedAt = 0
  let context: ContextPressure | undefined
  let title: string | undefined
  let currentRoute: { provider: string; model: string } | undefined
  const efforts = new Map<string, number>()
  const skills = new Map<string, number>()
  const selections = new Map<string, number>()
  /** Start instants of turns not yet closed, keyed by turn number. */
  const openTurns = new Map<number, number>()

  const dayFor = (accumulatorDay: string): DayAccumulator => {
    let entry = days.get(accumulatorDay)
    if (entry === undefined) {
      entry = { buckets: zeroBuckets(), turns: 0, responses: 0 }
      days.set(accumulatorDay, entry)
    }
    return entry
  }

  const routeFor = (provider: string, model: string): RouteAccumulator => {
    const key = routeKey(provider, model)
    let entry = routes.get(key)
    if (entry === undefined) {
      entry = { provider, model, responses: 0, buckets: zeroBuckets() }
      routes.set(key, entry)
    }
    return entry
  }

  const dayRouteKey = (date: string, provider: string, model: string): string => `${date}\u0000${provider}\u0000${model}`

  const dayRouteFor = (date: string, provider: string, model: string): DayRouteAccumulator => {
    const key = dayRouteKey(date, provider, model)
    let entry = dayRoutes.get(key)
    if (entry === undefined) {
      entry = { date, provider, model, responses: 0, buckets: zeroBuckets() }
      dayRoutes.set(key, entry)
    }
    return entry
  }

  for (const event of events) {
    const time = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : 0
    if (time > updatedAt) updatedAt = time
    const data = asRecord(event.data)

    if (event.type === 'session/title') {
      const candidate = data?.['title']
      if (typeof candidate === 'string' && candidate.length > 0) title = candidate
      continue
    }

    if (event.type === 'turn/start') {
      turns++
      const turnNumber = count(data?.['turn'])
      if (turnNumber !== undefined && time > 0) openTurns.set(turnNumber, time)
      dayFor(dayKeyInZone(time, options.timeZone)).turns++
      continue
    }

    if (event.type === 'turn/end') {
      const turnNumber = count(data?.['turn'])
      const startedAt = turnNumber === undefined ? undefined : openTurns.get(turnNumber)
      if (turnNumber !== undefined && startedAt !== undefined && time >= startedAt) {
        longestTurnMs = Math.max(longestTurnMs, time - startedAt)
        completedTurns++
        openTurns.delete(turnNumber)
      }
      continue
    }

    if (event.type === 'request/context') {
      const window = count(data?.['contextWindow'])
      if (window !== undefined && window > 0) {
        context = { tokensInContext: context?.tokensInContext ?? 0, window }
      }
      continue
    }

    // The two effort-bearing events are tallied separately. `request/header`
    // counts outgoing requests, which is what "most used reasoning" should
    // mean; `model/selection` is only a fallback for logs that never wrote a
    // request envelope, so the two are never added together.
    const effort = headerEffort(event)
    if (effort !== undefined) efforts.set(effort, (efforts.get(effort) ?? 0) + 1)
    else {
      const selected = selectionEffort(event)
      if (selected !== undefined) selections.set(selected, (selections.get(selected) ?? 0) + 1)
    }

    if (event.type === 'tool/call') {
      const skill = skillName(event)
      if (skill !== undefined) skills.set(skill, (skills.get(skill) ?? 0) + 1)
      continue
    }

    const route = headerRoute(event)
    if (route !== undefined) currentRoute = route

    // Mirrors the projection's `llm/retry-started` branch: the slot is cleared
    // only when it belongs to the step being retried.
    if (event.type === 'llm/retry-started') {
      const turn = count(data?.['turn'])
      const step = count(data?.['step'])
      if (last !== null && last.turn === turn && last.step === step) last = null
      continue
    }

    const usage = usageOf(event)
    if (usage === undefined) continue

    const turn = count(data?.['turn'])
    const step = count(data?.['step'])
    if (turn === undefined || step === undefined) continue

    const buckets = bucketsFrom(usage)
    const previous = last !== null && last.turn === turn && last.step === step ? last : undefined

    // An identical re-report of the same attempt is a no-op, as in the original.
    if (previous !== undefined && bucketsEqual(previous.buckets, buckets)) continue

    const attributed = messageRoute(event) ?? currentRoute
    const provider = attributed?.provider ?? ''
    const model = attributed?.model ?? 'unknown'
    const day = dayKeyInZone(time, options.timeZone)

    if (previous !== undefined) {
      addInto(totals, previous.buckets, -1)
      addInto(dayFor(previous.day).buckets, previous.buckets, -1)
      const previousRoute = routeFor(previous.provider, previous.model)
      addInto(previousRoute.buckets, previous.buckets, -1)
      previousRoute.responses--
      const previousDayRoute = dayRouteFor(previous.day, previous.provider, previous.model)
      addInto(previousDayRoute.buckets, previous.buckets, -1)
      previousDayRoute.responses--
    }

    addInto(totals, buckets, 1)
    const dayEntry = dayFor(day)
    addInto(dayEntry.buckets, buckets, 1)
    dayEntry.responses++
    const routeEntry = routeFor(provider, model)
    addInto(routeEntry.buckets, buckets, 1)
    routeEntry.responses++
    const dayRouteEntry = dayRouteFor(day, provider, model)
    addInto(dayRouteEntry.buckets, buckets, 1)
    dayRouteEntry.responses++
    responses++

    last = { turn, step, buckets, day, provider, model }

    // Context occupancy tracks the newest prompt-side sample: everything the
    // provider billed for the request, cache traffic included. This is DSH's
    // `pressureTokens` and matches Codex's `tokens_in_context_window()`, which
    // reads the same quantity off `last_token_usage.total_tokens`.
    const promptTokens = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
    context = { tokensInContext: promptTokens, ...(context?.window === undefined ? {} : { window: context.window }) }
  }

  return {
    totals: counted(totals),
    routes,
    days,
    dayRoutes,
    turns,
    completedTurns,
    responses,
    longestTurnMs,
    ...(context === undefined ? {} : { context }),
    ...(title === undefined ? {} : { title }),
    efforts: efforts.size > 0 ? efforts : selections,
    skills,
    updatedAt,
    malformed: 0,
  }
}

/** Convert a route accumulator into its wire form. */
export function routeToWire(accumulator: RouteAccumulator): RouteUsage {
  return {
    provider: accumulator.provider,
    model: accumulator.model,
    responses: accumulator.responses,
    ...counted(accumulator.buckets),
  }
}

/** Convert a day accumulator into its wire form. */
export function dayToWire(date: string, accumulator: DayAccumulator): DayUsage {
  return {
    date,
    turns: accumulator.turns,
    responses: accumulator.responses,
    ...counted(accumulator.buckets),
  }
}

/** Convert a `(day, route)` cell into its wire form. */
export function dayRouteToWire(accumulator: DayRouteAccumulator): DayRouteUsage {
  return {
    date: accumulator.date,
    provider: accumulator.provider,
    model: accumulator.model,
    responses: accumulator.responses,
    ...counted(accumulator.buckets),
  }
}

export { totalOf, counted, addInto, zeroBuckets }
export type { Buckets, DayAccumulator, RouteAccumulator, DayRouteAccumulator }
