import * as React from 'react'
import { useSessions } from '../state/sessions'
import { useProjects } from '../state/projects'
import { useSpawnDialog } from '../state/spawn'
import { fmtShortcut } from '../lib/platform'
import { Kbd } from '../ui'
import logoUrl from '../assets/logo.png'

/** Classic-shell welcome screen shown when no session is active.
 *  Extracted from App.tsx so the shell component is about composition,
 *  not 120 lines of hero markup. No behavioural change. */
export default function Welcome({
  claudePath
}: {
  claudePath: string | null | undefined
}): React.ReactElement {
  const isCreating = useSessions((s) => s.isCreating)
  const projects = useProjects((s) => s.projects)
  const currentPath = useProjects((s) => s.currentPath)
  const addProject = useProjects((s) => s.addProject)

  return (
    <div className="df-hero-bg df-scroll flex flex-1 items-center justify-center overflow-y-auto px-8 py-12">
      <div className="w-full max-w-2xl df-fade-in">
        {/* Hero */}
        <div className="mb-8 text-center">
          <div className="relative mx-auto mb-8 flex h-72 w-72 items-center justify-center">
            <div className="absolute inset-0 animate-ping rounded-full bg-accent-500/20" />
            <div className="absolute inset-4 rounded-full bg-accent-500/10 df-pulse" />
            <img
              src={logoUrl}
              alt="Hydra Ensemble"
              className="relative h-60 w-60 rounded-full"
              draggable={false}
            />
          </div>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-text-1">
            Run Claude agents in parallel.
          </h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-text-3">
            Each session runs with its own{' '}
            <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
              CLAUDE_CONFIG_DIR
            </code>{' '}
            so they never collide on history, JSONL, or MCP state.
          </p>
        </div>

        {/* Quickstart steps */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Step
            num={1}
            title="Pick a project"
            body={
              currentPath
                ? `Active: ${currentPath.split(/[/\\]/).filter(Boolean).pop() ?? currentPath}`
                : projects.length > 0
                  ? `${projects.length} saved`
                  : 'Open a directory to scope sessions and worktrees.'
            }
            done={!!currentPath || projects.length > 0}
            action={
              !currentPath ? (
                <button
                  type="button"
                  onClick={() => void addProject()}
                  className="text-[11px] font-medium text-accent-400 hover:text-accent-200"
                >
                  open directory →
                </button>
              ) : null
            }
          />
          <Step
            num={2}
            title="Spawn a session"
            body="A shell launches inside the project directory and execs claude — isolated per session."
            done={false}
          />
          <Step
            num={3}
            title="Watch them work"
            body="Status pills update live: thinking, generating, awaiting input, needs attention."
            done={false}
          />
        </div>

        {/* Primary CTA */}
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => useSpawnDialog.getState().show()}
            disabled={isCreating || claudePath === null}
            data-tour-id="spawn-session"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-gradient-to-br from-accent-500 to-accent-600 px-5 py-2.5 text-sm font-semibold text-white shadow-card transition df-lift hover:from-accent-400 hover:to-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <span className="relative">
              {isCreating ? 'spawning…' : 'Spawn first session'}
            </span>
            <span className="relative ml-1 rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/85">
              {fmtShortcut('N')}
            </span>
          </button>
          {claudePath === null ? (
            <p className="text-xs text-status-attention">
              claude binary not found in PATH — install Claude Code first.
            </p>
          ) : (
            <p className="text-[11px] text-text-4">
              Tip: <Kbd>{fmtShortcut('T')}</Kbd> toggles the projects drawer ·{' '}
              <Kbd>{fmtShortcut('`')}</Kbd> opens the terminals panel ·{' '}
              <Kbd>?</Kbd> shows all shortcuts
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Step({
  num,
  title,
  body,
  done,
  action
}: {
  num: number
  title: string
  body: string
  done: boolean
  action?: React.ReactNode
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-3 transition ${
        done
          ? 'border-accent-500/30 bg-accent-500/5'
          : 'border-border-soft bg-bg-3'
      }`}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
            done
              ? 'bg-accent-500 text-white'
              : 'bg-bg-4 text-text-3 ring-1 ring-inset ring-border-mid'
          }`}
        >
          {done ? '✓' : num}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-text-2">
          {title}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-text-3">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
