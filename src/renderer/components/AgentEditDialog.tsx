import { useEffect, useRef, useState } from 'react'
import { X, Check, Shuffle, MessageSquare, TerminalSquare } from 'lucide-react'
import type { SessionMeta, SessionViewMode } from '../../shared/types'
import { useSessions } from '../state/sessions'
import {
  AGENT_COLORS,
  NFT_AVATAR_URLS,
  defaultAgentAvatar,
  defaultAgentColor,
  hexAlpha
} from '../lib/agent'
import AgentAvatar from './AgentAvatar'

interface Props {
  session: SessionMeta | null
  onClose: () => void
}

export default function AgentEditDialog({ session, onClose }: Props) {
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<string>('')
  const [accentColor, setAccentColor] = useState<string>('')
  const [description, setDescription] = useState('')
  const [viewMode, setViewMode] = useState<SessionViewMode>('cli')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!session) return
    setName(session.name)
    setAvatar(session.avatar || defaultAgentAvatar(session.id))
    setAccentColor(session.accentColor || defaultAgentColor(session.id))
    setDescription(session.description ?? '')
    setViewMode(session.viewMode ?? 'cli')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [session])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!session) return null

  const submit = async (): Promise<void> => {
    await window.api.session.update(session.id, {
      name: name.trim() || session.name,
      avatar,
      accentColor,
      description: description.trim(),
      viewMode
    })
    // Reflect the new view mode locally so the session pane re-renders
    // into the chosen layout without waiting for the persisted change
    // to round-trip through `session:changed`.
    useSessions.getState().patchSession(session.id, { viewMode })
    onClose()
  }

  const reroll = (): void => {
    const seed = `${session.id}-${Date.now()}`
    setAvatar(defaultAgentAvatar(seed))
    setAccentColor(defaultAgentColor(seed))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-0/85 px-4 backdrop-blur-md df-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="df-label">edit agent</span>
            <span className="font-mono text-[10px] text-text-4">/{session.id.slice(0, 8)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="close"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* preview */}
          <div className="flex items-center gap-3 rounded-md border border-border-soft bg-bg-3 px-3 py-2.5">
            <AgentAvatar session={{ id: session.id, avatar, accentColor }} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text-1">
                {name || 'unnamed agent'}
              </div>
              {description ? (
                <div className="truncate font-mono text-[11px] text-text-3">
                  {description}
                </div>
              ) : (
                <div className="font-mono text-[11px] text-text-4">
                  {session.branch ?? 'no branch'} · {session.model ?? 'sonnet'}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={reroll}
              className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-2 py-1 text-[11px] text-text-3 hover:border-border-mid hover:text-text-1"
              title="randomize avatar + color"
            >
              <Shuffle size={11} strokeWidth={1.75} />
              <span>roll</span>
            </button>
          </div>

          {/* name */}
          <div>
            <label className="df-label mb-1.5 block">name</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              placeholder="session-1"
              className="w-full rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 font-mono text-sm text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
            />
          </div>

          {/* description */}
          <div>
            <label className="df-label mb-1.5 block">role / focus (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              placeholder="e.g. fixing the auth bug"
              className="w-full rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 text-sm text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
            />
          </div>

          {/* avatar — emoji or NFT ape */}
          <AvatarPicker avatar={avatar} onPick={setAvatar} />

          {/* color grid */}
          <div>
            <label className="df-label mb-1.5 block">accent color</label>
            <div className="grid grid-cols-8 gap-1.5">
              {AGENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccentColor(c)}
                  className={`h-6 w-full rounded-sm transition ${
                    accentColor === c ? 'ring-2 ring-text-1 ring-offset-2 ring-offset-bg-2' : ''
                  }`}
                  style={{ backgroundColor: c, boxShadow: `inset 0 0 0 1px ${hexAlpha(c, 0.6)}` }}
                  aria-label={`accent ${c}`}
                />
              ))}
            </div>
          </div>

          {/* view mode */}
          <div>
            <label className="df-label mb-1.5 block">view</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setViewMode('cli')}
                className={`flex items-center gap-2 rounded-sm border px-2.5 py-2 text-left transition ${
                  viewMode === 'cli'
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-border-soft bg-bg-1 hover:border-border-mid hover:bg-bg-3'
                }`}
              >
                <TerminalSquare
                  size={14}
                  strokeWidth={1.75}
                  className={viewMode === 'cli' ? 'text-accent-400' : 'text-text-3'}
                />
                <span className="text-xs text-text-1">cli</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('visual')}
                className={`flex items-center gap-2 rounded-sm border px-2.5 py-2 text-left transition ${
                  viewMode === 'visual'
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-border-soft bg-bg-1 hover:border-border-mid hover:bg-bg-3'
                }`}
              >
                <MessageSquare
                  size={14}
                  strokeWidth={1.75}
                  className={viewMode === 'visual' ? 'text-accent-400' : 'text-text-3'}
                />
                <span className="text-xs text-text-1">visual</span>
              </button>
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border-soft bg-bg-1 px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-border-soft px-3 py-1.5 text-xs text-text-2 hover:border-border-mid hover:bg-bg-3"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            className="flex items-center gap-1.5 rounded-sm bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600"
          >
            <Check size={12} strokeWidth={2.25} />
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function AvatarPicker({
  avatar,
  onPick
}: {
  avatar: string
  onPick: (next: string) => void
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="df-label">avatar</label>
        <span className="font-mono text-[10px] text-text-4">
          {NFT_AVATAR_URLS.length} characters
        </span>
      </div>
      <div className="df-scroll grid max-h-56 grid-cols-9 gap-1 overflow-y-auto rounded-sm border border-border-soft bg-bg-1 p-1.5">
        {NFT_AVATAR_URLS.map((url) => {
          const selected = avatar === url
          return (
            <button
              key={url}
              type="button"
              onClick={() => onPick(url)}
              className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-sm transition ${
                selected
                  ? 'ring-2 ring-inset ring-accent-500'
                  : 'opacity-80 hover:opacity-100 ring-1 ring-inset ring-border-soft'
              }`}
              aria-label={`nft avatar ${url}`}
              title={url}
            >
              <img
                src={url}
                alt=""
                loading="lazy"
                width={36}
                height={36}
                style={{ width: 36, height: 36, objectFit: 'cover' }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
