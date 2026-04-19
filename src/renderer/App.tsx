import { useEffect, useState } from 'react'
import TerminalPane from './components/TerminalPane'

export default function App() {
  const [claudePath, setClaudePath] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    void window.api.claude.resolvePath().then(setClaudePath)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0d0d0f] text-white">
      <header className="flex items-center justify-between border-b border-white/10 bg-[#16161a] px-4 py-2 text-xs text-white/60">
        <div className="font-medium text-white/80">Hydra Ensemble · Phase 0 skeleton</div>
        <div className="flex gap-3">
          <span>os: {window.api.platform.os}</span>
          <span>
            claude:{' '}
            {claudePath === undefined ? (
              <span className="text-white/40">resolving…</span>
            ) : claudePath === null ? (
              <span className="text-yellow-400">not found in PATH</span>
            ) : (
              <span className="text-emerald-400">{claudePath}</span>
            )}
          </span>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <TerminalPane sessionId="default" />
      </main>
    </div>
  )
}
