import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  Send,
  Info,
  Brain,
  RotateCcw,
  Wrench,
  ChevronRight,
  ChevronDown,
  AlertTriangle
} from 'lucide-react'
import type {
  SessionMeta,
  TranscriptBlock,
  TranscriptMessage as TranscriptMessageT
} from '../../../shared/types'
import { useTranscripts } from '../../state/transcripts'
import { useSessions } from '../../state/sessions'
import ChatMarkdown from './ChatMarkdown'
import ChatToolbar, { type Effort } from './ChatToolbar'

interface Props {
  session: SessionMeta
  visible: boolean
}

function formatTokens(n: number | undefined): string {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

/**
 * Relative-time formatter — "just now", "2m", "3h", "yesterday", "Apr 19".
 * Kept in the module so the per-message component is cheap to rerender
 * and doesn't rebuild the function each time.
 */
function formatRelative(iso: string | undefined, nowMs: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Math.max(0, nowMs - t)
  const s = Math.floor(diff / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d`
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** Single-line summary for a tool call — mirrors ChatToolBlock heuristics
 *  but kept inline here since we also render tool_use differently (as a
 *  collapsible details row with the Wrench icon). */
function toolSummary(name: string, input: Record<string, unknown>): string {
  const trim = (s: string, max: number): string => {
    const cleaned = s.replace(/\s+/g, ' ').trim()
    return cleaned.length <= max ? cleaned : cleaned.slice(0, max - 1) + '…'
  }
  const path = input['file_path'] ?? input['path'] ?? input['notebook_path']
  if (typeof path === 'string') return path
  const cmd = input['command']
  if (typeof cmd === 'string') return trim(cmd, 100)
  const pattern = input['pattern'] ?? input['query']
  if (typeof pattern === 'string') return trim(pattern, 80)
  const description = input['description']
  if (typeof description === 'string') return trim(description, 80)
  if (name === 'TodoWrite' && Array.isArray(input['todos'])) {
    return `${(input['todos'] as unknown[]).length} items`
  }
  const firstKey = Object.keys(input)[0]
  if (firstKey) return `${firstKey}: ${trim(String(input[firstKey]), 80)}`
  return ''
}

/** First-letter avatar initial — uppercase, safe for emoji by falling
 *  back to the role letter when session.name starts with a surrogate. */
function initialFor(role: 'user' | 'assistant' | 'system', sessionName?: string): string {
  if (role === 'user') return 'U'
  if (role === 'system') return 'S'
  const name = (sessionName ?? '').trim()
  if (name.length === 0) return 'C'
  const ch = name.charAt(0)
  // Letter or digit? use it. Else "C" for claude.
  return /[\p{L}\p{N}]/u.test(ch) ? ch.toUpperCase() : 'C'
}

/** Derive a readable text colour for the avatar given a hex accent.
 *  Falls back to white when luminance can't be parsed. */
function avatarTextOn(accent: string | undefined): string {
  if (!accent) return '#fff'
  const hex = accent.replace('#', '')
  if (hex.length !== 6) return '#fff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return '#fff'
  // Relative luminance (sRGB) — dark text on light accents, white on dark.
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return l > 0.6 ? '#0b0b0d' : '#fff'
}

// =============================================================================
// TranscriptMessage — chat-bubble renderer (inlined because the project
// doesn't have a standalone TranscriptMessage.tsx file and the task
// constrains file-touch scope).
// =============================================================================

interface GroupedBlock {
  kind: 'text' | 'thinking' | 'tool_use'
  block: TranscriptBlock
  /** Collected tool_result blocks that pair with this tool_use (by id). */
  results: Extract<TranscriptBlock, { kind: 'tool_result' }>[]
}

/** Group tool_result blocks under their originating tool_use so the
 *  result renders as a subtle card attached to the call. If no matching
 *  tool_use exists (rare: out-of-order parse), the result falls through
 *  as a standalone card. */
function groupBlocks(blocks: TranscriptBlock[]): GroupedBlock[] {
  const out: GroupedBlock[] = []
  const indexById = new Map<string, number>()
  for (const b of blocks) {
    if (b.kind === 'tool_result') {
      const idx = indexById.get(b.toolUseId)
      if (idx !== undefined) {
        out[idx]!.results.push(b)
        continue
      }
      // Orphan result: render as a tool_use-like row with no use.
      out.push({ kind: 'tool_use', block: b as unknown as TranscriptBlock, results: [b] })
      continue
    }
    if (b.kind === 'tool_use') {
      indexById.set(b.id, out.length)
      out.push({ kind: 'tool_use', block: b, results: [] })
      continue
    }
    out.push({ kind: b.kind, block: b, results: [] })
  }
  return out
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="overflow-hidden border border-border-soft bg-bg-1/60"
      style={{ borderRadius: 'var(--radius-sm)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-text-3 hover:bg-bg-2"
      >
        {open ? (
          <ChevronDown size={12} strokeWidth={1.75} className="shrink-0" />
        ) : (
          <ChevronRight size={12} strokeWidth={1.75} className="shrink-0" />
        )}
        <Brain size={12} strokeWidth={1.5} className="shrink-0" />
        <span className="font-mono">thinking</span>
        {!open ? (
          <span className="truncate italic text-text-4">{text.slice(0, 120)}</span>
        ) : null}
      </button>
      {open ? (
        <div className="df-scroll max-h-80 overflow-auto border-t border-border-soft px-3 py-2 text-xs italic text-text-3">
          <span className="whitespace-pre-wrap">{text}</span>
        </div>
      ) : null}
    </div>
  )
}

function ToolUseDetails({
  block,
  results
}: {
  block: Extract<TranscriptBlock, { kind: 'tool_use' }>
  results: Extract<TranscriptBlock, { kind: 'tool_result' }>[]
}) {
  const [open, setOpen] = useState(false)
  const summary = toolSummary(block.name, block.input)

  return (
    <div className="space-y-1.5">
      <div
        className="overflow-hidden border border-border-soft bg-bg-2"
        style={{ borderRadius: 'var(--radius-sm)' }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-bg-3"
        >
          {open ? (
            <ChevronDown size={12} strokeWidth={1.75} className="shrink-0 text-text-3" />
          ) : (
            <ChevronRight size={12} strokeWidth={1.75} className="shrink-0 text-text-3" />
          )}
          <Wrench size={12} strokeWidth={1.75} className="shrink-0 text-accent-400" />
          <span className="shrink-0 font-mono text-text-2">{block.name}</span>
          {summary ? (
            <span className="truncate font-mono text-text-3">{summary}</span>
          ) : null}
        </button>
        {open ? (
          <pre className="df-scroll df-scroll-thin max-h-80 overflow-auto border-t border-border-soft bg-bg-1 px-2.5 py-2 font-mono text-[11px] text-text-2">
            {JSON.stringify(block.input, null, 2)}
          </pre>
        ) : null}
      </div>
      {results.map((r, i) => (
        <ToolResultCard key={`r-${i}`} result={r} />
      ))}
    </div>
  )
}

function ToolResultCard({
  result
}: {
  result: Extract<TranscriptBlock, { kind: 'tool_result' }>
}) {
  const [open, setOpen] = useState(false)
  const text = result.text.trim()
  if (text.length === 0) return null
  const multiline = text.includes('\n') || text.length > 120
  const preview = multiline ? (text.split('\n')[0] ?? text) : text

  return (
    <div
      className={`ml-4 overflow-hidden border ${
        result.isError
          ? 'border-status-attention/50 bg-status-attention/5'
          : 'border-border-soft bg-bg-1/60'
      }`}
      style={{ borderRadius: 'var(--radius-sm)' }}
    >
      <button
        type="button"
        onClick={() => multiline && setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
          multiline ? 'hover:bg-bg-2' : 'cursor-default'
        }`}
      >
        {multiline ? (
          open ? (
            <ChevronDown size={12} strokeWidth={1.75} className="shrink-0 text-text-3" />
          ) : (
            <ChevronRight size={12} strokeWidth={1.75} className="shrink-0 text-text-3" />
          )
        ) : (
          <span className="w-3" />
        )}
        {result.isError ? (
          <AlertTriangle
            size={12}
            strokeWidth={1.75}
            className="shrink-0 text-status-attention"
          />
        ) : null}
        <span className="shrink-0 font-mono text-text-3">result</span>
        <span className="truncate font-mono text-text-2">
          {preview.length > 140 ? preview.slice(0, 139) + '…' : preview}
        </span>
      </button>
      {open && multiline ? (
        <pre className="df-scroll df-scroll-thin max-h-96 overflow-auto border-t border-border-soft bg-bg-0 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-2">
          {text}
        </pre>
      ) : null}
    </div>
  )
}

