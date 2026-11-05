import { type Bounds, type NodeOf, boundsOf, dist, stretchOps, wallAxesBounds, childrenOf, nodePrimitives, componentUses, rootOf, layersOf, type Node, type Op, roomAt, wallEndsAt, TEXT_FIELDS } from '@opencalque/core'
import { swapSelectedComponent } from '../../actions'
import { EntryChoice } from '../../EntryChoice'
import { entryOf, isModel } from '../../entries'
import { executeById } from '../../commands'
import { useEffect, useMemo, useRef, useState } from 'react'
import { applyCalibration } from '../../floorplan'
import { t } from '../../i18n'
import { editComponent } from '../../navigation'
import { registry } from '../../extensions'
import { apply, useStore } from '../../store'
import { toast } from '../../windows'
import { Field, labelOf, Section } from '../../ui'
import { formatArea, formatLength, parseLength, unit, unitSuffix } from '../../units'
import { Sections, type Update } from './FieldRow'
import { AnnotationTool, DimensionTool, GridlineTool, SelectedDimensionStyle } from './dimensions'
import { commonFields, FIELD_NAMES, fieldsOf, SHEET_FIELDS } from './fields'
import { ModifierStack } from './modifiers'
import { PaperSheet } from './paper'
import { CornerPanel, WallCurve, WallEnds, WallLine, WallMaterial, WallToolMaterial } from './walls'
import { TableSettings } from './tables'

/* The Properties panel: what is selected, or the tool in use when nothing is. */

/** What a room measures, read from the walls around it as they are now. */
function RoomFacts({ node }: { node: Extract<Node, { type: 'room' }> }) {
  const doc = useStore((s) => s.doc)
  const region = roomAt(doc, node.parent, node)
  if (!region) return <p className="hint">{t('The walls around this room do not close, so it has no floor to show. Close them, or drag the name into a closed space.')}</p>
  return (
    <>
      <p className="hint">{t('Floor area: {area}, measured inside the walls.', { area: formatArea(region.area) })}</p>
      <p className="hint">{t('The room follows its walls. Drag its name to move it.')}</p>
    </>
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
    apply(stretchOps(doc, nodes, axis, typed - size(box, axis), registry))
  }
  return (
    <>
      <Field label={t('Width')} numeric length value={size(bounds, 'x')} onCommit={stretch(bounds, 'x')} />
      <Field label={t('Height')} numeric length value={size(bounds, 'y')} onCommit={stretch(bounds, 'y')} />
      {/* Walls along one line only have no size across them between their axes. */}
      {axes && size(axes, 'x') > 0.5 && <Field label={t('Width, axis to axis')} numeric length value={size(axes, 'x')} onCommit={stretch(axes, 'x')} />}
      {axes && size(axes, 'y') > 0.5 && <Field label={t('Height, axis to axis')} numeric length value={size(axes, 'y')} onCommit={stretch(axes, 'y')} />}
      <p className="hint">{t('A size typed moves what lies along the right side, or the bottom: walls across get longer, keep their thickness and stay joined.')}</p>
    </>
  )
}

