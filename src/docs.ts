/**
 * Multi-document storage in localStorage.
 *
 * - `markitdown:docs`      JSON index: DocMeta[] in tab order
 * - `markitdown:doc:<id>`  Markdown content of one document
 * - `markitdown:active`    id of the open document
 *
 * Content lives in one key per document so saving the open document never
 * rewrites the others. Index changes are read-modify-write against storage, so
 * two browser tabs don't clobber each other's document lists.
 */

export interface DocMeta {
  id: string
  /** User-given name; empty means "derive from content". */
  name: string
  created: number
  updated: number
}

const KEY_INDEX = 'markitdown:docs'
const KEY_ACTIVE = 'markitdown:active'
const KEY_LEGACY = 'markitdown:doc'
const contentKey = (id: string) => `markitdown:doc:${id}`

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Returns false when storage is unavailable or full. */
function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export function listDocs(): DocMeta[] {
  try {
    const parsed = JSON.parse(read(KEY_INDEX) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((d) => d && typeof d.id === 'string') : []
  } catch {
    return []
  }
}

function saveIndex(docs: DocMeta[]): boolean {
  return write(KEY_INDEX, JSON.stringify(docs))
}

export function getContent(id: string): string {
  return read(contentKey(id)) ?? ''
}

export function getActiveId(): string | null {
  return read(KEY_ACTIVE)
}

export function setActiveId(id: string) {
  write(KEY_ACTIVE, id)
}

export function createDoc(content = '', name = ''): DocMeta {
  const now = Date.now()
  const doc: DocMeta = { id: newId(), name, created: now, updated: now }
  write(contentKey(doc.id), content)
  saveIndex([...listDocs(), doc])
  return doc
}

/** Save content of one document. Returns false if storage is full. */
export function saveContent(id: string, content: string): boolean {
  if (!write(contentKey(id), content)) return false
  const docs = listDocs()
  const doc = docs.find((d) => d.id === id)
  if (doc) {
    doc.updated = Date.now()
    saveIndex(docs)
  }
  return true
}

export function renameDoc(id: string, name: string) {
  const docs = listDocs()
  const doc = docs.find((d) => d.id === id)
  if (!doc) return
  doc.name = name.trim()
  saveIndex(docs)
}

export function deleteDoc(id: string) {
  saveIndex(listDocs().filter((d) => d.id !== id))
  remove(contentKey(id))
}

/**
 * Ensure at least one document exists, migrating the single-document storage
 * of earlier versions. Returns the id to open.
 */
export function initDocs(welcome: string): string {
  let docs = listDocs()
  if (!docs.length) {
    const legacy = read(KEY_LEGACY)
    createDoc(legacy ?? welcome)
    if (legacy !== null) remove(KEY_LEGACY)
    docs = listDocs()
  }
  const active = getActiveId()
  return docs.some((d) => d.id === active) ? active! : docs[0].id
}

/** Title shown for a document: its name, else its first heading or line. */
export function displayTitle(doc: DocMeta, content: string): string {
  if (doc.name) return doc.name
  return derivedTitle(content) || 'Untitled'
}

export function derivedTitle(content: string): string {
  const heading = content.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1]
  const firstLine = content.split('\n').find((l) => l.trim() && !/^\s*(```|~~~|[-*_]{3,}\s*$)/.test(l))
  const raw = heading ?? firstLine ?? ''
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*|#{1,6}\s+)/, '')
    .replace(/[*_`~\\]/g, '')
    .trim()
    .slice(0, 60)
}
