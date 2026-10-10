/**
 * The wire contract between this plugin's Host half and its browser half.
 *
 * The bucket names are taken verbatim from DSH's own `tokenUsage` session
 * projection (`@deepseek-ai/dsh-token-meter`), so the numbers a user sees here
 * are the same fold the harness itself would compute — not a parallel
 * accounting that can drift.
 *
 * @module dsh-token-dashboard/types
 */

/**
 * DSH's `tokenUsage` projection buckets.
 *
 * `uncachedInputTokens` is provider-reported input EXCLUDING cache traffic —
 * the same quantity Codex calls `non_cached_input()`. DSH's provider
 * `inputTokens` field is already uncached, so no subtraction is needed when
 * mapping onto Codex's display.
 */
export interface TokenBuckets {
  /** Provider-reported input tokens excluding all cache traffic. */
  uncachedInputTokens: number
  /** Provider-reported output tokens, reasoning tokens included. */
  outputTokens: number
  /** Prompt tokens served from the provider's cache. */
  cacheReadTokens: number
  /** Prompt tokens written into the provider's cache. */
  cacheWriteTokens: number
  /** Reasoning tokens, a subset of `outputTokens`. */
  reasoningTokens: number
}

/** A token bucket that also carries its grand total. */
export interface CountedBuckets extends TokenBuckets {
  /** `uncachedInput + cacheRead + cacheWrite + output`. */
  totalTokens: number
}

/** One model route's accumulated usage. */
export interface RouteUsage extends CountedBuckets {
  /** Provider id, for example `deepseek-official`. */
  provider: string
  /** Model id, for example `deepseek-flash`. */
  model: string
  /** Assistant settlements attributed to this route. */
  responses: number
}

/** One `(day, route)` cell, used for a range-filtered model breakdown. */
export interface DayRouteUsage extends RouteUsage {
  /** Local date as `YYYY-MM-DD`. */
  date: string
}

/** One local calendar day's accumulated usage. */
export interface DayUsage extends CountedBuckets {
  /** Local date as `YYYY-MM-DD` in the requested time zone. */
  date: string
  /** Turns that started on this day. */
  turns: number
  /** Assistant settlements on this day. */
  responses: number
}

/** One workspace (the directory a Session ran in). */
export interface WorkspaceUsage extends CountedBuckets {
  /** Absolute working directory. */
  cwd: string
  /** Display name — the last path segment. */
  name: string
  /** Sessions recorded in this directory. */
  sessions: number
}

/** Context occupancy of one Session's most recent request. */
export interface ContextPressure {
  /** Prompt size the provider billed for the newest request. */
  tokensInContext: number
  /** The model's context capacity, when the log recorded one. */
  window?: number
}

/** One Session's row in the dashboard. */
export interface SessionRow extends CountedBuckets {
  /** Session id. */
  id: string
  /** Session title, when one was generated. */
  title?: string
  /** Absolute working directory. */
  cwd: string
  /** Epoch milliseconds of the Session header. */
  createdAt: number
  /** Epoch milliseconds of the newest event. */
  updatedAt: number
  /** Turns recorded in the log. */
  turns: number
  /** Assistant settlements recorded in the log. */
  responses: number
  /** Route breakdown for this Session, heaviest first. */
  routes: RouteUsage[]
  /** Newest observed context occupancy, when the log carried usage. */
  context?: ContextPressure
  /** `true` when this Session is the one the browser currently has open. */
  current?: boolean
}

/** Cache effectiveness over the selected range. */
export interface CacheStats {
  /** Prompt tokens that hit the cache. */
  readTokens: number
  /** Prompt tokens written to the cache. */
  writeTokens: number
  /** `uncachedInput + cacheRead + cacheWrite`. */
  promptTokens: number
  /**
   * Share of prompt tokens served from cache, in `0..=100`.
   * `undefined` when no prompt tokens were recorded.
   */
  hitRate?: number
}

/**
 * All-time headline figures.
 *
 * These are the five big numbers Codex's analytics Overview leads with —
 * `Lifetime tokens`, `Peak tokens`, `Longest chat`, `Current streak`,
 * `Longest streak` — every one of which DSH's session log can supply.
 */
export interface ProfileSummary {
  /** All-time token total across every session. */
  lifetimeTokens: number
  /** The single busiest local day's token total. */
  peakDailyTokens: number
  /** Local day the peak occurred on, as `YYYY-MM-DD`. */
  peakDay?: string
  /** Wall-clock seconds of the longest completed turn. */
  longestTurnSeconds: number
  /** Consecutive active days ending today (or yesterday). */
  currentStreakDays: number
  /** Longest run of consecutive active days on record. */
  longestStreakDays: number
  /** Sessions that recorded at least one token. */
  sessions: number
  /** Turns recorded across every session. */
  turns: number
  /** Distinct local days with any activity. */
  activeDays: number
}

/** The selectable reporting windows. */
export type RangeKind = 'today' | '7d' | '30d' | 'all'

/** One scan's complete answer. */
export interface UsageSnapshot {
  /** Epoch milliseconds when the Host produced this snapshot. */
  generatedAt: number
  /** How long the scan took, in milliseconds. */
  elapsedMs: number
  /** Absolute `$DSH_HOME` the numbers were read from. */
  home: string
  /** IANA zone used for day bucketing. */
  timeZone: string
  /** Agent preset most sessions were seeded with, when recorded. */
  agentPreset?: string
  /** The requested window. */
  range: {
    kind: RangeKind
    /** Inclusive lower bound, epoch milliseconds; `undefined` for `all`. */
    since?: number
    /** Exclusive upper bound, epoch milliseconds. */
    until: number
  }
  /** Totals for the selected window. */
  totals: CountedBuckets & {
    /** Distinct Sessions contributing at least one token. */
    sessions: number
    /** Turns that started inside the window. */
    turns: number
    /** Assistant settlements inside the window. */
    responses: number
  }
  /** Totals for the immediately preceding equal-length window, for deltas. */
  previous?: CountedBuckets & { sessions: number }
  /** Per-day buckets, oldest first; only days with activity are present. */
  days: DayUsage[]
  /** Per-route breakdown across the window, heaviest first. */
  models: RouteUsage[]
  /** Per-directory breakdown across the window, heaviest first. */
  workspaces: WorkspaceUsage[]
  /** Recent Sessions, newest first. Always all-time, never range-filtered. */
  sessions: SessionRow[]
  /** Cache effectiveness across the window. */
  cache: CacheStats
  /** All-time totals, independent of the selected window. */
  allTime: CountedBuckets & { sessions: number }
  /** All-time headline figures for the profile block. */
  profile: ProfileSummary
  /** Non-fatal problems worth surfacing, for example unreadable logs. */
  warnings: string[]
}

/** The `GET /stats` query the browser sends. */
export interface StatsQuery {
  /** Reporting window; defaults to `30d`. */
  range?: RangeKind
  /** IANA zone for day bucketing; defaults to the Host's zone. */
  timeZone?: string
  /** Session id the browser has open, highlighted in the list. */
  currentSession?: string
}
