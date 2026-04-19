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
 * NFT avatar gallery — Bored Ape Yacht Club via the public IPFS gateway.
 * The full collection lives at ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/N
 * (N = 0..9999, no extension). We curate 36 visually distinct apes here.
 *
 * Falls back to the deterministic emoji if the gateway image fails to load
 * (offline, gateway down, network filtered) — see AgentAvatar.
 */
const APE_IDS = [
  1, 7, 23, 44, 88, 109, 173, 232, 277, 318,
  391, 420, 555, 612, 699, 777, 821, 888, 999, 1234,
  1547, 1888, 2087, 2333, 2580, 2918, 3100, 3456, 3789, 4242,
  4567, 5000, 6529, 7777, 8888, 9420
]

const APE_GATEWAYS = [
  'https://ipfs.io/ipfs/QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq',
  'https://cloudflare-ipfs.com/ipfs/QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq',
  'https://gateway.pinata.cloud/ipfs/QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq'
]

export const NFT_APE_URLS: readonly string[] = APE_IDS.map(
  (id) => `${APE_GATEWAYS[0]}/${id}`
)

/** Alternate gateways for the same id, for fallback chain. */
export function apeGatewayChain(url: string): string[] {
  for (const gw of APE_GATEWAYS) {
    if (url.startsWith(gw)) {
      const id = url.slice(gw.length + 1)
      return APE_GATEWAYS.map((g) => `${g}/${id}`)
    }
  }
  return [url]
}

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
