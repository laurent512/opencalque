import { declarativeExtension, parseDocument, type Vec2 } from '@opencalque/core'
import { DRAWING_EXTENSIONS, guarded, importLibraryFrom, placeDxf } from './actions'
import { platform } from './platform'
import { PLAN_EXTENSIONS, placeFloorPlan } from './floorplan'
import { t } from './i18n'
import { setPrefs, usePrefs } from './prefs'
import { isDirty, loadDocument, loadExtensions, toast, useStore } from './store'

const extensionOf = (name: string) => /\.([^.]+)$/.exec(name)?.[1].toLowerCase() ?? ''

/** An extension describes objects; a drawing holds nodes. */
const isExtension = (content: any) => Array.isArray(content?.objects) && !content.nodes

/** Installs an extension given as data (never code), and says where its objects are found. */
function installExtension(content: any): void {
  declarativeExtension(content)
  const { installed, disabled } = usePrefs.getState().extensions
  setPrefs({ extensions: { disabled, installed: { ...installed, [content.id]: content } } })
  loadExtensions()
  toast(t('{name} installed. Its objects are in the component library.', { name: String(content.name) }))
}

/**
 * Brings a file into the drawing, whatever it is, and sends it where its kind belongs:
 * - a picture or a PDF becomes a plan to trace;
 * - a .dxf file has its geometry added;
 * - another drawing gives its components, as a library;
 * - a .json extension is installed.
 * To work on another drawing itself, it is opened, not imported.
 */
export const importFile = () =>
  guarded(async () => {
    const file = await platform.openBytes([...PLAN_EXTENSIONS, 'dxf', ...DRAWING_EXTENSIONS])
    if (!file) return
    const kind = extensionOf(file.name)
    if (PLAN_EXTENSIONS.includes(kind)) return placeFloorPlan(file)
    const content = new TextDecoder().decode(file.bytes)
    if (kind === 'dxf') return placeDxf(file.name, content)
    if (!DRAWING_EXTENSIONS.includes(kind)) return toast(t('{file} is not something OpenCalque can import. Choose a picture, a PDF, a DXF, or a drawing to take its components.', { file: file.name }))
    const parsed = JSON.parse(content)
    if (isExtension(parsed)) installExtension(parsed)
    else importLibraryFrom(file.name, content)
  })

/** Whether something being dragged over the window is files from outside, as against a row or a panel of the app. */
export const carriesFiles = (data: DataTransfer | null) => Boolean(data && [...data.types].includes('Files'))

/**
 * Takes files dropped onto the app and sends each where its kind belongs:
 * - a picture or a PDF becomes a plan to trace, placed where it was dropped;
 * - a .dxf file has its geometry added to the drawing;
 * - an .opencalque file is opened as the drawing;
 * - a .json file is opened as a drawing, or installed when it is an extension (data, never code).
 * `at` is the point of the drawing under the pointer, when the files were dropped on it.
 */
export async function openDropped(files: File[], at?: Vec2): Promise<void> {
  const refused: string[] = []
  for (const file of files) {
    const kind = extensionOf(file.name)
    await guarded(async () => {
      if (PLAN_EXTENSIONS.includes(kind)) {
        await placeFloorPlan({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, at)
      } else if (kind === 'dxf') {
        placeDxf(file.name, await file.text())
      } else if (DRAWING_EXTENSIONS.includes(kind)) {
        const content = JSON.parse(await file.text())
        // An extension describes objects; a drawing holds nodes.
        if (kind === 'json' && isExtension(content)) installExtension(content)
        else {
          const doc = parseDocument(content)
          if (isDirty() && !window.confirm(t('Discard unsaved changes?'))) return
          // A dropped file gives the app no place to write back to: saving will ask where.
          loadDocument(doc, null)
          useStore.setState({ status: file.name })
        }
      } else refused.push(file.name)
    })
  }
  if (refused.length > 0) toast(t('{file} is not something OpenCalque can open. Drop a picture or a PDF to trace it, or an .opencalque drawing.', { file: refused.join(', ') }))
}
