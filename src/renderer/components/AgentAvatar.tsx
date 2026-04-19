import type { SessionMeta } from '../../shared/types'
import { defaultAgentColor, defaultAgentEmoji, hexAlpha } from '../lib/agent'

interface Props {
  session: Pick<SessionMeta, 'id' | 'avatar' | 'accentColor'>
  size?: number
  ring?: boolean
}

export default function AgentAvatar({ session, size = 28, ring = true }: Props) {
  const emoji = session.avatar || defaultAgentEmoji(session.id)
  const color = session.accentColor || defaultAgentColor(session.id)
  return (
    <div
      className="relative flex shrink-0 select-none items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-md)',
        backgroundColor: hexAlpha(color, 0.12),
        boxShadow: ring ? `inset 0 0 0 1px ${hexAlpha(color, 0.45)}` : undefined,
        fontSize: Math.round(size * 0.55),
        lineHeight: 1
      }}
      aria-hidden
    >
      <span
        style={{
          filter: `drop-shadow(0 0 6px ${hexAlpha(color, 0.45)})`
        }}
      >
        {emoji}
      </span>
    </div>
  )
}
