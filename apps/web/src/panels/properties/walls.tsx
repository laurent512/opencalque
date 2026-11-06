import { type Document, type NodeOf, type Node, type Op, applyOps, DEFAULT_MATERIAL, WALL_FILL, newId, resolveColor, autoJoinCuts, cornerJoin, cornerJoinOps, endLineOps, endLineShown, withEdge, type WallEdge, moveCornerOps, wallEndsAt, wallEndsOf, wallEndState, looseEndOps, wallArc, wallLength, wallJustifyOps } from '@opencalque/core'
import { executeById } from '../../commands'
import { useEffect, type ReactNode } from 'react'
import { Link2, Undo2 } from 'lucide-react'
import { msg, t, tn } from '../../i18n'
import { registry } from '../../extensions'
import { apply, selectCorner, useStore } from '../../store'
import { ColorChoice } from '../../ColorChoice'
import { WeightChoice } from '../../WeightChoice'
import { DashPicker, Field, FieldPair, IconButton, JustifyPicker, Section, YesNo } from '../../ui'
import { formatLength } from '../../units'
import { MaterialChoice, MaterialNote, type MaterialOption } from '../../MaterialChoice'
import { unfilledPatch } from '../../materials'
import { showPanel } from '../../dock'

/* What the Properties panel shows of walls: their material, line and curve, their ends and lines, and a selected corner. */

/** What each line a wall can be drawn by does, said where it is chosen. */
const WALL_LINES = {
  left: msg('By its left face: the corners are on that face, and the wall lies to the other side of it'),
  center: msg('By its middle: the wall lies equally on both sides of its corners'),
  right: msg('By its right face: the corners are on that face, and the wall lies to the other side of it'),
}

/**
 * Which line of the selected walls their corners are on: their middle, or one of their faces.
 * Changing it leaves the walls where they are: their line, and their corners, go onto the line
 * chosen, the walls joined there following. Pointing at a face shows it on the drawing, as left
 * and right depend on the way the wall was drawn.
 */
export function WallLine({ walls }: { walls: NodeOf<'wall'>[] }) {
  const values = new Set(walls.map((wall) => wall.justify ?? 'center'))
  const value = values.size === 1 ? [...values][0] : undefined
  const give = (justify: 'left' | 'center' | 'right') => {
    // One wall after the other, each from the drawing the one before left: a corner two of them
    // share goes where both their new lines meet.
    let doc = useStore.getState().doc
    const ops: Op[] = []
    for (const wall of walls) {
      const now = doc.nodes[wall.id]
      if (now?.type !== 'wall') continue
      const more = wallJustifyOps(doc, now, justify, registry)
      doc = applyOps(doc, more)
      ops.push(...more)
    }
    apply(ops)
  }
  const point = (justify: 'left' | 'center' | 'right' | null) =>
    useStore.setState({ edgeHover: walls.length === 1 && (justify === 'left' || justify === 'right') ? { wall: walls[0].id, edge: justify } : null })
  return (
    <div className="field">
      <span>{t('Reference line')}</span>
      <JustifyPicker value={value} names={{ left: t(WALL_LINES.left), center: t(WALL_LINES.center), right: t(WALL_LINES.right) }} label={t('Reference line')} onPick={give} onHover={point} />
    </div>
  )
}

/**
 * What the selected walls are made of: the default material or one of the drawing's, each shown
 * with its swatch, or a new one made from the list. A wall of several materials is drawn as
 * several walls side by side, each of one.
 */
export function WallMaterial({ walls }: { walls: NodeOf<'wall'>[] }) {
  const doc = useStore((s) => s.doc)
  const options = wallMaterials(doc)
  const materials = options.slice(1)
  const values = new Set(walls.map((wall) => wall.material ?? ''))
  // A fill a wall was given of its own, as walls had before materials, gives way to the material's.
  const made = (id: string | null, before: Op[] = []) => apply([...before, ...walls.map((wall): Op => ({ op: 'update_node', id: wall.id, patch: { material: id, ...unfilledPatch(wall) } }))])
  const create = (name: string) => {
    const id = newId('material')
    made(id, [{ op: 'add_material', material: { id, name: name || t('Material {n}', { n: materials.length + 1 }), fill: '#e7e5e4' } }])
    // Its look is set where the drawing's materials are.
    showPanel('materials')
  }
  return (
    // Not a label: a label would hand every click to the button inside, opening its list again.
    <>
      <div className="field">
        <span>{t('Material')}</span>
        <MaterialChoice label={t('Material')} value={values.size === 1 ? [...values][0] : undefined} mixed={values.size > 1} options={options} pick={(id) => made(id || null)} create={create} />
      </div>
      <MaterialNote />
    </>
  )
}

