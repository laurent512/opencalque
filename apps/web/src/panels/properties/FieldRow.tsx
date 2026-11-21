import { depthPatch, type Document, lengthOf, newId, type Node, type NodeOf, resolveColor, DEFAULT_INK, type Op, type Pattern, wallEndsOf, wallLength, turnToOps } from '@opencalque/core'
import { Fragment, useState, type ReactNode } from 'react'
import { Pipette, Link2, Undo2, SquareSplitHorizontal } from 'lucide-react'
import { msg, t } from '../../i18n'
import { registry } from '../../extensions'
import { usePrefs } from '../../prefs'
import { apply, setTool, useStore } from '../../store'
import { ColorChoice, type LayerOption } from '../../ColorChoice'
import { FillChoice, type FillChange } from '../../FillChoice'
import { MaterialChoice, type MaterialOption } from '../../MaterialChoice'
import { unfilledPatch } from '../../materials'
import { showPanel } from '../../dock'
import { WeightChoice } from '../../WeightChoice'
import { DashPicker, Field, FieldPair, IconButton, OpacitySlider, PictureRow, ProportionLock, Section, YesNo } from '../../ui'
import { formatAngle, formatLength } from '../../units'
import { GEOMETRY, LOOK_SECTIONS, rowName, rowsOf, STROKE, type FieldSpec, type Option } from './fields'
import { WallEdges } from './walls'
import { Select } from '../../Select'

/* One field of the Properties panel, for one object or several, and the sections fields are shown in. */

export function read(node: object, path: string): unknown {
  return path.split('.').reduce<any>((value, key) => value?.[key], node)
}

/** What a field shows for a node: the property at its path, or what its own reading (`get`) says. */
export const valueOf = (field: FieldSpec, node: Node, doc: Document): unknown => (field.get ? field.get(node, doc) : read(node, field.path))

/**
 * The patch that sets `path` to `value`, replacing the top-level property it lives in.
 * An undefined value unsets the property, and removes its parent object once that is empty.
 */
export function patchFor(node: Node, path: string, value: unknown): Record<string, unknown> {
  const [head, key] = path.split('.')
  if (!key) return { [head]: value ?? null }
  const next: Record<string, unknown> = { ...(node as any)[head], [key]: value }
  if (value === undefined) delete next[key]
  return { [head]: value === undefined && Object.keys(next).length === 0 ? null : next }
}

/** The patch that changes a node's fill: each key of `change` set in its style, or taken away when undefined. */
export function fillPatch(node: Node, change: FillChange): Record<string, unknown> {
  const style: Record<string, unknown> = { ...node.style }
  for (const [key, value] of Object.entries(change)) {
    if (value === undefined) delete style[key]
    else style[key] = value
  }
  return { style: Object.keys(style).length === 0 ? null : style }
}

export type Update = (patch: (node: Node) => Record<string, unknown>) => void

/** Properties that are sizes, or a height above the floor, which dragging must not take below zero. */
const SIZES = /(^|\.)(width|height|thickness|rx|ry|size|markerSize|extensionGap|strokeWidth|opacity|decimals|z)$/

