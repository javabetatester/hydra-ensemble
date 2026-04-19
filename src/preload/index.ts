import { contextBridge, ipcRenderer } from 'electron'
import type {
  HydraEnsembleApi,
  Platform,
  PtyDataEvent,
  PtyExitEvent,
  PtySpawnOptions,
  PtySpawnResult
} from '../shared/types'

const api: HydraEnsembleApi = {
  pty: {
    spawn: (opts: PtySpawnOptions): Promise<PtySpawnResult> =>
      ipcRenderer.invoke('pty:spawn', opts),
    write: (sessionId, data) => ipcRenderer.invoke('pty:write', { sessionId, data }),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.invoke('pty:resize', { sessionId, cols, rows }),
    kill: (sessionId) => ipcRenderer.invoke('pty:kill', { sessionId }),
    onData: (handler) => {
      const listener = (_evt: unknown, event: PtyDataEvent): void => handler(event)
      ipcRenderer.on('pty:data', listener)
      return () => {
        ipcRenderer.removeListener('pty:data', listener)
      }
    },
    onExit: (handler) => {
      const listener = (_evt: unknown, event: PtyExitEvent): void => handler(event)
      ipcRenderer.on('pty:exit', listener)
      return () => {
        ipcRenderer.removeListener('pty:exit', listener)
      }
    }
  },
  claude: {
    resolvePath: () => ipcRenderer.invoke('claude:resolvePath')
  },
  platform: {
    os: process.platform as Platform
  }
}

contextBridge.exposeInMainWorld('api', api)
