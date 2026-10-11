/**
 * Bilingual documentation guard.
 *
 * The package ships two READMEs and GitHub renders whichever one is named
 * `README.md`, so the pair has to stay structurally identical or one language
 * silently falls behind: a section added to one side, a table row deleted from
 * the other, a code block that changes language. Structure is what is asserted
 * here, not wording — the two languages legitimately differ in emphasis, and
 * translation quality is not something a script can judge.
 *
 * `README.md` is the Chinese one on purpose: GitHub and npm both render that
 * filename, and the project's default reader is Chinese. The English copy lives
 * beside it as `README.en.md`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')

const DEFAULT_FILE = 'README.md'
const OTHER_FILE = 'README.en.md'

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures++
    console.log(`  FAIL ${name}\n       ${error.message.split('\n')[0]}`)
  }
}

const defaultText = read(DEFAULT_FILE)
const otherText = read(OTHER_FILE)

const headings = (text, level) => [...text.matchAll(new RegExp(`^#{${level}} (.+)$`, 'gm'))].map((match) => match[1])
const tableRows = (text) => [...text.matchAll(/^\|.*\|$/gm)].length
const fenced = (text) => [...text.matchAll(/^```(\w*)$/gm)].map((match) => match[1] || '(none)')
const orderedItems = (text) => [...text.matchAll(/^\d+\. /gm)].length
const links = (text) => [...text.matchAll(/\]\(([^)#]+)\)/g)].map((match) => match[1]).sort()

check('both languages exist and package.json ships both', () => {
  const pkg = JSON.parse(read('package.json'))
  for (const file of [DEFAULT_FILE, OTHER_FILE]) {
    assert.ok(pkg.files.includes(file), `package.json's \`files\` must ship ${file}`)
  }
  assert.ok(!pkg.files.includes('README.zh.md'), 'the old README.zh.md name must not linger in `files`')
})

check('the default README is the Chinese one', () => {
  // GitHub and npm render `README.md`; that is the file a visitor lands on, and
  // the project's default reader is Chinese. Prose language is measured by CJK
  // density rather than by "contains no CJK": the English file legitimately
  // quotes three Chinese examples (`3.7亿`, `5317.1万`, `46分59秒`) and the
  // switcher label, and a stricter rule would forbid them.
  const cjk = (text) => [...text.matchAll(/[\u4e00-\u9fff]/g)].length
  assert.ok(cjk(defaultText) > 500, `README.md should be the Chinese text, found ${cjk(defaultText)} CJK characters`)
  assert.ok(cjk(otherText) < 60, `README.en.md should be the English text, found ${cjk(otherText)} CJK characters`)
  // The section headings are the part a reader navigates by, so they are pinned
  // outright: Chinese headings in the default file, English ones beside it.
  assert.ok(/[\u4e00-\u9fff]/.test(headings(defaultText, 2)[0]), 'README.md section headings must be Chinese')
  assert.ok(!/[\u4e00-\u9fff]/.test(headings(otherText, 2)[0]), 'README.en.md section headings must be English')
})

check('the two READMEs have the same section structure', () => {
  for (const level of [2, 3]) {
    const a = headings(defaultText, level)
    const b = headings(otherText, level)
    assert.equal(a.length, b.length, `h${level} count: ${DEFAULT_FILE} has ${a.length}, ${OTHER_FILE} has ${b.length}`)
  }
})

check('the two READMEs have the same block structure', () => {
  assert.equal(tableRows(defaultText), tableRows(otherText), 'table row counts must match')
  assert.deepEqual(fenced(defaultText), fenced(otherText), 'fenced code blocks must match in count and language')
  assert.equal(orderedItems(defaultText), orderedItems(otherText), 'ordered-list item counts must match')
  for (const text of [defaultText, otherText]) {
    const ticks = [...text.matchAll(/^```/gm)].length
    assert.equal(ticks % 2, 0, 'every fenced block must be closed')
  }
})

check('both READMEs point at the same files', () => {
  const a = new Set(links(defaultText))
  const b = new Set(links(otherText))
  // Each links to the other and to itself only through the switcher, so those
  // two are expected to differ.
  const expected = new Set([DEFAULT_FILE, OTHER_FILE])
  const onlyA = [...a].filter((target) => !b.has(target) && !expected.has(target))
  const onlyB = [...b].filter((target) => !a.has(target) && !expected.has(target))
  assert.deepEqual(onlyA, [], `${DEFAULT_FILE} links files the other one does not: ${onlyA.join(', ')}`)
  assert.deepEqual(onlyB, [], `${OTHER_FILE} links files the other one does not: ${onlyB.join(', ')}`)
})

check('each README switches to the other, and not to itself', () => {
  const header = (text) => text.split('\n').slice(0, 8).join('\n')
  assert.match(header(defaultText), new RegExp(`\\(${OTHER_FILE.replace('.', '\\.')}\\)`), `${DEFAULT_FILE} must link ${OTHER_FILE}`)
  assert.ok(
    !new RegExp(`\\(${DEFAULT_FILE.replace('.', '\\.')}\\)`).test(header(defaultText)),
    `${DEFAULT_FILE} must not link itself`,
  )
  assert.match(header(otherText), new RegExp(`\\(${DEFAULT_FILE.replace('.', '\\.')}\\)`), `${OTHER_FILE} must link ${DEFAULT_FILE}`)
  assert.ok(
    !new RegExp(`\\(${OTHER_FILE.replace('.', '\\.')}\\)`).test(header(otherText)),
    `${OTHER_FILE} must not link itself`,
  )
})

check('the shipped install command carries the npm scope', () => {
  const pkg = JSON.parse(read('package.json'))
  for (const [file, text] of [
    [DEFAULT_FILE, defaultText],
    [OTHER_FILE, otherText],
  ]) {
    assert.ok(text.includes(pkg.name), `${file} must install the package by its real name, ${pkg.name}`)
    assert.ok(
      !/dsh plugin add dsh-token-dashboard(?!\S)/.test(text),
      `${file} still installs the bare, already-taken package name`,
    )
  }
})

console.log(failures === 0 ? '\nreadme: all checks passed' : `\nreadme: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
