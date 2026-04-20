import { readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import { findInFiles } from './find-in-files'

export interface ReplaceOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export interface ReplaceResult {
  filesChanged: number
  replacements: number
}

/**
 * Apply `replacement` to every occurrence of `query` across all files
 * under `cwd`. Uses findInFiles to locate candidate files (so git grep
 * honours .gitignore), then reads + rewrites each file in-process with
 * a regex matching the same flags the UI exposes (case sensitivity,
 * whole-word, regex). Writes only when the file content actually
 * changed — avoids spurious mtime bumps.
 *
 * Safety: refuses anything outside the user's home, mirroring the
 * editor fs bridge policy.
 */
export async function replaceInFiles(
  cwd: string,
  query: string,
  replacement: string,
  opts: ReplaceOptions = {},
): Promise<{ ok: true; value: ReplaceResult } | { ok: false; error: string }> {
  if (!isAbsolute(cwd)) return { ok: false, error: 'cwd must be absolute' }
  if (query.length === 0) return { ok: false, error: 'empty query' }
  try {
    const resolvedCwd = await realpath(cwd)
    const home = await realpath(homedir())
    if (!resolvedCwd.startsWith(home)) {
      return { ok: false, error: 'cwd outside home directory' }
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  // Find all candidate files first. We deliberately don't trust the
  // line-level matches from grep — grep's regex dialect differs from
  // JS, so re-matching in-process with the same flags the UI selected
  // keeps find + replace behaviour consistent.
  const found = await findInFiles(cwd, query, opts)
  if (!found.ok) return { ok: false, error: found.error }

  const files = new Set<string>()
  for (const m of found.value.matches) files.add(m.file)

  const re = buildRegex(query, opts)
  if (!re) return { ok: false, error: 'invalid regex' }

  let filesChanged = 0
  let replacements = 0
  for (const file of files) {
    let before: string
    try {
      before = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const after = before.replace(re, () => {
      replacements++
      return replacement
    })
    if (after === before) continue
    try {
      await writeFile(file, after, 'utf8')
      filesChanged++
    } catch {
      // Skip unwriteable files rather than aborting the whole batch.
      // The caller's summary still shows what succeeded.
    }
  }

  return { ok: true, value: { filesChanged, replacements } }
}

/** Build a JS RegExp that matches the same inputs the UI offers. */
function buildRegex(query: string, opts: ReplaceOptions): RegExp | null {
  const flags = opts.caseSensitive ? 'g' : 'gi'
  let pattern: string
  if (opts.regex) {
    pattern = query
  } else {
    pattern = escapeRegex(query)
  }
  if (opts.wholeWord) {
    pattern = `\\b(?:${pattern})\\b`
  }
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
