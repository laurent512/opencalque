import { expect, test } from 'vitest'
import { withExtension } from './savePath'

test('a file saved under a name typed without its extension gets it, as on every system', () => {
  expect(withExtension('/home/ana/plano', 'opencalque')).toBe('/home/ana/plano.opencalque')
  expect(withExtension('/home/ana/Plano 05.final', 'opencalque')).toBe('/home/ana/Plano 05.final.opencalque')
  expect(withExtension('/home/ana/plano.opencalque', 'opencalque')).toBe('/home/ana/plano.opencalque')
  expect(withExtension('C:\\Planos\\PLANO.OPENCALQUE', 'opencalque')).toBe('C:\\Planos\\PLANO.OPENCALQUE')
  expect(withExtension('/home/ana/planta', 'pdf')).toBe('/home/ana/planta.pdf')
  // With no type to save as, the name is kept.
  expect(withExtension('/home/ana/plano', '')).toBe('/home/ana/plano')
})