export function FieldRow({ node, nodes, field, update }: { node: Node; nodes: Node[]; field: FieldSpec; update: Update }) {
  const doc = useStore((s) => s.doc)
  // With several objects selected, a property they do not all agree on is shown as mixed, with no
  // value of its own; setting it gives them all the same.
  const seen = (n: Node) => JSON.stringify(valueOf(field, n, doc) ?? field.fallback ?? null)
  const mixed = nodes.some((n) => seen(n) !== seen(node))
  const stored = mixed ? undefined : valueOf(field, node, doc)
  const value = mixed ? undefined : (stored ?? field.fallback)
  const commit = (next: unknown) => {
    // An angle turns each object about its own middle, as the knob above a box does, not about
    // the point its position is measured from. Read afresh: dragging the number writes many times.
    const now = useStore.getState().doc
    if (field.set) return apply(nodes.flatMap((n) => (now.nodes[n.id] ? field.set!(now.nodes[n.id], next, now) : [])))
    if (field.path === 'rotation' && typeof next === 'number' && now.nodes[node.id]) {
      return apply(turnToOps(now, nodes.map((n) => now.nodes[n.id]).filter(Boolean), next, registry))
    }
    // An elevation given another depth keeps its face where it is: its line moves (`depthPatch`).
    if (field.path === 'depth') return update((n) => (n.type === 'viewline' ? depthPatch(now, n, typeof next === 'number' ? next : undefined) : patchFor(n, field.path, next)))
    update((n) => patchFor(n, field.path, next))
  }
  if (field.type === 'number' || (field.type === 'string' && !field.options)) {
    return (
      <Field
        label={t(field.label)}
        placeholder={mixed ? t('Mixed') : field.empty && t(field.empty)}
        note={field.note && t(field.note)}
        from={field.empty && !mixed ? 0 : undefined}
        multiline={field.multiline}
        numeric={field.type === 'number'}
        length={field.length}
        suffix={field.angle || field.path === 'rotation' ? '°' : undefined}
        optional={field.optional}
        step={field.path === 'opacity' || field.path === 'bend' ? 0.01 : field.path.endsWith('strokeWidth') ? 0.1 : undefined}
        min={SIZES.test(field.path) || (field.length && field.path.startsWith('props.')) ? 0 : undefined}
        value={(value as string | number | undefined) ?? ''}
        onCommit={commit}
      />
    )
  }
  if (field.type === 'dash') {
    return (
      <div className="field">
        <span>{t(field.label)}</span>
        <DashPicker value={stored ?? field.fallback} none={mixed} onPick={(pattern) => commit(pattern ?? undefined)} />
      </div>
    )
  }
  if (field.type === 'fill') {
    // A fill is a colour and a pattern: set together, and mixed when either differs.
    const both = (n: Node) => JSON.stringify([read(n, 'style.fill') ?? null, read(n, 'style.pattern') ?? null])
    const several = nodes.some((n) => both(n) !== both(node))
    // Its section says it is the fill: the row has no name of its own, and the field takes its width.
    return (
      <div className="field fill-field">
        <FillChoice
          key={node.id}
          fill={several ? undefined : (read(node, 'style.fill') as string | undefined)}
          pattern={several ? undefined : (read(node, 'style.pattern') as Pattern | undefined)}
          inherited={field.inherited}
          fallback={String(field.fallback ?? 'none')}
          unset={field.unset}
          filled={field.filled}
          mixed={several}
          layer={layerChoice(doc, nodes, field)}
          title={t(field.label)}
          commit={(change) => update((n) => fillPatch(n, change))}
        />
      </div>
    )
  }
  if (field.material) {
    // A floor's material, picked by its swatch; a new one is made of the floors selected. Its look is
    // then the material's, as a wall's is: a fill the floor had of its own goes.
    const made = (id: string | null, before: Op[] = []) => apply([...before, ...nodes.map((n): Op => ({ op: 'update_node', id: n.id, patch: { material: id, ...(id ? unfilledPatch(n) : {}) } }))])
    const options = field.options!.map(({ value: id, label }): MaterialOption => {
      const material = id ? doc.materials?.[id] : undefined
      return { id, name: material ? material.name : t(label), fill: material ? (material.fill ?? '#ffffff') : 'none', pattern: material?.pattern }
    })
    const create = (name: string) => {
      const id = newId('material')
      const count = Object.keys(doc.materials ?? {}).length
      made(id, [{ op: 'add_material', material: { id, name: name || t('Material {n}', { n: count + 1 }), fill: '#e7e5e4' } }])
      showPanel('materials')
    }
    // Not a label: a label would hand every click to the button inside, opening its list again.
    return (
      <div className="field">
        <span>{t(field.label)}</span>
        <MaterialChoice label={t(field.label)} value={mixed ? undefined : ((value as string | undefined) ?? '')} mixed={mixed} options={options} pick={(id) => made(id || null)} create={create} />
      </div>
    )
  }
  if (field.ends) {
    // Not a label: a label would hand every click to the first button in it.
    return (
      <div className="field">
        <span>{t(field.label)}</span>
        <EndPicker side={field.ends} options={field.options!} value={mixed ? undefined : (value as string | undefined)} onPick={commit} />
      </div>
    )
  }
  // A colour's row, or a weight's, is not a label: a label hands every click on it to the button
  // inside, which would open its window again just as a click there closed it.
  const Row = field.type === 'color' || field.type === 'weight' || field.type === 'opacity' || field.type === 'boolean' ? 'div' : 'label'
  return (
    <Row className="field">
      <span>{t(field.label)}</span>
      {field.type === 'boolean' && <YesNo value={mixed ? undefined : value === true} label={t(field.label)} onChange={commit} />}
      {field.type === 'opacity' && (
        // Fully opaque is said by saying nothing.
        <OpacitySlider value={mixed ? undefined : (value as number)} onChange={(next) => commit(next >= 1 ? undefined : next)} />
      )}
      {field.type === 'weight' && (
        // Chosen as what it prints at; kept in the drawing as pixels of screen.
        <WeightChoice key={node.id} value={mixed ? undefined : (value as number)} mixed={mixed} label={t(field.label)} onPick={(pixels) => commit(pixels ?? undefined)} />
      )}
      {field.type === 'string' && (
        // A style that defines the plain font says so as "sans-serif", which is what no font means here.
        <Select
          value={mixed ? 'mixed' : value === 'sans-serif' && !field.options!.some((option) => option.value === value) ? '' : ((value as string | undefined) ?? '')}
          placeholder={mixed ? t('Mixed') : undefined}
          onChange={(chosen) => commit(chosen || undefined)}
          options={field.options!.map((option) => ({ value: option.value, label: t(option.label) }))}
        />
      )}
      {field.type === 'color' && (
        <ColorChoice
          key={node.id}
          stored={stored as string | undefined}
          fallback={(value as string | undefined) ?? '#ffffff'}
          unset={mixed ? msg('Mixed') : field.unset}
          commit={commit}
          layer={layerChoice(doc, nodes, field)}
        />
      )}
    </Row>
  )
}

