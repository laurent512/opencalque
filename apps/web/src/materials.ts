import { type Node, type Op, type Pattern, type Style } from '@opencalque/core'
import { msg, t } from './i18n'
import { apply, useStore } from './store'

/*
 * The materials of a house that the editor offers before the drawing has any of its own, added to
 * the drawing all at once from the Materials panel.
 */

/**
 * What a wall, or a floor of a material, keeps of a style: everything but the fill and pattern,
 * which are its material's. Undefined when nothing is left.
 */
export function withoutFill(style: Style | undefined): Style | undefined {
  if (!style) return undefined
  const { fill: _, pattern: __, ...rest } = style
  return Object.keys(rest).length > 0 ? rest : undefined
}

/** The patch that takes off a fill a node was given of its own, which gives way to its material's: nothing when it has none. */
export const unfilledPatch = (node: Node): Record<string, unknown> => (node.style && ('fill' in node.style || 'pattern' in node.style) ? { style: withoutFill(node.style) ?? null } : {})

/** The materials of a house, each drawn as plans usually draw it. */
export const COMMON: { name: string; fill: string; pattern?: Pattern }[] = [
  { name: msg('Concrete'), fill: '#d6d6d6', pattern: { kind: 'Dots', spacing: 40 } },
  { name: msg('Brick'), fill: '#efc7b4', pattern: { kind: 'Lines', spacing: 60 } },
  { name: msg('Concrete block'), fill: '#e3e3e3', pattern: { kind: 'Cross', spacing: 100 } },
  { name: msg('Timber'), fill: '#ecd6b0', pattern: { kind: 'Lines', spacing: 40, angle: 0 } },
  { name: msg('Mineral wool'), fill: '#fff6c9', pattern: { kind: 'Zigzag' } },
  { name: msg('Insulation board'), fill: '#f4f1de', pattern: { kind: 'Cross', spacing: 40 } },
  { name: msg('Plasterboard'), fill: '#ffffff' },
  { name: msg('Plaster'), fill: '#fafafa' },
  { name: msg('Render'), fill: '#f0f0f0' },
  { name: msg('Oak parquet'), fill: '#dcc095', pattern: { kind: 'Planks', spacing: 120 } },
  { name: msg('Tiles'), fill: '#e8ebef', pattern: { kind: 'Tiles', spacing: 300 } },
  { name: msg('Carpet'), fill: '#cfd8e6', pattern: { kind: 'Dots', spacing: 60 } },
]

/** The common materials the drawing has none of the same name of, by their place in `COMMON`. */
export function missingCommon(): number[] {
  const names = new Set(Object.values(useStore.getState().doc.materials ?? {}).map((material) => material.name))
  return COMMON.flatMap((material, i) => (names.has(t(material.name)) ? [] : [i]))
}

/** Adds the common materials the drawing has none of the same name of. */
export function addCommon(): void {
  const ops = missingCommon().map((i): Op => ({ op: 'add_material', material: { ...COMMON[i], name: t(COMMON[i].name) } }))
  if (ops.length > 0) apply(ops)
}
