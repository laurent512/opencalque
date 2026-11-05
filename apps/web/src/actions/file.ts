import { applyOps, componentsOf, createDocument, dxfOps, freeComponentName, importComponents, NewerFormatError, parseDocument, pdfFontCharacters, quantities, quantitiesCsv, readDocument, serializeDocument, toDXF, toPDF, toSVG, type Document, type Op, type QuantityLabels } from '@opencalque/core'
import { abortable } from '../abortable'
import { showPanel } from '../dock'
import { registry } from '../extensions'
import { language, t, tn } from '../i18n'
import { pdfFonts } from '../pdfFonts'
import { platform, type OpenedFile } from '../platform'
import { usePrefs } from '../prefs'
import { recoverable } from '../recovery'
import { hideSplash } from '../splash'
import { apply, cancel, isDirty, loadDocument, select, useStore } from '../store'
import { decimalMark, imperialUnit } from '../units'
import { toast, useWindows } from '../windows'
import { baseName, guarded } from './common'
import { zoomToFit } from './view'

/* Drawings and files: new, open, save, the welcome window's ways in, exports, and what is imported from files. */

const get = useStore.getState

/** What a drawing file may be called: the current extension, the one from before the project was renamed, and plain JSON. */
export const DRAWING_EXTENSIONS = ['opencalque', 'opencad', 'json']

const confirmDiscard = () => !isDirty() || window.confirm(t('Discard unsaved changes?'))

/** An empty drawing whose first page and layer are named in the current language. */
export function blankDocument(): Document {
  return applyOps(createDocument(t('Untitled')), [
    { op: 'update_node', id: 'page_1', patch: { name: t('Page {n}', { n: 1 }) } },
    { op: 'update_layer', id: 'layer_1', patch: { name: t('Layer {n}', { n: 1 }) } },
  ])
}

export function newDocument(): void {
  if (confirmDiscard()) loadDocument(blankDocument(), null)
}

/**
 * Reads the text of a drawing file. A drawing from a newer version of the app is refused in the
 * user's language. One that needed putting right to open (see `repairDocument`) opens: what was
 * done goes to the console, and `then`, called once the drawing is shown, says so.
 */
export function readDrawing(name: string, text: string): { doc: Document; then: () => void } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(t('{file} is not an OpenCalque drawing: it does not hold JSON text.', { file: name }))
  }
  try {
    const { doc, repairs } = readDocument(json)
    if (repairs.length > 0) console.warn(`Put right on opening ${name}:\n${repairs.join('\n')}`)
    // Said once the drawing is in place: loading one clears what was being said.
    const then = () => {
      if (repairs.length > 0) toast(tn(repairs.length, 'One problem in {file} was put right so that it could be opened. Save it to keep the repair.', '{n} problems in {file} were put right so that it could be opened. Save it to keep the repairs.', { file: name }))
    }
    return { doc, then }
  } catch (error) {
    if (error instanceof NewerFormatError) throw new Error(t('{file} was saved by a newer version of OpenCalque. Update OpenCalque to open it.', { file: name }))
    throw new Error(t('{file} could not be opened: {reason}', { file: name, reason: (error as Error).message }))
  }
}

/** Opens a drawing file that was chosen or handed over. */
function openFile(file: OpenedFile): void {
  const { doc, then } = readDrawing(file.name, file.content)
  loadDocument(doc, file)
  useWindows.setState({ welcomeOpen: false })
  then()
}

export const openDocument = () =>
  guarded(async () => {
    if (!confirmDiscard()) return
    const file = await platform.open(DRAWING_EXTENSIONS)
    if (file) openFile(file)
  })

/** Opens a drawing the system asked the running app to open (on macOS, a double-click in the Finder). */
export const openRequested = (file: OpenedFile) =>
  guarded(() => {
    if (confirmDiscard()) openFile(file)
  })

let started = false

/** How long the loading screen may wait for `startUp` before the editor is shown anyway, in milliseconds. */
const SPLASH_LIMIT = 8000

/**
 * What happens once when the app starts: the file it was launched with is opened, or, without
 * one, the welcome window offers where to begin. The loading screen covers the editor until then.
 */
