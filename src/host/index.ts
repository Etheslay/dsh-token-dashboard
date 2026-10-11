/**
 * Host half of dsh-token-dashboard.
 *
 * This half owns everything that needs the filesystem: locating `$DSH_HOME`,
 * discovering session logs, decoding them, and folding usage. It publishes the
 * result as one JSON route that the browser half polls. No model call, no
 * prompt content, and no writes are involved — the plugin only reads logs the
 * harness already wrote.
 *
 * `webServer` is acquired through a NESTED `ctx.inject` rather than the
 * module-level `inject` array on purpose. A module-level dependency would keep
 * the whole plugin unmounted in any composition without an HTTP carrier (a CLI
 * session, for instance), so a user who installed it for the web GUI would see
 * an activation failure in a context where the plugin has nothing to do. Nested,
 * it simply never registers a route there.
 *
 * @module dsh-token-dashboard
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { dshHomeDisplay, resolveDshHome } from './home.ts'
import { buildSnapshot } from './aggregate.ts'
import { SessionScanner } from './scan.ts'
import { dayKeyInZone } from './fold.ts'
import type { StatsQuery, UsageSnapshot } from '../shared/types.ts'
import { IdentityCache } from './account.ts'

/**
 * The wire contract the `/api/stats` route answers with, re-exported from the
 * package root.
 *
 * Nothing else publishes these: a consumer that wants to type the snapshot — a
 * test harness, a second panel, a script reading the route — has no entry point
 * for them otherwise, because a type-only import is not a re-export.
 */
export type {
  CacheStats,
  ContextPressure,
  CountedBuckets,
  DayUsage,
  Insights,
  ProfileIdentity,
  ProfileSummary,
  RouteUsage,
  SessionRow,
  Share,
  StatsQuery,
  TokenBuckets,
  UsageCount,
  UsageSnapshot,
  WorkspaceUsage,
} from '../shared/types.ts'

/** Cordis plugin name; must match the Loader entry id in `cordis.patch.yml`. */
export const name = 'dsh-token-dashboard'

/** Route prefix this plugin owns. No other plugin may register it. */
export const ROUTE_PREFIX = '/dsh-token-dashboard'

/** How long a snapshot may be reused before rescanning, in milliseconds. */
const SNAPSHOT_TTL_MS = 5_000


/** The minimal Cordis context surface this plugin touches. */
interface HostContext {
  effect(callback: () => unknown, label?: string): void
  inject(dependencies: string[], callback: (scoped: HostContext) => void): void
  /** Optional-service lookup; `strict: false` returns `undefined` when absent. */
  get?(name: string, strict?: boolean): unknown
  webServer?: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

/** Resolve the zone day keys are bucketed in. */
function hostTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Read a single query parameter. */
function queryParam(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key)
  return value === null || value.length === 0 ? undefined : value
}

/** Validate an IANA zone name, falling back to the host's zone. */
function resolveTimeZone(requested: string | undefined, fallback: string): string {
  if (requested === undefined) return fallback
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: requested })
    return requested
  } catch {
    return fallback
  }
}

/** Write a JSON response. */
function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    // Always revalidated, never served from cache: session logs change
    // constantly and a stale snapshot on a fresh page load is worse than a
    // re-scan the scanner has already memoized per (size, mtimeMs). The
    // in-process snapshot cache is what keeps reopening the panel instant.
    'cache-control': 'private, max-age=0, must-revalidate',
  })
  response.end(body)
}

/**
 * Parse and validate the `GET /api/stats` query.
 * @param url - The request URL.
 * @param defaultTimeZone - Zone used when the request omits one.
 * @returns The normalized query.
 */
export function parseStatsQuery(url: URL, defaultTimeZone: string): Required<Pick<StatsQuery, 'timeZone'>> &
  Pick<StatsQuery, 'currentSession'> {
  const timeZone = resolveTimeZone(queryParam(url, 'timeZone'), defaultTimeZone)
  const currentSession = queryParam(url, 'currentSession')
  return { timeZone, ...(currentSession === undefined ? {} : { currentSession }) }
}

/**
 * Mount the plugin.
 * @param ctx - The Cordis context.
 */
export function apply(ctx: HostContext): void {
  const home = resolveDshHome()
  const sessionsRoot = join(home, 'sessions')
  const scanner = new SessionScanner(sessionsRoot)
  const identity = new IdentityCache()
  const defaultTimeZone = hostTimeZone()

  /** Last computed snapshot, reused for {@link SNAPSHOT_TTL_MS}. */
  let cached: { at: number; key: string; snapshot: UsageSnapshot } | undefined

  const buildFor = async (query: ReturnType<typeof parseStatsQuery>): Promise<UsageSnapshot> => {
    const now = Date.now()
    const dayKey = dayKeyInZone(now, query.timeZone)
    const key = `${query.timeZone}\u0000${dayKey}\u0000${query.currentSession ?? ''}`
    if (cached !== undefined && cached.key === key && now - cached.at < SNAPSHOT_TTL_MS) return cached.snapshot

    const started = Date.now()
    const { summaries, warnings } = scanner.read(query.timeZone)
    // Resolved outside the fold because it may hit the network; the cache keeps
    // that off the refresh path.
    const resolved = await identity.read(ctx)
    const snapshot = buildSnapshot({
      summaries,
      timeZone: query.timeZone,
      home,
      todayKey: dayKey,
      ...(query.currentSession === undefined ? {} : { currentSession: query.currentSession }),
      ...(resolved === undefined ? {} : { identity: resolved }),
      warnings,
      elapsedMs: Date.now() - started,
    })
    // Stamped when the snapshot is READY, not when the request arrived: a scan
    // slower than the TTL would otherwise publish an entry that is already
    // stale, so every refresh would rescan the whole store again.
    cached = { at: Date.now(), key, snapshot }
    return snapshot
  }

  /**
   * The route handler. Read-only: it never mutates session state, so concurrent
   * requests are safe and a slow scan cannot corrupt anything.
   */
  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      try {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          sendJson(response, 405, { error: 'method not allowed' })
          return
        }
        const url = new URL(request.url ?? '/', 'http://localhost')
        const routePath = url.pathname.slice(ROUTE_PREFIX.length)
        if (routePath === '/api/health') {
          sendJson(response, 200, { ok: true, home: dshHomeDisplay(home), timeZone: defaultTimeZone })
          return
        }
        if (routePath !== '/api/stats') {
          sendJson(response, 404, { error: 'not found' })
          return
        }
        sendJson(response, 200, await buildFor(parseStatsQuery(url, defaultTimeZone)))
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    })()
  }

  // Nested injection: the plugin still mounts on a composition with no HTTP
  // carrier, it just never registers a route there.
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(
      () => scoped.webServer?.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }),
      'dsh-token-dashboard: usage route',
    )
  })
}
