import { RangeSetBuilder, StateField, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  gutter,
  GutterMarker,
} from '@codemirror/view'

/**
 * Per-line annotation derived from a unified diff.
 * - 'added'          → line exists only in the new side
 * - 'modified'       → a `+` line that immediately followed a `-` line
 * - 'deleted-before' → current file has this line but a deletion chunk
 *                      sat right before it — paint a marker in the gutter
 *                      so the user sees something was removed there
 */
type LineMark = 'added' | 'modified' | 'deleted-before'

function parseDiffToLineMarks(patch: string): Map<number, LineMark> {
  const out = new Map<number, LineMark>()
  if (!patch) return out
  const lines = patch.split('\n')
  let newLine = 0
  let pendingDel = false

  for (const raw of lines) {
    if (raw.startsWith('@@')) {
      const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (match && match[1]) newLine = parseInt(match[1], 10)
      pendingDel = false
      continue
    }
    // Skip non-body lines.
    if (
      raw.startsWith('diff ') ||
      raw.startsWith('index ') ||
      raw.startsWith('+++') ||
      raw.startsWith('---') ||
      raw.startsWith('new file') ||
      raw.startsWith('deleted file') ||
      raw.startsWith('rename ') ||
      raw.startsWith('similarity ') ||
      raw.startsWith('Binary ') ||
      raw.startsWith('\\')
    ) {
      continue
    }

    if (raw.startsWith('+')) {
      out.set(newLine, pendingDel ? 'modified' : 'added')
      newLine++
      pendingDel = false
    } else if (raw.startsWith('-')) {
      pendingDel = true
      // Deleted lines don't exist in the current buffer, so we don't
      // advance newLine. The gutter marker lands on the next context
      // line via the pendingDel flag.
    } else {
      if (pendingDel) {
        const prev = out.get(newLine)
        if (!prev) out.set(newLine, 'deleted-before')
      }
      newLine++
      pendingDel = false
    }
  }
  return out
}

// -------------- CodeMirror state --------------

/** Swap the current diff patch. Triggers a redraw of the decorations. */
export const setDiffPatch = StateEffect.define<string>()

/** Null out the patch (e.g. when the user switches to a clean file). */
export const clearDiffPatch = StateEffect.define<null>()

interface DiffFieldValue {
  patch: string
  marks: Map<number, LineMark>
}

const diffField = StateField.define<DiffFieldValue>({
  create: () => ({ patch: '', marks: new Map() }),
  update(value, tr) {
    for (const eff of tr.effects) {
      if (eff.is(setDiffPatch)) {
        const patch = eff.value
        return { patch, marks: parseDiffToLineMarks(patch) }
      }
      if (eff.is(clearDiffPatch)) {
        return { patch: '', marks: new Map() }
      }
    }
    return value
  },
})

// -------------- line decorations --------------

const addedLine = Decoration.line({ class: 'cm-diff-added' })
const modifiedLine = Decoration.line({ class: 'cm-diff-modified' })
const deletedBeforeLine = Decoration.line({ class: 'cm-diff-deleted-before' })

function buildDecorations(view: EditorView): DecorationSet {
  const { marks } = view.state.field(diffField)
  if (marks.size === 0) return Decoration.none
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  // Iterate visible ranges only — cheap enough for any real file.
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = doc.lineAt(pos)
      const mark = marks.get(line.number)
      if (mark === 'added') builder.add(line.from, line.from, addedLine)
      else if (mark === 'modified') builder.add(line.from, line.from, modifiedLine)
      else if (mark === 'deleted-before')
        builder.add(line.from, line.from, deletedBeforeLine)
      if (line.to >= to) break
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const decorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_value, tr) {
    // Rebuild whenever the doc or the diff patch changes. Cheap: we
    // reuse the pre-parsed marks and just walk visible ranges.
    // Using tr.state directly with a dummy view would miss viewport
    // updates — we approximate with full-doc iteration here, which is
    // fine for files up to a few thousand lines.
    if (!tr.docChanged && !tr.effects.some((e) => e.is(setDiffPatch) || e.is(clearDiffPatch))) {
      return _value
    }
    const marks = tr.state.field(diffField).marks
    if (marks.size === 0) return Decoration.none
    const builder = new RangeSetBuilder<Decoration>()
    const doc = tr.state.doc
    for (let n = 1; n <= doc.lines; n++) {
      const mark = marks.get(n)
      if (!mark) continue
      const line = doc.line(n)
      if (mark === 'added') builder.add(line.from, line.from, addedLine)
      else if (mark === 'modified') builder.add(line.from, line.from, modifiedLine)
      else if (mark === 'deleted-before')
        builder.add(line.from, line.from, deletedBeforeLine)
    }
    return builder.finish()
  },
  provide: (f) => EditorView.decorations.from(f),
})

// -------------- gutter --------------

class DiffMarker extends GutterMarker {
  constructor(private readonly kind: LineMark) {
    super()
  }
  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = `cm-diff-gutter cm-diff-gutter-${this.kind}`
    return el
  }
}

const markers = {
  added: new DiffMarker('added'),
  modified: new DiffMarker('modified'),
  'deleted-before': new DiffMarker('deleted-before'),
}

const diffGutter = gutter({
  class: 'cm-diff-gutter-col',
  lineMarker(view, line) {
    const marks = view.state.field(diffField).marks
    const n = view.state.doc.lineAt(line.from).number
    const m = marks.get(n)
    if (!m) return null
    return markers[m]
  },
  initialSpacer: () => new DiffMarker('added'),
})

// -------------- theme --------------

const diffTheme = EditorView.baseTheme({
  '.cm-diff-added': {
    backgroundColor: 'rgba(46, 204, 113, 0.10)',
  },
  '.cm-diff-modified': {
    backgroundColor: 'rgba(255, 184, 41, 0.10)',
  },
  '.cm-diff-deleted-before': {
    borderTop: '2px solid rgba(255, 77, 93, 0.55)',
  },
  '.cm-diff-gutter-col': {
    width: '3px',
    padding: '0',
    background: 'transparent',
  },
  '.cm-diff-gutter': {
    width: '3px',
    height: '100%',
  },
  '.cm-diff-gutter-added': {
    backgroundColor: '#2ecc71',
  },
  '.cm-diff-gutter-modified': {
    backgroundColor: '#ffb829',
  },
  '.cm-diff-gutter-deleted-before': {
    background: 'linear-gradient(to bottom, #ff4d5d 0 35%, transparent 35%)',
  },
})

/** All extensions needed for diff highlighting in CodeMirror. */
export function diffExtension() {
  return [diffField, decorationField, diffGutter, diffTheme]
}
