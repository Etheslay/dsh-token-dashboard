// Probe decoded DSH session logs for token-usage events.
// Usage: node tools/probe-usage.mjs [maxFiles]
import path from 'node:path'
import { decodeSessionFile, parseLogEvents } from '../src/host/session-log.ts'
import { listLogsBySize, positiveIntArg, requireSessionsRoot } from './session-store.mjs'

requireSessionsRoot()
const maxFiles = positiveIntArg(process.argv[2], 4, 'usage: node tools/probe-usage.mjs [maxFiles]')

const files = listLogsBySize().slice(0, maxFiles)
const globalTypes = new Map()
let printedUsage = 0

for (const { path: file, size } of files) {
  const { text, frames, failed } = decodeSessionFile(file)
  const { events } = parseLogEvents(text)
  const types = new Map()
  let usageCount = 0
  let firstUsage = null
  let headers = 0
  for (const ev of events) {
    types.set(ev.type, (types.get(ev.type) ?? 0) + 1)
    globalTypes.set(ev.type, (globalTypes.get(ev.type) ?? 0) + 1)
    if (ev.type === 'session') headers++
    if (ev.type === 'assistant/message') {
      const u = ev.data?.usage
      if (u) { usageCount++; if (!firstUsage) firstUsage = { keys: Object.keys(u), u, turn: ev.data.turn, step: ev.data.step, source: ev.data.message?.source } }
    }
  }
  console.log(`\n===== ${path.basename(path.dirname(file))} (${(size / 1024).toFixed(0)} KiB) frames=${frames} fail=${failed} events=${events.length} headers=${headers}`)
  console.log('  ' + [...types.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '))
  if (usageCount) {
    console.log(`  assistant/message WITH usage: ${usageCount}`)
    if (printedUsage < 3) { console.log('  SAMPLE ' + JSON.stringify(firstUsage)); printedUsage++ }
  }
}

console.log('\n===== GLOBAL EVENT TYPES =====')
console.log([...globalTypes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('\n'))
