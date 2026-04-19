import { useEffect, useState } from 'react'
import type { SessionMeta } from '../../shared/types'
import {
  apeGatewayChain,
  defaultAgentColor,
  defaultAgentEmoji,
  hexAlpha,
  isAvatarUrl
} from '../lib/agent'

interface Props {
  session: Pick<SessionMeta, 'id' | 'avatar' | 'accentColor'>
  size?: number
  ring?: boolean
}

export default function AgentAvatar({ session, size = 28, ring = true }: Props) {
  const color = session.accentColor || defaultAgentColor(session.id)
  const isUrl = isAvatarUrl(session.avatar)
  const fallbackEmoji = defaultAgentEmoji(session.id)

  // Try the requested URL first, then alternate IPFS gateways, then give
  // up and fall through to the emoji. Resets whenever the avatar changes.
  const initialChain = isUrl && session.avatar ? apeGatewayChain(session.avatar) : []
  const [chainIdx, setChainIdx] = useState(0)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setChainIdx(0)
    setImageFailed(false)
  }, [session.avatar])

  const showImage = isUrl && !imageFailed && initialChain.length > 0
  const currentSrc = showImage ? initialChain[chainIdx] : null

  return (
    <div
      className="relative flex shrink-0 select-none items-center justify-center overflow-hidden"
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
      {currentSrc ? (
        <img
          key={currentSrc}
          src={currentSrc}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => {
            const next = chainIdx + 1
            if (next < initialChain.length) {
              setChainIdx(next)
            } else {
              setImageFailed(true)
            }
          }}
          style={{
            width: size,
            height: size,
            objectFit: 'cover',
            display: 'block'
          }}
        />
      ) : (
        <span
          style={{
            filter: `drop-shadow(0 0 6px ${hexAlpha(color, 0.45)})`
          }}
        >
          {session.avatar && !isUrl ? session.avatar : fallbackEmoji}
        </span>
      )}
    </div>
  )
}
