import { msg } from '../i18n'

/*
 * The styles and lights offered in the Perspective panel, for the description given to an image
 * model. Each is named in the person's language (`label`) and said to the model in English
 * (`words`), which models follow best, as the rest of the description is (`cameraPrompt`).
 */

export interface Wish {
  id: string
  label: string
  words: string
}

export const STYLES: Wish[] = [
  { id: 'scandinavian', label: msg('Scandinavian'), words: 'Scandinavian: light oak, white walls, soft textiles, simple lines, a few plants' },
  { id: 'japandi', label: msg('Japandi'), words: 'Japandi: natural wood, linen, muted earth tones, low furniture, calm and uncluttered' },
  { id: 'minimalist', label: msg('Modern minimalist'), words: 'modern minimalist: flat handleless fronts, white and grey, hidden storage, clean lines' },
  { id: 'industrial', label: msg('Industrial'), words: 'industrial: exposed brick, black steel, concrete, raw wood, metal pendant lights' },
  { id: 'midcentury', label: msg('Mid-century modern'), words: 'mid-century modern: walnut, tapered legs, mustard and teal accents, globe lights' },
  { id: 'farmhouse', label: msg('Country farmhouse'), words: 'country farmhouse: shaker fronts, butcher-block worktops, a ceramic sink, warm whites, brass fittings' },
  { id: 'haussmann', label: msg('Parisian, Haussmann'), words: 'Parisian Haussmann apartment: herringbone parquet, plaster mouldings, a marble fireplace, tall windows' },
  { id: 'mediterranean', label: msg('Mediterranean'), words: 'Mediterranean: lime-washed walls, terracotta tiles, arches, olive wood, blue accents' },
  { id: 'luxury', label: msg('Contemporary luxury'), words: 'contemporary luxury: marble, brushed brass, dark wood veneer, designer lighting' },
  { id: 'bohemian', label: msg('Bohemian'), words: 'bohemian: layered rugs, rattan, many plants, warm colours, eclectic objects' },
]

export const LIGHTS: Wish[] = [
  { id: 'morning', label: msg('Morning sun'), words: 'soft morning sun coming in low through the windows, crisp light and gentle shadows' },
  { id: 'day', label: msg('Bright daylight'), words: 'bright natural daylight at midday, the room evenly lit, light shadows' },
  { id: 'overcast', label: msg('Overcast day'), words: 'the soft, even light of an overcast day, no hard shadows' },
  { id: 'golden', label: msg('Golden hour'), words: 'warm golden-hour sunlight streaming in through the windows in the late afternoon, long soft shadows, a cosy amber glow' },
  { id: 'evening', label: msg('Evening, lamps on'), words: 'evening: blue dusk outside the windows, warm lamps and ceiling lights on, pools of light' },
  { id: 'night', label: msg('Night'), words: 'night: dark outside, warm artificial light from lamps and spots, soft pools of light and deep shadows' },
]

/** What is said to the model of a style chosen, '' for none. */
export const styleWords = (style: string): string => STYLES.find((s) => s.id === style)?.words ?? ''

export const lightWords = (light: string): string => LIGHTS.find((l) => l.id === light)?.words ?? ''
