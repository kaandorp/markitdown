/**
 * Command palette: ⌘K on Mac, Ctrl+K elsewhere.
 *
 * A filterable list of every command in the app. Commands are rebuilt each
 * time it opens, so titles reflect the current state ("Hide Markdown source",
 * "Switch to dark theme") and commands that don't apply right now are left
 * out. The chosen command runs synchronously inside the keypress or click, so
 * actions that need a user gesture (file pickers, permission prompts) work.
 */

export interface Command {
  id: string
  title: string
  group: string
  /** Extra words to match, e.g. "h1 title" for Heading 1. */
  keywords?: string
  /** Shortcut shown on the right, e.g. "⌘B". */
  shortcut?: string
  run: () => void
}

const KEY_RECENT = 'markitdown:recent-commands'
const MAX_RECENT = 5

export const isMac = /Mac|iP(hone|ad)/.test(navigator.platform)
export const paletteShortcut = isMac ? '⌘K' : 'Ctrl+K'

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_RECENT) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeRecent(ids: string[]) {
  try {
    localStorage.setItem(KEY_RECENT, JSON.stringify(ids.slice(0, MAX_RECENT)))
  } catch {
    /* storage unavailable */
  }
}

/**
 * Score how well `query` matches `text` (higher is better; 0 = no match):
 * prefix > word start > substring > letters in order.
 */
function score(query: string, text: string): number {
  if (!query) return 1
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  if (t.startsWith(q)) return 100
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return 80
  if (t.includes(q)) return 60
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length ? 20 : 0
}

export function createPalette(getCommands: () => Command[]) {
  // ---- DOM ----------------------------------------------------------------
  const backdrop = document.createElement('div')
  backdrop.className = 'palette-backdrop'
  backdrop.hidden = true

  const dialog = document.createElement('div')
  dialog.className = 'palette'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', 'Command palette')

  const field = document.createElement('div')
  field.className = 'palette-field'
  field.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-search"></use></svg>'
  const input = document.createElement('input')
  input.className = 'palette-input'
  input.type = 'text'
  input.placeholder = 'Type a command'
  input.spellcheck = false
  input.autocomplete = 'off'
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-expanded', 'true')
  input.setAttribute('aria-controls', 'palette-list')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-label', 'Search commands')
  const kbd = document.createElement('kbd')
  kbd.className = 'palette-esc'
  kbd.textContent = 'Esc'
  field.append(input, kbd)

  const list = document.createElement('div')
  list.className = 'palette-list'
  list.id = 'palette-list'
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', 'Commands')

  dialog.append(field, list)
  backdrop.append(dialog)
  document.body.append(backdrop)

  // ---- state --------------------------------------------------------------
  let commands: Command[] = []
  let shown: Command[] = []
  let active = 0
  let returnFocus: HTMLElement | null = null

  const isOpen = () => !backdrop.hidden

  function render() {
    const q = input.value.trim()
    list.replaceChildren()

    let sections: { title: string; items: Command[] }[]
    if (!q) {
      // Recently used first, then everything by group in its natural order.
      const recent = readRecent()
        .map((id) => commands.find((c) => c.id === id))
        .filter((c): c is Command => !!c)
      const groups = new Map<string, Command[]>()
      for (const c of commands) groups.set(c.group, [...(groups.get(c.group) ?? []), c])
      sections = [
        ...(recent.length ? [{ title: 'Recently used', items: recent }] : []),
        ...[...groups].map(([title, items]) => ({ title, items })),
      ]
    } else {
      const ranked = commands
        .map((c) => ({ c, s: Math.max(score(q, c.title), score(q, c.keywords ?? '') * 0.8, score(q, c.group) * 0.5) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.c)
      sections = ranked.length ? [{ title: '', items: ranked }] : []
    }

    shown = sections.flatMap((s) => s.items)
    active = Math.min(active, Math.max(0, shown.length - 1))

    if (!shown.length) {
      const empty = document.createElement('div')
      empty.className = 'palette-empty'
      empty.textContent = 'No matching commands'
      list.append(empty)
      input.removeAttribute('aria-activedescendant')
      return
    }

    let index = 0
    for (const section of sections) {
      const group = document.createElement('div')
      group.setAttribute('role', 'group')
      if (section.title) {
        const label = document.createElement('div')
        label.className = 'palette-group'
        label.id = `palette-g-${index}`
        label.textContent = section.title
        group.setAttribute('aria-labelledby', label.id)
        group.append(label)
      }
      for (const cmd of section.items) {
        const i = index++
        const item = document.createElement('div')
        item.className = 'palette-item' + (i === active ? ' is-active' : '')
        item.id = `palette-opt-${i}`
        item.setAttribute('role', 'option')
        item.setAttribute('aria-selected', String(i === active))
        const title = document.createElement('span')
        title.textContent = cmd.title
        item.append(title)
        if (cmd.shortcut) {
          const k = document.createElement('kbd')
          k.textContent = cmd.shortcut
          item.append(k)
        }
        item.addEventListener('mousemove', () => {
          if (active !== i) setActive(i)
        })
        item.addEventListener('mousedown', (e) => e.preventDefault()) // keep focus in the input
        item.addEventListener('click', () => runAt(i))
        group.append(item)
      }
      list.append(group)
    }
    setActive(active, false)
  }

  function setActive(i: number, scroll = true) {
    active = i
    list.querySelectorAll('.palette-item').forEach((el, j) => {
      el.classList.toggle('is-active', j === i)
      el.setAttribute('aria-selected', String(j === i))
    })
    input.setAttribute('aria-activedescendant', `palette-opt-${i}`)
    if (scroll) list.querySelector(`#palette-opt-${i}`)?.scrollIntoView({ block: 'nearest' })
  }

  function runAt(i: number) {
    const cmd = shown[i]
    if (!cmd) return
    writeRecent([cmd.id, ...readRecent().filter((id) => id !== cmd.id)])
    close(false)
    // Synchronous, inside the user's keypress or click.
    cmd.run()
  }

  function open() {
    if (isOpen()) return
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    commands = getCommands()
    input.value = ''
    active = 0
    backdrop.hidden = false
    render()
    input.focus()
  }

  function close(restoreFocus = true) {
    if (!isOpen()) return
    backdrop.hidden = true
    if (restoreFocus) returnFocus?.focus()
    returnFocus = null
  }

  // ---- events -------------------------------------------------------------
  input.addEventListener('input', () => {
    active = 0
    render()
  })
  input.addEventListener('keydown', (e) => {
    const n = shown.length
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault()
      setActive((active + 1) % n)
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault()
      setActive((active - 1 + n) % n)
    } else if ((e.key === 'Home' || e.key === 'End') && n && !input.value) {
      e.preventDefault()
      setActive(e.key === 'Home' ? 0 : n - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runAt(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      e.preventDefault() // keep focus in the dialog
    }
  })
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) {
      e.preventDefault()
      close()
    }
  })

  // ⌘K / Ctrl+K toggles it from anywhere, ahead of the editors' own keys.
  document.addEventListener(
    'keydown',
    (e) => {
      const modKey = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (!modKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      e.stopPropagation()
      if (isOpen()) close()
      else open()
    },
    true,
  )

  return { open, close, isOpen }
}
