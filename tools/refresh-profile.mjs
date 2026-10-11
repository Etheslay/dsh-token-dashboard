/**
 * Install this package into a DSH profile, replacing the copy the app loads.
 *
 * Editing `src/` does NOT change what DSH runs. A profile installs this package
 * as a packed tarball (`"dsh-token-dashboard": "file:./dsh-token-dashboard-0.1.0.tgz"`),
 * npm unpacks it into `<profile>/node_modules/`, and the app loads THAT copy. So a
 * source fix stays invisible until the tarball is repacked and re-extracted —
 * which is exactly how a fixed double scrollbar kept showing up in the panel.
 *
 * The tarball is unpacked directly rather than through `npm install`, because a
 * profile's other plugins can hold peer-dependency conflicts that make npm refuse
 * to run at all; this package has no runtime dependencies, so extraction is both
 * sufficient and immune to that.
 *
 * Usage:
 *   node tools/refresh-profile.mjs [--profile desktop] [--dsh-home <dir>] [--dry-run]
 *
 * Afterwards, reload the page in DSH: the shell hot-swaps the browser half per
 * page load. A change to the HOST half additionally needs a DSH restart, because
 * a replaced ES module stays cached in the Node process.
 *
 * @module dsh-token-dashboard/tools/refresh-profile
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Parse `--flag value` / `--flag` arguments. */
function parseArgs(argv) {
  const options = { profile: 'desktop', dshHome: undefined, dryRun: false }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (flag !== '--profile' && flag !== '--dsh-home') throw new Error(`unknown option ${flag}`)
    const value = argv[++index]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    if (flag === '--profile') options.profile = value
    else options.dshHome = value
  }
  return options
}

let options
try {
  options = parseArgs(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error('usage: node tools/refresh-profile.mjs [--profile desktop] [--dsh-home <dir>] [--dry-run]')
  process.exit(2)
}
const dshHome = options.dshHome ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
const profileDir = path.join(dshHome, 'profiles', options.profile)
const manifestFile = path.join(profileDir, 'package.json')

if (!fs.existsSync(manifestFile)) {
  console.error(`no profile manifest at ${manifestFile}`)
  console.error('pass --profile <name> or --dsh-home <dir>')
  process.exit(2)
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const name = packageJson.name
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
const spec = manifest.dependencies?.[name]

if (typeof spec !== 'string') {
  // A `file:` directory dependency is the better development setup: it points at
  // this checkout, so `lib/` is live and there is nothing to repack.
  console.error(`${name} is not a dependency of the ${options.profile} profile`)
  console.error(`add it to ${manifestFile} as "file:${root.replace(/\\/g, '/')}" to skip repacking entirely`)
  process.exit(2)
}
if (!spec.startsWith('file:')) {
  console.error(`${name} is installed as ${spec}; this script only refreshes a local tarball install`)
  process.exit(2)
}

const specPath = spec.slice('file:'.length)
const target = path.join(profileDir, 'node_modules', name)

// A `file:` spec can point at a TARBALL (this script's job) or at a DIRECTORY
// (npm links it, and `lib/` is already live). The second is the better setup —
// and the one the message above recommends — so it must be refused rather than
// "refreshed": the directory name would be read as a tarball name, a stray
// extensionless file would land in the profile, and the live link would be
// replaced by a frozen extraction. The spec is checked rather than the installed
// artifact because npm implements a directory install as a link.
if (!specPath.endsWith('.tgz')) {
  console.error(`${name} is installed as a directory (${spec}), so \`lib/\` is already live`)
  console.error('nothing to repack — reload the page, and restart DSH for a Host-half change')
  process.exit(2)
}

const tarballName = path.basename(specPath)
const profileTarball = path.join(profileDir, tarballName)

console.log(`profile  : ${options.profile} (${profileDir})`)
console.log(`spec     : ${spec}`)
console.log(`target   : ${target}`)
if (options.dryRun) process.exit(0)

/**
 * Run the npm CLI through Node.
 *
 * Spawning `npm` directly fails on Windows — it is a `.cmd` shim, and Node
 * refuses to `execFile` one (EINVAL on modern Node) or cannot find it at all.
 * Running npm's JavaScript entry point with the current Node binary avoids the
 * shim entirely, the same way `scripts/build.mjs` runs `tsc`.
 * @param args - npm arguments.
 * @param cwd - Working directory.
 * @returns Trimmed stdout.
 */
function npm(args, cwd) {
  const cli = [
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.join(process.env.APPDATA ?? '', 'npm/node_modules/npm/bin/npm-cli.js'),
    path.join(process.env.ProgramFiles ?? '', 'nodejs/node_modules/npm/bin/npm-cli.js'),
  ].find((candidate) => fs.existsSync(candidate))
  if (cli === undefined) throw new Error('could not locate npm-cli.js; run `npm pack` by hand')
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' })
}

/**
 * Unpack a tarball into a directory.
 *
 * `tar` is present on Windows 10+, macOS and Linux. `npm` is deliberately not
 * used: a profile's other plugins can hold peer-dependency conflicts that make
 * npm refuse to run, and this package has no runtime dependencies.
 */
function untar(tarball, into) {
  execFileSync('tar', ['-xzf', tarball, '--strip-components=1'], { cwd: into, stdio: 'inherit' })
}

// `npm pack` runs the package's `prepack` script, so this also rebuilds `lib/`.
const packed = npm(['pack', '--silent'], root).trim().split('\n').pop().trim()
const builtTarball = path.join(root, packed)
if (!fs.existsSync(builtTarball)) throw new Error(`npm pack did not produce ${builtTarball}`)

fs.copyFileSync(builtTarball, profileTarball)
fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
untar(profileTarball, target)

const installed = path.join(target, 'lib/client.js')
const built = path.join(root, 'lib/client.js')
const identical = fs.readFileSync(installed).equals(fs.readFileSync(built))
console.log(`tarball  : ${packed} -> ${profileTarball} (${(fs.statSync(profileTarball).size / 1024).toFixed(1)} KiB)`)
console.log(`client.js: ${identical ? 'identical to the workspace build' : 'DIFFERS — extraction went wrong'}`)
if (!identical) process.exit(1)
console.log('\nReload the page in DSH to pick it up.')
