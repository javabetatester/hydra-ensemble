import { useSessions } from '../../state/sessions'
import { useSpawnDialog } from '../../state/spawn'
import { useSlidePanel, useTerminalsPanel } from '../../state/panels'
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
 *
 * Orchestra tour deliberately removed while that surface is marked
 * DEVELOPING — we don't teach a user how to use something that's
 * still shifting week-over-week.
 */

// ---------------------------------------------------------------------
// Helpers — small side-effect orchestrators reused by multiple `before`
// hooks. Keeping them out of the tour defs keeps those readable.
// ---------------------------------------------------------------------

async function openEditorPanel(): Promise<void> {
  const panel = useSlidePanel.getState()
  if (panel.current !== 'editor') panel.open('editor')
  // Give the slide animation a beat to finish so the highlight lands
  // on a fully-laid-out element instead of mid-transition geometry.
  await wait(240)
}

async function openTerminalsPanel(): Promise<void> {
  const term = useTerminalsPanel.getState()
  if (!term.open) term.toggle()
  await wait(200)
}

function hasSessions(): boolean {
  return useSessions.getState().sessions.length > 0
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------

export const WELCOME_TOUR: Tour = {
  id: 'welcome',
  label: 'Welcome to Hydra',
  description:
    'The 60-second orientation — projects, sessions, editor, terminals, and where to find everything else.',
  steps: [
    {
      anchor: null,
      title: 'Welcome to Hydra Ensemble',
      body:
        'A parallel-agent terminal built around Claude Code. Each session runs in its own isolated CLAUDE_CONFIG_DIR — histories, MCP state, and logins never collide. Use → / Enter to move forward, ← to go back, Esc to exit any time.'
    },
    {
      anchor: 'projects-toggle',
      title: 'Projects — the scope of everything',
      body:
        'Every session and worktree belongs to a project. Click here or press ⌘T / Ctrl+T to open the drawer, add directories, and switch between them. The active project name lives right on the button.',
      placement: 'bottom'
    },
    {
      anchor: 'spawn-session',
      title: 'Spawn a session',
      body:
        'This is the entry point. Each session gets its own PTY, its own CLAUDE_CONFIG_DIR, and — if you want — its own git worktree so Claude can\'t stomp on your main branch.',
      placement: 'bottom'
    },
    {
      anchor: 'header-editor',
      title: 'Editor panel',
      body:
        'A CodeMirror-6 stack with live git diff gutters, stage / unstage, and AI-drafted commit messages via claude -p. ⌘E / Ctrl+E toggles it. There is a dedicated Editor tour in the Tour menu if you want the full walkthrough.',
      placement: 'bottom'
    },
    {
      anchor: 'header-terminals',
      title: 'Terminals panel',
      body:
        'Free-standing xterm tabs that run alongside your sessions — handy for quick bash, tailing logs, running a test without wasting an agent turn. ⌘` / Ctrl+` toggles it. Bottom-dock or right-side, your pick.',
      placement: 'bottom'
    },
    {
      anchor: 'header-help',
      title: 'Keyboard cheatsheet',
      body:
        'Press ? any time (or click this button) to see every shortcut. Every binding is remappable — click the combo in the overlay and re-type the keys you want.',
      placement: 'bottom'
    },
    {
      anchor: 'header-tour',
      title: 'Replay this any time',
      body:
        'The Tour button in the header opens a menu with every guided walkthrough. Take the focused ones (Sessions, Editor, Toolkit, Terminals) when you want deeper detail on a specific surface.',
      placement: 'bottom'
    },
    {
      anchor: null,
      title: 'You are set.',
      body:
        'Hit ⌘N / Ctrl+N to spawn your first session, or open the Tour menu again for a focused walkthrough of the Editor, Toolkit, or Terminals.'
    }
  ]
}

export const SESSIONS_TOUR: Tour = {
  id: 'sessions',
  label: 'Sessions & status',
  description:
    'How each session card reads — state pill, activity verb, cost, context window. Drive them with keyboard + mouse.',
  steps: [
    {
      anchor: null,
      title: 'What is a session?',
      body:
        'One PTY spawn running claude (or a raw shell). Each gets an isolated CLAUDE_CONFIG_DIR so logins / MCP state / history never collide. Cards for every running session live in the right column.'
    },
    {
      anchor: 'spawn-session',
      title: 'Create one',
      body:
        'The dialog picks a cwd, an optional worktree, and a freshConfig toggle. The PTY spawns in the repo root, execs claude, and the card appears instantly. ⌘N / Ctrl+N is the shortcut.',
      placement: hasSessions() ? 'left' : 'bottom',
      before: () => {
        if (!hasSessions()) useSpawnDialog.getState().show()
      },
      after: () => {
        if (!hasSessions()) useSpawnDialog.getState().hide()
      }
    },
    {
      anchor: 'session-state-pill',
      title: 'Live state pill',
      body:
        'Derived from the PTY byte stream by an analyzer (xterm 256-color, bracketed-paste, tool banners). States: idle · thinking · generating · userInput · needsAttention. No polling — every frame is a state decision.',
      placement: 'left',
      // No skipIf — first-time users won't have sessions yet, but the
      // step still teaches what they'll see once they create one.
      // Anchor resolution gracefully falls back to a centered card
      // when the data-tour-id element doesn't exist in the DOM.
    },
    {
      anchor: 'session-avatar',
      title: 'Avatar + colour',
      body:
        'Each session gets a deterministic avatar derived from its id, plus an accent colour you can override. The avatar ring mirrors the state pill colour so you can track status across cards at a glance.',
      placement: 'left',
      // No skipIf — first-time users won't have sessions yet, but the
      // step still teaches what they'll see once they create one.
      // Anchor resolution gracefully falls back to a centered card
      // when the data-tour-id element doesn't exist in the DOM.
    },
    {
      anchor: 'session-cost-tokens',
      title: 'Cost & tokens (cumulative)',
      body:
        '$x.xx is total spend pulled from Claude\'s JSONL. ↓ in / ↑ out are cumulative input/output tokens across every turn in this session — useful for "how much did this whole conversation cost me".',
      placement: 'left',
      // No skipIf — first-time users won't have sessions yet, but the
      // step still teaches what they'll see once they create one.
      // Anchor resolution gracefully falls back to a centered card
      // when the data-tour-id element doesn't exist in the DOM.
    },
    {
      anchor: 'session-context-meter',
      title: 'Context-window meter',
      body:
        'Different from tokens-in: this is just the LATEST turn\'s input footprint, i.e. how full the model\'s current view is. Colour shifts amber at 50%, orange at 75%, red at 90%. Claude defaults are 200K; Opus 1m-beta bumps to 1M.',
      placement: 'left',
      // No skipIf — first-time users won't have sessions yet, but the
      // step still teaches what they'll see once they create one.
      // Anchor resolution gracefully falls back to a centered card
      // when the data-tour-id element doesn't exist in the DOM.
    },
    {
      anchor: null,
      title: 'Jump between sessions',
      body:
        '⌘1 … ⌘9 (Ctrl on Linux/Windows) jumps to session N. ⌘⇧J / Ctrl+Shift+J next, ⌘⇧K / Ctrl+Shift+K previous. Works even when the terminal pane has focus — the dispatcher runs at capture phase so xterm can\'t swallow the key.'
    }
  ]
}

export const EDITOR_TOUR: Tour = {
  id: 'editor',
  label: 'Editor & git workflow',
  description:
    'CodeMirror 6, the three side tabs (files · changes · search), staging, AI-drafted commits.',
  steps: [
    {
      anchor: null,
      title: 'Editor — the panel',
      body:
        'Monaco-sibling speed with CodeMirror 6. Side tabs Files / Changes / Search. Diff gutters on the editor itself. Stage / unstage / commit straight from the panel. Toggle with ⌘E / Ctrl+E.'
    },
    {
      anchor: 'header-editor',
      title: 'Open it',
      body:
        'Click here or press ⌘E / Ctrl+E. The panel slides in on the right and takes whatever width you dragged it to last time.',
      placement: 'bottom',
      before: () => openEditorPanel()
    },
    {
      anchor: 'editor-side-tabs',
      title: 'Side tabs',
      body:
        'Files = your worktree tree. Changes = live git status (staged + unstaged, with per-file diffs). Search = cross-file ripgrep-style search. Tabs are lazy-mounted so a huge node_modules tree doesn\'t load until you actually click Files.',
      placement: 'right'
    },
    {
      anchor: 'editor-changes-tab',
      title: 'Changes — stage, diff, commit',
      body:
        'Click a file to see its diff. Click the M/A/D badge to stage/unstage. Bottom has the commit message box and the Generate-with-AI button that drafts a message via claude -p using the current diff. Commits run from the repo toplevel so subpath workspaces work.',
      placement: 'right'
    },
    {
      anchor: 'editor-generate-ai',
      title: 'Generate commit with AI',
      body:
        'Pipes the staged diff (or unstaged if nothing staged) into claude -p, along with your custom "rules" (scope conventions, language, ticket-id format — set via the 📜 icon). Haiku on short diffs, Sonnet once the diff is multi-file or >4KB. 120s timeout with a live elapsed counter on the button.',
      placement: 'right'
    },
    {
      anchor: null,
      title: 'Diff gutters + jump to symbol',
      body:
        'As you edit, the gutter shows a green stripe (added), amber (modified), or a red notch (deleted) — tokens-driven so a theme swap follows. And ⌘P / Ctrl+P inside the editor opens a fuzzy symbol palette for the active file, so you can jump to "see foo() around line 120" without scrolling.'
    }
  ]
}

export const TOOLKIT_TOUR: Tour = {
  id: 'toolkit',
  label: 'Toolkit — scripted bash actions',
  description:
    'Pre-configured bash buttons (test / build / lint / anything) that run inside the active session\'s cwd.',
  steps: [
    {
      anchor: null,
      title: 'Toolkit — what and why',
      body:
        'You have 5 bash commands you repeat a hundred times a week: `go test ./...`, `npm run lint`, `docker compose up -d`, `pnpm i`, whatever. The toolkit is that library. One click, runs in the active session\'s cwd, streams output into a popover — no agent turn wasted on "please run the tests again".'
    },
    {
      anchor: 'toolkit-grid',
      title: 'The grid',
      body:
        'Every tool is a card. Name, icon, colour, and its shell command. Click to run; the output streams live in a popover anchored to the card. Success / error auto-clear after 2.5s / 6s respectively so the grid doesn\'t become sticky status noise.',
      placement: 'left'
    },
    {
      anchor: 'toolkit-add',
      title: 'Add / edit',
      body:
        'Plus opens the editor dialog. You pick a name, an icon from the Lucide set, a command, a per-tool accent colour, and optionally a cwd (defaults to the session\'s cwd). Persisted to ~/.config/Hydra, so it follows you across installs.',
      placement: 'left'
    },
    {
      anchor: null,
      title: 'It respects the active session',
      body:
        'Tools run in whichever session is active — its cwd, its env. If you have five sessions and click "tests" on session 3, it tests session 3\'s worktree, not the others. No "wrong-repo" mistakes.'
    }
  ]
}

export const TERMINALS_TOUR: Tour = {
  id: 'terminals',
  label: 'Terminals — free-standing shells',
  description:
    'Raw xterm tabs that run alongside your agent sessions. No CLAUDE_CONFIG_DIR isolation — just a shell.',
  steps: [
    {
      anchor: null,
      title: 'Terminals vs sessions',
      body:
        'Sessions are Claude agents — they own a CLAUDE_CONFIG_DIR, route JSONL through the analyzer, show state pills. Terminals are just a plain shell, zero analyzer. Use them for ad-hoc bash, tailing, docker, whatever does not need an agent.'
    },
    {
      anchor: 'header-terminals',
      title: 'Open the panel',
      body:
        '⌘` / Ctrl+` toggles. It lives at the bottom of the screen by default; the View menu inside it can flip to the right-side slide-pane slot instead. Mounted once and portalled between positions so xterm state + PTY subscriptions survive a swap.',
      placement: 'bottom',
      before: () => openTerminalsPanel(),
      after: () => {
        const term = useTerminalsPanel.getState()
        // Leave it open — the user probably wants to keep exploring.
        // Only close if they hadn\'t opened it themselves before the tour.
        if (!term.open) return
      }
    },
    {
      anchor: 'terminals-tabs',
      title: 'Multiple tabs',
      body:
        'Plus adds a new shell tab. Middle-click closes one. They\'re independent PTYs — killing a tab only kills its shell; the others keep running. Use them like you would iTerm or Windows Terminal tabs.',
      placement: 'top'
    },
    {
      anchor: null,
      title: 'Keep it resized',
      body:
        'Drag the top edge to resize; the height persists. If you want the terminal perma-open, the view menu lets you lock it; if you hate the bottom dock, flip to side mode and it rides the same slot as the editor.'
    }
  ]
}

/** Wire every tour into the store. Called eagerly on module load
 *  (the IIFE below) so anyone who imports this file triggers
 *  registration before the first component renders. Exported for
 *  callers that want to re-register after a hot-reload / swap of the
 *  tour schema without restarting the app. */
export function registerBuiltInTours(): void {
  const store = useTour.getState()
  store.register(WELCOME_TOUR)
  store.register(SESSIONS_TOUR)
  store.register(EDITOR_TOUR)
  store.register(TOOLKIT_TOUR)
  store.register(TERMINALS_TOUR)
}

// Run once on import. Previously the registration rode on a useMemo
// inside App.tsx — React 19 Strict Mode re-evaluates useMemo, and the
// 'replay tutorial' button on Welcome could fire startTour('welcome')
// before useMemo finished registering, so start() silently no-op'd
// because `tours['welcome']` was undefined. Moving to module load
// removes the race entirely: any `import … from './tours'` (including
// App.tsx) guarantees registration happens before any component
// renders.
registerBuiltInTours()
