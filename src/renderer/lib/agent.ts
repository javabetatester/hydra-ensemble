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
