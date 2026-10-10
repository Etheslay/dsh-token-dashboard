// Dump one trimmed example of each relevant event type from the biggest session logs.
import fs from 'node:fs'
import path from 'node:path'
import { decodeSessionFile } from '../src/host/session-log.ts'

const ROOT = path.join(process.env.DSH_HOME ?? 'C:/Users/wu/.dsh', 'sessions')
const WANT = [
  'session', 'turn/start', 'turn/end', 'step/start', 'step/end',
  'assistant/message', 'assistant/attempt', 'llm/retry', 'llm/retry-started',
  'request/context', 'request/header', 'user/message', 'system/message', 'session/title',
]

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.jsonl.zstd')) out.push({ p, size: fs.statSync(p).size })
  }
  return out
}

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
const files = walk(ROOT).sort((a, b) => b.size - a.size).slice(0, 6)
for (const { p } of files) {
  const { text } = decodeSessionFile(p)
  for (const line of text.split('\n')) {
    if (!line) continue
    let ev; try { ev = JSON.parse(line) } catch { continue }
    if (!WANT.includes(ev.type) || seen.has(ev.type)) continue
    // prefer samples that actually carry usage / interesting payload
    if (ev.type === 'assistant/attempt' && !ev.data?.stream) continue
    seen.set(ev.type, { file: path.basename(path.dirname(p)), ev: { type: ev.type, seq: ev.seq, time: ev.time, data: trim(ev.data) } })
  }
}

for (const t of WANT) {
  if (!seen.has(t)) { console.log(`\n### ${t}\n  (not found)`); continue }
  const { file, ev } = seen.get(t)
  console.log(`\n### ${t}   [${file}]`)
  console.log(JSON.stringify(ev, null, 2))
}
