import { ipcMain } from 'electron'
import { resolveClaudePath } from '../claude/resolve'

export function registerClaudeIpc(): void {
  ipcMain.handle('claude:resolvePath', () => resolveClaudePath())
}
