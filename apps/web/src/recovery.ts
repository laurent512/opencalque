import { createDocument, readDocument, serializeDocument, type Document } from '@opencalque/core'
import { forFile, isDirty, loadDocument, useStore } from './store'

/**
 * Unsaved work kept aside, so that a crash, a power cut or a frozen window does not lose it. A
 * moment after each change, each window copies its drawing into the browser's own storage
 * (IndexedDB, which the desktop app has too), and while it runs it says every few seconds that it
 * is alive. When the app starts, the copies of windows that stopped without closing are offered
 * back. A window that closes normally takes its copy away: leaving with unsaved changes was then
 * asked about and chosen. Saving takes it away too.
 */

/** One copy of unsaved work. */
export interface Kept {
  /** The window that made it. */
  session: string
  name: string
  /** The file the drawing came from, if it had one; the copy itself is not tied to it. */
  fileName?: string
  content: string
  /** When the copy was last brought up to date, in milliseconds since 1970. */
  changed: number
  /** When its window last said it was alive. */
  alive: number
}

const DATABASE = 'opencalque-recovery'
const STORE = 'drawings'
/** How long after the last change the copy is made, in milliseconds. */
const DELAY = 1500
/** How often a running window says it is alive, and how long without it before its copy is offered. */
const BEAT = 5000
const DEAD = 20000

const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

let opening: Promise<IDBDatabase | null> | null = null

/** The database, or null where the browser keeps none (some private windows): recovery then does nothing. */
function database(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'session' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

/** Runs one request on the store; null when there is no database or the request fails. */
async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await database()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const request = act(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

const own = () => run('readonly', (store) => store.get(session) as IDBRequest<Kept | undefined>)
const put = (kept: Kept) => run('readwrite', (store) => store.put(kept))
const remove = (id: string) => run('readwrite', (store) => store.delete(id))

/** The copies left by windows that are no longer running, newest first. */
export async function recoverable(): Promise<Kept[]> {
  const all = ((await run('readonly', (store) => store.getAll())) ?? []) as Kept[]
  const now = Date.now()
  return all.filter((kept) => kept.session !== session && now - kept.alive > DEAD).sort((a, b) => b.changed - a.changed)
}

/** Opens a kept copy as an unsaved drawing, and forgets the copy: from now on it is this window's work. */
export async function restore(kept: Kept): Promise<void> {
  const { doc } = readDocument(JSON.parse(kept.content))
  loadDocument(doc, null)
  // It has never been saved where it is now: marked as changed, it is copied again, and the app asks before closing it.
  useStore.setState({ saved: createDocument() })
  await remove(kept.session)
}

/** Throws a kept copy away. */
export const forget = (kept: Kept) => remove(kept.session)

/** Keeps this window's unsaved work aside as it changes. Returns a function that stops it. */
export function startRecovery(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let written: Document | null = null
  const copy = async () => {
    const s = useStore.getState()
    if (!isDirty(s) || s.base || s.editingText) return
    if (s.doc === written) return
    written = s.doc
    const now = Date.now()
    await put({ session, name: s.doc.name, fileName: s.file?.name, content: serializeDocument(forFile(s.doc, s)), changed: now, alive: now })
  }
  const check = () => {
    clearTimeout(timer)
    const s = useStore.getState()
    if (isDirty(s)) {
      // Not in the middle of a gesture or of typing a text: what is on screen then is only a preview.
      if (!s.base && !s.editingText) timer = setTimeout(copy, DELAY)
    } else if (written !== null) {
      written = null
      remove(session)
    }
  }
  const beat = setInterval(async () => {
    const kept = await own()
    if (kept) await put({ ...kept, alive: Date.now() })
  }, BEAT)
  // A window closed normally leaves nothing to recover: whatever was unsaved, the user chose to leave it.
  const leave = () => remove(session)
  window.addEventListener('pagehide', leave)
  const stop = useStore.subscribe(check)
  return () => {
    clearTimeout(timer)
    clearInterval(beat)
    stop()
    window.removeEventListener('pagehide', leave)
  }
}
