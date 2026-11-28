import { childrenOf, isVisible, newId } from './document'
import { LAYER_COLOR } from './colors'
import { kindOf, nodePrimitives, objectBacking, parametricPrimitives } from './kinds'
import type { NodeInput, Op } from './ops'
import { transformPrimitive, type Primitive, type TextRun } from './primitives'
import { spansOf, type TextStyle } from './richtext'

/** The spans that set a text apart as its runs are, one after the other. */
function runSpans(runs: TextRun[]): ReturnType<typeof spansOf> {
  return spansOf(runs.flatMap(({ text, ...style }): TextStyle[] => new Array(text.length).fill(style)))
}
import type { Registry } from './registry'
import type { Document, NodeOf } from './schema'

/**
 * Drawn shapes made into objects of the drawing: lines, polylines and polygons, ellipses, texts,
 * each with the look it was drawn with. What a parametric object or a stretched component
 * placement draws is kept this way when it is to be edited shape by shape. Hatching (strokes cut
 * to a shape, which an object cannot be) and pictures are left out.
 */
export function primitiveNodes(prims: Primitive[], parent: string, layer?: string): NodeInput[] {
  return prims.flatMap((p): NodeInput[] => {
    if (p.texture || p.clip) return []
    const look = { ...(p.stroke === undefined ? {} : { stroke: p.stroke }), ...(p.strokeWidth === undefined ? {} : { strokeWidth: p.strokeWidth }), ...(p.fill === undefined ? {} : { fill: p.fill }), ...(p.dash === undefined ? {} : { dash: p.dash }) }
    const common = { id: newId(), parent, ...(layer ? { layer } : {}), ...(Object.keys(look).length > 0 ? { style: look } : {}) }
    switch (p.kind) {
      case 'path':
        if (p.points.length < 2) return []
        return [p.points.length === 2 && !p.closed ? ({ ...common, type: 'line', a: p.points[0], b: p.points[1] } as NodeInput) : ({ ...common, type: 'polyline', points: p.points, ...(p.closed ? { closed: true } : {}) } as NodeInput)]
      case 'ellipse':
        return [{ ...common, type: 'ellipse', cx: p.cx, cy: p.cy, rx: p.rx, ry: p.ry, ...(p.rotation ? { rotation: p.rotation } : {}) } as NodeInput]
      case 'text':
        return [{ ...common, type: 'text', x: p.x, y: p.y, text: p.text, size: p.size, ...(p.rotation ? { rotation: p.rotation } : {}), ...(p.align && p.align !== 'left' ? { align: p.align } : {}), ...(p.font ? { font: p.font } : {}), ...(p.bold ? { bold: true } : {}), ...(p.runs ? { spans: runSpans(p.runs) } : {}) } as NodeInput]
      default:
        return []
    }
  })
}

/**
 * The operations that vectorize a parametric object or a table of quantities: the shapes it draws now, where it draws them,
 * become a group in its place, to be edited one by one. The group takes the object's name (or
 * `names.group`), place in the stacking order, layer and modifiers. A placed object hides what lies
 * under it (`objectBacking`) and a group does not, so that white comes along as filled shapes of
 * its own, in a group named `names.backing` under the rest, to be deleted when it is not wanted.
 * What its parameters did is not kept: a door made so no longer cuts its wall. Returns the group's id.
 */
export function vectorizeOps(doc: Document, id: string, registry: Registry, names: { group: string; backing: string }): { ops: Op[]; id: string } | null {
  const node = doc.nodes[id]
  if (node?.type === 'table') return tableShapesOps(doc, node, registry, names.group)
  if (node?.type !== 'parametric' || node.parent === null) return null
  // Its own look over what the kind draws, as it is drawn: a line keeps a look the kind gave it as its own.
  const prims = parametricPrimitives(node, { doc, registry, depth: 0 }).map((p): Primitive =>
    p.own || !node.style ? p : { ...p, stroke: node.style.stroke ?? p.stroke, strokeWidth: node.style.strokeWidth ?? p.strokeWidth, fill: node.style.fill ?? p.fill, dash: node.style.dash ?? p.dash },
  )
  const placed = (shapes: Primitive[]) => shapes.map((p) => transformPrimitive(p, node))
  const layer = node.layer
  const group = newId('group')
  const ops: Op[] = [
    { op: 'remove_node', id },
    {
      op: 'add_node',
      node: {
        type: 'group',
        id: group,
        parent: node.parent,
        order: node.order,
        name: node.name ?? names.group,
        ...(layer ? { layer } : {}),
        ...(node.modifiers?.length ? { modifiers: node.modifiers } : {}),
      } as NodeInput,
    },
  ]
  // Each shape is put on top of those before it, so the white goes first.
  const backing = newId('group')
  const white = primitiveNodes(placed(objectBacking(prims)), backing, layer)
  if (white.length > 0) {
    ops.push({ op: 'add_node', node: { type: 'group', id: backing, parent: group, name: names.backing, ...(layer ? { layer } : {}) } as NodeInput })
    ops.push(...white.map((shape): Op => ({ op: 'add_node', node: shape })))
  }
  ops.push(...primitiveNodes(placed(prims), group, layer).map((shape): Op => ({ op: 'add_node', node: shape })))
  return { ops, id: group }
}

/**
 * The operations that vectorize a table of quantities: what it shows now, its frame, its lines,
 * its words and the symbols it draws, become a group in its place, named after its title (or
 * `name`), to be edited or moved one by one. It no longer counts anything: it stays as it was.
 * The table's own look goes over what it draws, as it does when the table is drawn.
 */
function tableShapesOps(doc: Document, node: NodeOf<'table'>, registry: Registry, name: string): { ops: Op[]; id: string } | null {
  if (node.parent === null) return null
  const style = node.style
  const prims = kindOf(node)
    .primitives(node, { doc, registry, depth: 0 })
    .map((p): Primitive => {
      if (p.own || !style) return p
      const filled = (p.kind === 'path' && p.closed) || p.kind === 'ellipse'
      return { ...p, stroke: style.stroke ?? p.stroke, strokeWidth: style.strokeWidth ?? p.strokeWidth, dash: style.dash ?? p.dash, ...(filled && style.fill !== undefined ? { fill: style.fill } : {}) }
    })
  const group = newId('group')
  const ops: Op[] = [
    { op: 'remove_node', id: node.id },
    { op: 'add_node', node: { type: 'group', id: group, parent: node.parent, order: node.order, name: node.title || name, ...(node.layer ? { layer: node.layer } : {}), ...(node.modifiers?.length ? { modifiers: node.modifiers } : {}) } as NodeInput },
    ...primitiveNodes(prims, group, node.layer).map((shape): Op => ({ op: 'add_node', node: shape })),
  ]
  return { ops, id: group }
}

/**
 * What a placed component draws, stretched as it is placed, as shapes in the drawing's own
 * coordinates. What the component draws without a colour of its own follows the layer the shapes
 * go on, as it followed the placement's.
 */
export function placedShapes(doc: Document, instance: NodeOf<'instance'>, registry: Registry): Primitive[] {
  const ctx = { doc, registry, depth: 1, ink: LAYER_COLOR }
  return childrenOf(doc, instance.component)
    .filter((child) => isVisible(doc, child))
    .flatMap((child) => nodePrimitives(child, ctx))
    .map((p) => transformPrimitive(p, instance))
}
