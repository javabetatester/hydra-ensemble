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
import { isV1Snapshot, migrateV1ToV2 } from './orchestra/migration'

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
  migrated: boolean
} {
  if (parsed == null || typeof parsed !== 'object') {
    return { slice: DEFAULT_ORCHESTRA_STATE, migrated: false }
  }
  if (isV1Snapshot(parsed)) {
    return { slice: migrateV1ToV2(parsed), migrated: true }
  }
  return {
    slice: { ...DEFAULT_ORCHESTRA_STATE, ...(parsed as OrchestraStoreSlice) },
    migrated: false
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
      // Preserve a one-shot v1 snapshot before the first v2 write so a
      // botched migration is recoverable. Skip if a backup already
      // exists — never overwrite the original.
      if (orchestra.migrated) {
        const backup = join(dir, 'store.json.bak.v1')
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
      if (orchestra.migrated) flush()
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
