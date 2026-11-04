import './style.css'
import type { Node as PMNode } from '@tiptap/pm/model'
import { createWysiwyg } from './wysiwyg'
import { createSource } from './source'
import { mountToolbar } from './toolbar'
import { collapseBlankLines, markdownToPlainText, tidyMarkdown, trimTrailingWhitespace } from './markdown'
import { WELCOME } from './welcome'

const KEY_DOC = 'markitdown:doc'
const KEY_THEME = 'markitdown:theme'
const KEY_SPLIT = 'markitdown:split'

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

const saved = store.get(KEY_DOC)
const initial = saved ?? WELCOME

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

// Show the source exactly as saved (the user's own text), or normalized if new.
source.setValue(saved ?? tidyMarkdown(editor.getMarkdown()))

if (import.meta.env.DEV) Object.assign(window, { __app: { editor, source, setDocument } })

// ---------------------------------------------------------------- persistence

let saveTimer = 0
function scheduleSave(md: string) {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => store.set(KEY_DOC, md), 300)
}
window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer)
  store.set(KEY_DOC, currentMarkdown())
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
  const file = fileInput.files?.[0]
  if (file) await openFile(file)
  fileInput.value = ''
})

async function openFile(file: File) {
  const text = (await file.text()).replace(/\r\n?/g, '\n')
  setDocument(text)
  toast(`Opened ${file.name}`)
}

function suggestedFilename(md: string): string {
  const h = md.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? 'document'
  const slug = h
    .replace(/[*_`[\]()#~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
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
    const file = e.dataTransfer!.files[0]
    if (file) openFile(file)
  },
  true,
)

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
