import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { AlertTriangle, RotateCcw, XCircle } from 'lucide-react'
import { useOrchestra } from './state/orchestra'

/**
 * Heartbeat / crash-watch overlay for an AgentCard.
 *
 * The Orchestra store does not (yet) surface explicit heartbeat pings from
 * the agent child process, so this component derives health from signals
 * that already exist in the renderer mirror:
 *
 *   1. `agent.state === 'error'`                       → crashed
 *   2. most recent own `messageLog` entry > 90s old     → stuck
 *      while `state === 'running'`                     (not responding)
 *   3. most recent own `messageLog` entry > 30s old     → slow
 *      while `state === 'running'`                     (no output)
 *
 * Healthy agents render `null` — the overlay is invisible until something
 * actually needs the user's attention. When integrated, mount this as a
 * sibling inside AgentCard (or wrap the card); it positions itself as a
 * narrow strip pinned to the card's bottom border.
 */

/** Silent threshold — amber "no output" strip. */
const SLOW_MS = 30_000
/** Silent threshold — red "not responding" strip. */
const STUCK_MS = 90_000

type Health = 'healthy' | 'slow' | 'stuck' | 'crashed'

interface Props {
  agentId: string
}

function AgentHeartbeatImpl({ agentId }: Props): ReactElement | null {
  const agent = useOrchestra((s) => s.agents.find((a) => a.id === agentId))
  const messageLog = useOrchestra((s) => s.messageLog)

  // Track a "now" cursor that ticks every second so the derived health
  // label stays accurate between store updates (the agent can fall silent
  // without emitting any store event at all — that's the whole point).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  /** Last timestamp (ms) produced by THIS agent, or null if none seen. */
  const lastOwnAt = useMemo<number | null>(() => {
    for (let i = messageLog.length - 1; i >= 0; i--) {
      const m = messageLog[i]
      if (!m) continue
      if (m.fromAgentId !== agentId) continue
      const ts = Date.parse(m.at)
      if (Number.isNaN(ts)) continue
      return ts
    }
    return null
  }, [messageLog, agentId])

  const { health, silentMs } = useMemo<{
    health: Health
    silentMs: number
  }>(() => {
    if (!agent) return { health: 'healthy', silentMs: 0 }
    if (agent.state === 'error') return { health: 'crashed', silentMs: 0 }
    if (agent.state !== 'running') return { health: 'healthy', silentMs: 0 }

    // Prefer the last own output; fall back to `lastActiveAt` (set by main
    // when the agent boots / resumes) so a freshly-started agent isn't
    // flagged as silent before it has had a chance to emit anything.
    const lastActiveMs = agent.lastActiveAt
      ? Date.parse(agent.lastActiveAt)
      : NaN
    const anchor =
      lastOwnAt ??
      (Number.isFinite(lastActiveMs) ? lastActiveMs : null)
    if (anchor == null) return { health: 'healthy', silentMs: 0 }

    const delta = Math.max(0, now - anchor)
    if (delta >= STUCK_MS) return { health: 'stuck', silentMs: delta }
    if (delta >= SLOW_MS) return { health: 'slow', silentMs: delta }
    return { health: 'healthy', silentMs: delta }
  }, [agent, lastOwnAt, now])

  const onRestart = useCallback((): void => {
    window.dispatchEvent(
      new CustomEvent('orchestra:restart-agent', {
        detail: { agentId }
      })
    )
  }, [agentId])

  if (!agent || health === 'healthy') return null

  const seconds = Math.floor(silentMs / 1000)

  // Tailwind class packs per state. Kept as literal strings (not built via
  // string concat) so the compiler's JIT picks them up during the static
  // class scan.
  let stripCls =
    'border-amber-500/50 bg-amber-500/15 text-amber-200'
  let icon = <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
  let label = `No output for ${seconds}s`
  let pulse = false
  let role: 'status' | 'alert' = 'status'

  if (health === 'stuck') {
    stripCls = 'border-red-500/60 bg-red-500/20 text-red-200'
    icon = <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
    label = `Not responding for ${seconds}s`
    pulse = true
    role = 'alert'
  } else if (health === 'crashed') {
    stripCls = 'border-red-600 bg-red-600/90 text-white'
    icon = <XCircle className="h-3 w-3 shrink-0" aria-hidden />
    label = 'Agent crashed'
    role = 'alert'
  }

  return (
    <div
      // Positioned against the AgentCard's bottom border. Consumers mount
      // this inside the card's relative wrapper; `pointer-events-auto` so
      // the Restart button is still clickable even if a wrapper toggled
      // pointer-events off during a drag.
      className={[
        'absolute inset-x-0 bottom-0 z-20 pointer-events-auto',
        'flex items-center gap-1.5 px-2 py-1',
        'rounded-b-[var(--radius-md)] border-t',
        'font-mono text-[10px] uppercase tracking-wider',
        'animate-[slide-up_160ms_ease-out]',
        'motion-reduce:animate-none',
        stripCls,
        pulse ? 'animate-pulse' : ''
      ].join(' ')}
      style={{
        // Inline keyframes — injected once per mount, harmless if duplicated
        // because the animation name is stable. Keeping it local avoids
        // touching the global Tailwind/CSS config for a single overlay.
        animationName: 'agent-heartbeat-slide-up'
      }}
      role={role}
      aria-live={health === 'crashed' ? 'assertive' : 'polite'}
      onClick={(e) => e.stopPropagation()}
    >
      <style>{`@keyframes agent-heartbeat-slide-up {
        from { transform: translateY(100%); opacity: 0; }
        to   { transform: translateY(0);     opacity: 1; }
      }`}</style>
      {icon}
      <span className="truncate flex-1" title={label}>
        {label}
      </span>
      {health === 'crashed' ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRestart()
          }}
          className={[
            'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5',
            'border border-white/30 bg-white/10 text-[10px]',
            'hover:bg-white/20 focus:outline-none focus:ring-1 focus:ring-white/70'
          ].join(' ')}
          aria-label="restart agent"
          title="Restart agent"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          Restart
        </button>
      ) : null}
    </div>
  )
}

export const AgentHeartbeat = memo(AgentHeartbeatImpl)
AgentHeartbeat.displayName = 'AgentHeartbeat'

export default AgentHeartbeat
