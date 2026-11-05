/*
 * What the commands, menus and panels do, by subject. Every user-triggerable action is a command
 * (`commands.ts`) calling one of these.
 *
 *   file       drawings and files: open, save, export, import
 *   clipboard  cut, copy, paste
 *   edit       the selection and pages: delete, duplicate, transform, group, components, order, align, style
 *   walls      the selected walls: dimension, split, extend, trim, turn round, flip over
 *   tables     tables of quantities: a new one, in the user's language, and its columns
 *   view       zoom, and the view kept while a component opened from a list is edited
 *   instances  going through the placements of a component one by one
 */
export * from './clipboard'
export { guarded } from './common'
export * from './edit'
export * from './file'
export * from './view'
export * from './walls'
export * from './tables'
export * from './instances'
