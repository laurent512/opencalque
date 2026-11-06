import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { svgBox, type DrawnPicture } from '@opencalque/core'

/*
 * A drawing as a PNG with no browser, for the `png` command and for agents looking at a file. The
 * editor draws the same SVG with the browser's own renderer (`svgToCanvas`); the core stays free of
 * both.
 */

const FONTS = fileURLToPath(new URL('../../../fonts/', import.meta.url))

/** The fonts that ship with the app: this renderer sees only those it is given, so that a picture is the same on every computer. */
const fontFiles = (): string[] => (existsSync(FONTS) ? readdirSync(FONTS).filter((name) => name.endsWith('.ttf')).map((name) => FONTS + name) : [])

/**
 * Line weights in the SVG are in pixels of whatever shows it (`non-scaling-stroke`), which this
 * renderer does not know: it would take them for millimetres of the drawing, too thin to see on a
 * plan. They are written here in millimetres, for the size the picture is drawn at.
 */
function weighted(svg: string, millimetresPerPixel: number): string {
  return svg.replace(/stroke-width="([\d.]+)"/g, (_, width) => `stroke-width="${Number(width) * millimetresPerPixel}"`).replace(/ vector-effect="non-scaling-stroke"/g, '')
}

/** Draws an SVG of a drawing on white, `pixels` long on its longer side. */
export function renderPng(svg: string, pixels: number): { png: Buffer; width: number; height: number } {
  const box = svgBox(svg)
  const [width, height] = [box.maxX - box.minX, box.maxY - box.minY]
  const longer = Math.max(width, height)
  const resvg = new Resvg(weighted(svg, longer / pixels), {
    fitTo: width >= height ? { mode: 'width', value: pixels } : { mode: 'height', value: pixels },
    background: 'white',
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: 'Noto Sans', sansSerifFamily: 'Noto Sans' },
  })
  const image = resvg.render()
  return { png: image.asPng(), width: image.width, height: image.height }
}

/** The same, as the tools take it. */
export function renderPicture(svg: string, pixels: number): DrawnPicture {
  const { png, width, height } = renderPng(svg, pixels)
  return { mime: 'image/png', data: png.toString('base64'), width, height }
}
