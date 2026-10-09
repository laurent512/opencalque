import { Fragment, useEffect, useMemo, useState } from 'react'
import { applyOps, componentsOf, createDocument, declarativeExtension, importComponents, toSVG, type DeclarativeExtension, type Document, type Op, type ParametricKind } from '@opencalque/core'
import { Pencil, TextCursorInput, Trash2 } from 'lucide-react'
import { guarded, importLibrary, makeComponent } from './actions'
import { language, t, tn } from './i18n'
import { platform } from './platform'
import { setPrefs, usePrefs } from './prefs'
import { apply, BUILT_IN_EXTENSION, editComponent, loadExtensions, registry, replaceDoc, setTool, toast, useStore } from './store'
import { IconButton } from './ui'
import { bundledExtensions, bundledLibraries, remoteCatalog, type Library } from './catalog'

const close = () => useStore.setState({ warehouse: null })

/** A text of an extension that is not installed yet, in the user's language when the extension provides it. */
const own = (extension: { translations?: Record<string, Record<string, string>> }, text: string) => extension.translations?.[language()]?.[text] ?? text

const svgUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

/** A drawing of a parametric object with its default sizes; a door or window is shown in a piece of wall. */
function objectPicture(kind: ParametricKind): string {
  try {
    const hole = kind.opening?.(registry.resolveProps(kind, {}))
    const ops: Op[] = [{ op: 'add_node', node: { type: 'parametric', parent: 'page_1', layer: 'layer_1', kind: kind.kind, x: 0, y: 0, rotation: 0, props: {} } }]
    if (hole) ops.unshift({ op: 'add_node', node: { type: 'wall', parent: 'page_1', layer: 'layer_1', a: { x: hole.from - 350, y: 0 }, b: { x: hole.to + 350, y: 0 }, thickness: 200 } })
    return svgUrl(toSVG(applyOps(createDocument(), ops), 'page_1', registry))
  } catch {
    return ''
  }
}

/** One thing that can be put on the drawing, whatever it is and wherever it comes from. */
interface Card {
  key: string
  group: string
  name: string
  description: string
  picture: string
  place(): void
  /** Id of the component, for one that belongs to the drawing and can therefore be renamed, edited and deleted here. */
  own?: string
}

const OBJECTS = 'objects'
const DRAWING = 'drawing'

/**
 * The component library: every object that can be placed, in one searchable grid. That is the
 * parametric objects of the extensions in use (doors, windows, stairs…), the components of the
 * drawing that is open, and those of each library of the warehouse.
 */
