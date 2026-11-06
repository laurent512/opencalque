import type { UpdateState } from './updateState'

export type { UpdateState }

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

/** The words of the dialogs the desktop app shows itself, in the user's language. */
export interface DialogLabels {
  /** Asked before closing a window with unsaved changes. */
  unsaved: string
  discard: string
  cancel: string
  /** Asked the first time the assistant reaches a service that is not on this computer; {origin} is its address. */
  connect: string
  connectDetail: string
  allow: string
  deny: string
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
  /** Desktop only: lets agents on this computer work on the open drawing (`opencalque mcp --live`). */
  agentBridge?: AgentBridge
  /** Desktop only: tells the window whether the interface is dark, and whether that is the system's choice, for the system's buttons and dialogs. */
  setTheme?(dark: boolean, followsSystem: boolean): void
  /** The words of the questions the desktop app asks itself: before closing with unsaved changes, before reaching a new service. */
  setDialogLabels(labels: DialogLabels): void
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
  /** Desktop only: hears of drawings the system asks the running app to open (on macOS, a double-click in the Finder). */
  onOpenFile?(listener: (file: OpenedFile) => void): void
  /** Desktop only: shows the folder where drawings are copied before the app first writes over them. */
  showBackups?(): void
  /** Desktop only: looks for a newer version of the app; what is found comes to `onUpdate`. */
  checkForUpdate?(): void
  /** Desktop only: hears what is known of a newer version, at once and then on every change. */
  onUpdate?(listener: (state: UpdateState) => void): void
  /** Desktop only: closes the app, asking first about unsaved changes, installs the downloaded version and starts it. */
  installUpdate?(): void
  setDirty(dirty: boolean): void
  /**
   * Desktop only: where the keys of the assistant's services are kept, encrypted by the system
   * (Electron's `safeStorage`: the keychain on macOS, DPAPI on Windows, the keyring on Linux), rather
   * than in plain text with the other preferences. `available` is false where the system has no
   * way to encrypt them, and they stay with the preferences.
   */
  secrets?: SecretStore
}

/** What an agent outside the app is told of a tool it called. */
export interface BridgeResult {
  content: string
  isError?: boolean
  image?: { mime: string; data: string }
}

/** The door the desktop app opens for agents on the same computer. */
export interface AgentBridge {
  /** Opens or closes it. */
  set(on: boolean): void
  /** What an agent runs to come in: the app itself, as an MCP server. */
  command(): Promise<{ command: string; args: string[] }>
  /** Hears what agents ask for and answers. */
  onCall(listener: (name: string, input: unknown) => Promise<BridgeResult>): void
}

/** The keys of the assistant's services, kept apart: by the service they are for. */
export interface SecretStore {
  available(): Promise<boolean>
  get(name: SecretName): Promise<string | null>
  /** An empty value forgets the key. */
  set(name: SecretName, value: string): Promise<void>
}

export type SecretName = 'anthropic' | 'compatible'

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

/** What files are saved as, by extension: the save dialog shows it, and adds the extension to a name typed without one. */
const SAVED_TYPES: Record<string, { description: string; mime: string }> = {
  opencalque: { description: 'OpenCalque', mime: 'application/json' },
  opencad: { description: 'OpenCalque', mime: 'application/json' },
  json: { description: 'JSON', mime: 'application/json' },
  pdf: { description: 'PDF', mime: 'application/pdf' },
  svg: { description: 'SVG', mime: 'image/svg+xml' },
  png: { description: 'PNG', mime: 'image/png' },
  dxf: { description: 'DXF', mime: 'image/vnd.dxf' },
  csv: { description: 'CSV', mime: 'text/csv' },
}

function savedTypes(name: string) {
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase()
  const type = extension && SAVED_TYPES[extension]
  return type ? [{ description: type.description, accept: { [type.mime]: [`.${extension}`] } }] : undefined
}

function createBrowserPlatform(): Platform {
  let dirty = false
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault()
  })
  return {
    desktop: false,
    // The browser asks its own question when a page with unsaved changes is closed.
    setDialogLabels: () => {},
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
          const handle = token ?? (await picker({ suggestedName, types: savedTypes(suggestedName) }))
          const writable = await handle.createWritable()
          await writable.write(content)
          await writable.close()
          return { name: handle.name, token: handle }
        } catch (error) {
          if ((error as Error).name === 'AbortError') return null
          // The picker only opens soon after a click; a save that had to wait (for a font to load) is downloaded instead.
          if ((error as Error).name !== 'SecurityError' && (error as Error).name !== 'NotAllowedError') throw error
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
