import { ipcMain } from 'electron'
import type { WorktreeService } from '../git/worktree'
import type { CommitAiService } from '../git/commit-ai'

/**
 * Register IPC handlers for git/worktree operations. Channel names match the
 * `api.git` surface declared in `src/shared/types.ts`.
 */
export function registerGitIpc(svc: WorktreeService, ai: CommitAiService): void {
  ipcMain.handle('git:repoRoot', (_evt, cwd: string) => svc.repoRoot(cwd))

  ipcMain.handle('git:listWorktrees', (_evt, cwd: string) => svc.listWorktrees(cwd))

  ipcMain.handle(
    'git:createWorktree',
    (_evt, payload: { repoRoot: string; name: string; baseBranch?: string }) =>
      svc.createWorktree(payload.repoRoot, payload.name, payload.baseBranch)
  )

  ipcMain.handle(
    'git:removeWorktree',
    (_evt, payload: { repoRoot: string; path: string }) =>
      svc.removeWorktree(payload.repoRoot, payload.path)
  )

  ipcMain.handle('git:listChangedFiles', (_evt, cwd: string) => svc.listChangedFiles(cwd))

  ipcMain.handle('git:currentBranch', (_evt, cwd: string) => svc.currentBranch(cwd))

  ipcMain.handle(
    'git:getDiff',
    (_evt, payload: { cwd: string; filePath?: string; staged?: boolean }) =>
      svc.getDiff(payload.cwd, payload.filePath, payload.staged ?? false)
  )

  ipcMain.handle(
    'git:stageFiles',
    (_evt, payload: { cwd: string; paths: string[] }) =>
      svc.stageFiles(payload.cwd, payload.paths)
  )

  ipcMain.handle(
    'git:unstageFiles',
    (_evt, payload: { cwd: string; paths: string[] }) =>
      svc.unstageFiles(payload.cwd, payload.paths)
  )

  ipcMain.handle(
    'git:commit',
    (_evt, payload: { cwd: string; message: string }) =>
      svc.commit(payload.cwd, payload.message)
  )

  ipcMain.handle('git:generateCommitMessage', (_evt, cwd: string) => ai.generate(cwd))
}
