import { useEffect, useRef } from 'react'
import { EditorState, type Extension, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches } from '@codemirror/search'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { vim, Vim } from '@replit/codemirror-vim'
import { loadLanguageFor } from './languages'
import { clearDiffPatch, diffExtension, setDiffPatch } from './diff-extension'

/**
 * Module-level holder for the currently-mounted editor's view. Consumed
 * by the custom InlineSearch component to drive find/replace against
 * whichever file is active, and by the shell to focus the editor after
 * closing search. A single CodeMirror view is live at a time so the
 * singleton is safe. We deliberately do NOT bundle @codemirror/search's
 * default UI — the built-in panel was too far off the rest of the app's
 * styling and the user rejected it.
 */
let activeView: EditorView | null = null

export function getActiveView(): EditorView | null {
  return activeView
}

interface Props {
  /** File path — used to pick a language extension. */
  path: string
  /** Initial document text. */
  initial: string
  /** Called on every doc change. */
  onChange: (text: string) => void
  /** Cmd/Ctrl+S handler. */
  onSave: () => void
  /** When true, vim modal bindings (normal / insert / visual / command) are on. */
  vimMode?: boolean
  /** Unified diff patch for the file, if any. Used to paint green/red
   *  gutter markers + line backgrounds while the user edits. Pass null
   *  or undefined to clear. */
  diffPatch?: string | null
}

// Wire the `:w` Ex command once per module to save the active file via the
// CodeMirrorView's onSave prop. Stored in a module-local holder so the
// handler can pick the right callback for the currently-mounted view.
let activeSaveHandler: (() => void) | null = null
Vim.defineEx('w', 'w', () => {
  activeSaveHandler?.()
})
Vim.defineEx('write', 'write', () => {
  activeSaveHandler?.()
})

export default function CodeMirrorView({ path, initial, onChange, onSave, vimMode, diffPatch }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const langCompartment = useRef(new Compartment())
  const vimCompartment = useRef(new Compartment())
  const saveRef = useRef(onSave)

  // keep the `:w` handler current if onSave changes between renders.
  // Store a *stable* bridge in the module-level holder and point it at the
  // live ref. Previously the cleanup built a NEW arrow to compare against —
  // always unequal, so the holder was never cleared, leaking closures.
  useEffect(() => {
    saveRef.current = onSave
  })
  useEffect(() => {
    const bridge = (): void => saveRef.current()
    activeSaveHandler = bridge
    return () => {
      if (activeSaveHandler === bridge) activeSaveHandler = null
    }
  }, [])

  // One-time editor construction. Document changes after open are pushed via
  // the second effect (path change → reset doc + language).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const baseExtensions: Extension[] = [
      // Vim compartment FIRST so its keymap can override defaults when active.
      vimCompartment.current.of(vimMode ? vim() : []),
      lineNumbers(),
      // Diff gutter + line backgrounds — painted from the unified patch
      // dispatched via setDiffPatch / clearDiffPatch (see effect below).
      diffExtension(),
      highlightActiveLine(),
      history(),
      bracketMatching(),
      indentOnInput(),
      highlightSelectionMatches(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
        {
          key: 'Mod-s',
          run: () => {
            saveRef.current()
            return true
          }
        }
      ]),
      oneDark,
      // Force full height so the editor is scrollable on its own.
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' }
      }),
      langCompartment.current.of([]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          onChange(u.state.doc.toString())
        }
      })
    ]

    const state = EditorState.create({ doc: initial, extensions: baseExtensions })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    activeView = view

    return () => {
      if (activeView === view) activeView = null
      view.destroy()
      viewRef.current = null
    }
    // Editor is constructed once per mount; subsequent path/vim/initial updates
    // flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load + apply the language extension only when the PATH changes. Previously
  // this was combined with the doc-sync effect below, which made every single
  // keystroke (new `initial` prop) re-trigger loadLanguageFor + reconfigure.
  // On a large file that reconfigure is heavy enough to freeze the renderer.
  useEffect(() => {
    let cancelled = false
    void loadLanguageFor(path).then((ext) => {
      if (cancelled || !viewRef.current) return
      viewRef.current.dispatch({
        effects: langCompartment.current.reconfigure(ext ?? [])
      })
    })
    return () => {
      cancelled = true
    }
  }, [path])

  // Sync the editor doc when `initial` diverges from the in-editor content.
  // The `current !== initial` guard keeps our own updateListener round-trip
  // from replaying — when the user types we push the new string back up as
  // `initial`, and without the guard we'd dispatch it right back in.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === initial) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: initial }
    })
  }, [initial])

  // Toggle vim extension without rebuilding the editor.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: vimCompartment.current.reconfigure(vimMode ? vim() : [])
    })
  }, [vimMode])

  // Push the diff patch into CodeMirror as an effect. Empty / null patch
  // clears the decorations so switching to a clean file shows no marks.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (diffPatch && diffPatch.trim().length > 0) {
      view.dispatch({ effects: setDiffPatch.of(diffPatch) })
    } else {
      view.dispatch({ effects: clearDiffPatch.of(null) })
    }
  }, [diffPatch])

  return (
    <div
      ref={hostRef}
      className="df-scroll h-full w-full overflow-hidden rounded-sm border border-border-soft bg-bg-1 font-mono text-sm"
    />
  )
}
