import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type {
  ClaudeCommand,
  ClaudeCommandsPayload,
  ClaudeCommandSource
} from '../../shared/types'

const GLOBAL_DIR = join(homedir(), '.claude', 'commands')

interface FileSummary {
  title?: string
  description?: string
}

/** Pull the first heading + first non-heading line out of a markdown file. */
function summarise(text: string): FileSummary {
  let title: string | undefined
  let description: string | undefined
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (!title && line.startsWith('#')) {
      title = line.replace(/^#+\s*/, '').trim()
      continue
    }
    if (line.startsWith('#')) continue
    if (line.startsWith('```') || line.startsWith('---')) continue
    if (!description) description = line
    if (title && description) break
  }
  return { title, description }
}

async function scanDir(dir: string, source: ClaudeCommandSource): Promise<ClaudeCommand[]> {
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const out: ClaudeCommand[] = []
  for (const name of entries) {
    if (!name.endsWith('.md')) continue
    const filePath = join(dir, name)
    const stem = basename(name, extname(name))
    if (stem.length === 0) continue
    let summary: FileSummary = {}
    try {
      const text = await readFile(filePath, 'utf8')
      summary = summarise(text)
    } catch {
      // best-effort; an unreadable file still surfaces with its filename
    }
    out.push({
      name: stem,
      filePath,
      source,
      title: summary.title,
      description: summary.description
    })
  }
  return out
}

/**
 * List every slash command available to claude when invoked in `cwd`:
 * project-local commands (`<cwd>/.claude/commands/*.md`) followed by global
 * ones (`~/.claude/commands/*.md`). Project commands shadow globals with the
 * same name — Claude Code itself does this resolution, so we mirror it by
 * hiding the global when a project entry has the same `name`.
 */
export async function listCommands(cwd: string | null): Promise<ClaudeCommandsPayload> {
  const project = cwd ? await scanDir(join(cwd, '.claude', 'commands'), 'project') : []
  const global = await scanDir(GLOBAL_DIR, 'global')

  const seen = new Set(project.map((c) => c.name))
  const merged = [
    ...project.sort((a, b) => a.name.localeCompare(b.name)),
    ...global.filter((c) => !seen.has(c.name)).sort((a, b) => a.name.localeCompare(b.name))
  ]
  return { cwd, commands: merged }
}
