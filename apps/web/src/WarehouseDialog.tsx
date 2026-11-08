import { searchable } from './search'
import { parametricPicture } from './pictures'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { applyOps, componentsOf, createDocument, declarativeExtension, SCHEDULES, toSVG, type DeclarativeExtension, type Document, type Op, type ParametricKind, type Schedule } from '@opencalque/core'
import { Globe, HardDrive, SlidersHorizontal, X } from 'lucide-react'
import { DRAWING_EXTENSIONS, guarded, importLibraryFrom, libraryOps, newTable, SCHEDULE_ABOUT, SCHEDULE_NAMES } from './actions'
import { showPanel } from './dock'
import { carry, svgUrl } from './carry'
import { language, msg, t, tn } from './i18n'
import { platform } from './platform'
import { setPrefs, usePrefs } from './prefs'
import { BUILT_IN_EXTENSION, loadExtensions, registry, useExtensions } from './extensions'
import { applyOrThrow, setTool, useStore } from './store'
import { toast, useWindows } from './windows'
import { IconButton } from './ui'
import { bundledExtensions, bundledLibraries, remoteCatalog, type Library } from './catalog'
import { formatLength, formatNumber, unitSuffix } from './units'

const close = () => useWindows.setState({ warehouse: null })

/** A text of an extension that is not installed yet, in the user's language when the extension provides it. */
const own = (extension: { translations?: Record<string, Record<string, string>> }, text: string) => extension.translations?.[language()]?.[text] ?? text

/**
 * A small house to picture tables of quantities with: two rooms of oak and of tiles between
 * brick walls 2.5 m high, a partition of blocks, and a few chairs. Made once, when first asked for.
 */
let sampleHouse: Document | null = null
function sample(): Document {
  if (sampleHouse) return sampleHouse
  const wall = (id: string, a: [number, number], b: [number, number], thickness: number, material: string): Op => ({ op: 'add_node', node: { type: 'wall', id, parent: 'page_1', layer: 'layer_1', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness, material } })
  const ops: Op[] = [
    { op: 'update_node', id: 'page_1', patch: { wallHeight: 2500 } },
    { op: 'add_material', material: { id: 'brick', name: t('Brick') } },
    { op: 'add_material', material: { id: 'block', name: t('Concrete block') } },
    { op: 'add_material', material: { id: 'oak', name: t('Oak parquet') } },
    { op: 'add_material', material: { id: 'tiles', name: t('Tiles') } },
    wall('n', [0, 0], [6000, 0], 300, 'brick'),
    wall('e', [6000, 0], [6000, 4000], 300, 'brick'),
    wall('s', [6000, 4000], [0, 4000], 300, 'brick'),
    wall('w', [0, 4000], [0, 0], 300, 'brick'),
    wall('p', [3500, 0], [3500, 4000], 100, 'block'),
    { op: 'add_node', node: { type: 'room', parent: 'page_1', layer: 'layer_1', name: t('Living room'), x: 1700, y: 2000, material: 'oak' } },
    { op: 'add_node', node: { type: 'room', parent: 'page_1', layer: 'layer_1', name: t('Kitchen'), x: 4700, y: 2000, material: 'tiles' } },
    { op: 'add_node', node: { type: 'component', id: 'chair', name: t('Chair') } },
    { op: 'add_node', node: { type: 'rect', parent: 'chair', x: 0, y: 0, width: 450, height: 450 } },
    ...[0, 1, 2].map((i): Op => ({ op: 'add_node', node: { type: 'instance', parent: 'page_1', layer: 'layer_1', component: 'chair', x: 600 + i * 600, y: 800 } })),
    { op: 'add_node', node: { type: 'page', id: 'sheet', name: 'Sheet' } },
  ]
  // A door and windows, when the extension that draws them is in use.
  if (registry.parametric.has('arch.door')) ops.push({ op: 'add_node', node: { type: 'parametric', parent: 'page_1', layer: 'layer_1', kind: 'arch.door', props: {}, x: 3500, y: 1500, rotation: 90 } })
  if (registry.parametric.has('arch.window')) for (const x of [1000, 4300]) ops.push({ op: 'add_node', node: { type: 'parametric', parent: 'page_1', layer: 'layer_1', kind: 'arch.window', props: {}, x, y: 0 } })
  return (sampleHouse = applyOps(createDocument(), ops))
}

