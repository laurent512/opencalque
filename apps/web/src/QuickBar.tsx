import { useState } from 'react'
import { drawing } from './canvas/drawing'
import { ColorChoice } from './ColorChoice'
import { msg, t } from './i18n'
import { useStore, type Tool } from './store'
import { dashIndex, DASHES, penOf, PENS, pixelsOf } from './strokes'
import { DashPicker, scrub } from './ui'
import { formatNumber, parseLength, parseNumber, unit } from './units'

/** The two sizes each drawing tool lets you type, and whether the second is an angle rather than a length. */
const SIZES: Partial<Record<Tool, [first: string, second: string, angle: boolean]>> = {
  rect: [msg('Width'), msg('Height'), false],
  ellipse: [msg('Width'), msg('Height'), false],
  paper: [msg('Width'), msg('Height'), false],
  line: [msg('Length'), msg('Angle'), true],
  polyline: [msg('Length'), msg('Angle'), true],
  wall: [msg('Length'), msg('Angle'), true],
  divider: [msg('Length'), msg('Angle'), true],
}

/** Stroke colours offered for the next shapes; the first means "the layer's colour". */
const COLORS = [null, '#e5484d', '#9ca3af', '#0d99ff']

/**
 * One size of the shape being drawn. It follows the pointer until a value is typed into it; a
 * typed value then holds, and Enter finishes the shape with it. Lengths are typed in the unit set
 * in Preferences (or with a unit written after them) and kept in millimetres.
 */
function Size({ which, label, angle }: { which: 'a' | 'b'; label: string; angle: boolean }) {
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
          setLock(n !== null && Number.isFinite(n) && (angle || n > 0) ? n : undefined)
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
      <em>{angle ? '°' : unit()}</em>
    </label>
  )
}

/**
 * Floats above the toolbar while a drawing tool is in use: the sizes of the shape being drawn,
 * which can be typed instead of dragged, and the colour the next shapes get.
 */
export function QuickBar() {
  const tool = useStore((s) => s.tool)
  const color = useStore((s) => s.drawColor)
  const weight = useStore((s) => s.drawWeight)
  const dash = useStore((s) => s.drawDash)
  const wallThickness = useStore((s) => s.wallThickness)
  const paperScale = useStore((s) => s.paperScale)
  const started = useStore((s) => s.drawStep > 0)
  const sizes = SIZES[tool]
  if (!sizes) return null
  // A length and an angle mean nothing before there is a point to measure them from. A width and
  // a height do: typed first, they make a box that one click places.
  const measurable = !sizes[2] || started
  const setThickness = (text: string) => {
    const mm = parseLength(text)
    if (mm !== null && mm > 0) useStore.setState({ wallThickness: mm })
  }
  return (
    <div className="quickbar">
      <div className="quick-group">
        {measurable && <Size which="a" label={t(sizes[0])} angle={false} />}
        {measurable && <Size which="b" label={t(sizes[1])} angle={sizes[2]} />}
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
            <em>{unit()}</em>
          </label>
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
      <div className="quick-group" hidden={tool === 'paper'}>
        {COLORS.map((c) => (
          <button
            key={c ?? 'layer'}
            className={`quick-color${c === color ? ' active' : ''}`}
            title={c ? t('Colour of the next shapes') : t('Colour of the layer')}
            aria-label={c ? t('Colour of the next shapes') : t('Colour of the layer')}
            style={{ background: c ?? '#1f1f1f' }}
            onClick={() => useStore.setState({ drawColor: c })}
          />
        ))}
        {/* Beyond the ready-made ones: any colour, or one of the drawing's shared colours. */}
        <ColorChoice compact title={t('Another colour, or a shared one')} stored={color !== null && !COLORS.includes(color) ? color : undefined} fallback="#ffffff" commit={(next) => useStore.setState({ drawColor: (next as string | undefined) ?? null })} />
        <select className="quick-select" title={t('Line weight of the next shapes, as printed')} aria-label={t('Line weight of the next shapes, as printed')} value={weight === null ? '' : String(penOf(weight))} onChange={(e) => useStore.setState({ drawWeight: e.target.value === '' ? null : pixelsOf(Number(e.target.value)) })}>
          <option value="">{t('Weight')}</option>
          {(weight !== null && !PENS.includes(penOf(weight)) ? [...PENS, penOf(weight)].sort((p, q) => p - q) : PENS).map((mm) => (
            <option key={mm} value={mm}>
              {mm} mm
            </option>
          ))}
        </select>
        <DashPicker value={dash} label={t('Kind of line of the next shapes')} onPick={(pattern) => useStore.setState({ drawDash: pattern })} />
      </div>
    </div>
  )
}