/**
 * The layer a colour property can follow (`LAYER_COLOR`), when every object it is set for is on a
 * layer: its colour, whether they are on different layers, and whether no colour already means it,
 * as for a stroke, whose "from layer" is having none.
 */
function layerChoice(doc: Document, nodes: Node[], field: FieldSpec): LayerOption | undefined {
  const layers = nodes.map((n) => (n.layer === undefined ? undefined : doc.layers[n.layer]))
  if (layers.length === 0 || layers.some((layer) => !layer)) return undefined
  return { color: resolveColor(doc, layers[0]!.color) ?? DEFAULT_INK, several: layers.some((layer) => layer !== layers[0]), byDefault: field.unset === 'from layer' }
}

/**
 * A property row that knows about dimension styles. For a dimension whose style defines the
 * property, the row shows that value with a small link, as something the dimension takes rather
 * than has. It may still be given a value of its own: the row is then marked as an exception, with
 * a button that gives the property back to the style.
 */
function TypedRow(props: { node: Node; nodes: Node[]; field: FieldSpec; update: Update }) {
  const { node, nodes, field, update } = props
  const styles = useStore((s) => s.doc.dimensionStyles)
  const style = nodes.length === 1 && node.type === 'dimension' && node.dimensionStyle ? styles?.[node.dimensionStyle] : undefined
  const fromStyle = style ? read(style, field.path) : undefined
  if (fromStyle === undefined) return <FieldRow {...props} />
  const own = read(node, field.path) !== undefined
  // Giving it back: by having no value of its own.
  const giveBack = () => update((n) => patchFor(n, field.path, undefined))
  return (
    <div className={`typed-row${own ? ' own' : ''}`}>
      <FieldRow {...props} field={own ? field : { ...field, fallback: fromStyle as FieldSpec['fallback'], unset: msg('from its style') }} />
      {own ? (
        <IconButton title={t('Differs from its dimension style. Click to take the style’s value again')} onClick={giveBack}>
          <Undo2 size={12} />
        </IconButton>
      ) : (
        <i className="typed-mark" title={t('From its dimension style: change it there, or set a value here to make an exception')}>
          <Link2 size={11} />
        </i>
      )}
    </div>
  )
}

/**
 * Fields on one row (`rowsOf`): X, Y and Z, a width, depth and height. A size can keep its
 * proportions: the others of the row then change by as much, each object in its own proportions.
 * What has no size yet has none to keep.
 */
