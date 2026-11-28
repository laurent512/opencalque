import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AArrowDown, AArrowUp, Bold, Braces, Italic, RemoveFormatting, Strikethrough, TextAlignCenter, TextAlignEnd, TextAlignStart, Underline } from 'lucide-react'
import { charStyles, commonStyle, LAYER_COLOR, MAX_TEXT_SCALE, MIN_TEXT_SCALE, resolveColor, rootOf, TEXT_FIELDS, type NodeOf } from '@opencalque/core'
import { ColorPanel, swatch } from './ColorChoice'
import { useShortcutLabel } from './commands'
import { FLOATING, useFloating } from './floating'
import { t } from './i18n'
import { FIELD_NAMES, FONTS, SHEET_FIELDS } from './panels/properties/fields'
import { Select } from './Select'
import { useStore } from './store'
import { SIZE_STEP, useTextFormat, type TextToggle } from './textFormat'
import { formatNumber, parseLength, unitSuffix } from './units'

/** The class of the bar, by which the editor knows the focus going there does not end the typing. */
export const TEXT_FORMAT_BAR = 'text-format-bar'

/** A button of the bar: it acts without taking the focus from the words, so the selection stays. */
function BarButton({ title, command, on, onClick, children }: { title: string; command?: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  const key = useShortcutLabel(command ?? '')
  return (
    <button type="button" className={`icon-button${on ? ' active' : ''}`} title={key ? `${title} (${key})` : title} aria-label={title} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

/**
 * The size of the words selected, in the user's unit: typed, it makes them that size. It shows
 * nothing when they are of several sizes.
 */
function SizeField({ size, onSize }: { size: number | null; onSize: (mm: number) => void }) {
  const shown = size === null ? '' : formatNumber(size)
  const [typed, setTyped] = useState<string | null>(null)
  const commit = () => {
    if (typed === null) return
    const value = parseLength(typed)
    setTyped(null)
    if (value !== null && Number.isFinite(value) && value > 0 && typed !== shown) onSize(value)
  }
  return (
    <label className="quick-field text-format-size" title={t('Size of the selected words')}>
      <input
        value={typed ?? shown}
        placeholder={size === null ? t('Mixed') : undefined}
        aria-label={t('Size')}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            useTextFormat.getState().editor?.focus()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setTyped(null)
            useTextFormat.getState().editor?.focus()
          }
        }}
      />
      {unitSuffix() && <em>{unitSuffix()}</em>}
    </label>
  )
}

/** The font the canvas draws a text in when it names none: the system's. */
const SYSTEM_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/**
 * The colour of the words selected, and a window to change it, which gives the focus back to them
 * when it closes. With every word selected (as when the typing starts) or none written yet, it is
 * the colour of the text itself (`whole`): its own, a shared one, or its layer's, as the
 * Properties panel set it before; words given a colour of their own lose it then.
 */
