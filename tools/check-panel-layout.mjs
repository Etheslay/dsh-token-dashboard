/**
 * Measure the panel's layout in a real browser.
 *
 * The panel's two hardest-to-see defects were both layout, and both had already
 * survived a code review and a passing test suite:
 *
 *   - the settings dialog showed TWO scrollbars, because `.tdd` carried
 *     `height:100%; overflow-y:auto` inside a host that already scrolls; and
 *   - the heatmap stopped at a hard-coded `max-width:660px` while the
 *     five-number bar and the footer ran to the panel's edge, so the graph did
 *     not line up with the blocks above and below it.
 *
 * Neither is visible to a DOM assertion: they only exist once the browser has
 * resolved the grid, the flex column and the dialog's own scroll geometry. So
 * this tool renders the real panel through the real React at several widths and
 * asserts the geometry instead of the markup.
 *
 * Chrome is driven over the DevTools protocol, with no dependency: Node's global
 * `fetch` starts the session and Node's global `WebSocket` speaks to it.
 *
 * Usage:
 *   node tools/check-panel-layout.mjs [--widths 560,720,1000,1280,1600] [--chrome <path>]
 *                                     [--html docs/panel.html] [--shot out.png]
 *                                     [--theme dark|light] [--bare]
 *
 * `--html` measures an existing page instead of the built fixture — point it at
 * `docs/panel.html` (from `npm run preview`) to check the panel with real
 * session data and the real DSH theme tokens.
 *
 * `--shot` captures the LAST width; with `--bare` it also hides the preview's own
 * sidebar and footer, so the PNG is the panel alone. The viewport is then sized
 * to the panel, because the capture must be no taller than the window: a
 * full-height layout scrolls inside itself rather than growing the document.
 * Pass `--theme` alongside it to pin the theme; without one the capture uses
 * whatever the headless browser defaults to.
 *
 * @module dsh-token-dashboard/tools/check-panel-layout
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFixtureHtml } from './panel-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Where Chrome usually lives, per platform. */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((candidate) => candidate !== undefined)

/**
 * The in-page measurement, as source text.
 *
 * Kept as a string so it can be handed to `Runtime.evaluate` whole; it must stay
 * a single expression that returns JSON-able data.
 */
