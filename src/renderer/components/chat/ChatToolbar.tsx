import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Zap,
  ChevronDown,
  SlashSquare,
  Eraser,
  Layers,
  RotateCcw,
  BookMarked,
  HelpCircle,
  FilePlus,
  Check
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Model = 'opus' | 'sonnet' | 'haiku'

/**
 * Claude Code effort levels — driven by the real `/effort <level>`
 * slash command (docs: code.claude.com/docs/en/model-config). `auto`
 * resets the session back to the model's default adaptive reasoning.
 * `xhigh` is only supported on Opus 4.7; older models silently reject
 * it but we expose the full set.
 */
export type Effort = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const EFFORT_OPTIONS: { id: Effort; label: string; hint: string }[] = [
  { id: 'auto', label: 'auto', hint: 'let claude decide (default)' },
  { id: 'low', label: 'low', hint: 'minimum budget' },
  { id: 'medium', label: 'medium', hint: 'balanced' },
  { id: 'high', label: 'high', hint: 'deeper reasoning' },
  { id: 'xhigh', label: 'xhigh', hint: 'even deeper — opus 4.7 only' },
  { id: 'max', label: 'max', hint: 'maximum reasoning budget' }
]

const MODEL_OPTIONS: { id: Model; label: string; hint: string }[] = [
  { id: 'opus', label: 'opus', hint: 'flagship — deepest reasoning' },
  { id: 'sonnet', label: 'sonnet', hint: 'balanced — faster, still smart' },
  { id: 'haiku', label: 'haiku', hint: 'fast + cheap — quick tasks' }
]

interface CommandDef {
  id: string
  label: string
  /** Raw slash command to send (without trailing newline). */
  slash: string
  description: string
  icon: LucideIcon
  /** Destructive commands get a confirmation step. */
  destructive?: boolean
}

const COMMANDS: CommandDef[] = [
  {
    id: 'init',
    label: 'init',
    slash: '/init',
    description: 'generate a CLAUDE.md for this repo',
    icon: FilePlus
  },
  {
    id: 'compact',
    label: 'compact',
    slash: '/compact',
    description: 'summarise the conversation to free context',
    icon: Layers
  },
  {
    id: 'rewind',
    label: 'rewind',
    slash: '/rewind',
    description: 'open the rewind picker — go back to an earlier turn',
    icon: RotateCcw
  },
  {
    id: 'resume',
    label: 'resume',
    slash: '/resume',
    description: 'pick a previous session to continue',
    icon: BookMarked
  },
  {
    id: 'help',
    label: 'help',
    slash: '/help',
    description: 'list every built-in claude command',
    icon: HelpCircle
  },
  {
    id: 'clear',
    label: 'clear',
    slash: '/clear',
    description: 'wipe the current conversation (keeps credentials)',
    icon: Eraser,
    destructive: true
  }
]

interface Props {
  /** Current model reported by JSONL (opus/sonnet/haiku short name). */
  currentModel: string | undefined
  /** Whether the agent is idle (ok to accept a command) or busy. */
  canSend: boolean
  /** Send text to the PTY. Toolbar appends CR. */
  onSend: (text: string) => void
  /** Controlled effort level — parent owns state + triggers the
   *  `/effort <level>` slash command on change. */
  effort: Effort
  onEffortChange: (next: Effort) => void
  /** Controlled thinking toggle — parent writes Alt+T (the TUI
   *  shortcut) to the PTY when this flips. */
  thinking: boolean
  onThinkingToggle: () => void
  /** Optional — additional telemetry chips rendered on the right. */
  rightChildren?: React.ReactNode
}

/**
 * Visual command surface for the chat view. Emits slash commands via
 * the parent's `onSend` so we stay aligned with claude's canonical
 * input path — no hidden state, just shortcuts.
 *
 * Model piggybacks on the JSONL `model` field for its "current"
 * indicator. We deliberately do NOT expose an effort selector: Claude
 * Code's TUI doesn't have a `/effort` slash command, so an inline
 * `/effort high` ends up corrupted in the prompt and never actually
 * adjusts anything (you'd see weirdness like "/effort effort high"
 * echoed back).
 */
