import { type Bounds, type NodeOf, applyOps, lookedAt, pagesOf, controlSide, linksAt, boundsOf, dist, mountedOn, mountOf, stretchOps, wallAxesBounds, childrenOf, nodePrimitives, rootOf, type Node, type Op, roomAt, regionPerimeter, wallEndsAt, TEXT_FIELDS } from '@opencalque/core'
import { executeById } from '../../commands'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react'
import { applyCalibration } from '../../floorplan'
import { msg, t } from '../../i18n'
import { LayerChoice } from '../../LayerChoice'
import { editComponent } from '../../navigation'
import { usePrefs } from '../../prefs'
import { registry } from '../../extensions'
import { apply, select, useStore } from '../../store'
import { toast } from '../../windows'
import { Field, FieldPair, FocusedSections, FoldingSections, labelOf, ProportionLock, Section, TypeIcon, YesNo } from '../../ui'
import { formatArea, formatLength, parseLength, unit, unitSuffix } from '../../units'
import { Sections, type SectionExtra, type Update } from './FieldRow'
import { AnnotationTool, DimensionTool, GridlineTool, SelectedDimensionStyle } from './dimensions'
import { CAMERA, commonFields, FIELD_NAMES, fieldsOf, FLOOR, GEOMETRY, REPRESENTATION, SHEET_FIELDS, VIEW_SEES } from './fields'
import { ModifierStack } from './modifiers'
import { EverySheet, PaperFormat, PaperTitleBlock } from './paper'
import { CornerPanel, WallCurve, WallEnds, WallLine, WallMaterial, WallToolMaterial } from './walls'
import { TableSettings } from './tables'
import { PlacingOpening, WallToolPresets } from './presets'
import { ViewCamera, ViewDescription, ViewPicture } from './viewpoint'
import { Select } from '../../Select'

/* The Properties panel: what is selected, or the tool in use when nothing is. */

/** What a room measures, read from the walls around it as they are now. */
function RoomFacts({ node }: { node: Extract<Node, { type: 'room' }> }) {
  const doc = useStore((s) => s.doc)
  const region = roomAt(doc, node.parent, node)
  if (!region) return <p className="hint">{t('The walls around this room do not close, so it has no floor to show. Close them, or drag the name into a closed space.')}</p>
  return (
    <>
      <p className="hint">{t('Floor area: {area}, perimeter: {perimeter}, measured inside the walls.', { area: formatArea(region.area), perimeter: formatLength(regionPerimeter(region)) })}</p>
      <p className="hint">{t('The room follows its walls. Drag its name to move it.')}</p>
    </>
  )
}

/**
 * What a switch controls, or what controls a light, each a button that selects it; and how to
 * change that, with the connect tool.
 */
function Controls({ node }: { node: Node }) {
  const doc = useStore((s) => s.doc)
  const gives = controlSide(node, registry) === 'out'
  const links = linksAt(doc, [node.id]).filter((link) => (link.role ?? 'control') === 'control' && (gives ? link.from === node.id : link.to === node.id))
  const others = links.flatMap((link) => {
    const other = doc.nodes[gives ? link.to : link.from]
    return other ? [other] : []
  })
  return (
    <div className="field controls-field">
      <span>{gives ? t('Controls') : t('Controlled by')}</span>
      <div>
        {others.length === 0 ? (
          <p className="hint">{gives ? t('Nothing yet.') : t('Nothing yet: no switch turns it on.')}</p>
        ) : (
          others.map((other) => (
            <button key={other.id} className="text-button" onClick={() => select([other.id])}>
              {labelOf(doc, other)}
            </button>
          ))
        )}
        <button className="text-button" onClick={() => executeById('tool.connect')}>
          {gives ? t('Connect lights…') : t('Connect a switch…')}
        </button>
      </div>
    </div>
  )
}

/**
 * The page whose plan a view looks at (a 3D view, an elevation, a section), which may be another
 * than the one it is shown on: picked among the drawing's pages. Its own page leaves `page` out.
 */
function LooksAt({ node }: { node: NodeOf<'camera'> | NodeOf<'elevation'> }) {
  const doc = useStore((s) => s.doc)
  const own = rootOf(doc, node.parent)?.id
  return (
    <div className="field">
      <span>{t('Plan on page')}</span>
      <Select
        value={lookedAt(doc, node) ?? ''}
        options={pagesOf(doc).map((page) => ({ value: page.id, label: labelOf(doc, page) }))}
        onChange={(page) => apply([{ op: 'update_node', id: node.id, patch: { page: page === own ? null : page } }])}
      />
    </div>
  )
}

