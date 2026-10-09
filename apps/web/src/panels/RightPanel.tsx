import { childrenOf, DEFAULT_PAPER_SCALE, layersOf, lengthOf, PAPER_FORMATS, paperFormat, paperSize, type Node, type Op, modifierKind, modifierKinds, modifierParams, type Modifier, roomAt, colorRef, colorRefOf, colorsOf, newId, resolveColor, cornerJoin, cornerJoinOps, moveCornerOps, wallEndsAt } from '@opencalque/core'
import { executeById } from '../commands'
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, Eye, EyeOff, Trash2, Check, Link2, Plus, Unlink } from 'lucide-react'
import { reorderSelection, transformSelection, addModifier } from '../actions'
import { applyCalibration } from '../floorplan'
import { language, msg, t } from '../i18n'
import { apply, editComponent, registry, toast, useStore, selectCorner } from '../store'
import { Field, IconButton, labelOf, Section } from '../ui'
import { formatLength, parseLength, parseNumber, unit } from '../units'

interface Option {
  value: string
  label: string
}

interface FieldSpec {
  /** Property path, one or two levels deep: "x", "a.x", "props.width", "style.stroke". */
  path: string
  label: string
  /** 'dash' is a checkbox standing for a dash pattern. */
  type: 'number' | 'string' | 'boolean' | 'color' | 'dash'
  /** Heading the field appears under. Defaults to "Geometry". */
  section?: string
  /** Shown when the property is unset. */
  fallback?: number | string | boolean
  /** Allowed values of a string property, shown as a dropdown. An empty value means unset. */
  options?: Option[]
  /** The number is a length in mm, edited in the user's unit. */
  length?: boolean
  /** The property may be cleared by emptying the field. */
  optional?: boolean
  /** For a color: what an unset value means, e.g. "from layer". */
  unset?: string
}

const GEOMETRY = msg('Geometry')
const DASH = [6, 4]

const num = (path: string, label: string, fallback?: number, section?: string): FieldSpec => ({ path, label, type: 'number', fallback, section })
/** A number that is a distance: shown and typed in the user's unit. */
const len = (path: string, label: string, fallback?: number, section?: string): FieldSpec => ({ ...num(path, label, fallback, section), length: true })
const options = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }))

const FONTS = options(['', msg('Sans-serif')], ['"Arial Narrow", sans-serif', msg('Condensed')], ['serif', msg('Serif')], ['monospace', msg('Monospace')])
const MARKERS = options(['tick', msg('Tick')], ['arrow', msg('Arrow')], ['open-arrow', msg('Open arrow')], ['dot', msg('Dot')], ['none', msg('None')])

const AB = [len('a.x', msg('X1')), len('a.y', msg('Y1')), len('b.x', msg('X2')), len('b.y', msg('Y2'))]
const PLACEMENT: FieldSpec[] = [len('x', msg('X')), len('y', msg('Y')), num('rotation', msg('Rotation'), 0), { path: 'flipX', label: msg('Mirror'), type: 'boolean', fallback: false }]

const stroke = (section: string): FieldSpec[] => [
  { path: 'style.stroke', label: msg('Color'), type: 'color', section, fallback: '#1f1f1f', unset: msg('from layer') },
  num('style.strokeWidth', msg('Weight'), 1, section),
  { path: 'style.dash', label: msg('Dashed'), type: 'dash', section },
]
const STYLE: FieldSpec[] = [...stroke(msg('Style')), { path: 'style.fill', label: msg('Fill'), type: 'color', section: msg('Style'), fallback: '#ffffff', unset: msg('default') }]

