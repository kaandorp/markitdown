/**
 * Keeps the two panes vertically aligned by content.
 *
 * Every top-level block in the rich-text pane (heading, paragraph, list,
 * table, code block, …) is matched to the line its Markdown starts on. Those
 * pairs are anchors; positions between anchors are interpolated. Scrolling one
 * pane, or editing in it, moves the other so the same content sits at the same
 * height on screen: at the caret while you type, at the middle of the pane
 * while you scroll. When the block lists can't be matched one-to-one, it falls
 * back to keeping both panes at the same relative position.
 */
import { Lexer } from 'marked'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@codemirror/view'

type Side = 'left' | 'right'
type Anchor = [left: number, right: number]

interface Options {
  editor: Editor
  /** The scrolling element around the rich-text editor. */
  leftScroller: HTMLElement
  source: EditorView
  enabled: () => boolean
}

/** 1-based line numbers where each top-level Markdown block starts. */
function blockStartLines(md: string): number[] {
  const lines: number[] = []
  let line = 1
  for (const token of new Lexer({ gfm: true }).lex(md)) {
    if (token.type !== 'space' && token.type !== 'def') lines.push(line)
    line += (token.raw.match(/\n/g) ?? []).length
  }
  return lines
}

export function createScrollSync({ editor, leftScroller, source, enabled }: Options) {
  const rightScroller = source.scrollDOM

  // Block start lines are cached per source text.
  let cachedText = ''
  let cachedLines: number[] = []
  const sourceBlockLines = () => {
    const text = source.state.doc.toString()
    if (text !== cachedText) {
      cachedText = text
      try {
        cachedLines = blockStartLines(text)
      } catch {
        cachedLines = []
      }
    }
    return cachedLines
  }

  /** Content-relative y (from the scroller's content top) of an element's top. */
  const leftY = (el: Element) =>
    el.getBoundingClientRect().top - leftScroller.getBoundingClientRect().top + leftScroller.scrollTop

  const rightLineY = (lineNo: number) => {
    const { doc } = source.state
    const line = doc.line(Math.min(Math.max(lineNo, 1), doc.lines))
    const block = source.lineBlockAt(line.from)
    return block.top + source.documentTop - rightScroller.getBoundingClientRect().top + rightScroller.scrollTop
  }

  /** Matching (left y, right y) pairs, monotonic in both, framed by the content ends. */
  function anchors(): Anchor[] {
    const leftMax = leftScroller.scrollHeight
    const rightMax = rightScroller.scrollHeight
    const pairs: Anchor[] = [[0, 0]]

    // Top-level blocks on the left, skipping empty paragraphs (they have no Markdown).
    const blocks: Element[] = []
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === 'paragraph' && node.content.size === 0) return
      const dom = editor.view.nodeDOM(offset)
      if (dom instanceof Element) blocks.push(dom)
    })
    const lines = sourceBlockLines()

    if (blocks.length && blocks.length === lines.length) {
      for (let i = 0; i < blocks.length; i++) {
        const pair: Anchor = [leftY(blocks[i]), rightLineY(lines[i])]
        const last = pairs[pairs.length - 1]
        if (pair[0] > last[0] && pair[1] > last[1]) pairs.push(pair)
      }
    }
    const last = pairs[pairs.length - 1]
    if (leftMax > last[0] && rightMax > last[1]) pairs.push([leftMax, rightMax])
    return pairs
  }

  /** Map a content y from one side to the other by linear interpolation. */
  function map(y: number, from: Side, pairs: Anchor[]): number {
    const a = from === 'left' ? 0 : 1
    const b = 1 - a
    for (let i = 1; i < pairs.length; i++) {
      if (y <= pairs[i][a] || i === pairs.length - 1) {
        const [p, q] = [pairs[i - 1], pairs[i]]
        const span = q[a] - p[a]
        const t = span > 0 ? Math.min(Math.max((y - p[a]) / span, 0), 1) : 0
        return p[b] + t * (q[b] - p[b])
      }
    }
    return y
  }

  const scrollerOf = (side: Side) => (side === 'left' ? leftScroller : rightScroller)

  /** Screen y of the caret in that pane, if it has focus and the caret is in view. */
  function caretY(side: Side): number | null {
    try {
      if (side === 'left') {
        if (!editor.view.hasFocus()) return null
        return editor.view.coordsAtPos(editor.state.selection.head).top
      }
      if (!source.hasFocus) return null
      return source.coordsAtPos(source.state.selection.main.head)?.top ?? null
    } catch {
      return null
    }
  }

  /**
   * The pane the user is driving: the last one they wheeled, dragged, touched,
   * typed in or moved the caret in. Scroll events on the other pane are echoes
   * (our own scrolls, or CodeMirror correcting estimated line heights) and only
   * trigger a refinement from the driver, so the panes never fight.
   */
  let driver: Side = 'left'
  let frame = 0

  function syncNow(from: Side) {
    const to: Side = from === 'left' ? 'right' : 'left'
    const fromEl = scrollerOf(from)
    const toEl = scrollerOf(to)
    // Only when both panes are on screen (phones show one at a time).
    if (!fromEl.offsetParent || !toEl.offsetParent || !fromEl.clientHeight || !toEl.clientHeight) return

    const fromRect = fromEl.getBoundingClientRect()
    const toRect = toEl.getBoundingClientRect()
    // Reference line: the caret while editing, else the middle of the pane.
    let refY = caretY(from)
    if (refY === null || refY < fromRect.top || refY > fromRect.bottom) refY = fromRect.top + fromEl.clientHeight / 2

    const contentY = refY - fromRect.top + fromEl.scrollTop
    const targetContentY = map(contentY, from, anchors())
    const max = toEl.scrollHeight - toEl.clientHeight
    const top = Math.round(Math.min(Math.max(targetContentY - (refY - toRect.top), 0), max))
    if (Math.abs(toEl.scrollTop - top) >= 1) toEl.scrollTop = top
  }

  /** Align the follower with the driver on the next frame (coalesces bursts). */
  function schedule() {
    if (!enabled() || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (enabled()) syncNow(driver)
    })
  }

  for (const side of ['left', 'right'] as const) {
    const el = scrollerOf(side)
    const take = () => (driver = side)
    for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const) {
      el.addEventListener(type, take, { passive: true, capture: true })
    }
    el.addEventListener('scroll', () => schedule(), { passive: true })
  }

  return {
    /** Content or caret changed in a pane: keep the other one level with it. */
    changed(side: Side) {
      driver = side
      schedule()
    },
    /** Re-align from the pane in use (e.g. after a resize, a toggle or a document switch). */
    resync() {
      if (editor.view.hasFocus()) driver = 'left'
      else if (source.hasFocus) driver = 'right'
      schedule()
    },
  }
}
