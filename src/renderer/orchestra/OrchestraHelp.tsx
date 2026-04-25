/**
 * OrchestraHelp — full-screen help modal listing keyboard shortcuts,
 * core concepts, and a layout map of the Orchestra view.
 *
 * The caller owns the `open` flag (typically bound to `?` in the global
 * keybind registry). Esc, a backdrop mousedown, or the X button all
 * invoke `onClose`. Content is a single scrollable card so the modal
 * works on laptop-height displays without breaking the layout.
 */
import { HelpCircle } from 'lucide-react'
import Modal from '../ui/Modal'
import { Kbd } from '../ui'
import { fmtShortcut } from '../lib/platform'

interface Props {
  open: boolean
  onClose: () => void
}

interface ShortcutRow {
  keys: string[]
  description: string
}

interface ConceptRow {
  term: string
  body: string
}

const CONCEPTS: ReadonlyArray<ConceptRow> = [
  {
    term: 'Team',
    body: 'A workspace grouping agents that share prompts, routes, and history. Switch teams from the left rail.'
  },
  {
    term: 'Agent',
    body: 'An autonomous worker with its own soul, skills, and inbox. Drop one on the canvas to add it to the team.'
  },
  {
    term: 'Soul',
    body: 'The agent’s personality and system prompt — tone, role, constraints. Edit from the Inspector › Soul tab.'
  },
  {
    term: 'Skills',
    body: 'Tools the agent is allowed to call (shell, http, repo, search…). Scope them per agent from Inspector › Skills.'
  },
  {
    term: 'Triggers',
    body: 'Conditions that start an agent automatically: webhooks, cron, inbox patterns, or upstream agent completions.'
  },
  {
    term: 'Task',
    body: 'A user-submitted job routed to one or more agents. Tasks carry a prompt, context, and a result transcript.'
  },
  {
    term: 'Route',
    body: 'The path a task takes through the topology — which agent received it, who they delegated to, and why.'
  },
  {
    term: 'safeMode',
    body: 'A guarded execution state: destructive skills require explicit approval and external calls are dry-run by default.'
  }
]

const WHERE: ReadonlyArray<{ label: string; body: string }> = [
  { label: 'Left rail', body: 'teams.' },
  { label: 'Canvas', body: 'topology.' },
  { label: 'Right tabs', body: 'Tasks · History · Changes · Activity.' },
  { label: 'Top bell', body: 'notifications.' },
  {
    label: 'Inspector',
    body: 'Identity · Soul · Skills · Triggers · Inbox · Runtime · Console.'
  },
  { label: 'Bottom-left toolbar', body: 'Fit · Auto-layout · Templates.' },
  { label: 'Bottom-right FABs', body: '+ Agent · + Task.' }
]

/** Render a list of keys separated by `/` so platform-specific variants
 *  (Cmd vs Ctrl) are visually grouped without splitting onto new lines. */
function KeyGroup({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="inline-flex items-center gap-1">
          {i > 0 ? <span className="text-text-4">/</span> : null}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  )
}

export default function OrchestraHelp({ open, onClose }: Props) {
  const canvasShortcuts: ReadonlyArray<ShortcutRow> = [
    { keys: ['A'], description: 'New agent at canvas center.' },
    { keys: ['Double-click'], description: 'New agent where you clicked.' },
    { keys: ['Delete', 'Backspace'], description: 'Delete selected agent(s).' },
    { keys: [fmtShortcut('0')], description: 'Fit to screen.' },
    { keys: ['/'], description: 'Focus task creation.' },
    { keys: ['Click'], description: 'Open inspector (click a card).' },
    { keys: ['Drag bottom → top'], description: 'Create reporting edge.' },
    { keys: ['Hover edge'], description: 'Click the X to delete.' }
  ]

  const keyboardShortcuts: ReadonlyArray<ShortcutRow> = [
    { keys: [fmtShortcut('A', { shift: true })], description: 'Toggle Orchestrador view.' },
    { keys: [fmtShortcut('K')], description: 'Command palette.' },
    { keys: [fmtShortcut('D')], description: 'Back to classic dashboard.' },
    { keys: ['?'], description: 'This help.' }
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="orchestra help"
      titleIcon={<HelpCircle size={14} strokeWidth={1.75} />}
      maxWidth="max-w-2xl"
    >
      <div className="df-scroll flex max-h-[70vh] flex-col gap-6 overflow-y-auto">
        <section aria-labelledby="help-canvas">
          <h3
            id="help-canvas"
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2"
          >
            Canvas shortcuts
          </h3>
          <dl className="flex flex-col gap-1.5">
            {canvasShortcuts.map((row, i) => (
              <div
                key={`canvas-${i}`}
                className="flex items-start justify-between gap-4"
              >
                <dt className="shrink-0">
                  <KeyGroup keys={row.keys} />
                </dt>
                <dd className="text-right text-[12px] leading-snug text-text-2">
                  {row.description}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="help-keyboard">
          <h3
            id="help-keyboard"
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2"
          >
            Keyboard
          </h3>
          <dl className="flex flex-col gap-1.5">
            {keyboardShortcuts.map((row, i) => (
              <div
                key={`kbd-${i}`}
                className="flex items-start justify-between gap-4"
              >
                <dt className="shrink-0">
                  <KeyGroup keys={row.keys} />
                </dt>
                <dd className="text-right text-[12px] leading-snug text-text-2">
                  {row.description}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="help-concepts">
          <h3
            id="help-concepts"
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2"
          >
            Concepts
          </h3>
          <div className="flex flex-col gap-2">
            {CONCEPTS.map((c) => (
              <p key={c.term} className="text-[12px] leading-snug text-text-2">
                <span className="font-semibold text-text-1">{c.term}</span>
                <span className="text-text-4"> — </span>
                {c.body}
              </p>
            ))}
          </div>
        </section>

        <section aria-labelledby="help-where">
          <h3
            id="help-where"
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2"
          >
            Where things live
          </h3>
          <ul className="flex flex-col gap-1.5">
            {WHERE.map((w, i) => (
              <li
                key={`where-${i}`}
                className="flex items-baseline gap-2 text-[12px] leading-snug text-text-2"
              >
                <span className="font-semibold text-text-1">{w.label}</span>
                <span className="text-text-4">→</span>
                <span>{w.body}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  )
}
