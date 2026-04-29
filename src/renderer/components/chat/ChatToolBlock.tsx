import { useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Pencil,
  Terminal,
  Search,
  ListTodo,
  Globe,
  AlertTriangle,
  Wrench,
  FilePlus,
  Check,
  Copy
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TranscriptBlock } from '../../../shared/types'
import { useEditor } from '../../state/editor'

/** Map raw tool names to a friendly display label and icon. Anything
 *  unknown falls back to the tool name + a generic wrench icon. */
const TOOL_META: Record<string, { label: string; icon: LucideIcon }> = {
  Read: { label: 'Read file', icon: FileText },
  Write: { label: 'Write file', icon: FilePlus },
  Edit: { label: 'Edit file', icon: Pencil },
  Update: { label: 'Update file', icon: Pencil },
  MultiEdit: { label: 'Edit file', icon: Pencil },
  NotebookEdit: { label: 'Edit notebook', icon: Pencil },
  Bash: { label: 'Run command', icon: Terminal },
  Grep: { label: 'Search code', icon: Search },
  Glob: { label: 'Find files', icon: Search },
  TodoWrite: { label: 'Update todos', icon: ListTodo },
  WebFetch: { label: 'Fetch URL', icon: Globe },
  WebSearch: { label: 'Web search', icon: Globe }
}

function truncate(s: string, max: number): string {
  const trimmed = s.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + '…'
}

function pickPath(input: Record<string, unknown>): string | null {
  const v = input['file_path'] ?? input['path'] ?? input['notebook_path']
  return typeof v === 'string' ? v : null
}

function oneLineSummary(name: string, input: Record<string, unknown>): string {
  const path = pickPath(input)
  if (path) return path
  const cmd = input['command']
  if (typeof cmd === 'string') return truncate(cmd, 120)
  const pattern = input['pattern'] ?? input['query']
  if (typeof pattern === 'string') return truncate(pattern, 100)
  const description = input['description']
  if (typeof description === 'string') return truncate(description, 100)
  if (name === 'TodoWrite' && Array.isArray(input['todos'])) {
    return `${(input['todos'] as unknown[]).length} items`
  }
  const firstKey = Object.keys(input)[0]
  if (firstKey) return `${firstKey}: ${truncate(String(input[firstKey]), 100)}`
  return ''
}

/**
 * Tool-call card: header with icon + friendly label + short summary, a
 * body with the raw arguments, and any paired tool_result rendered
 * beneath. Collapsed by default; expanding picks up a subtle accent
 * border so the currently-open card is easy to spot in a long chain.
 */
