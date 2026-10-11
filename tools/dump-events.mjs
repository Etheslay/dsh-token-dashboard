// Dump one trimmed example of each relevant event type from the biggest session logs.
import path from 'node:path'
import { decodeSessionFile, parseLogEvents } from '../src/host/session-log.ts'
import { listLogsBySize, requireSessionsRoot } from './session-store.mjs'

requireSessionsRoot()
const WANT = [
  'session', 'turn/start', 'turn/end', 'step/start', 'step/end',
  'assistant/message', 'assistant/attempt', 'llm/retry', 'llm/retry-started',
  'request/context', 'request/header', 'user/message', 'system/message', 'session/title',
]

function trim(v, depth = 0) {
  if (depth > 3) return '…'
  if (typeof v === 'string') return v.length > 90 ? v.slice(0, 90) + `…(${v.length})` : v
  if (Array.isArray(v)) return v.length === 0 ? [] : [trim(v[0], depth + 1), `…len=${v.length}`]
  if (v && typeof v === 'object') {
    const o = {}
    for (const [k, val] of Object.entries(v)) o[k] = trim(val, depth + 1)
    return o
  }
  return v
}

const seen = new Map()
const files = listLogsBySize().slice(0, 6)
for (const { path: file } of files) {
  const { events } = parseLogEvents(decodeSessionFile(file).text)
  for (const ev of events) {
    if (!WANT.includes(ev.type) || seen.has(ev.type)) continue
    // prefer samples that actually carry usage / interesting payload
    if (ev.type === 'assistant/attempt' && !ev.data?.stream) continue
    // The `session` header keeps `id` / `cwd` / `createdAt` / `agentPreset` at
    // the TOP level of the event, not under `data` — dumping only `data` printed
    // `{"type":"session"}` and documented nothing.
    const { type, seq, time, data, ...rest } = ev
    seen.set(ev.type, {
      file: path.basename(path.dirname(file)),
      ev: { type, seq, time, ...(Object.keys(rest).length === 0 ? {} : { header: trim(rest) }), data: trim(data) },
    })
  }
}

for (const t of WANT) {
  if (!seen.has(t)) { console.log(`\n### ${t}\n  (not found)`); continue }
  const { file, ev } = seen.get(t)
  console.log(`\n### ${t}   [${file}]`)
  console.log(JSON.stringify(ev, null, 2))
}
