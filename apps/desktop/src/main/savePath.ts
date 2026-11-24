/**
 * The path a file is saved to, given the one picked in the save dialog: with `extension` added when
 * the name does not end with it, as the dialogs of Windows and macOS do from the filter. GTK's, on
 * Linux, keeps the name as typed, and a drawing saved as "plan" was then a file no program knew.
 */
export function withExtension(path: string, extension: string): string {
  return extension && !path.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? `${path}.${extension}` : path
}
