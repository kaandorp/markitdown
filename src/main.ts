import './style.css'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { createWysiwyg } from './wysiwyg'
import { createSource } from './source'
import { mountToolbar } from './toolbar'
import { collapseBlankLines, markdownToPlainText, tidyMarkdown, trimTrailingWhitespace } from './markdown'
import { WELCOME } from './welcome'
import * as docs from './docs'

const KEY_THEME = 'markitdown:theme'
const KEY_SPLIT = 'markitdown:split'
const KEY_SIDEBAR = 'markitdown:sidebar'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* storage unavailable or full */
    }
  },
}

// ---------------------------------------------------------------- toast

let toastTimer = 0
function toast(msg: string) {
  const el = $('toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200)
}

// ---------------------------------------------------------------- editors & sync

let activeId = docs.initDocs(WELCOME)
docs.setActiveId(activeId)
const initial = docs.getContent(activeId)

/** True while the WYSIWYG is being updated from the source pane. */
let applyingFromSource = false
let sourceTimer = 0
let pendingSource: string | null = null

const editor = createWysiwyg($('wysiwyg'), initial, () => {
  if (applyingFromSource) return
  const md = tidyMarkdown(editor.getMarkdown())
  source.setValue(md)
  afterChange(md)
})

const source = createSource($('source'), '', (md) => {
  // Typing in the source pane: never rewrite it, just mirror into the WYSIWYG.
  pendingSource = md
  clearTimeout(sourceTimer)
  sourceTimer = window.setTimeout(flushSource, 120)
  scheduleSave(md)
  scheduleStats(md)
})

function flushSource() {
  clearTimeout(sourceTimer)
  if (pendingSource === null) return
  const md = pendingSource
  pendingSource = null
  applyingFromSource = true
  try {
    editor.commands.setContent(md, { contentType: 'markdown', emitUpdate: false })
  } finally {
    applyingFromSource = false
  }
}

/** The current document, as Markdown (the source pane is the truth). */
function currentMarkdown(): string {
  return source.getValue()
}

/** Replace the document in both panes. */
function setDocument(md: string) {
  pendingSource = null
  clearTimeout(sourceTimer)
  applyingFromSource = true
  try {
    editor.commands.setContent(md, { contentType: 'markdown', emitUpdate: false })
  } finally {
    applyingFromSource = false
  }
  source.setValue(md)
  afterChange(md)
}

function afterChange(md: string) {
  scheduleSave(md)
  scheduleStats(md)
}

/** Show another document: fresh content and fresh undo history in both panes. */
function loadDocument(md: string) {
  pendingSource = null
  clearTimeout(sourceTimer)
  applyingFromSource = true
  try {
    editor.commands.setContent(md, { contentType: 'markdown', emitUpdate: false })
    // A new state drops the undo history, so Ctrl+Z can't bring back the previous doc.
    editor.view.updateState(EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins }))
  } finally {
    applyingFromSource = false
  }
  // Show the source exactly as saved (the user's own text).
  source.reset(md)
  updateStats(md)
}

// Show the source exactly as saved (the user's own text).
source.reset(initial)

if (import.meta.env.DEV) Object.assign(window, { __app: { editor, source, setDocument, docs } })

// ---------------------------------------------------------------- persistence

let saveTimer = 0
let pendingSave: { id: string; md: string } | null = null
let warnedFull = false

function scheduleSave(md: string) {
  pendingSave = { id: activeId, md }
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(saveNow, 300)
}

function saveNow() {
  clearTimeout(saveTimer)
  if (!pendingSave) return
  const { id, md } = pendingSave
  pendingSave = null
  if (docs.saveContent(id, md)) {
    warnedFull = false
  } else if (!warnedFull) {
    warnedFull = true
    toast("Couldn't save: browser storage is full. Delete some documents.")
  }
  renderTabs()
}

window.addEventListener('beforeunload', () => {
  flushSource()
  saveNow()
})

// ---------------------------------------------------------------- stats

let countTokens: ((s: string) => number) | null = null
import('gpt-tokenizer')
  .then((m) => {
    countTokens = m.countTokens
    updateStats(currentMarkdown())
  })
  .catch(() => {})

let statsTimer = 0
function scheduleStats(md: string) {
  clearTimeout(statsTimer)
  statsTimer = window.setTimeout(() => updateStats(md), 150)
}