export const startUp = () =>
  guarded(async () => {
    // The interface is rebuilt when the language changes; the app starts only once.
    if (started) return
    started = true
    // Browser storage that never answers must not keep the editor hidden.
    setTimeout(hideSplash, SPLASH_LIMIT)
    try {
      // Unsaved work from a window that stopped without closing is offered back in the welcome window.
      const [kept, file] = await Promise.all([recoverable(), platform.initial()])
      if (file) openFile(file)
      if (kept.length > 0 || (!file && usePrefs.getState().showWelcome)) useWindows.setState({ welcomeOpen: true })
      // Asked only now, so that a drawing the app was started for counts as the one it was launched with.
      platform.onOpenFile?.((file) => openRequested(file))
    } finally {
      hideSplash()
    }
  })

/** Opens the drawing that comes with the app, as a new one with no file: a furnished flat to explore. */
export const openExample = () =>
  guarded(async () => {
    if (!confirmDiscard()) return
    // Fetched only when asked for, so that it does not weigh on every start.
    const example = await import('../../../../examples/apartment.opencalque?raw')
    loadDocument(parseDocument(JSON.parse(example.default)), null)
    useWindows.setState({ welcomeOpen: false })
  })

/** Reopens a drawing from the list the desktop app keeps. */
export const openRecent = (path: string) =>
  guarded(async () => {
    if (!confirmDiscard()) return
    const file = await platform.openRecent?.(path)
    if (!file) return toast(t('This file is no longer there'))
    openFile(file)
  })

export const saveDocument = (saveAs = false) =>
  guarded(async () => {
    cancel()
    const { doc, file } = get()
    const token = saveAs ? undefined : (file?.token ?? undefined)
    const stored = await platform.save(serializeDocument(doc), file?.name ?? `${baseName()}.opencalque`, token)
    if (stored) useStore.setState({ saved: doc, file: stored })
  })

/** What a PDF export is doing, told to the export window as it goes. */
export type PdfExportStage = 'fonts' | 'rendering' | 'saving'

/**
 * Exports papers as a PDF at their real size and scale: the selected ones, or every paper of the
 * drawing, one page each.
 * `only` gives the papers to take, in order; without it, the selected ones, or every paper.
 */
export const exportPdf = async (only?: string[], onProgress?: (stage: PdfExportStage) => Promise<void>, signal?: AbortSignal): Promise<boolean> => {
  let exported = false
  await guarded(async () => {
    try {
      signal?.throwIfAborted()
      const { doc, selection } = get()
      const papers = Object.values(doc.nodes).filter((node) => node.type === 'paper')
      if (papers.length === 0) return toast(t('Add a paper first (F): it sets the size and the scale of the printed sheet.'))
      const chosen = only ?? papers.filter((paper) => selection.includes(paper.id)).map((paper) => paper.id)
      const ids = chosen.length > 0 ? chosen : undefined
      // Letters the standard PDF fonts lack (Chinese, Greek, Polish…) need a font, loaded the first time.
      await onProgress?.('fonts')
      signal?.throwIfAborted()
      const fonts = await abortable(pdfFonts(pdfFontCharacters(doc, registry, ids), language()), signal)
      await onProgress?.('rendering')
      signal?.throwIfAborted()
      const pdf = toPDF(doc, registry, ids, { fonts })
      await onProgress?.('saving')
      signal?.throwIfAborted()
      const stored = await platform.save(pdf, `${baseName()}.pdf`)
      signal?.throwIfAborted()
      exported = stored !== null
      if (stored) toast(tn(chosen.length || papers.length, 'Exported {n} sheet as PDF, to scale', 'Exported {n} sheets as PDF, to scale'))
    } catch (error) {
      if (!signal?.aborted) throw error
    }
  })
  return exported
}

/** Exports one page (or, without one given, what is being edited) for other CAD programs. */
export const exportDxf = (container?: string) =>
  guarded(async () => {
    const { doc, scope } = get()
    await platform.save(toDXF(doc, container ?? scope, registry), `${baseName()}.dxf`)
  })

/**
 * Exports what a page holds as a table for a spreadsheet: rooms and their areas, walls with their
 * lengths and faces, doors and windows by kind, floors and walls by material, the objects placed. It is written the way
 * spreadsheets expect where the app's language is spoken: with a decimal comma, cells are
 * separated by semicolons.
 */