/**
 * How wide and high the objects selected stand together, as the box drawn round them on the canvas,
 * and for walls between their axes too. Typing a size stretches them by their far side, the right
 * or the bottom (`stretchOps`): walls keep their thickness and stay joined, where scaling would
 * thicken them.
 */
function SelectionSize({ nodes }: { nodes: Node[] }) {
  const doc = useStore((s) => s.doc)
  const kept = usePrefs((prefs) => prefs.keepProportions)
  const ids = nodes.map((node) => node.id).join()
  const bounds = useMemo(() => {
    const ctx = { doc, registry, depth: 0 }
    return boundsOf(nodes.flatMap((node) => nodePrimitives(node, ctx)))
  }, [doc, ids])
  const axes = useMemo(() => wallAxesBounds(nodes.filter((node): node is NodeOf<'wall'> => node.type === 'wall')), [doc, ids])
  if (!bounds) return null
  const size = (box: Bounds, axis: 'x' | 'y') => (axis === 'x' ? box.maxX - box.minX : box.maxY - box.minY)
  // The difference typed is what the far side moves by, whichever of the two sizes it was typed in.
  const stretch = (box: Bounds, axis: 'x' | 'y') => (typed: number) => {
    if (!(typed > 0)) return
    const ops = stretchOps(doc, nodes, axis, typed - size(box, axis), registry)
    const across = axis === 'x' ? 'y' : 'x'
    if (!kept || !(size(box, axis) > 0)) return apply(ops)
    // Keeping the proportions: the other side goes as far in proportion, from where the first left them.
    const after = applyOps(doc, ops)
    apply([...ops, ...stretchOps(after, nodes.map((node) => after.nodes[node.id]), across, (size(box, across) * (typed - size(box, axis))) / size(box, axis), registry)])
  }
  return (
    <>
      <FieldPair label={t('W, H')} lock={<ProportionLock />}>
        <Field label={t('Width')} numeric length value={size(bounds, 'x')} onCommit={stretch(bounds, 'x')} />
        <Field label={t('Height')} numeric length value={size(bounds, 'y')} onCommit={stretch(bounds, 'y')} />
      </FieldPair>
      {/* Walls along one line only have no size across them between their axes. */}
      {axes && (size(axes, 'x') > 0.5 || size(axes, 'y') > 0.5) && (
        <FieldPair label={t('Axis to axis')}>
          {/* A size alone stays under the W or the H it is, which is all that says which it is. */}
          {size(axes, 'x') > 0.5 ? <Field label={t('Width, axis to axis')} numeric length value={size(axes, 'x')} onCommit={stretch(axes, 'x')} /> : <div className="field" />}
          {size(axes, 'y') > 0.5 ? <Field label={t('Height, axis to axis')} numeric length value={size(axes, 'y')} onCommit={stretch(axes, 'y')} /> : <div className="field" />}
        </FieldPair>
      )}
      <p className="hint">{t('A size typed moves what lies along the right side, or the bottom: walls across get longer, keep their thickness and stay joined.')}</p>
    </>
  )
}

/**
 * Whether the selected objects can be picked on the drawing and whether they are drawn, as the
 * Structure panel's two buttons say it for a row. Objects that disagree light neither side.
 */
function SelectionStatus({ nodes }: { nodes: Node[] }) {
  const set = (patch: Record<string, unknown>) => apply(nodes.map((node): Op => ({ op: 'update_node', id: node.id, patch })))
  const agreed = (seen: (node: Node) => boolean) => (nodes.every(seen) ? true : nodes.some(seen) ? undefined : false)
  return (
    // Not a label: a label would hand every click to the first tab.
    <div className="field status-field">
      <span>{t('Status')}</span>
      <YesNo
        label={t('Locked')}
        value={agreed((node) => !node.locked)}
        onChange={(free) => set({ locked: free ? null : true })}
        words={[<LockOpen key="free" size={13} />, <Lock key="locked" size={13} />]}
        titles={[t('Unlock'), t('Lock so it cannot be selected or moved on the drawing')]}
      />
      <YesNo
        label={t('Visible')}
        value={agreed((node) => node.visible !== false)}
        onChange={(shown) => set({ visible: shown ? null : false })}
        words={[<Eye key="shown" size={13} />, <EyeOff key="hidden" size={13} />]}
        titles={[t('Show'), t('Hide')]}
      />
    </div>
  )
}