export function ToolUseBlock({
  block,
  results
}: {
  block: Extract<TranscriptBlock, { kind: 'tool_use' }>
  /** Paired tool_result blocks. Rendered immediately beneath the args
   *  when the card is expanded. */
  results?: Extract<TranscriptBlock, { kind: 'tool_result' }>[]
}) {
  const [expanded, setExpanded] = useState(false)
  const openFile = useEditor((s) => s.openFile)
  const openEditor = useEditor((s) => s.openEditor)
  const meta = TOOL_META[block.name] ?? { label: block.name, icon: Wrench }
  const Icon = meta.icon
  const summary = oneLineSummary(block.name, block.input)
  const path = pickPath(block.input)

  // When expanded we want a quiet accent cue; collapsed we use the
  // softer border so tool chains don't steal attention from text.
  const borderClass = expanded ? 'border-accent-500/40' : 'border-border-soft'

  return (
    <div
      className={`overflow-hidden border bg-bg-2 transition-colors ${borderClass}`}
      style={{ borderRadius: 'var(--radius-sm)' }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-bg-3"
      >
        {expanded ? (
          <ChevronDown size={12} strokeWidth={1.75} className="shrink-0 text-text-3" />
        ) : (
          <ChevronRight size={12} strokeWidth={1.75} className="shrink-0 text-text-3" />
        )}
        <Icon size={12} strokeWidth={1.75} className="shrink-0 text-accent-400" />
        <span className="shrink-0 font-semibold text-text-2">{meta.label}</span>
        {summary ? (
          <span
            className={`truncate font-mono text-text-3 ${path ? 'hover:text-accent-400' : ''}`}
            onClick={
              path
                ? (e) => {
                    e.stopPropagation()
                    void openFile(path)
                    openEditor()
                  }
                : undefined
            }
            title={path ? `open ${path}` : undefined}
          >
            {summary}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[10px] text-text-4">{block.name}</span>
      </button>
      {expanded ? (
        <div className="border-t border-border-soft">
          <pre className="df-scroll max-h-80 overflow-auto bg-bg-1 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-2">
            {JSON.stringify(block.input, null, 2)}
          </pre>
          {results && results.length > 0 ? (
            <div className="space-y-1 border-t border-border-soft bg-bg-1/50 p-2">
              {results.map((r, i) => (
                <ToolResultBlock key={`res-${i}`} block={r} defaultOpen />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Tool result card — single-line preview when the output is short,
 * collapsible body when it's multiline. Copy button pops in on hover
 * so the user can grab the raw text without expanding + selecting.
 */
export function ToolResultBlock({
  block,
  defaultOpen
}: {
  block: Extract<TranscriptBlock, { kind: 'tool_result' }>
  /** When embedded inside an expanded ToolUseBlock we want the result
   *  revealed by default — no sense in making the user click twice. */
  defaultOpen?: boolean
}) {
  const [expanded, setExpanded] = useState(!!defaultOpen)
  const [copied, setCopied] = useState(false)
  const text = block.text.trim()
  if (text.length === 0) return null
  const multiline = text.includes('\n') || text.length > 120
  const preview = multiline ? (text.split('\n')[0] ?? text) : text

  const copy = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard may be blocked in some electron contexts — fall through. */
    }
  }

  return (
    <div
      className={`group/result overflow-hidden border ${
        block.isError
          ? 'border-status-attention/50 bg-status-attention/5'
          : 'border-border-soft bg-bg-2'
      }`}
      style={{ borderRadius: 'var(--radius-sm)' }}
    >
      <div
        className={`flex items-center gap-2 px-2.5 py-1.5 text-xs ${
          multiline ? 'hover:bg-bg-3' : ''
        }`}
      >
        <button
          type="button"
          onClick={() => multiline && setExpanded((v) => !v)}
          className={`flex flex-1 items-center gap-2 text-left ${
            multiline ? 'cursor-pointer' : 'cursor-default'
          }`}
        >
          {multiline ? (
            expanded ? (
              <ChevronDown size={12} strokeWidth={1.75} className="shrink-0 text-text-3" />
            ) : (
              <ChevronRight size={12} strokeWidth={1.75} className="shrink-0 text-text-3" />
            )
          ) : (
            <span className="w-3" />
          )}
          {block.isError ? (
            <AlertTriangle
              size={12}
              strokeWidth={1.75}
              className="shrink-0 text-status-attention"
            />
          ) : null}
          <span className="shrink-0 font-semibold text-text-3">
            {block.isError ? 'error' : 'result'}
          </span>
          <span className="truncate font-mono text-text-2">{truncate(preview, 160)}</span>
        </button>
        <button
          type="button"
          onClick={copy}
          className="df-hover-reveal shrink-0 rounded-sm p-1 text-text-4 hover:bg-bg-3 hover:text-text-1 group-hover/result:opacity-100"
          title={copied ? 'copied' : 'copy result'}
        >
          {copied ? (
            <Check size={11} strokeWidth={2} className="text-accent-400" />
          ) : (
            <Copy size={11} strokeWidth={1.75} />
          )}
        </button>
      </div>
      {expanded && multiline ? (
        <pre className="df-scroll max-h-96 overflow-auto border-t border-border-soft bg-bg-1 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-2">
          {text}
        </pre>
      ) : null}
    </div>
  )
}
