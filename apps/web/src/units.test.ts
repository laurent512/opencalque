import { afterEach, describe, expect, it } from 'vitest'
import { usePrefs } from './prefs'
import { formatLength, formatNumber, parseLength } from './units'

const use = (unit: 'mm' | 'cm' | 'm' | 'in' | 'ft') => usePrefs.setState({ unit, language: 'en' })

describe('units', () => {
  afterEach(() => use('mm'))

  it('shows lengths in the chosen unit, to about a millimetre', () => {
    use('mm')
    expect(formatLength(3500.4)).toBe('3500 mm')
    use('m')
    expect(formatLength(3500)).toBe('3.5 m')
    expect(formatNumber(1234.5678)).toBe('1.235')
    use('ft')
    expect(formatLength(3048)).toBe('10 ft')
    use('in')
    expect(formatNumber(254)).toBe('10')
  })

  it('reads a bare number in the chosen unit, with a point or a comma', () => {
    use('m')
    expect(parseLength('3.5')).toBe(3500)
    expect(parseLength(' 3,5 ')).toBe(3500)
    use('mm')
    expect(parseLength('3500')).toBe(3500)
    use('in')
    expect(parseLength('10')).toBeCloseTo(254)
  })

  it('lets a unit written after the number win over the setting', () => {
    use('m')
    expect(parseLength('350 cm')).toBe(3500)
    expect(parseLength('1200mm')).toBe(1200)
    expect(parseLength('2 M')).toBe(2000)
    expect(parseLength('10 ft')).toBeCloseTo(3048)
    expect(parseLength('12"')).toBeCloseTo(304.8)
  })

  it('refuses what is not a length', () => {
    for (const text of ['', 'abc', '3 parsecs', '1.2.3', 'm']) expect(parseLength(text)).toBeNull()
  })

  it('reads back what it shows', () => {
    for (const unit of ['mm', 'cm', 'm', 'in', 'ft'] as const) {
      use(unit)
      expect(parseLength(formatNumber(2540))).toBeCloseTo(2540, 0)
    }
  })
})
