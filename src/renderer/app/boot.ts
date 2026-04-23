import { useEffect, useState } from 'react'
import { useSessions } from '../state/sessions'
import { useToolkit } from '../state/toolkit'
import { useWatchdog } from '../state/watchdog'
import { useProjects } from '../state/projects'
import { useTranscripts } from '../state/transcripts'
import { useOrchestra } from '../orchestra/state/orchestra'

/**
 * Single boot pipeline for the classic renderer.
 *
 * Previously App.tsx fired six init calls in an ad-hoc useEffect with
 * no lifecycle owner, no ordering guarantees, and no central place to
 * add telemetry. Consolidating here keeps App.tsx about composition
 * and gives us one surface to layer retry / readiness / error handling
 * onto later without chasing a useEffect through 800 lines.
 *
 * Returns the resolved `claude` binary path (or null when the CLI
 * isn't installed) so the shell can show the right CTA/help copy.
 */
export function useBootstrap(): string | null | undefined {
  const initSessions = useSessions((s) => s.init)
  const initToolkit = useToolkit((s) => s.init)
  const initWatchdog = useWatchdog((s) => s.init)
  const initProjects = useProjects((s) => s.init)
  const initTranscripts = useTranscripts((s) => s.init)
  const initOrchestra = useOrchestra((s) => s.init)

  const [claudePath, setClaudePath] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    void initSessions()
    void initToolkit()
    void initWatchdog()
    void initProjects()
    initTranscripts()
    void initOrchestra()
    void window.api.claude.resolvePath().then(setClaudePath)
  }, [
    initSessions,
    initToolkit,
    initWatchdog,
    initProjects,
    initTranscripts,
    initOrchestra
  ])

  return claudePath
}
