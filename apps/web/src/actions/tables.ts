import { SCHEDULE_COLUMNS, SCHEDULE_FIELDS, tableWord, TABLE_WORDS, type NodeOf, type Schedule } from '@opencalque/core'
import { language, msg, t } from '../i18n'
import { useStore } from '../store'
import { decimalMark, imperialUnit } from '../units'

/*
 * Tables of quantities, as the editor makes them: in the words of the language in use, with the
 * numbers written as people there write them, in the unit system they work in. Once made, a table
 * keeps those words, as the names of layers do, so that the drawing reads the same wherever it is
 * opened.
 */

/** What each kind of table is called, as its title and in the object library. */
export const SCHEDULE_NAMES: Record<Schedule, string> = {
  objects: msg('Objects placed'),
  floors: msg('Floor areas by material'),
  rooms: msg('Rooms'),
  walls: msg('Walls by material'),
  openings: msg('Doors and windows'),
}

/** What each kind of table counts, said under its name in the object library. */
export const SCHEDULE_ABOUT: Record<Schedule, string> = {
  objects: msg('How many of each component and object'),
  floors: msg('The floor area of each material'),
  rooms: msg('Each room and its floor area'),
  walls: msg('Length, faces and volume of the walls of each material and thickness'),
  openings: msg('Doors and windows by kind and size'),
}

/** The words of a table, as the core says them in English, to be translated. Kept apart so that each one is found by the translation test. */
const WORDS: Record<keyof typeof TABLE_WORDS, string> = {
  symbol: msg('Symbol'),
  name: msg('Name'),
  count: msg('Count'),
  material: msg('Material'),
  rooms: msg('Rooms'),
  area: msg('Area ({unit})'),
  thickness: msg('Thickness ({unit})'),
  length: msg('Length ({unit})'),
  volume: msg('Volume ({unit})'),
  kind: msg('Kind'),
  width: msg('Width ({unit})'),
  height: msg('Height ({unit})'),
  'walls.area': msg('Face area ({unit})'),
  total: msg('Total'),
  none: '—',
}

/** The words of a table of `schedule` in the language in use, for the unit system given, by field. */
export function tableLabels(system: 'metric' | 'imperial', schedule?: Schedule): Record<string, string> {
  const translated = Object.fromEntries(Object.entries(WORDS).map(([field, word]) => [field, word === '—' ? word : t(word, { unit: '{unit}' })]))
  return Object.fromEntries(Object.keys(WORDS).filter((field) => !field.includes('.')).map((field) => [field, tableWord(field, system, translated, schedule)]))
}

/** A new table of one kind, to be placed: titled, worded and numbered as the user reads. */
export function newTable(schedule: Schedule): Omit<NodeOf<'table'>, 'id' | 'parent' | 'order' | 'x' | 'y'> {
  const system = imperialUnit() ? 'imperial' : 'metric'
  // Numbers are written with the decimal mark of the preferences, by default the language's.
  const comma = decimalMark() === ','
  // As large on paper as a room's name, at the scale papers are drawn at.
  const size = Math.round(2 * useStore.getState().paperScale)
  // A table of the objects placed draws each beside its name: a legend of the plan that keeps up with it.
  const columns = schedule === 'objects' ? { columns: ['symbol', 'name', 'count'] } : {}
  return { type: 'table', schedule, title: t(SCHEDULE_NAMES[schedule]), labels: tableLabels(system, schedule), language: language(), system, ...(comma ? { decimal: ',' as const } : {}), size, ...columns }
}

/** The fields a table of a kind can show, in the order offered. */
export const scheduleFields = (schedule: string): string[] => Object.keys(SCHEDULE_FIELDS[schedule as Schedule] ?? {})

/** The fields a table shows. */
export const tableColumns = (node: NodeOf<'table'>): string[] => node.columns ?? SCHEDULE_COLUMNS[node.schedule as Schedule] ?? []
