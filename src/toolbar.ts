import type { Editor } from '@tiptap/core'

interface Btn {
  label: string
  /** Sprite icon id (see index.html); shown instead of the label. */
  icon?: string
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
    { label: 'I', cls: 'it', title: `Italic (${mod}I)`, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
    { label: 'S', cls: 's', title: `Strikethrough (${mod}Shift+S)`, run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
    { label: 'Code', icon: 'i-code', title: `Inline code (${mod}E)`, run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive('code') },
    { label: 'Link', icon: 'i-link', title: 'Link', run: promptLink, active: (e) => e.isActive('link') },
  ],
  [
    { label: 'Bullets', icon: 'i-ul', title: `Bullet list (${mod}Shift+8)`, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
    { label: 'Numbers', icon: 'i-ol', title: `Numbered list (${mod}Shift+7)`, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
    { label: 'Tasks', icon: 'i-tasks', title: `Task list (${mod}Shift+9)`, run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive('taskList') },
    { label: 'Quote', icon: 'i-quote', title: `Quote (${mod}Shift+B)`, run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
    { label: 'Code block', icon: 'i-codeblock', title: `Code block (${mod}Alt+C)`, run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive('codeBlock') },
    { label: 'Table', icon: 'i-table', title: 'Insert table', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: 'Divider', icon: 'i-hr', title: 'Divider', run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
  [
    { label: 'Add row', title: 'Add row below', visible: inTable, run: (e) => e.chain().focus().addRowAfter().run() },
    { label: 'Add column', title: 'Add column right', visible: inTable, run: (e) => e.chain().focus().addColumnAfter().run() },
    { label: 'Delete row', title: 'Delete row', visible: inTable, run: (e) => e.chain().focus().deleteRow().run() },
    { label: 'Delete column', title: 'Delete column', visible: inTable, run: (e) => e.chain().focus().deleteColumn().run() },
    { label: 'Delete table', title: 'Delete table', visible: inTable, run: (e) => e.chain().focus().deleteTable().run() },
  ],
  [
    { label: 'Undo', icon: 'i-undo', title: `Undo (${mod}Z)`, run: (e) => e.chain().focus().undo().run() },
    { label: 'Redo', icon: 'i-redo', title: `Redo (${mod}Shift+Z)`, run: (e) => e.chain().focus().redo().run() },
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
      if (def.icon) {
        btn.innerHTML = `<svg class="i" aria-hidden="true"><use href="#${def.icon}"></use></svg>`
        btn.classList.add('icon')
      } else {
        btn.textContent = def.label
      }
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