function Components({ libraries }: { libraries: Library[] }) {
  const doc = useStore((s) => s.doc)
  const version = useStore((s) => s.extensionsVersion)
  const [loaded, setLoaded] = useState<Record<string, Document>>({})
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  /** Key of the card whose name is being typed. */
  const [renaming, setRenaming] = useState<string | null>(null)
  const hasSelection = useStore((s) => s.selection.length > 0)

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

  /** Copies components of a library into the drawing; with one, goes straight to placing it. */
  const add = (library: Document, ids: string[], from?: Library) =>
    guarded(() => {
      const result = importComponents(useStore.getState().doc, library, ids)
      // What arrives in the drawing is named in the user's language, like what the library showed.
      const names = Object.values(result.imported).flatMap((id): Op[] => {
        const name = result.doc.nodes[id]?.name
        const shown = name && from ? own(from, name) : name
        return shown && shown !== name ? [{ op: 'update_node', id, patch: { name: shown } }] : []
      })
      replaceDoc(applyOps(result.doc, names))
      close()
      if (ids.length === 1) setTool('place', { type: 'instance', component: result.imported[ids[0]] })
      else toast(tn(ids.length, '{n} component added. It is in the component library, under “In this drawing”.', '{n} components added. They are in the component library, under “In this drawing”.'))
    })

  const groups = [{ id: OBJECTS, name: t('Parametric objects') }, { id: DRAWING, name: t('In this drawing') }, ...libraries.map((l) => ({ id: l.id, name: own(l, l.name) }))]

  // Pictures are the objects themselves, rendered the way the drawing renders them.
  const objectCards = useMemo(
    () =>
      [...registry.parametric.values()].map((kind): Card => ({
        key: `kind ${kind.kind}`,
        group: OBJECTS,
        name: t(kind.label),
        description: kind.description ? t(kind.description) : '',
        picture: objectPicture(kind),
        place: () => (close(), setTool('place', { type: 'parametric', kind: kind.kind })),
      })),
    [version],
  )
  const drawingCards = useMemo(
    () =>
      componentsOf(doc).map((c): Card => ({
        key: `drawing ${c.id}`,
        own: c.id,
        group: DRAWING,
        name: c.name ?? c.id,
        description: c.description ?? '',
        picture: svgUrl(toSVG(doc, c.id, registry)),
        place: () => (close(), setTool('place', { type: 'instance', component: c.id })),
      })),
    [doc, version],
  )
  const libraryCards = useMemo(
    () =>
      Object.entries(loaded).flatMap(([id, library]) => {
        const from = libraries.find((l) => l.id === id)
        return componentsOf(library).map((c): Card => ({
          key: `${id} ${c.id}`,
          group: id,
          name: from ? own(from, c.name ?? c.id) : (c.name ?? c.id),
          description: from ? own(from, c.description ?? '') : (c.description ?? ''),
          picture: svgUrl(toSVG(library, c.id, registry)),
          place: () => add(library, [c.id], from),
        }))
      }),
    [loaded, version, libraries],
  )

  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = groups
    .filter((group) => filter === 'all' || filter === group.id)
    .map((group) => ({
      ...group,
      cards: [...objectCards, ...drawingCards, ...libraryCards].filter((card) => card.group === group.id && words.every((word) => `${card.name} ${card.description} ${group.name}`.toLowerCase().includes(word))),
    }))
    .filter((group) => group.cards.length > 0)
  const loading = libraries.some((l) => !loaded[l.id])
  const chosen = loaded[filter]

  return (
    <>
      <div className="warehouse-bar">
        <input autoFocus placeholder={t('Search every object and component…')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="warehouse-bar">
        <button className={`pill${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
          {t('All')}
        </button>
        {groups.map((group) => (
          <button key={group.id} className={`pill${group.id === filter ? ' active' : ''}`} title={((l) => l && own(l, l.description))(libraries.find((l) => l.id === group.id))} onClick={() => setFilter(group.id)}>
            {group.name}
          </button>
        ))}
      </div>
      <div className="warehouse-grid">
        {shown.map((group) => (
          <Fragment key={group.id}>
            <h4 className="warehouse-heading">{group.name}</h4>
            {group.cards.map((card) => (
              <div
                key={card.key}
                className="warehouse-card"
                role="button"
                tabIndex={0}
                title={t('Click, then click on the drawing to place it')}
                onClick={card.place}
                onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && card.place()}
              >
                {card.picture ? <img src={card.picture} alt="" /> : <span className="warehouse-blank" />}
                {renaming === card.key && card.own ? (
                  <input
                    className="inline-input"
                    autoFocus
                    defaultValue={card.name}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => {
                      setRenaming(null)
                      const name = e.target.value.trim()
                      if (name && name !== card.name) apply([{ op: 'update_node', id: card.own!, patch: { name } }])
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Escape') e.currentTarget.value = card.name
                      if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                    }}
                  />
                ) : (
                  <strong>{card.name}</strong>
                )}
                <span className="faint">{card.description}</span>
                {card.own && (
                  // What can be done to a component of the drawing, besides placing it.
                  <span className="warehouse-actions" onClick={(e) => e.stopPropagation()}>
                    <IconButton title={t('Rename')} onClick={() => setRenaming(card.key)}>
                      <TextCursorInput size={13} />
                    </IconButton>
                    <IconButton title={t('Edit component')} onClick={() => (close(), editComponent(card.own!))}>
                      <Pencil size={13} />
                    </IconButton>
                    <IconButton title={t('Delete component and its instances')} onClick={() => apply([{ op: 'remove_node', id: card.own! }])}>
                      <Trash2 size={13} />
                    </IconButton>
                  </span>
                )}
              </div>
            ))}
          </Fragment>
        ))}
        {shown.length === 0 && <p className="hint">{loading ? t('Loading…') : filter === DRAWING && words.length === 0 ? t('This drawing has no component yet. Select objects and choose Object › Create component.') : t('Nothing matches.')}</p>}
      </div>
      <footer className="warehouse-footer">
        <span className="hint">{t('Click an object to place it. Components taken from a library are copied into your drawing and listed under “In this drawing”.')}</span>
        <button className="text-button" disabled={!hasSelection} onClick={() => (close(), makeComponent())}>
          {t('Create component from selection')}
        </button>
        <button className="text-button" onClick={importLibrary}>
          {t('Import library…')}
        </button>
        {chosen && (
          <button className="text-button" onClick={() => add(chosen, componentsOf(chosen).map((c) => c.id), libraries.find((l) => l.id === filter))}>
            {t('Add the whole library')}
          </button>
        )}
      </footer>
    </>
  )
}

function Extensions({ catalog }: { catalog: DeclarativeExtension[] }) {
  const { installed, disabled } = usePrefs((p) => p.extensions)
  useStore((s) => s.extensionsVersion)
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
      toast(t('{name} installed. Its objects are in the component library.', { name: own(extension, extension.name) }))
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
            <p className="hint">{t('Doors, windows and stairs.')}</p>
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

/** Where components and extensions are found and added: those shipped with the app, and those of a web catalog. */
export function Warehouse() {
  const tab = useStore((s) => s.warehouse)
  const catalogUrl = usePrefs((p) => p.catalogUrl)
  const [url, setUrl] = useState(catalogUrl)
  const [remote, setRemote] = useState<{ libraries: Library[]; extensions: DeclarativeExtension[] }>({ libraries: [], extensions: [] })
  const libraries = useMemo(() => [...bundledLibraries(), ...remote.libraries], [remote])
  const extensions = useMemo(() => [...bundledExtensions(), ...remote.extensions], [remote])

  useEffect(() => {
    if (!tab || !catalogUrl) return setRemote({ libraries: [], extensions: [] })
    let stale = false
    remoteCatalog(catalogUrl).then(
      (catalog) => !stale && setRemote(catalog),
      (error) => !stale && toast(t('The catalog could not be read: {reason}', { reason: (error as Error).message })),
    )
    return () => {
      stale = true
    }
  }, [tab, catalogUrl])

  if (!tab) return null
  return (
    <div className="palette-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog warehouse" role="dialog" aria-label={tab === 'components' ? t('Component library') : t('Extensions')} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          {/* Two separate windows that share a frame: one to place things, one to add kinds of things. */}
          <h2>{tab === 'components' ? t('Component library') : t('Extensions')}</h2>
          <button className="text-button" onClick={close}>
            {t('Done')}
          </button>
        </header>
        {tab === 'components' ? <Components libraries={libraries} /> : <Extensions catalog={extensions} />}
        <form
          className="warehouse-catalog"
          onSubmit={(e) => {
            e.preventDefault()
            setPrefs({ catalogUrl: url.trim() })
          }}
        >
          <span className="faint">{t('More from a web catalog')}</span>
          <input placeholder="https://…/catalog.json" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="pill" type="submit">
            {t('Load')}
          </button>
        </form>
      </div>
    </div>
  )
}