export default function ChatToolbar({
  currentModel,
  canSend,
  onSend,
  effort,
  onEffortChange,
  thinking,
  onThinkingToggle,
  rightChildren
}: Props) {
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const effortRef = useRef<HTMLDivElement>(null)
  const commandsRef = useRef<HTMLDivElement>(null)

  // Dismiss popovers on outside click.
  useEffect(() => {
    if (!modelOpen && !effortOpen && !commandsOpen) return
    const onClick = (e: MouseEvent): void => {
      const target = e.target as Node
      if (modelOpen && modelRef.current && !modelRef.current.contains(target)) {
        setModelOpen(false)
      }
      if (effortOpen && effortRef.current && !effortRef.current.contains(target)) {
        setEffortOpen(false)
      }
      if (commandsOpen && commandsRef.current && !commandsRef.current.contains(target)) {
        setCommandsOpen(false)
        setPendingConfirm(null)
      }
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [modelOpen, effortOpen, commandsOpen])

  const pickModel = (m: Model): void => {
    setModelOpen(false)
    // Claude Code accepts `/model <name>` at the prompt.
    onSend(`/model ${m}`)
  }

  const runCommand = (cmd: CommandDef): void => {
    if (cmd.destructive && pendingConfirm !== cmd.id) {
      setPendingConfirm(cmd.id)
      return
    }
    setCommandsOpen(false)
    setPendingConfirm(null)
    onSend(cmd.slash)
  }

  const modelLabel = (currentModel ?? 'sonnet').toLowerCase()

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-soft bg-bg-1 px-3 py-2 text-xs">
      {/* Model selector */}
      <div ref={modelRef} className="relative">
        <button
          type="button"
          onClick={() => setModelOpen((v) => !v)}
          disabled={!canSend}
          className="flex items-center gap-1.5 rounded-sm border border-border-soft bg-bg-2 px-2 py-1 font-mono text-[11px] text-text-2 hover:border-border-mid hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
          title="change model"
        >
          <Box size={11} strokeWidth={1.75} className="text-accent-400" />
          {modelLabel}
          <ChevronDown
            size={10}
            strokeWidth={1.75}
            className={`text-text-4 transition-transform ${modelOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {modelOpen ? (
          <div
            className="absolute left-0 top-[calc(100%+4px)] z-20 w-56 overflow-hidden border border-border-mid bg-bg-2 shadow-pop df-fade-in"
            style={{ borderRadius: 'var(--radius-sm)' }}
          >
            {MODEL_OPTIONS.map((opt) => {
              const active = modelLabel.includes(opt.id)
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => pickModel(opt.id)}
                  className={`flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-bg-3 ${
                    active ? 'bg-accent-500/10' : ''
                  }`}
                >
                  <Box
                    size={12}
                    strokeWidth={1.75}
                    className={active ? 'mt-0.5 text-accent-400' : 'mt-0.5 text-text-3'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-text-1">{opt.label}</span>
                      {active ? (
                        <Check size={10} strokeWidth={2} className="text-accent-400" />
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[10px] leading-snug text-text-3">
                      {opt.hint}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* Effort selector — real `/effort <level>` slash command. */}
      <div ref={effortRef} className="relative">
        <button
          type="button"
          onClick={() => setEffortOpen((v) => !v)}
          disabled={!canSend}
          className="flex items-center gap-1.5 rounded-sm border border-border-soft bg-bg-2 px-2 py-1 font-mono text-[11px] text-text-2 hover:border-border-mid hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
          title="reasoning budget (/effort)"
        >
          <Zap size={11} strokeWidth={1.75} className="text-accent-400" />
          {effort}
          <ChevronDown
            size={10}
            strokeWidth={1.75}
            className={`text-text-4 transition-transform ${effortOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {effortOpen ? (
          <div
            className="absolute left-0 top-[calc(100%+4px)] z-20 w-56 overflow-hidden border border-border-mid bg-bg-2 shadow-pop df-fade-in"
            style={{ borderRadius: 'var(--radius-sm)' }}
          >
            {EFFORT_OPTIONS.map((opt) => {
              const active = effort === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setEffortOpen(false)
                    onEffortChange(opt.id)
                  }}
                  className={`flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-bg-3 ${
                    active ? 'bg-accent-500/10' : ''
                  }`}
                >
                  <Zap
                    size={12}
                    strokeWidth={1.75}
                    className={active ? 'mt-0.5 text-accent-400' : 'mt-0.5 text-text-3'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-text-1">{opt.label}</span>
                      {active ? (
                        <Check size={10} strokeWidth={2} className="text-accent-400" />
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[10px] leading-snug text-text-3">
                      {opt.hint}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* Thinking on/off — triggers Alt+T in the TUI which flips
          `alwaysThinkingEnabled` for this session. Binary, not a level. */}
      <button
        type="button"
        onClick={onThinkingToggle}
        disabled={!canSend}
        className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
          thinking
            ? 'border-accent-500 bg-accent-500/15 text-accent-400'
            : 'border-border-soft bg-bg-2 text-text-3 hover:border-border-mid hover:text-text-1'
        }`}
        title="toggle extended thinking (Alt+T)"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${thinking ? 'bg-accent-400' : 'bg-text-4'}`} />
        thinking
      </button>

      {/* Commands palette */}
      <div ref={commandsRef} className="relative">
        <button
          type="button"
          onClick={() => setCommandsOpen((v) => !v)}
          disabled={!canSend}
          className="flex items-center gap-1.5 rounded-sm border border-border-soft bg-bg-2 px-2 py-1 font-mono text-[11px] text-text-2 hover:border-border-mid hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
          title="claude commands"
        >
          <SlashSquare size={11} strokeWidth={1.75} className="text-accent-400" />
          commands
          <ChevronDown
            size={10}
            strokeWidth={1.75}
            className={`text-text-4 transition-transform ${commandsOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {commandsOpen ? (
          <div
            className="absolute left-0 top-[calc(100%+4px)] z-20 w-64 overflow-hidden border border-border-mid bg-bg-2 shadow-pop df-fade-in"
            style={{ borderRadius: 'var(--radius-sm)' }}
          >
            {COMMANDS.map((cmd) => {
              const Icon = cmd.icon
              const confirming = pendingConfirm === cmd.id
              return (
                <button
                  key={cmd.id}
                  type="button"
                  onClick={() => runCommand(cmd)}
                  className={`flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-bg-3 ${
                    confirming ? 'bg-status-attention/10' : ''
                  }`}
                >
                  <Icon
                    size={12}
                    strokeWidth={1.75}
                    className={`mt-0.5 ${
                      cmd.destructive ? 'text-status-attention' : 'text-accent-400'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-text-1">{cmd.slash}</span>
                      {confirming ? (
                        <span className="font-mono text-[9px] text-status-attention">
                          click again to confirm
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[10px] leading-snug text-text-3">
                      {cmd.description}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* Right side — telemetry chips (tokens / etc) injected by parent. */}
      {rightChildren ? (
        <div className="ml-auto flex items-center gap-3 font-mono text-[11px] text-text-3">
          {rightChildren}
        </div>
      ) : null}
    </div>
  )
}

export { type Model }
