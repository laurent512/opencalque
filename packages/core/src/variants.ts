import type { Registry } from './registry'
import type { NodeOf } from './schema'

/*
 * The models of parametric objects. To whoever draws, a radiator of 80 cm placed five times is one
 * thing placed five times, as a component is, and one of 1.20 m is another: a parametric object's
 * model is its kind and every one of its parameters, the defaults filled in. The Components panel
 * lists them beside the components, and tables count them so; nothing of it is stored.
 */

/**
 * Whether objects of a kind are things placed in a building, listed and counted as models: not
 * what makes the building (doors and windows, which cut walls, and stairs: the category
 * 'architecture'), which have tables of their own or are not counted, nor what is written on the
 * plan ('annotation': a north arrow). An unknown kind is listed, so that it is not lost sight of.
 */
export function listedAsModel(kind: string, registry: Registry): boolean {
  const found = registry.parametric.get(kind)
  return !found || (!found.opening && found.category !== 'architecture' && found.category !== 'annotation')
}

/** A value written so that two equal ones read the same: the keys of an object in order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** A parameter that tells a model apart from the others of its kind: its label and its value. */
export interface VariantDetail {
  label: string
  /** For a list (a tall unit's sections), the choice of each of its rows: what each row is. */
  value: string | number | boolean | string[]
}

/** One model of a parametric object: its kind and parameters, the objects of it, and what tells it apart from the other models listed of its kind. */
export interface Variant {
  /** Its kind and parameters, as one string: the same for any two objects of one model. */
  key: string
  kind: string
  /** The kind's label, in English. */
  label: string
  props: Record<string, unknown>
  /** The objects of it, each once. */
  ids: string[]
  /** How many there are: each counted once for each placement of what holds it, when what is counted is placements. */
  count: number
  detail: VariantDetail[]
}

/** The parameters of a parametric object, every one given: its own, else its kind's defaults. */
export function variantProps(node: Pick<NodeOf<'parametric'>, 'kind' | 'props'>, registry: Registry): Record<string, unknown> {
  const kind = registry.parametric.get(node.kind)
  return kind ? registry.resolveProps(kind, node.props) : node.props
}

/** The key of a parametric object's model: its kind and its parameters, the defaults filled in. */
export function variantKey(node: Pick<NodeOf<'parametric'>, 'kind' | 'props'>, registry: Registry): string {
  return `${node.kind} ${stable(variantProps(node, registry))}`
}

/**
 * The models of the parametric objects in `nodes`, which may name one object several times (once
 * for each placement of what holds it), in the order first met: each with the parameters, in its
 * kind's order, that differ between the models of its kind listed, by which it is told apart.
 */
export function variantsOf(nodes: NodeOf<'parametric'>[], registry: Registry): Variant[] {
  const found = new Map<string, Variant>()
  for (const node of nodes) {
    const key = variantKey(node, registry)
    const seen = found.get(key)
    if (seen) {
      seen.count++
      if (!seen.ids.includes(node.id)) seen.ids.push(node.id)
      continue
    }
    found.set(key, { key, kind: node.kind, label: registry.parametric.get(node.kind)?.label ?? node.kind, props: variantProps(node, registry), ids: [node.id], count: 1, detail: [] })
  }
  const variants = [...found.values()]
  for (const variant of variants) {
    const others = variants.filter((other) => other.kind === variant.kind)
    const params = registry.parametric.get(variant.kind)?.params ?? []
    variant.detail = params
      .filter((param) => new Set(others.map((other) => stable(other.props[param.key]))).size > 1)
      .flatMap((param): VariantDetail[] => {
        const value = variant.props[param.key]
        if (param.type === 'list' && Array.isArray(value)) {
          // Each row by its first choice, a section by what it is: "Drawers / Oven / Doors".
          const choice = param.items?.find((item) => item.options)
          return choice ? [{ label: choice.label, value: value.map((row: Record<string, unknown>) => String(row[choice.key])) }] : []
        }
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? [{ label: param.label, value }] : []
      })
  }
  return variants
}

/**
 * What a model is called: its kind's name, then what tells it apart from the others of its kind
 * (lengths as numbers of millimetres, a choice by its word, a parameter that is on by its name).
 * `translate` gives the words in a language: a choice is looked up as "Parameter: Value" first.
 */
export function variantLabel(name: string, detail: VariantDetail[], translate: (text: string) => string = (text) => text): string {
  const parts = detail.flatMap(({ label, value }) => {
    if (Array.isArray(value)) return value.length > 0 ? [value.map((one) => sayChoice(label, one, translate)).join(' / ')] : []
    if (typeof value === 'number') return [String(Math.round(value * 10) / 10)]
    if (typeof value === 'boolean') return value ? [translate(label)] : []
    return [sayChoice(label, value, translate)]
  })
  return parts.length > 0 ? `${translate(name)} ${parts.join(' · ')}` : translate(name)
}

/** A choice in a language: as "Parameter: Value" first, which says it for that parameter, else as its word. */
function sayChoice(label: string, value: string, translate: (text: string) => string): string {
  const scoped = `${label}: ${value}`
  const said = translate(scoped)
  return said !== scoped ? said : translate(value)
}
