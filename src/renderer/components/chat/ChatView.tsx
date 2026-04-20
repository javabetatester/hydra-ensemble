import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, Coins } from 'lucide-react'
import type { SessionMeta, TranscriptMessage } from '../../../shared/types'
import { useTranscripts } from '../../state/transcripts'
import { useSessions } from '../../state/sessions'
import ChatMessage from './ChatMessage'
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

export default function ChatView({ session, visible }: Props) {
  const entry = useTranscripts((s) => s.byId[session.id])
  const refresh = useTranscripts((s) => s.refresh)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  /** Mirrors Claude Code's effort setting. We can't read it back from
   *  the TUI, so this is the user's last explicit choice — sent via
   *  `/effort <level>` each time it changes. */
  const [effort, setEffort] = useState<Effort>('auto')
  /** Mirrors `alwaysThinkingEnabled`. Toggled by writing Alt+T to the
   *  PTY (claude's built-in keyboard shortcut for the toggle). */
  const [thinking, setThinking] = useState(false)
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

  const submit = async (): Promise<void> => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    try {
      // Write text + CR to the PTY. Claude's TUI captures the line and
      // sends it as a user message, which then lands in the JSONL →
      // transcriptChanged event → re-renders this list. sendCommand
      // also optimistically flips the state pill to 'thinking' for
      // real prompts (not slash commands).
      sendCommand(text)
      setInput('')
      // Reset auto-grown textarea height and keep focus for continued typing.
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

  const onRewind = (msg: TranscriptMessage): void => {
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
  const messages = entry?.messages ?? []

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
            {typeof session.cost === 'number' ? (
              <span className="flex items-center gap-1 text-status-input">
                <Coins size={11} strokeWidth={1.75} />${session.cost.toFixed(2)}
              </span>
            ) : null}
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
            {messages.map((msg) => (
              <ChatMessage
                key={msg.uuid ?? msg.index}
                message={msg}
                onRewind={onRewind}
                canRewind={canRewind}
              />
            ))}
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
