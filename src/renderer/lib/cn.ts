/**
 * Minimal `cn` / `clsx` helper. Zero deps.
 *
 * Accepts strings, numbers, arrays (nested to any depth), and objects
 * (keys are included when the value is truthy). Falsy scalars are skipped.
 * The resulting class list is trimmed, whitespace-collapsed, and has
 * duplicate tokens removed (first occurrence wins).
 */
export type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | Record<string, unknown>
  | ClassValue[]

function collect(value: ClassValue, out: string[]): void {
  if (value === null || value === undefined || value === false) return
  if (typeof value === 'string') {
    if (value.length === 0) return
    for (const token of value.split(/\s+/)) {
      if (token.length > 0) out.push(token)
    }
    return
  }
  if (typeof value === 'number') {
    // Skip NaN; include every other finite/infinite number (including 0).
    if (Number.isNaN(value)) return
    out.push(String(value))
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out)
    return
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if ((value as Record<string, unknown>)[key]) out.push(key)
    }
  }
}

export function cn(...parts: ClassValue[]): string {
  const tokens: string[] = []
  for (const part of parts) collect(part, tokens)
  if (tokens.length === 0) return ''
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const token of tokens) {
    if (seen.has(token)) continue
    seen.add(token)
    deduped.push(token)
  }
  return deduped.join(' ')
}
