/**
 * Discovering session logs on disk and folding each one once.
 *
 * Layout, as the harness writes it:
 *
 * ```
 * $DSH_HOME/sessions/<mangled-cwd>/<session-id>/session.v<N>.jsonl.zstd
 * ```
 *
 * A session directory accumulates one file per log-format version. The newer
 * version is a rewrite of the older one — same session id, same event sequence
 * numbers — but it is NOT safe to simply take the highest version. A rewrite
 * that was interrupted leaves a newer file that is shorter than the older one
 * and has undecodable frames; taking it silently discards most of that
 * session's tokens. On this machine one such session has a 246-event `v4`
 * alongside a healthy 3563-event `v3`.
 *
 * So every version present is read and the one with the highest durable
 * sequence number wins; ties prefer fewer undecodable frames, then the higher
 * version. Only ~10 sessions have more than one version, so the extra decode
 * cost is bounded and is paid once per `(size, mtimeMs)` anyway.
 *
 * Decoding a multi-megabyte log is the expensive part, so results are memoized.
 * An unchanged file is never decoded twice, which is what makes a 5-second
 * refresh affordable over a store with hundreds of sessions.
 *
 * @module dsh-token-dashboard/host/scan
 */
import fs from 'node:fs'
import path from 'node:path'
import { foldSession, routeToWire, dayToWire, type SessionFold } from './fold.ts'
import { decodeSessionBuffer, parseLogEvents, type RawLogEvent } from './session-log.ts'
import type { CountedBuckets, ContextPressure, DayUsage, RouteUsage } from '../shared/types.ts'

/** Everything one session log contributes, detached from the fold's maps. */
export interface SessionSummary {
  /** Session id from the log header, falling back to the directory name. */
  id: string
  /** Session title, when the log carries one. */
  title?: string
  /** Absolute working directory recorded in the header. */
  cwd: string
  /** Agent preset the session was seeded with, when recorded. */
  agentPreset?: string
  /** Epoch milliseconds the session was created. */
  createdAt: number
  /** Epoch milliseconds of the newest event. */
  updatedAt: number
  /** Turns started in the log. */
  turns: number
  /** Assistant settlements recorded; one per `(turn, step)` slot. */
  responses: number
  /** Wall-clock duration of the longest completed turn, in milliseconds. */
  longestTurnMs: number
  /** Whole-log totals. */
  totals: CountedBuckets
  /** Per-route totals, heaviest first. */
  routes: RouteUsage[]
  /** Per-day totals, oldest first. */
  days: DayUsage[]
  /** Newest context occupancy. */
  context?: ContextPressure
  /** Reasoning effort per request, keyed by label. */
  efforts: Record<string, number>
  /** Skill invocations, keyed by skill name. */
  skills: Record<string, number>
  /** Lines that failed to parse; a truncated live tail is normal. */
  malformedLines: number
  /** zstd frames that failed to decode; normally only the truncated tail. */
  failedFrames: number
  /**
   * Highest durable sequence number seen.
   *
   * The harness stamps every event with a monotonic `seq`, so this is the
   * log's position: a rewrite that was interrupted stops at a lower one, which
   * is how {@link SessionScanner} picks between format versions.
   */
  maxSeq: number
  /** Log-format version this summary was read from. */
  version: number
}

/** One cache entry keyed by absolute log path. */
interface CacheEntry {
  size: number
  mtimeMs: number
  summary: SessionSummary
}

/** Extracts the version number from a `session.v<N>.jsonl.zstd` filename. */
const LOG_FILE = /^session\.v(\d+)\.jsonl\.zstd$/

/**
 * Recursively collect every session log, grouped by session directory.
 * @param sessionsRoot - Absolute path to `$DSH_HOME/sessions`.
 * @returns One array of log paths per session directory, newest version first.
 */
export function discoverSessionLogs(sessionsRoot: string): string[][] {
  const groups = new Map<string, Array<{ file: string; version: number }>>()
  const visit = (dir: string, depth: number): void => {
    if (depth > 3) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(full, depth + 1)
        continue
      }
      const match = LOG_FILE.exec(entry.name)
      if (match === null) continue
      const bucket = groups.get(dir) ?? []
      bucket.push({ file: full, version: Number(match[1]) })
      groups.set(dir, bucket)
    }
  }
  visit(sessionsRoot, 0)
  return [...groups.values()].map((bucket) =>
    bucket.sort((left, right) => right.version - left.version).map((entry) => entry.file),
  )
}

/**
 * Choose between the format versions of one session.
 *
 * The furthest durable position wins, because a log's `seq` is its own
 * completeness proof. A lower `failedFrames` breaks a tie, and the higher
 * version breaks the remaining one.
 * @param candidates - Summaries read from each version, newest version first.
 * @returns The summary a reader should trust.
 */
export function pickBestVersion(candidates: readonly SessionSummary[]): SessionSummary {
  return [...candidates].sort((left, right) => {
    if (left.maxSeq !== right.maxSeq) return right.maxSeq - left.maxSeq
    if (left.failedFrames !== right.failedFrames) return left.failedFrames - right.failedFrames
    return right.version - left.version
  })[0]!
}

/** Narrow an unknown header field to a string. */
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

/** Narrow an unknown header field to a finite number. */
const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/**
 * Convert a fold result into a detached {@link SessionSummary}.
 * @param fold - The fold result.
 * @param header - The log's `session` header event.
 * @param idFromPath - Directory name, used when the header carries no id.
 * @param malformedLines - Lines that failed to parse.
 * @param failedFrames - zstd frames that failed to decode.
 * @returns The summary.
 */
