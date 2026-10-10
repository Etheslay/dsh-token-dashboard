/**
 * Exercise the built browser bundle against a stub of the harness loader.
 *
 * This is the check that matters most for a client plugin: the bundle has to
 * register itself through `window.__ModuleLoader__.load`, resolve every one of
 * its externals against the shell's frozen module table, and hand back a Cordis
 * plugin with `name` / `inject` / `apply`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = path.join(root, 'lib/client.js')
const source = fs.readFileSync(bundlePath, 'utf8')

/** Minimal React stand-in: enough for `createElement` and the hooks used. */
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  Fragment: Symbol('Fragment'),
}
const jsxRuntime = {
  jsx: (type, props, key) => ({ type, props, key }),
  jsxs: (type, props, key) => ({ type, props, key }),
  Fragment: React.Fragment,
}

/** The shell's frozen module table, as `rM()` builds it. */
const moduleTable = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  'react-dom': { render: () => {}, createPortal: (n) => n },
  'react-dom/client': { createRoot: () => ({ render: () => {}, unmount: () => {} }) },
  '@deepseek-ai/cordis': {},
  '@deepseek-ai/dsh-client-store': {},
  '@deepseek-ai/dsh-client-ui-slots': {},
  '@deepseek-ai/dsh-client-ui-primitives': { Button: () => null, Pill: () => null },
  '@deepseek-ai/dsh-client-ui-dockkit': {},
}

const requested = []
let registration

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  fetch: async () => ({ ok: false, status: 503, statusText: 'stub' }),
  AbortController,
  DOMException,
  Intl,
  Date,
  Math,
  JSON,
  URL,
  URLSearchParams,
  document: {
    head: { appendChild: () => {} },
    body: {},
    createElement: () => ({ dataset: {}, remove: () => {}, setAttribute: () => {}, style: {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.__ModuleLoader__ = {
  load: (entry) => {
    registration = entry
  },
  create: () => ({}),
}

vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'lib/client.js' })

assert.ok(registration, 'bundle must call window.__ModuleLoader__.load')
assert.equal(registration.id, 'dsh-token-dashboard', 'bundle id must be the npm package name')
assert.equal(typeof registration.factory, 'function', 'loader entry must expose a factory')

const plugin = registration.factory((id) => {
  requested.push(id)
  if (!(id in moduleTable)) throw new Error(`unknown external "${id}"`)
  return moduleTable[id]
})

assert.equal(plugin.name, 'dsh-token-dashboard', 'plugin name must match the package name')
assert.deepEqual([...plugin.inject], ['slots', 'locale'], 'plugin must declare its required services')
assert.equal(typeof plugin.apply, 'function', 'plugin must export apply()')

// Every external the bundle asks for has to be answerable by the module table.
const unsupported = requested.filter((id) => !(id in moduleTable))
assert.deepEqual(unsupported, [], `bundle requested modules the shell cannot answer: ${unsupported.join(', ')}`)

// Mounting must register exactly one settings.section and nothing else.
const registrations = []
const injections = []
const effects = []
const ctx = {
  effect: (callback, label) => {
    effects.push(label)
    const dispose = callback()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  locale: {
    register: (namespace, dicts) => {
      assert.equal(namespace, 'dsh-token-dashboard')
      assert.ok(dicts.zh && dicts.en, 'both dictionaries must be registered')
      return () => {}
    },
    bind: () => (key) => key,
  },
  slots: {
    inject: (slot, register) => {
      injections.push(slot)
      register()
    },
    register: (meta, component) => {
      registrations.push({ meta, component })
      return () => {}
    },
  },
}

plugin.apply(ctx)

assert.deepEqual(injections, ['settings.section'], 'the plugin must claim exactly one settings section')
assert.equal(registrations.length, 1, 'exactly one section must be registered')
const section = registrations[0]
assert.equal(section.meta.name, 'settings.section')
assert.equal(section.meta.id, 'usage')
assert.equal(typeof section.meta.order, 'number')
assert.equal(typeof section.meta.label, 'function')
assert.equal(section.meta.label(), 'nav', 'the label must resolve through the locale namespace')
assert.equal(typeof section.component, 'function', 'the section must render a component')

// The component must render without a Host response (the loading path).
const element = section.component({ t: (key) => key })
assert.ok(element, 'the section component must return an element')

console.log('client bundle: OK')
console.log(`  registration id : ${registration.id}`)
console.log(`  externals asked : ${[...new Set(requested)].join(', ')}`)
console.log(`  effects         : ${effects.join(' | ')}`)
console.log(`  section         : id=${section.meta.id} order=${section.meta.order}`)