const DIMENSION: FieldSpec[] = [
  ...AB,
  len('offset', msg('Offset')),
  ...stroke(msg('Dimension line')),
  { path: 'startMarker', label: msg('Start'), type: 'string', section: msg('Ends'), fallback: 'tick', options: MARKERS },
  { path: 'endMarker', label: msg('End'), type: 'string', section: msg('Ends'), fallback: 'tick', options: MARKERS },
  len('markerSize', msg('Size'), 100, msg('Ends')),
  { path: 'extension.stroke', label: msg('Color'), type: 'color', section: msg('Extension lines'), fallback: '#1f1f1f', unset: msg('from line') },
  { ...num('extension.strokeWidth', msg('Weight'), undefined, msg('Extension lines')), optional: true },
  { path: 'extension.dash', label: msg('Dashed'), type: 'dash', section: msg('Extension lines') },
  len('extensionGap', msg('Gap'), 0, msg('Extension lines')),
  { path: 'text', label: msg('Override'), type: 'string', section: msg('Text'), optional: true },
  { path: 'font', label: msg('Font'), type: 'string', section: msg('Text'), options: FONTS },
  len('size', msg('Size'), 150, msg('Text')),
  { path: 'textColor', label: msg('Color'), type: 'color', section: msg('Text'), fallback: '#1f1f1f', unset: msg('from line') },
  { path: 'textPosition', label: msg('Position'), type: 'string', section: msg('Text'), fallback: 'above', options: options(['above', msg('Above line')], ['center', msg('On line')], ['below', msg('Below line')]) },
  { path: 'textRotation', label: msg('Rotation'), type: 'string', section: msg('Text'), fallback: 'aligned', options: options(['aligned', msg('Along line')], ['horizontal', msg('Horizontal')]) },
  { path: 'unit', label: msg('Unit'), type: 'string', section: msg('Text'), fallback: 'mm', options: options(['mm', 'mm'], ['cm', 'cm'], ['m', 'm'], ['in', 'in'], ['ft', 'ft']) },
  { ...num('decimals', msg('Decimals'), undefined, msg('Text')), optional: true },
  { path: 'showUnit', label: msg('Show unit'), type: 'boolean', section: msg('Text'), fallback: false },
]

/** The symbols an annotation's leader can end in. A bullet is the dot. */
const TIPS = options(['arrow', msg('Arrow')], ['open-arrow', msg('Open arrow')], ['dot', msg('Dot')], ['tick', msg('Tick')], ['none', msg('None')])

const ANNOTATION: FieldSpec[] = [
  { path: 'text', label: msg('Text'), type: 'string' },
  ...AB,
  { path: 'startMarker', label: msg('At the tip'), type: 'string', section: msg('Ends'), fallback: 'arrow', options: TIPS },
  { path: 'endMarker', label: msg('At the text'), type: 'string', section: msg('Ends'), fallback: 'none', options: TIPS },
  { ...len('markerSize', msg('Size'), undefined, msg('Ends')), optional: true },
  num('bend', msg('Curve'), 0.2, msg('Line')),
  ...stroke(msg('Line')),
  len('size', msg('Size'), 200, msg('Text')),
  { path: 'font', label: msg('Font'), type: 'string', section: msg('Text'), options: FONTS },
]

