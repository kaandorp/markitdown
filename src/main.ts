import '@fontsource/noto-sans/300.css'
import '@fontsource/noto-sans/400.css'
import '@fontsource/noto-sans/700.css'
import '@fontsource/noto-serif/300-italic.css'
import './style.css'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { createWysiwyg } from './wysiwyg'
import { createSource } from './source'
import { mountToolbar } from './toolbar'
import { createScrollSync } from './scrollsync'
import { collapseBlankLines, markdownToPlainText, tidyMarkdown, trimTrailingWhitespace } from './markdown'
import { WELCOME } from './welcome'
import * as docs from './docs'
import * as lf from './localfiles'

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

/** Set up below, once both editors exist; source-pane activity before then is ignored. */
let scrollSync: ReturnType<typeof createScrollSync> | null = null

/** True while the WYSIWYG is being updated from the source pane. */
let applyingFromSource = false
let sourceTimer = 0
let pendingSource: string | null = null

const editor = createWysiwyg($('wysiwyg'), initial, () => {
  if (applyingFromSource) return
  const md = tidyMarkdown(editor.getMarkdown())
  source.setValue(md)
  afterChange(md)
  maybeShowNormalizeNotice()
})

const source = createSource($('source'), '', (md) => {
  // Typing in the source pane: never rewrite it, just mirror into the WYSIWYG.
  pendingSource = md
  clearTimeout(sourceTimer)
  sourceTimer = window.setTimeout(flushSource, 120)
  scheduleSave(md)
  scheduleStats(md)
}, (byUser) => {
  if (byUser) scrollSync?.changed('right')
  else scrollSync?.resync()
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
  scrollSync?.resync()
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
  scheduleAutosave(id)
  renderTabs()
}

window.addEventListener('beforeunload', (e) => {
  flushSource()
  saveNow()
  // Drafts survive in localStorage, but unsaved edits haven't reached the file yet.
  if (docs.listDocs().some((d) => d.file && docs.isDirty(d.id))) {
    e.preventDefault()
    e.returnValue = ''
  }
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

// Full width: the rich-text document drops its 760px reading width. Remembered
// per browser, like the theme and the split position.
const KEY_FULL_WIDTH = 'markitdown:fullwidth'
const paneLeft = $('pane-left')
let fullWidth = store.get(KEY_FULL_WIDTH) === '1'
paneLeft.classList.toggle('is-full-width', fullWidth)

// ---------------------------------------------------------------- scroll sync

const KEY_SYNC = 'markitdown:scrollsync'
let syncScroll = store.get(KEY_SYNC) !== '0'
scrollSync = createScrollSync({
  editor,
  leftScroller: $('wysiwyg'),
  source: source.view,
  enabled: () => syncScroll,
})
// Typing or moving the caret on the left keeps its Markdown level on the right;
// content arriving from the source pane re-aligns from there.
editor.on('transaction', ({ transaction }) => {
  if (editor.view.hasFocus()) scrollSync.changed('left')
  else if (transaction.docChanged) scrollSync.resync()
})
window.addEventListener('resize', () => scrollSync.resync())

const syncBtn = $<HTMLButtonElement>('btn-sync')
const paintSyncBtn = () => syncBtn.setAttribute('aria-pressed', String(syncScroll))
paintSyncBtn()
syncBtn.addEventListener('click', () => {
  syncScroll = !syncScroll
  store.set(KEY_SYNC, syncScroll ? '1' : '0')
  paintSyncBtn()
  if (syncScroll) scrollSync.resync()
})

const refreshToolbar = mountToolbar($('toolbar'), editor, [
  {
    label: 'Full width',
    icon: 'i-width',
    title: 'Full width',
    active: () => fullWidth,
    run: () => {
      fullWidth = !fullWidth
      paneLeft.classList.toggle('is-full-width', fullWidth)
      store.set(KEY_FULL_WIDTH, fullWidth ? '1' : '0')
      refreshToolbar()
      scrollSync.resync()
    },
  },
])

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
$('btn-open').addEventListener('click', async () => {
  if (!lf.supported) return fileInput.click()
  try {
    await openLocalFiles(await lf.pickFiles())
  } catch (err) {
    toast(`Couldn't open file: ${(err as Error).message}`)
  }
})
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
    // Where supported, dropped files are opened for in-place editing.
    const handles = lf.supported ? lf.handlesFromDrop(e.dataTransfer!) : null
    if (handles) handles.then(openLocalFiles).catch(() => openFiles([...e.dataTransfer!.files]))
    else openFiles([...e.dataTransfer!.files])
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
    noticeEl.hidden = true
    void checkDisk(id)
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
    btn.classList.toggle('is-derived', !meta.name && !meta.file)
    li.classList.toggle('is-file', !!meta.file)
    li.classList.toggle('is-dirty', !!meta.file && docs.isDirty(meta.id, active ? currentMarkdown() : undefined))
    if (meta.file) btn.title = `${title}\nFile on this device: ${meta.file.name}\nDouble-click to rename`
    const close = li.querySelector<HTMLButtonElement>('.doc-close')!
    close.title = meta.file ? 'Close (the file stays on your device)' : 'Delete document'
    close.setAttribute('aria-label', `${meta.file ? 'Close' : 'Delete'} ${title}`)
  })
  for (const li of existing.values()) li.remove()

  const active = list.find((d) => d.id === activeId)
  if (document.activeElement !== nameInput) nameInput.value = active?.name ?? ''
  nameInput.placeholder = active?.file?.name ?? (active ? docs.derivedTitle(currentMarkdown()) || 'Untitled' : 'Untitled')
  document.title = active ? `${titleOf(active)} · Markitdown` : 'Markitdown'
  renderFileBar()
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
  if (meta.file) {
    // Closing a linked file only unlinks it; the file on disk is untouched.
    if (docs.isDirty(id) && !window.confirm(`“${titleOf(meta)}” has unsaved changes. Close it anyway?\n\nThe file on your device stays as it was last saved.`)) return
    void lf.handles.delete(id)
    perms.delete(id)
    conflicts.delete(id)
    missing.delete(id)
  } else if (content.trim() && !window.confirm(`Delete “${titleOf(meta)}”? This can't be undone.`)) return

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


// ---------------------------------------------------------------- theme

const media = window.matchMedia('(prefers-color-scheme: dark)')
const effectiveTheme = () => document.documentElement.dataset.theme ?? (media.matches ? 'dark' : 'light')
const themeBtn = $('btn-theme')
const paintThemeBtn = () => {
  const dark = effectiveTheme() === 'dark'
  themeBtn.innerHTML = `<svg class="i" aria-hidden="true"><use href="#${dark ? 'i-sun' : 'i-moon'}"></use></svg><span class="collapsed-label">${dark ? 'Light theme' : 'Dark theme'}</span>`
  themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme')
}
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
  const move = (ev: PointerEvent) => {
    setSplit(((ev.clientX - rect.left) / rect.width) * 100)
    scrollSync.resync()
  }
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

// ---------------------------------------------------------------- local files (File System Access API)

const filebar = $('filebar')
const fileNameEl = $('file-name')
const fileStatusEl = $('file-status')
const statusHint = $('status-hint')
const reconnectBtn = $<HTMLButtonElement>('btn-reconnect')
const autosaveChk = $<HTMLInputElement>('chk-autosave')
const noticeEl = $('file-notice')
const saveFileBtn = $<HTMLButtonElement>('btn-save-file')
const newFileBtn = $<HTMLButtonElement>('btn-new-file')

/** Last known read/write permission per linked document. */
const perms = new Map<string, PermissionState>()
/** Docs whose file changed on disk while the user chose to keep their version. */
const conflicts = new Set<string>()
/** Docs whose file can no longer be found (moved or deleted). */
const missing = new Set<string>()
/** lastModified values the user already declined to reload, so we don't ask again. */
const declined = new Map<string, number>()
let writing = false
let autosaveTimer = 0

saveFileBtn.hidden = !lf.supported
newFileBtn.hidden = !lf.supported
if (lf.supported) overlay.textContent = 'Drop Markdown files to edit them here'

const fileInfo = (disk: lf.DiskFormat & { lastModified: number }, name: string): docs.FileInfo => ({
  name,
  autosave: false,
  crlf: disk.crlf,
  bom: disk.bom,
  lastModified: disk.lastModified,
  notified: false,
})

const isNotFound = (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError'
const linkedIds = () => docs.listDocs().filter((d) => d.file).map((d) => d.id)

/** Open files from the device as linked documents (or switch to them if already open). */
async function openLocalFiles(handles: FileSystemFileHandle[]) {
  if (!handles.length) return
  let lastId: string | null = null
  for (const handle of handles) {
    const existing = await lf.findOpen(handle, linkedIds())
    if (existing) {
      lastId = existing
      continue
    }
    const disk = await lf.readFile(handle)
    const meta = docs.createDoc(disk.text, '', fileInfo(disk, handle.name))
    await lf.handles.set(meta.id, handle)
    perms.set(meta.id, await lf.permission(handle))
    lastId = meta.id
  }
  if (!lastId) return
  if (lastId === activeId) void checkDisk(lastId)
  switchTo(lastId)
  toast(handles.length === 1 ? `Opened ${handles[0].name}` : `Opened ${handles.length} files`)
}

/** "+ File": create a new Markdown file on the device and open it. */
async function newLocalFile() {
  try {
    const handle = await lf.pickSaveFile('untitled.md')
    if (!handle) return
    const existing = await lf.findOpen(handle, linkedIds())
    if (existing) {
      toast(`${handle.name} is already open`)
      return switchTo(existing)
    }
    const lastModified = await lf.writeFile(handle, '', { crlf: false, bom: false })
    flushSource()
    saveNow()
    const meta = docs.createDoc('', '', fileInfo({ crlf: false, bom: false, lastModified }, handle.name))
    await lf.handles.set(meta.id, handle)
    perms.set(meta.id, 'granted')
    switchTo(meta.id)
    editor.commands.focus()
  } catch (err) {
    toast(`Couldn't create file: ${(err as Error).message}`)
  }
}

/** Save a browser document to a new file on the device and link it. */
async function saveAsLocalFile() {
  flushSource()
  saveNow()
  const id = activeId
  const md = currentMarkdown()
  try {
    const handle = await lf.pickSaveFile(suggestedFilename(md))
    if (!handle) return
    const lastModified = await lf.writeFile(handle, md, { crlf: false, bom: false })
    docs.updateDoc(id, { file: fileInfo({ crlf: false, bom: false, lastModified }, handle.name) })
    docs.setDiskText(id, md)
    await lf.handles.set(id, handle)
    perms.set(id, 'granted')
    missing.delete(id)
    toast(`Saved as ${handle.name}`)
  } catch (err) {
    toast(`Couldn't save: ${(err as Error).message}`)
  }
  renderTabs()
}

/** Ctrl+S / Save: write a linked document, or "save as" for a browser document. */
async function saveActive() {
  flushSource()
  saveNow()
  const meta = docs.getDoc(activeId)
  if (!meta) return
  if (!meta.file || missing.has(meta.id)) return saveAsLocalFile()
  await saveLinked(meta.id, false)
}

async function saveLinked(id: string, auto: boolean) {
  const meta = docs.getDoc(id)
  if (!meta?.file) return
  const handle = await lf.handles.get(id)
  if (!handle) {
    if (!auto) toast('Lost access to this file. Open it again to keep editing it in place.')
    return
  }
  if (writing) {
    if (auto) scheduleAutosave(id)
    return
  }
  // Autosave never prompts; it waits until permission was granted by a click.
  const granted = auto ? (await lf.permission(handle)) === 'granted' : await lf.requestPermission(handle)
  perms.set(id, granted ? 'granted' : 'prompt')
  if (!granted) {
    if (!auto) toast('Permission not granted: the file was not saved')
    renderFileBar()
    return
  }

  writing = true
  try {
    // Don't silently overwrite edits made by another app.
    const mod = await lf.lastModified(handle)
    if (mod !== meta.file.lastModified) {
      const disk = await lf.readFile(handle)
      if (disk.text !== docs.getDiskText(id)) {
        if (auto) {
          conflicts.add(id)
          return
        }
        const ok = window.confirm(
          `“${meta.file.name}” was changed by another app since you opened it here.\n\nOverwrite it with your version?`,
        )
        if (!ok) return
      }
    }
    const content = docs.getContent(id)
    const lastModified = await lf.writeFile(handle, content, meta.file)
    docs.setDiskText(id, content)
    docs.updateDoc(id, { file: { lastModified } })
    conflicts.delete(id)
    missing.delete(id)
    declined.delete(id)
    if (!auto) toast(`Saved ${meta.file.name}`)
  } catch (err) {
    if (isNotFound(err)) {
      // The next Save asks for a new location.
      missing.add(id)
      toast(`${meta.file.name} was moved or deleted. Press Save to choose a new location.`)
    } else {
      toast(`Couldn't save ${meta.file.name}: ${(err as Error).message}`)
    }
  } finally {
    writing = false
    renderTabs()
  }
}

function scheduleAutosave(id: string) {
  const meta = docs.getDoc(id)
  if (!meta?.file?.autosave || !docs.isDirty(id)) return
  clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(() => void saveLinked(id, true), 1000)
}

/**
 * Check whether a linked file changed on disk (e.g. edited in another app).
 * Reloads silently when there are no unsaved changes here; otherwise asks.
 */
async function checkDisk(id: string) {
  const meta = docs.getDoc(id)
  if (!meta?.file || writing) return renderFileBar()
  const handle = await lf.handles.get(id)
  if (!handle) return renderFileBar()
  perms.set(id, await lf.permission(handle))
  // Reading needs at least read permission; without it, wait for "Reconnect".
  if (!(await lf.canRead(handle))) return renderFileBar()

  let mod: number
  try {
    mod = await lf.lastModified(handle)
    missing.delete(id)
  } catch (err) {
    if (isNotFound(err)) missing.add(id)
    return renderFileBar()
  }
  if (mod === meta.file.lastModified || declined.get(id) === mod) return renderFileBar()

  const disk = await lf.readFile(handle)
  if (disk.text === docs.getDiskText(id)) {
    docs.updateDoc(id, { file: { lastModified: mod } })
    return renderFileBar()
  }
  if (id === activeId) {
    flushSource()
    saveNow()
  }
  const dirty = docs.isDirty(id)
  const reload =
    !dirty ||
    window.confirm(
      `“${meta.file.name}” was changed by another app.\n\nReload it from disk? Your unsaved changes here will be lost.\n(Cancel keeps your version.)`,
    )
  if (reload) {
    docs.saveContent(id, disk.text)
    docs.setDiskText(id, disk.text)
    docs.updateDoc(id, { file: { lastModified: mod, crlf: disk.crlf, bom: disk.bom } })
    conflicts.delete(id)
    declined.delete(id)
    if (id === activeId) loadDocument(disk.text)
    toast(`Reloaded ${meta.file.name} (changed on disk)`)
  } else {
    declined.set(id, mod)
    conflicts.add(id)
  }
  renderTabs()
}

function renderFileBar() {
  const meta = docs.getDoc(activeId)
  const file = meta?.file
  saveFileBtn.querySelector('.label')!.textContent = file ? 'Save' : 'Save as file…'
  saveFileBtn.title = file ? `Save to ${file.name} (Ctrl+S)` : 'Save as a file on this device (Ctrl+S)'
  filebar.hidden = !file
  statusHint.textContent = file ? `Ctrl+S saves to ${file.name}` : ''
  if (!file) {
    noticeEl.hidden = true
    return
  }
  fileNameEl.textContent = file.name
  autosaveChk.checked = file.autosave
  const perm = perms.get(activeId)
  const needsPermission = perm !== undefined && perm !== 'granted'
  reconnectBtn.hidden = !needsPermission
  // Status colours are functional only and always come with a word and an icon.
  let status: string
  let tone: 'saved' | 'dirty' | 'changed' | 'missing' | 'access'
  if (missing.has(activeId)) {
    status = 'File not found. Save to choose a new place.'
    tone = 'missing'
  } else if (conflicts.has(activeId)) {
    status = 'Changed on disk by another app'
    tone = 'changed'
  } else if (docs.isDirty(activeId, currentMarkdown())) {
    status = 'Unsaved changes'
    tone = 'dirty'
  } else if (needsPermission) {
    status = 'Access needs to be allowed again'
    tone = 'access'
  } else {
    status = 'Saved'
    tone = 'saved'
  }
  const icon = { saved: 'i-check', dirty: '', changed: 'i-warn', missing: 'i-error', access: 'i-info' }[tone]
  fileStatusEl.innerHTML = icon ? `<svg class="i i-sm" aria-hidden="true"><use href="#${icon}"></use></svg>` : '<span class="dot" aria-hidden="true"></span>'
  fileStatusEl.append(status)
  fileStatusEl.dataset.tone = tone
}

function maybeShowNormalizeNotice() {
  const meta = docs.getDoc(activeId)
  if (!meta?.file || meta.file.notified) return
  docs.updateDoc(activeId, { file: { notified: true } })
  noticeEl.hidden = false
}

saveFileBtn.addEventListener('click', () => void saveActive())
newFileBtn.addEventListener('click', () => void newLocalFile())
$('btn-notice-close').addEventListener('click', () => (noticeEl.hidden = true))

reconnectBtn.addEventListener('click', async () => {
  const id = activeId
  const handle = await lf.handles.get(id)
  if (!handle) return
  const ok = await lf.requestPermission(handle)
  perms.set(id, ok ? 'granted' : 'prompt')
  if (ok) await checkDisk(id)
  renderFileBar()
})

autosaveChk.addEventListener('change', async () => {
  const id = activeId
  const on = autosaveChk.checked
  if (on) {
    // The checkbox click is a user gesture, so we may ask for write access now.
    const handle = await lf.handles.get(id)
    if (!handle || !(await lf.requestPermission(handle))) {
      autosaveChk.checked = false
      toast('Autosave needs permission to write to the file')
      return
    }
    perms.set(id, 'granted')
  }
  docs.updateDoc(id, { file: { autosave: on } })
  if (on) {
    flushSource()
    saveNow()
    void saveLinked(id, true)
  }
  renderFileBar()
})

// Ctrl/Cmd+S saves (to the linked file, or "save as"); without support it downloads.
document.addEventListener(
  'keydown',
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return
    e.preventDefault()
    if (lf.supported) void saveActive()
    else $('btn-save').click()
  },
  true,
)

// Coming back to the page: pick up changes other apps made to the open file.
window.addEventListener('focus', () => void checkDisk(activeId))
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkDisk(activeId)
})

