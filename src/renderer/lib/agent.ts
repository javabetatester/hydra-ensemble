// Deterministic defaults for agent visual identity.
// Each session gets a stable emoji + accent color derived from its id,
// so re-renders never reshuffle the look.

export const AGENT_EMOJIS = [
  '🦊', '🦁', '🐺', '🦅', '🦉', '🦋', '🦄', '🐉',
  '🦖', '🦈', '🦦', '🦔', '🦝', '🐳', '🤖', '👾',
  '🛸', '⚡', '🔥', '✨', '💫', '🌙', '🎯', '🎲',
  '🧩', '🎭', '🎨', '🎪', '🌵', '🍀', '🍄', '🪐',
  '🪲', '🌶️', '🪻', '🐚', '🪨', '🗿', '🪬', '🎴'
] as const

export const AGENT_COLORS = [
  '#ff6b4d', '#fbbf24', '#2ecc71', '#4ea5ff',
  '#c084fc', '#ec4899', '#14b8a6', '#f97316',
  '#a78bfa', '#f43f5e', '#84cc16', '#06b6d4',
  '#eab308', '#8b5cf6', '#10b981', '#3b82f6'
] as const

/**
 * NFT-style avatar gallery — dicebear `pixel-art` style.
 *
 * dicebear is a free, CC0, deterministic avatar API. The pixel-art style
 * generates 8-bit characters (face, hat, glasses, clothes) that hit the
 * cryptopunks/NFT vibe without depending on a flaky IPFS gateway.
 *
 * Each seed produces a stable unique character. SVG so it scales crisp.
 * Falls back to the deterministic emoji if the request fails (offline,
 * filtered) — see AgentAvatar.
 */
const NFT_AVATAR_SEEDS = [
  'spectre', 'oracle', 'phantom', 'cipher', 'nexus', 'vortex', 'genesis', 'echo',
  'zenith', 'pulse', 'lucid', 'haven', 'odyssey', 'mirage', 'prism', 'helix',
  'quantum', 'titan', 'stellar', 'comet', 'apex', 'storm', 'shadow', 'flame',
  'frost', 'aurora', 'nova', 'rift', 'glyph', 'rune', 'tide', 'arc',
  'zen', 'orbit', 'flux', 'core', 'pixel', 'spark', 'wave', 'spire'
]

const DICEBEAR_BASE = 'https://api.dicebear.com/9.x/pixel-art/svg'

export const NFT_AVATAR_URLS: readonly string[] = NFT_AVATAR_SEEDS.map(
  (seed) => `${DICEBEAR_BASE}?seed=${encodeURIComponent(seed)}&radius=10`
)

/** Backwards-compat alias used by the picker in AgentEditDialog. */
export const NFT_APE_URLS = NFT_AVATAR_URLS

/**
 * Fallback chain for an avatar URL. dicebear is a single CDN, so the chain
 * is just the URL itself — kept as a function so AgentAvatar can later add
 * mirrors without changing call sites.
 */
export function avatarFallbackChain(url: string): string[] {
  return [url]
}

/** @deprecated kept for older imports — same as avatarFallbackChain. */
export const apeGatewayChain = avatarFallbackChain

/** Detect whether an avatar string is a URL (image) vs an emoji. */
export function isAvatarUrl(avatar: string | undefined): boolean {
  if (!avatar) return false
  return avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('data:')
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function defaultAgentEmoji(seed: string): string {
  const idx = hashStr(seed) % AGENT_EMOJIS.length
  return AGENT_EMOJIS[idx] ?? '🤖'
}

export function defaultAgentColor(seed: string): string {
  const idx = hashStr(seed + '-color') % AGENT_COLORS.length
  return AGENT_COLORS[idx] ?? '#ff6b4d'
}

/** Lighten/dim a hex color for ring/background use. */
export function hexAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `${hex}${a}`
}