const MEASURE = String.raw`(() => {
  const round = (v) => Math.round(v * 10) / 10;
  const rect = (el) => el.getBoundingClientRect();
  const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail: detail ?? '' });

  const panel = document.querySelector('.tdd');
  if (panel === null) return { width: innerWidth, checks: 0, failures: [{ name: 'panel not found', ok: false, detail: 'no .tdd in the page' }] };

  // The page's own scroller stands in for the settings dialog body.
  const scroller = document.querySelector('.dialog-scroll') ?? document.querySelector('main');
  const stats = document.querySelector('.tdd-stats');
  const cols = document.querySelector('.tdd-cols');
  const blocks = [...document.querySelectorAll('.tdd-heat-block')];
  if (stats === null || blocks.length === 0) {
    return {
      width: innerWidth,
      checks: 1,
      failures: [{ name: 'panel has no content', ok: false, detail: 'stats=' + (stats === null ? 'missing' : 'ok') + ' blocks=' + blocks.length }],
    };
  }
  const firstGrid = blocks[0].querySelector('.tdd-heat-grid');
  const firstMonths = blocks[0].querySelector('.tdd-heat-months');

  // 1. ONE scrollbar: the host's, never the panel's.
  check('panel is not a scroll container',
    panel.scrollHeight <= panel.clientHeight + 1,
    panel.scrollHeight + ' / ' + panel.clientHeight + ', overflowY=' + getComputedStyle(panel).overflowY);
  check('the host still scrolls',
    scroller !== null && getComputedStyle(scroller).overflowY === 'auto',
    scroller === null ? 'no scroller' : getComputedStyle(scroller).overflowY);
  check('nothing overflows horizontally',
    document.documentElement.scrollWidth <= innerWidth,
    document.documentElement.scrollWidth + ' vs ' + innerWidth);
  const scrollers = [panel, scroller, document.body].filter(
    (el) => el !== null && el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible',
  );
  check('at most one vertical scrollbar on the page', scrollers.length <= 1, String(scrollers.length));

  // 2. The heatmap lines up with the blocks above and below it.
  const panelInner = rect(panel).width - 4;
  check('heatmap fills the panel gutter',
    rect(firstGrid).width >= panelInner - 6,
    round(rect(firstGrid).width) + ' vs ' + round(panelInner));
  for (const [name, el] of [['stats', stats], ['grid', firstGrid], ['month axis', firstMonths], ['insights', cols]]) {
    if (el === null) { check(name + ' exists', false, 'missing'); continue; }
    check('left edge of ' + name + ' lines up', near(rect(el).left, rect(stats).left, 1.1),
      round(rect(el).left) + ' vs ' + round(rect(stats).left));
    check('right edge of ' + name + ' lines up', near(rect(el).right, rect(stats).right, 1.1),
      round(rect(el).right) + ' vs ' + round(rect(stats).right));
  }

  // 3. Square cells, one size across both blocks, months on their own tracks.
  const cellSizes = [];
  blocks.forEach((block, index) => {
    const grid = block.querySelector('.tdd-heat-grid');
    const months = block.querySelector('.tdd-heat-months');
    const cells = [...grid.children];
    const first = rect(cells[0]);
    check('block ' + index + ': cell is square', near(first.width, first.height, 0.6),
      round(first.width) + 'x' + round(first.height));
    check('block ' + index + ': row pitch is cell + gap',
      near(rect(cells[1]).top - first.top, first.height + 4, 0.6), round(rect(cells[1]).top - first.top));
    check('block ' + index + ': column pitch is cell + gap',
      near(rect(cells[7]).left - first.left, first.width + 4, 0.6), round(rect(cells[7]).left - first.left));
    check('block ' + index + ': whole weeks', cells.length % 7 === 0, String(cells.length));
    cellSizes.push(round(first.width));

    const labels = [...months.children];
    const monthBox = rect(months);
    const pitch = (monthBox.width + 4) / labels.length;
    const named = labels.map((span, column) => ({ span, column })).filter((e) => e.span.textContent.trim().length > 0);
    check('block ' + index + ': months are named', named.length > 0, String(named.length));
    for (const { span, column } of named) {
      const r = rect(span);
      const columnLeft = monthBox.left + column * pitch;
      check('block ' + index + ': month on track ' + column, near(r.left, columnLeft, 1.1),
        round(r.left) + ' vs ' + round(columnLeft));
    }
    check('block ' + index + ': axis is as wide as the grid',
      near(monthBox.width, rect(grid).width, 1.1), round(monthBox.width) + ' vs ' + round(rect(grid).width));
  });
  check('both blocks use one cell size', new Set(cellSizes).size === 1, cellSizes.join(' / '));

  // The two rows have to LOOK the same width. They are padded to a shared column
  // count precisely so this holds: without it the shorter block renders its
  // columns wider and stops short of the one above it, which reads as a row that
  // is missing a column.
  if (blocks.length >= 2) {
    const widths = blocks.map((block) => round(rect(block.querySelector('.tdd-heat-grid')).width));
    const columns = blocks.map((block) => block.querySelector('.tdd-heat-grid').children.length / 7);
    check('both blocks render the same column count', new Set(columns).size === 1, columns.join(' / '));
    check('both blocks render the same width', new Set(widths).size === 1, widths.join(' / '));
    check('both blocks share a left edge',
      near(rect(blocks[0].querySelector('.tdd-heat-grid')).left, rect(blocks[1].querySelector('.tdd-heat-grid')).left, 0.6),
      'grids must start together');
  }

  // 4. Nothing squashed by the flex column.
  check('stat bar keeps its height', rect(stats).height > 60, round(rect(stats).height) + 'px');
  const squashed = [...panel.children].filter((child) => rect(child).height < 8);
  check('no panel child is squashed', squashed.length === 0, String(squashed.length));

  return { width: innerWidth, checks: results.length, failures: results.filter((r) => !r.ok) };
})()`

