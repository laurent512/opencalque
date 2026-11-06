import { useState } from 'react'
import { DEFAULT_INK, resolveColor } from '@opencalque/core'
import { drawing } from './canvas/drawing'
import { ColorChoice } from './ColorChoice'
import { FillChoice } from './FillChoice'
import { msg, t } from './i18n'
import { useStore } from './store'
import { type Tool } from './tools'
import { WallToolMaterial } from './panels/properties/walls'
import { JustifyPicker, scrub } from './ui'
import { formatNumber, parseLength, parseNumber, unitSuffix } from './units'

/** Where the clicked points can lie on a wall, as it is drawn: they are its corners, and the line it keeps. */
const JUSTIFY = {
  left: msg('Points along the left face of the wall'),
  center: msg('Points along the middle of the wall'),
  right: msg('Points along the right face of the wall'),
}

type Kind = 'length' | 'angle'
type Size = { which: 'a' | 'b'; label: string; kind: Kind }
const box: Size[] = [
  { which: 'a', label: msg('Width'), kind: 'length' },
  { which: 'b', label: msg('Height'), kind: 'length' },
]
const run: Size[] = [
  { which: 'a', label: msg('Length'), kind: 'length' },
  { which: 'b', label: msg('Angle'), kind: 'angle' },
]
/** A curve and an arc are not going the way their points lie: of those, only how far apart they are can be typed. */
const span: Size[] = [run[0]]
/** What can be typed once an arc has its two ends. */
const bend: Size[] = [{ which: 'a', label: msg('Radius'), kind: 'length' }]
/** The sizes each tool lets you type: lengths, an angle, or for resizing a percentage. */
const SIZES: Partial<Record<Tool, Size[]>> = {
  rect: box,
  ellipse: box,
  paper: box,
  line: run,
  curve: span,
  offset: [{ which: 'a', label: msg('Distance'), kind: 'length' }],
  arc: span,
  wall: run,
  divider: run,
  gridline: run,
  rotate: [{ which: 'b', label: msg('Angle'), kind: 'angle' }],
}
/**
 * The tools whose shapes take the colour of lines chosen in the bar, and of those the ones that
 * make closed shapes, which take its fill too (the line tool closes a polygon). Line weights and
 * kinds of line are set afterwards, in the properties.
 */
const INKED: Tool[] = ['rect', 'ellipse', 'line', 'curve', 'arc', 'wall', 'gridline']
const FILLED: Tool[] = ['rect', 'ellipse', 'line', 'curve']

/**
 * One size of the shape being drawn. It follows the pointer until a value is typed into it; a
 * typed value then holds, and Enter finishes the shape with it. Lengths are typed in the unit set
 * in Preferences (or with a unit written after them) and kept in millimetres.
 */
function SizeField({ which, label, kind }: Size) {
  const angle = kind !== 'length'
  const locked = useStore((s) => s.drawLocks[which])
  const live = useStore((s) => s.drawLive?.[which])
  /** What is being typed, or null while the field just reflects the drawing. */
  const [typed, setTyped] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const value = locked ?? live
  const setLock = (next: number | undefined) => {
    const { [which]: _, ...rest } = useStore.getState().drawLocks
    useStore.setState({ drawLocks: next === undefined ? rest : { ...rest, [which]: next } })
    drawing.refresh?.()
  }
  const shown = value === undefined ? '' : angle ? String(Math.round(value * 10) / 10) : formatNumber(value)
  return (
    <label className={`quick-field quick-size${locked !== undefined ? ' locked' : ''}`} title={t('Type a value to fix it, then press Enter to draw. Esc lets it follow the pointer again.')}>
      <span>{label}</span>
      <input
        inputMode="decimal"
        // A focused field that still follows the pointer is left empty, with the moving value
        // behind it as a hint: whatever is typed then starts from nothing, never added to a
        // number that changed under the caret.
        value={typed ?? (focused && locked === undefined ? '' : shown)}
        placeholder={shown}
        onFocus={(e) => {
          setFocused(true)
          e.target.select()
        }}
        onChange={(e) => {
          setTyped(e.target.value)
          // A length must be positive; an angle can be anything.
          const n = angle ? parseNumber(e.target.value) : parseLength(e.target.value)
          setLock(n !== null && Number.isFinite(n) && (kind === 'angle' || n > 0) ? n : undefined)
        }}
        onBlur={() => {
          setFocused(false)
          setTyped(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            drawing.commit?.()
            setTyped(null)
            e.currentTarget.select()
          } else if (e.key === 'Escape') {
            setLock(undefined)
            setTyped(null)
            e.currentTarget.blur()
          }
        }}
      />
      <em>{kind === 'angle' ? '°' : unitSuffix()}</em>
    </label>
  )
}

