import { app } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { SessionMeta, ToolkitItem } from '../shared/types'
import {
  DEFAULT_ORCHESTRA_STATE,
  type OrchestraStoreSlice
} from '../shared/orchestra'
import {
  isV1Snapshot,
  isV2Snapshot,
  migrateV1ToV2,
  migrateV2ToV3
} from './orchestra/migration'

export type { ToolkitItem } from '../shared/types'

export interface SavedProject {
  path: string
  name: string
  lastOpenedAt: string
}

interface StoreShape {
  sessions: SessionMeta[]
  projects: SavedProject[]
  toolkit: ToolkitItem[]
  orchestra: OrchestraStoreSlice
}

const DEFAULTS: StoreShape = {
  sessions: [],
  projects: [],
  toolkit: [],
  orchestra: DEFAULT_ORCHESTRA_STATE
}

let cachePath: string | null = null
let cache: StoreShape = DEFAULTS

function loadOrchestra(parsed: unknown): {
  slice: OrchestraStoreSlice
  /** Highest schema version migrated *from* (1, 2 or null). Used to
   *  pick the right one-shot backup file name. */
  migratedFrom: 1 | 2 | null
} {
  if (parsed == null || typeof parsed !== 'object') {
    return { slice: DEFAULT_ORCHESTRA_STATE, migratedFrom: null }
  }
  // v1 → v3 in one step (migrateV1ToV2 already produces a v3 slice
  // since phase 5 of issue #12 — the function name is kept for
  // historical reasons).
  if (isV1Snapshot(parsed)) {
    return { slice: migrateV1ToV2(parsed), migratedFrom: 1 }
  }
  if (isV2Snapshot(parsed)) {
    return { slice: migrateV2ToV3(parsed), migratedFrom: 2 }
  }
  return {
    slice: { ...DEFAULT_ORCHESTRA_STATE, ...(parsed as OrchestraStoreSlice) },
    migratedFrom: null
  }
}

export function initStore(): void {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  cachePath = join(dir, 'store.json')
  if (existsSync(cachePath)) {
    try {
      const raw = readFileSync(cachePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoreShape>
      const orchestra = loadOrchestra(parsed.orchestra)
      // Preserve a one-shot snapshot per migration source so a
      // botched migration is recoverable. Skip if the per-version
      // backup already exists — never overwrite the original.
      if (orchestra.migratedFrom !== null) {
        const backup = join(dir, `store.json.bak.v${orchestra.migratedFrom}`)
        if (!existsSync(backup)) {
          try {
            copyFileSync(cachePath, backup)
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[store] backup failed:', (err as Error).message)
          }
        }
      }
      cache = {
        sessions: parsed.sessions ?? [],
        projects: parsed.projects ?? [],
        toolkit: parsed.toolkit ?? [],
        orchestra: orchestra.slice
      }
      if (orchestra.migratedFrom !== null) flush()
    } catch {
      cache = { ...DEFAULTS }
    }
  } else {
    cache = { ...DEFAULTS }
  }
}

export function getStore(): StoreShape {
  return cache
}

export function patchStore(patch: Partial<StoreShape>): void {
  cache = { ...cache, ...patch }
  flush()
}

function flush(): void {
  if (!cachePath) return
  try {
    writeFileSync(cachePath, JSON.stringify(cache, null, 2))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[store] flush failed:', (err as Error).message)
  }
}