interface TranscriptMessageProps {
  message: TranscriptMessageT
  session: SessionMeta
  /** Previous message's role — drives tighter vs. looser vertical spacing. */
  prevRole?: TranscriptMessageT['role']
  /** Relative timestamp tick — ChatView passes a 1-minute refreshed number. */
  nowMs: number
  onRewind?: (message: TranscriptMessageT) => void
  canRewind?: boolean
}

function TranscriptMessage({
  message,
  session,
  prevRole,
  nowMs,
  onRewind,
  canRewind
}: TranscriptMessageProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  // System messages: centred subtle pill.
  if (isSystem) {
    const preview = message.blocks
      .filter((b) => b.kind === 'text' || b.kind === 'thinking')
      .map((b) => ('text' in b ? b.text : ''))
      .join(' · ')
      .slice(0, 160)
    return (
      <div className="flex justify-center px-4 py-1.5">
        <div
          className="flex max-w-[80%] items-center gap-1.5 border border-border-soft bg-bg-1/70 px-2.5 py-1 text-[11px] text-text-4"
          style={{ borderRadius: '9999px' }}
        >
          <Info size={11} strokeWidth={1.5} className="shrink-0" />
          <span className="font-mono">system</span>
          {preview ? <span className="truncate">{preview}</span> : null}
        </div>
      </div>
    )
  }

  // Tighter spacing when the previous message had the same author, more
  // breathing room when authors change or at the start.
  const sameAuthorAsPrev = prevRole === message.role
  const topPadding = sameAuthorAsPrev ? 'pt-1' : 'pt-4'

  const grouped = useMemo(() => groupBlocks(message.blocks), [message.blocks])
  const accent = session.accentColor ?? '#7aa2f7'
  const initial = initialFor(message.role, session.name)
  const avatarFg = avatarTextOn(accent)

  const avatar = (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center text-[11px] font-semibold"
      style={{
        backgroundColor: isUser ? 'var(--color-bg-3)' : accent,
        color: isUser ? 'var(--color-text-1)' : avatarFg,
        borderRadius: '9999px',
        visibility: sameAuthorAsPrev ? 'hidden' : 'visible'
      }}
      aria-hidden={sameAuthorAsPrev ? true : undefined}
    >
      {initial}
    </div>
  )

  const relative = formatRelative(message.timestamp, nowMs)

  // Bubble surfaces:
  //  - user: accent tint on the right, right-aligned, max 70%
  //  - assistant: bg-bg-2 on the left, left-aligned, max 70%
  const bubbleBase =
    'min-w-0 max-w-[70%] space-y-2 border px-3 py-2 text-sm leading-relaxed'
  const bubbleRole = isUser
    ? 'bg-accent-500/15 border-accent-500/30 text-text-1'
    : 'bg-bg-2 border-border-soft text-text-1'

  return (
    <div className={`group relative px-4 ${topPadding} pb-1`}>
      <div
        className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      >
        {avatar}

        <div className={`flex min-w-0 flex-1 flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          {/* Header: author + model + relative timestamp (hover only). */}
          {!sameAuthorAsPrev ? (
            <div
              className={`mb-1 flex items-baseline gap-2 text-[11px] ${
                isUser ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              <span className="font-semibold text-text-1">
                {isUser ? 'you' : 'claude'}
              </span>
              {message.model ? (
                <span className="font-mono text-text-4">{message.model}</span>
              ) : null}
            </div>
          ) : null}

          <div
            className={`${bubbleBase} ${bubbleRole}`}
            style={{ borderRadius: 'var(--radius-sm)' }}
          >
            {grouped.map((g, i) => {
              const key = `${message.index}-${i}`
              if (g.kind === 'text') {
                const b = g.block as Extract<TranscriptBlock, { kind: 'text' }>
                return <ChatMarkdown key={key} text={b.text} />
              }
              if (g.kind === 'thinking') {
                const b = g.block as Extract<TranscriptBlock, { kind: 'thinking' }>
                return <ThinkingBlock key={key} text={b.text} />
              }
              // tool_use (possibly an orphan result — ToolUseDetails
              // handles that via the results array).
              if (g.block.kind === 'tool_use') {
                return (
                  <ToolUseDetails
                    key={key}
                    block={g.block}
                    results={g.results}
                  />
                )
              }
              // Orphan tool_result fell into the tool_use slot — just
              // render the result card directly.
              if (g.block.kind === 'tool_result') {
                return <ToolResultCard key={key} result={g.block} />
              }
              return null
            })}
          </div>

          {/* Relative timestamp on hover — sits below the bubble so it
              doesn't shift layout. */}
          {relative ? (
            <div
              className={`mt-0.5 font-mono text-[10px] text-text-4 opacity-0 transition-opacity group-hover:opacity-100 ${
                isUser ? 'text-right' : 'text-left'
              }`}
              title={message.timestamp}
            >
              {relative}
            </div>
          ) : null}
        </div>
      </div>

      {/* Rewind affordance — kept on user messages, floats on hover. */}
      {isUser && onRewind ? (
        <button
          type="button"
          disabled={!canRewind}
          onClick={() => onRewind(message)}
          className="absolute right-4 top-3 flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-1 text-[10px] text-text-3 opacity-0 transition-opacity hover:border-border-mid hover:text-text-1 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
          title={
            canRewind
              ? 'rewind the session from this message'
              : 'only available when claude is at the prompt'
          }
        >
          <RotateCcw size={11} strokeWidth={1.75} />
          rewind
        </button>
      ) : null}
    </div>
  )
}

