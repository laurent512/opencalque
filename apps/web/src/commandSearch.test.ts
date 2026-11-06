import { afterEach, describe, expect, it } from 'vitest'
import { matchesCommand, searchCommands } from './commandSearch'
import { setLanguage } from './i18n'

const command = (title: string, category = 'Edit', keywords?: string) => ({ title, category, keywords })
const titles = (list: { title: string }[]) => list.map((one) => one.title)

const browse = command('Go through the instances of this component', 'Components', 'find placements next')
const place = command('Place component: Sofa', 'Insert', 'Place component')

afterEach(() => setLanguage('en'))

describe('searching the commands', () => {
  it('puts what was typed before what only has a word that starts like it', () => {
    expect(titles(searchCommands([browse, place], 'place component'))).toEqual([place.title, browse.title])
  })

  it('does so in another language, from the English names', () => {
    setLanguage('fr')
    // Commands made from the drawing have their title in the language already, and their English in the keywords.
    const placed = command('Placer le composant : Canapé', 'Insert', 'Place component')
    expect(titles(searchCommands([browse, placed], 'place component'))).toEqual([placed.title, browse.title])
  })

  it('ranks a whole word, then the start of a word, then the inside of one', () => {
    const inside = command('Unlock', 'View')
    const start = command('Locked layers', 'View')
    const whole = command('Lock', 'View')
    expect(titles(searchCommands([inside, start, whole], 'lock'))).toEqual(['Lock', 'Locked layers', 'Unlock'])
  })

  it('ranks the title people see above a keyword they do not', () => {
    const hidden = command('Duplicate', 'Edit', 'copy')
    const named = command('Copy', 'Edit')
    expect(titles(searchCommands([hidden, named], 'copy'))).toEqual(['Copy', 'Duplicate'])
  })

  it('keeps the order of the list among those as close as each other, and when nothing is typed', () => {
    const list = [command('Zoom in', 'View'), command('Zoom out', 'View'), command('Zoom to fit', 'View')]
    expect(titles(searchCommands(list, 'zoom'))).toEqual(titles(list))
    expect(titles(searchCommands(list, ''))).toEqual(titles(list))
    expect(titles(searchCommands(list, '   '))).toEqual(titles(list))
  })

  it('leaves out what lacks a word of the query, and finds no less than it did', () => {
    expect(searchCommands([browse, place], 'place sofa')).toEqual([place])
    expect(searchCommands([browse, place], 'nothing')).toEqual([])
    // Letters inside a word still match, as they always did.
    expect(matchesCommand(place, 'lace')).toBe(true)
    expect(searchCommands([place], 'lace')).toEqual([place])
  })

  it('finds words in scripts without spaces', () => {
    const japanese = command('図面を開く', 'File')
    expect(searchCommands([japanese], '図面')).toEqual([japanese])
  })
})