function GroupRow({ fields, ...props }: { node: Node; nodes: Node[]; fields: FieldSpec[]; update: Update }) {
  const row = rowName(fields)
  const kept = usePrefs((prefs) => prefs.keepProportions) && row.size
  const others = (own: FieldSpec) => fields.filter((field) => field !== own)
  // A property of the node: the others are set in the same patch, each in its own place.
  const along = (own: FieldSpec): Update => (patch) =>
    props.update((n) => {
      const next = patch(n)
      const [was, to] = [read(n, own.path), read({ ...n, ...next }, own.path)]
      if (typeof was !== 'number' || typeof to !== 'number' || !(was > 0) || !(to > 0)) return next
      let merged = { ...n, ...next } as Node
      let out = next
      for (const other of others(own)) {
        const far = read(n, other.path)
        if (typeof far !== 'number' || other.set) continue
        const more = patchFor(merged, other.path, tidy((far * to) / was))
        merged = { ...merged, ...more } as Node
        out = { ...out, ...more }
      }
      return out
    })
  // What its own reading and setting gives (`get`, `set`): the others by theirs.
  const setAlong = (own: FieldSpec): FieldSpec => ({
    ...own,
    set: (n, value, now) => {
      const was = valueOf(own, n, now)
      const ops = own.set!(n, value, now)
      if (typeof was !== 'number' || typeof value !== 'number' || !(was > 0) || !(value > 0)) return ops
      return [...ops, ...others(own).flatMap((other) => {
        const far = valueOf(other, n, now)
        return typeof far === 'number' && other.set ? other.set(n, tidy((far * value) / was), now) : []
      })]
    },
  })
  return (
    <FieldPair label={t(row.label)} lock={row.size && <ProportionLock />} three={fields.length === 3}>
      {fields.map((field) => (
        <TypedRow key={field.path} {...props} field={kept && field.set ? setAlong(field) : field} update={kept && !field.set ? along(field) : props.update} />
      ))}
    </FieldPair>
  )
}

/** What each symbol of a line's end looks like, drawn at the right-hand end of a short line. */
const END_SHAPES: Record<string, React.ReactNode> = {
  none: null,
  arrow: <path d="M22 9 14 5.5v7z" fill="currentColor" stroke="none" />,
  'open-arrow': <path d="M14.5 5 22 9l-7.5 4" fill="none" />,
  dot: <circle cx="19.5" cy="9" r="2.6" fill="currentColor" stroke="none" />,
  tick: <path d="M16.5 13.5 22.5 4.5" />,
}

/**
 * The symbols a line can end in, as a row of small pictures to pick from: each shows the end of
 * a line with that symbol on it, turned the way that end of the line points.
 */
function EndPicker(props: { side: 'start' | 'end'; options: Option[]; value: string | undefined; onPick: (value: string) => void }) {
  return (
    <PictureRow
      className="line-end-picker"
      value={props.value}
      onPick={props.onPick}
      choices={props.options.map((option) => ({
        value: option.value,
        name: t(option.label),
        picture: (
          <svg width="26" height="18" viewBox="0 0 26 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={props.side === 'start' ? { transform: 'scaleX(-1)' } : undefined}>
            <path d={option.value === 'arrow' ? 'M3 9h12' : option.value === 'dot' ? 'M3 9h14' : 'M3 9h19'} />
            {END_SHAPES[option.value]}
          </svg>
        ),
      }))}
    />
  )
}

/**
 * What a section shows besides its fields, under its title (untranslated, as a field's `section`):
 * before them or after them. A wall's material, its ends, a group's contents, what a placement is of.
 */
export interface SectionExtra {
  title: string
  before?: ReactNode
  after?: ReactNode
}

/**
 * Fields grouped under their section headings, in the order the sections first appear. A section
 * only `extras` have comes after Geometry (first, when there is none), in the order they give, so
 * that every object reads alike: where it is, then what is its own, then its look.
 */
