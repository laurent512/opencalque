import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Registry } from '@opencalque/core'
import { architecture } from '@opencalque/ext-architecture'
import { LANGUAGES, LOCALES, setLanguage, t, tn } from './i18n'

const SRC = join(__dirname)

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : sources(path)
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') && name !== 'i18n.ts' ? [path] : []
  })
}

/** Every text passed as a literal to t(), msg() or tn() anywhere in the app. */
function usedTexts(): Set<string> {
  const single = /\b(?:t|msg)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g
  const counted = /\btn\(\s*[^,]+,\s*(['"])((?:\\.|(?!\1).)*)\1\s*,\s*(['"])((?:\\.|(?!\3).)*)\3/g
  const found = new Set<string>()
  for (const file of sources(SRC)) {
    const code = readFileSync(file, 'utf8')
    for (const m of code.matchAll(single)) found.add(m[2].replace(/\\'/g, "'"))
    for (const m of code.matchAll(counted)) {
      found.add(m[2].replace(/\\'/g, "'"))
      found.add(m[4].replace(/\\'/g, "'"))
    }
  }
  return found
}

/** Symbols and unit names ("X1", "mm") are the same in every language and need no entry. */
const needsTranslation = (text: string) => text.length > 2 && /[a-z]/.test(text)
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('translations', () => {
  const used = [...usedTexts()].filter(needsTranslation)

  it('finds the texts in the source', () => {
    expect(used.length).toBeGreaterThan(200)
    expect(used).toContain('Save as…')
  })

  for (const [code] of LANGUAGES.filter(([c]) => c !== 'en')) {
    it(`${code} covers every text, has no leftovers, and keeps the placeholders`, () => {
      const locale = LOCALES[code]
      expect(used.filter((text) => !(text in locale))).toEqual([])
      expect(Object.keys(locale).filter((text) => !used.includes(text))).toEqual([])
      for (const [source, translated] of Object.entries(locale)) expect([source, placeholders(translated)]).toEqual([source, placeholders(source)])
    })

    it(`${code} covers every text the bundled extension shows`, () => {
      const registry = new Registry().use(architecture)
      const shown = [...registry.parametric.values()].flatMap((k) => [k.label, k.description, ...k.params.flatMap((p) => [p.label, ...(p.options ?? [])])])
      const texts = [...shown, ...[...registry.commands.values()].map((c) => c.title)].filter((x): x is string => Boolean(x))
      expect(texts.filter((text) => !(text in registry.translations[code]))).toEqual([])
    })
  }

  it('falls back to English, fills placeholders and picks the form for a count', () => {
    setLanguage('fr', { fr: { Door: 'Porte' } })
    expect(t('Save')).toBe('Enregistrer')
    expect(t('Door')).toBe('Porte')
    expect(t('Not translated anywhere')).toBe('Not translated anywhere')
    expect(t('Page {n}', { n: 3 })).toBe('Page 3')
    expect(tn(1, 'Applied {n} change to the drawing', 'Applied {n} changes to the drawing')).toBe('1 modification appliquée au dessin')
    expect(tn(4, 'Applied {n} change to the drawing', 'Applied {n} changes to the drawing')).toBe('4 modifications appliquées au dessin')
    setLanguage('en')
    expect(t('Save')).toBe('Save')
  })
})
