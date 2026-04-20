import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Loader2,
  Regex,
  Replace as ReplaceIcon,
  Search as SearchIcon,
  WholeWord,
  X,
} from 'lucide-react'
import type { FindInFilesMatch } from '../../../shared/types'

interface Props {
  cwd: string | null
  /** Fired when the user clicks a result so the shell can open the file. */
  onOpenMatch: (filePath: string) => void
  /** Prefill the query when the panel is opened fresh (e.g. from Ctrl+Shift+F
   *  with a selection under the cursor). */
  initialQuery?: string
  /** Bump this to refocus the input when re-triggered by the keybind. */
  focusNonce?: number
}

interface FileGroup {
  file: string
  matches: { line: number; text: string }[]
}

/**
 * Sidebar pane for cross-file search. Debounces the query (250 ms) to
 * avoid firing a grep on every keystroke. Uses the main-process
 * find-in-files bridge (`git grep` when the cwd is a repo, plain grep
 * otherwise). Results are grouped by file and each row opens the file.
 */
export default function SearchPanel({ cwd, onOpenMatch, initialQuery, focusNonce }: Props) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)

  const [matches, setMatches] = useState<FindInFilesMatch[]>([])
  const [truncated, setTruncated] = useState(false)
  const [tool, setTool] = useState<'git grep' | 'grep' | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  // Replace-in-files surface — toggle the pane with the chevron on the
  // left of the query input, VS Code-style. Keeps the search pane simple
  // until the user actually wants to substitute.
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [replaceSummary, setReplaceSummary] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const runId = useRef(0)

  // Reset results on cwd change.
  useEffect(() => {
    setMatches([])
    setTruncated(false)
    setTool(null)
    setError(null)
    setCollapsed(new Set())
  }, [cwd])

  // Focus the input when the nonce bumps (so Ctrl+Shift+F pulls focus
  // into the query even if the pane was already open).
  useEffect(() => {
    if (!inputRef.current) return
    inputRef.current.focus()
    inputRef.current.select()
  }, [focusNonce])

  // If the caller pushed an initialQuery after mount, adopt it.
  useEffect(() => {
    if (initialQuery !== undefined && initialQuery.length > 0) {
      setQuery(initialQuery)
    }
  }, [initialQuery])

  const runSearch = useCallback(async (): Promise<void> => {
    if (!cwd) return
    const q = query.trim()
    const id = ++runId.current
    if (q.length === 0) {
      setMatches([])
      setTruncated(false)
      setTool(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.editor.findInFiles(cwd, q, {
        caseSensitive,
        wholeWord,
        regex,
      })
      if (id !== runId.current) return
      if (!res.ok) {
        setError(res.error)
        setMatches([])
        setTruncated(false)
        setTool(null)
        return
      }
      setMatches(res.value.matches)
      setTruncated(res.value.truncated)
      setTool(res.value.tool)
    } catch (err) {
      if (id !== runId.current) return
      setError((err as Error).message)
    } finally {
      if (id === runId.current) setLoading(false)
    }
  }, [cwd, query, caseSensitive, wholeWord, regex])

  // Debounced run whenever the query or flags change. 250 ms is short
  // enough to feel live but long enough to skip partial typing.
  useEffect(() => {
    const t = setTimeout(() => {
      void runSearch()
    }, 250)
    return () => clearTimeout(t)
  }, [runSearch])

  const runReplaceAll = useCallback(async (): Promise<void> => {
    if (!cwd) return
    const q = query.trim()
    if (q.length === 0) return
    if (replacing) return
    const confirmMsg = `Replace all matches of "${q}" with "${replacement}" across ${matches.length} matches? This rewrites files on disk — use git to undo.`
    if (!window.confirm(confirmMsg)) return
    setReplacing(true)
    setReplaceSummary(null)
    try {
      const res = await window.api.editor.replaceInFiles(cwd, q, replacement, {
        caseSensitive,
        wholeWord,
        regex,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setReplaceSummary(
        `${res.value.replacements} replacements across ${res.value.filesChanged} file${
          res.value.filesChanged === 1 ? '' : 's'
        }`,
      )
      // Re-run search so the match list reflects the post-replace state.
      void runSearch()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setReplacing(false)
    }
  }, [cwd, query, replacement, caseSensitive, wholeWord, regex, replacing, matches.length, runSearch])

  // Group matches by file for the display.
  const groups = useMemo((): FileGroup[] => {
    const byFile = new Map<string, FileGroup>()
    for (const m of matches) {
      let g = byFile.get(m.file)
      if (!g) {
        g = { file: m.file, matches: [] }
        byFile.set(m.file, g)
      }
      g.matches.push({ line: m.line, text: m.text })
    }
    return [...byFile.values()]
  }, [matches])

  const toggleGroup = (file: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-soft bg-bg-2 px-3 py-2">
        <SearchIcon size={12} strokeWidth={1.75} className="text-accent-400" />
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-2">
          search
        </span>
        <span className="font-mono text-[10px] text-text-4">
          {loading
            ? 'searching…'
            : matches.length
              ? `${matches.length} match${matches.length === 1 ? '' : 'es'}${
                  truncated ? '+' : ''
                }`
              : ''}
        </span>
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="ml-auto rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
            title="Clear"
            aria-label="Clear search"
          >
            <X size={11} strokeWidth={1.75} />
          </button>
        ) : null}
      </header>

      {/* Query input + flag toggles — chevron on the left reveals replace */}
      <div className="flex shrink-0 flex-col gap-1 border-b border-border-soft bg-bg-2 p-2">
        <div className="flex items-start gap-1">
          <button
            type="button"
            onClick={() => setReplaceOpen((v) => !v)}
            className={`flex h-[26px] w-4 shrink-0 items-center justify-center rounded-sm transition-colors ${
              replaceOpen
                ? 'bg-accent-500/15 text-accent-200'
                : 'text-text-3 hover:bg-bg-3 hover:text-text-1'
            }`}
            title={replaceOpen ? 'Hide replace' : 'Show replace'}
            aria-label={replaceOpen ? 'Hide replace' : 'Show replace'}
            aria-expanded={replaceOpen}
          >
            {replaceOpen ? (
              <ChevronDown size={11} strokeWidth={1.75} />
            ) : (
              <ChevronRight size={11} strokeWidth={1.75} />
            )}
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center rounded-sm border border-border-soft bg-bg-1 focus-within:border-accent-500/60">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search across files"
                className="min-w-0 flex-1 bg-transparent px-2 py-1 font-mono text-[11.5px] text-text-1 placeholder:text-text-4 focus:outline-none"
              />
              <FlagBtn
                active={caseSensitive}
                onClick={() => setCaseSensitive((v) => !v)}
                title="Match case"
              >
                <CaseSensitive size={11} strokeWidth={1.75} />
              </FlagBtn>
              <FlagBtn
                active={wholeWord}
                onClick={() => setWholeWord((v) => !v)}
                title="Match whole word"
              >
                <WholeWord size={11} strokeWidth={1.75} />
              </FlagBtn>
              <FlagBtn
                active={regex}
                onClick={() => setRegex((v) => !v)}
                title="Use regular expression"
              >
                <Regex size={11} strokeWidth={1.75} />
              </FlagBtn>
            </div>
            {replaceOpen ? (
              <div className="flex min-w-0 items-center rounded-sm border border-border-soft bg-bg-1 focus-within:border-accent-500/60">
                <input
                  type="text"
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                  placeholder="Replace"
                  className="min-w-0 flex-1 bg-transparent px-2 py-1 font-mono text-[11.5px] text-text-1 placeholder:text-text-4 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void runReplaceAll()
                  }}
                />
                <button
                  type="button"
                  onClick={() => void runReplaceAll()}
                  disabled={!cwd || !query.trim() || replacing || matches.length === 0}
                  className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[10px] font-semibold text-accent-200 transition-colors hover:bg-accent-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                  title={`Replace all (${matches.length})`}
                  aria-label="Replace all"
                >
                  {replacing ? (
                    <Loader2 size={11} strokeWidth={1.75} className="animate-spin" />
                  ) : (
                    <ReplaceIcon size={11} strokeWidth={1.75} />
                  )}
                  <span>all</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {replaceSummary ? (
          <div className="px-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-status-generating">
            ✓ {replaceSummary}
          </div>
        ) : null}
        {tool ? (
          <div className="px-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-4">
            via {tool}
            {truncated ? ' · results capped' : null}
          </div>
        ) : null}
      </div>

      {/* Results */}
      <div className="df-scroll min-h-0 flex-1 overflow-y-auto">
        {!cwd ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <SearchIcon size={22} strokeWidth={1.25} className="text-text-4" />
            <div className="text-xs text-text-2">no active session</div>
            <div className="text-[11px] text-text-4">
              open a session to search inside its worktree.
            </div>
          </div>
        ) : loading && matches.length === 0 ? (
          <div className="flex items-center gap-1.5 px-3 py-3 text-[11px] text-text-3">
            <Loader2 size={11} strokeWidth={1.75} className="animate-spin" />
            searching…
          </div>
        ) : error ? (
          <div className="m-2 flex items-start gap-1.5 rounded-sm border border-status-attention/40 bg-status-attention/10 px-2 py-1.5 font-mono text-[10.5px] text-status-attention">
            <AlertCircle size={11} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : query.trim().length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-text-4">
            type a query to search across files
          </div>
        ) : matches.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-text-4">no matches</div>
        ) : (
          <ul className="py-1">
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.file)
              const name = g.file.split('/').pop() ?? g.file
              const parent = g.file.slice(0, g.file.length - name.length - 1)
              return (
                <li key={g.file}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.file)}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-bg-3"
                    title={g.file}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={11} strokeWidth={1.75} className="shrink-0 text-text-3" />
                    ) : (
                      <ChevronDown size={11} strokeWidth={1.75} className="shrink-0 text-text-3" />
                    )}
                    <span className="truncate font-mono text-[11px] text-text-1">{name}</span>
                    <span className="truncate font-mono text-[9.5px] text-text-4">{parent}</span>
                    <span className="ml-auto shrink-0 rounded-sm bg-bg-3 px-1.5 font-mono text-[9.5px] text-text-3">
                      {g.matches.length}
                    </span>
                  </button>
                  {!isCollapsed ? (
                    <ul>
                      {g.matches.map((m, i) => (
                        <li key={`${g.file}:${m.line}:${i}`}>
                          <button
                            type="button"
                            onClick={() => onOpenMatch(g.file)}
                            className="flex w-full items-start gap-2 px-6 py-0.5 text-left hover:bg-bg-3/60"
                          >
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-4">
                              {m.line}
                            </span>
                            <span className="truncate font-mono text-[10.5px] text-text-2">
                              {m.text.trim()}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function FlagBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors ${
        active
          ? 'bg-accent-500/25 text-accent-200'
          : 'text-text-3 hover:bg-bg-3 hover:text-text-1'
      }`}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}