export function Sections({ node, nodes = [node], fields, update, pick, extras = [] }: { node: Node; nodes?: Node[]; fields: FieldSpec[]; update: Update; pick?: boolean; extras?: SectionExtra[] }) {
  // A field that does not apply to every object selected is left out.
  const shown = fields.filter((f) => !f.when || nodes.every(f.when))
  const titles = [...new Set(shown.map((f) => f.section ?? GEOMETRY))]
  let at = titles.includes(GEOMETRY) ? titles.indexOf(GEOMETRY) + 1 : 0
  for (const { title } of extras) {
    if (titles.includes(title)) continue
    if (title === GEOMETRY) titles.unshift(title)
    else titles.splice(at, 0, title)
    at++
  }
  // A single wall can have its lines styled one by one; the view follows what the wall says, and the button opens it.
  const wall = nodes.length === 1 && node.type === 'wall' ? node : null
  const [byEdge, setByEdge] = useState(false)
  const split = !!wall && (byEdge || !!wall.edges)
  return (
    <>
      {titles.map((title) => (
        <Section
          key={title}
          title={t(title)}
          // Where the look of the selection is changed is where it can be taken from another object.
          action={
            pick && LOOK_SECTIONS.includes(title) && title === titles.find((other) => LOOK_SECTIONS.includes(other)) ? (
              <span className="section-actions">
                {wall && (
                  <IconButton
                    title={split ? t('One look for the whole wall: its lines lose the looks of their own') : t('A look for each line of the wall: its faces and its ends')}
                    active={split}
                    onClick={() => {
                      if (split && wall.edges) apply([{ op: 'update_node', id: wall.id, patch: { edges: null } }])
                      setByEdge(!split)
                    }}
                  >
                    <SquareSplitHorizontal size={13} />
                  </IconButton>
                )}
                <IconButton title={t('Copy the look of another object: click it on the drawing')} onClick={() => setTool('eyedropper')}>
                  <Pipette size={13} />
                </IconButton>
              </span>
            ) : undefined
          }
        >
          {extras.map((extra, i) => extra.title === title && <Fragment key={`before ${i}`}>{extra.before}</Fragment>)}
          {rowsOf(shown.filter((f) => (f.section ?? GEOMETRY) === title)).map((row) =>
            row.length > 1 ? <GroupRow key={row[0].path} node={node} nodes={nodes} fields={row} update={update} /> : <TypedRow key={row[0].path} node={node} nodes={nodes} field={row[0]} update={update} />,
          )}
          {title === STROKE && wall && split && <WallEdges wall={wall} />}
          {/* A view's a-b is the line on the plan it looks at, not a length of its own to set. */}
          {title === GEOMETRY && nodes.length === 1 && 'a' in node && node.type !== 'viewline' && <LengthRow node={node} />}
          {title === GEOMETRY && nodes.length === 1 && (node.type === 'wall' || node.type === 'line') && <AngleRow node={node} />}
          {extras.map((extra, i) => extra.title === title && <Fragment key={`after ${i}`}>{extra.after}</Fragment>)}
        </Section>
      ))}
    </>
  )
}

/** How far off level or upright, in degrees, a line is said to be nearly so: further, the angle is meant. */
const NEARLY = 1
/**
 * How far one end must be off the level or upright through the other, in mm, for the line to be
 * said not quite so: less is the noise of working points out, which drawing tidies to 0.001 mm.
 */
const DRIFT = 0.005

type Straight = Extract<Node, { a: unknown; b: unknown }>

/**
 * The end that stays where it is when a line or a wall is turned or made longer: its start, unless
 * only its start is free, so as not to move the walls that meet it at its end.
 */
function keptEnd(doc: Document, node: Straight): 'a' | 'b' {
  return node.type === 'wall' && wallEndsOf(doc, node, 'a').length === 1 && wallEndsOf(doc, node, 'b').length > 1 ? 'b' : 'a'
}

/** What else moves with the end of a line that moves: for a wall, the walls joined there. */
function endsMoving(doc: Document, node: Straight, end: 'a' | 'b') {
  return node.type === 'wall' ? wallEndsOf(doc, node, end) : [{ wall: node, end }]
}

const tidy = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * The length of a wall or a line, round the curve for a curved wall. Typed, or dragged, it makes it
 * longer or shorter in its own direction, its kept end (`keptEnd`) where it is; a curved wall keeps
 * its shape, bowing out in proportion. The walls that meet the end that moves follow it.
 */