const fmt = new Intl.NumberFormat()
function updateStats(md: string) {
  const words = (markdownToPlainText(md).match(/\S+/g) ?? []).length
  const tokens = countTokens ? countTokens(md) : Math.ceil(md.length / 4)
  $('stats').textContent = `${fmt.format(md.length)} chars · ${fmt.format(words)} words · ≈${fmt.format(tokens)} tokens`
  $('stats').title = 'Token count uses the o200k tokenizer as an estimate; other models differ slightly.'
}
updateStats(currentMarkdown())

// ---------------------------------------------------------------- toolbar

mountToolbar($('toolbar'), editor)

// ---------------------------------------------------------------- clipboard

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(`${label} copied`)
  } catch {
    // Fallback for non-secure contexts.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    toast(ok ? `${label} copied` : 'Copy failed')
  }
}

$('btn-copy-md').addEventListener('click', () => {
  flushSource()
  copyText(currentMarkdown(), 'Markdown')
})
$('btn-copy-text').addEventListener('click', () => {
  flushSource()
  copyText(markdownToPlainText(currentMarkdown()), 'Plain text')
})

// ---------------------------------------------------------------- cleanup

function transformDoc(fn: (doc: PMNode, tr: import('@tiptap/pm/state').Transaction) => void) {
  flushSource()
  const tr = editor.state.tr
  fn(editor.state.doc, tr)
  if (tr.docChanged) editor.view.dispatch(tr)
  return tr.docChanged
}

const CLEANUPS: Record<string, () => boolean> = {
  'blank-lines': () => {
    const before = currentMarkdown()
    const after = collapseBlankLines(before)
    if (after !== before) setDocument(after)
    return after !== before
  },
  trailing: () => {
    const before = currentMarkdown()
    const after = trimTrailingWhitespace(before)
    if (after !== before) setDocument(after)
    return after !== before
  },
  images: () =>
    transformDoc((doc, tr) => {
      const positions: number[] = []
      doc.descendants((node, pos) => {
        if (node.type.name === 'image') positions.push(pos)
      })
      for (const pos of positions.reverse()) tr.delete(pos, pos + 1)
    }),
  links: () =>
    transformDoc((doc, tr) => {
      const link = editor.schema.marks.link
      if (link) tr.removeMark(0, doc.content.size, link)
    }),
  demote: () =>
    transformDoc((doc, tr) => {
      doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && node.attrs.level < 6) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: node.attrs.level + 1 })
        }
      })
    }),
  normalize: () => {
    flushSource()
    const before = currentMarkdown()
    const after = tidyMarkdown(editor.getMarkdown())
    if (after !== before) setDocument(after)
    return after !== before
  },
}

const cleanupBtn = $<HTMLButtonElement>('btn-cleanup')
const cleanupMenu = $('cleanup-menu')
const setMenu = (open: boolean) => {
  cleanupMenu.hidden = !open
  cleanupBtn.setAttribute('aria-expanded', String(open))
}
cleanupBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  setMenu(cleanupMenu.hidden)
})
document.addEventListener('click', () => setMenu(false))
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !cleanupMenu.hidden) setMenu(false)
})
cleanupMenu.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cleanup]')
  if (!btn) return
  const changed = CLEANUPS[btn.dataset.cleanup!]()
  toast(changed ? `${btn.textContent} — done` : 'Nothing to change')
  setMenu(false)
})

// ---------------------------------------------------------------- clear

$('btn-clear').addEventListener('click', () => {
  flushSource()
  if (!currentMarkdown().trim()) return
  // Through the WYSIWYG so Ctrl+Z there can bring it back.
  editor.chain().clearContent(true).focus().run()
  toast('Cleared — Ctrl+Z in the editor to undo')
})

// ---------------------------------------------------------------- files

const fileInput = $<HTMLInputElement>('file-input')
$('btn-open').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', async () => {
  await openFiles([...(fileInput.files ?? [])])
  fileInput.value = ''
})

/** Each file opens as a new document named after the file. */
async function openFiles(files: File[]) {
  if (!files.length) return
  let last: docs.DocMeta | null = null
  for (const file of files) {
    const text = (await file.text()).replace(/\r\n?/g, '\n')
    last = docs.createDoc(text, file.name.replace(/\.(md|markdown|txt)$/i, ''))
  }
  switchTo(last!.id)
  toast(files.length === 1 ? `Opened ${files[0].name}` : `Opened ${files.length} files`)
}

function suggestedFilename(md: string): string {
  const meta = docs.listDocs().find((d) => d.id === activeId)
  const base = meta?.name || docs.derivedTitle(md) || 'document'
  const slug = base
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
  return `${slug || 'document'}.md`
}

