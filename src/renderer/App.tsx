import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Code2,
  FolderTree,
  HelpCircle,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Terminal as TerminalIcon
} from 'lucide-react'
import SessionPane from './components/SessionPane'
import StatusBar from './components/StatusBar'
import Dashboard from './components/Dashboard'
import Sidebar from './components/Sidebar'
import CodeEditor from './components/CodeEditor'
import SessionsPanel from './components/SessionsPanel'
import ToolkitGrid from './components/ToolkitGrid'
import ActiveAgentBar from './components/ActiveAgentBar'
import ToolkitEditorDialog from './components/Toolkit/EditorDialog'
import Toasts from './components/Toasts'
import SessionReplyToaster from './components/SessionReplyToaster'
import CommandPalette from './components/CommandPalette'
import HelpOverlay from './components/HelpOverlay'
import NewSessionDialog from './components/NewSessionDialog'
import TerminalsPanel from './components/TerminalsPanel'
import WindowControls from './components/WindowControls'
import OrchestraView from './orchestra/OrchestraView'
import WelcomeScreen from './components/WelcomeScreen'
import { Kbd } from './ui'

/** Shows the welcome screen once per install by checking a localStorage
 *  flag. Kept out of <App> so App's state stays tidy; re-opening the
 *  welcome screen manually can be wired later via a menu item. */
function WelcomeGate() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('hydra.welcome.shown') !== '1'
    } catch {
      return false
    }
  })
  return <WelcomeScreen open={open} onClose={() => setOpen(false)} />
}
import { useOrchestra } from './orchestra/state/orchestra'
import { useSpawnDialog } from './state/spawn'
import {
  useSlidePanel,
  usePanelSize,
  PANEL_WIDTH_MIN,
  PANEL_WIDTH_MAX,
  useRightColumnSize,
  RIGHT_COLUMN_DEFAULT,
  useRightPanel,
  useTerminalsPanel,
  TERMINALS_HEIGHT_MIN,
  TERMINALS_HEIGHT_MAX
} from './state/panels'
import { isMac } from './lib/platform'
import { useSessions } from './state/sessions'
import { useSessionsUi } from './state/sessionsExtra'
import { useEditor } from './state/editor'
import { useProjects } from './state/projects'
import { fmtShortcut } from './lib/platform'
import { useGlobalKeybinds } from './hooks/useGlobalKeybinds'
import { useBootstrap } from './app/boot'
import HeaderButton from './app/HeaderButton'
import Welcome from './app/Welcome'
import TourHost from './app/tour/TourHost'
import TourLauncher from './app/tour/TourLauncher'
// Side-effect import — the module registers built-in tours on load.
import './app/tour/tours'

