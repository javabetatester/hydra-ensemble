import { useMemo, useState } from 'react'
import {
  RotateCcw,
  Info,
  Brain,
  ChevronDown,
  ChevronRight,
  Copy,
  Check
} from 'lucide-react'
import type {
  SessionMeta,
  TranscriptBlock,
  TranscriptMessage as TranscriptMessageT
} from '../../../shared/types'
import ChatMarkdown from './ChatMarkdown'
import { ToolUseBlock, ToolResultBlock } from './ChatToolBlock'

/** Pair each tool_use with the tool_result(s) that reference its id so
 *  the arg card and result render as a single visual unit. Out-of-order
 *  orphans fall through as standalone result cards. */
interface GroupedBlock {
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result'
  block: TranscriptBlock
  results: Extract<TranscriptBlock, { kind: 'tool_result' }>[]
}

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
      out.push({ kind: 'tool_result', block: b, results: [] })
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

function initialFor(role: 'user' | 'assistant' | 'system', sessionName?: string): string {
  if (role === 'user') return 'U'
  if (role === 'system') return 'S'
  const name = (sessionName ?? '').trim()
  if (name.length === 0) return 'C'
  const ch = name.charAt(0)
  return /[\p{L}\p{N}]/u.test(ch) ? ch.toUpperCase() : 'C'
}

function avatarTextOn(accent: string | undefined): string {
  if (!accent) return '#fff'
  const hex = accent.replace('#', '')
  if (hex.length !== 6) return '#fff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return '#fff'
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return l > 0.6 ? '#0b0b0d' : '#fff'
}

/** Rough reading-time for a thinking preview: ~200 chars/s ≈ natural
 *  reading + a small floor so short thoughts don't read as "0s". */
function estimateThinkingSeconds(text: string): number {
  const chars = text.length
  if (chars === 0) return 1
  const seconds = Math.max(1, Math.round(chars / 200))
  return seconds
}

/** Plain-text assistant content for the hover copy button — skips
 *  tool frames entirely, joins text/thinking segments with newlines. */
function plainTextOf(message: TranscriptMessageT): string {
  const parts: string[] = []
  for (const b of message.blocks) {
    if (b.kind === 'text' || b.kind === 'thinking') {
      if (b.text) parts.push(b.text)
    }
  }
  return parts.join('\n\n').trim()
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const seconds = estimateThinkingSeconds(text)
  const preview = text.split('\n').find((l) => l.trim().length > 0)?.slice(0, 160) ?? ''

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
        <span className="font-semibold">Thought for {seconds}s</span>
        {!open && preview ? (
          <span className="truncate italic text-text-4">{preview}</span>
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

interface Props {
  message: TranscriptMessageT
  session: SessionMeta
  /** Previous message's role — drives consecutive-author grouping. */
  prevRole?: TranscriptMessageT['role']
  /** Fires when the user asks to rewind from this message. */
  onRewind?: (message: TranscriptMessageT) => void
  /** Rewind control disabled until claude is at the input prompt. */
  canRewind?: boolean
}

export default function ChatMessage({
  message,
  session,
  prevRole,
  onRewind,
  canRewind
}: Props) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  // System messages: centred subtle pill. Unchanged from the old
  // design — they're not real turns and shouldn't look like bubbles.
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
          <span>system</span>
          {preview ? <span className="truncate">{preview}</span> : null}
        </div>
      </div>
    )
  }

  const sameAuthorAsPrev = prevRole === message.role
  const topPadding = sameAuthorAsPrev ? 'pt-1' : 'pt-4'
  const grouped = useMemo(() => groupBlocks(message.blocks), [message.blocks])
  const accent = session.accentColor ?? '#7aa2f7'
  const initial = initialFor(message.role, session.name)
  const avatarFg = avatarTextOn(accent)

  const avatar = (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center text-[12px] font-semibold"
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

  const bubbleBase =
    'min-w-0 max-w-[78%] space-y-2 border px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap'
  const bubbleRole = isUser
    ? 'bg-accent-500/15 border-accent-500/30 text-text-1'
    : 'bg-bg-2 border-border-soft text-text-1'

  const copyMessage = async (): Promise<void> => {
    const text = plainTextOf(message)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard may be blocked — no-op. */
    }
  }

  return (
    <div className={`group relative px-4 ${topPadding} pb-1`}>
      <div
        className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      >
        {avatar}

        <div
          className={`flex min-w-0 flex-1 flex-col ${isUser ? 'items-end' : 'items-start'}`}
        >
          {/* Author header — only on the first message in a run. */}
          {!sameAuthorAsPrev ? (
            <div
              className={`mb-1 flex items-baseline gap-2 text-[11px] ${
                isUser ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              <span className="font-semibold text-text-1">
                {isUser ? 'you' : session.name || 'claude'}
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
              if (g.kind === 'tool_use') {
                return (
                  <ToolUseBlock
                    key={key}
                    block={g.block as Extract<TranscriptBlock, { kind: 'tool_use' }>}
                    results={g.results}
                  />
                )
              }
              // Orphan tool_result (parent tool_use not in this message).
              if (g.kind === 'tool_result') {
                return (
                  <ToolResultBlock
                    key={key}
                    block={g.block as Extract<TranscriptBlock, { kind: 'tool_result' }>}
                  />
                )
              }
              return null
            })}
          </div>

          {/* Assistant hover actions: copy text. Sits beneath the
              bubble so width changes don't reshuffle the layout. */}
          {!isUser ? (
            <div className="df-hover-reveal mt-1 flex h-5 items-center gap-1 group-hover:opacity-100">
              <button
                type="button"
                onClick={copyMessage}
                className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-text-4 hover:bg-bg-2 hover:text-text-1"
                title={copied ? 'copied' : 'copy message'}
              >
                {copied ? (
                  <>
                    <Check size={10} strokeWidth={2} className="text-accent-400" />
                    copied
                  </>
                ) : (
                  <>
                    <Copy size={10} strokeWidth={1.75} />
                    copy
                  </>
                )}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Rewind affordance — user messages only, floats in on hover. */}
      {isUser && onRewind ? (
        <button
          type="button"
          disabled={!canRewind}
          onClick={() => onRewind(message)}
          className="df-hover-reveal absolute right-4 top-3 flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-1 text-[10px] text-text-3 hover:border-border-mid hover:text-text-1 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
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
