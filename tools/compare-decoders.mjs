// Compare three ways of decoding a multi-frame zstd session log:
//   1. zstdDecompressSync on the whole buffer (what a naive reader does)
//   2. magic-scan frame splitting + per-frame zstdDecompressSync
//   3. a streaming zstd decompressor fed the whole buffer
// The one that recovers the most bytes/lines with zero errors wins.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { splitZstdFrames } from '../src/host/session-log.ts'
import { listLogsBySize, requireSessionsRoot } from './session-store.mjs'

requireSessionsRoot()

async function streamDecode(buffer) {
  return new Promise((resolve) => {
    const chunks = []
    const dec = zlib.createZstdDecompress()
    dec.on('data', (c) => chunks.push(c))
    dec.on('error', (e) => resolve({ text: Buffer.concat(chunks).toString('utf8'), error: e.message }))
    dec.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }))
    dec.end(buffer)
  })
}

const files = listLogsBySize().slice(0, 6).map((entry) => entry.path)
console.log('streaming zstd available:', typeof zlib.createZstdDecompress === 'function')

for (const file of files) {
  const buf = fs.readFileSync(file)
  const label = path.basename(path.dirname(file)).slice(0, 22)

  let single = ''
  try { single = zlib.zstdDecompressSync(buf).toString('utf8') } catch (e) { single = `ERR ${e.message}` }

  const frames = splitZstdFrames(buf)
  let split = '', failed = 0
  for (const f of frames) { try { split += zlib.zstdDecompressSync(f).toString('utf8') } catch { failed++ } }

  const streamed = await streamDecode(buf)

  const lines = (t) => t.split('\n').filter(Boolean).length
  console.log(`\n=== ${label}  ${(buf.length / 1024).toFixed(0)} KiB`)
  console.log(`  single  : ${String(lines(single)).padStart(6)} lines  ${single.length} chars`)
  console.log(`  split   : ${String(lines(split)).padStart(6)} lines  ${split.length} chars  frames=${frames.length} failed=${failed}`)
  console.log(`  stream  : ${String(lines(streamed.text)).padStart(6)} lines  ${streamed.text.length} chars  ${streamed.error ?? 'ok'}`)
  console.log(`  split===stream ? ${split === streamed.text}   single===stream ? ${single === streamed.text}`)
}
