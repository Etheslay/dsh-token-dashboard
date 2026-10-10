// Probe decoded DSH session logs for token-usage events.
import fs from 'node:fs'
import path from 'node:path'
import { decodeSessionFile } from '../src/host/session-log.ts'

const ROOT = process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'sessions') : 'C:/Users/wu/.dsh/sessions'

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.jsonl.zstd')) out.push({ p, size: fs.statSync(p).size })
  }
  return out
}

const files = walk(ROOT).sort((a, b) => b.size - a.size).slice(0, Number(process.argv[2] ?? 4))
const globalTypes = new Map()
let printedUsage = 0

for (const { p, size } of files) {
  const { text, frames, failed } = decodeSessionFile(p)
  const lines = text.split('\n').filter(Boolean)
  const types = new Map()
  let usageCount = 0
  let firstUsage = null
  let headers = 0
  for (const line of lines) {
    let ev; try { ev = JSON.parse(line) } catch { continue }
    types.set(ev.type, (types.get(ev.type) ?? 0) + 1)
    globalTypes.set(ev.type, (globalTypes.get(ev.type) ?? 0) + 1)
    if (ev.type === 'session') headers++
    if (ev.type === 'assistant/message') {
      const u = ev.data?.usage
      if (u) { usageCount++; if (!firstUsage) firstUsage = { keys: Object.keys(u), u, turn: ev.data.turn, step: ev.data.step, source: ev.data.message?.source } }
    }
  }
  console.log(`\n===== ${path.basename(path.dirname(p))} (${(size / 1024).toFixed(0)} KiB) frames=${frames} fail=${failed} lines=${lines.length} headers=${headers}`)
  console.log('  ' + [...types.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '))
  if (usageCount) {
    console.log(`  assistant/message WITH usage: ${usageCount}`)
    if (printedUsage < 3) { console.log('  SAMPLE ' + JSON.stringify(firstUsage)); printedUsage++ }
  }
}

console.log('\n===== GLOBAL EVENT TYPES =====')
console.log([...globalTypes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('\n'))