const FIELDS: Partial<Record<Node['type'], FieldSpec[]>> = {
  line: [...AB, ...STYLE],
  wall: [...AB, len('thickness', msg('Thickness')), ...STYLE],
  dimension: DIMENSION,
  annotation: ANNOTATION,
  rect: [len('x', msg('X')), len('y', msg('Y')), len('width', msg('W')), len('height', msg('H')), num('rotation', msg('Rotation'), 0), ...STYLE],
  paper: [len('x', msg('X')), len('y', msg('Y')), len('width', msg('W')), len('height', msg('H'))],
  room: [
    len('x', msg('X')),
    len('y', msg('Y')),
    len('size', msg('Text size'), 250),
    { path: 'showArea', label: msg('Show area'), type: 'boolean', fallback: true },
    { path: 'style.fill', label: msg('Floor'), type: 'color', section: msg('Style'), fallback: '#dfe6f0', unset: msg('default') },
    { path: 'style.stroke', label: msg('Text'), type: 'color', section: msg('Style'), fallback: '#1f1f1f', unset: msg('from layer') },
  ],
  divider: AB,
  ellipse: [len('cx', msg('X')), len('cy', msg('Y')), len('rx', msg('Radius X')), len('ry', msg('Radius Y')), ...STYLE],
  text: [
    { path: 'text', label: msg('Text'), type: 'string' },
    len('x', msg('X')),
    len('y', msg('Y')),
    len('size', msg('Size')),
    num('rotation', msg('Rotation'), 0),
    { path: 'font', label: msg('Font'), type: 'string', options: FONTS },
    { path: 'style.stroke', label: msg('Color'), type: 'color', section: msg('Style'), fallback: '#1f1f1f', unset: msg('from layer') },
  ],
  polyline: [{ path: 'closed', label: msg('Closed'), type: 'boolean', fallback: false }, ...STYLE],
  image: [len('x', msg('X')), len('y', msg('Y')), len('width', msg('W')), len('height', msg('H')), num('rotation', msg('Rotation'), 0), num('opacity', msg('Opacity'), 1)],
  instance: [...PLACEMENT, ...STYLE],
  parametric: PLACEMENT,
}

function fieldsOf(node: Node): FieldSpec[] {
  const fields = FIELDS[node.type] ?? []
  if (node.type !== 'parametric') return fields
  const params = registry.parametric.get(node.kind)?.params ?? []
  const own = params.map((p): FieldSpec => ({
    path: `props.${p.key}`,
    label: p.label,
    type: p.type,
    length: p.unit === 'length',
    fallback: p.default,
    options: p.options?.map((value) => ({ value, label: value })),
  }))
  return [...fields, ...own, ...STYLE]
}

function read(node: Node, path: string): unknown {
  return path.split('.').reduce<any>((value, key) => value?.[key], node)
}

/**
 * The patch that sets `path` to `value`, replacing the top-level property it lives in.
 * An undefined value unsets the property, and removes its parent object once that is empty.
 */
function patchFor(node: Node, path: string, value: unknown): Record<string, unknown> {
  const [head, key] = path.split('.')
  if (!key) return { [head]: value ?? null }
  const next: Record<string, unknown> = { ...(node as any)[head], [key]: value }
  if (value === undefined) delete next[key]
  return { [head]: value === undefined && Object.keys(next).length === 0 ? null : next }
}

type Update = (patch: (node: Node) => Record<string, unknown>) => void

/** Properties that are sizes, which dragging must not take below zero. */
const SIZES = /(^|\.)(width|height|thickness|rx|ry|size|markerSize|extensionGap|strokeWidth|opacity|decimals)$/

/**
 * A colour property: what it is now, and a list to change it from. It can hold a colour of its
 * own, or be linked to one of the drawing's shared colours, in which case it shows that colour's
 * name with a link and follows it whenever it changes.
 */
