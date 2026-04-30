import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProjectService, createMemoryProjectStore } from '../manager'

/**
 * The service is exercised against an in-memory store seeded via
 * `createMemoryProjectStore` so we don't have to bootstrap Electron's
 * `app.getPath('userData')`-backed JSON file.
 */
describe('ProjectService', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `hydra-ensemble-projects-${randomUUID()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('add() returns null for a path that does not exist on disk', async () => {
    const svc = new ProjectService(createMemoryProjectStore())
    const ghost = path.join(os.tmpdir(), `hydra-ensemble-missing-${randomUUID()}`)
    const result = await svc.add(ghost)
    expect(result).toBeNull()
    expect(svc.list()).toEqual([])
  })

  it('add() accepts an existing directory and returns ProjectMeta', async () => {
    const svc = new ProjectService(createMemoryProjectStore())
    const meta = await svc.add(tmpDir)
    expect(meta).not.toBeNull()
    if (!meta) return
    expect(meta.path).toBe(tmpDir)
    expect(meta.name).toBe(path.basename(tmpDir))
    expect(typeof meta.lastOpenedAt).toBe('string')
    // ISO timestamp; Date.parse should yield a finite number.
    expect(Number.isFinite(Date.parse(meta.lastOpenedAt))).toBe(true)
    expect(svc.list()).toHaveLength(1)
    expect(svc.current()?.path).toBe(tmpDir)
  })

  it('setCurrent() bumps lastOpenedAt above other projects', async () => {
    const olderDir = path.join(os.tmpdir(), `hydra-ensemble-projects-${randomUUID()}`)
    await mkdir(olderDir, { recursive: true })
    try {
      const svc = new ProjectService(createMemoryProjectStore())

      // Add the "older" one first, then the recent one.
      const older = await svc.add(olderDir)
      // Force a strictly increasing ISO timestamp even on coarse clocks.
      await new Promise((r) => setTimeout(r, 5))
      const newer = await svc.add(tmpDir)
      expect(older).not.toBeNull()
      expect(newer).not.toBeNull()

      // Sanity: newer is on top.
      expect(svc.list()[0]?.path).toBe(tmpDir)

      await new Promise((r) => setTimeout(r, 5))
      svc.setCurrent(olderDir)

      // list() preserves insertion order — see ProjectService.setCurrent
      // ("Update timestamp in-place — don't reorder the array."). tmpDir
      // was added later, so it stays on top regardless of which project
      // is current.
      const ranked = svc.list()
      expect(ranked[0]?.path).toBe(tmpDir)
      expect(ranked[1]?.path).toBe(olderDir)

      // current() reflects the bump because it sorts by lastOpenedAt.
      expect(svc.current()?.path).toBe(olderDir)

      // The bumped olderDir now has a strictly newer timestamp than tmpDir.
      const olderMeta = ranked.find((p) => p.path === olderDir)
      const newerMeta = ranked.find((p) => p.path === tmpDir)
      expect(
        olderMeta && newerMeta && olderMeta.lastOpenedAt > newerMeta.lastOpenedAt
      ).toBe(true)
    } finally {
      await rm(olderDir, { recursive: true, force: true })
    }
  })
})
