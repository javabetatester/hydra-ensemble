import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Sparkles,
  FolderOpen,
  Terminal,
  Network,
  ArrowRight,
  ArrowLeft,
  Check,
  AlertTriangle
} from 'lucide-react'
import { useProjects } from '../state/projects'
import { useSpawnDialog } from '../state/spawn'
import { useOrchestra } from '../orchestra/state/orchestra'
import { Kbd } from '../ui'
import type { ProjectMeta } from '../../shared/types'

interface Props {
  open: boolean
  onClose: () => void
}

const TOTAL_STEPS = 4
const WELCOME_FLAG_KEY = 'hydra.welcome.shown'

/**
 * First-run onboarding. Four steps walk a brand-new user from "what is this"
 * to either spawning their first classic session or discovering Orchestra.
 * Re-openable from the menu; finishing sets a localStorage flag so we never
 * nag returning users.
 */
export default function WelcomeScreen({ open, onClose }: Props) {
  const [step, setStep] = useState(0)
  const [claudePath, setClaudePath] = useState<string | null>(null)
  const [claudeChecking, setClaudeChecking] = useState(false)
  const [picking, setPicking] = useState(false)

  const projects = useProjects((s) => s.projects)
  const currentPath = useProjects((s) => s.currentPath)
  const setCurrent = useProjects((s) => s.setCurrent)
  const refresh = useProjects((s) => s.refresh)

  const showSpawn = useSpawnDialog((s) => s.show)

  const orchestraEnabled = useOrchestra((s) => s.settings.enabled)
  const setOrchestraSettings = useOrchestra((s) => s.setSettings)
  const setOverlayOpen = useOrchestra((s) => s.setOverlayOpen)

  // Reset to step 1 whenever the screen is re-opened.
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  // Re-check the Claude CLI every time we land on step 2.
  useEffect(() => {
    if (!open || step !== 1) return
    let cancelled = false
    setClaudeChecking(true)
    void window.api.claude
      .resolvePath()
      .then((path) => {
        if (!cancelled) setClaudePath(path)
      })
      .catch(() => {
        if (!cancelled) setClaudePath(null)
      })
      .finally(() => {
        if (!cancelled) setClaudeChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, step])

  const finish = useCallback(() => {
    try {
      localStorage.setItem(WELCOME_FLAG_KEY, '1')
    } catch {
      // Private mode / storage disabled — flag is a nice-to-have, not critical.
    }
    onClose()
  }, [onClose])

  const goNext = useCallback(() => {
    setStep((s) => (s < TOTAL_STEPS - 1 ? s + 1 : s))
  }, [])

  const goPrev = useCallback(() => {
    setStep((s) => (s > 0 ? s - 1 : s))
  }, [])

  const handlePickProject = useCallback(async () => {
    setPicking(true)
    try {
      const dir = await window.api.project.pickDirectory()
      if (!dir) return
      const meta = await window.api.project.add(dir)
      if (meta) {
        await setCurrent(meta.path)
        await refresh()
      }
    } finally {
      setPicking(false)
    }
  }, [setCurrent, refresh])

  const launchClassic = useCallback(() => {
    finish()
    // Defer so the modal-close animation doesn't fight the new dialog mount.
    setTimeout(() => showSpawn(), 0)
  }, [finish, showSpawn])

  const launchOrchestra = useCallback(async () => {
    if (!orchestraEnabled) {
      await setOrchestraSettings({ enabled: true })
    }
    setOverlayOpen(true)
    finish()
  }, [orchestraEnabled, setOrchestraSettings, setOverlayOpen, finish])

  // Keyboard: Esc closes (= skip), Enter advances when it's safe to.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
        return
      }
      if (e.key === 'Enter') {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea') return
        if (step < TOTAL_STEPS - 1) {
          e.preventDefault()
          goNext()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step, goNext, finish])

  const installCommand = useMemo(
    () => 'npm install -g @anthropic-ai/claude-code',
    []
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-bg-0/85 px-4 backdrop-blur-md df-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) finish()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Hydra"
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        <Stepper current={step} total={TOTAL_STEPS} />

        <div className="df-scroll max-h-[70vh] overflow-y-auto p-10">
          {step === 0 && <StepHero onStart={goNext} onSkip={finish} />}
          {step === 1 && (
            <StepClaudeCheck
              checking={claudeChecking}
              path={claudePath}
              installCommand={installCommand}
            />
          )}
          {step === 2 && (
            <StepProjectPicker
              projects={projects}
              currentPath={currentPath}
              picking={picking}
              onPick={handlePickProject}
              onSelectExisting={(path) => {
                void setCurrent(path)
              }}
            />
          )}
          {step === 3 && (
            <StepLaunch
              onClassic={launchClassic}
              onOrchestra={() => {
                void launchOrchestra()
              }}
            />
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border-soft bg-bg-1 px-6 py-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={step === 0}
            className="flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] text-text-3 transition hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-3"
          >
            <ArrowLeft size={12} strokeWidth={1.75} />
            back
          </button>

          <span className="font-mono text-[10px] text-text-4">
            <Kbd>Enter</Kbd> continue · <Kbd>Esc</Kbd> skip
          </span>

          {step < TOTAL_STEPS - 1 ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={finish}
                className="rounded-sm px-2.5 py-1 text-[11px] text-text-4 transition hover:text-text-2"
              >
                skip
              </button>
              <button
                type="button"
                onClick={goNext}
                className="flex items-center gap-1.5 rounded-sm border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-[11px] text-accent-200 transition hover:border-accent-500/60 hover:bg-accent-500/25"
              >
                next
                <ArrowRight size={12} strokeWidth={1.75} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={finish}
              className="flex items-center gap-1.5 rounded-sm border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-[11px] text-accent-200 transition hover:border-accent-500/60 hover:bg-accent-500/25"
            >
              <Check size={12} strokeWidth={1.75} />
              finish
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

interface StepperProps {
  current: number
  total: number
}

function Stepper({ current, total }: StepperProps) {
  return (
    <div className="flex items-center justify-center gap-2 border-b border-border-soft bg-bg-1 px-4 py-3">
      {Array.from({ length: total }).map((_, i) => {
        const active = i === current
        const done = i < current
        return (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              active
                ? 'w-6 bg-accent-400'
                : done
                  ? 'w-1.5 bg-accent-500/60'
                  : 'w-1.5 bg-border-mid'
            }`}
            aria-label={`step ${i + 1} of ${total}${active ? ' (current)' : ''}`}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Hero
// ---------------------------------------------------------------------------

interface StepHeroProps {
  onStart: () => void
  onSkip: () => void
}

function StepHero({ onStart, onSkip }: StepHeroProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-accent-500/30 bg-accent-500/10 shadow-pop">
        <Sparkles size={44} strokeWidth={1.5} className="text-accent-300" />
      </div>
      <h1 className="mb-3 bg-gradient-to-r from-accent-300 via-accent-200 to-text-1 bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
        Welcome to Hydra
      </h1>
      <p className="mb-8 max-w-md text-sm leading-relaxed text-text-3">
        Orchestrate parallel Claude Code agents, visually.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          className="flex items-center gap-2 rounded-sm border border-accent-500/40 bg-accent-500/15 px-4 py-2 text-xs text-accent-100 transition hover:border-accent-500/70 hover:bg-accent-500/25"
        >
          Get started
          <ArrowRight size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="rounded-sm border border-border-soft bg-bg-3 px-4 py-2 text-xs text-text-3 transition hover:border-border-mid hover:text-text-1"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Claude CLI check
// ---------------------------------------------------------------------------

interface StepClaudeCheckProps {
  checking: boolean
  path: string | null
  installCommand: string
}

function StepClaudeCheck({ checking, path, installCommand }: StepClaudeCheckProps) {
  const [copied, setCopied] = useState(false)
  const ok = !!path

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(installCommand)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard denied — nothing to do, user can still read the command.
    }
  }, [installCommand])

  return (
    <div className="flex flex-col">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-border-mid bg-bg-3">
          <Terminal size={20} strokeWidth={1.5} className="text-accent-300" />
        </div>
        <div>
          <h2 className="bg-gradient-to-r from-accent-300 to-text-1 bg-clip-text text-xl font-semibold tracking-tight text-transparent">
            Checking for Claude CLI
          </h2>
          <p className="mt-0.5 text-[11px] text-text-4">
            Hydra spawns the official Anthropic CLI for every agent.
          </p>
        </div>
      </div>

      {checking ? (
        <div className="rounded-sm border border-border-soft bg-bg-1 px-4 py-5 text-[11px] text-text-3">
          Looking on your PATH…
        </div>
      ) : ok ? (
        <div className="rounded-sm border border-accent-500/30 bg-accent-500/10 px-4 py-5">
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-accent-200">
            <Check size={13} strokeWidth={2} />
            Claude CLI detected
          </div>
          <div className="break-all font-mono text-[11px] text-text-2">{path}</div>
        </div>
      ) : (
        <div className="rounded-sm border border-status-attention/40 bg-status-attention/10 px-4 py-5">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-status-attention">
            <AlertTriangle size={13} strokeWidth={2} />
            Claude CLI not found on PATH
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-text-3">
            Install it from Anthropic, then come back and we'll pick it up
            automatically:
          </p>
          <div className="flex items-center justify-between gap-3 rounded-sm border border-border-soft bg-bg-0 px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-2">
              {installCommand}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              className="shrink-0 rounded-sm border border-border-soft bg-bg-3 px-2 py-0.5 font-mono text-[10px] text-text-3 transition hover:border-accent-500/40 hover:text-accent-200"
            >
              {copied ? 'copied' : 'copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Pick project folder
// ---------------------------------------------------------------------------

interface StepProjectPickerProps {
  projects: ProjectMeta[]
  currentPath: string | null
  picking: boolean
  onPick: () => void | Promise<void>
  onSelectExisting: (path: string) => void
}

function StepProjectPicker({
  projects,
  currentPath,
  picking,
  onPick,
  onSelectExisting
}: StepProjectPickerProps) {
  return (
    <div className="flex flex-col">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-border-mid bg-bg-3">
          <FolderOpen size={20} strokeWidth={1.5} className="text-accent-300" />
        </div>
        <div>
          <h2 className="bg-gradient-to-r from-accent-300 to-text-1 bg-clip-text text-xl font-semibold tracking-tight text-transparent">
            Pick your first project
          </h2>
          <p className="mt-0.5 text-[11px] text-text-4">
            Agents run inside a folder. You can add more later from the sidebar.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void onPick()}
        disabled={picking}
        className="mb-5 flex items-center justify-center gap-2 rounded-sm border border-dashed border-accent-500/40 bg-accent-500/5 px-4 py-6 text-[12px] text-accent-200 transition hover:border-accent-500/70 hover:bg-accent-500/10 disabled:opacity-50"
      >
        <FolderOpen size={16} strokeWidth={1.75} />
        {picking ? 'opening file picker…' : 'Choose a folder…'}
      </button>

      {projects.length > 0 && (
        <div>
          <div className="df-label mb-2 text-text-4">already added</div>
          <div className="flex flex-col gap-1">
            {projects.map((p) => {
              const active = p.path === currentPath
              return (
                <button
                  key={p.path}
                  type="button"
                  onClick={() => onSelectExisting(p.path)}
                  className={`flex items-center justify-between gap-3 rounded-sm border px-3 py-2 text-left transition ${
                    active
                      ? 'border-accent-500/40 bg-accent-500/10'
                      : 'border-border-soft bg-bg-1 hover:border-border-mid hover:bg-bg-3'
                  }`}
                >
                  <div className="min-w-0">
                    <div
                      className={`truncate text-[12px] ${
                        active ? 'text-accent-100' : 'text-text-2'
                      }`}
                    >
                      {p.name}
                    </div>
                    <div className="truncate font-mono text-[10px] text-text-4">
                      {p.path}
                    </div>
                  </div>
                  {active && (
                    <Check
                      size={13}
                      strokeWidth={2}
                      className="shrink-0 text-accent-300"
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — Classic vs Orchestra
// ---------------------------------------------------------------------------

interface StepLaunchProps {
  onClassic: () => void
  onOrchestra: () => void
}

function StepLaunch({ onClassic, onOrchestra }: StepLaunchProps) {
  return (
    <div className="flex flex-col">
      <div className="mb-6 text-center">
        <h2 className="mb-2 bg-gradient-to-r from-accent-300 to-text-1 bg-clip-text text-xl font-semibold tracking-tight text-transparent">
          How do you want to start?
        </h2>
        <p className="text-[11px] text-text-4">
          You can switch anytime — both modes share the same projects.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={onClassic}
          className="group flex flex-col items-start gap-3 rounded-sm border border-border-mid bg-bg-1 p-5 text-left transition hover:border-accent-500/50 hover:bg-bg-3"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-border-soft bg-bg-3 transition group-hover:border-accent-500/40 group-hover:bg-accent-500/10">
            <Terminal size={18} strokeWidth={1.5} className="text-accent-300" />
          </div>
          <div>
            <div className="mb-1 text-[13px] font-medium text-text-1">
              Start with Classic
            </div>
            <p className="text-[11px] leading-relaxed text-text-3">
              One agent at a time in a tabbed terminal. Familiar, predictable,
              perfect for a single task.
            </p>
          </div>
          <div className="mt-auto flex items-center gap-1.5 pt-2 text-[10px] text-text-4 transition group-hover:text-accent-200">
            new session
            <ArrowRight size={11} strokeWidth={1.75} />
          </div>
        </button>

        <button
          type="button"
          onClick={onOrchestra}
          className="group relative flex flex-col items-start gap-3 rounded-sm border border-border-mid bg-bg-1 p-5 text-left transition hover:border-accent-500/50 hover:bg-bg-3"
        >
          <span className="absolute right-3 top-3 rounded-sm border border-accent-500/40 bg-accent-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent-200">
            beta
          </span>
          <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-border-soft bg-bg-3 transition group-hover:border-accent-500/40 group-hover:bg-accent-500/10">
            <Network size={18} strokeWidth={1.5} className="text-accent-300" />
          </div>
          <div>
            <div className="mb-1 text-[13px] font-medium text-text-1">
              Try Orchestrador
            </div>
            <p className="text-[11px] leading-relaxed text-text-3">
              A canvas of agents wired together. Route messages between them,
              watch work happen in parallel.
            </p>
          </div>
          <div className="mt-auto flex items-center gap-1.5 pt-2 text-[10px] text-text-4 transition group-hover:text-accent-200">
            open overlay
            <ArrowRight size={11} strokeWidth={1.75} />
          </div>
        </button>
      </div>
    </div>
  )
}
