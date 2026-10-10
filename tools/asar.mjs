// Minimal asar reader: list paths, or extract a subtree to disk.
// Usage: node tools/asar.mjs list <filter> [limit]
//        node tools/asar.mjs extract <pathPrefixInAsar> <outDir>
import fs from 'node:fs'
import path from 'node:path'

const ASAR = 'D:/DSH Desktop/resources/app.asar'
const [, , cmd, arg1, arg2] = process.argv

const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const jsonSize = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(jsonSize)
fs.readSync(fd, jsonBuf, 0, jsonSize, 16)
const header = JSON.parse(jsonBuf.toString('utf8'))
const DATA_OFFSET = 16 + jsonSize

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name
    if (entry.files) walk(entry, p, out)
    else out.push({ path: p, size: entry.size ?? 0, offset: entry.offset })
  }
}

const files = []
walk(header, '', files)

if (cmd === 'list') {
  const filter = arg1 ?? ''
  const limit = Number(arg2 ?? 200)
  const hits = files.filter(f => f.path.includes(filter))
  console.log(`total files: ${files.length}; matching "${filter}": ${hits.length}`)
  for (const f of hits.slice(0, limit)) console.log(`${String(f.size).padStart(9)}  ${f.path}`)
} else if (cmd === 'extract') {
  const prefix = arg1.replace(/\/+$/, '')
  const outDir = arg2
  const hits = files.filter(f => f.path === prefix || f.path.startsWith(prefix + '/'))
  if (hits.length === 0) { console.error('no files under ' + prefix); process.exit(1) }
  let n = 0, bytes = 0
  const prefixIsFile = hits.length === 1 && hits[0].path === prefix
  for (const f of hits) {
    const rel = prefixIsFile
      ? path.basename(f.path)
      : f.path.slice(prefix.length).replace(/^\/+/, '')
    const dest = path.join(outDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const buf = Buffer.alloc(f.size)
    if (f.size > 0) fs.readSync(fd, buf, 0, f.size, DATA_OFFSET + Number(f.offset))
    fs.writeFileSync(dest, buf)
    n++; bytes += f.size
  }
  console.log(`extracted ${n} files (${(bytes / 1048576).toFixed(1)} MiB) -> ${outDir}`)
} else {
  console.error('usage: list <filter> [limit] | extract <prefix> <outDir>')
  process.exit(1)
}