/** A table of one kind as it would count the sample house, to show on its card: all at one scale, from their top-left corner. */
function tablePicture(schedule: Schedule): string {
  try {
    const doc = applyOps(sample(), [{ op: 'add_node', node: { ...newTable(schedule), size: 200, parent: 'sheet', layer: 'layer_1', x: 0, y: 0, source: 'page_1' } }])
    return svgUrl(toSVG(doc, 'sheet', registry).replace(/viewBox="[^"]*"/, 'viewBox="-300 -300 7600 5000"'))
  } catch {
    return ''
  }
}

/** One thing that can be put on the drawing, whatever it is and wherever it comes from. */
interface Card {
  key: string
  group: string
  name: string
  /** One short line under its name: the size it comes at, or a short note. */
  description: string
  /** What its tooltip says about it besides how to place it, when that is more than its card shows. */
  about?: string
  picture: string
  /** Puts it on the pointer, to be placed on the drawing; `carried` while the card is being dragged there. */
  place(carried?: boolean): void
  /** A parametric object: its sizes and options are set once placed. Marked on its card. */
  parametric?: boolean
  /** The library a component of a library is in, and its id there. */
  library?: { id: string; component: string }
}

/** Where parametric objects that say no category, or one nothing else is in, are listed. */
const OBJECTS = 'objects'
/** Groups of parametric objects that no library is, by the category they say, and their names. */
const CATEGORIES: Record<string, string> = {
  architecture: msg('Architecture'),
  annotation: msg('Annotation'),
  tables: msg('Tables of quantities'),
  living: msg('Living room'),
  dining: msg('Dining room'),
  bedroom: msg('Bedroom'),
  office: msg('Office'),
  heating: msg('Heating'),
}
/**
 * The headings of the list of sections, each with the sections the app knows under it, in the
 * order they are listed (the rooms in the order of a home). A section of any other name, a library
 * from a web catalog for instance, comes after them, under Others, and the objects that say no
 * category last of all.
 */
const HEADINGS: [heading: string, sections: string[]][] = [
  [msg('Rooms'), ['living', 'dining', 'bedroom', 'kitchen', 'bathroom', 'office']],
  [msg('Building'), ['architecture', 'electrical', 'heating']],
  [msg('Drawing'), ['annotation', 'tables']],
]
const SECTION_KEY = 'opencalque.librarySection'

/** The size a parametric object is placed at, in the unit the user works in: its box, or its length along a wall. */
function defaultSize(kind: ParametricKind): string {
  try {
    const props = registry.resolveProps(kind, {})
    if (kind.box) {
      const box = kind.box.bounds(props)
      return `${formatNumber(box.right - box.left)} × ${formatNumber(box.bottom - box.top)} ${unitSuffix()}`.trim()
    }
    return kind.size ? formatLength(Number(props[kind.size.x])) : ''
  } catch {
    return ''
  }
}

/** The section of the object library looked at last, kept on this computer: the library opens on it again. */
function lastSection(): string {
  try {
    return localStorage.getItem(SECTION_KEY) ?? 'all'
  } catch {
    return 'all'
  }
}

/**
 * The object library: what can be brought into the drawing, in one searchable grid. That is the
 * parametric objects of the extensions in use (doors, windows, stairs…) and the components of each
 * library of the warehouse, each taken a component of the drawing's own. What the drawing holds
 * already is in the Components panel, not here.
 */
function Components({ libraries }: { libraries: Library[] }) {
  const version = useExtensions((s) => s.version)
  const [loaded, setLoaded] = useState<Record<string, Document>>({})
  const [chosenSection, setChosenSection] = useState(lastSection)
  const [search, setSearch] = useState('')
  /** The section a search is narrowed to: all of them when it starts, and not remembered. */
  const [searchSection, setSearchSection] = useState('all')
  // The sizes on the cards are in the unit the user works in.
  const lengthUnit = usePrefs((p) => p.unit)

  useEffect(() => {
    let stale = false
    for (const library of libraries) {
      library.load().then(
        (opened) => !stale && setLoaded((all) => ({ ...all, [library.id]: opened })),
        (error) => !stale && toast(t('This library could not be opened: {reason}', { reason: (error as Error).message })),
      )
    }
    return () => {
      stale = true
    }
  }, [libraries])

  /**
   * Copies components of a library into the drawing, each a component of its own however many
   * times it was taken before, named in the user's language like what the library showed
   * (`libraryOps`). One alone is put on the pointer instead, and comes into the drawing with its
   * first placement: nothing is left when the placing is given up.
   */
  const add = (library: Document, ids: string[], from?: Library, carried?: boolean) =>
    guarded(() => {
      const names = from?.translations?.[language()] ?? {}
      close()
      if (ids.length === 1) return setTool('place', { type: 'library', library, component: ids[0], names, carried })
      applyOrThrow(libraryOps(useStore.getState().doc, library, ids, names).ops)
      showPanel('components')
      toast(tn(ids.length, '{n} component added. It is in the Components panel.', '{n} components added. They are in the Components panel.'))
    })

  // The sections: the drawing's own components first; then each library, split into the rooms its
  // components are for (the furniture into living room, dining room, bedroom and office), under
  // its own name for those that say none; and the sections parametric objects say. They are
  // listed under the headings of HEADINGS, the others after them. Parametric objects are listed
  // among the components of their kind (a table in the dining room), marked as such.
  const kinds = [...registry.parametric.values()]
  const sectionsOf = (library: Library) => {
    const rooms = Object.values(library.categories ?? {})
    const all = library.components !== undefined && rooms.length >= library.components
    return [...new Set(rooms), ...(all ? [] : [library.id])]
  }
  const present = new Set([...libraries.flatMap(sectionsOf), ...kinds.map((kind) => kind.category ?? OBJECTS), 'tables'])
  const known = HEADINGS.flatMap(([, ids]) => ids)
  const rest = [...present].filter((id) => !known.includes(id)).sort((a, b) => Number(a === OBJECTS) - Number(b === OBJECTS))
  const lists = [...HEADINGS.map(([heading, ids]) => ({ heading, ids: ids.filter((id) => present.has(id)) })), { heading: msg('Others'), ids: rest }].filter((list) => list.ids.length > 0)
  const nameOf = (id: string) => {
    const library = libraries.find((l) => l.id === id)
    if (id === OBJECTS) return t('Other objects')
    return library ? own(library, library.name) : CATEGORIES[id] ? t(CATEGORIES[id]) : t(id)
  }
  const groups = lists.flatMap((list) => list.ids).map((id) => ({ id, name: nameOf(id) }))

  // Pictures are the objects themselves, rendered the way the drawing renders them.
  const objectCards = useMemo(
    () =>
      [...registry.parametric.values()].map((kind): Card => ({
        key: `kind ${kind.kind}`,
        group: kind.category ?? OBJECTS,
        parametric: true,
        name: t(kind.label),
        // The size it comes at; how it is placed and changed is said by its tooltip.
        description: defaultSize(kind),
        about: kind.description ? t(kind.description) : undefined,
        picture: parametricPicture(kind),
        place: (carried) => (close(), setTool('place', { type: 'parametric', kind: kind.kind, carried })),
      })),
    [version, lengthUnit],
  )
  // Tables of quantities, which count what the drawing holds and stay up to date.
  const tableCards = useMemo(
    () =>
      SCHEDULES.map((schedule): Card => ({
        key: `table ${schedule}`,
        group: 'tables',
        name: t(SCHEDULE_NAMES[schedule]),
        description: t(SCHEDULE_ABOUT[schedule]),
        about: t('Counts what the page it is put on holds, and keeps up to date as the drawing changes.'),
        picture: tablePicture(schedule),
        place: (carried) => (close(), setTool('place', { type: 'table', table: newTable(schedule), carried })),
      })),
    [version, lengthUnit],
  )
  const libraryCards = useMemo(
    () =>
      Object.entries(loaded).flatMap(([id, library]) => {
        const from = libraries.find((l) => l.id === id)
        return componentsOf(library).map((c): Card => ({
          key: `${id} ${c.id}`,
          group: from?.categories?.[c.id] ?? id,
          library: { id, component: c.id },
          name: from ? own(from, c.name ?? c.id) : (c.name ?? c.id),
          description: from ? own(from, c.description ?? '') : (c.description ?? ''),
          picture: svgUrl(toSVG(library, c.id, registry)),
          place: (carried) => add(library, [c.id], from, carried),
        }))
      }),
    [loaded, version, libraries],
  )

  /** Copies the components of a drawing on this computer into this one, and shows them where they now are: in the Components panel. */
  const fromFile = () =>
    guarded(async () => {
      const file = await platform.open(DRAWING_EXTENSIONS)
      if (!file) return
      close()
      importLibraryFrom(file.name, file.content)
    })

  const setFilter = (section: string) => {
    setChosenSection(section)
    try {
      localStorage.setItem(SECTION_KEY, section)
    } catch {
      // Without storage the library opens on All next time.
    }
  }
  const words = searchable(search).split(/\s+/).filter(Boolean)
  const offered = (section: string) => section === 'all' || groups.some((group) => group.id === section)
  // A search looks through every section, narrowed to one only when one is chosen while searching.
  // Otherwise the section looked at last is shown, while it is offered: not a library gone since.
  const filter = words.length > 0 ? (offered(searchSection) ? searchSection : 'all') : offered(chosenSection) ? chosenSection : 'all'
  const choose = (section: string) => (words.length > 0 ? setSearchSection(section) : setFilter(section))

  // Every section with what it holds that matches the search, which the list of sections counts.
  const found = groups.map((group) => ({
    ...group,
    cards: [...objectCards, ...tableCards, ...libraryCards].filter((card) => card.group === group.id && words.every((word) => searchable(`${card.name} ${card.description} ${group.name}`).includes(word))),
  }))
  const counts: Record<string, number> = { all: 0 }
  for (const group of found) {
    counts[group.id] = group.cards.length
    counts.all += group.cards.length
  }
  const shown = found.filter((group) => (filter === 'all' || filter === group.id) && group.cards.length > 0)
  const loading = libraries.some((l) => !loaded[l.id])
  // The components of a library shown in one section, to be added to the drawing at once: all of
  // them when they are the whole library.
  const inSection = filter === 'all' ? [] : shown.flatMap((group) => group.cards).flatMap((card) => (card.library ? [card.library] : []))
  const source = inSection.length > 0 && inSection.every((one) => one.id === inSection[0].id) ? inSection[0].id : null
  const chosen = source ? loaded[source] : undefined
  const whole = chosen ? componentsOf(chosen).length === inSection.length : false

  /** One entry of the list of sections, with how many things it holds, or matches the search. */
  const section = (id: string, name: string) => (
    <button
      key={id}
      className={`warehouse-section${id === filter ? ' active' : ''}${counts[id] ? '' : ' empty'}`}
      aria-current={id === filter || undefined}
      title={((l) => l && own(l, l.description))(libraries.find((l) => l.id === id))}
      onClick={() => choose(id)}
    >
      <span className="warehouse-section-name">{name}</span>
      <span className="warehouse-count">{counts[id] ?? 0}</span>
    </button>
  )

  return (
    <>
      <div className="warehouse-bar">
        <input
          autoFocus
          placeholder={t('Search every object and component…')}
          value={search}
          onChange={(e) => {
            // A new search starts in every section.
            if (!search.trim()) setSearchSection('all')
            setSearch(e.target.value)
          }}
        />
        {/* The sections as a list to pick from, where the window is too narrow to show them beside what they hold. */}
        <select className="warehouse-section-picker" aria-label={t('Sections')} value={filter} onChange={(e) => choose(e.target.value)}>
          <option value="all">{t('All')}</option>
          {lists.map(({ heading, ids }) => (
            <optgroup key={heading} label={t(heading)}>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {nameOf(id)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="warehouse-body">
        <nav className="warehouse-sections" aria-label={t('Sections')}>
          {section('all', t('All'))}
          {lists.map(({ heading, ids }) => (
            <Fragment key={heading}>
              <h5>{t(heading)}</h5>
              {ids.map((id) => section(id, nameOf(id)))}
            </Fragment>
          ))}
          {/* Where more comes from: a drawing on this computer, whose components join this one's, or a catalog on the web, whose libraries join these. */}
          <div className="warehouse-more">
            <h5>{t('More components')}</h5>
            <button className="warehouse-section" title={t('Copies the components of a drawing on this computer into this one, where the Components panel lists them')} onClick={fromFile}>
              <HardDrive size={13} />
              <span className="warehouse-section-name">{t('From a file…')}</span>
            </button>
            <details className="warehouse-web">
              <summary className="warehouse-section">
                <Globe size={13} />
                <span className="warehouse-section-name">{t('From the web…')}</span>
              </summary>
              <CatalogAddress bare />
            </details>
          </div>
        </nav>
        <div className="warehouse-grid">
          {shown.map((group) => (
            <Fragment key={group.id}>
              <h4 className="warehouse-heading">
                <span className="warehouse-heading-name">{group.name}</span>
                {chosen && group.id === filter && (
                  <button className="text-button" onClick={() => add(chosen, inSection.map((one) => one.component), libraries.find((l) => l.id === source))}>
                    {whole ? t('Add the whole library') : t('Add all of these')}
                  </button>
                )}
              </h4>
              {group.cards.map((card) => (
                <div
                  key={card.key}
                  className="warehouse-card"
                  role="button"
                  tabIndex={0}
                  // Its name and what its card has no room for, then how to place it.
                  title={[card.name, card.about ?? card.description, t('Click, then click on the drawing to place it, or drag it onto the drawing')].filter(Boolean).join('\n\n')}
                  onClick={() => card.place()}
                  onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && card.place()}
                  // Dragged a few pixels, the library closes and the card's content follows the pointer.
                  onPointerDown={(e) => carry(e, card.place)}
                  // Dragged, the card is what it holds, not a picture to drop as a file.
                  onDragStart={(e) => e.preventDefault()}
                >
                  {card.picture ? <img src={card.picture} alt="" draggable={false} /> : <span className="warehouse-blank" />}
                  {card.parametric && (
                    <span className="warehouse-badge" title={t('Parametric: its sizes and options are set once it is placed, in its properties or by pulling its sides')}>
                      <SlidersHorizontal size={11} />
                    </span>
                  )}
                  <strong>{card.name}</strong>
                  <span className="faint">{card.description}</span>
                </div>
              ))}
            </Fragment>
          ))}
          {shown.length === 0 && <p className="hint">{loading ? t('Loading…') : t('Nothing matches.')}</p>}
        </div>
      </div>
    </>
  )
}

function Extensions({ catalog }: { catalog: DeclarativeExtension[] }) {
  const { installed, disabled } = usePrefs((p) => p.extensions)
  useExtensions((s) => s.version)
  // Installed extensions stay listed even when no catalog offers them any more.
  const all = [...catalog, ...Object.values(installed).filter((e) => !catalog.some((c) => c.id === e.id))]

  const change = (next: { installed?: typeof installed; disabled?: string[] }) => {
    setPrefs({ extensions: { installed, disabled, ...next } })
    loadExtensions()
  }
  const install = (extension: DeclarativeExtension) =>
    guarded(() => {
      // Building it is the validation: a broken extension is refused here, not at the next start.
      declarativeExtension(extension)
      change({ installed: { ...installed, [extension.id]: extension } })
      toast(t('{name} installed. Its objects are in the object library.', { name: own(extension, extension.name) }))
    })
  const remove = (id: string) => {
    const { [id]: _, ...rest } = installed
    change({ installed: rest })
  }
  const fromFile = () =>
    guarded(async () => {
      const file = await platform.open(['json'])
      if (!file) return
      const extension = JSON.parse(file.content)
      declarativeExtension(extension)
      await install(extension)
    })
  const builtInOn = !disabled.includes(BUILT_IN_EXTENSION)

  return (
    <>
      <div className="warehouse-list">
        <div className="warehouse-row">
          <div>
            <strong>{t('Architecture')}</strong> <span className="faint">{t('built in')}</span>
            <p className="hint">{t('Doors, windows, stairs, washbasins, a bathtub, a hob, a sink, fridges and a corner sofa.')}</p>
          </div>
          <button className="pill" onClick={() => change({ disabled: builtInOn ? [...disabled, BUILT_IN_EXTENSION] : disabled.filter((id) => id !== BUILT_IN_EXTENSION) })}>
            {builtInOn ? t('Turn off') : t('Turn on')}
          </button>
        </div>
        {all.map((extension) => (
          <div key={extension.id} className="warehouse-row">
            <div>
              <strong>{own(extension, extension.name)}</strong> <span className="faint">{extension.version}</span>
              {extension.description && <p className="hint">{own(extension, extension.description)}</p>}
              <p className="hint">{extension.objects.map((o) => own(extension, o.label)).join(' · ')}</p>
            </div>
            {installed[extension.id] ? (
              <button className="pill" onClick={() => remove(extension.id)}>
                {t('Remove')}
              </button>
            ) : (
              <button className="pill active" onClick={() => install(extension)}>
                {t('Install')}
              </button>
            )}
          </div>
        ))}
      </div>
      <footer className="warehouse-footer">
        <span className="hint">{t('These extensions are data, not programs: they describe objects and cannot run code, so installing one is safe.')}</span>
        <button className="text-button" onClick={fromFile}>
          {t('Install from a file…')}
        </button>
      </footer>
    </>
  )
}

/** What can be added: what ships with the app, and what the web catalog the user gave offers. Read only while `active`. */
function useCatalog(active: boolean) {
  const catalogUrl = usePrefs((p) => p.catalogUrl)
  const [remote, setRemote] = useState<{ libraries: Library[]; extensions: DeclarativeExtension[] }>({ libraries: [], extensions: [] })
  const libraries = useMemo(() => [...bundledLibraries(), ...remote.libraries], [remote])
  const extensions = useMemo(() => [...bundledExtensions(), ...remote.extensions], [remote])

  useEffect(() => {
    if (!active || !catalogUrl) return setRemote({ libraries: [], extensions: [] })
    let stale = false
    remoteCatalog(catalogUrl).then(
      (catalog) => !stale && setRemote(catalog),
      (error) => !stale && toast(t('The catalog could not be read: {reason}', { reason: (error as Error).message })),
    )
    return () => {
      stale = true
    }
  }, [active, catalogUrl])
  return { libraries, extensions }
}

/** The address of a catalog on the web that offers more libraries and extensions; `bare` where something else already says what it is for. */
function CatalogAddress({ bare = false }: { bare?: boolean }) {
  const catalogUrl = usePrefs((p) => p.catalogUrl)
  const [url, setUrl] = useState(catalogUrl)
  return (
    <form
      className="warehouse-catalog"
      onSubmit={(e) => {
        e.preventDefault()
        setPrefs({ catalogUrl: url.trim() })
      }}
    >
      {!bare && <span className="faint">{t('More from a web catalog')}</span>}
      <input placeholder="https://…/catalog.json" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button className="pill" type="submit">
        {t('Load')}
      </button>
    </form>
  )
}

/** The extensions that can be installed, removed and switched off. It is a page of Preferences, not a window of its own. */
export function ExtensionWarehouse() {
  const { extensions } = useCatalog(true)
  return (
    <div className="prefs-extensions">
      <Extensions catalog={extensions} />
      <CatalogAddress />
    </div>
  )
}

/** The object library: everything that can be placed, from the drawing, the app and a web catalog. */
export function Warehouse() {
  const open = useWindows((s) => s.warehouse) === 'components'
  const { libraries } = useCatalog(open)

  if (!open) return null
  return (
    <div className="palette-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog warehouse" role="dialog" aria-label={t('Object library')} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('Object library')}</h2>
          {/* Nothing is to be confirmed here: the window is only closed, as Escape or a click beside it does. */}
          <IconButton title={t('Close')} onClick={close}>
            <X size={16} />
          </IconButton>
        </header>
        <Components libraries={libraries} />
      </div>
    </div>
  )
}
