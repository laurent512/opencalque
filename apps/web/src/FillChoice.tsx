import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Layers, Link2 } from 'lucide-react'
import { HATCH_INK, HATCH_WEIGHT, LAYER_COLOR, PATTERN_DEFAULTS, PATTERN_FINEST, patternStrokes, resolveColor, type Pattern } from '@opencalque/core'
import { ColorChoice, ColorPanel, colorState, lastColor, swatch, type LayerOption } from './ColorChoice'
import { FLOATING, useFloating } from './floating'
import { msg, t } from './i18n'
import { useStore } from './store'
import { Field, OpacitySlider } from './ui'
import { WeightChoice } from './WeightChoice'

/** The patterns a fill can have, each with its name and a small picture of its strokes. */
const PATTERNS: [kind: string, name: string, picture: string][] = [
  ['Lines', msg('Lines'), 'M-2 16 12 2M6 20 22 4M16 22 30 8'],
  ['Cross', msg('Cross-hatch'), 'M-2 16 12 2M6 20 22 4M16 22 30 8M-2 4 12 18M6 0 22 16M16 -2 30 12'],
  ['Planks', msg('Planks'), 'M2 5h24M2 10h24M2 15h24M10 5v5M20 10v5M6 10v5M16 15v3M14 2v3'],
  ['Tiles', msg('Tiles'), 'M2 3h24M2 9h24M2 15h24M8 1v16M14 1v16M20 1v16'],
  ['Dots', msg('Dots (concrete)'), 'M4 5h1.4M11 5h1.4M18 5h1.4M25 5h1.4M7.5 9h1.4M14.5 9h1.4M21.5 9h1.4M4 13h1.4M11 13h1.4M18 13h1.4M25 13h1.4'],
  ['Zigzag', msg('Zigzag (insulation)'), 'M1 14 5 4 9 14 13 4 17 14 21 4 25 14 27 9'],
]

/** What a solid fill starts as when it had no colour and none was picked lately: a light grey that shows on paper. */
const SOLID_START = '#d9d9d9'

