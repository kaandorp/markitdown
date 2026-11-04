import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'

interface Item {
  title: string
  hint: string
  keywords: string
  run: (editor: Editor, range: Range) => void
}

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range)

export const INSERT_ITEMS: Item[] = [
  { title: 'Text', hint: 'Plain paragraph', keywords: 'paragraph p normal', run: (e, r) => chain(e, r).setParagraph().run() },
  { title: 'Heading 1', hint: '#', keywords: 'h1 title', run: (e, r) => chain(e, r).setHeading({ level: 1 }).run() },
  { title: 'Heading 2', hint: '##', keywords: 'h2 subtitle', run: (e, r) => chain(e, r).setHeading({ level: 2 }).run() },
  { title: 'Heading 3', hint: '###', keywords: 'h3', run: (e, r) => chain(e, r).setHeading({ level: 3 }).run() },
  { title: 'Bullet list', hint: '-', keywords: 'ul unordered bullets', run: (e, r) => chain(e, r).toggleBulletList().run() },
  { title: 'Numbered list', hint: '1.', keywords: 'ol ordered numbers', run: (e, r) => chain(e, r).toggleOrderedList().run() },
  { title: 'Task list', hint: '- [ ]', keywords: 'todo checkbox check', run: (e, r) => chain(e, r).toggleTaskList().run() },
  { title: 'Quote', hint: '>', keywords: 'blockquote citation', run: (e, r) => chain(e, r).setBlockquote().run() },
  { title: 'Code block', hint: '```', keywords: 'pre snippet fence', run: (e, r) => chain(e, r).setCodeBlock().run() },
  { title: 'Table', hint: '3×3', keywords: 'grid rows columns', run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Divider', hint: '---', keywords: 'hr horizontal rule separator line', run: (e, r) => chain(e, r).setHorizontalRule().run() },
]

function filterItems(query: string): Item[] {
  const q = query.toLowerCase().trim()
  if (!q) return INSERT_ITEMS
  return INSERT_ITEMS.filter((i) => `${i.title} ${i.keywords}`.toLowerCase().includes(q))
}

function createRenderer() {
  let el: HTMLDivElement | null = null
  let props: SuggestionProps<Item> | null = null
  let active = 0

  const draw = () => {
    if (!el || !props) return
    el.replaceChildren()
    if (!props.items.length) {
      const empty = document.createElement('div')
      empty.className = 'insert-empty'
      empty.textContent = 'No matching blocks'
      el.append(empty)
    }
    props.items.forEach((item, i) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'insert-item' + (i === active ? ' is-active' : '')
      btn.setAttribute('role', 'option')
      btn.setAttribute('aria-selected', String(i === active))
      const title = document.createElement('span')
      title.textContent = item.title
      const hint = document.createElement('kbd')
      hint.textContent = item.hint
      btn.append(title, hint)
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        props?.command(item)
      })
      btn.addEventListener('mouseenter', () => {
        active = i
        draw()
      })
      el!.append(btn)
    })
    el.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
    place()
  }

  const place = () => {
    const rect = props?.clientRect?.()
    if (!el || !rect) return
    const menu = el.getBoundingClientRect()
    let top = rect.bottom + 6
    if (top + menu.height > window.innerHeight - 8) top = Math.max(8, rect.top - menu.height - 6)
    const left = Math.min(rect.left, window.innerWidth - menu.width - 8)
    el.style.top = `${top}px`
    el.style.left = `${Math.max(8, left)}px`
  }

  return {
    onStart(p: SuggestionProps<Item>) {
      props = p
      active = 0
      el = document.createElement('div')
      el.className = 'insert-menu'
      el.setAttribute('role', 'listbox')
      document.body.append(el)
      draw()
    },
    onUpdate(p: SuggestionProps<Item>) {
      props = p
      active = Math.min(active, Math.max(0, p.items.length - 1))
      draw()
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      if (!props) return false
      const n = props.items.length
      if (event.key === 'ArrowDown' && n) {
        active = (active + 1) % n
        draw()
        return true
      }
      if (event.key === 'ArrowUp' && n) {
        active = (active - 1 + n) % n
        draw()
        return true
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && n) {
        props.command(props.items[active])
        return true
      }
      return false
    },
    onExit() {
      el?.remove()
      el = null
      props = null
    },
  }
}

/**
 * Typing "@" at the start of a line or after a space opens a block menu.
 * "name@example.com" does not trigger it; Esc or a space dismisses it and
 * leaves the literal "@".
 */
export const InsertMenu = Extension.create({
  name: 'insertMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion<Item, Item>({
        pluginKey: new PluginKey('insertMenu'),
        editor: this.editor,
        char: '@',
        allowSpaces: false,
        allowedPrefixes: [' ', ' '],
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => filterItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: createRenderer,
      }),
    ]
  },
})
