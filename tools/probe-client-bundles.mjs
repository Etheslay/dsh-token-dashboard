// What module ids do real DSH client plugins require(), and how do they wrap?
import fs from 'node:fs'

const files = {
  'dsh-pet': 'C:/Users/wu/.dsh/profiles/desktop/node_modules/dsh-pet/lib/client.js',
  'dsh-codex-ui': 'C:/Users/wu/.dsh/profiles/desktop/node_modules/@michengai/dsh-codex-ui/lib/client.js',
  dshmarket: 'C:/Users/wu/.dsh/profiles/desktop/node_modules/dshmarket/client/client.js',
}

for (const [k, p] of Object.entries(files)) {
  const t = fs.readFileSync(p, 'utf8')
  const set = new Set()
  for (const m of t.matchAll(/\brequire(?:\.async)?\(\s*["']([^"']+)["']\s*\)/g)) set.add(m[1])
  const fm = /factory:\s*\(([^)]*)\)/.exec(t)
  const head = t.slice(0, 0)
  console.log(`=== ${k}`)
  console.log(`   factory(${fm ? fm[1] : '?'})`)
  console.log(`   requires: ${[...set].join(', ') || '(none)'}`)
  const loadIdx = t.indexOf('__ModuleLoader__')
  console.log(`   loader: ${t.slice(loadIdx, loadIdx + 120).replace(/\n/g, ' ')}`)
}

// Show the exact factory header of the codex-ui bundle (a React-based settings plugin)
const cx = fs.readFileSync(files['dsh-codex-ui'], 'utf8')
const i = cx.indexOf('__ModuleLoader__')
console.log('\n=== codex-ui loader region ===')
console.log(cx.slice(i - 200, i + 900))
const j = cx.indexOf('require(')
console.log('\n=== codex-ui first requires ===')
console.log(cx.slice(j - 300, j + 400))
