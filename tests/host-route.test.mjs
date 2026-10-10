/**
 * Run the built Host half against the real session store and check the numbers.
 *
 * Two things are proven here that a unit test on synthetic events cannot:
 *
 *   1. The multi-frame zstd reader actually recovers every event from real
 *      logs. A single-frame decode returns one line and looks successful, so
 *      "it did not throw" is not evidence.
 *   2. The fold agrees with an independent naive sum of the same logs. DSH
 *      writes one `assistant/message` per step, so the replacement rule has
 *      nothing to collapse and the two must match EXACTLY. Any difference means
 *      the fold is dropping or double-counting records.
 *
 * The built `lib/index.js` is exercised through its real `apply()`, so the route
 * wiring and the nested `webServer` injection are covered too.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SessionScanner, discoverSessionLogs, pickBestVersion } from '../src/host/scan.ts'
import { decodeSessionFile, parseLogEvents } from '../src/host/session-log.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const home = process.env.DSH_HOME ?? path.join(process.env.USERPROFILE ?? '', '.dsh')
const sessionsRoot = path.join(home, 'sessions')

if (!fs.existsSync(sessionsRoot)) {
  console.log(`skipped: no session store at ${sessionsRoot}`)
  process.exit(0)
}

// --- 1. the loader must expose a Cordis plugin ------------------------------
const host = await import(pathToFileURL(path.join(root, 'lib/index.js')).href)
assert.equal(host.name, 'dsh-token-dashboard', 'host plugin name must match the package name')
assert.equal(typeof host.apply, 'function', 'host plugin must export apply()')

// --- 2. the route must answer, through the real apply() ---------------------
let handler
let injected = []
const ctx = {
  effect: (callback) => {
    const dispose = callback()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  inject: (deps, callback) => {
    injected = deps
    callback({
      effect: (inner) => {
        const dispose = inner()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      webServer: {
        register: (route) => {
          handler = route.handler
          assert.equal(route.kind, 'prefix')
          assert.equal(route.path, '/dsh-token-dashboard')
          return () => {}
        },
      },
    })
  },
}
host.apply(ctx)
assert.deepEqual(injected, ['webServer'], 'the plugin must acquire webServer through a nested inject')
assert.equal(typeof handler, 'function', 'apply() must register the usage route')

/** Invoke the route and resolve its JSON body. */
function callRoute(url) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 0,
      writeHead(status) {
        this.statusCode = status
      },
      end(body) {
        try {
          resolve({ status: this.statusCode, body: JSON.parse(body.toString('utf8')) })
        } catch (error) {
          reject(error)
        }
      },
    }
    Promise.resolve(handler({ url, method: 'GET' }, response)).catch(reject)
  })
}

const health = await callRoute('/dsh-token-dashboard/api/health')
assert.equal(health.status, 200)
assert.equal(health.body.ok, true)

const notFound = await callRoute('/dsh-token-dashboard/api/nope')
assert.equal(notFound.status, 404)

const stats = await callRoute('/dsh-token-dashboard/api/stats?range=all&timeZone=Asia/Shanghai')
assert.equal(stats.status, 200, 'the stats route must answer 200')
const snapshot = stats.body
assert.ok(Array.isArray(snapshot.days), 'snapshot must carry day buckets')
assert.ok(Array.isArray(snapshot.sessions), 'snapshot must carry session rows')
assert.ok(snapshot.profile && typeof snapshot.profile.lifetimeTokens === 'number')

// --- 3. the fold must agree with a naive independent sum --------------------
const scanner = new SessionScanner(sessionsRoot)
const { summaries } = scanner.read('Asia/Shanghai')
assert.ok(summaries.length > 0, 'the scanner must find sessions')

/** The log the scanner should trust for each session: the furthest durable seq. */
function trustedLogs() {
  const groups = discoverSessionLogs(sessionsRoot)
  const chosen = []
  for (const group of groups) {
    let best
    for (const file of group) {
      const { text } = decodeSessionFile(file)
      const { events } = parseLogEvents(text)
      let maxSeq = 0
      let failed = 0
      for (const event of events) {
        if (typeof event.seq === 'number' && event.seq > maxSeq) maxSeq = event.seq
      }
      const candidate = { file, events, maxSeq, failed }
      if (best === undefined || maxSeq > best.maxSeq) best = candidate
    }
    if (best !== undefined) chosen.push(best)
  }
  return chosen
}

const logs = trustedLogs()
let naive = { uncached: 0, output: 0, cacheRead: 0, cacheWrite: 0, records: 0, events: 0 }

for (const { events } of logs) {
  naive.events += events.length
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const usage = event.data?.usage
    if (usage === undefined || usage === null) continue
    naive.records++
    naive.uncached += usage.inputTokens ?? 0
    naive.output += usage.outputTokens ?? 0
    naive.cacheRead += usage.cacheReadTokens ?? 0
    naive.cacheWrite += usage.cacheWriteTokens ?? 0
  }
}

