/**
 * Fold unit tests over synthetic durable events.
 *
 * The live-store cross-check (`host-route.test.mjs`) can only prove what THIS
 * store happens to contain, and this store writes exactly one
 * `assistant/message` per step — so its replacement path never executes and its
 * `responses` accounting always looks consistent. These events exercise the
 * paths the store does not: a streamed re-report, a retry that must count
 * twice, a replacement that lands on a different local day, and a usage sample
 * that only exists inside the settlement's stream.
 */
import assert from 'node:assert/strict'
import { foldSession } from '../src/host/fold.ts'

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures++
    console.log(`  FAIL ${name}\n       ${error.message.split('\n')[0]}`)
  }
}

const TZ = 'Asia/Shanghai'
/** 2026-05-07 14:00 in Asia/Shanghai. */
const T0 = Date.UTC(2026, 4, 7, 6, 0, 0)

const usage = (input, output, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
  reasoningTokens: 0,
})

const settlement = (turn, step, u, time) => ({
  type: 'assistant/message',
  seq: time,
  time,
  data: { turn, step, usage: u, message: { source: { provider: 'p', model: 'm' } } },
})

const streamSettlement = (turn, step, u, time) => ({
  type: 'assistant/message',
  seq: time,
  time,
  data: {
    turn,
    step,
    stream: [
      { type: 'chunk', time, chunk: { type: 'text', text: 'x' } },
      { type: 'chunk', time, chunk: { type: 'usage', usage: u } },
    ],
    message: { source: { provider: 'p', model: 'm' } },
  },
})

const turnStart = (turn, time) => ({ type: 'turn/start', seq: time, time, data: { turn } })
const turnEnd = (turn, time) => ({ type: 'turn/end', seq: time, time, data: { turn } })
const retryStarted = (turn, step, time) => ({ type: 'llm/retry-started', seq: time, time, data: { turn, step } })

/** The four response tallies that must always agree. */
const responseTallies = (fold) => ({
  session: fold.responses,
  day: [...fold.days.values()].reduce((sum, day) => sum + day.responses, 0),
  route: [...fold.routes.values()].reduce((sum, route) => sum + route.responses, 0),
})

check('a settlement is counted once, and a retried step counts twice', () => {
  const plain = foldSession([turnStart(1, T0), settlement(1, 1, usage(100, 10), T0 + 1000)], { timeZone: TZ })
  assert.equal(plain.responses, 1)
  assert.equal(plain.totals.totalTokens, 110)

  // `llm/retry-started` closes the replacement slot, so the retried attempt is a
  // second, separately billed settlement of the same step.
  const retried = foldSession(
    [turnStart(1, T0), settlement(1, 1, usage(100, 10), T0 + 1000), retryStarted(1, 1, T0 + 1500), settlement(1, 1, usage(100, 10), T0 + 2000)],
    { timeZone: TZ },
  )
  assert.equal(retried.responses, 2, 'a retry must count as a second response')
  assert.equal(retried.totals.totalTokens, 220, 'a retry must add its tokens, not replace')
  assert.deepEqual(responseTallies(retried), { session: 2, day: 2, route: 2 })
})

check('an identical re-report is a no-op', () => {
  const fold = foldSession(
    [turnStart(1, T0), settlement(1, 1, usage(100, 10), T0 + 1000), settlement(1, 1, usage(100, 10), T0 + 2000)],
    { timeZone: TZ },
  )
  assert.equal(fold.responses, 1, 're-reporting the same numbers must not add a response')
  assert.equal(fold.totals.totalTokens, 110, 're-reporting the same numbers must not add tokens')
})

check('a streamed re-report REPLACES its predecessor in every tally', () => {
  const fold = foldSession(
    [turnStart(1, T0), settlement(1, 1, usage(100, 10), T0 + 1000), settlement(1, 1, usage(150, 20), T0 + 2000)],
    { timeZone: TZ },
  )
  assert.equal(fold.totals.uncachedInputTokens, 150, 'the later sample replaces the earlier one')
  assert.equal(fold.totals.outputTokens, 20)
  assert.equal(fold.totals.totalTokens, 170)
  // One slot, so one response — everywhere. This is the assertion the old fold
  // failed: the session and day counters said 2 while the routes said 1.
  assert.deepEqual(
    responseTallies(fold),
    { session: 1, day: 1, route: 1 },
    'a replacement is still one settlement, whichever tally is asked',
  )
})

