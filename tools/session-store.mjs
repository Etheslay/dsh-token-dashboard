/**
 * The session store these archaeology tools read.
 *
 * Resolved the way the plugin itself resolves it — `$DSH_HOME` when it names a
 * directory, otherwise `~/.dsh` — so a tool works on a machine that is not the
 * one they were written on. Reading a hard-coded `C:/Users/wu/...` path failed
 * with a bare ENOENT stack on every other checkout.
 *
 * @module dsh-token-dashboard/tools/session-store
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Absolute `$DSH_HOME`; `~/.dsh` unless the environment overrides it. */
export const DSH_HOME = process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')

/** Absolute session-store root: `$DSH_HOME/sessions`. */
export const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions')

/**
 * Every session log under the store, recursively.
 * @param root - Directory to walk; defaults to {@link SESSIONS_ROOT}.
 * @returns One `{ path, size }` per `session.v*.jsonl.zstd`, in directory order.
 */
export function listLogs(root = SESSIONS_ROOT) {
  const out = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.name.endsWith('.jsonl.zstd')) out.push({ path: full, size: fs.statSync(full).size })
    }
  }
  visit(root)
  return out
}

/**
 * Every session log, largest first — the order every probe here wants.
 * @param root - Directory to walk.
 * @returns Logs sorted by size, descending.
 */
export function listLogsBySize(root = SESSIONS_ROOT) {
  return listLogs(root).sort((left, right) => right.size - left.size)
}

/** Exit with a usable message when there is no store to read. */
export function requireSessionsRoot() {
  if (fs.existsSync(SESSIONS_ROOT)) return
  console.error(`no session store at ${SESSIONS_ROOT}`)
  console.error('set DSH_HOME to the harness home that has one')
  process.exit(2)
}

/**
 * Read a positive integer argument, or exit with usage.
 * @param raw - The raw argument.
 * @param fallback - Value to use when the argument is absent.
 * @param usage - Usage line printed on a bad value.
 * @returns The parsed count.
 */
export function positiveIntArg(raw, fallback, usage) {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    console.error(`expected a positive integer, got "${raw}"`)
    console.error(usage)
    process.exit(2)
  }
  return value
}