function ColorChoice({ stored, fallback, unset, commit }: { stored: string | undefined; fallback: string; unset?: string; commit: (value: unknown) => void }) {
  const doc = useStore((s) => s.doc)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as HTMLElement)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  const linked = colorRefOf(stored)
  const shared = linked === null ? undefined : doc.colors?.[linked]
  // What is painted: the shared colour's value, the property's own colour, or what it falls back on.
  const shown = resolveColor(doc, stored) ?? fallback
  const colors = colorsOf(doc)

  /** Makes a shared colour out of the one shown and links this property to it. */
  const share = () => {
    const id = newId('color')
    if (apply([{ op: 'add_color', color: { id, name: t('Colour {n}', { n: colors.length + 1 }), value: shown } }])) commit(colorRef(id))
    setOpen(false)
  }

  return (
    <span className="color-choice" ref={box}>
      <button type="button" className={`color-now${linked ? ' linked' : ''}`} title={linked ? t('Linked to a shared colour: it changes when that colour does') : t('Choose a colour')} onClick={() => setOpen(!open)}>
        <i style={{ background: shown }} />
        {linked ? (
          <>
            <Link2 size={12} />
            <span>{shared?.name ?? t('Missing colour')}</span>
          </>
        ) : stored === undefined ? (
          <em className="faint">{unset && t(unset)}</em>
        ) : (
          <span>{shown}</span>
        )}
      </button>
      {open && (
        <div className="color-menu">
          <h4>{t('Shared colours')}</h4>
          {colors.length === 0 && <p className="hint">{t('None yet. A shared colour is used by reference: change it once and everything linked to it changes.')}</p>}
          {colors.map((color) => (
            <button key={color.id} type="button" className={`color-option${color.id === linked ? ' active' : ''}`} title={t('Link to this shared colour')} onClick={() => (commit(colorRef(color.id)), setOpen(false))}>
              <i style={{ background: color.value }} />
              <span>{color.name}</span>
              {color.id === linked && <Check size={12} />}
            </button>
          ))}
          <button type="button" className="color-option" onClick={share}>
            <Plus size={12} />
            <span>{t('New shared colour from this one')}</span>
          </button>
          {shared && (
            <label className="color-option" title={t('Changes every object linked to it')}>
              <input type="color" className="swatch" value={shared.value} onChange={(e) => apply([{ op: 'update_color', id: shared.id, patch: { value: e.target.value } }])} />
              <span>{t('Change “{name}” everywhere', { name: shared.name })}</span>
            </label>
          )}
          <h4>{t('This object only')}</h4>
          <label className="color-option">
            <input type="color" className="swatch" value={shown} onChange={(e) => commit(e.target.value)} />
            <span>{linked ? t('Unlink and pick a colour') : t('Pick a colour')}</span>
          </label>
          {linked && (
            <button type="button" className="color-option" onClick={() => (commit(shown), setOpen(false))}>
              <Unlink size={12} />
              <span>{t('Unlink, keeping the colour')}</span>
            </button>
          )}
          {stored !== undefined && (
            <button type="button" className="color-option" onClick={() => (commit(undefined), setOpen(false))}>
              <span>{t('Reset')}{unset ? ` (${t(unset)})` : ''}</span>
            </button>
          )}
        </div>
      )}
    </span>
  )
}

