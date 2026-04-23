import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Search } from 'lucide-react'
import { useEditor } from '../../state/editor'
import { useEditorTabs } from '../../state/editorTabs'

interface Props {
  open: boolean
  onClose: () => void
}

interface Symbol {
  name: string
  line: number
  kind: string
  preview: string
}

interface ScoredSymbol extends Symbol {
  score: number
  /** Index ranges within `name` that matched — used to bold substrings. */
  hits: Array<[number, number]>
}

/**
 * Language-agnostic declaration regex. Matches the five most common
 * top-level declarations across TS/JS/Go/Rust-ish syntaxes:
 *   function X, class X, const X, let X, var X, interface X, type X, enum X
 * Optionally prefixed by `export` and/or `async`. Anchored to line start
 * so we don't pick up matches nested inside comments or strings on the
 * same line (close-enough heuristic; a proper parser per language would
 * be heavy for what's effectively a fast-navigation aid).
 */
const SYMBOL_RE = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/gm

/** Subsequence fuzzy score. Returns null if `query` isn't a subsequence
 *  of `name`. Bonuses for prefix match, word-boundary hits, and a dense
 *  consecutive run. */
function scoreName(
  name: string,
  query: string
): { score: number; hits: Array<[number, number]> } | null {
  if (!query) return { score: 0, hits: [] }
  const n = name.toLowerCase()
  const q = query.toLowerCase()
  const hits: Array<[number, number]> = []
  let qi = 0
  let lastMatch = -2
  let score = 0
  let runStart = -1
  for (let i = 0; i < n.length && qi < q.length; i++) {
    const ch = n.charAt(i)
    const target = q.charAt(qi)
    if (ch === target) {
      // Bonuses.
      const prev = i > 0 ? n.charAt(i - 1) : ''
      const rawCh = name.charAt(i)
      if (i === 0) score += 20
      else if (!/[a-z0-9]/.test(prev)) score += 10 // word boundary
      else if (rawCh !== rawCh.toLowerCase()) score += 8 // camelCase
      if (lastMatch === i - 1) score += 5 // consecutive
      if (runStart === -1) runStart = i
      // Extend the last hit range if contiguous, else open a new one.
      const last = hits[hits.length - 1]
      if (last && last[1] === i) last[1] = i + 1
      else hits.push([i, i + 1])
      lastMatch = i
      qi++
    } else if (runStart !== -1) {
      runStart = -1
    }
  }
  if (qi < q.length) return null
  // Shorter names rank higher for the same query coverage.
  score += Math.max(0, 40 - name.length)
  // Exact-prefix shortcut dominates everything else.
  if (n.startsWith(q)) score += 50
  return { score, hits }
}

/** Parse `content` for top-level declarations. Returns them in source
 *  order so ties in score fall back to file order — the more intuitive
 *  behaviour when the query is empty. */
function extractSymbols(content: string): Symbol[] {
  const out: Symbol[] = []
  const re = new RegExp(SYMBOL_RE.source, SYMBOL_RE.flags)
  // Precompute line starts so we can map each match offset -> line in
  // O(log n) rather than re-scanning the file for every match.
  const lineStarts: number[] = [0]
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lineStarts.push(i + 1)
  }
  const lineAt = (offset: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      const start = lineStarts[mid] ?? 0
      if (start <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    const name = m[1]
    if (!name) continue
    const lineNo = lineAt(m.index)
    const lineEnd = content.indexOf('\n', m.index)
    const preview = content.slice(m.index, lineEnd < 0 ? content.length : lineEnd).trim()
    // Best-effort kind classification by scanning the match text for the
    // keyword we hit. Avoids a second regex.
    const kindMatch = /(function|class|const|let|var|interface|type|enum)/.exec(m[0])
    out.push({
      name,
      line: lineNo,
      kind: kindMatch?.[1] ?? 'symbol',
      preview
    })
  }
  return out
}

/** Render `name` with `hits` ranges bolded. Falls back to the raw string
 *  when there are no hits (empty-query / no-match listing mode). */
function Highlighted({
  text,
  hits
}: {
  text: string
  hits: Array<[number, number]>
}) {
  if (hits.length === 0) return <>{text}</>
  const out: React.ReactNode[] = []
  let cursor = 0
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]
    if (!hit) continue
    const [s, e] = hit
    if (s > cursor) out.push(<span key={`p${i}`}>{text.slice(cursor, s)}</span>)
    out.push(
      <span key={`h${i}`} className="font-semibold text-accent-400">
        {text.slice(s, e)}
      </span>
    )
    cursor = e
  }
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>)
  return <>{out}</>
}

/**
 * Modal palette for jumping to any top-level declaration in the currently
 * active file. Reads the file content via the IPC editor bridge (rather
 * than scraping the live CodeMirror buffer) so the palette works even
 * when the buffer isn't mounted — e.g. when the user is staring at a diff
 * tab but the file itself is the active tab in `useEditorTabs`.
 *
 * Activation is driven by the `open` prop (controlled by the caller,
 * same pattern as SpotlightSearch). On Enter we dispatch
 * `editor:jump-to-line` with `{ path, line }` on window; a listener in
 * CodeMirrorView (or wherever the caller owns the editor view) picks
 * that up and moves the cursor.
 */