/** Parse `--flag value` pairs. */
function parseArgs(argv) {
  const options = {
    widths: [560, 720, 1000, 1280, 1600],
    html: undefined,
    shot: undefined,
    chrome: undefined,
    theme: undefined,
    bare: false,
    days: 371,
  }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--bare') {
      options.bare = true
      continue
    }
    const value = argv[++index]
    if (flag === '--widths') options.widths = String(value).split(',').map(Number)
    else if (flag === '--html') options.html = value
    else if (flag === '--shot') options.shot = value
    else if (flag === '--chrome') options.chrome = value
    else if (flag === '--theme') options.theme = value
    else if (flag === '--days') options.days = Number(value)
    else throw new Error(`unknown option ${flag}`)
  }
  if (options.theme !== undefined && options.theme !== 'dark' && options.theme !== 'light') {
    throw new Error(`--theme must be dark or light, got ${options.theme}`)
  }
  return options
}

/**
 * Strip the preview harness down to the panel, for a capture.
 *
 * Removes the settings sidebar and the footer line, and drops the page's
 * `height:100%` so the document is exactly as tall as the panel.
 * @returns Source text for `Runtime.evaluate`.
 */
const BARE_PANEL = `(() => {
  document.querySelector('nav')?.remove();
  document.querySelector('.hint')?.remove();
  const dialog = document.querySelector('.dialog');
  if (dialog !== null) dialog.style.gridTemplateColumns = 'minmax(0, 1fr)';
  const main = document.querySelector('main');
  if (main !== null) main.style.padding = '0';
  for (const el of [document.documentElement, document.body]) el.style.height = 'auto';
  // The page is sized to the panel, so the document itself may still show a
  // scrollbar for a sub-pixel remainder. It is not part of the panel.
  document.documentElement.style.overflow = 'hidden';
  document.body.style.padding = '16px 20px';
  return document.querySelector('.tdd').getBoundingClientRect().height;
})()`

/** A minimal CDP client: send a command, await its reply, dispatch events. */
function connect(socketUrl) {
  const socket = new WebSocket(socketUrl)
  const pending = new Map()
  const listeners = new Map()
  let nextId = 1
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve()
    })
    socket.addEventListener('error', () => {
      reject(new Error('devtools websocket error'))
    })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      if (entry === undefined) return
      if (message.error) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
      return
    }
    for (const handler of listeners.get(message.method) ?? []) handler(message.params)
  })
  return {
    ready,
    send(method, params = {}, sessionId) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }))
      })
    },
    on(method, handler) {
      listeners.set(method, [...(listeners.get(method) ?? []), handler])
    },
    close() {
      socket.close()
    },
  }
}

/**
 * Start headless Chrome and return its browser-level DevTools socket.
 *
 * Cleans up after itself on EVERY failure path: a launch that never reports a
 * port, a browser that exits immediately, or a spawn error (a mistyped
 * `--chrome` path) would otherwise leave a Chrome process and a temp profile
 * behind, because the caller's `try/finally` only starts once this resolves.
 * @param executable - Chrome (or Edge) path.
 * @returns The socket URL plus a stop function.
 */
async function launchChrome(executable) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tdd-layout-'))
  const chrome = spawn(
    executable,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )

  /** Kill the browser and drop its profile; never throws. */
  const cleanup = async () => {
    const exited = new Promise((resolve) => chrome.once('exit', resolve))
    chrome.kill()
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))])
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      // A profile Windows has not released yet is not worth failing the run for.
    }
  }

  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buffer = ''
      const timer = setTimeout(() => reject(new Error(`chrome never reported a debugging port:\n${buffer}`)), 20000)
      // Without this listener a bad executable path surfaces as an unhandled
      // 'error' event (a raw ENOENT stack) instead of a usable message.
      chrome.on('error', (error) => {
        clearTimeout(timer)
        reject(new Error(`could not start ${executable}: ${error.message}`))
      })
      chrome.stderr.on('data', (chunk) => {
        buffer += chunk.toString()
        const match = /ws:\/\/\S+/.exec(buffer)
        if (match !== null) {
          clearTimeout(timer)
          resolve(match[0])
        }
      })
      chrome.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`chrome exited early (${code})`))
      })
    })
    return { wsUrl, stop: cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

const options = parseArgs(process.argv.slice(2))

const executable = options.chrome ?? CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate))
if (executable === undefined) {
  console.error('no Chrome or Edge found; pass --chrome <path> or set CHROME_PATH')
  process.exit(2)
}