/**
 * The panel of what is selected, laid out alike for every kind of object: Selection (its name, its
 * layer, its status, and for several their size together), then Geometry (where it is and how
 * large), then what is its own, each under its name (a wall's material and ends, a paper's sheet,
 * a group's contents, what a placement is of, under its kind's name with its own parameters), then
 * its look and its modifiers. What only one kind of object has goes in a section of its own, never
 * in Selection.
 */
function Selection({ nodes }: { nodes: Node[] }) {
  const inTemplate = useStore((state) => { const inside = rootOf(state.doc, state.scope); return inside?.type === 'component' && inside.sheet !== undefined })
  const doc = useStore((s) => s.doc)
  const update: Update = (patch) => apply(nodes.map((node): Op => ({ op: 'update_node', id: node.id, patch: patch(node) })))
  const node = nodes[0]
  const single = nodes.length === 1
  // What a component holds is on no layer: each placement of it gives its own.
  const layered = rootOf(doc, node.parent)?.type !== 'component'
  const walls = nodes.every((n) => n.type === 'wall') ? (nodes as NodeOf<'wall'>[]) : null
  const placed = nodes.every((n) => n.type === 'instance' || n.type === 'parametric') ? (nodes as (NodeOf<'instance'> | NodeOf<'parametric'>)[]) : null
  // Parametric objects of one kind have their own parameters under its name; anything else placed, under Component.
  const kinds = new Set(placed?.map((n) => (n.type === 'parametric' ? n.kind : '')))
  const placedTitle = (kinds.size === 1 && node.type === 'parametric' && registry.parametric.get(node.kind)?.label) || msg('Component')
  const geometry = [
    walls && <WallLine key="line" walls={walls} />,
    single && node.type === 'wall' && <WallCurve key="curve" wall={node} />,
    single && node.type === 'image' && (
      <Fragment key="scale">
        <button className="text-button" onClick={() => executeById('tool.calibrate')}>
          {t('Set its scale again…')}
        </button>
        <p className="hint">{t('Click two points on the picture whose real distance you know, then type that distance. The picture is resized to match.')}</p>
      </Fragment>
    ),
    // A paper's sheet, after where it lies: its format, which way up, its scale.
    single && node.type === 'paper' && <PaperFormat key="format" node={node} update={update} />,
    single && mountOf(node, registry)?.on === 'wall' && !mountedOn(doc, node, registry) && <p key="mount" className="hint">{t('It is on no wall, so it does not follow one nor show in its elevations. Drag it onto a wall to fix it there.')}</p>,
  ].filter(Boolean)
  const extras: (SectionExtra | false | null)[] = [
    geometry.length > 0 && { title: GEOMETRY, after: geometry },
    walls && { title: msg('Material'), before: <WallMaterial walls={walls} /> },
    single && node.type === 'wall' && { title: msg('Ends'), before: <WallEnds wall={node} /> },
    nodes.every((n) => n.type === 'dimension') && { title: msg('Dimension style'), before: <SelectedDimensionStyle dimensions={nodes as NodeOf<'dimension'>[]} /> },
    single && node.type === 'table' && { title: msg('Table of quantities'), before: <TableSettings node={node} /> },
    single && node.type === 'paper' && { title: msg('Title block'), before: <PaperTitleBlock node={node} update={update} /> },
    single && node.type === 'paper' && { title: msg('On every sheet'), before: <EverySheet node={node} update={update} /> },
    single && node.type === 'room' && { title: FLOOR, before: <RoomFacts node={node} /> },
    // A view's page is part of what it looks at.
    single && node.type === 'elevation' && pagesOf(doc).length > 1 && { title: VIEW_SEES, before: <LooksAt node={node} /> },
    // A viewpoint is its view: its representation (its frame, how it is drawn), its camera, and what to say of it to an image model.
    single && node.type === 'camera' && { title: REPRESENTATION, after: <ViewPicture camera={node} /> },
    single && node.type === 'camera' && { title: CAMERA, ...(pagesOf(doc).length > 1 ? { before: <LooksAt node={node} /> } : {}), after: <ViewCamera camera={node} /> },
    single && node.type === 'camera' && { title: msg('Description'), before: <ViewDescription camera={node} /> },
    single &&
      node.type === 'group' && {
        title: msg('Group'),
        before: (
          <>
            <p className="hint">{t('{n} objects inside. Double-click the group on the drawing to edit them.', { n: childrenOf(doc, node.id).length })}</p>
            <button className="text-button" onClick={() => executeById('edit.ungroup')}>
              {t('Ungroup')}
            </button>
          </>
        ),
      },
    // Only when there is something to show under it: a shower tray's own sizes are its W and D, and
    // a section of its name with nothing in it is left out.
    placed && single && (node.type === 'instance' || controlSide(node, registry)) && {
      title: placedTitle,
      after: (
        <>
          {single && controlSide(node, registry) && <Controls node={node} />}
          {single && node.type === 'instance' && (
            <>
              <p className="hint">{t('It looks as its component does. Lines the component gives no colour take the colour of the layer it is placed on.')}</p>
              <button className="text-button" onClick={() => editComponent(node.component, node)}>
                {t('Edit component')}
              </button>
              {(node.scaleX !== undefined || node.scaleY !== undefined) && (
                // Stretched by the sides of its frame: back to the proportions of its component, its corner where it is.
                <button className="text-button" onClick={() => update(() => ({ scaleX: null, scaleY: null }))}>
                  {t('Back to its own proportions')}
                </button>
              )}
            </>
          )}
        </>
      ),
    },
    single &&
      (node.type === 'text' || node.type === 'annotation') && {
        title: msg('Fields'),
        before: (
          <>
            <label className="field">
              <span>{t('Insert')}</span>
              <Select
                value=""
                placeholder={t('A field…')}
                onChange={(field) => update((n) => ({ text: `${'text' in n ? n.text : ''}{${field}}` }))}
                options={TEXT_FIELDS.filter((field) => inTemplate || !SHEET_FIELDS.includes(field)).map((field) => ({ value: field, label: t(FIELD_NAMES[field]) }))}
              />
            </label>
            <p className="hint">{t('A field is filled in by the drawing: written {page} in the text, it shows the name of the page it is on.')}</p>
          </>
        ),
      },
  ]
  // A view picked by one of its parts opens on that part: its camera or its line of view, or its representation.
  const part = useStore((s) => s.viewPart)
  const focused = single && part !== null && (node.type === 'camera' || node.type === 'elevation') ? { keep: [t('Selection'), t(part === 'view' ? REPRESENTATION : node.type === 'camera' ? CAMERA : VIEW_SEES)], release: () => useStore.setState({ viewPart: null }) } : null
  return (
    <FocusedSections.Provider value={focused}>
      {/* Counted only when there is more than one: "Selection (1)" says nothing. */}
      <Section title={t('Selection')} count={single ? undefined : nodes.length}>
        {/* What it says when it has no name of its own is what it is. Emptied, it goes back to that. */}
        {single && <Field key={node.id} label={t('Name')} lead={<TypeIcon node={node} />} placeholder={labelOf(doc, { ...node, name: undefined })} optional value={node.name ?? ''} onCommit={(name?: string) => update(() => ({ name: name?.trim() || null }))} />}
        {layered && (
          // Not a label: a label would hand every click to the button inside, opening its list again.
          <div className="field">
            <span>{t('Layer')}</span>
            <LayerChoice nodes={nodes} pick={(layer) => update(() => ({ layer }))} />
          </div>
        )}
        <SelectionStatus nodes={nodes} />
        {/* The box round several objects: what they are together, which no field of theirs says. */}
        {!single && <SelectionSize nodes={nodes} />}
        {/* Stacking, aligning and spacing are in the toolbar's Arrange menu, not here. */}
      </Section>
      <Sections node={node} nodes={nodes} fields={single ? fieldsOf(node, doc) : commonFields(nodes, doc)} update={update} pick extras={extras.filter((extra): extra is SectionExtra => !!extra)} />
      {single && <ModifierStack node={node} />}
    </FocusedSections.Provider>
  )
}