function ColorButton({ color, own, fallback, whole }: { color: string; own: string | undefined; fallback: string; whole?: { stored: string | undefined; layer: string } }) {
  const [open, setOpen] = useState(false)
  const field = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    useTextFormat.getState().editor?.focus()
  }
  const { closing, style } = useFloating(open, close, field, menu)
  const editor = () => useTextFormat.getState().editor
  return (
    <>
      <button
        ref={field}
        type="button"
        className="icon-button text-format-color"
        title={whole ? t('Colour of the text') : t('Colour of the selected words')}
        aria-label={whole ? t('Colour of the text') : t('Colour of the selected words')}
        aria-expanded={open}
        onClick={() => !closing.current && setOpen(!open)}
      >
        <span className="text-format-letter">A</span>
        <i style={swatch(color)} />
      </button>
      {open &&
        createPortal(
          <div className={`color-menu ${FLOATING}`} ref={menu} style={style}>
            {whole ? (
              <ColorPanel
                stored={whole.stored}
                fallback={whole.layer}
                layer={{ color: whole.layer, several: false, byDefault: true }}
                commit={(value) => editor()?.colorAll(typeof value === 'string' && value !== LAYER_COLOR ? value : null)}
                close={close}
                plain
                noReset
              />
            ) : (
              <ColorPanel stored={own} fallback={fallback} commit={(value) => editor()?.format({ color: typeof value === 'string' ? value : null })} close={close} plain />
            )}
            {!whole && own !== undefined && (
              <button type="button" className="color-option color-reset" onClick={() => (editor()?.format({ color: null }), close())}>
                <span>{t('Colour of the text')}</span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

/**
 * The bar floating over a text being typed in place: its font and alignment, and for the words
 * selected (or those typed next, with none selected) their size, weight, slant, lines under and
 * through them, and colour. Everything it does goes through the editor (`textFormat.ts`); its
 * buttons never take the focus, so the words stay selected.
 */
export function TextFormatBar({ node, box }: { node: NodeOf<'text'>; box: RefObject<HTMLDivElement | null> }) {
  const { anchor, head, pending, editor } = useTextFormat()
  const doc = useStore((s) => s.doc)
  // Placed again when the view moves under it.
  useStore((s) => s.view)
  const bar = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)

  // Over the words, in the middle of them, or under them when there is no room above; inside the view.
  useLayoutEffect(() => {
    const words = box.current
    const own = bar.current
    const stage = words?.offsetParent
    if (!words || !own || !stage) return
    const at = words.getBoundingClientRect()
    const within = stage.getBoundingClientRect()
    const size = own.getBoundingClientRect()
    const margin = 8
    const left = Math.min(Math.max(margin, at.left + at.width / 2 - within.left - size.width / 2), within.width - size.width - margin)
    const above = at.top - within.top - size.height - 14
    const top = above >= margin ? above : Math.min(at.bottom - within.top + 14, within.height - size.height - margin)
    if (!place || Math.abs(place.left - left) > 0.5 || Math.abs(place.top - top) > 0.5) setPlace({ left, top })
  })

  const [from, to] = [Math.min(anchor, head), Math.max(anchor, head)]
  const style = pending ?? commonStyle(node.text, node.spans, from, to)
  const toggled = (key: TextToggle) => style[key] ?? (key === 'bold' ? !!node.bold : false)
  // The size shown is one all the words selected share, or none.
  const scales = from === to ? [style.scale ?? 1] : [...new Set(charStyles(node.text.length, node.spans).slice(from, to).map((s) => s.scale ?? 1))]
  const scale = scales.length === 1 ? scales[0] : null
  const layerColor = resolveColor(doc, node.layer === undefined ? undefined : doc.layers[node.layer]?.color)
  const textColor = resolveColor(doc, node.style?.stroke, layerColor ?? '#1f1f1f') ?? layerColor ?? '#1f1f1f'
  const shownColor = style.color === undefined ? textColor : (resolveColor(doc, style.color, layerColor ?? '#1f1f1f') ?? textColor)
  const align = node.align ?? 'left'
  // Every word selected, or none written yet: the colour is the text's own.
  const whole = from === 0 && to === node.text.length ? { stored: node.style?.stroke, layer: layerColor ?? '#1f1f1f' } : undefined
  // The fields of a sheet ({scale}…) mean something only in what is drawn on every sheet.
  const onSheets = useStore((s) => {
    const inside = rootOf(s.doc, s.scope)
    return inside?.type === 'component' && inside.sheet !== undefined
  })
  if (!editor) return null

  return (
    <div
      ref={bar}
      className={TEXT_FORMAT_BAR}
      role="toolbar"
      aria-label={t('Text format')}
      style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }}
      // Pressed, a button keeps the focus where it is, in the words; a field takes it, to be typed in.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* Each font shown by letters written in it, named in its list and when the pointer rests on it. */}
      <Select
        className="text-format-font"
        value={node.font ?? ''}
        aria-label={t('Font')}
        title={t('Font')}
        options={FONTS.map((option) => ({
          value: option.value,
          label: t(option.label),
          picture: (
            <span className="font-sample" aria-hidden style={{ fontFamily: option.value || SYSTEM_FONT }}>
              Ag
            </span>
          ),
        }))}
        onChange={(font) => editor.setNode({ font: font === '' ? null : font })}
      />
      <span className="text-format-gap" />
      <BarButton title={t('Smaller text')} command="text.smaller" onClick={() => editor.grow(1 / SIZE_STEP)}>
        <AArrowDown size={16} />
      </BarButton>
      <SizeField size={scale === null ? null : node.size * scale} onSize={(mm) => editor.format({ scale: Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, mm / node.size)) })} />
      <BarButton title={t('Larger text')} command="text.bigger" onClick={() => editor.grow(SIZE_STEP)}>
        <AArrowUp size={16} />
      </BarButton>
      <span className="text-format-gap" />
      <BarButton title={t('Bold')} command="text.bold" on={toggled('bold')} onClick={() => editor.toggle('bold')}>
        <Bold size={16} />
      </BarButton>
      <BarButton title={t('Italic')} command="text.italic" on={toggled('italic')} onClick={() => editor.toggle('italic')}>
        <Italic size={16} />
      </BarButton>
      <BarButton title={t('Underline')} command="text.underline" on={toggled('underline')} onClick={() => editor.toggle('underline')}>
        <Underline size={16} />
      </BarButton>
      <BarButton title={t('Strikethrough')} command="text.strike" on={toggled('strike')} onClick={() => editor.toggle('strike')}>
        <Strikethrough size={16} />
      </BarButton>
      <ColorButton color={whole ? textColor : shownColor} own={style.color} fallback={textColor} whole={whole} />
      <span className="text-format-gap" />
      <BarButton title={t('Left')} on={align === 'left'} onClick={() => editor.setNode({ align: null })}>
        <TextAlignStart size={16} />
      </BarButton>
      <BarButton title={t('Centred')} on={align === 'center'} onClick={() => editor.setNode({ align: 'center' })}>
        <TextAlignCenter size={16} />
      </BarButton>
      <BarButton title={t('Right')} on={align === 'right'} onClick={() => editor.setNode({ align: 'right' })}>
        <TextAlignEnd size={16} />
      </BarButton>
      <span className="text-format-gap" />
      {/* A field written where the caret is, filled in by the drawing ({page} shows the name of the page). */}
      <Select
        className="text-format-field"
        value=""
        icon={<Braces size={16} />}
        aria-label={t('Insert a field')}
        title={`${t('Insert a field')}. ${t('A field is filled in by the drawing: written {page} in the text, it shows the name of the page it is on.')}`}
        options={TEXT_FIELDS.filter((field) => onSheets || !SHEET_FIELDS.includes(field)).map((field) => ({ value: field, label: t(FIELD_NAMES[field]) }))}
        onChange={(field) => editor.write(`{${field}}`)}
      />
      <span className="text-format-gap" />
      <BarButton title={t('Clear formatting')} command="text.plain" onClick={() => editor.plain()}>
        <RemoveFormatting size={16} />
      </BarButton>
    </div>
  )
}
