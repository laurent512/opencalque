/**
 * A text as it is searched: without case or accents, so that "beton" finds "Béton", and with the
 * Turkish dotless ı taken as an i. A plain `toLowerCase` makes "İçe aktar" into "i̇çe aktar", an i
 * with a dot added, which "içe" is not found in, and leaves "ızgara", typed on a Turkish keyboard,
 * apart from "izgara", which is what "Izgara" becomes. Every search box goes through it, on both
 * the query and what is searched.
 */
export const searchable = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
