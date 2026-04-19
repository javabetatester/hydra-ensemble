export interface PtySpawnOptions {
  sessionId: string
  cwd: string
  shell?: string
  args?: string[]
  env?: Record<string, string>
  cols: number
  rows: number
}

export type PtySpawnResult = { ok: true } | { ok: false; error: string }

export interface PtyDataEvent {
  sessionId: string
  data: string
}

export interface PtyExitEvent {
  sessionId: string
  exitCode: number
  signal?: number
}

export interface HydraEnsembleApi {
  pty: {
    spawn: (opts: PtySpawnOptions) => Promise<PtySpawnResult>
    write: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    kill: (sessionId: string) => Promise<void>
    onData: (handler: (event: PtyDataEvent) => void) => () => void
    onExit: (handler: (event: PtyExitEvent) => void) => () => void
  }
  claude: {
    resolvePath: () => Promise<string | null>
  }
  platform: {
    os: Platform
  }
}

export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

declare global {
  interface Window {
    api: HydraEnsembleApi
  }
}

export {}
