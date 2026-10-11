// Minimal asar reader: list paths, or extract a subtree to disk.
// Usage: node tools/asar.mjs list <filter> [limit]
//        node tools/asar.mjs extract <pathPrefixInAsar> <outDir>
//
// Entries flagged `unpacked` have no offset inside the archive — their bytes
// live in the sibling `app.asar.unpacked/` directory. Reading them by offset
// yields NaN and a RangeError, so they are copied from the sidecar instead.
import fs from 'node:fs'
import path from 'node:path'

const ASAR = process.env.DSH_ASAR ?? 'D:/DSH Desktop/resources/app.asar'

if (!fs.existsSync(ASAR)) {
  console.error(`no asar archive at ${ASAR}; set DSH_ASAR to point at one`)
  process.exit(2)
}
const UNPACKED = `${ASAR}.unpacked`

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
    else out.push({ path: p, size: entry.size ?? 0, offset: entry.offset, unpacked: entry.unpacked === true })
  }
}

const files = []
walk(header, '', files)

/** Where an entry's bytes actually are. */
function readEntry(f) {
  if (f.unpacked) return fs.readFileSync(path.join(UNPACKED, f.path))
  const buf = Buffer.alloc(f.size)
  if (f.size > 0) fs.readSync(fd, buf, 0, f.size, DATA_OFFSET + Number(f.offset))
  return buf
}

if (cmd === 'list') {
  const filter = arg1 ?? ''
  const limit = Number.isInteger(Number(arg2)) && Number(arg2) > 0 ? Number(arg2) : 200
  const hits = files.filter((f) => f.path.includes(filter))
  console.log(`total files: ${files.length}; matching "${filter}": ${hits.length}`)
  for (const f of hits.slice(0, limit)) console.log(`${String(f.size).padStart(9)}${f.unpacked ? ' U' : '  '}  ${f.path}`)
} else if (cmd === 'extract') {
  if (arg1 === undefined || arg2 === undefined) {
    console.error('usage: extract <pathPrefixInAsar> <outDir>')
    process.exit(1)
  }
  const prefix = arg1.replace(/\/+$/, '')
  const outDir = arg2
  const hits = files.filter((f) => f.path === prefix || f.path.startsWith(prefix + '/'))
  if (hits.length === 0) { console.error('no files under ' + prefix); process.exit(1) }
  let n = 0, bytes = 0, unpackedCount = 0
  const prefixIsFile = hits.length === 1 && hits[0].path === prefix
  for (const f of hits) {
    const rel = prefixIsFile
      ? path.basename(f.path)
      : f.path.slice(prefix.length).replace(/^\/+/, '')
    const dest = path.join(outDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, readEntry(f))
    if (f.unpacked) unpackedCount++
    n++; bytes += f.size
  }
  console.log(
    `extracted ${n} files (${(bytes / 1048576).toFixed(1)} MiB) -> ${outDir}` +
      (unpackedCount > 0 ? ` [${unpackedCount} from ${path.basename(UNPACKED)}]` : ''),
  )
} else {
  console.error('usage: list <filter> [limit] | extract <prefix> <outDir>')
  process.exit(1)
}