// ---------------------------------------------------------------- phone layout

// One pane at a time on narrow screens: "Rich text" or "Markdown".
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('.view-switch [data-view]')]
for (const btn of viewButtons) {
  btn.addEventListener('click', () => {
    flushSource()
    split.dataset.view = btn.dataset.view!
    for (const b of viewButtons) b.setAttribute('aria-selected', String(b === btn))
    if (btn.dataset.view === 'source') source.view.requestMeasure()
  })
}

// The app-bar actions fold into a "More" menu on narrow screens.
const moreBtn = $<HTMLButtonElement>('btn-more')
const actionsEl = $('actions')
const setMore = (open: boolean) => {
  actionsEl.classList.toggle('open', open)
  moreBtn.setAttribute('aria-expanded', String(open))
}
moreBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  setMore(!actionsEl.classList.contains('open'))
})
actionsEl.addEventListener('click', (e) => {
  // Keep the panel open while using the Clean up submenu.
  if (!(e.target as HTMLElement).closest('#btn-cleanup')) setMore(false)
})
document.addEventListener('click', (e) => {
  if (!actionsEl.contains(e.target as Node)) setMore(false)
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && actionsEl.classList.contains('open')) setMore(false)
})

$('btn-copy-md-mobile').addEventListener('click', () => $('btn-copy-md').click())

if (import.meta.env.DEV) Object.assign(window, { __lf: { openLocalFiles, saveActive, checkDisk, perms } })

renderTabs()
void checkDisk(activeId)
