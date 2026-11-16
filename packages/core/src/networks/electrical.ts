import { leavesOf } from '../document'
import type { Registry } from '../registry'
import type { Document, Node } from '../schema'
import { CONTROL, linkPort, portsOf, type Link } from './index'

/*
 * What the control links of a page say, worked out each time: which switch controls which lights,
 * and what is left unconnected. An aid for drawing an electrical plan, not a check of an
 * installation: nothing here knows a rule of NF C 15-100 or any other.
 */

/** An object, as the summary names it: its id, its kind and its name when it has one. */
export interface Device {
  id: string
  kind: string
  name?: string
}

export interface ControlSummary {
  /** Each object that gives control (switch, dimmer, push button), with what it controls and through which of its ports. */
  controllers: (Device & { controls: (Device & { port: string })[] })[]
  /** Objects that need control and have none: a light that no switch turns on. */
  uncontrolled: Device[]
  /** Objects that give control and control nothing: a switch with no light. */
  idle: Device[]
}

const device = (node: Node): Device => ({ id: node.id, kind: node.type === 'parametric' ? node.kind : node.type, ...(node.name ? { name: node.name } : {}) })

/** What controls what on a page or component (`root`), from its control links and the ports of its objects. */
export function controlsOn(doc: Document, registry: Registry, root: string): ControlSummary {
  const nodes = leavesOf(doc, root)
  const links = nodes.filter((node): node is Link => node.type === 'link' && (node.role ?? 'control') === 'control' && !!doc.nodes[node.from] && !!doc.nodes[node.to])
  const from = new Map<string, Link[]>()
  const to = new Set<string>()
  for (const link of links) {
    from.set(link.from, [...(from.get(link.from) ?? []), link])
    to.add(link.to)
  }
  const summary: ControlSummary = { controllers: [], uncontrolled: [], idle: [] }
  for (const node of nodes) {
    const ports = portsOf(node, registry).filter((port) => port.carries === CONTROL)
    if (ports.some((port) => port.way === 'out')) {
      const own = from.get(node.id) ?? []
      if (own.length === 0) summary.idle.push(device(node))
      summary.controllers.push({ ...device(node), controls: own.map((link) => ({ ...device(doc.nodes[link.to]), port: linkPort(doc, registry, link, 'from')?.key ?? '' })) })
    }
    if (ports.some((port) => port.way === 'in' && port.required) && !to.has(node.id)) summary.uncontrolled.push(device(node))
  }
  return summary
}
