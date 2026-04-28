import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import { getStore, patchStore } from '../store'
import type { ProjectMeta } from '../../shared/types'
import { safeSend } from '../lib/safeSend'

/**
 * Minimal storage surface the ProjectService needs. Lets tests swap the
 * Electron-bound store for an in-memory implementation without touching
 * `src/main/store.ts`.
 */
export interface ProjectStore {
  read(): ProjectMeta[]
  write(projects: ProjectMeta[]): void
}

/** Default store backed by the shared Electron store. */
export const electronProjectStore: ProjectStore = {
  read(): ProjectMeta[] {
    return getStore().projects.map((p) => ({
      path: p.path,
      name: p.name,
      lastOpenedAt: p.lastOpenedAt
    }))
  },
  write(projects: ProjectMeta[]): void {
    patchStore({
      projects: projects.map((p) => ({
        path: p.path,
        name: p.name,
        lastOpenedAt: p.lastOpenedAt
      }))
    })
  }
}

/** Build an in-memory store seeded with `seed`. Useful for tests. */
export function createMemoryProjectStore(seed: ProjectMeta[] = []): ProjectStore {
  let state: ProjectMeta[] = [...seed]
  return {
    read(): ProjectMeta[] {
      return [...state]
    },
    write(projects: ProjectMeta[]): void {
      state = [...projects]
    }
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Tracks the user's known project directories, sorted by recency, and brokers
 * directory pickers / IPC notifications. Mirrors the behaviour of
 * `Sources/HydraEnsembleCore/ProjectManager.swift` but persists through the
 * Electron-side store.
 */
export class ProjectService {
  private window: BrowserWindow | null = null

  constructor(private readonly store: ProjectStore = electronProjectStore) {}

  attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  /** All known projects, in stable insertion order (most recently added first). */
  list(): ProjectMeta[] {
    return [...this.store.read()]
  }

  /** The most recently opened project, or null when none are tracked. */
  current(): ProjectMeta | null {
    const all = this.store.read()
    if (all.length === 0) return null
    return [...all].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))[0] ?? null
  }

  /**
   * Add (or refresh) a project entry. Returns null when the path doesn't
   * resolve to an existing directory on disk.
   */
  async add(path: string): Promise<ProjectMeta | null> {
    if (!path || !(await pathExists(path))) return null

    const meta: ProjectMeta = {
      path,
      name: basename(path) || path,
      lastOpenedAt: new Date().toISOString()
    }

    const next = this.store.read().filter((p) => p.path !== path)
    next.unshift(meta)
    this.store.write(next)
    this.notifyChange()
    return meta
  }

  /** Drop a project from the list (no-op if not present). */
  remove(path: string): void {
    const before = this.store.read()
    const next = before.filter((p) => p.path !== path)
    if (next.length === before.length) return
    this.store.write(next)
    this.notifyChange()
  }

  /**
   * Mark `path` as the most recently opened project and broadcast a
   * `project:changed` event to renderers. No-op if the path isn't known.
   */
  setCurrent(path: string): void {
    const all = this.store.read()
    const idx = all.findIndex((p) => p.path === path)
    if (idx < 0) return
    // Update timestamp in-place — don't reorder the array.
    const next = all.map((p, i) =>
      i === idx ? { ...p, lastOpenedAt: new Date().toISOString() } : p
    )
    this.store.write(next)
    this.notifyChange()
  }

  /**
   * Show the OS directory picker. Resolves with the chosen absolute path or
   * null when the user cancels.
   */
  async pickDirectory(window: BrowserWindow | null): Promise<string | null> {
    const target = window ?? this.window
    const result = target
      ? await dialog.showOpenDialog(target, {
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory']
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  }

  private notifyChange(): void {
    safeSend(this.window, 'project:changed', this.list())
  }
}