/** Sets the scale of an imported plan from two picked points and the real distance between them. */
function CalibrateTool() {
  const calibration = useStore((s) => s.calibration)
  const [text, setText] = useState('')
  const field = useRef<HTMLInputElement>(null)
  // Focus once the click that picked the second point has finished; focusing during it is undone
  // when the browser moves focus to what was clicked.
  useEffect(() => {
    if (!calibration) return
    const timer = setTimeout(() => field.current?.focus())
    return () => clearTimeout(timer)
  }, [calibration])
  // A door's width, as an example in the unit a bare number is read in: "3.5" typed in millimetres is
  // 3.5 mm, and an example in metres led people to shrink their plan a thousandfold.
  const example = formatLength(900)
  const submit = () => {
    const real = parseLength(text)
    if (real === null || real <= 0) return toast(t('Enter the distance as a number in {unit}, for example {example}. Another unit can be typed after it, as 90 cm.', { unit: unitSuffix() || unit(), example }))
    applyCalibration(real)
    setText('')
  }
  return (
    <Section title={t('Set the scale')}>
      <p className="hint">
        {calibration
          ? t('The two points are {measured} apart on the drawing now. Type their real distance, in {unit} unless you write another unit after it.', { measured: formatLength(dist(calibration.a, calibration.b)), unit: unitSuffix() || unit() })
          : t('Click two points on the imported plan whose real distance you know: the ends of a dimension, or a door width.')}
      </p>
      {calibration && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label className="field">
            <span>{t('Real distance')}</span>
            <input ref={field} placeholder={t('e.g. {example}', { example })} value={text} onChange={(e) => setText(e.target.value)} />
            <em>{unitSuffix()}</em>
          </label>
          <button className="text-button" type="submit">
            {t('Apply scale')}
          </button>
        </form>
      )}
    </Section>
  )
}