// =============================================================================
// ChatView — scroll + composer + header; delegates per-message render to
// the inline TranscriptMessage above.
// =============================================================================

export default function ChatView({ session, visible }: Props) {
  const entry = useTranscripts((s) => s.byId[session.id])
  const refresh = useTranscripts((s) => s.refresh)
  const appendPending = useTranscripts((s) => s.appendPending)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  /** Mirrors Claude Code's effort setting. We can't read it back from
   *  the TUI, so this is the user's last explicit choice — sent via
   *  `/effort <level>` each time it changes. */
  const [effort, setEffort] = useState<Effort>('auto')
  /** Mirrors `alwaysThinkingEnabled`. Toggled by writing Alt+T to the
   *  PTY (claude's built-in keyboard shortcut for the toggle). */
  const [thinking, setThinking] = useState(false)
  /** Coarse clock tick so relative timestamps refresh without pegging
   *  the CPU. 30s is snappy enough for "just now / 2m" transitions. */
  const [nowMs, setNowMs] = useState(() => Date.now())
  const listRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastCountRef = useRef(0)

  // Initial load + refresh when session becomes visible.
  useEffect(() => {
    if (!visible) return
    void refresh(session.id)
  }, [visible, session.id, refresh])

  // Auto-scroll to bottom when new messages arrive, but only if we were
  // already near the bottom — respects the user's scroll position when
  // they're reading earlier messages.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const count = entry?.messages.length ?? 0
    if (count === lastCountRef.current) return
    lastCountRef.current = count
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160
    if (nearBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [entry?.messages.length])

  // Relative-timestamp ticker. Only runs while the view is mounted;
  // 30s cadence is invisible to the user but keeps labels fresh.
  useEffect(() => {
    if (!visible) return
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [visible])

  const submit = async (): Promise<void> => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    try {
      // Render the user message immediately — the authoritative copy from
      // claude's JSONL will replace it once the TUI writes the line. Slash
      // commands are skipped: they aren't chat turns, they'd pollute the list.
      if (!text.trimStart().startsWith('/')) {
        appendPending(session.id, text)
      }
      sendCommand(text)
      setInput('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.focus()
      }
    } finally {
      setSending(false)
    }
  }

  /** Apply an effort pick: keep local state in sync + fire the real
   *  `/effort <level>` slash command so claude actually updates its
   *  reasoning budget. */
  const onEffortChange = (next: Effort): void => {
    setEffort(next)
    sendCommand(`/effort ${next}`)
  }

  /** Toggle Claude Code's extended-thinking flag. There's no slash
   *  command for this — the TUI uses Alt+T as the keyboard shortcut.
   *  We write the raw escape sequence (ESC + 't') straight to the PTY
   *  without a trailing CR so claude consumes it as a keypress rather
   *  than a prompt line. */
  const onThinkingToggle = (): void => {
    setThinking((v) => !v)
    void window.api.pty.write(session.ptyId, '\x1bt')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter submits, Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const onRewind = (msg: TranscriptMessageT): void => {
    // Send the /rewind slash command. Claude's TUI picks the message
    // selector from the footer — the user completes the rewind there
    // (or toggles to CLI to interact). v1: we don't try to pre-fill
    // the index, since claude's rewind picker layout isn't stable
    // across versions.
    void msg // reserved for future "rewind to index N"
    sendCommand('/rewind')
  }

  /** Single point for writing commands / messages to the PTY.
   *
   *  Optimistic 'thinking' flip is intentionally skipped for slash
   *  commands: they're usually instant (settings tweaks, /clear, etc.)
   *  and never produce a "esc to interrupt" footer for the analyzer to
   *  latch onto, so flipping leaves the pill stranded in thinking
   *  forever. Real prompts get the flip — claude will start working
   *  immediately and the analyzer confirms within ~80ms. */
  const sendCommand = (raw: string): void => {
    if (!raw) return
    const isSlash = raw.trimStart().startsWith('/')
    if (!isSlash) {
      useSessions.getState().patchSession(session.id, { state: 'thinking' })
      void window.api.session.syncState(session.id, 'thinking')
    }
    void window.api.pty.write(session.ptyId, raw + '\r')
  }

  const canInteract = session.state === 'userInput' || session.state === 'idle'
  const canRewind = canInteract
  const loading = entry?.loading ?? true
  const pending = entry?.pending ?? []
  const realMessages = entry?.messages ?? []
  const messages = pending.length > 0 ? [...realMessages, ...pending] : realMessages
  const showThinking = session.state === 'thinking'

  return (
    <div className="flex h-full w-full flex-col bg-bg-0">
      {/* Toolbar: model selector + effort + thinking + commands palette + usage. */}
      <ChatToolbar
        currentModel={session.model}
        canSend={canInteract}
        onSend={sendCommand}
        effort={effort}
        onEffortChange={onEffortChange}
        thinking={thinking}
        onThinkingToggle={onThinkingToggle}
        rightChildren={
          <>
            <span className="text-text-4">{messages.length} msgs</span>
            <span className="flex items-center gap-1">
              <span className="text-text-4">↓</span>
              {formatTokens(session.tokensIn)}
            </span>
            <span className="flex items-center gap-1">
              <span className="text-text-4">↑</span>
              {formatTokens(session.tokensOut)}
            </span>
          </>
        }
      />

      {/* Messages */}
      <div ref={listRef} className="df-scroll min-h-0 flex-1 overflow-y-auto">
        {loading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-text-3">
            <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
            loading transcript…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="text-sm text-text-2">no messages yet</div>
            <div className="max-w-xs text-xs text-text-3">
              send your first prompt below — claude's response will stream in here.
            </div>
          </div>
        ) : (
          <div className="py-2">
            {messages.map((msg, i) => {
              const prev = i > 0 ? messages[i - 1] : undefined
              return (
                <TranscriptMessage
                  key={msg.uuid ?? msg.index}
                  message={msg}
                  session={session}
                  prevRole={prev?.role}
                  nowMs={nowMs}
                  onRewind={onRewind}
                  canRewind={canRewind}
                />
              )
            })}
            {showThinking ? (
              <div className="flex items-center gap-2 px-4 py-3 text-xs text-text-3">
                <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                <span className="font-mono">claude is thinking…</span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border-soft bg-bg-1 p-3">
        <div
          className="flex items-end gap-2 border border-border-soft bg-bg-2 px-2.5 py-2 focus-within:border-accent-500/60"
          style={{ borderRadius: 'var(--radius-sm)' }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={canRewind ? 'ask claude anything…' : 'claude is working — message queued on send'}
            rows={1}
            className="df-scroll min-h-[20px] flex-1 resize-none bg-transparent font-mono text-[13px] leading-relaxed text-text-1 placeholder:text-text-4 focus:outline-none"
            style={{ maxHeight: '240px' }}
            onInput={(e) => {
              // Auto-grow up to max-height. Resets first so shrink works.
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(240, el.scrollHeight) + 'px'
            }}
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={input.trim().length === 0 || sending}
            className="flex h-7 items-center gap-1 rounded-sm bg-accent-500 px-2.5 text-xs font-semibold text-white hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="send (enter)"
          >
            {sending ? (
              <Loader2 size={12} strokeWidth={2} className="animate-spin" />
            ) : (
              <Send size={12} strokeWidth={2} />
            )}
            send
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-0.5 font-mono text-[10px] text-text-4">
          <span>enter to send · shift+enter newline</span>
          <span>{input.length ? `${input.length} chars` : ''}</span>
        </div>
      </div>
    </div>
  )
}
