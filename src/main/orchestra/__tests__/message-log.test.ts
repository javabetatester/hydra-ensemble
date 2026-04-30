import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MessageLogStore } from '../message-log'
import type { MessageLog, UUID } from '../../../shared/orchestra'

const TEAM_ID: UUID = 'team-1'
const TEAM_SLUG = 'acme'

function makeStore(overrides: Partial<ConstructorParameters<typeof MessageLogStore>[0]> = {}): {
  store: MessageLogStore
  rootDir: string
} {
  const rootDir = mkdtempSync(join(tmpdir(), 'hydra-msglog-'))
  const store = new MessageLogStore({
    rootDir,
    teamSlugOf: (id) => {
      if (id === TEAM_ID) return TEAM_SLUG
      throw new Error(`unknown team ${id}`)
    },
    cap: 10,
    lowWater: 6,
    ...overrides
  })
  return { store, rootDir }
}

function payload(overrides: Partial<Omit<MessageLog, 'id' | 'at'>> = {}): Omit<
  MessageLog,
  'id' | 'at'
> {
  return {
    instanceId: TEAM_ID,
    teamId: TEAM_ID,
    taskId: 'task-1',
    fromAgentId: 'agent-1',
    toAgentId: 'agent-2',
    kind: 'output',
    content: 'hello',
    ...overrides
  }
}

const cleanupDirs: string[] = []

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const d = cleanupDirs.pop()!
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

function track(rootDir: string): string {
  cleanupDirs.push(rootDir)
  return rootDir
}

describe('MessageLogStore.append', () => {
  it('assigns id + ISO timestamp and preserves content fields', async () => {
    const { store, rootDir } = makeStore()
    track(rootDir)
    const before = Date.now()
    const e = store.append(payload({ content: 'ping' }))
    const after = Date.now()
    expect(e.id).toMatch(/[0-9a-f-]{36}/i)
    expect(e.content).toBe('ping')
    expect(e.teamId).toBe(TEAM_ID)
    expect(e.fromAgentId).toBe('agent-1')
    const t = Date.parse(e.at)
    expect(t).toBeGreaterThanOrEqual(before)
    expect(t).toBeLessThanOrEqual(after + 5)
    await store.close()
  })
})

describe('MessageLogStore listFor* filters', () => {
  it('filters by task, agent, and team', async () => {
    const { store, rootDir } = makeStore()
    track(rootDir)
    store.append(payload({ taskId: 'task-1', fromAgentId: 'a', toAgentId: 'b' }))
    store.append(payload({ taskId: 'task-2', fromAgentId: 'c', toAgentId: 'd' }))
    store.append(
      payload({
        teamId: 'team-2' as UUID,
        taskId: 'task-3',
        fromAgentId: 'a',
        toAgentId: 'z'
      })
    )

    expect(store.listForTask('task-1')).toHaveLength(1)
    expect(store.listForTask('task-2')).toHaveLength(1)
    expect(store.listForAgent('a')).toHaveLength(2) // one as "from", one on team-2
    expect(store.listForAgent('b')).toHaveLength(1)
    expect(store.listForTeam(TEAM_ID)).toHaveLength(2)
    expect(store.listForTeam('team-2')).toHaveLength(1)
    expect(store.listForTask('task-1', 0)).toHaveLength(1)
    await store.close()
  })
})

describe('MessageLogStore.subscribe', () => {
  it('fires on append and disposer stops further calls', async () => {
    const { store, rootDir } = makeStore()
    track(rootDir)
    const received: MessageLog[] = []
    const off = store.subscribe((e) => received.push(e))
    store.append(payload({ content: '1' }))
    store.append(payload({ content: '2' }))
    off()
    store.append(payload({ content: '3' }))
    expect(received.map((m) => m.content)).toEqual(['1', '2'])
    await store.close()
  })
})

describe('MessageLogStore overflow + flush', () => {
  it('flushes evicted entries to NDJSON and keeps memory <= lowWater', async () => {
    const { store, rootDir } = makeStore({ cap: 10, lowWater: 6 })
    track(rootDir)
    for (let i = 0; i < 10; i++) {
      store.append(payload({ content: `msg-${i}` }))
    }
    await store.flush()

    expect(store.listForTeam(TEAM_ID).length).toBeLessThanOrEqual(6)

    const file = join(rootDir, 'teams', TEAM_SLUG, 'messages.ndjson')
    expect(existsSync(file)).toBe(true)
    const raw = readFileSync(file, 'utf8').trim().split('\n')
    expect(raw).toHaveLength(4) // 10 - 6 evicted
    const parsed = raw.map((l) => JSON.parse(l) as MessageLog)
    expect(parsed.map((m) => m.content)).toEqual([
      'msg-0',
      'msg-1',
      'msg-2',
      'msg-3'
    ])
    await store.close()
  })

  it('flush is idempotent with no scheduled work', async () => {
    const { store, rootDir } = makeStore()
    track(rootDir)
    await store.flush()
    await store.flush()
    store.append(payload({ content: 'x' }))
    await store.flush()
    await store.flush()
    expect(store.listForTeam(TEAM_ID)).toHaveLength(1)
    await store.close()
  })
})

describe('MessageLogStore resilience', () => {
  it('teamSlugOf throwing does not break append and keeps entries in memory', async () => {
    const rootDir = track(mkdtempSync(join(tmpdir(), 'hydra-msglog-')))
    const store = new MessageLogStore({
      rootDir,
      cap: 4,
      lowWater: 2,
      teamSlugOf: () => {
        throw new Error('team deleted')
      }
    })
    for (let i = 0; i < 4; i++) {
      expect(() => store.append(payload({ content: `m${i}` }))).not.toThrow()
    }
    await store.flush()
    // File must not be created — orphaned team writes are skipped.
    const anyFile = join(rootDir, 'teams')
    expect(existsSync(anyFile)).toBe(false)
    // Entries were restored to memory so nothing is lost.
    expect(store.listForTeam(TEAM_ID).length).toBe(4)
    await store.close()
  })

  it('close flushes remaining scheduled writes', async () => {
    const { store, rootDir } = makeStore({ cap: 5, lowWater: 2 })
    track(rootDir)
    for (let i = 0; i < 5; i++) {
      store.append(payload({ content: `c${i}` }))
    }
    await store.close()
    const file = join(rootDir, 'teams', TEAM_SLUG, 'messages.ndjson')
    expect(existsSync(file)).toBe(true)
    const raw = readFileSync(file, 'utf8').trim().split('\n')
    expect(raw.length).toBeGreaterThanOrEqual(3)
  })
})