export const exportQuantities = (pageId?: string) =>
  guarded(async () => {
    const { doc, page } = get()
    // Whether numbers are written with a decimal comma, as the preferences say (by default, as the language does).
    const comma = decimalMark() === ','
    // In feet when lengths are shown in feet or inches, in metres otherwise.
    const system = imperialUnit() ? 'imperial' : 'metric'
    const [length, area, volume, thickness] = system === 'imperial' ? ['ft', 'ft²', 'ft³', 'in'] : ['m', 'm²', 'm³', 'mm']
    const labels: QuantityLabels = {
      rooms: t('Rooms'),
      walls: t('Walls'),
      openings: t('Doors and windows'),
      floors: t('Floors'),
      materials: t('Walls by material'),
      objects: t('Objects'),
      material: t('Material'),
      none: '—',
      name: t('Name'),
      kind: t('Kind'),
      count: t('Count'),
      total: t('Total'),
      area: t('Area ({unit})', { unit: area }),
      length: t('Length ({unit})', { unit: length }),
      thickness: t('Thickness ({unit})', { unit: thickness }),
      height: t('Height ({unit})', { unit: length }),
      width: t('Width ({unit})', { unit: length }),
      footprint: t('Footprint ({unit})', { unit: area }),
      gross: t('Face area, gross ({unit})', { unit: area }),
      cut: t('Openings ({unit})', { unit: area }),
      net: t('Face area, net ({unit})', { unit: area }),
      volume: t('Volume ({unit})', { unit: volume }),
    }
    const csv = quantitiesCsv(quantities(doc, pageId ?? page, registry), { separator: comma ? ';' : ',', decimal: comma ? ',' : '.', labels, name: (label) => t(label), system })
    await platform.save(csv, `${baseName()}.csv`)
  })

/** Exports one page (or, without one given, what is being edited) as a picture. */
export const exportSvg = (container?: string) =>
  guarded(async () => {
    const { doc, scope } = get()
    await platform.save(toSVG(doc, container ?? scope, registry), `${baseName()}.svg`)
  })

/** Adds the geometry of a DXF file to what is being edited, selects it and brings it into view. */
export function placeDxf(name: string, content: string): void {
  const { doc, scope } = get()
  const { ops, added, skipped } = dxfOps(doc, scope, content)
  if (added === 0) return toast(t('{file} holds nothing that can be imported: no lines, circles, arcs or text.', { file: name }))
  const before = new Set(Object.keys(doc.nodes))
  if (!apply(ops)) return
  select(Object.keys(get().doc.nodes).filter((id) => !before.has(id)))
  zoomToFit()
  const left = skipped > 0 ? ' ' + tn(skipped, '{n} other was left out (a kind of object that is not read).', '{n} others were left out (kinds of object that are not read).') : ''
  toast(tn(added, 'Imported {n} object from {file}.', 'Imported {n} objects from {file}.', { file: name }) + left)
}

export const importDxf = () =>
  guarded(async () => {
    const file = await platform.open(['dxf'])
    if (file) placeDxf(file.name, file.content)
  })

/**
 * Copies the components of another drawing, given as the text of its file, into this one, each a
 * component of its own however many times it was taken before (`libraryOps`), and shows them in
 * the Components panel.
 */
export function importLibraryFrom(name: string, content: string): void {
  const source = parseDocument(JSON.parse(content))
  const ids = componentsOf(source).map((c) => c.id)
  if (ids.length === 0) return toast(t('{file} has no components to import. To work on that drawing, open it instead (File → Open).', { file: name }))
  if (!apply(libraryOps(get().doc, source, ids).ops)) return
  showPanel('components')
  toast(tn(ids.length, 'Imported {n} component from {file}', 'Imported {n} components from {file}', { file: name }))
}

/**
 * The operations that copy components of a library into the drawing, as the library has them, each
 * a component of its own however many times it was taken before (`importComponents`, `fresh`), and
 * the id each is given. Each is named in the user's language as the library shows it (`names`, its
 * translations), with a number when the drawing has one of that name already.
 */
export function libraryOps(doc: Document, library: Document, ids: string[], names: Record<string, string> = {}): { ops: Op[]; imported: Record<string, string> } {
  const result = importComponents(doc, library, ids, { fresh: true })
  const given = new Set<string>()
  const named = Object.values(result.imported).flatMap((id): Op[] => {
    const name = result.doc.nodes[id]?.name ?? ''
    const shown = freeComponentName(doc, names[name] ?? (name || 'Component'), given)
    given.add(shown)
    return shown !== name ? [{ op: 'update_node', id, patch: { name: shown } }] : []
  })
  return { ops: [...result.ops, ...named], imported: result.imported }
}

/** Any OpenCalque document can be used as a library: this copies all of its components in. */
export const importLibrary = () =>
  guarded(async () => {
    const file = await platform.open(DRAWING_EXTENSIONS)
    if (file) importLibraryFrom(file.name, file.content)
  })
