/**
 * The browser half's view of the Host's usage route.
 *
 * @module dsh-token-dashboard/client/api
 */
import type { UsageSnapshot } from '../shared/types.ts'

/** Route prefix owned by this plugin's Host half. */
export const ROUTE_PREFIX = '/dsh-token-dashboard'

/** A fetch outcome the panel can render without throwing. */
export type StatsResult =
  | { ok: true; snapshot: UsageSnapshot }
  | { ok: false; error: string; staleHost?: boolean }

/**
 * Whether a response carries every field this panel version renders.
 *
 * The Host and browser halves ship in one package but do NOT reload together:
 * the module system hot-swaps the browser bundle, while the Host half is a
 * cached ES module that only a DSH restart replaces. During that window the
 * panel can receive a snapshot shaped by an older Host. Returning a flag lets
 * the panel say so, instead of dereferencing a missing field and blanking the
 * whole settings dialog.
 * @param snapshot - The parsed response body.
 * @returns `true` when the snapshot has the current shape.
 */
function hasCurrentShape(snapshot: UsageSnapshot): boolean {
  return (
    snapshot !== null &&
    typeof snapshot === 'object' &&
    Array.isArray(snapshot.days) &&
    snapshot.heatmap !== undefined &&
    typeof snapshot.heatmap.from === 'string' &&
    typeof snapshot.heatmap.to === 'string' &&
    snapshot.insights !== undefined &&
    Array.isArray(snapshot.insights.reasoning) &&
    Array.isArray(snapshot.insights.topSkills) &&
    snapshot.profile !== undefined &&
    typeof snapshot.profile.lifetimeTokens === 'number'
  )
}

/**
 * Read one usage snapshot from the Host.
 *
 * The response is always HTTP 200 with a JSON body on success; any other status
 * is surfaced as a readable message rather than an exception, because a stale
 * dashboard is a better failure mode than a blank settings page.
 *
 * There is no range parameter: the panel reports a profile, so every figure it
 * shows is all-time.
 * @param timeZone - IANA zone the Host should bucket days in.
 * @param sessionId - Session the browser has open, highlighted in the list.
 * @param signal - Abort signal for a superseded request.
 * @returns The snapshot, or a message describing why it is unavailable.
 */
export async function fetchStats(
  timeZone: string,
  sessionId: string | undefined,
  signal: AbortSignal,
): Promise<StatsResult> {
  const query = new URLSearchParams({ timeZone })
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
    if (!hasCurrentShape(snapshot)) {
      return { ok: false, error: 'Host half is an older build', staleHost: true }
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
 * The browser's IANA zone, used for day bucketing.
 * @returns The zone name, or `UTC` when the runtime cannot report one.
 */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
