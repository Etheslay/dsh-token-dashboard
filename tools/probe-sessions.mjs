// Inspect DSH session logs: type histogram + token-usage-bearing events.
// Usage: node tools/probe-sessions.mjs [maxFiles]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'sessions') : 'C:/Users/wu/.dsh/sessions'
const maxFiles = Number(process.argv[2] ?? 6)

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.jsonl.zstd')) out.push({ p, size: fs.statSync(p).size })
  }
  return out
}

const files = walk(ROOT).sort((a, b) => b.size - a.size).slice(0, maxFiles)

for (const { p, size } of files) {
  let text
  try { text = zlib.zstdDecompressSync(fs.readFileSync(p)).toString('utf8') } catch (err) {
    console.log(`!! ${p}: ${err.message}`); continue
  }
  const lines = text.split('\n').filter(Boolean)
  const types = new Map()
  let usageEvents = 0
  const samples = []
  for (const line of lines) {
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    types.set(ev.type, (types.get(ev.type) ?? 0) + 1)
    const u = ev?.data?.usage
    if (u) {
      usageEvents++
      if (samples.length < 4) samples.push({ type: ev.type, turn: ev.data.turn, step: ev.data.step, usage: u, source: ev.data.message?.source, ts: ev.timestamp ?? ev.ts })
    }
  }
  console.log(`\n===== ${p}`)
  console.log(`   bytes=${size} lines=${lines.length} usageEvents=${usageEvents}`)
  console.log('   types: ' + [...types.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '))
  if (lines[0]) console.log('   header: ' + lines[0].slice(0, 300))
  for (const s of samples) console.log('   USAGE ' + JSON.stringify(s))
}