function Selection({ nodes }: { nodes: Node[] }) {
  const inTemplate = useStore((state) => { const inside = rootOf(state.doc, state.scope); return inside?.type === 'component' && inside.sheet !== undefined })
  const doc = useStore((s) => s.doc)
  const update: Update = (patch) => apply(nodes.map((node): Op => ({ op: 'update_node', id: node.id, patch: patch(node) })))
  const node = nodes[0]
  const single = nodes.length === 1
  // What a component holds is on no layer: each placement of it gives its own.
  const layered = rootOf(doc, node.parent)?.type !== 'component'
  return (
    <>
      <Section title={single ? labelOf(doc, node) : t('{n} objects', { n: nodes.length })}>
        {/* What a thing is called is changed in the Structure panel (double-click its row). A room
            and a paper are the exceptions: their name is drawn, on the plan and in the title block.
            A room's is in its Name section, with the rest of what is written. */}
        {single && node.type === 'paper' && <Field label={t('Name')} value={node.name ?? ''} onCommit={(name) => update(() => ({ name: name || null }))} />}
        {layered && (
          <label className="field">
            <span>{t('Layer')}</span>
            <select value={node.layer ?? ''} onChange={(e) => update(() => ({ layer: e.target.value }))}>
              {node.layer === undefined && <option value="">{t('None')}</option>}
              {layersOf(doc).map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!single && <SelectionSize nodes={nodes} />}
        {/* Stacking, aligning and spacing are in the toolbar's Arrange menu, not here. */}
        {single && node.type === 'paper' && (
          <>
            <Field label={t('Position X')} numeric length value={node.x} onCommit={(x) => update(() => ({ x }))} />
            <Field label={t('Position Y')} numeric length value={node.y} onCommit={(y) => update(() => ({ y }))} />
          </>
        )}
        {nodes.every((n) => n.type === 'wall') && <WallMaterial walls={nodes as NodeOf<'wall'>[]} />}
        {nodes.every((n) => n.type === 'wall') && <WallLine walls={nodes as NodeOf<'wall'>[]} />}
        {nodes.every((n) => n.type === 'dimension') && <SelectedDimensionStyle dimensions={nodes as NodeOf<'dimension'>[]} />}
        {single && node.type === 'wall' && <WallEnds wall={node} />}
        {single && node.type === 'wall' && <WallCurve wall={node} />}
        {single && node.type === 'table' && <TableSettings node={node} />}
        {single && node.type === 'paper' && <PaperSheet node={node} update={update} />}
        {single && node.type === 'room' && <RoomFacts node={node} />}
        {single && node.type === 'image' && (
          <>
            <button className="text-button" onClick={() => executeById('tool.calibrate')}>
              {t('Set its scale again…')}
            </button>
            <p className="hint">{t('Click two points on the picture whose real distance you know, then type that distance. The picture is resized to match.')}</p>
          </>
        )}
        {single && node.type === 'group' && (
          <>
            <p className="hint">{t('{n} objects inside. Double-click the group on the drawing to edit them.', { n: childrenOf(doc, node.id).length })}</p>
            <button className="text-button" onClick={() => executeById('edit.ungroup')}>
              {t('Ungroup')}
            </button>
          </>
        )}
        {nodes.every((n) => n.type === 'instance' || n.type === 'parametric') && <InstanceComponent instances={nodes as (NodeOf<'instance'> | NodeOf<'parametric'>)[]} />}
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
      </Section>
      {single && (node.type === 'text' || node.type === 'annotation') && (
        <Section title={t('Fields')}>
          <label className="field">
            <span>{t('Insert')}</span>
            <select value="" onChange={(e) => e.target.value && update((n) => ({ text: `${'text' in n ? n.text : ''}{${e.target.value}}` }))}>
              <option value="">{t('A field…')}</option>
              {TEXT_FIELDS.filter((field) => inTemplate || !SHEET_FIELDS.includes(field)).map((field) => (
                <option key={field} value={field}>
                  {t(FIELD_NAMES[field])}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{t('A field is filled in by the drawing: written {page} in the text, it shows the name of the page it is on.')}</p>
        </Section>
      )}
      <Sections node={node} nodes={nodes} fields={single ? fieldsOf(node, doc) : commonFields(nodes, doc)} update={update} pick />
      {single && <ModifierStack node={node} />}
    </>
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
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean)
  const corner = useStore((s) => s.corner)
  // A corner that is no longer one (its walls were moved or undone) shows as nothing selected.
  const onCorner = corner !== null && wallEndsAt(doc, useStore.getState().scope, corner).length > 0
  return (
    <div className="panel-body">
        {tool === 'calibrate' ? (
          <CalibrateTool />
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
            <p className="hint">{t('Type a length in the bar above the tools to draw a wall of that exact length.')}</p>
            <p className="hint">{t('Click each corner in turn. Double-click the last corner to close the walls back to the first one, or press Esc to stop.')}</p>
          </Section>
        ) : tool === 'measure' ? (
          <Section title={t('Measure tool')}>
            <p className="hint">{t('Click two points to read the distance between them. Nothing is added to the drawing. Use the Dimension tool to annotate.')}</p>
          </Section>
        ) : (
          <Section title={t('Properties')}>
            <p className="hint">{t('Select an object to edit it. Lengths are in {unit}; the unit is set in Preferences.', { unit: unit() })}</p>
            <p className="hint">
              {t('Scroll to zoom, drag with the middle button or hold Space to pan; a tap on Space goes back to selecting. Shift constrains angles, Alt turns snapping off, Esc finishes.')}
            </p>
          </Section>
        )}
    </div>
  )
}

/**
 * What the selected placements are of (a component, or a model of parametric objects: `entries.ts`),
 * to be made placements of another, each where it is, as it is turned. Inside a component, the
 * components that would hold it are not offered.
 */
function InstanceComponent({ instances }: { instances: (NodeOf<'instance'> | NodeOf<'parametric'>)[] }) {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const placed = new Set(instances.map((instance) => entryOf(instance)))
  const root = rootOf(doc, scope)
  const one = placed.size === 1 ? [...placed][0] : null
  return (
    // Not a label: a label would hand every click to the button inside, opening its list again.
    <div className="field">
      <span>{t('Component')}</span>
      <EntryChoice
        label={t('Component')}
        value={one ?? undefined}
        mixed={placed.size > 1}
        exclude={(entry) => !isModel(entry) && root?.type === 'component' && componentUses(doc, entry, root.id)}
        pick={swapSelectedComponent}
      />
    </div>
  )
}
