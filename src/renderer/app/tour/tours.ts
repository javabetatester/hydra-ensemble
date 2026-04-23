import { useProjects } from '../../state/projects'
import { useSessions } from '../../state/sessions'
import { useSpawnDialog } from '../../state/spawn'
import { useOrchestra } from '../../orchestra/state/orchestra'
import { useTour } from './store'
import type { Tour } from './types'

/**
 * Declarative tours registered with the store on module load. Adding a
 * tour is a two-line change: append a Tour object and the launcher
 * picks it up for free.
 *
 * Every `anchor` here must correspond to a `data-tour-id` attribute
 * somewhere in the render tree. Search the repo for
 * `data-tour-id="<value>"` to find the anchored element.
 */

export const WELCOME_TOUR: Tour = {
  id: 'welcome',
  label: 'Welcome tour',
  description: 'The 60-second Hydra orientation — header, projects, sessions, Orchestra.',
  steps: [
    {
      anchor: null,
      title: 'Welcome to Hydra Ensemble',
      body:
        'A parallel-agent terminal for Claude Code. Each session runs in its own isolated CLAUDE_CONFIG_DIR so nothing collides. Use → or Enter to move forward, ← to go back, Esc to exit any time.'
    },
    {
      anchor: 'projects-toggle',
      title: 'Projects drawer',
      body:
        'Every session is scoped to a project. Click here (or press ⌘T / Ctrl+T) to open the drawer, add directories, and switch between them.',
      placement: 'bottom'
    },
    {
      anchor: 'header-editor',
      title: 'Editor',
      body:
        'CodeMirror 6 with live git diff gutters, stage / unstage, and AI-drafted commit messages via `claude -p`. Toggle with ⌘E / Ctrl+E.',
      placement: 'bottom'
    },
    {
      anchor: 'header-terminals',
      title: 'Terminals panel',
      body:
        'Quick access to free-standing terminals that run alongside your sessions. Bottom-dock or right-side layout, your pick. Toggle with ⌘` / Ctrl+`.',
      placement: 'bottom'
    },
    {
      anchor: null,
      title: 'Orchestra — multi-agent mode',
      body:
        'Press ⇧A / Shift+A to open Orchestra: a canvas where PM / architect / dev / QA agents hand tasks down a reporting pyramid. Each agent has its own soul.md + skills + triggers + provider. Still labeled DEVELOPING — that amber banner stays on the view until the surface stabilises.'
    },
    {
      anchor: 'header-help',
      title: 'Keyboard cheatsheet',
      body:
        'Press ? any time (or click this button) to see every shortcut. Every binding is remappable — click the combo and re-type.',
      placement: 'bottom'
    },
    {
      anchor: null,
      title: 'You are set.',
      body:
        'Hit ⌘N / Ctrl+N to spawn your first session and point it at a project. Hit ⇧A / Shift+A to jump into Orchestra. Replay this tour any time from the Tour button.'
    }
  ]
}

export const SESSIONS_TOUR: Tour = {
  id: 'sessions',
  label: 'Sessions & status',
  description: 'How PTY state is derived, what the pills mean, and how to drive them.',
  steps: [
    {
      anchor: 'spawn-session',
      title: 'Spawn a session',
      body:
        'Opens the new-session dialog. Each session runs with its own CLAUDE_CONFIG_DIR so histories, MCP state, and logins never collide.',
      placement: 'bottom',
      before: () => {
        // If the user is on the empty state the spawn button isn't in
        // the header — open the dialog briefly to surface where it
        // ends up. Guarded so we don't re-open on replay.
        if (useSessions.getState().sessions.length === 0) {
          useSpawnDialog.getState().show()
        }
      },
      after: () => {
        if (useSessions.getState().sessions.length === 0) {
          useSpawnDialog.getState().hide()
        }
      }
    },
    {
      anchor: null,
      title: 'Live PTY status',
      body:
        'Each card shows a state pill: thinking · generating · idle · attention. The analyzer watches the PTY byte stream (xterm 256-color, bracketed-paste, tool banners) and emits a state per frame.'
    },
    {
      anchor: null,
      title: 'Context-window meter',
      body:
        'Bottom-right of each card: a tiny bar + "USED/WINDOW" label showing how full the model’s current view is. Turns amber at 50%, red at 90%. Uses the latest assistant turn’s input tokens (not cumulative).'
    }
  ]
}

export const ORCHESTRA_TOUR: Tour = {
  id: 'orchestra',
  label: 'Orchestra mode',
  description: 'Paint a reporting pyramid, submit a task, watch agents hand off.',
  steps: [
    {
      anchor: null,
      title: 'Orchestra — still developing',
      body:
        'You saw the amber DEVELOPING banner at the top? Real. The surface still shifts. But the canvas, routing, and delegation are all live — here is how the pieces fit.'
    },
    {
      anchor: 'orchestra-canvas',
      title: 'The canvas',
      body:
        'Drop agents anywhere and draw edges to form a reporting tree. Strict pyramid: each agent has at most one manager. The edge arrow points from parent to child.',
      placement: 'left',
      skipIf: () => useOrchestra.getState().overlayOpen === false
    },
    {
      anchor: 'orchestra-inspector',
      title: 'Inspector',
      body:
        'Click any agent to open the right drawer. Seven tabs: overview, identity, soul, skills, triggers, inbox, runtime. Drag the left edge to resize the drawer; the tab bar scrolls horizontally when it overflows.',
      placement: 'left',
      skipIf: () => useOrchestra.getState().selectedAgentIds.length !== 1
    },
    {
      anchor: 'orchestra-new-task',
      title: 'Submit a task',
      body:
        'Pick "Auto-route" to let triggers score a winner, or name an agent explicitly. The IPC returns as soon as routing is done — the agent runs async in main, status flips to done when the turn ends.',
      placement: 'left'
    },
    {
      anchor: null,
      title: 'Provider per agent',
      body:
        'Every agent has a provider picker in its Identity tab: Inherit (API key if set, else CLI), Claude Code CLI (OAuth), or Anthropic API key. Delegation works on both paths — SDK uses the native tool; CLI spawns claude -p with an XML envelope the runner parses.'
    }
  ]
}

/** Wire every tour into the store once, at module load. Safe to call
 *  multiple times because `register` is idempotent on tour.id. */
export function registerBuiltInTours(): void {
  const store = useTour.getState()
  store.register(WELCOME_TOUR)
  store.register(SESSIONS_TOUR)
  store.register(ORCHESTRA_TOUR)
}