const fold = summaries.reduce(
  (sum, s) => ({
    uncached: sum.uncached + s.totals.uncachedInputTokens,
    output: sum.output + s.totals.outputTokens,
    cacheRead: sum.cacheRead + s.totals.cacheReadTokens,
    cacheWrite: sum.cacheWrite + s.totals.cacheWriteTokens,
  }),
  { uncached: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
)

console.log('host route: OK')
console.log(`  sessions scanned : ${summaries.length} (logs on disk: ${logs.length})`)
console.log(`  events decoded   : ${naive.events}`)
console.log(`  usage records    : ${naive.records}`)
console.log(`  uncached input   : fold ${fold.uncached} / naive ${naive.uncached}`)
console.log(`  output           : fold ${fold.output} / naive ${naive.output}`)
console.log(`  cache read       : fold ${fold.cacheRead} / naive ${naive.cacheRead}`)
console.log(`  cache write      : fold ${fold.cacheWrite} / naive ${naive.cacheWrite}`)
console.log(`  lifetime tokens  : ${snapshot.profile.lifetimeTokens}`)
console.log(`  peak day         : ${snapshot.profile.peakDailyTokens} (${snapshot.profile.peakDay ?? 'n/a'})`)
console.log(`  longest chat     : ${snapshot.profile.longestTurnSeconds}s`)
console.log(`  streaks          : current ${snapshot.profile.currentStreakDays}d, longest ${snapshot.profile.longestStreakDays}d`)

assert.ok(naive.records > 0, 'the cross-check must find usage records to compare against')
assert.equal(fold.uncached, naive.uncached, 'uncached input must match the naive sum exactly')
assert.equal(fold.output, naive.output, 'output must match the naive sum exactly')
assert.equal(fold.cacheRead, naive.cacheRead, 'cache reads must match the naive sum exactly')
assert.equal(fold.cacheWrite, naive.cacheWrite, 'cache writes must match the naive sum exactly')

// --- 4. per-day and per-route buckets must reconstruct the same totals ------
for (const summary of summaries) {
  const dayTotal = summary.days.reduce((sum, day) => sum + day.totalTokens, 0)
  assert.equal(dayTotal, summary.totals.totalTokens, `session ${summary.id}: day buckets must sum to the total`)
  const routeTotal = summary.routes.reduce((sum, route) => sum + route.totalTokens, 0)
  assert.equal(routeTotal, summary.totals.totalTokens, `session ${summary.id}: route buckets must sum to the total`)
  const cellTotal = summary.dayRoutes.reduce((sum, cell) => sum + cell.totalTokens, 0)
  assert.equal(cellTotal, summary.totals.totalTokens, `session ${summary.id}: (day, route) cells must sum to the total`)
}

// --- 5. the snapshot must be internally consistent --------------------------
// The store is live — this very session is being appended while the test runs —
// so a snapshot is only ever checked against itself, never against a second
// read taken moments later.
const daySum = snapshot.days.reduce((sum, day) => sum + day.totalTokens, 0)
assert.equal(snapshot.totals.totalTokens, daySum, 'range=all totals must equal the sum of the day buckets')
assert.equal(
  snapshot.profile.lifetimeTokens,
  snapshot.allTime.totalTokens,
  'the profile lifetime figure must equal the all-time total',
)
const sessionSum = snapshot.sessions.reduce((sum, session) => sum + session.totalTokens, 0)
assert.ok(
  sessionSum <= snapshot.profile.lifetimeTokens,
  'listed sessions cannot exceed the lifetime total',
)
for (const day of snapshot.days) {
  assert.ok(day.totalTokens >= 0, 'day buckets must never go negative')
  assert.equal(day.totalTokens, day.uncachedInputTokens + day.cacheReadTokens + day.cacheWriteTokens + day.outputTokens)
}
for (const workspace of snapshot.workspaces) {
  assert.ok(workspace.totalTokens >= 0, 'workspace buckets must never go negative')
}
console.log(`  snapshot days    : ${snapshot.days.length} (sum ${daySum})`)

// --- 6. the version-selection rule must not silently drop a session ---------
{
  const groups = discoverSessionLogs(sessionsRoot)
  const multi = groups.filter((group) => group.length > 1)
  let recovered = 0
  for (const group of multi) {
    const decoded = group.map((file) => {
      const { text } = decodeSessionFile(file)
      const { events } = parseLogEvents(text)
      let maxSeq = 0
      for (const event of events) if (typeof event.seq === 'number' && event.seq > maxSeq) maxSeq = event.seq
      return { file, maxSeq, events: events.length }
    })
    const newestFirst = decoded[0]
    const best = decoded.reduce((a, b) => (b.maxSeq > a.maxSeq ? b : a))
    if (best.file !== newestFirst.file) {
      recovered += best.events - newestFirst.events
      console.log(
        `  version pick    : ${path.basename(path.dirname(best.file)).slice(0, 20)} newest=${newestFirst.events} events, ` +
          `chosen=${best.events} events (+${best.events - newestFirst.events})`,
      )
    }
  }
  console.log(`  multi-version   : ${multi.length} sessions, ${recovered} events recovered by seq-aware picking`)

  const pick = pickBestVersion([
    { id: 'a', maxSeq: 10, failedFrames: 0, version: 4 },
    { id: 'b', maxSeq: 99, failedFrames: 3, version: 3 },
  ])
  assert.equal(pick.id, 'b', 'the furthest durable seq must win over the higher version number')
}

const probe = logs.map(({ file }) => ({ file, size: fs.statSync(file).size })).sort((a, b) => b.size - a.size)[0]
const decoded = decodeSessionFile(probe.file)
assert.ok(decoded.frames > 1, 'real logs are multi-frame; a single-frame reader would report 1')
assert.ok(decoded.text.length > 1000, 'decoding must recover the whole log, not just the header')
console.log(`  frames in largest: ${decoded.frames} (failed ${decoded.failed})`)

console.log('host route: all cross-checks passed')
