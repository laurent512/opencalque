import { applyOps, type Op } from './ops'
import type { Registry } from './registry'
import type { Document } from './schema'
import { elevationFollowOps } from './elevation'
import { mountFollowOps, openingFollowOps } from './walls/follow'

/**
 * `ops` applied to `doc`, with what follows from them: the doors and windows of the walls they
 * changed, what is fixed on their faces and the elevations of those faces, put back on them
 * (`openingFollowOps`, `mountFollowOps`, `elevationFollowOps`), so that no edit of a wall has to see to them.
 * Whatever edits a drawing for someone (the editor, the assistant, the CLI, an outside agent) comes
 * through here, so that one list of operations makes one drawing wherever it is applied. `applyOps`
 * alone does what the operations say and nothing more.
 */
export function applyEdit(doc: Document, ops: Op[], registry: Registry): { doc: Document; ops: Op[] } {
  const next = applyOps(doc, ops)
  const changed = ops.flatMap((op) => (op.op === 'update_node' ? [op.id] : []))
  const follow = changed.length > 0 ? [...openingFollowOps(doc, next, changed, registry), ...mountFollowOps(doc, next, changed, registry), ...elevationFollowOps(doc, next, changed)] : []
  return follow.length > 0 ? { doc: applyOps(next, follow), ops: [...ops, ...follow] } : { doc: next, ops }
}
