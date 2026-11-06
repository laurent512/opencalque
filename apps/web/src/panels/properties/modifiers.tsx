import { type Node, modifierKind, modifierKinds, modifierParams, type Modifier } from '@opencalque/core'
import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2 } from 'lucide-react'
import { addModifier } from '../../actions'
import { msg, t } from '../../i18n'
import { registry, useExtensions } from '../../extensions'
import { apply } from '../../store'
import { Field, FieldPair, IconButton, Section, YesNo } from '../../ui'

/* The Modifiers section: the modifiers of the selected object, in order, each with its parameters. */

/** Texts of the built-in modifier kinds, listed here so that they get translated like the rest. */
export const MODIFIER_TEXTS = [
  msg('Crop'),
  msg('Shows only the part inside a rectangle.'),
  msg('Hatch'),
  msg('Covers closed shapes with a pattern: lines, floor boards or tiles.'),
  msg('Pattern'),
  msg('Spacing'),
  msg('Lines'),
  msg('Cross'),
  msg('Planks'),
  msg('Tiles'),
  msg('Dots'),
  msg('Zigzag'),
  msg('Repeat'),
  msg('Draws copies at a steady step: in a row, or in rows and columns.'),
  msg('Across'),
  msg('Step across'),
  msg('Rows'),
  msg('Step down'),
]

/**
 * The modifiers of the selected object: changes to how it is drawn that leave the object itself
 * alone. They apply from the top of the list down, each to the result of the one above.
 */
export function ModifierStack({ node }: { node: Node }) {
  // Read so the kinds on offer follow extensions being installed or removed.
  useExtensions((s) => s.version)
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
                <FieldPair label={t('X, Y')}>
                  <Field label={t('X')} numeric length value={frame.x} onCommit={(x) => change(index, { frame: { ...frame, x } })} />
                  <Field label={t('Y')} numeric length value={frame.y} onCommit={(y) => change(index, { frame: { ...frame, y } })} />
                </FieldPair>
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
                    <div key={p.key} className="field">
                      <span>{t(p.label)}</span>
                      <YesNo value={params[p.key] === true} label={t(p.label)} onChange={(on) => change(index, { params: { ...modifier.params, [p.key]: on } })} />
                    </div>
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
