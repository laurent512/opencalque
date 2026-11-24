import type { Op, Vec2 } from '../src'

/** A view as the tests describe it: what it sees (its line's ends and depth) and where and how it is drawn. */
export interface ViewSpec {
  id: string
  a: Vec2
  b: Vec2
  depth?: number
  x: number
  y: number
  walls?: boolean
  dimensions?: boolean
  name?: string
  parent?: string
}

/** The node of a view, which holds its line, under `id` followed by "v" (where tests once had the view of a line `id`). */
export function viewNodes({ id, a, b, depth, x, y, walls, dimensions, name, parent = 'page_1' }: ViewSpec): Record<string, unknown>[] {
  const own = <T extends object>(values: T) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
  // Its dimensions drawn by itself are what it holds, unless it says none (as the tool makes a view).
  const view = { type: 'elevation', id: `${id}v`, parent, a, b, ...own({ depth }), x, y, ...own({ walls, name }) }
  return dimensions === false ? [view] : [view, { type: 'autodimensions', id: `${id}vd`, parent: `${id}v` }]
}

/** The operations that add a view. */
export const viewOps = (spec: ViewSpec): Op[] => viewNodes(spec).map((node): Op => ({ op: 'add_node', node: node as never }))
