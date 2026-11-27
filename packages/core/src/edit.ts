import { applyOps, type Op } from './ops'
import type { Registry } from './registry'
import type { Document } from './schema'
import { dimensionFollowOps } from './dimensionfollow'
import { elevationFollowOps } from './elevation'
import { mountFollowOps, openingFollowOps } from './walls/follow'
import { childrenOf } from './document'
import { dist, norm, sub } from './geometry'
import { moveOps } from './kinds'
import { dot } from './walls/course'

/**
 * `ops` applied to `doc`, with what follows from them: the doors and windows of the walls they
 * changed, what is fixed on their faces and the elevations of those faces, put back on them
 * (`openingFollowOps`, `mountFollowOps`, `elevationFollowOps`), and the ends of the dimensions on
 * the points that moved (`dimensionFollowOps`), so that no edit of a wall has to see to them.
 * Whatever edits a drawing for someone (the editor, the assistant, the CLI, an outside agent) comes
 * through here, so that one list of operations makes one drawing wherever it is applied. `applyOps`
 * alone does what the operations say and nothing more.
 */
export function applyEdit(doc: Document, ops: Op[], registry: Registry): { doc: Document; ops: Op[] } {
  const next = applyOps(doc, ops)
  const changed = ops.flatMap((op) => (op.op === 'update_node' ? [op.id] : []))
  const follow = changed.length > 0 ? [...openingFollowOps(doc, next, changed, registry), ...mountFollowOps(doc, next, changed, registry), ...elevationFollowOps(doc, next, changed)] : []
  const followed = follow.length > 0 ? applyOps(next, follow) : next
  // What views hold, kept over what it measures once their lines are where they go.
  const moved = [...changed, ...follow.flatMap((op) => (op.op === 'update_node' ? [op.id] : []))]
  const held = moved.length > 0 ? viewContentFollowOps(doc, followed, moved) : []
  const kept = held.length > 0 ? applyOps(followed, held) : followed
  // The dimensions on points of what moved, last, once everything that follows has.
  const measured = dimensionFollowOps(doc, kept, [...moved, ...held.flatMap((op) => (op.op === 'update_node' ? [op.id] : []))], registry)
  const all = [...follow, ...held, ...measured]
  return all.length > 0 ? { doc: measured.length > 0 ? applyOps(kept, measured) : kept, ops: [...ops, ...all] } : { doc: next, ops }
}

/**
 * What a view holds (its dimensions, its notes) is measured along its line from its start: when
 * that start moves along the line, alone (its end dragged, the face it looks at grown or shortened
 * at that end), what it holds goes back as far, so that it stays over what it was over; a line moved
 * whole, both ends alike, moves nothing in it. What the edit changed itself is left as it set it.
 */
export function viewContentFollowOps(before: Document, after: Document, changed: Iterable<string>): Op[] {
  const ids = new Set(changed)
  const ops: Op[] = []
  for (const id of ids) {
    const [was, now] = [before.nodes[id], after.nodes[id]]
    if (was?.type !== 'elevation' || now?.type !== 'elevation') continue
    const da = sub(now.a, was.a)
    const db = sub(now.b, was.b)
    if (Math.hypot(da.x, da.y) < 1e-9 || Math.hypot(da.x - db.x, da.y - db.y) < 1e-9 || dist(was.a, was.b) < 1e-6) continue
    const shift = dot(da, norm(sub(was.b, was.a)))
    if (Math.abs(shift) < 1e-9) continue
    for (const child of childrenOf(before, id)) {
      if (ids.has(child.id) || after.nodes[child.id] !== child) continue
      ops.push(...moveOps(before, child, { x: -shift, y: 0 }))
    }
  }
  return ops
}
