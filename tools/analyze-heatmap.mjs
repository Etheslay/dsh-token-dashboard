// Derive the heatmap's exact palette and cell geometry from a reference shot.
import { decodePng, pixel, histogram } from './sample-shot.mjs'

const ATTACH = 'C:/Users/wu/.dsh/attachments/v1/objects'
const file = process.argv[2] ?? `${ATTACH}/20/208b9a6a4dd36f2e1c9f63a7fe21287659fd8a685d14732bae9adef1047b81e4`
const img = decodePng(file)
console.log(`image: ${img.width}x${img.height}`)

/** Is this pixel a purple (the active ramp) rather than a neutral? */
const isPurple = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return b > r && r > g + 10 && b > 90
}

// 1. Every distinct active colour, by frequency.
const purples = new Map()
for (let y = 0; y < img.height; y++) {
  for (let x = 0; x < img.width; x++) {
    const c = pixel(img, x, y)
    if (isPurple(c)) purples.set(c, (purples.get(c) ?? 0) + 1)
  }
}
console.log('\ndistinct active colours (>=200 px):')
for (const [c, n] of [...purples.entries()].sort((a, b) => b[1] - a[1])) {
  if (n >= 200) console.log(`  ${c}  ${String(n).padStart(7)}`)
}

// 2. Cell geometry: walk one row and report the runs of non-background pixels.
const bg = '#111111'
for (const y of [90, 100, 110, 120]) {
  const runs = []
  let start = -1
  for (let x = 0; x < img.width; x++) {
    const c = pixel(img, x, y)
    const ink = c !== bg
    if (ink && start < 0) start = x
    else if (!ink && start >= 0) {
      runs.push([start, x - start])
      start = -1
    }
  }
  const widths = [...new Set(runs.map((r) => r[1]))].sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i < runs.length; i++) gaps.push(runs[i][0] - (runs[i - 1][0] + runs[i - 1][1]))
  console.log(`\ny=${y}: ${runs.length} runs; widths ${widths.join(',')}; gaps ${[...new Set(gaps)].join(',')}`)
}

// 3. Row pitch: scan one column for vertical runs.
const col = 500
const vruns = []
let vs = -1
for (let y = 0; y < img.height; y++) {
  const ink = pixel(img, col, y) !== bg
  if (ink && vs < 0) vs = y
  else if (!ink && vs >= 0) {
    vruns.push([vs, y - vs])
    vs = -1
  }
}
console.log(`\ncolumn x=${col}: vertical runs ${JSON.stringify(vruns.slice(0, 12))}`)
const pitches = []
for (let i = 1; i < vruns.length; i++) pitches.push(vruns[i][0] - vruns[i - 1][0])
console.log(`row pitch: ${[...new Set(pitches)].join(',')}`)

// 4. Text colours: the light greys used for labels vs values.
console.log('\nlightest greys:')
for (const [c, n] of histogram(img, { x: 0, y: 0, w: img.width, h: img.height }).slice(0, 40)) {
  const r = parseInt(c.slice(1, 3), 16)
  if (r > 130 && !isPurple(c)) console.log(`  ${c}  ${n}`)
}