/** A pattern with one of its settings changed, or taken away when `value` is undefined. */
function withSetting<K extends keyof Pattern>(pattern: Pattern, key: K, value: Pattern[K] | undefined): Pattern {
  const next = { ...pattern }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

/**
 * The settings of a pattern, as rows: its kind from a row of pictures, the colour, opacity and
 * weight of its strokes, and how far apart and how turned they are. The Hatch page of the fill
 * window, and a material's pattern.
 */
export function HatchRows({ value, onChange, layer }: { value: Pattern; onChange: (next: Pattern) => void; layer?: LayerOption }) {
  const usual = PATTERN_DEFAULTS[value.kind] ?? { spacing: 100, angle: 0 }
  const finest = PATTERN_FINEST[value.kind] ?? 5
  return (
    <div className="pattern-rows">
      {/* Not a label: a label would hand every click to the first button in it. */}
      <div className="field">
        <span>{t('Pattern')}</span>
        <div className="end-picker pattern-picker" role="radiogroup" aria-label={t('Pattern')}>
          {PATTERNS.map(([kind, name, picture]) => (
            // Its own spacing and angle suit each pattern; choosing another starts from those again.
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={kind === value.kind}
              className={kind === value.kind ? 'active' : ''}
              title={t(name)}
              aria-label={t(name)}
              onClick={() => onChange(withSetting(withSetting({ ...value, kind }, 'spacing', undefined), 'angle', undefined))}
            >
              <svg width="28" height="18" viewBox="0 0 28 18" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
                <path d={picture} />
              </svg>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>{t('Color')}</span>
        <ColorChoice stored={value.stroke} fallback={HATCH_INK} unset={msg('default')} layer={layer && { ...layer, byDefault: false }} commit={(stroke) => onChange(withSetting(value, 'stroke', stroke as string | undefined))} />
      </div>
      <div className="field">
        <span>{t('Opacity')}</span>
        {/* Fully opaque is said by saying nothing. */}
        <OpacitySlider value={value.opacity ?? 1} onChange={(opacity) => onChange(withSetting(value, 'opacity', opacity >= 1 ? undefined : opacity))} />
      </div>
      <div className="field">
        <span>{t('Weight')}</span>
        <WeightChoice value={value.strokeWidth ?? HATCH_WEIGHT} label={t('Weight of the strokes, as printed')} onPick={(pixels) => onChange(withSetting(value, 'strokeWidth', pixels === null || pixels === HATCH_WEIGHT ? undefined : pixels))} />
      </div>
      {/* No finer than the pattern is drawn: what shows is what is drawn. */}
      <Field label={t('Spacing')} numeric length min={finest} value={Math.max(finest, value.spacing ?? usual.spacing)} onCommit={(spacing: number) => spacing > 0 && onChange({ ...value, spacing: Math.max(finest, spacing) })} />
      <Field label={t('Angle')} numeric suffix="°" value={value.angle ?? usual.angle} onCommit={(angle: number) => onChange({ ...value, angle })} />
    </div>
  )
}

/** The colour a pattern's strokes are painted in, as the drawing paints them. */
function inkOf(pattern: Pattern, layer: LayerOption | undefined): string {
  const doc = useStore.getState().doc
  return resolveColor(doc, pattern.stroke, layer?.color) ?? HATCH_INK
}

/**
 * A pattern as it lies over its fill, drawn with the strokes the drawing draws, on a stretch as
 * wide as sixteen of its usual spacings: a spacing made finer or coarser shows as such.
 */
function HatchPreview({ pattern, background, layer }: { pattern: Pattern; background: string; layer?: LayerOption }) {
  const usual = PATTERN_DEFAULTS[pattern.kind] ?? { spacing: 100, angle: 0 }
  const width = usual.spacing * 16
  const height = width * 0.3
  const strokes = patternStrokes(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    pattern,
  )
  return (
    // With no colour under it, the strokes are shown on paper: a checkerboard would be read as part of the pattern.
    <div className="hatch-preview" style={swatch(background === 'none' ? '#ffffff' : (resolveColor(useStore.getState().doc, background, layer?.color) ?? background))}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        {strokes.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={inkOf(pattern, layer)} strokeOpacity={pattern.opacity ?? 1} strokeWidth={Math.max(0.6, (pattern.strokeWidth ?? HATCH_WEIGHT) * 1.5)} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  )
}

/** A fill as a small square: its colour, with the strokes of its hatch over it, as the drawing paints them. */
export function FillSwatch({ fill, pattern, layer }: { fill: string; pattern?: Pattern; layer?: LayerOption }) {
  const doc = useStore((s) => s.doc)
  const hatch = pattern && pattern.kind !== 'None' ? pattern : undefined
  const picture = hatch && PATTERNS.find(([k]) => k === hatch.kind)?.[2]
  return (
    <i className="fill-swatch" style={swatch(fill === 'none' ? 'transparent' : (resolveColor(doc, fill, layer?.color) ?? fill))}>
      {picture && (
        <svg viewBox="2 0 24 18" preserveAspectRatio="xMidYMid slice" fill="none" stroke={inkOf(hatch!, layer)} strokeOpacity={hatch!.opacity ?? 1} strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <path d={picture} />
        </svg>
      )}
    </i>
  )
}

/** A change of fill: each key given is set, or taken away when given as undefined. */
export type FillChange = { fill?: string | undefined; pattern?: Pattern | undefined }

type Page = 'none' | 'solid' | 'hatch'

/** What the three kinds of fill are called on their tabs. */
const PAGES: [page: Page, name: string][] = [
  ['none', msg('None')],
  ['solid', msg('Solid colour')],
  ['hatch', msg('Hatch')],
]

/**
 * What covers the inside of a shape, and the window to change it in: no fill, a solid colour, or
 * a hatch (a pattern of strokes over a colour), each on a tab of its own. Choosing a tab changes
 * the fill at once, as the kind of fill it names. A fill is two properties of a style, `fill` and
 * `pattern`, and the window sets them together.
 */
export function FillChoice(props: {
  /** The fill's own colour and pattern; undefined where it has none of its own. */
  fill: string | undefined
  pattern: Pattern | undefined
  /** What it takes from elsewhere (a wall's type) where it has none of its own. */
  inherited?: { fill?: string; pattern?: Pattern }
  /** What is drawn when nothing says otherwise: a colour, or 'none' for no fill. */
  fallback: string
  /** What having no fill of its own is called ("default", "from its material"). */
  unset?: string
  /** No fill at all may not be chosen: a wall must hide the lines inside its joints. */
  filled?: boolean
  mixed?: boolean
  layer?: LayerOption
  /** The swatch alone, in the bar above the tools, with a word said beside it. */
  compact?: boolean
  caption?: string
  title?: string
  commit: (change: FillChange) => void
}) {
  const { fill, pattern, inherited, fallback, unset, filled, mixed, layer, compact, caption, title, commit } = props
  const doc = useStore((s) => s.doc)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)
  const { closing, style } = useFloating(open, close, box, menu)
  /** The pattern last shown, given back when Hatch is chosen again after another kind. */
  const lastPattern = useRef<Pattern | undefined>(undefined)

  const color = fill ?? inherited?.fill
  const shownFill = color ?? fallback
  const ownPattern = pattern ?? inherited?.pattern
  const hatch = !mixed && ownPattern && ownPattern.kind !== 'None' ? ownPattern : undefined
  if (hatch) lastPattern.current = hatch
  const kind: Page | undefined = mixed ? undefined : hatch ? 'hatch' : shownFill === 'none' ? 'none' : 'solid'
  const page = kind ?? 'solid'
  // Without a pattern of its own where its material has one, it says so with a pattern of kind None.
  const noPattern = inherited?.pattern && inherited.pattern.kind !== 'None' ? { kind: 'None' } : undefined
  // No fill is having none, where that is what having none means; otherwise it is said outright.
  const noFill = fallback === 'none' && inherited?.fill === undefined ? undefined : 'none'
  /** What the solid colour is, read as a colour: none at all reads as white, for the picker to start from. */
  const solid = shownFill === 'none' ? '#ffffff' : shownFill

  const choose = (next: Page) => {
    if (next === kind) return
    if (next === 'none') commit({ fill: noFill, pattern: noPattern })
    // A solid fill needs a colour: a hatch over nothing, or no fill, starts from the colour picked last.
    else if (next === 'solid') commit({ pattern: noPattern, ...(shownFill === 'none' || mixed ? { fill: lastColor() ?? SOLID_START } : {}) })
    else commit({ pattern: lastPattern.current ?? { kind: 'Lines' } })
  }

  const own = fill !== undefined || pattern !== undefined
  const { linked, shared, followsLayer } = colorState(doc, color, solid, layer)
  const patternName = hatch && t(PATTERNS.find(([k]) => k === hatch.kind)?.[1] ?? hatch.kind)
  const swatchOf = () => (mixed || kind === 'none' ? <i className="none" /> : <FillSwatch fill={shownFill} pattern={hatch} layer={layer} />)
  const said = mixed ? (
    <em className="faint">{t('Mixed')}</em>
  ) : kind === 'hatch' ? (
    own ? <span>{patternName}</span> : <em className="faint">{patternName}</em>
  ) : kind === 'none' ? (
    own ? <span>{t('None')}</span> : <em className="faint">{t('None')}</em>
  ) : color === LAYER_COLOR ? (
    <>
      <Layers size={12} />
      <span>{t('Layer')}</span>
    </>
  ) : linked ? (
    <>
      <Link2 size={12} />
      <span>{shared?.name ?? t('Missing colour')}</span>
    </>
  ) : fill === undefined ? (
    <em className="faint">{unset && t(unset)}</em>
  ) : (
    <span>{resolveColor(doc, fill) ?? fill}</span>
  )

  return (
    // A click in the chooser is about the fill, not about the row it may sit in.
    <span className={`color-choice fill-choice${compact ? ' compact' : ''}${caption ? ' captioned' : ''}`} ref={box} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`color-now fill-now${linked && kind === 'solid' ? ' linked' : ''}`}
        title={title ?? t('Choose a fill')}
        aria-label={title ?? t('Choose a fill')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (closing.current) return
          setOpen(!open)
        }}
      >
        {compact ? (
          <>
            <span className="swatch-box">
              {swatchOf()}
              {kind === 'solid' && (linked ? <Link2 size={9} /> : followsLayer && <Layers size={9} />)}
            </span>
            {caption && <span>{caption}</span>}
          </>
        ) : (
          <>
            {swatchOf()}
            {said}
          </>
        )}
      </button>
      {open &&
        // At the top of the page, as the colour window is: a bar moved into place would take it along.
        createPortal(
          <div className={`color-menu fill-menu ${FLOATING}`} ref={menu} style={style} role="dialog" aria-label={t('Fill')} onClick={(e) => e.stopPropagation()}>
            <div className="fill-tabs" role="tablist" aria-label={t('Kind of fill')}>
              {PAGES.filter(([which]) => which !== 'none' || !filled).map(([which, name]) => (
                <button key={which} type="button" role="tab" aria-selected={which === kind} className={which === kind ? 'active' : ''} onClick={() => choose(which)}>
                  {t(name)}
                </button>
              ))}
            </div>
            {page === 'none' && <p className="hint">{t('No fill: what lies under it shows through.')}</p>}
            {/* Where having no fill of its own is having no fill, the None tab above is the way back to it. */}
            {page === 'solid' && <ColorPanel stored={fill} fallback={solid} unset={unset} layer={layer} close={close} noReset={noFill === undefined} commit={(next) => commit({ fill: next as string | undefined })} />}
            {page === 'hatch' && hatch && (
              <>
                <HatchPreview pattern={hatch} background={shownFill} layer={layer} />
                <HatchRows value={hatch} layer={layer} onChange={(next) => commit({ pattern: next })} />
                <div className="field">
                  <span>{t('Background')}</span>
                  <ColorChoice
                    stored={fill === 'none' ? undefined : fill}
                    fallback={inherited?.fill ?? (fallback === 'none' ? '#ffffff' : fallback)}
                    unset={fill === 'none' || (fill === undefined && shownFill === 'none') ? msg('none') : unset}
                    layer={layer && { ...layer, byDefault: false }}
                    commit={(next) => commit({ fill: next as string | undefined })}
                  />
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </span>
  )
}
