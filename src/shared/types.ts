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
  /**
   * Assistant settlements attributed to this route.
   *
   * One per `(turn, step)` slot: a retried step counts twice, a streamed
   * re-report of the same step replaces its predecessor and counts once.
   */
  responses: number
}

/** One local calendar day's accumulated usage. */
export interface DayUsage extends CountedBuckets {
  /** Local date as `YYYY-MM-DD` in the requested time zone. */
  date: string
  /** Turns that started on this day. */
  turns: number
  /**
   * Assistant settlements on this day, on the same `(turn, step)` slot basis as
   * {@link RouteUsage.responses}, so the per-day and per-route tallies sum to
   * the same figure.
   */
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
  /** Who the panel is about, when the harness has a signed-in account. */
  identity?: ProfileIdentity
  /** All-time totals across every session. */
  totals: CountedBuckets & {
    /** Distinct Sessions contributing at least one token. */
    sessions: number
    /** Turns that started in any session. */
    turns: number
    /** Assistant settlements recorded. */
    responses: number
  }
  /** Per-day buckets, oldest first; only days with activity are present. */
  days: DayUsage[]
  /**
   * Calendar bounds of the activity heatmap, as `YYYY-MM-DD` day keys.
   *
   * The Host states the window rather than sending a bucket for every one of
   * its ~366 days; the browser lays out the grid and leaves the gaps empty.
   */
  heatmap: { from: string; to: string }
  /** Per-route breakdown, heaviest first. */
  models: RouteUsage[]
  /** Per-directory breakdown, heaviest first. */
  workspaces: WorkspaceUsage[]
  /** Recent Sessions, newest first. */
  sessions: SessionRow[]
  /** Cache effectiveness. */
  cache: CacheStats
  /** All-time headline figures for the stat bar. */
  profile: ProfileSummary
  /** Everything the insights column reports. */
  insights: Insights
  /** Non-fatal problems worth surfacing, for example unreadable logs. */
  warnings: string[]
}

/** Who the panel is about. */
export interface ProfileIdentity {
  /** Display name, when the account has one. */
  name?: string
  /** Handle shown under the name: an email or mobile number. */
  handle?: string
  /** Avatar image URL. */
  avatarUrl?: string
}

/** One labelled slice of a distribution. */
export interface Share {
  /** The value's own label, for example `high` or `deepseek-flash`. */
  label: string
  /** How many samples carried it. */
  count: number
  /** Its share of the distribution, in `0..=100`. */
  share: number
}

/** One entry of the "most used" list. */
export interface UsageCount {
  /** Name of the skill. */
  name: string
  /** How many times it was invoked. */
  runs: number
}

/** The insights column, mirroring Codex's `Activity insights` and skills list. */
export interface Insights {
  /** Reasoning effort per request, heaviest first. Empty when never recorded. */
  reasoning: Share[]
  /** Distinct skills invoked at least once. */
  skillsExplored: number
  /** Total skill invocations. */
  skillsTotal: number
  /** Most-invoked skills, heaviest first. */
  topSkills: UsageCount[]
  /** Models used, heaviest first. */
  models: Share[]
}

/** The `GET /stats` query the browser sends. */
export interface StatsQuery {
  /** IANA zone for day bucketing; defaults to the Host's zone. */
  timeZone?: string
  /** Session id the browser has open, highlighted in the list. */
  currentSession?: string
}
