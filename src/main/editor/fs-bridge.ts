import {
  readFile,
  writeFile,
  readdir,
  stat,
  realpath,
  access,
  cp,
  rm
} from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, sep } from 'node:path'
import { hashString } from './file-watcher'
import type { DirEntry, FileContent } from '../../shared/types'

/** Maximum file size we will read into memory (5 MB). */
const MAX_FILE_BYTES = 5 * 1024 * 1024

/**
 * Filesystem bridge for the in-app editor. All paths must be absolute and
 * must resolve (via realpath) to a location inside the user's home directory
 * OR inside one of the project roots the user has explicitly registered via
 * the OS open-directory dialog. The dialog is a consent boundary: if the
 * user picked the folder themselves we trust them with it.
 */
export class EditorFs {
  private readonly homeRoot: string
  private readonly getExtraRoots: () => readonly string[]

  constructor(opts: { getExtraRoots?: () => readonly string[] } = {}) {
    this.homeRoot = homedir()
    this.getExtraRoots = opts.getExtraRoots ?? (() => [])
  }

  async readFile(path: string): Promise<FileContent> {
    const safe = await this.assertSafe(path)
    const st = await stat(safe)
    if (st.isDirectory()) {
      throw new Error('path is a directory')
    }
    if (st.size > MAX_FILE_BYTES) {
      throw new Error(`file too large (${st.size} bytes; max ${MAX_FILE_BYTES})`)
    }
    const buf = await readFile(safe)
    if (this.looksUtf8(buf)) {
      return {
        path: safe,
        bytes: buf.toString('utf-8'),
        encoding: 'utf-8',
        size: st.size
      }
    }
    return {
      path: safe,
      bytes: buf.toString('base64'),
      encoding: 'base64',
      size: st.size
    }
  }

  async listDir(path: string): Promise<DirEntry[]> {
    const safe = await this.assertSafe(path)
    const entries = await readdir(safe, { withFileTypes: true })
    const results: DirEntry[] = []
    for (const e of entries) {
      const child = join(safe, e.name)
      let st
      try {
        st = await stat(child)
      } catch {
        continue
      }
      results.push({
        name: e.name,
        path: child,
        isDir: st.isDirectory(),
        isSymlink: e.isSymbolicLink(),
        size: st.size,
        mtimeMs: st.mtimeMs
      })
    }
    results.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return results
  }

  async writeFile(
    path: string,
    content: string
  ): Promise<{ ok: true; hash: string }> {
    const safe = await this.assertSafe(path, { allowMissing: true })
    await writeFile(safe, content, { encoding: 'utf-8' })
    return { ok: true, hash: hashString(content) }
  }

  /**
   * Recursively copy a file or directory into `destDir`. The final path is
   * `destDir/basename(src)`; if that already exists, we append ` copy`,
   * ` copy 2`, … before the extension to avoid clobbering. Both arguments
   * must resolve inside the user home. Returns the final destination path.
   */
  async copyPath(src: string, destDir: string): Promise<string> {
    const safeSrc = await this.assertSafe(src)
    const safeDestDir = await this.assertSafe(destDir)
    const destDirStat = await stat(safeDestDir)
    if (!destDirStat.isDirectory()) {
      throw new Error('destination must be a directory')
    }
    // Disallow copying a directory into itself or a descendant — that would
    // recurse forever and fill the disk before the OS notices.
    const srcReal = safeSrc.endsWith(sep) ? safeSrc : safeSrc + sep
    if (safeDestDir === safeSrc || safeDestDir.startsWith(srcReal)) {
      throw new Error('cannot copy into itself')
    }
    const name = basename(safeSrc)
    const final = await this.nextFreeName(safeDestDir, name)
    await cp(safeSrc, final, { recursive: true, errorOnExist: true, force: false })
    return final
  }

  async deletePath(path: string): Promise<void> {
    const safe = await this.assertSafe(path)
    if (safe === this.homeRoot) {
      throw new Error('refusing to delete home root')
    }
    for (const root of this.getExtraRoots()) {
      let canonical: string
      try {
        canonical = await realpath(root)
      } catch {
        canonical = root
      }
      if (safe === canonical) {
        throw new Error('refusing to delete a registered project root')
      }
    }
    await rm(safe, { recursive: true, force: true })
  }

  private async nextFreeName(destDir: string, name: string): Promise<string> {
    const first = join(destDir, name)
    if (!(await this.exists(first))) return first
    const ext = extname(name)
    const stem = ext ? name.slice(0, -ext.length) : name
    for (let i = 1; i < 1000; i++) {
      const candidate =
        i === 1 ? `${stem} copy${ext}` : `${stem} copy ${i}${ext}`
      const full = join(destDir, candidate)
      if (!(await this.exists(full))) return full
    }
    throw new Error('too many copies')
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await access(p, fsConstants.F_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * Resolve the two .claude directories visible to the project: the local
   * one inside `cwd` (if any) and the user's global one in $HOME. Either
   * can be null when missing, so the UI can collapse sections.
   */
  async claudeDirs(cwd: string | null): Promise<{ project: string | null; global: string | null }> {
    const tryExist = async (p: string): Promise<string | null> => {
      try {
        await this.assertSafe(p)
        await access(p, fsConstants.R_OK)
        const s = await stat(p)
        return s.isDirectory() ? p : null
      } catch {
        return null
      }
    }
    const project = cwd ? await tryExist(join(cwd, '.claude')) : null
    const global = await tryExist(join(this.homeRoot, '.claude'))
    return { project, global }
  }

  /**
   * Validate that a path is absolute and resolves to a location inside the
   * user's home directory or one of the registered project roots. Returns
   * the realpath (or the input if missing and `allowMissing` is true, since
   * writeFile may create new files).
   */
  private async assertSafe(
    path: string,
    opts: { allowMissing?: boolean } = {}
  ): Promise<string> {
    if (!isAbsolute(path)) {
      throw new Error(`path must be absolute: ${path}`)
    }
    let resolved: string
    try {
      resolved = await realpath(path)
    } catch (err) {
      if (opts.allowMissing) {
        resolved = path
      } else {
        throw err
      }
    }
    if (await this.isUnderAllowedRoot(resolved)) {
      return resolved
    }
    throw new Error(`path is outside the allowed roots: ${resolved}`)
  }

  private async isUnderAllowedRoot(resolved: string): Promise<boolean> {
    if (this.containsPath(this.homeRoot, resolved)) return true
    for (const root of this.getExtraRoots()) {
      if (!isAbsolute(root)) continue
      // Best-effort canonicalisation. A project on a now-missing mount
      // shouldn't break safety checks for unrelated paths.
      let canonical: string
      try {
        canonical = await realpath(root)
      } catch {
        canonical = root
      }
      if (this.containsPath(canonical, resolved)) return true
    }
    return false
  }

  private containsPath(root: string, candidate: string): boolean {
    if (candidate === root) return true
    const norm = root.endsWith(sep) ? root : root + sep
    return candidate.startsWith(norm)
  }

  /**
   * Heuristic: a buffer "looks UTF-8" if it has no NUL bytes and decodes
   * cleanly. This is good enough for distinguishing source files from
   * arbitrary binaries.
   */
  private looksUtf8(buf: Buffer): boolean {
    for (let i = 0; i < Math.min(buf.length, 8192); i++) {
      if (buf[i] === 0) return false
    }
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      decoder.decode(buf)
      return true
    } catch {
      return false
    }
  }
}