function LengthRow({ node }: { node: Straight }) {
  const measure = (n: Straight) => (n.type === 'wall' ? wallLength(n) : lengthOf(n))
  const length = measure(node)
  // A line of no length has no direction to grow in.
  if (lengthOf(node) < 1e-6) {
    return (
      <label className="field">
        <span>{t('Length')}</span>
        <output>{formatLength(length)}</output>
      </label>
    )
  }
  const resize = (to: number) => {
    // Read afresh: dragging the number writes many times.
    const doc = useStore.getState().doc
    const now = doc.nodes[node.id] as Straight | undefined
    if (!now || !(to > 0)) return
    const k = to / measure(now)
    const kept = keptEnd(doc, now)
    const moving = kept === 'a' ? 'b' : 'a'
    const from = now[kept]
    const p = { x: tidy(from.x + (now[moving].x - from.x) * k), y: tidy(from.y + (now[moving].y - from.y) * k) }
    const bulge = now.type === 'wall' && now.bulge ? { bulge: tidy(now.bulge * k) } : {}
    apply(endsMoving(doc, now, moving).map(({ wall, end }): Op => ({ op: 'update_node', id: wall.id, patch: { [end]: p, ...(wall.id === now.id ? bulge : {}) } })))
  }
  return <Field label={t('Length')} numeric length min={1} value={length} onCommit={resize} />
}

/** An angle of a few hundred-thousandths of a degree written so that it shows, rather than as 0. */
const smallAngle = (degrees: number) => formatAngle(degrees, degrees >= 0.001 ? 3 : Math.min(8, 1 - Math.floor(Math.log10(degrees))))

/**
 * The direction of a wall or a line, counter-clockwise from the right as angles are drawn, to a
 * thousandth of a degree, so that one a hair off level shows it; when it is nearly but not quite
 * level or upright, a note says so with a button that sets it straight. Typed, or dragged with Alt
 * by whole degrees, it turns about its start, its length kept, unless only its start is free: then
 * about its end, so as not to move the walls that meet it there. The walls that meet the end that
 * moves follow it, as when that end is dragged.
 */
function AngleRow({ node }: { node: NodeOf<'wall'> | NodeOf<'line'> }) {
  const doc = useStore((s) => s.doc)
  const d = { x: node.b.x - node.a.x, y: node.b.y - node.a.y }
  const length = Math.hypot(d.x, d.y)
  if (length < 1e-6) return null
  const degrees = ((((Math.atan2(-d.y, d.x) * 180) / Math.PI) % 360) + 360) % 360
  const shown = (Math.round(degrees * 1000) / 1000) % 360
  const square = Math.round(degrees / 90) * 90
  const off = Math.abs(degrees - square)
  const kept = keptEnd(doc, node)
  const moving = kept === 'a' ? 'b' : 'a'
  const ends = endsMoving(doc, node, moving)
  const turn = (to: number) => {
    const angle = (to * Math.PI) / 180
    const along = { x: length * Math.cos(angle), y: -length * Math.sin(angle) }
    const from = node[kept]
    const sign = kept === 'a' ? 1 : -1
    // Level, the end takes the very y of the other; upright, its very x: tidied, it would be a hair off.
    const p = { x: Math.abs(along.x) < 1e-9 ? from.x : tidy(from.x + sign * along.x), y: Math.abs(along.y) < 1e-9 ? from.y : tidy(from.y + sign * along.y) }
    apply(ends.map(({ wall, end }): Op => ({ op: 'update_node', id: wall.id, patch: { [end]: p } })))
  }
  return (
    <>
      <Field label={t('Angle')} numeric suffix="°" value={shown} decimals={3} snap={1} onCommit={(to: number) => turn(to)} />
      {length * Math.sin((off * Math.PI) / 180) >= DRIFT && off < NEARLY && (
        <p className="hint warning">
          {square % 180 === 0 ? t('Not quite level: {angle}° off', { angle: smallAngle(off) }) : t('Not quite upright: {angle}° off', { angle: smallAngle(off) })}{' '}
          <button type="button" className="text-button" onClick={() => turn(square)}>
            {t('Straighten')}
          </button>
        </p>
      )}
    </>
  )
}
