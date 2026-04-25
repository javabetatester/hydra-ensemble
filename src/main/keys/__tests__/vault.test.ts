import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KeyVault, type SafeStorageLike, type VaultRecord } from '../vault'

/** Trivial passthrough double — `enc:` prefix stands in for ciphertext. */
function makeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b) => {
      const t = b.toString('utf8')
      if (!t.startsWith('enc:')) throw new Error('bad cipher')
      return t.slice(4)
    }
  }
}

let tmp: string
let filePath: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hydra-vault-'))
  filePath = join(tmp, 'hydra-key-vault.json')
})

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* swallow */
  }
})

describe('KeyVault', () => {
  it('creates the file on first save and round-trips a key through reveal', () => {
    const vault = new KeyVault({ filePath, safeStorage: makeSafeStorage() })
    const id = vault.save({
      name: 'work',
      provider: 'codex',
      apiKeyEnv: 'OPENAI_API_KEY',
      value: 'sk-secret-123'
    })
    expect(typeof id).toBe('string')

    const revealed = vault.reveal(id)
    expect(revealed).toBe('sk-secret-123')
  })

  it('lists records filtered by provider and strips the cipher blob', () => {
    const vault = new KeyVault({ filePath, safeStorage: makeSafeStorage() })
    vault.save({
      name: 'a', provider: 'codex', apiKeyEnv: 'OPENAI_API_KEY', value: 'aaa'
    })
    vault.save({
      name: 'b', provider: 'claude', apiKeyEnv: 'ANTHROPIC_API_KEY', value: 'bbb'
    })
    vault.save({
      name: 'c', provider: 'codex', apiKeyEnv: 'OPENAI_API_KEY', value: 'ccc'
    })

    const codex = vault.list('codex')
    expect(codex.map((r) => r.name).sort()).toEqual(['a', 'c'])
    for (const e of codex) {
      // The stripped entry should not carry encryptedValue at all.
      expect((e as unknown as { encryptedValue?: string }).encryptedValue).toBeUndefined()
    }

    const all = vault.list()
    expect(all.length).toBe(3)
  })

  it('updates lastUsedAt on reveal', async () => {
    const vault = new KeyVault({ filePath, safeStorage: makeSafeStorage() })
    const id = vault.save({
      name: 'work', provider: 'codex', apiKeyEnv: 'OPENAI_API_KEY', value: 'sk-1'
    })

    const before = vault.list('codex')[0]
    expect(before).toBeDefined()
    expect(before?.lastUsedAt).toBeUndefined()

    // Sleep a millisecond so the new ISO timestamp is strictly after the
    // createdAt one (Date.now resolution should give us a different
    // string after ~1ms on every platform we run tests on).
    await new Promise((r) => setTimeout(r, 5))
    vault.reveal(id)

    const after = vault.list('codex')[0]
    expect(after?.lastUsedAt).toBeDefined()
    expect(typeof after?.lastUsedAt).toBe('string')
  })

  it('renames a record', () => {
    const vault = new KeyVault({ filePath, safeStorage: makeSafeStorage() })
    const id = vault.save({
      name: 'work', provider: 'codex', apiKeyEnv: 'OPENAI_API_KEY', value: 'sk-1'
    })
    vault.rename(id, 'work-prod')
    const all = vault.list()
    expect(all.find((r) => r.id === id)?.name).toBe('work-prod')
  })

  it('removes a record without touching the others', () => {
    const vault = new KeyVault({ filePath, safeStorage: makeSafeStorage() })
    const a = vault.save({
      name: 'a', provider: 'codex', apiKeyEnv: 'OPENAI_API_KEY', value: 'aaa'
    })
    const b = vault.save({
      name: 'b', provider: 'codex', apiKeyEnv: 'OPENAI_API_KEY', value: 'bbb'
    })
    vault.remove(a)
    const remaining = vault.list()
    expect(remaining.map((r) => r.id)).toEqual([b])
    expect(vault.reveal(a)).toBeNull()
    expect(vault.reveal(b)).toBe('bbb')
  })

  it('returns null when revealing an unknown id', () => {
    const vault = new KeyVault({ filePath, safeStorage: makeSafeStorage() })
    expect(vault.reveal('nope-uuid')).toBeNull()
  })

  it('throws when safeStorage is unavailable', () => {
    const vault = new KeyVault({
      filePath,
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => ''
      }
    })
    expect(() =>
      vault.save({ name: 'x', provider: 'codex', apiKeyEnv: 'OPENAI_API_KEY', value: 'k' })
    ).toThrow(/vault unavailable/i)
  })

  it('persists state through atomic JSON writes that we can re-read directly', () => {
    const vault = new KeyVault({ filePath, safeStorage: makeSafeStorage() })
    const id = vault.save({
      name: 'work', provider: 'codex', apiKeyEnv: 'OPENAI_API_KEY', value: 'sk-direct'
    })

    // The file must exist after the rename — atomic write semantics.
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { version: number; records: VaultRecord[] }
    expect(parsed.version).toBe(1)
    expect(parsed.records.length).toBe(1)
    const rec = parsed.records[0]
    expect(rec).toBeDefined()
    expect(rec?.id).toBe(id)
    expect(rec?.name).toBe('work')
    // encryptedValue is base64-encoded ciphertext — our stub turns
    // 'sk-direct' into 'enc:sk-direct'. Decode and check.
    const decoded = Buffer.from(rec?.encryptedValue ?? '', 'base64').toString('utf8')
    expect(decoded).toBe('enc:sk-direct')

    // No leftover .tmp file from the rename dance.
    expect(() => readFileSync(`${filePath}.tmp`, 'utf8')).toThrow()
  })

  it('tolerates a corrupt file by treating it as empty', () => {
    writeFileSync(filePath, '{not-json', 'utf8')
    const vault = new KeyVault({ filePath, safeStorage: makeSafeStorage() })
    expect(vault.list()).toEqual([])
    // Saving still works and rewrites the file with a valid doc.
    const id = vault.save({
      name: 'fresh', provider: 'codex', apiKeyEnv: 'OPENAI_API_KEY', value: 'sk-x'
    })
    expect(vault.reveal(id)).toBe('sk-x')
  })
})