/**
 * Floats above the toolbar while a drawing tool is in use: the sizes of the shape being drawn,
 * which can be typed instead of dragged, and the colour of the lines and the fill the next shapes get.
 */
export function QuickBar() {
  const tool = useStore((s) => s.tool)
  const color = useStore((s) => s.drawColor)
  const fill = useStore((s) => s.drawFill)
  const pattern = useStore((s) => s.drawPattern)
  // The colour of the layer drawn on, which lines take unless given another: shown as it is, not as black.
  const layerInk = useStore((s) => resolveColor(s.doc, s.doc.layers[s.activeLayer]?.color) ?? DEFAULT_INK)
  const wallThickness = useStore((s) => s.wallThickness)
  const wallJustify = useStore((s) => s.wallJustify)
  const paperScale = useStore((s) => s.paperScale)
  // The rotate tool takes an angle once its base line is set, at its second step.
  const started = useStore((s) => s.drawStep > (s.tool === 'rotate' ? 1 : 0))
  const bending = useStore((s) => s.tool === 'arc' && s.drawStep >= 2)
  const sizes = bending ? bend : SIZES[tool]
  if (!sizes) return null
  // A length or an angle means nothing before there is a point to measure it from. A
  // width and a height do: typed first, they make a box that one click places. So does the
  // distance of an offset, which a click then places a copy at.
  const measurable = sizes === box || started || tool === 'offset'
  const setThickness = (text: string) => {
    const mm = parseLength(text)
    if (mm !== null && mm > 0) useStore.setState({ wallThickness: mm })
  }
  return (
    <div className="quickbar">
      <div className="quick-group">
        {measurable && sizes.map((size) => <SizeField key={size.which} {...size} label={t(size.label)} />)}
        {tool === 'wall' && (
          <label className="quick-field locked">
            <span>{t('Thickness')}</span>
            <input
              inputMode="decimal"
              defaultValue={formatNumber(wallThickness)}
              key={wallThickness}
              title={t('Hold Alt and drag sideways to change the value')}
              {...scrub(() => wallThickness, (mm) => useStore.setState({ wallThickness: mm }), 10, 10)}
              onBlur={(e) => setThickness(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <em>{unitSuffix()}</em>
          </label>
        )}
        {tool === 'wall' && (
          <JustifyPicker
            value={wallJustify}
            names={{ left: t(JUSTIFY.left), center: t(JUSTIFY.center), right: t(JUSTIFY.right) }}
            label={t('Where the points you click lie on the wall')}
            onPick={(value) => useStore.setState({ wallJustify: value })}
          />
        )}
        {tool === 'paper' && (
          <label className="quick-field locked" title={t('The drawing scale of the sheet. It sets how much of the drawing a standard format covers.')}>
            <span>{t('Scale')}</span>
            <input
              inputMode="decimal"
              defaultValue={`1:${paperScale}`}
              key={paperScale}
              onBlur={(e) => {
                const scale = parseNumber(e.target.value.replace(/^\s*1\s*[:/]/, ''))
                if (scale > 0) useStore.setState({ paperScale: scale })
                else e.target.value = `1:${paperScale}`
                drawing.refresh?.()
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
        )}
      </div>
      <div className="quick-group" hidden={!INKED.includes(tool)}>
        {/* With no colour of their own, lines take the layer's: the swatch shows it, marked as the layer's. */}
        <ColorChoice
          compact
          caption={t('Line')}
          title={t('Colour of the lines of the next shapes')}
          stored={color ?? undefined}
          fallback={layerInk}
          layer={{ color: layerInk, several: false, byDefault: true }}
          commit={(next) => useStore.setState({ drawColor: (next as string | undefined) ?? null })}
        />
        {tool === 'wall' && (
          <span className="quick-field locked">
            <span>{t('Material')}</span>
            <WallToolMaterial />
          </span>
        )}
        {FILLED.includes(tool) && (
          <FillChoice
            compact
            caption={t('Fill')}
            title={t('Fill of the next closed shapes')}
            fill={fill ?? undefined}
            pattern={pattern ?? undefined}
            fallback="none"
            unset={msg('none')}
            layer={{ color: layerInk, several: false, byDefault: false }}
            commit={(change) => useStore.setState({ ...('fill' in change ? { drawFill: change.fill ?? null } : {}), ...('pattern' in change ? { drawPattern: change.pattern ?? null } : {}) })}
          />
        )}
      </div>
    </div>
  )
}
