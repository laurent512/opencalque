import { contextBridge, ipcRenderer } from 'electron'
import type { Platform } from '../../../web/src/platform'

const desktop: Platform = {
  desktop: true,
  request: (url, init) => ipcRenderer.invoke('net:request', url, init),
  claudeCli: (input) => ipcRenderer.invoke('claude:run', input),
  cancelClaudeCli: () => ipcRenderer.send('claude:cancel'),
  setCloseWarning: (labels) => ipcRenderer.send('doc:closeWarning', labels),
  open: (extensions) => ipcRenderer.invoke('file:open', extensions),
  openBytes: (extensions) => ipcRenderer.invoke('file:openBytes', extensions),
  save: (content, suggestedName, token) => ipcRenderer.invoke('file:save', content, suggestedName, token),
  recent: () => ipcRenderer.invoke('file:recent'),
  openRecent: (path) => ipcRenderer.invoke('file:openRecent', path),
  initial: () => ipcRenderer.invoke('file:initial'),
  setDirty: (dirty) => ipcRenderer.send('doc:dirty', dirty),
}

contextBridge.exposeInMainWorld('opencalqueDesktop', desktop)
