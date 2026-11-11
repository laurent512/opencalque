import * as z from 'zod'
import { carriesOwnLines, carriesWallTypes, MIGRATIONS, withoutWallTypes, withViewLines } from './migrations'
import { repairDocument } from './repair'
import { DocumentSchema, FORMAT, FORMAT_VERSION, FORMER_FORMAT, NODE_TYPES, type Document } from './schema'
import { keepUnknown } from './unknown'

/**
 * How drawings stay readable (see ARCHITECTURE, "The file format and its versions"):
 * - A drawing says which version of the format it is written in. This version of the app reads
 *   that version and every older one, bringing older drawings up to date through `MIGRATIONS`.
 * - Properties it does not know are kept as they are, so a drawing made by a newer version loses
 *   nothing by being opened and saved here; they have no effect.
 * - What older versions would misread (a new type of node, a property whose meaning changed)
 *   raises the version. A drawing in a version newer than this app's is refused with a message
 *   that says so, rather than half-read and saved back damaged.
 */

/** Raised for a drawing written in a newer version of the format than this app reads. */
export class NewerFormatError extends Error {
  constructor(readonly version: number) {
    super(`This drawing was saved by a newer version of OpenCalque (its format is version ${version}; this version reads up to ${FORMAT_VERSION}). Update OpenCalque to open it.`)
    this.name = 'NewerFormatError'
  }
}

const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const invalid = (why: string) => new Error(`Not a valid OpenCalque document:\n${why}`)

/**
 * Validates untrusted JSON into a document, and says what had to be put right for it to open
 * (`repairDocument`): nothing, for a drawing the app wrote itself. Throws with a readable message
 * when it is not a drawing at all, or one of a newer version.
 */
export function readDocument(json: unknown): { doc: Document; repairs: string[] } {
  if (!isPlain(json)) throw invalid('it is not a JSON object.')
  let raw: Record<string, unknown> = json
  // Drawings saved while the project was called OpenCAD carry that name; the format is the same.
  if (raw.format === FORMER_FORMAT) raw = { ...raw, format: FORMAT }
  if (raw.format !== FORMAT) throw invalid(`"format" is ${JSON.stringify(raw.format)}, where a drawing says "${FORMAT}".`)
  const version = raw.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw invalid(`"version" is ${JSON.stringify(version)}, where a drawing gives the version of its format, a whole number.`)
  if (version > FORMAT_VERSION) throw new NewerFormatError(version)
  for (let from = version; from < FORMAT_VERSION; from++) raw = { ...MIGRATIONS[from - 1](raw), version: from + 1 }
  // Saved by a development build of version 2 that still had wall types: taken out as from version 1.
  const typed = carriesWallTypes(raw)
  if (typed) raw = withoutWallTypes(raw)
  // Saved by a development build of version 3 whose views carried their own line: each given one.
  const lined = carriesOwnLines(raw)
  if (lined) raw = withViewLines(raw)
  if (isPlain(raw.nodes)) {
    for (const [key, node] of Object.entries(raw.nodes)) {
      if (isPlain(node) && typeof node.type === 'string' && !NODE_TYPES.includes(node.type)) {
        throw invalid(`node "${key}" is a "${node.type}", which this version of OpenCalque does not know. It may have been made by a newer version.`)
      }
    }
  }
  const result = DocumentSchema.safeParse(raw)
  if (!result.success) throw invalid(z.prettifyError(result.error))
  const { doc, repairs } = repairDocument(keepUnknown(raw, result.data))
  const before = [
    ...(typed ? ['Wall types, left by a development version, were taken out: each became a material of its name, and each wall has what its type gave it.'] : []),
    ...(lined ? ['Views made by a development version were brought up to date: each that carried its own line was given a view line on the plan, named after it.'] : []),
  ]
  return { doc, repairs: [...before, ...repairs] }
}

/** Validates untrusted JSON into a document, putting right what it can (see `readDocument`). */
export function parseDocument(json: unknown): Document {
  return readDocument(json).doc
}