function toSummary(
  fold: SessionFold,
  header: RawLogEvent | undefined,
  idFromPath: string,
  malformedLines: number,
  failedFrames: number,
  maxSeq: number,
  version: number,
): SessionSummary {
  // The `session` header carries id/cwd/createdAt/agentPreset at the TOP level
  // of the event, not under `data`. Fall back to `data` anyway so a future
  // format that moves them keeps working.
  const data = { ...((header?.data ?? {}) as Record<string, unknown>), ...(header ?? {}) }
  const routes = [...fold.routes.values()]
    .map(routeToWire)
    .sort((left, right) => right.totalTokens - left.totalTokens)
  const days = [...fold.days.entries()]
    .map(([date, accumulator]) => dayToWire(date, accumulator))
    .filter((day) => day.totalTokens > 0 || day.turns > 0)
    .sort((left, right) => left.date.localeCompare(right.date))

  return {
    id: str(data['id'], idFromPath),
    ...(fold.title === undefined ? {} : { title: fold.title }),
    cwd: str(data['cwd']),
    ...(str(data['agentPreset']).length === 0 ? {} : { agentPreset: str(data['agentPreset']) }),
    createdAt: num(data['createdAt']),
    updatedAt: fold.updatedAt,
    turns: fold.turns,
    responses: fold.responses,
    longestTurnMs: fold.longestTurnMs,
    totals: fold.totals,
    routes,
    days,
    ...(fold.context === undefined ? {} : { context: fold.context }),
    efforts: Object.fromEntries(fold.efforts),
    skills: Object.fromEntries(fold.skills),
    malformedLines,
    failedFrames,
    maxSeq,
    version,
  }
}

/** Fold one log file, decoding it from disk. */
function readSummary(file: string, timeZone: string): SessionSummary {
  const buffer = fs.readFileSync(file)
  const decoded = decodeSessionBuffer(buffer)
  const { events, malformed } = parseLogEvents(decoded.text)
  const header = events.find((event) => event.type === 'session')
  const fold = foldSession(events, { timeZone })
  let maxSeq = 0
  for (const event of events) {
    if (typeof event.seq === 'number' && Number.isFinite(event.seq) && event.seq > maxSeq) maxSeq = event.seq
  }
  const version = Number(LOG_FILE.exec(path.basename(file))?.[1] ?? 0)
  return toSummary(fold, header, path.basename(path.dirname(file)), malformed, decoded.failed, maxSeq, version)
}

/** A memoizing reader over the session store. */
export class SessionScanner {
  private readonly cache = new Map<string, CacheEntry>()

  /** IANA zone the cache was built for; a change forces a full re-read. */
  private timeZone: string | undefined

  /** Absolute path to `$DSH_HOME/sessions`. */
  private readonly sessionsRoot: string

  /**
   * @param sessionsRoot - Absolute path to `$DSH_HOME/sessions`.
   */
  constructor(sessionsRoot: string) {
    this.sessionsRoot = sessionsRoot
  }

  /**
   * Read every session summary, reusing unchanged logs.
   *
   * Each session directory contributes exactly ONE summary: every format
   * version present is decoded (from cache where possible) and
   * {@link pickBestVersion} chooses. A file whose size and `mtimeMs` are
   * unchanged is served from memory.
   *
   * The time zone participates in day bucketing, so a zone change invalidates
   * the whole cache rather than silently returning wrongly-bucketed days.
   * @param timeZone - IANA zone used for day keys.
   * @returns Summaries plus non-fatal read problems.
   */
  read(timeZone: string): { summaries: SessionSummary[]; warnings: string[] } {
    if (this.timeZone !== timeZone) {
      this.cache.clear()
      this.timeZone = timeZone
    }
    const warnings: string[] = []
    const summaries: SessionSummary[] = []
    let groups: string[][]
    try {
      groups = discoverSessionLogs(this.sessionsRoot)
    } catch (error) {
      return { summaries, warnings: [`could not list ${this.sessionsRoot}: ${describe(error)}`] }
    }

    const live = new Set(groups.flat())
    for (const key of [...this.cache.keys()]) if (!live.has(key)) this.cache.delete(key)

    for (const group of groups) {
      const candidates: SessionSummary[] = []
      for (const file of group) {
        let stat: fs.Stats
        try {
          stat = fs.statSync(file)
        } catch (error) {
          warnings.push(`skipped ${path.basename(path.dirname(file))}: ${describe(error)}`)
          continue
        }
        const cached = this.cache.get(file)
        if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
          candidates.push(cached.summary)
          continue
        }
        try {
          const summary = readSummary(file, timeZone)
          this.cache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, summary })
          candidates.push(summary)
        } catch (error) {
          warnings.push(`unreadable session ${path.basename(path.dirname(file))}: ${describe(error)}`)
        }
      }
      if (candidates.length === 0) continue
      const best = pickBestVersion(candidates)
      // A truncated live tail is expected, so only a stale rewrite is worth a
      // warning — and only when a healthier sibling version exists.
      if (best.failedFrames > 0 && candidates.some((other) => other.failedFrames < best.failedFrames)) {
        warnings.push(
          `${best.id}: newest log version has ${best.failedFrames} undecodable frame(s); using the more complete version`,
        )
      }
      summaries.push(best)
    }
    return { summaries, warnings }
  }
}

/** Render an unknown thrown value as a short message. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
