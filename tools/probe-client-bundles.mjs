// What module ids do real DSH client plugins require(), and how do they wrap?
//
// The paths are the machine this was written on; override the profile root with
// DSH_PROFILE_DIR on any other one.
import fs from 'node:fs'
import path from 'node:path'
import { DSH_HOME } from './session-store.mjs'

const profileDir = process.env.DSH_PROFILE_DIR ?? path.join(DSH_HOME, 'profiles', 'desktop')
const modules = path.join(profileDir, 'node_modules')

const files = {
  'dsh-pet': path.join(modules, 'dsh-pet/lib/client.js'),
  'dsh-codex-ui': path.join(modules, '@michengai/dsh-codex-ui/lib/client.js'),
  dshmarket: path.join(modules, 'dshmarket/client/client.js'),
}

let missing = 0
for (const [k, p] of Object.entries(files)) {
  if (!fs.existsSync(p)) {
    console.log(`=== ${k}\n   (not installed at ${p})`)
    missing++
    continue
  }
  const t = fs.readFileSync(p, 'utf8')
  const set = new Set()
  for (const m of t.matchAll(/\brequire(?:\.async)?\(\s*["']([^"']+)["']\s*\)/g)) set.add(m[1])
  const fm = /factory:\s*\(([^)]*)\)/.exec(t)
  console.log(`=== ${k}`)
  console.log(`   factory(${fm ? fm[1] : '?'})`)
  console.log(`   requires: ${[...set].join(', ') || '(none)'}`)
  const loadIdx = t.indexOf('__ModuleLoader__')
  console.log(`   loader: ${t.slice(loadIdx, loadIdx + 120).replace(/\n/g, ' ')}`)
}
if (missing === Object.keys(files).length) {
  console.error(`\nno client bundles found under ${modules}; set DSH_PROFILE_DIR to the profile that has them`)
  process.exit(2)
}

// Show the exact factory header of the codex-ui bundle (a React-based settings plugin)
const codexUi = files['dsh-codex-ui']
if (fs.existsSync(codexUi)) {
  const cx = fs.readFileSync(codexUi, 'utf8')
  const i = cx.indexOf('__ModuleLoader__')
  console.log('\n=== codex-ui loader region ===')
  console.log(cx.slice(i - 200, i + 900))
  const j = cx.indexOf('require(')
  console.log('\n=== codex-ui first requires ===')
  console.log(cx.slice(j - 300, j + 400))
}
