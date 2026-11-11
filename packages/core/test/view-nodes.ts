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

/** The nodes of a view: its line, under `id`, and the view of that line, under `id` followed by "v". */
export function viewNodes({ id, a, b, depth, x, y, walls, dimensions, name, parent = 'page_1' }: ViewSpec): Record<string, unknown>[] {
  const own = <T extends object>(values: T) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
  return [
    { type: 'viewline', id, parent, a, b, ...own({ depth }) },
    { type: 'elevation', id: `${id}v`, parent, line: id, x, y, ...own({ walls, dimensions, name }) },
  ]
}

/** The operations that add a view and its line. */
export const viewOps = (spec: ViewSpec): Op[] => viewNodes(spec).map((node): Op => ({ op: 'add_node', node: node as never }))