check('a replacement landing on another day MOVES the response count', () => {
  // 23:59 on 2026-05-07, then 00:01 on 2026-05-08, both in Asia/Shanghai.
  const before = Date.UTC(2026, 4, 7, 15, 59, 0)
  const after = Date.UTC(2026, 4, 7, 16, 1, 0)
  const fold = foldSession([turnStart(1, before), settlement(1, 1, usage(100, 10), before), settlement(1, 1, usage(150, 20), after)], {
    timeZone: TZ,
  })
  assert.deepEqual([...fold.days.keys()].sort(), ['2026-05-07', '2026-05-08'])
  const tallies = responseTallies(fold)
  assert.deepEqual(tallies, { session: 1, day: 1, route: 1 }, 'the count must move with the tokens, not double')
  assert.equal(fold.days.get('2026-05-08').buckets.uncachedInputTokens, 150)
  assert.equal(fold.days.get('2026-05-07').buckets.uncachedInputTokens, 0)
  assert.equal(fold.days.get('2026-05-07').responses, 0, 'the vacated day must not keep a response')
})

check('usage embedded in the settlement stream is folded', () => {
  // DSH v2 logs carry the provider sample only inside the compact stream.
  const fold = foldSession([turnStart(1, T0), streamSettlement(1, 1, usage(70, 7), T0 + 1000)], { timeZone: TZ })
  assert.equal(fold.totals.totalTokens, 77)
  assert.equal(fold.responses, 1)
})

check('day, route and total buckets always reconstruct each other', () => {
  const events = [
    turnStart(1, T0),
    settlement(1, 1, usage(100, 10, 5, 1), T0 + 1000),
    settlement(1, 1, usage(120, 12, 5, 1), T0 + 2000),
    retryStarted(1, 1, T0 + 2500),
    settlement(1, 1, usage(200, 20), T0 + 3000),
    settlement(1, 2, usage(300, 30, 50), T0 + 4000),
    turnEnd(1, T0 + 5000),
  ]
  const fold = foldSession(events, { timeZone: TZ })
  const sum = (records) =>
    records.reduce(
      (total, record) =>
        total + record.uncachedInputTokens + record.outputTokens + record.cacheReadTokens + record.cacheWriteTokens,
      0,
    )
  assert.equal(sum([...fold.days.values()].map((day) => day.buckets)), fold.totals.totalTokens)
  assert.equal(sum([...fold.routes.values()].map((route) => route.buckets)), fold.totals.totalTokens)
  assert.equal(fold.responses, 3, 'two slots, the first of them retried once')
  assert.deepEqual(responseTallies(fold), { session: 3, day: 3, route: 3 })
  for (const day of fold.days.values()) {
    for (const value of Object.values(day.buckets)) assert.ok(value >= 0, 'no bucket may go negative')
  }
})

check('the longest turn is measured from the start to the end, once', () => {
  const fold = foldSession([turnStart(1, T0), settlement(1, 1, usage(1, 1), T0 + 1000), turnEnd(1, T0 + 46_000)], { timeZone: TZ })
  assert.equal(fold.longestTurnMs, 46_000)
  const twice = foldSession(
    [turnStart(1, T0), settlement(1, 1, usage(1, 1), T0 + 1000), turnEnd(1, T0 + 46_000), turnEnd(1, T0 + 46_000)],
    { timeZone: TZ },
  )
  assert.equal(twice.longestTurnMs, 46_000, 'a duplicate turn/end must not re-measure the same turn')
})

check('an event with no usable timestamp inherits the previous one', () => {
  const events = [turnStart(1, T0), { type: 'assistant/message', seq: 2, data: { turn: 1, step: 1, usage: usage(100, 10) } }]
  const fold = foldSession(events, { timeZone: TZ })
  const days = [...fold.days.keys()]
  assert.deepEqual(days, ['2026-05-07'], `an unstamped event must not invent a day, got ${days.join(', ')}`)
})

check('a malformed token field is rounded, not dropped to zero', () => {
  const fold = foldSession([turnStart(1, T0), settlement(1, 1, { inputTokens: 99.6, outputTokens: -5 }, T0 + 1000)], {
    timeZone: TZ,
  })
  assert.equal(fold.totals.uncachedInputTokens, 100, 'a finite non-integer is rounded')
  assert.equal(fold.totals.outputTokens, 0, 'a negative is treated as absent')
})

check('reasoning tokens are never billed twice', () => {
  const fold = foldSession(
    [turnStart(1, T0), settlement(1, 1, { inputTokens: 10, outputTokens: 100, reasoningTokens: 80 }, T0 + 1000)],
    { timeZone: TZ },
  )
  assert.equal(fold.totals.totalTokens, 110, 'reasoning is a subset of output, so it adds nothing')
  assert.equal(fold.totals.reasoningTokens, 80, 'the subset is still reported')
})

console.log(failures === 0 ? '\nfold: all checks passed' : `\nfold: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