$('btn-save').addEventListener('click', () => {
  flushSource()
  const md = currentMarkdown()
  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedFilename(md)
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})

// Drag-and-drop a file anywhere on the page.
const overlay = $('drop-overlay')
let dragDepth = 0
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return
  dragDepth++
  overlay.hidden = false
})
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) overlay.hidden = true
})
window.addEventListener(
  'dragover',
  (e) => {
    if (hasFiles(e)) e.preventDefault()
  },
  true,
)
window.addEventListener(
  'drop',
  (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth = 0
    overlay.hidden = true
    openFiles([...e.dataTransfer!.files])
  },
  true,
)

// ---------------------------------------------------------------- documents sidebar

const tabsEl = $<HTMLUListElement>('doc-tabs')
const nameInput = $<HTMLInputElement>('doc-name')
let renamingId: string | null = null

function switchTo(id: string) {
  if (id !== activeId) {
    flushSource()
    saveNow()
    activeId = id
    docs.setActiveId(id)
    loadDocument(docs.getContent(id))
  }
  renderTabs()
  tabsEl.querySelector('.doc-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function titleOf(meta: docs.DocMeta): string {
  const content = meta.id === activeId ? currentMarkdown() : docs.getContent(meta.id)
  return docs.displayTitle(meta, content)
}

function renderTabs() {
  if (renamingId) return // don't disturb an inline rename in progress
  const list = docs.listDocs()
  // Update tabs in place (keyed by id) so a click in progress isn't lost when
  // the list re-renders between mousedown and click (e.g. on blur or autosave).
  const existing = new Map([...tabsEl.children].map((li) => [(li as HTMLElement).dataset.id!, li as HTMLLIElement]))
  list.forEach((meta, i) => {
    let li = existing.get(meta.id)
    existing.delete(meta.id)
    if (!li) {
      li = document.createElement('li')
      li.className = 'doc-tab'
      li.dataset.id = meta.id
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'doc-open'
      btn.setAttribute('role', 'tab')
      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'doc-close'
      close.textContent = '×'
      close.title = 'Delete document'
      li.append(btn, close)
    }
    if (tabsEl.children[i] !== li) tabsEl.insertBefore(li, tabsEl.children[i] ?? null)

    const active = meta.id === activeId
    const title = titleOf(meta)
    const btn = li.querySelector<HTMLButtonElement>('.doc-open')!
    li.classList.toggle('is-active', active)
    btn.setAttribute('aria-selected', String(active))
    btn.tabIndex = active ? 0 : -1
    if (btn.textContent !== title) btn.textContent = title
    btn.title = `${title}\nDouble-click to rename`
    btn.classList.toggle('is-derived', !meta.name)
    li.querySelector('.doc-close')!.setAttribute('aria-label', `Delete ${title}`)
  })
  for (const li of existing.values()) li.remove()

  const active = list.find((d) => d.id === activeId)
  if (document.activeElement !== nameInput) nameInput.value = active?.name ?? ''
  nameInput.placeholder = active ? docs.derivedTitle(currentMarkdown()) || 'Untitled' : 'Untitled'
  document.title = active ? `${titleOf(active)} · Markitdown` : 'Markitdown'
}

function newDocument() {
  flushSource()
  saveNow()
  const meta = docs.createDoc('')
  switchTo(meta.id)
  editor.commands.focus()
}

function deleteDocument(id: string) {
  const list = docs.listDocs()
  const meta = list.find((d) => d.id === id)
  if (!meta) return
  if (id === activeId) {
    flushSource()
    saveNow()
  }
  const content = docs.getContent(id)
  if (content.trim() && !window.confirm(`Delete “${titleOf(meta)}”? This can't be undone.`)) return

  const idx = list.findIndex((d) => d.id === id)
  docs.deleteDoc(id)
  const rest = docs.listDocs()
  if (!rest.length) {
    activeId = '' // force a load of the new doc
    switchTo(docs.createDoc('').id)
  } else if (id === activeId) {
    activeId = ''
    switchTo(rest[Math.min(idx, rest.length - 1)].id)
  } else {
    renderTabs()
  }
}

function startRename(li: HTMLLIElement) {
  const id = li.dataset.id!
  const meta = docs.listDocs().find((d) => d.id === id)
  if (!meta) return
  renamingId = id
  const input = document.createElement('input')
  input.className = 'doc-rename'
  input.value = meta.name
  input.placeholder = titleOf({ ...meta, name: '' })
  input.maxLength = 120
  input.setAttribute('aria-label', 'Document name')
  const btn = li.querySelector<HTMLButtonElement>('.doc-open')!
  btn.hidden = true
  btn.after(input)
  input.focus()
  input.select()

  let done = false
  const finish = (commit: boolean) => {
    if (done) return
    done = true
    if (commit) docs.renameDoc(id, input.value)
    renamingId = null
    input.remove()
    btn.hidden = false
    renderTabs()
    if (li.isConnected) btn.focus()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    if (e.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
}

tabsEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const li = target.closest<HTMLLIElement>('.doc-tab')
  if (!li) return
  if (target.closest('.doc-close')) deleteDocument(li.dataset.id!)
  else if (target.closest('.doc-open')) switchTo(li.dataset.id!)
})
tabsEl.addEventListener('dblclick', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLLIElement>('.doc-tab')
  if (li && (e.target as HTMLElement).closest('.doc-open')) startRename(li)
})
tabsEl.addEventListener('keydown', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLLIElement>('.doc-tab')
  if (!li || !(e.target as HTMLElement).matches('.doc-open')) return
  if (e.key === 'F2') {
    e.preventDefault()
    startRename(li)
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const sib = (e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling) as HTMLElement | null
    sib?.querySelector<HTMLElement>('.doc-open')?.focus()
  }
})

