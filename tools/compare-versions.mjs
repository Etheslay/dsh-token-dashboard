// Why does the same session have a v3 log with 3563 events and a v4 log with 246?
// Decide which one a reader should trust.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { splitZstdFrames } from '../src/host/session-log.ts'

const ROOT = path.join(process.env.DSH_HOME ?? 'C:/Users/wu/.dsh', 'sessions')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.jsonl.zstd')) out.push(p)
  }
  return out
}

const groups = new Map()
for (const f of walk(ROOT)) {
  const dir = path.dirname(f)
  if (!groups.has(dir)) groups.set(dir, [])
  groups.get(dir).push(f)
}

for (const [dir, files] of groups) {
  if (files.length < 2) continue
  console.log(`\n=== ${path.basename(dir)}  (${files.length} versions)`)
  for (const f of files.sort()) {
    const buf = fs.readFileSync(f)
    const frames = splitZstdFrames(buf)
    let ok = 0, bad = 0, text = ''
    const frameInfo = []
    for (const fr of frames) {
      try {
        const t = zlib.zstdDecompressSync(fr).toString('utf8')
        ok++; text += t
        frameInfo.push(t.length)
      } catch { bad++; frameInfo.push(-1) }
    }
    const lines = text.split('\n').filter(Boolean)
    let seqMax = 0, firstTime = 0, lastTime = 0
    for (const line of lines) {
      try {
        const ev = JSON.parse(line)
        if (typeof ev.seq === 'number' && ev.seq > seqMax) seqMax = ev.seq
        if (typeof ev.time === 'number') { if (!firstTime) firstTime = ev.time; lastTime = ev.time }
      } catch { /* ignore */ }
    }
    console.log(`  ${path.basename(f).padEnd(24)} ${(buf.length / 1024).toFixed(0).padStart(6)} KiB  frames=${String(frames.length).padStart(5)} ok=${String(ok).padStart(5)} bad=${String(bad).padStart(3)}  events=${String(lines.length).padStart(5)}  maxSeq=${String(seqMax).padStart(5)}  span=${firstTime ? new Date(firstTime).toISOString().slice(0, 16) : '?'} .. ${lastTime ? new Date(lastTime).toISOString().slice(0, 16) : '?'}`)
    console.log(`      frame text sizes: ${frameInfo.slice(0, 12).join(', ')}${frameInfo.length > 12 ? ` … (+${frameInfo.length - 12})` : ''}`)
  }
}
