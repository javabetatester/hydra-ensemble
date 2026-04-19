import { existsSync, statSync, constants, accessSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PATH_SEP = process.platform === 'win32' ? ';' : ':'

function isExecutable(p: string): boolean {
  try {
    if (!existsSync(p)) return false
    const st = statSync(p)
    if (!st.isFile()) return false
    if (process.platform === 'win32') return true
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Cross-OS resolution of the `claude` CLI binary.
 * Mirrors SessionManager.resolveClaudePath from the legacy Swift app.
 */
export function resolveClaudePath(): string | null {
  const home = homedir()
  const path = process.env['PATH'] ?? ''
  const parts = path.split(PATH_SEP).filter(Boolean)
  const binName = process.platform === 'win32' ? 'claude.exe' : 'claude'

  // 1. PATH lookup (also try .cmd on Windows for npm-shim installs)
  for (const dir of parts) {
    const candidate = join(dir, binName)
    if (isExecutable(candidate)) return candidate
    if (process.platform === 'win32') {
      const cmdShim = join(dir, 'claude.cmd')
      if (isExecutable(cmdShim)) return cmdShim
    }
  }

  // 2. Common install locations per OS
  const common: string[] = []
  if (process.platform === 'darwin') {
    common.push(
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      join(home, '.claude/local/claude'),
      join(home, '.local/bin/claude')
    )
  } else if (process.platform === 'linux') {
    common.push(
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      join(home, '.local/bin/claude'),
      join(home, '.claude/local/claude')
    )
  } else if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA']
    const appData = process.env['APPDATA']
    if (localAppData) {
      common.push(join(localAppData, 'Programs', 'claude', 'claude.exe'))
    }
    if (appData) {
      common.push(join(appData, 'npm', 'claude.cmd'))
    }
  }
  for (const c of common) {
    if (isExecutable(c)) return c
  }

  // 3. Login-shell fallback (Unix only) — picks up PATH from .zprofile/.bashrc
  if (process.platform !== 'win32') {
    const shell = process.env['SHELL'] ?? '/bin/bash'
    try {
      const out = spawnSync(shell, ['-l', '-c', 'command -v claude'], {
        encoding: 'utf8',
        timeout: 3000
      })
      const line = out.stdout?.trim()
      if (line && isExecutable(line)) return line
    } catch {
      // noop
    }
  }

  return null
}
