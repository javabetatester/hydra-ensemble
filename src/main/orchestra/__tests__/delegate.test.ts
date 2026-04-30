import { describe, expect, it } from 'vitest'
import {
  MAX_DELEGATION_DEPTH,
  delegationDepth
} from '../index'
import type { Task } from '../../../shared/orchestra'

/**
 * Tests for the delegation-loop fix that motivated the follow-up to
 * issue #12: handleDelegate now (a) honours the requested target and
 * (b) refuses to grow a parent-task chain past `MAX_DELEGATION_DEPTH`.
 *
 * `delegationDepth` is the pure helper at the heart of the depth
 * cap — it walks the `parentTaskId` chain and returns the count.
 * Testing it directly avoids spinning up a full OrchestraCore (which
 * touches disk and child processes).
 */

type ChainTask = Pick<Task, 'id' | 'parentTaskId'>

function chain(n: number): ChainTask[] {
  // task `n` is the root (no parent); each `i` points to `i+1`.
  const out: ChainTask[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: `t${i}`,
      parentTaskId: i === n - 1 ? null : `t${i + 1}`
    })
  }
  return out
}

describe('delegationDepth', () => {
  it('returns 0 for null', () => {
    expect(delegationDepth([], null)).toBe(0)
  })

  it('returns 0 for unknown id', () => {
    expect(delegationDepth([], 'nope')).toBe(0)
  })

  it('returns 1 for a leaf with no parent', () => {
    const tasks: ChainTask[] = [{ id: 'leaf', parentTaskId: null }]
    expect(delegationDepth(tasks, 'leaf')).toBe(1)
  })

  it('counts the full chain', () => {
    const tasks = chain(5)
    expect(delegationDepth(tasks, 't0')).toBe(5)
    expect(delegationDepth(tasks, 't2')).toBe(3)
  })

  it('caps at 32 hops to survive a malformed cycle in the data', () => {
    // self-referencing parent: t0.parent = t0. Without the cap the
    // walker would spin forever; with it, we get 32 and bail.
    const tasks: ChainTask[] = [{ id: 't0', parentTaskId: 't0' }]
    expect(delegationDepth(tasks, 't0')).toBe(32)
  })

  it('matches MAX_DELEGATION_DEPTH expectations', () => {
    // The cap constant is what handleDelegate compares against. A
    // chain at exactly the cap should still equal it.
    const tasks = chain(MAX_DELEGATION_DEPTH)
    expect(delegationDepth(tasks, 't0')).toBe(MAX_DELEGATION_DEPTH)
  })
})