$('btn-new').addEventListener('click', newDocument)

nameInput.addEventListener('input', () => {
  docs.renameDoc(activeId, nameInput.value)
  renderTabs()
})
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') {
    e.preventDefault()
    editor.commands.focus()
  }
})
nameInput.addEventListener('blur', () => {
  nameInput.value = nameInput.value.trim()
  renderTabs()
})

// Another browser tab changed the document list: refresh ours.
window.addEventListener('storage', (e) => {
  if (e.key === 'markitdown:docs') {
    if (!docs.listDocs().some((d) => d.id === activeId)) {
      const first = docs.listDocs()[0]
      activeId = ''
      switchTo(first ? first.id : docs.createDoc('').id)
    } else {
      renderTabs()
    }
  }
})

// Show / hide the sidebar.
const workspace = $('workspace')
const sidebarBtn = $('btn-sidebar')
const setSidebar = (open: boolean) => {
  workspace.classList.toggle('sidebar-hidden', !open)
  sidebarBtn.setAttribute('aria-expanded', String(open))
  store.set(KEY_SIDEBAR, open ? '1' : '0')
}
setSidebar(store.get(KEY_SIDEBAR) !== '0')
sidebarBtn.addEventListener('click', () => setSidebar(workspace.classList.contains('sidebar-hidden')))

renderTabs()

// ---------------------------------------------------------------- theme

const media = window.matchMedia('(prefers-color-scheme: dark)')
const effectiveTheme = () => document.documentElement.dataset.theme ?? (media.matches ? 'dark' : 'light')
const themeBtn = $('btn-theme')
const paintThemeBtn = () => (themeBtn.textContent = effectiveTheme() === 'dark' ? '☀ Light' : '☾ Dark')
paintThemeBtn()
media.addEventListener('change', paintThemeBtn)
themeBtn.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  store.set(KEY_THEME, next)
  paintThemeBtn()
})

// ---------------------------------------------------------------- resizable split

const split = $('split')
const divider = $('divider')
const setSplit = (pct: number) => {
  const clamped = Math.min(80, Math.max(20, pct))
  split.style.setProperty('--left', `${clamped}%`)
  return clamped
}
const savedSplit = Number(store.get(KEY_SPLIT))
if (savedSplit) setSplit(savedSplit)

divider.addEventListener('pointerdown', (e) => {
  divider.setPointerCapture(e.pointerId)
  split.classList.add('dragging')
  const rect = split.getBoundingClientRect()
  const move = (ev: PointerEvent) => setSplit(((ev.clientX - rect.left) / rect.width) * 100)
  const up = (ev: PointerEvent) => {
    divider.removeEventListener('pointermove', move)
    divider.removeEventListener('pointerup', up)
    split.classList.remove('dragging')
    store.set(KEY_SPLIT, String(setSplit(((ev.clientX - rect.left) / rect.width) * 100)))
  }
  divider.addEventListener('pointermove', move)
  divider.addEventListener('pointerup', up)
})
divider.addEventListener('dblclick', () => store.set(KEY_SPLIT, String(setSplit(50))))
divider.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  const cur = parseFloat(split.style.getPropertyValue('--left')) || 50
  store.set(KEY_SPLIT, String(setSplit(cur + (e.key === 'ArrowLeft' ? -2 : 2))))
  e.preventDefault()
})
