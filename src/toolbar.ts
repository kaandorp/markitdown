import type { Editor } from '@tiptap/core'

interface Btn {
  label: string
  title: string
  run: (e: Editor) => void
  active?: (e: Editor) => boolean
  /** Only shown when this returns true (e.g. table tools). */
  visible?: (e: Editor) => boolean
  cls?: string
}

const isMac = /Mac|iP(hone|ad)/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'
const inTable = (e: Editor) => e.isActive('table')

function promptLink(e: Editor) {
  const prev = (e.getAttributes('link').href as string | undefined) ?? ''
  const url = window.prompt('Link URL (leave empty to remove)', prev || 'https://')
  if (url === null) return
  if (url.trim() === '' || url.trim() === 'https://') {
    e.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  if (e.state.selection.empty && !e.isActive('link')) {
    e.chain().focus().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run()
  } else {
    e.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }
}

const GROUPS: Btn[][] = [
  [
    { label: 'P', title: 'Paragraph', run: (e) => e.chain().focus().setParagraph().run(), active: (e) => e.isActive('paragraph') },
    { label: 'H1', title: `Heading 1 (${mod}Alt+1)`, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive('heading', { level: 1 }) },
    { label: 'H2', title: `Heading 2 (${mod}Alt+2)`, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
    { label: 'H3', title: `Heading 3 (${mod}Alt+3)`, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
  ],
  [
    { label: 'B', cls: 'b', title: `Bold (${mod}B)`, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
    { label: 'I', cls: 'i', title: `Italic (${mod}I)`, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
    { label: 'S', cls: 's', title: `Strikethrough (${mod}Shift+S)`, run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
    { label: '</>', cls: 'mono', title: `Inline code (${mod}E)`, run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive('code') },
    { label: 'Link', title: 'Link', run: promptLink, active: (e) => e.isActive('link') },
  ],
  [
    { label: '• List', title: `Bullet list (${mod}Shift+8)`, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
    { label: '1. List', title: `Numbered list (${mod}Shift+7)`, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
    { label: '☐ Tasks', title: `Task list (${mod}Shift+9)`, run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive('taskList') },
    { label: '❝', title: `Quote (${mod}Shift+B)`, run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
    { label: '{ }', cls: 'mono', title: `Code block (${mod}Alt+C)`, run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive('codeBlock') },
    { label: 'Table', title: 'Insert table', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: '―', title: 'Divider', run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
  [
    { label: '+Row', title: 'Add row below', visible: inTable, run: (e) => e.chain().focus().addRowAfter().run() },
    { label: '+Col', title: 'Add column right', visible: inTable, run: (e) => e.chain().focus().addColumnAfter().run() },
    { label: '−Row', title: 'Delete row', visible: inTable, run: (e) => e.chain().focus().deleteRow().run() },
    { label: '−Col', title: 'Delete column', visible: inTable, run: (e) => e.chain().focus().deleteColumn().run() },
    { label: '✕Table', title: 'Delete table', visible: inTable, run: (e) => e.chain().focus().deleteTable().run() },
  ],
  [
    { label: '↶', title: `Undo (${mod}Z)`, run: (e) => e.chain().focus().undo().run() },
    { label: '↷', title: `Redo (${mod}Shift+Z)`, run: (e) => e.chain().focus().redo().run() },
  ],
]

export function mountToolbar(el: HTMLElement, editor: Editor) {
  const entries: { btn: HTMLButtonElement; def: Btn }[] = []
  const groups: { div: HTMLElement; defs: Btn[] }[] = []

  for (const defs of GROUPS) {
    const div = document.createElement('div')
    div.className = 'tb-group'
    for (const def of defs) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = def.label
      btn.title = def.title
      btn.setAttribute('aria-label', def.title)
      if (def.cls) btn.classList.add(def.cls)
      // Keep focus/selection in the editor.
      btn.addEventListener('mousedown', (e) => e.preventDefault())
      btn.addEventListener('click', () => def.run(editor))
      div.append(btn)
      entries.push({ btn, def })
    }
    el.append(div)
    groups.push({ div, defs })
  }

  const refresh = () => {
    for (const { btn, def } of entries) {
      if (def.active) {
        const on = def.active(editor)
        btn.classList.toggle('is-active', on)
        btn.setAttribute('aria-pressed', String(on))
      }
      if (def.visible) btn.hidden = !def.visible(editor)
    }
    for (const g of groups) g.div.hidden = g.defs.every((d) => d.visible && !d.visible(editor))
  }

  editor.on('transaction', refresh)
  editor.on('selectionUpdate', refresh)
  refresh()
}
