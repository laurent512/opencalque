import type { ModifierKind } from './modifiers'
import type { Op } from './ops'
import type { Primitive } from './primitives'
import type { Document } from './schema'

export interface ParamDef {
  key: string
  label: string
  type: 'number' | 'boolean' | 'string'
  default: number | boolean | string
  /** For a string parameter: the allowed values, shown as a dropdown. */
  options?: string[]
  /** Set on a number that is a length in mm, so editors can show and take it in the user's unit. */
  unit?: 'length'
}

/** What a parametric object can know about its surroundings when it is drawn. */
export interface BuildEnv {
  /** Thickness of the wall the object sits in, when it is an opening placed on one. */
  wallThickness?: number
}

/** An object type drawn from parameters. `build` returns primitives in local coordinates (origin = insertion point). */
export interface ParametricKind {
  kind: string
  label: string
  description?: string
  params: ParamDef[]
  /**
   * Makes the object a wall opening (door, window): the stretch of its local X axis that it cuts
   * out of a wall it is placed on. Such objects also snap to walls when placed or dragged.
   */
  opening?(props: Record<string, any>): { from: number; to: number }
  build(props: Record<string, any>, env: BuildEnv): Primitive[]
}

/** What a command can see and do. Documents are immutable: changes go through `apply`. */
export interface CommandHost {
  doc: Document
  /** The page or component currently being edited. */
  scope: string
  selection: string[]
  activeLayer: string
  apply(ops: Op[]): void
}

export interface Command {
  id: string
  title: string
  run(host: CommandHost): void
}

export interface ExtensionApi {
  registerParametric(kind: ParametricKind): void
  registerCommand(command: Command): void
  registerModifier(kind: ModifierKind): void
}

export interface Extension {
  id: string
  name: string
  version: string
  /**
   * Translations of the texts this extension shows (labels, descriptions, option names, command
   * titles), by language code and then by the English text. Option values stored in documents
   * stay in English; only what is displayed is translated.
   */
  translations?: Record<string, Record<string, string>>
  activate(api: ExtensionApi): void
}

export class Registry {
  readonly extensions: Extension[] = []
  readonly parametric = new Map<string, ParametricKind>()
  readonly commands = new Map<string, Command>()
  /** Modifier kinds contributed by extensions. The built-in ones are not in here; see `modifierKind`. */
  readonly modifiers = new Map<string, ModifierKind>()
  /** The translations of every extension in use, merged, by language code. */
  readonly translations: Record<string, Record<string, string>> = {}

  use(extension: Extension): this {
    extension.activate({
      registerParametric: (kind) => this.parametric.set(kind.kind, kind),
      registerCommand: (command) => this.commands.set(command.id, command),
      registerModifier: (kind) => this.modifiers.set(kind.type, kind),
    })
    for (const [language, texts] of Object.entries(extension.translations ?? {})) {
      this.translations[language] = { ...this.translations[language], ...texts }
    }
    this.extensions.push(extension)
    return this
  }

  /** Forgets every extension, so a different set can be put in use. The registry object stays the same. */
  clear(): this {
    this.extensions.length = 0
    this.parametric.clear()
    this.commands.clear()
    this.modifiers.clear()
    for (const language of Object.keys(this.translations)) delete this.translations[language]
    return this
  }

  /** Props of a parametric node completed with the kind's defaults. */
  resolveProps(kind: ParametricKind, props: Record<string, unknown>): Record<string, any> {
    const out: Record<string, unknown> = {}
    for (const p of kind.params) {
      const value = props[p.key]
      const valid = typeof value === typeof p.default && (!p.options || p.options.includes(value as string))
      out[p.key] = valid ? value : p.default
    }
    return out
  }
}
