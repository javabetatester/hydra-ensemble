// SAFE TO RUN
// Standalone Phase 0 smoke test for Hydra Ensemble.
// No Electron, no build step. Validates Node, node-pty, claude resolver, git.
// Exit 0 on all green; 1 on any hard failure (claude-not-found is a warning).

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { platform, arch, release } from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const results = []

function record(name, status, detail) {
  results.push({ name, status, detail })
  const tag =
    status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL'
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${name}${detail ? ' - ' + detail : ''}`)
}

function header(title) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`)
}

// ---------------------------------------------------------------------------
// 1. Environment info
// ---------------------------------------------------------------------------
header('Environment')
const nodeVersion = process.versions.node
const nodeMajor = Number(nodeVersion.split('.')[0])
console.log(`node:    v${nodeVersion}`)
console.log(`os:      ${platform()} (${release()})`)
console.log(`arch:    ${arch()}`)

const npmCheck = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['--version'],
  { encoding: 'utf8' }
)
const npmVersion = npmCheck.status === 0 ? npmCheck.stdout.trim() : 'unknown'
console.log(`npm:     v${npmVersion}`)

if (nodeMajor >= 20) {
  record('node >= 20', 'pass', `v${nodeVersion}`)
} else {
  record('node >= 20', 'fail', `found v${nodeVersion}`)
}

// ---------------------------------------------------------------------------
// 2. node_modules sanity
// ---------------------------------------------------------------------------
header('Dependencies')
const nodeModulesPath = join(repoRoot, 'node_modules')
if (!existsSync(nodeModulesPath)) {
  record(
    'node_modules present',
    'fail',
    'run `npm install` first (and `npm run rebuild` for node-pty)'
  )
  printSummaryAndExit()
}
record('node_modules present', 'pass')

// ---------------------------------------------------------------------------
// 3. node-pty resolvable + spawn smoke
// ---------------------------------------------------------------------------
let nodePty = null
try {
  // resolve first to give a precise error if the native build is missing
  require.resolve('node-pty')
  nodePty = await import('node-pty')
  record('node-pty importable', 'pass')
} catch (err) {
  record(
    'node-pty importable',
    'fail',
    `${err?.message ?? err}. Did you run \`npm run rebuild\`?`
  )
  printSummaryAndExit()
}

await new Promise((resolveDone) => {
  const cmd =
    process.platform === 'win32'
      ? { file: process.env.COMSPEC ?? 'cmd.exe', args: ['/c', 'echo hello-pty'] }
      : { file: '/bin/sh', args: ['-c', 'echo hello-pty'] }

  let buffer = ''
  let settled = false
  const finish = (status, detail) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    try {
      pty.kill()
    } catch {
      /* may already be dead */
    }
    record('node-pty spawn echo', status, detail)
    resolveDone()
  }

  const timer = setTimeout(
    () => finish('fail', 'timed out after 3s without seeing hello-pty'),
    3000
  )

  let pty
  try {
    pty = nodePty.spawn(cmd.file, cmd.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: repoRoot,
      env: { ...process.env, TERM: 'xterm-256color' },
      useConpty: process.platform === 'win32'
    })
  } catch (err) {
    finish('fail', `spawn threw: ${err?.message ?? err}`)
    return
  }

  pty.onData((data) => {
    buffer += data
    if (buffer.includes('hello-pty')) {
      finish('pass', 'received expected output')
    }
  })
  pty.onExit(() => {
    if (buffer.includes('hello-pty')) {
      finish('pass', 'received expected output')
    } else {
      finish('fail', `process exited without expected output: ${truncate(buffer)}`)
    }
  })
})

function truncate(s) {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > 80 ? t.slice(0, 77) + '...' : t
}

// ---------------------------------------------------------------------------
// 4. claude resolver
// ---------------------------------------------------------------------------
header('Claude resolver')
const compiledResolver = join(repoRoot, 'out', 'main', 'claude', 'resolve.js')
let resolveClaudePath = null
let resolverSource = null

if (existsSync(compiledResolver)) {
  try {
    const mod = await import(pathToFileURL(compiledResolver).href)
    resolveClaudePath = mod.resolveClaudePath ?? null
    resolverSource = compiledResolver
  } catch (err) {
    record(
      'load compiled resolver',
      'warn',
      `import failed: ${err?.message ?? err}`
    )
  }
}

if (!resolveClaudePath) {
  // Try tsx loader for the TS source
  let tsxAvailable = false
  try {
    require.resolve('tsx')
    tsxAvailable = true
  } catch {
    /* not installed */
  }
  if (tsxAvailable) {
    try {
      // Register tsx ESM loader programmatically
      const { register } = await import('node:module')
      register('tsx/esm', pathToFileURL('./'))
      const tsSrc = join(repoRoot, 'src', 'main', 'claude', 'resolve.ts')
      const mod = await import(pathToFileURL(tsSrc).href)
      resolveClaudePath = mod.resolveClaudePath ?? null
      resolverSource = tsSrc
    } catch (err) {
      record(
        'load TS resolver via tsx',
        'warn',
        `failed: ${err?.message ?? err}`
      )
    }
  }
}

if (resolveClaudePath) {
  try {
    const claudePath = resolveClaudePath()
    if (claudePath) {
      record('resolveClaudePath()', 'pass', `${claudePath} (via ${shortPath(resolverSource)})`)
    } else {
      record(
        'resolveClaudePath()',
        'warn',
        `claude not found in PATH (via ${shortPath(resolverSource)})`
      )
    }
  } catch (err) {
    record('resolveClaudePath()', 'fail', `threw: ${err?.message ?? err}`)
  }
} else {
  record(
    'resolveClaudePath()',
    'warn',
    'no compiled output (run `npm run build`) and no `tsx` available'
  )
}

function shortPath(p) {
  if (!p) return '?'
  return p.startsWith(repoRoot) ? p.slice(repoRoot.length + 1) : p
}

// ---------------------------------------------------------------------------
// 5. git on PATH
// ---------------------------------------------------------------------------
header('External tooling')
await new Promise((resolveDone) => {
  const proc = spawn('git', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout.on('data', (c) => (out += c))
  proc.on('error', (err) => {
    record('git on PATH', 'fail', err.message)
    resolveDone()
  })
  proc.on('close', (code) => {
    if (code === 0) {
      record('git on PATH', 'pass', out.trim())
    } else {
      record('git on PATH', 'fail', `exit code ${code}`)
    }
    resolveDone()
  })
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
printSummaryAndExit()

function printSummaryAndExit() {
  header('Summary')
  const nameWidth = Math.max(...results.map((r) => r.name.length), 4)
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length))
  console.log(`${pad('CHECK', nameWidth)}  STATUS  DETAIL`)
  console.log(`${pad('-----', nameWidth)}  ------  ------`)
  for (const r of results) {
    console.log(`${pad(r.name, nameWidth)}  ${pad(r.status.toUpperCase(), 6)}  ${r.detail ?? ''}`)
  }

  const failed = results.filter((r) => r.status === 'fail').length
  const warned = results.filter((r) => r.status === 'warn').length
  const passed = results.filter((r) => r.status === 'pass').length
  console.log(`\n${passed} passed, ${warned} warning(s), ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}
