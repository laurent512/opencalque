import { useEffect, useState } from 'react'
import { About } from './About'
import { startUp } from './actions'
import { startAutosave } from './autosave'
import { carriesFiles, openDropped } from './drop'
import { CommandPalette } from './CommandPalette'
import { ContextMenu } from './ContextMenu'
import { handleKeyDown } from './commands'
import { t } from './i18n'
import { Layout } from './Layout'
import { MenuBar } from './MenuBar'
import { platform } from './platform'
import { Preferences } from './Preferences'
import { isDirty, useStore } from './store'
import { watchScrubKey } from './ui'
import { Welcome } from './Welcome'
import { Warehouse } from './WarehouseDialog'

/**
 * Lets files be dropped anywhere on the window, from a file manager or the desktop. While they
 * are over it, a veil says what dropping will do; without this the browser would leave the app to
 * show the file instead.
 */
function DropTarget() {
  const [over, setOver] = useState(false)
  useEffect(() => {
    // Entering a child fires before leaving its parent, so what is counted is how deep the pointer is.
    let depth = 0
    const outside = (e: DragEvent) => carriesFiles(e.dataTransfer)
    const onEnter = (e: DragEvent) => {
      if (!outside(e)) return
      depth++
      setOver(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!outside(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const onOver = (e: DragEvent) => {
      if (outside(e)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (!outside(e)) return
      depth = 0
      setOver(false)
      // The assistant's message box takes pictures for itself; anywhere else, the files are for the drawing.
      if ((e.target as Element | null)?.closest?.('.assistant-composer')) return
      e.preventDefault()
      // Dropped on the drawing, a picture lands where it was dropped.
      const canvas = document.querySelector('.stage canvas')
      const box = canvas?.getBoundingClientRect()
      const onDrawing = box && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom
      const { view } = useStore.getState()
      const at = onDrawing ? { x: (e.clientX - box.left - view.x) / view.zoom, y: (e.clientY - box.top - view.y) / view.zoom } : undefined
      openDropped([...(e.dataTransfer?.files ?? [])], at)
    }
    // Heard on the way down, before the panels: their own drag and drop (for rearranging them)
    // would otherwise swallow the files.
    const events = [['dragenter', onEnter], ['dragleave', onLeave], ['dragover', onOver], ['drop', onDrop]] as const
    for (const [name, handler] of events) window.addEventListener(name, handler, true)
    return () => {
      for (const [name, handler] of events) window.removeEventListener(name, handler, true)
    }
  }, [])
  if (!over) return null
  return (
    <div className="drop-veil">
      <p>{t('Drop a picture or a PDF to trace it, or a drawing to open it')}</p>
    </div>
  )
}

export function App() {
  const name = useStore((s) => s.doc.name)
  const dirty = useStore(isDirty)
  const fileName = useStore((s) => s.file?.name)

  useEffect(() => {
    startUp()
    // The desktop app asks before closing with unsaved changes; it needs the words in this language.
    platform.setCloseWarning({ message: t('You have unsaved changes.'), discard: t('Discard changes'), cancel: t('Cancel') })
  }, [])
  useEffect(startAutosave, [])
  useEffect(watchScrubKey, [])
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  useEffect(() => {
    platform.setDirty(dirty)
  }, [dirty])
  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${fileName ?? name} – OpenCalque`
  }, [dirty, fileName, name])

  return (
    <div className="app">
      <MenuBar />
      <Layout />
      <CommandPalette />
      <Preferences />
      <ContextMenu />
      <Warehouse />
      <Welcome />
      <About />
      <DropTarget />
    </div>
  )
}