function FieldRow({ node, field, update }: { node: Node; field: FieldSpec; update: Update }) {
  const stored = read(node, field.path)
  const value = stored ?? field.fallback
  const commit = (next: unknown) => update((n) => patchFor(n, field.path, next))
  if (field.type === 'number' || (field.type === 'string' && !field.options)) {
    return (
      <Field
        label={t(field.label)}
        numeric={field.type === 'number'}
        length={field.length}
        optional={field.optional}
        step={field.path === 'opacity' || field.path === 'bend' ? 0.01 : field.path.endsWith('strokeWidth') ? 0.1 : undefined}
        min={SIZES.test(field.path) || (field.length && field.path.startsWith('props.')) ? 0 : undefined}
        value={(value as string | number | undefined) ?? ''}
        onCommit={commit}
      />
    )
  }
  return (
    <label className="field">
      <span>{t(field.label)}</span>
      {field.type === 'boolean' && <input type="checkbox" checked={value === true} onChange={(e) => commit(e.target.checked)} />}
      {field.type === 'dash' && <input type="checkbox" checked={Array.isArray(stored)} onChange={(e) => commit(e.target.checked ? DASH : undefined)} />}
      {field.type === 'string' && (
        <select value={(value as string | undefined) ?? ''} onChange={(e) => commit(e.target.value || undefined)}>
          {field.options!.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
      )}
      {field.type === 'color' && <ColorChoice key={node.id} stored={stored as string | undefined} fallback={value as string} unset={field.unset} commit={commit} />}
    </label>
  )
}

/** Fields grouped under their section headings, in the order the sections first appear. */
function Sections({ node, fields, update }: { node: Node; fields: FieldSpec[]; update: Update }) {
  const titles = [...new Set(fields.map((f) => f.section ?? GEOMETRY))]
  return (
    <>
      {titles.map((title) => (
        <Section key={title} title={t(title)}>
          {fields
            .filter((f) => (f.section ?? GEOMETRY) === title)
            .map((field) => (
              <FieldRow key={field.path} node={node} field={field} update={update} />
            ))}
          {title === GEOMETRY && 'a' in node && (
            <label className="field">
              <span>{t('Length')}</span>
              <output>{formatLength(lengthOf(node))}</output>
            </label>
          )}
        </Section>
      ))}
    </>
  )
}

/** Texts of the built-in modifier kinds, listed here so that they get translated like the rest. */
export const MODIFIER_TEXTS = [
  msg('Crop'),
  msg('Shows only the part inside a rectangle.'),
  msg('Hatch'),
  msg('Covers closed shapes with a pattern: lines, floor boards or tiles.'),
  msg('Pattern'),
  msg('Spacing'),
  msg('Lines'),
  msg('Planks'),
  msg('Tiles'),
]

/**
 * The modifiers of the selected object: changes to how it is drawn that leave the object itself
 * alone. They apply from the top of the list down, each to the result of the one above.
 */
function ModifierStack({ node }: { node: Node }) {
  // Read so the kinds on offer follow extensions being installed or removed.
  useStore((s) => s.extensionsVersion)
  const list = node.modifiers ?? []
  const set = (next: Modifier[]) => apply([{ op: 'update_node', id: node.id, patch: { modifiers: next.length > 0 ? next : null } }])
  const change = (index: number, patch: Partial<Modifier>) => set(list.map((m, i) => (i === index ? { ...m, ...patch } : m)))
  const swap = (a: number, b: number) => set(list.map((m, i) => (i === a ? list[b] : i === b ? list[a] : m)))
  return (
    <Section
      title={t('Modifiers')}
      action={
        <select className="section-add" aria-label={t('Add a modifier')} value="" onChange={(e) => e.target.value && addModifier(e.target.value)}>
          <option value="">{t('Add…')}</option>
          {modifierKinds(registry).map((kind) => (
            <option key={kind.type} value={kind.type} title={kind.description && t(kind.description)}>
              {t(kind.label)}
            </option>
          ))}
        </select>
      }
    >
      {list.length === 0 && <p className="hint">{t('A modifier changes how an object is drawn without changing the object: a crop shows only part of it. Add one from the list above.')}</p>}
      {list.map((modifier, index) => {
        const kind = modifierKind(registry, modifier.type)
        const params = kind ? modifierParams(kind, modifier.params) : {}
        const frame = modifier.frame ?? { x: 0, y: 0 }
        const on = modifier.enabled !== false
        return (
          <div key={index} className={`modifier${on ? '' : ' off'}`}>
            <div className="field">
              <strong title={kind?.description && t(kind.description)}>{kind ? t(kind.label) : modifier.type}</strong>
              <IconButton title={on ? t('Switch off') : t('Switch on')} onClick={() => change(index, { enabled: !on })}>
                {on ? <Eye size={13} /> : <EyeOff size={13} />}
              </IconButton>
              <IconButton title={t('Move up')} onClick={() => swap(index, index - 1)} disabled={index === 0}>
                <ArrowUp size={13} />
              </IconButton>
              <IconButton title={t('Move down')} onClick={() => swap(index, index + 1)} disabled={index === list.length - 1}>
                <ArrowDown size={13} />
              </IconButton>
              <IconButton title={t('Remove')} onClick={() => set(list.filter((_, i) => i !== index))}>
                <Trash2 size={13} />
              </IconButton>
            </div>
            {!kind && <p className="hint">{t('This kind of modifier is not installed, so it is skipped. It stays in the drawing.')}</p>}
            {kind && (
              <>
                <Field label={t('X')} numeric length value={frame.x} onCommit={(x) => change(index, { frame: { ...frame, x } })} />
                <Field label={t('Y')} numeric length value={frame.y} onCommit={(y) => change(index, { frame: { ...frame, y } })} />
                {kind.params.map((p) =>
                  p.type === 'number' ? (
                    <Field
                      key={p.key}
                      label={t(p.label)}
                      numeric
                      length={p.unit === 'length'}
                      min={p.unit === 'length' ? 1 : undefined}
                      value={params[p.key]}
                      onCommit={(value) => change(index, { params: { ...modifier.params, [p.key]: value } })}
                    />
                  ) : p.options ? (
                    <label key={p.key} className="field">
                      <span>{t(p.label)}</span>
                      <select value={params[p.key]} onChange={(e) => change(index, { params: { ...modifier.params, [p.key]: e.target.value } })}>
                        {p.options.map((option) => (
                          <option key={option} value={option}>
                            {t(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : p.type === 'boolean' ? (
                    <label key={p.key} className="field">
                      <span>{t(p.label)}</span>
                      <input type="checkbox" checked={params[p.key]} onChange={(e) => change(index, { params: { ...modifier.params, [p.key]: e.target.checked } })} />
                    </label>
                  ) : null,
                )}
              </>
            )}
          </div>
        )
      })}
      {list.length > 1 && <p className="hint">{t('Applied from the top down: each works on the result of the one above it.')}</p>}
    </Section>
  )
}

/** A field that does something with the number typed into it, then empties: "turn by 30", "scale to 150 %". */
function ActionField({ label, placeholder, run }: { label: string; placeholder: string; run: (value: number) => void }) {
  const [text, setText] = useState('')
  const go = () => {
    const value = parseNumber(text)
    setText('')
    if (Number.isFinite(value)) run(value)
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={go} onKeyDown={(e) => e.key === 'Enter' && go()} />
    </label>
  )
}

/** Turning, mirroring and resizing whatever is selected, as one thing. */
function TransformSection() {
  return (
    <Section title={t('Transform')}>
      <div className="field">
        <span>{t('Turn, flip')}</span>
        <IconButton title={t('Rotate 90° clockwise')} onClick={() => transformSelection({ rotation: 90 })}>
          <RotateCw size={14} />
        </IconButton>
        <IconButton title={t('Rotate 90° counter-clockwise')} onClick={() => transformSelection({ rotation: -90 })}>
          <RotateCcw size={14} />
        </IconButton>
        <IconButton title={t('Flip left to right')} onClick={() => transformSelection({ mirror: 'horizontal' })}>
          <FlipHorizontal2 size={14} />
        </IconButton>
        <IconButton title={t('Flip top to bottom')} onClick={() => transformSelection({ mirror: 'vertical' })}>
          <FlipVertical2 size={14} />
        </IconButton>
      </div>
      <ActionField label={t('Rotate by')} placeholder={t('degrees, then Enter')} run={(degrees) => transformSelection({ rotation: degrees })} />
      <ActionField label={t('Scale to')} placeholder={t('percent, then Enter')} run={(percent) => transformSelection({ scale: percent / 100 })} />
      <p className="hint">{t('On the drawing, drag a corner of the box around the selection to scale it and the round handle to turn it. The arrow keys move it by one grid step.')}</p>
    </Section>
  )
}

/** What a room measures, read from the walls around it as they are now. */
function RoomFacts({ node }: { node: Extract<Node, { type: 'room' }> }) {
  const doc = useStore((s) => s.doc)
  const region = roomAt(doc, node.parent, node)
  if (!region) return <p className="hint">{t('The walls around this room do not close, so it has no floor to show. Close them, or drag the name into a closed space.')}</p>
  const area = new Intl.NumberFormat(language(), { maximumFractionDigits: 2 }).format(region.area / 1e6)
  return (
    <>
      <p className="hint">{t('Floor area: {area} m², measured inside the walls.', { area })}</p>
      <p className="hint">{t('The room follows its walls. Drag its name to move the label; add a Hatch modifier below for a floor pattern.')}</p>
    </>
  )
}

/** The sheet a paper stands for: a standard format or a custom size, which way up, and at what drawing scale. */
function PaperSheet({ node, update }: { node: Extract<Node, { type: 'paper' }>; update: Update }) {
  const scale = node.scale ?? DEFAULT_PAPER_SCALE
  const format = paperFormat(node)
  const landscape = node.width > node.height
  const resize = (name: string, lying: boolean, at: number) => {
    const size = paperSize(name, lying, at)
    update(() => (size ? { ...size, scale: at } : { scale: at }))
  }
  return (
    <Section title={t('Sheet')}>
      <label className="field">
        <span>{t('Format')}</span>
        <select value={format?.name ?? ''} onChange={(e) => resize(e.target.value, landscape, scale)}>
          {!format && <option value="">{t('Custom')}</option>}
          {PAPER_FORMATS.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('Direction')}</span>
        <select value={landscape ? 'landscape' : 'portrait'} onChange={(e) => update(() => (e.target.value === 'landscape') === landscape ? {} : { width: node.height, height: node.width })}>
          <option value="portrait">{t('Upright')}</option>
          <option value="landscape">{t('Lying')}</option>
        </select>
      </label>
      {/* Changing the scale of a standard sheet keeps it that sheet, so its size in the drawing changes. */}
      <Field label={t('Scale 1:')} numeric min={1} value={scale} onCommit={(v) => v > 0 && resize(format?.name ?? '', landscape, v)} />
      <p className="hint">{t('Moving, copying or duplicating a paper takes along everything that lies on it. Deleting it leaves the drawing in place.')}</p>
    </Section>
  )
}

function Selection({ nodes }: { nodes: Node[] }) {
  const doc = useStore((s) => s.doc)
  const update: Update = (patch) => apply(nodes.map((node): Op => ({ op: 'update_node', id: node.id, patch: patch(node) })))
  const node = nodes[0]
  const single = nodes.length === 1
  return (
    <>
      <Section title={single ? labelOf(doc, node) : t('{n} objects', { n: nodes.length })}>
        {single && <Field label={t('Name')} value={node.name ?? ''} onCommit={(name) => update(() => ({ name: name || null }))} />}
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
        <div className="field">
          <span>{t('Order')}</span>
          <IconButton title={t('Bring to front')} onClick={() => reorderSelection('front')}>
            <ArrowUpToLine size={14} />
          </IconButton>
          <IconButton title={t('Bring forward')} onClick={() => reorderSelection('forward')}>
            <ArrowUp size={14} />
          </IconButton>
          <IconButton title={t('Send backward')} onClick={() => reorderSelection('backward')}>
            <ArrowDown size={14} />
          </IconButton>
          <IconButton title={t('Send to back')} onClick={() => reorderSelection('back')}>
            <ArrowDownToLine size={14} />
          </IconButton>
        </div>
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
        {single && node.type === 'instance' && (
          <button className="text-button" onClick={() => editComponent(node.component)}>
            {t('Edit component')}
          </button>
        )}
      </Section>
      <Sections node={node} fields={single ? fieldsOf(node) : STYLE} update={update} />
      {single && <ModifierStack node={node} />}
      <TransformSection />
    </>
  )
}

/** Settings the dimension tool gives to the dimensions it draws next. */
function DimensionTool() {
  const template = useStore((s) => s.dimensionTemplate)
  const zero = { x: 0, y: 0 }
  const node = { id: '', parent: null, order: '', a: zero, b: zero, offset: 0, ...template, type: 'dimension' } as Node
  const update: Update = (patch) => {
    const next = { ...template }
    for (const [key, value] of Object.entries(patch(node))) {
      if (value === null) delete next[key]
      else next[key] = value
    }
    useStore.setState({ dimensionTemplate: next })
  }
  return (
    <>
      <Section title={t('Dimension tool')}>
        <p className="hint">{t('Click two points, then click again to set how far the dimension line stands off. These settings apply to the dimensions you draw next.')}</p>
      </Section>
      <Sections node={node} fields={DIMENSION.filter((f) => f.section)} update={update} />
    </>
  )
}

/** The look of the annotations drawn next: their ends, how much the leader curves, the text. */
function AnnotationTool() {
  const template = useStore((s) => s.annotationTemplate)
  const zero = { x: 0, y: 0 }
  const node = { id: '', parent: null, order: '', a: zero, b: zero, text: '', ...template, type: 'annotation' } as Node
  const update: Update = (patch) => {
    const next = { ...template }
    for (const [key, value] of Object.entries(patch(node))) {
      if (value === null) delete next[key]
      else next[key] = value
    }
    useStore.setState({ annotationTemplate: next })
  }
  return (
    <>
      <Section title={t('Annotation tool')}>
        <p className="hint">{t('Click what the note is about, click where the note goes, then type it. These settings apply to the annotations you draw next.')}</p>
        <p className="hint">{t('Afterwards, drag the middle of the line to bend it the other way or straighten it.')}</p>
      </Section>
      <Sections node={node} fields={ANNOTATION.filter((f) => f.section)} update={update} />
    </>
  )
}

/** The kinds of joint a corner of two walls can have. */
const JOINS = options(['miter', msg('Mitred (sharp corner)')], ['round', msg('Rounded')], ['bevel', msg('Cut off')], ['butt', msg('One wall runs through')])

/**
 * A wall corner: the point where wall ends meet. It is not an object of the drawing, so what is
 * shown and changed here is written to the walls that meet there.
 */
function CornerPanel({ at }: { at: { x: number; y: number } }) {
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
        <Field label={t('X')} numeric length value={at.x} onCommit={(x) => move({ x, y: at.y })} />
        <Field label={t('Y')} numeric length value={at.y} onCommit={(y) => move({ x: at.x, y })} />
      </Section>
      {ends.length === 2 && (
        <Section title={t('Joint')}>
          <label className="field">
            <span>{t('Type')}</span>
            <select value={join} onChange={(e) => apply(cornerJoinOps(ends, e.target.value as typeof join, passing))}>
              {JOINS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </label>
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
  const submit = () => {
    const real = parseLength(text)
    if (real === null) return toast(t('Enter the distance as a number, for example 3500, 350 cm or 3.5 m.'))
    applyCalibration(real)
    setText('')
  }
  return (
    <Section title={t('Set the scale')}>
      <p className="hint">
        {calibration
          ? t('Type the real distance between the two points you picked.')
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
            <span>{t('Distance')}</span>
            <input ref={field} placeholder={t('e.g. 3.5 m')} value={text} onChange={(e) => setText(e.target.value)} />
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
        ) : tool === 'paper' ? (
          <Section title={t('Paper tool')}>
            <p className="hint">{t('A paper is a sheet laid on the drawing, like a frame: it shows what goes on one page, and carries what is drawn on it when it is moved.')}</p>
            <p className="hint">{t('Click one corner, then pull. The standard formats appear at the scale set in the bar above the tools; come close to one to take it, or click anywhere for a size of your own.')}</p>
          </Section>
        ) : tool === 'wall' ? (
          <Section title={t('Wall tool')}>
            <Field label={t('Thickness')} numeric length min={10} value={wallThickness} onCommit={(v) => v > 0 && useStore.setState({ wallThickness: v })} />
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
              {t('Scroll to zoom, drag with the middle button or hold Space to pan. Shift constrains angles, Alt turns snapping off, Esc finishes.')}
            </p>
          </Section>
        )}
    </div>
  )
}
