// Inspect DSH session logs: type histogram + token-usage-bearing events.
// Usage: node tools/probe-sessions.mjs [maxFiles]
//
// The decoder is the plugin's own, NOT `zlib.zstdDecompressSync`: a session log
// is a stream of concatenated zstd frames (one per persistence flush), and the
// one-shot API decodes only the FIRST of them. Reading a 6 MB log that way
// reports a single header line and zero usage events with no error at all.
import fs from 'node:fs'
import path from 'node:path'
import { decodeSessionFile, parseLogEvents } from '../src/host/session-log.ts'

const sessionsRoot = process.env.DSH_HOME
  ? path.join(process.env.DSH_HOME, 'sessions')
  : path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'sessions')
const maxFiles = Number(process.argv[2] ?? 6)
if (!Number.isInteger(maxFiles) || maxFiles < 1) {
  console.error(`usage: node tools/probe-sessions.mjs [maxFiles]  (got "${process.argv[2]}")`)
  process.exit(2)
}
if (!fs.existsSync(sessionsRoot)) {
  console.error(`no session store at ${sessionsRoot}; set DSH_HOME or pass a machine that has one`)
  process.exit(2)
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.jsonl.zstd')) out.push({ p, size: fs.statSync(p).size })
  }
  return out
}

const files = walk(sessionsRoot).sort((a, b) => b.size - a.size).slice(0, maxFiles)

for (const { p, size } of files) {
  const decoded = decodeSessionFile(p)
  const { events, malformed } = parseLogEvents(decoded.text)
  const types = new Map()
  let usageEvents = 0
  const samples = []
  for (const ev of events) {
    types.set(ev.type, (types.get(ev.type) ?? 0) + 1)
    const u = ev?.data?.usage
    if (u) {
      usageEvents++
      if (samples.length < 4) {
        samples.push({ type: ev.type, turn: ev.data.turn, step: ev.data.step, usage: u, source: ev.data.message?.source, ts: ev.time })
      }
    }
  }
  console.log(`\n===== ${p}`)
  console.log(
    `   bytes=${size} frames=${decoded.frames} failedFrames=${decoded.failed} events=${events.length} malformedLines=${malformed} usageEvents=${usageEvents}`,
  )
  console.log('   types: ' + [...types.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '))
  const header = events.find((event) => event.type === 'session')
  if (header) console.log('   header: ' + JSON.stringify(header).slice(0, 300))
  for (const s of samples) console.log('   USAGE ' + JSON.stringify(s))
}