let url
let tempFile
if (options.html === undefined) {
  tempFile = path.join(root, 'node_modules/.cache/dsh-tdd-layout-fixture.html')
  fs.mkdirSync(path.dirname(tempFile), { recursive: true })
  fs.writeFileSync(tempFile, await buildFixtureHtml(root, options.days), 'utf8')
  url = tempFile
} else {
  url = path.resolve(options.html)
}
const fileUrl = `file:///${url.replace(/\\/g, '/')}`

let launched
try {
  launched = await launchChrome(executable)
} catch (error) {
  // A browser that will not start is a setup problem, not a failing check, so it
  // reads as one line and exits like the "no Chrome found" branch above.
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}
const { wsUrl, stop } = launched
let failures = 0
try {
  // Chrome prints its browser-level socket, but only starts serving it a moment
  // later, and the HTTP endpoint is the only way to be sure it is up. So poll
  // `/json/version` and connect to the socket it reports.
  const port = new URL(wsUrl).port
  let socketUrl = wsUrl
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      const body = await response.json()
      if (typeof body.webSocketDebuggerUrl === 'string') {
        socketUrl = body.webSocketDebuggerUrl
        break
      }
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  const client = connect(socketUrl)
  await client.ready

  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (method, params) => client.send(method, params, sessionId)
  await send('Page.enable')

  for (const width of options.widths) {
    const isCapture = options.shot !== undefined && width === options.widths[options.widths.length - 1]
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1050, deviceScaleFactor: 1, mobile: false })
    const loaded = new Promise((resolve) => client.on('Page.loadEventFired', resolve))
    await send('Page.navigate', { url: fileUrl })
    await loaded
    // The shell puts the dark theme on `body`; the preview page only follows the
    // OS until told otherwise.
    if (options.theme !== undefined) {
      await send('Runtime.evaluate', {
        expression: `document.body.${options.theme === 'dark' ? 'setAttribute' : 'removeAttribute'}('data-ds-dark-theme', '')`,
      })
    }
    await send('Runtime.evaluate', {
      expression: 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))',
      awaitPromise: true,
    })

    // Measure first: the panel must be checked in its real surroundings, before
    // a capture strips them away.
    const result = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true })
    if (result.exceptionDetails !== undefined) {
      const details = result.exceptionDetails
      throw new Error(`page threw: ${details.exception?.description ?? details.text}`)
    }
    const value = result.result.value
    failures += value.failures.length
    console.log(`${String(width).padStart(5)}  ${value.failures.length === 0 ? 'PASS' : `${value.failures.length} FAIL`}  ${value.checks} checks`)
    for (const failure of value.failures) console.log(`         - ${failure.name}: ${failure.detail}`)

    if (!isCapture) continue
    if (options.bare) {
      const height = await send('Runtime.evaluate', { expression: BARE_PANEL, returnByValue: true })
      if (height.exceptionDetails !== undefined) throw new Error(`bare layout threw: ${height.exceptionDetails.text}`)
      // A full-height layout scrolls inside itself, so the capture can never be
      // taller than the window: grow the viewport to the panel and re-measure.
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: Math.ceil(height.result.value),
        deviceScaleFactor: 1,
        mobile: false,
      })
      await send('Runtime.evaluate', {
        expression: 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))',
        awaitPromise: true,
      })
    }
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(options.shot, Buffer.from(data, 'base64'))
    console.log(`         shot -> ${options.shot}`)
  }
  client.close()
} finally {
  await stop()
}

console.log(
  failures === 0
    ? `\nlayout: all invariants hold at ${options.widths.join(', ')}px (${options.html ?? 'fixture'})`
    : `\nlayout: ${failures} failing check(s)`,
)
process.exit(failures === 0 ? 0 : 1)