/** What a wall can be made of: the default material first (id ''), then the drawing's own. */
function wallMaterials(doc: Document): MaterialOption[] {
  const usual = doc.materials?.[DEFAULT_MATERIAL]
  return [
    { id: '', name: t('Default'), fill: usual?.fill ?? WALL_FILL, pattern: usual?.pattern },
    ...Object.values(doc.materials ?? {})
      .filter((material) => material.id !== DEFAULT_MATERIAL)
      .map((material) => ({ id: material.id, name: material.name, fill: material.fill ?? '#ffffff', pattern: material.pattern })),
  ]
}

/**
 * The material the wall tool draws the next walls of, chosen before drawing them. The setting
 * belongs to the session; in a drawing without that material, walls are of the default one.
 */
export function WallToolMaterial() {
  const doc = useStore((s) => s.doc)
  const chosen = useStore((s) => s.wallMaterial)
  const options = wallMaterials(doc)
  const create = (name: string) => {
    const id = newId('material')
    apply([{ op: 'add_material', material: { id, name: name || t('Material {n}', { n: options.length }), fill: '#e7e5e4' } }])
    useStore.setState({ wallMaterial: id })
    showPanel('materials')
  }
  return (
    <MaterialChoice
      label={t('Material of the next walls')}
      value={chosen && doc.materials?.[chosen] ? chosen : ''}
      mixed={false}
      options={options}
      pick={(id) => useStore.setState({ wallMaterial: id || null })}
      create={create}
    />
  )
}

/** How to curve a wall, and for one that is curved, the circle it follows. */
export function WallCurve({ wall }: { wall: Extract<Node, { type: 'wall' }> }) {
  const arc = wallArc(wall)
  if (!arc) return <p className="hint">{t('To curve the wall, drag the handle in its middle sideways, or type under Curve how far its middle should bow.')}</p>
  return <p className="hint">{t('Curved: radius {radius}, {length} round the curve. Set Curve to 0 to straighten it.', { radius: formatLength(arc.radius), length: formatLength(wallLength(wall)) })}</p>
}

/** The kinds of joint a corner of two walls can have. */
/**
 * The ways two walls can be joined, each with its name and a small picture of the corner. In the
 * pictures the tinted wall is "this wall" where the joint is chosen for one wall: the one that
 * passes, or the one that stops.
 */
type JointChoice = 'auto' | 'miter' | 'round' | 'bevel' | 'through' | 'butt'

const JOINT_PICTURES: Record<JointChoice, { name: string; own?: string; lines: string }> = {
  // Automatic has no picture of its own: it shows what it comes to at the corner's angle (see `JointPicker`).
  auto: { name: msg('Automatic: a sharp corner, cut off when the angle is too sharp'), lines: 'M5 16V4h18M11 16v-6h12' },
  miter: { name: msg('Sharp corner, at any angle'), lines: 'M5 16V4h18M11 16v-6h12' },
  round: { name: msg('Rounded'), lines: 'M5 16V10a6 6 0 0 1 6-6h12M11 16v-6h12' },
  bevel: { name: msg('Cut off, at any angle'), lines: 'M5 16V8.5L9.5 4H23M11 16v-6h12' },
  through: { name: msg('This wall runs past the other'), own: 'M5 4h18v6H5z', lines: 'M5 4h18M5 10h18M5 4v6M5 16v-6M11 16v-6' },
  butt: { name: msg('This wall stops against the other'), own: 'M11 4h12v6H11z', lines: 'M5 16V4h6v12M11 4h12M11 10h12' },
}

/** A row of small pictures of joints to pick one from, like the ends of a line. */
function JointPicker(props: { choices: JointChoice[]; value: JointChoice | undefined; names?: Partial<Record<JointChoice, string>>; cuts?: boolean; onPick: (value: JointChoice) => void }) {
  return (
    <div className="end-picker joint-picker" role="radiogroup">
      {props.choices.map((choice) => {
        const name = t(props.names?.[choice] ?? JOINT_PICTURES[choice].name)
        return (
          <button key={choice} type="button" role="radio" aria-checked={choice === props.value} className={choice === props.value ? 'active' : ''} title={name} aria-label={name} onClick={() => props.onPick(choice)}>
            <svg width="28" height="20" viewBox="0 0 28 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
              {JOINT_PICTURES[choice].own && <path d={JOINT_PICTURES[choice].own} fill="currentColor" fillOpacity="0.22" stroke="none" />}
              {/* Automatic is drawn as what it gives here and now, sharp or cut off, with an "A" to say it chose. */}
              <path d={choice === 'auto' && props.cuts ? JOINT_PICTURES.bevel.lines : JOINT_PICTURES[choice].lines} />
              {choice === 'auto' && (
                <text x="20.5" y="19" fontSize="8" fontWeight="700" fill="currentColor" stroke="none" textAnchor="middle">
                  A
                </text>
              )}
            </svg>
          </button>
        )
      })}
    </div>
  )
}

