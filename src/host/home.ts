/**
 * Resolution of the DeepSeek Harness home directory.
 *
 * This deliberately duplicates the documented precedence of the harness's own
 * `@deepseek-ai/dsh-home-paths` package instead of importing it:
 *
 *   1. an explicit configured path,
 *   2. `$DSH_HOME` when non-blank,
 *   3. `~/.dsh`.
 *
 * Importing the real package would add a peer dependency pinned to one DSH
 * release line, so a user on a different release would fail to load the plugin
 * over a three-line path join. The rules below are the package's public,
 * documented contract and change far less often than its version number.
 *
 * @module dsh-token-dashboard/host/home
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** The directory name of the default harness home under the OS home. */
export const DSH_HOME_DIR_NAME = '.dsh'

/** Environment variable that overrides the default harness home. */
export const DSH_HOME_ENV = 'DSH_HOME'

/**
 * Expand the supported tilde prefixes against the OS home.
 * @param path - Configured path that may begin with `~`, `~/`, or `~\`.
 * @returns The expanded path, or the original value when no prefix is present.
 */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the harness home using the documented precedence.
 * @param configured - Explicit override with the highest precedence.
 * @param env - Environment mapping used to read `DSH_HOME`.
 * @returns The normalized absolute harness home.
 */
export function resolveDshHome(configured?: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[DSH_HOME_ENV]
  const chosen =
    configured ??
    (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), DSH_HOME_DIR_NAME))
  return resolve(expandHomePath(chosen))
}

/**
 * Join segments onto the resolved harness home.
 * @param segments - Path segments appended to the harness home.
 * @returns The normalized absolute joined path; the home itself when empty.
 */
export function dshHomePath(...segments: string[]): string {
  return join(resolveDshHome(), ...segments)
}

/**
 * Describe a resolved harness home symbolically, never as a machine path.
 * @param resolvedHome - Absolute path from {@link resolveDshHome}.
 * @returns `~/.dsh` for the default home, otherwise `$DSH_HOME`.
 */
export function dshHomeDisplay(resolvedHome: string): string {
  return resolvedHome === resolve(join(homedir(), DSH_HOME_DIR_NAME)) ? `~/${DSH_HOME_DIR_NAME}` : `$${DSH_HOME_ENV}`
}
