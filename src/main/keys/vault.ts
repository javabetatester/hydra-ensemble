/**
 * Per-user encrypted vault for provider API keys.
 *
 * The vault file lives at `<userData>/hydra-key-vault.json` and stores an
 * array of {@link VaultRecord}. Only `encryptedValue` is ciphered (via
 * Electron's `safeStorage`); every other field is plaintext on disk so
 * the user can audit what's stored without cracking encryption.
 *
 * Atomic writes: we always write to `<file>.tmp` and `rename` over the
 * destination so a crash mid-write can't corrupt the JSON.
 *
 * `reveal()` is intentionally NOT exposed via IPC — only the main process
 * (e.g. `SessionManager.spawnFor`) calls it and exports the plaintext into
 * the spawned PTY's env. Plaintext never crosses the renderer bridge.
 */

import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { Provider } from '../../shared/types'

const VAULT_FILE_NAME = 'hydra-key-vault.json'

export interface VaultRecord {
  id: string
  name: string
  provider: Provider
  /** Captured at save time so the spawn knows which env var to export
   *  (provider specs can in principle change apiKeyEnv between releases —
   *  recording the value the user saved against keeps the export stable). */
  apiKeyEnv: string
  createdAt: string
  lastUsedAt?: string
  /** Output of `safeStorage.encryptString(plaintext).toString('base64')`. */
  encryptedValue: string
}

/** Stripped view safe to send across IPC — never carries the cipher blob. */
export interface VaultEntry {
  id: string
  name: string
  provider: Provider
  apiKeyEnv: string
  createdAt: string
  lastUsedAt?: string
}

/**
 * Subset of `electron.safeStorage` we use. Typed as a structural interface
 * so tests can pass a passthrough double without depending on Electron at
 * import time.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plaintext: string): Buffer
  decryptString(buf: Buffer): string
}

export interface KeyVaultOptions {
  /** Path of the vault JSON file. */
  filePath: string
  safeStorage: SafeStorageLike
}

interface VaultDoc {
  /** Bumped if the on-disk schema ever changes. Currently 1. */
  version: 1
  records: VaultRecord[]
}

function emptyDoc(): VaultDoc {
  return { version: 1, records: [] }
}

function strip(rec: VaultRecord): VaultEntry {
  return {
    id: rec.id,
    name: rec.name,
    provider: rec.provider,
    apiKeyEnv: rec.apiKeyEnv,
    createdAt: rec.createdAt,
    ...(rec.lastUsedAt !== undefined ? { lastUsedAt: rec.lastUsedAt } : {})
  }
}

export class KeyVault {
  private readonly filePath: string
  private readonly safeStorage: SafeStorageLike

  constructor(opts: KeyVaultOptions) {
    this.filePath = opts.filePath
    this.safeStorage = opts.safeStorage
  }

  /** True when Electron reports the OS-level keyring backing safeStorage
   *  is usable. Renderer should warn the user when this is false. */
  isEncryptionAvailable(): boolean {
    try {
      return this.safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  list(provider?: Provider): VaultEntry[] {
    const doc = this.read()
    const filtered = provider
      ? doc.records.filter((r) => r.provider === provider)
      : doc.records
    return filtered.map(strip)
  }

  /** Save a new key. Returns the new record id. */
  save(input: {
    name: string
    provider: Provider
    apiKeyEnv: string
    value: string
  }): string {
    if (!this.isEncryptionAvailable()) {
      throw new Error('vault unavailable: OS encryption not ready')
    }
    const trimmedName = input.name.trim()
    if (!trimmedName) {
      throw new Error('vault: name required')
    }
    if (!input.value) {
      throw new Error('vault: value required')
    }
    const doc = this.read()
    const encryptedValue = this.safeStorage
      .encryptString(input.value)
      .toString('base64')
    const id = randomUUID()
    const record: VaultRecord = {
      id,
      name: trimmedName,
      provider: input.provider,
      apiKeyEnv: input.apiKeyEnv,
      createdAt: new Date().toISOString(),
      encryptedValue
    }
    doc.records.push(record)
    this.write(doc)
    return id
  }

  /** Decrypt and return the plaintext for `id`. Updates `lastUsedAt`.
   *  Returns null if no record matches. */
  reveal(id: string): string | null {
    const doc = this.read()
    const rec = doc.records.find((r) => r.id === id)
    if (!rec) return null
    let plaintext: string
    try {
      plaintext = this.safeStorage.decryptString(
        Buffer.from(rec.encryptedValue, 'base64')
      )
    } catch {
      return null
    }
    rec.lastUsedAt = new Date().toISOString()
    this.write(doc)
    return plaintext
  }

  remove(id: string): void {
    const doc = this.read()
    const next = doc.records.filter((r) => r.id !== id)
    if (next.length === doc.records.length) return
    doc.records = next
    this.write(doc)
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) {
      throw new Error('vault: name required')
    }
    const doc = this.read()
    const rec = doc.records.find((r) => r.id === id)
    if (!rec) return
    rec.name = trimmed
    this.write(doc)
  }

  // --- private --------------------------------------------------------

  private read(): VaultDoc {
    if (!existsSync(this.filePath)) return emptyDoc()
    let raw: string
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch {
      return emptyDoc()
    }
    if (!raw.trim()) return emptyDoc()
    try {
      const parsed = JSON.parse(raw) as Partial<VaultDoc>
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray(parsed.records)
      ) {
        return { version: 1, records: parsed.records as VaultRecord[] }
      }
    } catch {
      /* fall through to empty doc — corrupt file is treated as missing */
    }
    return emptyDoc()
  }

  private write(doc: VaultDoc): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    const tmp = `${this.filePath}.tmp`
    const payload = JSON.stringify(doc, null, 2)
    // Write + fsync the tmp before renaming so the rename is durable
    // even if the OS reorders the buffer flush vs the directory entry.
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeSync(fd, payload)
      try {
        fsyncSync(fd)
      } catch {
        /* fsync may not be supported on every fs (tmpfs in some CI) */
      }
    } finally {
      closeSync(fd)
    }
    try {
      renameSync(tmp, this.filePath)
    } catch (err) {
      // On rename failure leave the tmp around so the user can recover
      // manually, but try to clean up if possible to avoid littering.
      try {
        unlinkSync(tmp)
      } catch {
        /* swallow */
      }
      throw err
    }
  }
}

/** Default file location helper — resolved from Electron's userData path. */
export function defaultVaultPath(userDataDir: string): string {
  return join(userDataDir, VAULT_FILE_NAME)
}