/**
 * How a wall is finished at each of its ends, said from the wall's own side: mitred, rounded, cut
 * off, simply meeting the other wall, running past it or stopping against it. An end is a corner
 * shared with another wall, so choosing here sets both walls, and they cannot disagree: when this
 * wall runs past, the other stops. An end that meets no wall, or more than one, has no choice to make.
 */
export function WallEnds({ wall }: { wall: Extract<Node, { type: 'wall' }> }) {
  const doc = useStore((s) => s.doc)
  const rows = (['a', 'b'] as const).map((end) => {
    const ends = wallEndsOf(doc, wall, end)
    const state = wallEndState(doc, wall, end)
    const mine = ends.findIndex((other) => other.wall.id === wall.id && other.end === end)
    // What it is joined to, or why it is not, and what can be done about it: set it loose, join it
    // again, or bring it onto the end of a wall it nearly meets.
    const status =
      state.joined.length > 0
        ? { text: null, action: { label: t('Detach'), title: t('Join this end to no wall: the walls joined here no longer follow it, nor it them'), ops: () => looseEndOps(wall, end, true) } }
        : state.loose
          ? { text: state.touching.length > 0 ? tn(state.touching.length, 'Detached from the wall that ends here', 'Detached from the {n} walls that end here') : t('Detached'), action: { label: t('Join again'), title: t('Join this end to the walls that end at the same point'), ops: () => looseEndOps(wall, end, false) } }
          : state.touching.length > 0
            ? { text: t('Touches a wall without being joined to it: it stops against it'), action: null }
            : state.near
              ? {
                  text: t('Nearly meets another wall, {distance} away, without being joined to it', { distance: formatLength(state.near.distance) }),
                  action: { label: t('Join them'), title: t('Bring this end onto the end of the other wall, so that they are joined'), ops: () => moveCornerOps(useStore.getState().doc, wall.parent, wall[end], state.near!.at) },
                }
              : null
    const base = { end, status }
    if (ends.length !== 2 || mine < 0) return { ...base, note: ends.length < 2 ? t('free end') : t('{n} walls meet here, mitred', { n: ends.length }) }
    const joint = cornerJoin(ends)
    // A butt joint is one of two things for this wall: it is the one that passes, or the one that stops.
    const value: JointChoice = joint === 'butt' ? (wall.joins?.[end] === 'through' || (wall.joins?.[end] !== 'butt' && ends[1 - mine].wall.joins?.[ends[1 - mine].end] === 'butt') ? 'through' : 'butt') : joint
    const pick = (choice: JointChoice) => apply(choice === 'through' ? cornerJoinOps(ends, 'butt', mine) : choice === 'butt' ? cornerJoinOps(ends, 'butt', 1 - mine) : cornerJoinOps(ends, choice))
    return { ...base, value, pick, cuts: autoJoinCuts(ends) }
  })
  return (
    <>
      {rows.map((row) => (
        <div key={row.end} className="field">
          <span>{row.end === 'a' ? t('At its start') : t('At its end')}</span>
          <div className="wall-end">
            {'pick' in row && row.pick ? (
              <JointPicker choices={['auto', 'miter', 'bevel', 'round', 'through', 'butt']} value={row.value} cuts={row.cuts} onPick={row.pick} />
            ) : (
              // A free end that touches or nearly meets another says that instead.
              !row.status?.text && <em className="faint">{'note' in row ? row.note : null}</em>
            )}
            {row.status?.text && <span className="hint">{row.status.text}</span>}
            {row.status?.action && (
              <button type="button" className="text-button" title={row.status.action.title} onClick={() => apply(row.status!.action!.ops())}>
                {row.status.action.label}
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  )
}

/**
 * The lines of a wall one by one, once its look is split: its two faces, as it runs from its
 * start to its end, and the lines across its two ends. Each can be hidden, and given a colour, a
 * weight and a kind of line of its own; what it leaves unset is the wall's. The line at an end
 * is shared with a wall joined there, so whether it is drawn is set for both.
 */
export function WallEdges({ wall }: { wall: Extract<Node, { type: 'wall' }> }) {
  const doc = useStore((s) => s.doc)
  const rows: { id: 'left' | 'right' | 'a' | 'b'; name: string; shown: boolean }[] = [
    { id: 'left', name: msg('Left face'), shown: wall.edges?.left?.show !== false },
    { id: 'right', name: msg('Right face'), shown: wall.edges?.right?.show !== false },
    { id: 'a', name: msg('At its start'), shown: endLineShown(doc, wall, 'a') },
    { id: 'b', name: msg('At its end'), shown: endLineShown(doc, wall, 'b') },
  ]
  // What a line takes when it says nothing: the wall's own look, else the layer's colour.
  const layer = wall.layer ? doc.layers[wall.layer] : undefined
  const inherited = {
    stroke: (resolveColor(doc, wall.style?.stroke ?? layer?.color) as string | undefined) ?? '#1f1f1f',
    strokeWidth: wall.style?.strokeWidth ?? 1,
    dash: wall.style?.dash,
  }
  const set = (id: 'left' | 'right' | 'a' | 'b', change: Partial<WallEdge>) => {
    // Read afresh: a choice may change the drawing twice in a row (show the line, then give it a kind).
    const now = useStore.getState().doc
    const fresh = now.nodes[wall.id]
    if (fresh?.type !== 'wall') return
    // The line at an end joined to one other wall is one line for both: its look is given to both ends.
    const ends = id === 'a' || id === 'b' ? wallEndsAt(now, fresh.parent, fresh[id]) : []
    const owners = ends.length === 2 ? ends : [{ wall: fresh, end: id }]
    apply(
      owners.map(({ wall: owner, end }): Op => {
        const edge: Record<string, unknown> = { ...owner.edges?.[end], ...change }
        for (const key of Object.keys(edge)) if (edge[key] === undefined) delete edge[key]
        return { op: 'update_node', id: owner.id, patch: { edges: withEdge(owner.edges, end, edge as WallEdge) } }
      }),
    )
  }
  const show = (id: 'left' | 'right' | 'a' | 'b', shown: boolean) => (id === 'a' || id === 'b' ? apply(endLineOps(useStore.getState().doc, wall, id, shown)) : set(id, { show: shown ? undefined : false }))
  const point = (edge: 'left' | 'right' | 'a' | 'b' | null) => useStore.setState({ edgeHover: edge ? { wall: wall.id, edge } : null })
  // Once the panel goes (another selection, nothing selected), no line stays lit.
  useEffect(() => () => useStore.setState({ edgeHover: null }), [])
  /** A property row of a line: its value, and whether it is the line's own or taken from the wall. */
  const row = (label: string, own: boolean, reset: () => void, control: ReactNode) => (
    <div className={`typed-row${own ? ' own' : ''}`}>
      <div className="field">
        <span>{t(label)}</span>
        {control}
      </div>
      {own ? (
        <IconButton title={t('Its own. Click to take the wall’s again')} onClick={reset}>
          <Undo2 size={12} />
        </IconButton>
      ) : (
        <i className="typed-mark" title={t('Inherited from the wall')}>
          <Link2 size={11} />
        </i>
      )}
    </div>
  )
  return (
    <div className="wall-edges" onPointerLeave={() => point(null)}>
      {rows.map((line) => {
        const edge = wall.edges?.[line.id]
        return (
          <div key={line.id} className={`wall-edge${line.shown ? '' : ' off'}`} onPointerEnter={() => point(line.id)}>
            <div className="wall-edge-head">
              <strong>{t(line.name)}</strong>
              {!line.shown && <em className="faint">{t('no line')}</em>}
            </div>
            {row(
              'Line',
              // Not drawn because of how the joint is made is not the wall's own choice.
              edge?.dash !== undefined || edge?.show !== undefined,
              () => {
                if (line.id === 'left' || line.id === 'right') return set(line.id, { dash: undefined, show: undefined })
                // An end goes back to what its joint usually does, for both walls there.
                const ends = wallEndsAt(doc, wall.parent, wall[line.id])
                apply(
                  (ends.length === 2 ? ends : [{ wall, end: line.id }]).map(({ wall: owner, end }): Op => {
                    const { show: _, dash: __, ...look } = owner.edges?.[end] ?? {}
                    return { op: 'update_node', id: owner.id, patch: { edges: withEdge(owner.edges, end, look) } }
                  }),
                )
              },
              // No line is one of the kinds of line: the line is then not drawn at all.
              <DashPicker
                value={edge?.dash ?? inherited.dash}
                faint={edge?.dash === undefined && line.shown}
                hidden={{ chosen: !line.shown, onPick: () => show(line.id, false) }}
                onPick={(pattern) => {
                  if (!line.shown) show(line.id, true)
                  set(line.id, { dash: pattern ?? undefined, ...(line.id === 'left' || line.id === 'right' ? { show: undefined } : {}) })
                }}
              />,
            )}
            {line.shown && (
              <>
                {row(
                  'Color',
                  edge?.stroke !== undefined,
                  () => set(line.id, { stroke: undefined }),
                  <ColorChoice key={`${wall.id} ${line.id}`} stored={edge?.stroke} fallback={inherited.stroke} unset={msg('inherited')} commit={(stroke) => set(line.id, { stroke: stroke as string | undefined })} />,
                )}
                {row(
                  'Weight',
                  edge?.strokeWidth !== undefined,
                  () => set(line.id, { strokeWidth: undefined }),
                  <WeightChoice
                    key={`${wall.id} ${line.id}`}
                    value={edge?.strokeWidth ?? inherited.strokeWidth}
                    faint={edge?.strokeWidth === undefined}
                    label={t('Weight')}
                    onPick={(pixels) => set(line.id, { strokeWidth: pixels ?? undefined })}
                  />,
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * A wall corner: the point where wall ends meet. It is not an object of the drawing, so what is
 * shown and changed here is written to the walls that meet there.
 */
export function CornerPanel({ at }: { at: { x: number; y: number } }) {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const ends = wallEndsAt(doc, scope, at)
  if (ends.length === 0) return null
  const join = cornerJoin(ends)
  const passing = Math.max(0, ends.findIndex(({ wall, end }) => wall.joins?.[end] === 'through'))
  const move = (to: { x: number; y: number }) => {
    if (apply(moveCornerOps(doc, scope, at, to))) selectCorner(to)
  }
  return (
    <>
      <Section title={ends.length > 1 ? t('Corner') : t('Wall end')}>
        <p className="hint">{ends.length > 1 ? t('{n} walls meet here. Drag the corner, or type where it should be: they all follow.', { n: ends.length }) : t('The free end of a wall. Bring it onto another wall’s end to join them.')}</p>
        <FieldPair label={t('X, Y')}>
          <Field label={t('X')} numeric length value={at.x} onCommit={(x) => move({ x, y: at.y })} />
          <Field label={t('Y')} numeric length value={at.y} onCommit={(y) => move({ x: at.x, y })} />
        </FieldPair>
        {ends.length === 1 && (
          <div className="pill-row">
            <button className="pill" onClick={() => executeById('wall.extend')}>
              {t('Extend to the next wall')}
            </button>
            <button className="pill" onClick={() => executeById('wall.trim')}>
              {t('Trim back to a wall')}
            </button>
          </div>
        )}
      </Section>
      {ends.length === 2 && (
        <Section title={t('Joint')}>
          <div className="field">
            <span>{t('Type')}</span>
            {/* Seen from the corner there is one butt joint; which wall passes is chosen below. */}
            <JointPicker
              choices={['auto', 'miter', 'bevel', 'round', 'through']}
              cuts={autoJoinCuts(ends)}
              names={{ through: msg('One wall runs through') }}
              value={join === 'butt' ? 'through' : join}
              onPick={(choice) => apply(cornerJoinOps(ends, choice === 'through' ? 'butt' : (choice as Exclude<JointChoice, 'through' | 'butt'>), passing))}
            />
          </div>
          <div className="field">
            <span>{t('Line between them')}</span>
            <YesNo value={endLineShown(doc, ends[0].wall, ends[0].end)} label={t('Line between them')} onChange={(on) => apply(endLineOps(doc, ends[0].wall, ends[0].end, on))} />
          </div>
          {join === 'butt' && (
            <button className="text-button" onClick={() => apply(cornerJoinOps(ends, 'butt', passing === 0 ? 1 : 0))}>
              {t('Let the other wall run through')}
            </button>
          )}
        </Section>
      )}
      {ends.length > 2 && (
        <Section title={t('Joint')}>
          <p className="hint">{t('Where more than two walls meet, they are mitred together.')}</p>
        </Section>
      )}
    </>
  )
}
