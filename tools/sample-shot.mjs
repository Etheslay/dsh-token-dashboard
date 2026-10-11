/**
 * Sample colours from the reference screenshots.
 *
 * PNG decoding without a dependency: parse the IHDR, concatenate the IDAT
 * payload, inflate, then undo the per-scanline filters. Only what these images
 * use is supported — 8-bit RGB/RGBA, no interlacing — and anything else is
 * reported rather than guessed at.
 */
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'

const ATTACH = 'C:/Users/wu/.dsh/attachments/v1/objects'

/** Decode a PNG into `{ width, height, channels, data }`. */
export function decodePng(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let offset = 8
  let width, height, bitDepth, colorType, interlace
  const idat = []
  let palette = null
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const body = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]
      colorType = body[9]
      interlace = body[12]
    } else if (type === 'PLTE') palette = Buffer.from(body)
    else if (type === 'IDAT') idat.push(Buffer.from(body))
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  if (interlace !== 0) throw new Error('interlaced PNG is not supported')
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 3 ? 1 : 0
  if (channels === 0) throw new Error(`unsupported colour type ${colorType}`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bitsPerPixel = channels * 8
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  const out = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let value = line[x]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = value & 0xff
    }
  }
  return { width, height, channels, data: out, stride, palette }
}

/** Read one pixel as `#rrggbb`. */
export function pixel(img, x, y) {
  const i = y * img.stride + x * img.channels
  if (img.channels === 1 && img.palette) {
    const p = img.palette
    const idx = img.data[i] * 3
    return `#${p[idx].toString(16).padStart(2, '0')}${p[idx + 1].toString(16).padStart(2, '0')}${p[idx + 2].toString(16).padStart(2, '0')}`
  }
  return `#${img.data[i].toString(16).padStart(2, '0')}${img.data[i + 1].toString(16).padStart(2, '0')}${img.data[i + 2].toString(16).padStart(2, '0')}`
}

/** The most common colours in a rectangle, most frequent first. */
export function histogram(img, box) {
  const counts = new Map()
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const c = pixel(img, x, y)
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.log('usage: node tools/sample-shot.mjs <png> [x y w h]')
} else {
  const [file, ...rest] = targets
  const img = decodePng(file)
  console.log(`${path.basename(file)}: ${img.width}x${img.height}, ${img.channels} channel(s)`)
  const box =
    rest.length === 4
      ? { x: Number(rest[0]), y: Number(rest[1]), w: Number(rest[2]), h: Number(rest[3]) }
      : { x: 0, y: 0, w: img.width, h: img.height }
  for (const [colour, count] of histogram(img, box).slice(0, 16)) {
    console.log(`  ${colour}  ${String(count).padStart(7)}`)
  }
}
