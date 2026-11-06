import { contextBridge, ipcRenderer } from 'electron'
import type { Platform } from '../../../web/src/platform'

const desktop: Platform = {
  desktop: true,
  request: (url, init) => ipcRenderer.invoke('net:request', url, init),
  claudeCli: (input) => ipcRenderer.invoke('claude:run', input),
  cancelClaudeCli: () => ipcRenderer.send('claude:cancel'),
  agentBridge: {
    set: (on) => ipcRenderer.send('bridge:set', on),
    command: () => ipcRenderer.invoke('bridge:command'),
    onCall: (listener) => {
      ipcRenderer.on('bridge:call', async (_, id: number, name: string, input: unknown) => ipcRenderer.send('bridge:result', id, await listener(name, input)))
    },
  },
  setTheme: (dark, followsSystem) => ipcRenderer.send('app:theme', dark, followsSystem),
  setDialogLabels: (labels) => ipcRenderer.send('app:labels', labels),
  open: (extensions) => ipcRenderer.invoke('file:open', extensions),
  openBytes: (extensions) => ipcRenderer.invoke('file:openBytes', extensions),
  save: (content, suggestedName, token) => ipcRenderer.invoke('file:save', content, suggestedName, token),
  recent: () => ipcRenderer.invoke('file:recent'),
  openRecent: (path) => ipcRenderer.invoke('file:openRecent', path),
  initial: () => ipcRenderer.invoke('file:initial'),
  onOpenFile: (listener) => {
    ipcRenderer.on('file:openRequest', async (_, path: string) => {
      const file = await ipcRenderer.invoke('file:openRequested', path)
      if (file) listener(file)
    })
    ipcRenderer.send('file:listen')
  },
  showBackups: () => ipcRenderer.send('file:showBackups'),
  checkForUpdate: () => ipcRenderer.send('update:check'),
  onUpdate: (listener) => {
    ipcRenderer.on('update:state', (_, state) => listener(state))
    ipcRenderer.send('update:listen')
  },
  installUpdate: () => ipcRenderer.send('update:install'),
  setDirty: (dirty) => ipcRenderer.send('doc:dirty', dirty),
  secrets: {
    available: () => ipcRenderer.invoke('secret:available'),
    get: (name) => ipcRenderer.invoke('secret:get', name),
    set: (name, value) => ipcRenderer.invoke('secret:set', name, value),
  },
}

contextBridge.exposeInMainWorld('opencalqueDesktop', desktop)
