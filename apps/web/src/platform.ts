/**
 * Everything the editor needs from its host. The browser and the desktop shell each provide one;
 * a hosted version would add a third backed by a server.
 */
export interface StoredFile {
  name: string
  /** Opaque identity used to save back to the same place: a path on desktop, a file handle in the browser. */
  token: unknown
}

export interface OpenedFile extends StoredFile {
  content: string
}

export interface Platform {
  /** True in the desktop app, which can reach programs and local services a web page cannot. */
  desktop: boolean
  /** Desktop only: an HTTP request made outside the page, so a local model server need not allow this app's origin. */
  request?(url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{ status: number; body: string }>
  /** Desktop only: sends a prompt to the Claude Code CLI installed on this computer. */
  claudeCli?(input: { prompt: string; session?: string; model?: string }): Promise<{ text: string; session: string }>
  /** Desktop only: stops the CLI request in progress. */
  cancelClaudeCli?(): void
  /** The words of the "unsaved changes" question the desktop app asks before closing. */
  setCloseWarning(labels: { message: string; discard: string; cancel: string }): void
  open(extensions: string[]): Promise<OpenedFile | null>
  /** Like `open`, for files that are not text (pictures, PDFs). */
  openBytes(extensions: string[]): Promise<{ name: string; bytes: Uint8Array } | null>
  /** Saves to `token` when given, otherwise asks where. Resolves to null when the user cancels. */
  save(content: string | Uint8Array, suggestedName: string, token?: unknown): Promise<StoredFile | null>
  /** Desktop only: the drawings opened or saved lately, newest first, that are still where they were. */
  recent?(): Promise<{ name: string; path: string }[]>
  /** Desktop only: opens one of the drawings `recent` listed. */
  openRecent?(path: string): Promise<OpenedFile | null>
  /** The file the app was launched with, if any. */
  initial(): Promise<OpenedFile | null>
  setDirty(dirty: boolean): void
}

declare global {
  interface Window {
    opencalqueDesktop?: Platform
  }
}

function pickFile(extensions: string[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = extensions.map((e) => `.${e}`).join(',')
    input.oncancel = () => resolve(null)
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

function createBrowserPlatform(): Platform {
  let dirty = false
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault()
  })
  return {
    desktop: false,
    // The browser asks its own question when a page with unsaved changes is closed.
    setCloseWarning: () => {},
    async open(extensions) {
      const file = await pickFile(extensions)
      return file && { name: file.name, content: await file.text(), token: null }
    },
    async openBytes(extensions) {
      const file = await pickFile(extensions)
      return file && { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
    },
    async save(content, suggestedName, token) {
      // File System Access API (Chromium): saves in place. Elsewhere, fall back to a download.
      const picker = (window as any).showSaveFilePicker
      if (picker) {
        try {
          const handle = token ?? (await picker({ suggestedName }))
          const writable = await handle.createWritable()
          await writable.write(content)
          await writable.close()
          return { name: handle.name, token: handle }
        } catch (error) {
          if ((error as Error).name === 'AbortError') return null
          throw error
        }
      }
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([content as BlobPart]))
      link.download = suggestedName
      link.click()
      URL.revokeObjectURL(link.href)
      return { name: suggestedName, token: null }
    },
    initial: async () => null,
    setDirty: (value) => {
      dirty = value
    },
  }
}

export const platform: Platform = window.opencalqueDesktop ?? createBrowserPlatform()