export default function JumpToSymbol({ open, onClose }: Props) {
  // Prefer useEditor's activeFilePath when it's set (that's the buffer
  // actually showing in CodeMirror). Fall back to the tabs store so the
  // palette still works on boot — before the buffer has been hydrated
  // from disk — or when the user hasn't opened the editor view yet.
  const editorActive = useEditor((s) => s.activeFilePath)
  const tabsActive = useEditorTabs((s) => s.activePath)
  const path = editorActive ?? tabsActive

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Guards against out-of-order readFile responses when the user flips
  // active file in the middle of a fetch.
  const runId = useRef(0)

  // Reset + fetch whenever the palette opens or the active path flips.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    setError(null)
    queueMicrotask(() => inputRef.current?.focus())
    if (!path) {
      setContent(null)
      return
    }
    const id = ++runId.current
    setLoading(true)
    void window.api.editor
      .readFile(path)
      .then((file) => {
        if (id !== runId.current) return
        if (file.encoding !== 'utf-8') {
          setContent(null)
          setError('Binary file — nothing to index')
          return
        }
        setContent(file.bytes)
      })
      .catch((err: Error) => {
        if (id !== runId.current) return
        setContent(null)
        setError(err.message)
      })
      .finally(() => {
        if (id === runId.current) setLoading(false)
      })
  }, [open, path])

  // Close on Escape. Separate effect so it only runs while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const symbols = useMemo(() => (content ? extractSymbols(content) : []), [content])

  const ranked = useMemo<ScoredSymbol[]>(() => {
    const q = query.trim()
    if (!q) {
      // Empty query: show everything in source order.
      return symbols.map((s) => ({ ...s, score: 0, hits: [] }))
    }
    const out: ScoredSymbol[] = []
    for (const sym of symbols) {
      const sc = scoreName(sym.name, q)
      if (!sc) continue
      out.push({ ...sym, score: sc.score, hits: sc.hits })
    }
    // Higher score first; stable on equal scores so file order wins ties.
    out.sort((a, b) => b.score - a.score)
    return out
  }, [symbols, query])

  // Clamp cursor whenever the result list changes.
  useEffect(() => {
    if (cursor >= ranked.length) setCursor(0)
  }, [ranked.length, cursor])

  // Keep the highlighted row visible as the cursor moves off-screen via
  // keyboard navigation. Native scrollIntoView suffices — no need for
  // virtualization at typical file sizes.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-jump-idx="${cursor}"]`
    )
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const activate = (sym: ScoredSymbol): void => {
    if (!path) return
    window.dispatchEvent(
      new CustomEvent('editor:jump-to-line', { detail: { path, line: sym.line } })
    )
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(ranked.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = ranked[cursor]
      if (target) activate(target)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[210] flex items-start justify-center bg-black/55 px-4 pt-[18vh] backdrop-blur-md df-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Jump to symbol"
    >
      <div
        className="flex w-full max-w-[640px] flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border-soft bg-bg-1 px-4 py-3">
          <Search size={18} strokeWidth={1.75} className="shrink-0 text-text-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            placeholder={path ? 'Jump to symbol…' : 'No active file'}
            disabled={!path}
            className="flex-1 bg-transparent text-base text-text-1 placeholder:text-text-4 focus:outline-none disabled:opacity-50"
            spellCheck={false}
            autoComplete="off"
          />
          {loading ? (
            <span className="font-mono text-[10px] text-text-4">loading…</span>
          ) : null}
          <span className="shrink-0 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] text-text-4">
            esc
          </span>
        </div>

        <div ref={listRef} className="df-scroll max-h-[58vh] overflow-y-auto">
          {!path ? (
            <div className="px-4 py-10 text-center text-sm text-text-4">
              Open a file first.
            </div>
          ) : error ? (
            <div className="px-4 py-10 text-center text-sm text-status-attention">
              {error}
            </div>
          ) : loading && ranked.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-4">Indexing…</div>
          ) : ranked.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-4">
              {query.trim() ? 'No matching symbols' : 'No symbols found in this file'}
            </div>
          ) : (
            ranked.map((sym, idx) => {
              const active = idx === cursor
              return (
                <button
                  key={`${sym.name}:${sym.line}`}
                  type="button"
                  data-jump-idx={idx}
                  onClick={() => activate(sym)}
                  onMouseEnter={() => setCursor(idx)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                    active ? 'bg-bg-4 text-text-1' : 'text-text-2 hover:bg-bg-3'
                  }`}
                >
                  <FileText
                    size={14}
                    strokeWidth={1.75}
                    className="shrink-0 text-text-4"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm">
                      <Highlighted text={sym.name} hits={sym.hits} />
                    </div>
                    <div className="truncate font-mono text-[11px] text-text-4">
                      {sym.preview}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-4">
                    {sym.kind}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-text-4">
                    :{sym.line}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border-soft bg-bg-1 px-3 py-1.5 font-mono text-[10px] text-text-4">
          <span>↑↓ navigate · ↵ jump · esc close</span>
          <span>{ranked.length} symbols</span>
        </div>
      </div>
    </div>
  )
}
