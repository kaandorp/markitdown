import { EditorState, Annotation, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'

/** Marks transactions that came from the WYSIWYG side, so we don't echo them back. */
export const External = Annotation.define<boolean>()

const mdHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: 'var(--md-heading)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--md-link)' },
  { tag: t.monospace, color: 'var(--md-code)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--md-mark)' },
  { tag: t.quote, color: 'var(--muted)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: '13.5px', lineHeight: '1.6' },
  '.cm-content': { padding: '16px 0', caretColor: 'var(--fg)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--faint)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--fg)' },
})

export function createSource(parent: HTMLElement, doc: string, onChange: (md: string) => void) {
  const wrap = new Compartment()
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        wrap.of(EditorView.lineWrapping),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(mdHighlight),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        placeholder('Markdown appears here — or type it directly'),
        theme,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          if (u.transactions.some((tr) => tr.annotation(External))) return
          onChange(u.state.doc.toString())
        }),
      ],
    }),
  })

  /** Replace the content with minimal changes, keeping scroll position stable. */
  const setValue = (next: string) => {
    const cur = view.state.doc.toString()
    if (cur === next) return
    let start = 0
    const max = Math.min(cur.length, next.length)
    while (start < max && cur.charCodeAt(start) === next.charCodeAt(start)) start++
    let endCur = cur.length
    let endNext = next.length
    while (endCur > start && endNext > start && cur.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)) {
      endCur--
      endNext--
    }
    view.dispatch({
      changes: { from: start, to: endCur, insert: next.slice(start, endNext) },
      annotations: [External.of(true)],
    })
  }

  return { view, setValue, getValue: () => view.state.doc.toString() }
}
