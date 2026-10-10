/**
 * The browser half's view of the Host's usage route.
 *
 * @module dsh-token-dashboard/client/api
 */
import type { RangeKind, UsageSnapshot } from '../shared/types.ts'

/** Route prefix owned by this plugin's Host half. */
export const ROUTE_PREFIX = '/dsh-token-dashboard'

/** Reporting windows in the order the range control shows them. */
export const RANGES: readonly RangeKind[] = ['today', '7d', '30d', 'all']

/** A fetch outcome the panel can render without throwing. */
export type StatsResult = { ok: true; snapshot: UsageSnapshot } | { ok: false; error: string }

/**
 * Read one usage snapshot from the Host.
 *
 * The response is always HTTP 200 with a JSON body on success; any other status
 * is surfaced as a readable message rather than an exception, because a stale
 * dashboard is a better failure mode than a blank settings page.
 * @param range - Reporting window.
 * @param timeZone - IANA zone the Host should bucket days in.
 * @param sessionId - Session the browser has open, highlighted in the list.
 * @param signal - Abort signal for a superseded request.
 * @returns The snapshot, or a message describing why it is unavailable.
 */
export async function fetchStats(
  range: RangeKind,
  timeZone: string,
  sessionId: string | undefined,
  signal: AbortSignal,
): Promise<StatsResult> {
  const query = new URLSearchParams({ range, timeZone })
  if (sessionId !== undefined && sessionId.length > 0) query.set('currentSession', sessionId)
  try {
    const response = await fetch(`${ROUTE_PREFIX}/api/stats?${query.toString()}`, { signal, credentials: 'same-origin' })
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} ${response.statusText}`.trim() }
    }
    const snapshot = (await response.json()) as UsageSnapshot
    if (snapshot === null || typeof snapshot !== 'object' || !Array.isArray(snapshot.days)) {
      return { ok: false, error: 'malformed response' }
    }
    return { ok: true, snapshot }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The session id in the page URL, when the shell put one there.
 * @returns The id, or `undefined` when the shell address carries none.
 */
export function currentSessionId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const value = new URL(window.location.href).searchParams.get('session')
    return value === null || value.length === 0 ? undefined : value
  } catch {
    return undefined
  }
}

/**
 * The browser's IANA zone, used as the initial bucketing zone.
 * @returns The zone name, or `UTC` when the runtime cannot report one.
 */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