export default function App() {
  const claudePath = useBootstrap()
  // Tour registration happens at module load inside ./app/tour/tours.
  // Tours are user-initiated only — primary discovery is the Tutorial
  // button on the Welcome screen; header launcher is the replay path.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const orchestraOpen = useOrchestra((s) => s.overlayOpen)
  const setOrchestraOpen = useOrchestra((s) => s.setOverlayOpen)
  const toggleOrchestra = useOrchestra((s) => s.toggleOverlay)
  const orchestraEnabled = useOrchestra((s) => s.settings.enabled)
  const setOrchestraSettings = useOrchestra((s) => s.setSettings)
  const spawnOpen = useSpawnDialog((s) => s.open)
  const showSpawn = useSpawnDialog((s) => s.show)
  const hideSpawn = useSpawnDialog((s) => s.hide)

  const sessions = useSessions((s) => s.sessions)
  const activeId = useSessions((s) => s.activeId)
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId]
  )
  const createSession = useSessions((s) => s.createSession)
  const destroySession = useSessions((s) => s.destroySession)
  const setActive = useSessions((s) => s.setActive)

  const chatMinimized = useSessionsUi((s) => s.chatMinimized)
  const toggleChatMinimized = useSessionsUi((s) => s.toggleChatMinimized)

  const activePanel = useSlidePanel((s) => s.current)
  const panelWidth = usePanelSize((s) => s.width)
  const setPanelWidth = usePanelSize((s) => s.setWidth)
  const rightColumnWidth = useRightColumnSize((s) => s.width)
  const setRightColumnWidth = useRightColumnSize((s) => s.setWidth)
  const rightPanelHidden = useRightPanel((s) => s.hidden)
  const openPanel = useSlidePanel((s) => s.open)
  const closePanel = useSlidePanel((s) => s.close)
  const togglePanelFor = useSlidePanel((s) => s.toggle)
  const terminalsOpenBottom = useTerminalsPanel((s) => s.open)
  const toggleTerminals = useTerminalsPanel((s) => s.toggle)
  const closeTerminals = useTerminalsPanel((s) => s.closePanel)
  const terminalsHeight = useTerminalsPanel((s) => s.height)
  const setTerminalsHeight = useTerminalsPanel((s) => s.setHeight)
  const terminalsPosition = useTerminalsPanel((s) => s.position)
  // Whether the terminals UI is currently visible at all. In side mode it
  // rides the slide-pane slot (mutually exclusive w/ editor etc); in
  // bottom mode it's its own dock. One flag drives the header button
  // highlight and the portal target below.
  const terminalsVisible =
    terminalsPosition === 'side'
      ? activePanel === 'terminals'
      : terminalsOpenBottom

  // Portal targets. The TerminalsPanel is mounted exactly once (bottom of
  // this tree) and createPortal'd into whichever host matches the current
  // position. Moving the portal target preserves React state and the DOM
  // subtree, so xterm buffers and PTY subscriptions survive a view swap.
  const [bottomHost, setBottomHost] = useState<HTMLDivElement | null>(null)
  const [sideHost, setSideHost] = useState<HTMLDivElement | null>(null)
  const terminalsHost = terminalsPosition === 'bottom' ? bottomHost : sideHost

  const currentProject = useProjects((s) => s.projects.find((p) => p.path === s.currentPath))

  const contextCwd =
    activeSession?.worktreePath ?? activeSession?.cwd ?? currentProject?.path ?? null

  // Global keybind dispatcher extracted to `hooks/useGlobalKeybinds`.
  // All the routing logic + capture-phase listener + xterm-textarea
  // bypass + session-jump lives there now.
  useGlobalKeybinds({
    orchestraEnabled,
    toggleOrchestra,
    setOrchestraOpen,
    setOrchestraSettings,
    showSpawn,
    createSession,
    destroySession,
    activeId,
    sessions,
    setActive,
    togglePanelFor,
    setDrawerOpen,
    activePanel,
    toggleTerminals,
    contextCwd,
    setPaletteOpen,
    setHelpOpen
  })

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-0 text-text-1">
      {/* Project drawer (collapsible) */}
      <div
        className={`shrink-0 overflow-hidden border-r border-border-soft transition-[width] duration-200 ${
          drawerOpen ? 'w-64' : 'w-0'
        }`}
      >
        <Sidebar />
      </div>

      {/* Main column: header, terminal, status bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={`flex h-11 shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 ${
            isMac() ? 'pl-20 pr-3' : 'pl-3 pr-3'
          }`}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div
            className="flex items-center gap-3"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm bg-accent-500 df-pulse" />
              <span className="flex items-baseline gap-1.5 font-mono text-sm font-semibold tracking-tight">
                <span className="text-text-1">Hydra</span>
                <span className="text-accent-400">Ensemble</span>
                <span className="text-text-4">v{__APP_VERSION__}</span>
              </span>
            </div>
            <span className="h-5 w-px bg-border-soft" aria-hidden />
            <HeaderButton
              icon={<FolderTree size={13} strokeWidth={1.75} />}
              label="manager"
              shortcut={fmtShortcut('T')}
              active={drawerOpen}
              onClick={() => setDrawerOpen((v) => !v)}
              dataTourId="projects-toggle"
            />
          </div>

          <div
            className="flex items-center gap-3"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <div className="flex items-center gap-0.5">
            {/* Compact icon-only chat toggle — the icon already conveys
                show/hide direction (PanelLeftOpen vs Close), and the
                tooltip carries the label. Saves precious header width. */}
            <button
              type="button"
              onClick={toggleChatMinimized}
              disabled={sessions.length === 0}
              title={chatMinimized ? 'Show chat' : 'Hide chat'}
              aria-label={chatMinimized ? 'Show chat' : 'Hide chat'}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border transition disabled:cursor-not-allowed disabled:opacity-40 ${
                chatMinimized
                  ? 'border-accent-500/40 bg-accent-500/10 text-accent-200'
                  : 'border-transparent text-text-3 hover:border-border-soft hover:bg-bg-3 hover:text-text-1'
              }`}
            >
              {chatMinimized ? (
                <PanelLeftOpen size={13} strokeWidth={1.75} />
              ) : (
                <PanelLeftClose size={13} strokeWidth={1.75} />
              )}
            </button>
            <HeaderButton
              icon={<Code2 size={13} strokeWidth={1.75} />}
              label="editor"
              shortcut={fmtShortcut('E')}
              active={activePanel === 'editor'}
              onClick={() => togglePanelFor('editor')}
              dataTourId="header-editor"
            />
            <HeaderButton
              icon={<LayoutDashboard size={13} strokeWidth={1.75} />}
              label="dashboard"
              shortcut={fmtShortcut('D')}
              active={activePanel === 'dashboard'}
              onClick={() => togglePanelFor('dashboard')}
            />
            <HeaderButton
              icon={<TerminalIcon size={13} strokeWidth={1.75} />}
              label="terminals"
              shortcut={`${fmtShortcut('').slice(0, -1)}\``}
              active={terminalsVisible}
              onClick={toggleTerminals}
              dataTourId="header-terminals"
            />
            <HeaderButton
              icon={<HelpCircle size={13} strokeWidth={1.75} />}
              label="?"
              shortcut="?"
              onClick={() => setHelpOpen(true)}
              dataTourId="header-help"
            />
            <TourLauncher />
            <div className="ml-2 flex items-center gap-1.5 border-l border-border-soft pl-3 font-mono text-[10px]">
              <span className="text-text-4">os</span>
              <span className="text-text-2">{window.api.platform.os}</span>
              <span className="text-text-4">/</span>
              <span className="text-text-4">claude</span>
              <span
                className={
                  claudePath === undefined
                    ? 'text-text-4'
                    : claudePath === null
                      ? 'text-status-attention'
                      : 'text-status-generating'
                }
              >
                {claudePath === undefined
                  ? '?'
                  : claudePath === null
                    ? 'missing'
                    : 'ok'}
              </span>
            </div>
            </div>
            {/* Vertical separator + extra breathing room before the OS controls
                so they don't crowd the os/claude badge on Linux/Windows. */}
            <span className="h-5 w-px bg-border-soft" aria-hidden />
            <WindowControls />
          </div>
        </header>

        <main className="relative flex min-h-0 flex-1">
          {/* Left stack: chat + editor/dashboard/etc on top, terminals
              dock on bottom. Keeps the terminals strip from bleeding
              under the right (sessions + toolkit) column. */}
          <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 min-w-0 flex-1">
          {/* Terminal area — shrinks when editor pane slides in. Entirely
              hidden when the user minimizes the chat AND a side panel is
              open (editor/dashboard/etc take over the space). */}
          <div
            className="relative flex min-w-0 flex-1 flex-col bg-bg-1"
            // Hide the chat in every case the user asks: whether or not a
            // side panel is open. Previously only hid when a panel had the
            // spotlight, leaving the "hide chat" button visually inert.
            style={{ display: chatMinimized ? 'none' : undefined }}
          >
            {sessions.length === 0 ? <Welcome claudePath={claudePath} /> : null}
            {sessions.length > 0 ? (
              <>
                {activeSession ? <ActiveAgentBar session={activeSession} /> : null}
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className="absolute inset-0"
                      style={{ display: s.id === activeId ? 'block' : 'none' }}
                    >
                      <SessionPane session={s} visible={s.id === activeId} />
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          {/* Placeholder shown when the user minimises the chat and no
              side panel is taking the space — gives them a clear "the
              chat is hidden" affordance with a restore button. */}
          {chatMinimized && !activePanel ? (
            <div className="flex min-w-0 flex-1 items-center justify-center bg-bg-1">
              <button
                type="button"
                onClick={toggleChatMinimized}
                className="flex flex-col items-center gap-2 rounded-md border border-border-soft bg-bg-2 px-8 py-6 text-[12px] text-text-3 hover:border-border-mid hover:text-text-1"
              >
                <PanelLeftOpen size={20} strokeWidth={1.5} />
                <span>Chat hidden — click to show again</span>
              </button>
            </div>
          ) : null}

          {/* Unified slide pane — hosts whichever of editor / dashboard /
              terminals is currently active. Positioned ABSOLUTE on top of
              the chat row instead of taking flex width, so opening editor
              or dashboard FLOATS the pane over the terminal/CLI rather
              than shrinking it (terminal stays full-width underneath).
              When the chat is minimized, the pane stretches edge-to-edge
              to take over the empty area. The resize handle is now an
              inner left-edge strip on the pane itself. */}
          <div
            className={`absolute right-0 top-0 bottom-0 z-30 flex flex-col overflow-hidden border-l shadow-pop ${
              activePanel ? 'border-border-mid' : 'border-transparent pointer-events-none'
            }`}
            style={{
              // Width transition (no transform) to match the Ctrl+T
              // projects drawer and Ctrl+Q sessions toggle — those feel
              // elegant precisely because the pane shrinks/grows in
              // place from its anchor edge, with internal content
              // clipping via overflow-hidden, instead of sliding the
              // whole subtree across the screen. Anchored to right:0;
              // when chat is minimized we also set left:0 to fill the
              // empty space the chat used to occupy.
              left: activePanel && chatMinimized ? 0 : 'auto',
              width: activePanel
                ? chatMinimized
                  ? undefined
                  : `${panelWidth}px`
                : 0,
              minWidth: activePanel && !chatMinimized ? `${PANEL_WIDTH_MIN}px` : 0,
              maxWidth:
                activePanel && !chatMinimized ? `${PANEL_WIDTH_MAX}px` : undefined,
              opacity: activePanel ? 1 : 0,
              transition:
                'width 520ms cubic-bezier(0.32, 0.72, 0, 1), min-width 520ms cubic-bezier(0.32, 0.72, 0, 1), opacity 380ms cubic-bezier(0.32, 0.72, 0, 1)'
            }}
            aria-hidden={!activePanel}
          >
            {/* Resize handle — left-edge grabbable strip on the floating
                pane. Drag sets pane width in PX; release commits. The
                handle's parent rect tells us the pane's right edge so the
                pointer-x maps cleanly to the new width. */}
            {activePanel && !chatMinimized ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize side panel"
                className="absolute left-0 top-0 z-40 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-accent-500/30 active:bg-accent-500/60"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const pane = e.currentTarget.parentElement
                  if (!pane) return
                  const rect = pane.getBoundingClientRect()
                  const onMove = (ev: MouseEvent): void => {
                    const widthPx = rect.right - ev.clientX
                    setPanelWidth(widthPx)
                  }
                  const onUp = (): void => {
                    document.removeEventListener('mousemove', onMove)
                    document.removeEventListener('mouseup', onUp)
                    document.body.style.userSelect = ''
                  }
                  document.body.style.userSelect = 'none'
                  document.addEventListener('mousemove', onMove)
                  document.addEventListener('mouseup', onUp)
                }}
                onDoubleClick={() => setPanelWidth(720)}
                title="Drag to resize · double-click to reset"
              />
            ) : null}
            <div className="absolute inset-0">
              <CodeEditor
                open={activePanel === 'editor'}
                onClose={closePanel}
                mode="inline"
              />
              <Dashboard
                open={activePanel === 'dashboard'}
                onClose={closePanel}
                mode="inline"
              />
              {/* Side-mode portal slot for the terminals UI. Kept mounted
                  in the DOM (display:none when inactive) so the portalled
                  TerminalsPanel keeps its xterm instances alive even when
                  the user flips to a different side panel. */}
              <div
                ref={setSideHost}
                className="absolute inset-0"
                style={{
                  display:
                    terminalsPosition === 'side' && activePanel === 'terminals'
                      ? 'block'
                      : 'none'
                }}
              />
            </div>
          </div>
          </div>

          {/* Terminals bottom dock — only rendered when the view is set
              to 'bottom'. Holds a portal host div so the TerminalsPanel
              (mounted once, below) lands here. In 'side' mode this
              whole wrapper is skipped and the portal lands in the slide
              pane instead. */}
          {terminalsPosition === 'bottom' ? (
            <div
              className={`relative flex shrink-0 flex-col overflow-hidden bg-bg-2 transition-[height,opacity] duration-[280ms] ${
                terminalsOpenBottom ? 'border-t border-border-mid' : ''
              }`}
              style={{
                height: terminalsOpenBottom ? terminalsHeight : 0,
                opacity: terminalsOpenBottom ? 1 : 0,
                // Same iOS easing as the slide panel so opening any panel
                // feels consistent across edges (right + bottom).
                transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)'
              }}
              aria-hidden={!terminalsOpenBottom}
            >
              {terminalsOpenBottom ? (
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize terminals panel"
                  className="absolute left-0 right-0 top-0 z-20 h-1.5 cursor-row-resize bg-transparent transition-colors hover:bg-accent-500/40 active:bg-accent-500/60"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    const startY = e.clientY
                    const startHeight = terminalsHeight
                    let rafId: number | null = null
                    let latest = startHeight
                    const onMove = (ev: MouseEvent): void => {
                      latest = startHeight - (ev.clientY - startY)
                      if (rafId !== null) return
                      rafId = requestAnimationFrame(() => {
                        rafId = null
                        setTerminalsHeight(
                          Math.min(
                            TERMINALS_HEIGHT_MAX,
                            Math.max(TERMINALS_HEIGHT_MIN, latest)
                          )
                        )
                      })
                    }
                    const onUp = (): void => {
                      if (rafId !== null) cancelAnimationFrame(rafId)
                      setTerminalsHeight(
                        Math.min(
                          TERMINALS_HEIGHT_MAX,
                          Math.max(TERMINALS_HEIGHT_MIN, latest)
                        )
                      )
                      document.removeEventListener('mousemove', onMove)
                      document.removeEventListener('mouseup', onUp)
                      document.body.style.userSelect = ''
                    }
                    document.body.style.userSelect = 'none'
                    document.addEventListener('mousemove', onMove)
                    document.addEventListener('mouseup', onUp)
                  }}
                  title="Drag to resize"
                />
              ) : null}
              <div ref={setBottomHost} className="relative min-h-0 flex-1" />
            </div>
          ) : null}
          </div>

          {/* Right column (Sessions + Toolkit) — fully hides when the
              user toggles `panel.sessions` (default mod+q), animating
              its width to 0 the same way the left projects drawer does.
              No leftover strip; the same keybind brings it back. */}
          <div
            className={`relative flex shrink-0 flex-col overflow-hidden border-l ${
              rightPanelHidden ? 'border-transparent' : 'border-transparent'
            } transition-[width,opacity] duration-[280ms]`}
            style={{
              width: rightPanelHidden ? 0 : rightColumnWidth,
              opacity: rightPanelHidden ? 0 : 1,
              transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)'
            }}
            aria-hidden={rightPanelHidden}
          >
            <div
              className="relative flex h-full w-full flex-col overflow-hidden"
              style={{ width: rightColumnWidth }}
            >
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize right column"
                className="absolute left-0 top-0 z-20 h-full w-2 cursor-col-resize bg-border-soft/0 transition-colors hover:bg-accent-500/40 active:bg-accent-500/70"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const startX = e.clientX
                  const startWidth = rightColumnWidth
                  let rafId: number | null = null
                  let latest = startWidth
                  const onMove = (ev: MouseEvent): void => {
                    latest = startWidth - (ev.clientX - startX)
                    if (rafId !== null) return
                    rafId = requestAnimationFrame(() => {
                      rafId = null
                      setRightColumnWidth(latest)
                    })
                  }
                  const onUp = (): void => {
                    if (rafId !== null) cancelAnimationFrame(rafId)
                    setRightColumnWidth(latest)
                    document.removeEventListener('mousemove', onMove)
                    document.removeEventListener('mouseup', onUp)
                    document.body.style.userSelect = ''
                  }
                  document.body.style.userSelect = 'none'
                  document.addEventListener('mousemove', onMove)
                  document.addEventListener('mouseup', onUp)
                }}
                onDoubleClick={() => setRightColumnWidth(RIGHT_COLUMN_DEFAULT)}
                title="Drag to resize · double-click to reset"
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <SessionsPanel />
              </div>
              <div
                className="flex shrink-0 flex-col overflow-hidden border-t border-border-soft"
                style={{ height: '45%' }}
              >
                <ToolkitGrid
                  cwd={contextCwd}
                  activeSessionId={activeSession?.id ?? null}
                  activeSessionPtyId={activeSession?.ptyId ?? null}
                  canSendToSession={
                    activeSession?.state === 'userInput' || activeSession?.state === 'idle'
                  }
                />
              </div>
            </div>
          </div>
        </main>

        <StatusBar />
      </div>

      {/* True overlays (not slide panels) */}
      <ToolkitEditorDialog />
      <Toasts />
      <SessionReplyToaster />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <NewSessionDialog open={spawnOpen} onClose={hideSpawn} />

      {/* Guided-tour overlay. Always mounted; renders nothing when the
          store has no active tour id. */}
      <TourHost />

      {/* First-run welcome screen — only the very first time the user
          opens the app. After dismissal writes hydra.welcome.shown. */}
      <WelcomeGate />
      {orchestraEnabled && orchestraOpen ? (
        <div className="fixed inset-0 z-[60] bg-bg-0">
          <OrchestraView onBackToClassic={() => setOrchestraOpen(false)} />
        </div>
      ) : null}

      {/* Single TerminalsPanel mount — portalled into whichever slot matches
          the user's chosen view (bottom dock or side slide-pane slot).
          Moving the portal target preserves xterm state across a swap. */}
      {terminalsHost
        ? createPortal(
            <TerminalsPanel open={terminalsVisible} onClose={closeTerminals} />,
            terminalsHost
          )
        : null}
    </div>
  )
}
