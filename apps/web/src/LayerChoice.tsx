import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { layersOf, type Node, resolveColor } from '@opencalque/core'
import { FLOATING, useFloating } from './floating'
import { t } from './i18n'
import { useStore } from './store'

/** A layer's colour as a small upright bar; empty for a layer with no colour of its own. */
function LayerMark({ color }: { color: string | undefined }) {
  return <i className={`layer-mark${color ? '' : ' none'}`} style={color ? { background: color } : undefined} />
}

/**
 * The layer the selected objects are on: a button with its colour and name, which opens the list of
 * the drawing's layers, each with its colour. Objects on different layers show as mixed; nothing
 * in the list is then lit, and picking one puts them all on it.
 */
export function LayerChoice({ nodes, pick }: { nodes: Node[]; pick: (id: string) => void }) {
  const doc = useStore((s) => s.doc)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)
  const { closing, style } = useFloating(open, close, box, menu)
  const on = new Set(nodes.map((node) => node.layer))
  const mixed = on.size > 1
  const now = mixed ? undefined : doc.layers[nodes[0].layer ?? '']
  const label = t('Layer')
  return (
    // A click in the chooser is about the layer, not about the row it sits in.
    <span className="color-choice layer-choice" ref={box} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="color-now"
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (closing.current) return
          setOpen(!open)
        }}
      >
        {now && <LayerMark color={resolveColor(doc, now.color)} />}
        {now ? <span>{now.name}</span> : <em className="faint">{mixed ? t('Mixed') : t('None')}</em>}
        <ChevronDown size={12} />
      </button>
      {open &&
        createPortal(
          <div className={`color-menu layer-menu ${FLOATING}`} ref={menu} style={style} role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()}>
            {layersOf(doc).map((layer) => (
              <button
                key={layer.id}
                type="button"
                className={`color-option${layer.id === now?.id ? ' active' : ''}`}
                onClick={() => {
                  pick(layer.id)
                  close()
                }}
              >
                <LayerMark color={resolveColor(doc, layer.color)} />
                <span>{layer.name}</span>
                {layer.id === now?.id && <Check size={12} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  )
}
