import { ipcMain } from 'electron'
import { resolveClaudePath } from '../claude/resolve'
import { listCommands } from '../claude/commands-scanner'

export function registerClaudeIpc(): void {
  ipcMain.handle('claude:resolvePath', () => resolveClaudePath())
  ipcMain.handle('claude:listCommands', (_evt, cwd: string | null) => listCommands(cwd))
}
