/**
 * Editing files on the user's device via the File System Access API
 * (Chromium browsers: Chrome, Edge, Opera). Elsewhere `supported` is false and
 * the app hides these features.
 *
 * File handles can't go in localStorage, so they're kept in IndexedDB keyed
 * by document id. They survive reloads; the browser may ask for permission
 * again before the next read/write.
 */

type PermissionMode = { mode: 'read' | 'readwrite' }
interface HandleWithPermissions extends FileSystemFileHandle {
  queryPermission?(d: PermissionMode): Promise<PermissionState>
  requestPermission?(d: PermissionMode): Promise<PermissionState>
}
interface PickerType {
  description: string
  accept: Record<string, string[]>
}
declare global {
  interface Window {
    showOpenFilePicker?(o?: { multiple?: boolean; types?: PickerType[]; id?: string }): Promise<FileSystemFileHandle[]>
    showSaveFilePicker?(o?: { suggestedName?: string; types?: PickerType[]; id?: string }): Promise<FileSystemFileHandle>
  }
  interface DataTransferItem {
    getAsFileSystemHandle?(): Promise<FileSystemHandle | null>
  }
}

export const supported =
  typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function' && window.isSecureContext

const TYPES: PickerType[] = [
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'] } },
  { description: 'Text', accept: { 'text/plain': ['.txt'] } },
]

/** Format details of a file on disk, preserved when writing back. */
export interface DiskFormat {
  crlf: boolean
  bom: boolean
}

export interface DiskRead extends DiskFormat {
  /** Content with LF line endings and no BOM (what the editors work with). */
  text: string
  lastModified: number
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/** Show the open picker. Returns [] if the user cancels. */
export async function pickFiles(): Promise<FileSystemFileHandle[]> {
  try {
    return await window.showOpenFilePicker!({ multiple: true, types: TYPES, id: 'markitdown' })
  } catch (e) {
    if (isAbort(e)) return []
    throw e
  }
}

/** Show the save picker. Returns null if the user cancels. */
export async function pickSaveFile(suggestedName: string): Promise<FileSystemFileHandle | null> {
  try {
    return await window.showSaveFilePicker!({ suggestedName, types: TYPES, id: 'markitdown' })
  } catch (e) {
    if (isAbort(e)) return null
    throw e
  }
}

export async function readFile(handle: FileSystemFileHandle): Promise<DiskRead> {
  const file = await handle.getFile()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const raw = new TextDecoder('utf-8').decode(bytes) // strips a leading BOM
  return {
    text: raw.replace(/\r\n?/g, '\n'),
    crlf: /\r\n/.test(raw),
    bom,
    lastModified: file.lastModified,
  }
}

/** Write `text` (LF) to the file in its original format. Returns the new lastModified. */
export async function writeFile(handle: FileSystemFileHandle, text: string, format: DiskFormat): Promise<number> {
  let out = format.crlf ? text.replace(/\n/g, '\r\n') : text
  if (format.bom) out = '﻿' + out
  const writable = await handle.createWritable()
  try {
    await writable.write(out)
  } finally {
    await writable.close()
  }
  return (await handle.getFile()).lastModified
}

export async function lastModified(handle: FileSystemFileHandle): Promise<number> {
  return (await handle.getFile()).lastModified
}

/** Current permission without prompting. */
export async function permission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const h = handle as HandleWithPermissions
  if (!h.queryPermission) return 'granted'
  try {
    return await h.queryPermission({ mode: 'readwrite' })
  } catch {
    return 'prompt'
  }
}

/** Whether the file can be read without prompting. */
export async function canRead(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as HandleWithPermissions
  if (!h.queryPermission) return true
  try {
    return (await h.queryPermission({ mode: 'read' })) === 'granted'
  } catch {
    return false
  }
}

/** Ask for read/write permission. Must run inside a user gesture. */
export async function requestPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as HandleWithPermissions
  if (!h.requestPermission) return true
  if ((await permission(handle)) === 'granted') return true
  try {
    return (await h.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

/** File handles from a drop event. Must be called synchronously in the handler. */
export function handlesFromDrop(dt: DataTransfer): Promise<FileSystemFileHandle[]> | null {
  const items = [...dt.items].filter((i) => i.kind === 'file')
  if (!items.length || !items.every((i) => typeof i.getAsFileSystemHandle === 'function')) return null
  const pending = items.map((i) => i.getAsFileSystemHandle!())
  return Promise.all(pending).then((hs) =>
    hs.filter((h): h is FileSystemFileHandle => !!h && h.kind === 'file'),
  )
}

// ---------------------------------------------------------------- IndexedDB handle store

const DB = 'markitdown'
const STORE = 'handles'
let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

const idbHandles = {
  get: (id: string) => tx<FileSystemFileHandle | undefined>('readonly', (s) => s.get(id)).catch(() => undefined),
  set: (id: string, h: FileSystemFileHandle) => tx('readwrite', (s) => s.put(h, id)).then(() => undefined),
  delete: (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => undefined).catch(() => undefined),
}

// Dev/test only: headless Chromium crashes when reading sandbox (OPFS) handles
// back from IndexedDB, so automated tests can opt into an in-memory store.
const memory = new Map<string, FileSystemFileHandle>()
const memHandles = {
  get: async (id: string) => memory.get(id),
  set: async (id: string, h: FileSystemFileHandle) => void memory.set(id, h),
  delete: async (id: string) => void memory.delete(id),
}

export const handles =
  import.meta.env.DEV && (window as { __memoryHandles?: boolean }).__memoryHandles ? memHandles : idbHandles

/** Find an already-open document for this file, if any. */
export async function findOpen(handle: FileSystemFileHandle, ids: string[]): Promise<string | null> {
  for (const id of ids) {
    const h = await handles.get(id)
    if (h && (await h.isSameEntry(handle).catch(() => false))) return id
  }
  return null
}