/** What can be changed about the selection, or about the tool in use when nothing is selected. */
export function Properties() {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const tool = useStore((s) => s.tool)
  const wallThickness = useStore((s) => s.wallThickness)
  const placing = useStore((s) => s.placing)
  // A door or a window about to be placed is set up here, before the click that puts it on a wall.
  const opening = tool === 'place' && placing?.type === 'parametric' ? registry.parametric.get(placing.kind) : undefined
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean)
  const corner = useStore((s) => s.corner)
  // A corner that is no longer one (its walls were moved or undone) shows as nothing selected.
  const onCorner = corner !== null && wallEndsAt(doc, useStore.getState().scope, corner).length > 0
  return (
    <div className="panel-body">
      <FoldingSections.Provider value>
        {tool === 'calibrate' ? (
          <CalibrateTool />
        ) : opening?.opening ? (
          <PlacingOpening kind={opening} />
        ) : onCorner ? (
          <CornerPanel at={corner} />
        ) : nodes.length > 0 ? (
          <Selection nodes={nodes} />
        ) : tool === 'dimension' ? (
          <DimensionTool />
        ) : tool === 'annotation' ? (
          <AnnotationTool />
        ) : tool === 'gridline' ? (
          <GridlineTool />
        ) : tool === 'paper' ? (
          <Section title={t('Paper tool')}>
            <p className="hint">{t('A paper is a sheet laid on the drawing, like a frame: it shows what goes on one page. Draw at real size; the scale of the paper sets how much of the drawing it covers.')}</p>
            <p className="hint">{t('Click one corner, then pull. The standard formats appear at the scale set in the bar above the tools; come close to one to take it, or click anywhere for a size of your own.')}</p>
          </Section>
        ) : tool === 'wall' ? (
          <Section title={t('Wall tool')}>
            <Field label={t('Thickness')} numeric length min={10} value={wallThickness} onCommit={(v) => v > 0 && useStore.setState({ wallThickness: v })} />
            <div className="field">
              <span>{t('Material')}</span>
              <WallToolMaterial />
            </div>
            <WallToolPresets />
            <p className="hint">{t('Type a length in the bar above the tools to draw a wall of that exact length.')}</p>
            <p className="hint">{t('Click each corner in turn. Double-click the last corner to close the walls back to the first one, or press Esc to stop.')}</p>
          </Section>
        ) : tool === 'measure' ? (
          <Section title={t('Measure tool')}>
            <p className="hint">{t('Click two points to read the distance between them. Nothing is added to the drawing. Use the Dimension tool to annotate.')}</p>
          </Section>
        ) : (
          <section className="section untitled">
            <p className="hint">{t('Nothing selected')}</p>
          </section>
        )}
      </FoldingSections.Provider>
    </div>
  )
}

