import { ipcMain } from 'electron'
import type { KeyVault, VaultEntry } from '../keys/vault'
import type { Provider } from '../../shared/types'

/**
 * Renderer-facing surface for the key vault.
 *
 * `keys:reveal` is intentionally NOT registered — plaintext stays in the
 * main process. The session manager calls `vault.reveal()` directly when
 * spawning a PTY and the key never crosses the contextBridge.
 */
export function registerKeysIpc(vault: KeyVault): void {
  ipcMain.handle(
    'keys:list',
    (_evt, payload?: { provider?: Provider }): VaultEntry[] => {
      return vault.list(payload?.provider)
    }
  )

  ipcMain.handle(
    'keys:save',
    (
      _evt,
      payload: { name: string; provider: Provider; apiKeyEnv: string; value: string }
    ): { id: string } => {
      const id = vault.save({
        name: payload.name,
        provider: payload.provider,
        apiKeyEnv: payload.apiKeyEnv,
        value: payload.value
      })
      return { id }
    }
  )

  ipcMain.handle('keys:remove', (_evt, payload: { id: string }): void => {
    vault.remove(payload.id)
  })

  ipcMain.handle(
    'keys:rename',
    (_evt, payload: { id: string; name: string }): void => {
      vault.rename(payload.id, payload.name)
    }
  )
}
