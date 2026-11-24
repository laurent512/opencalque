import { boundsContain, type Vec2 } from './geometry'
import type { SceneItem } from './scene'
import { rootOf } from './document'
import type { Document } from './schema'

/**
 * A paper is a sheet laid on the drawing: a rectangle in world millimetres that stands for a real
 * sheet at a drawing scale, so an A3 at 1:100 is 42 × 29.7 m of the drawing. What lies on a paper
 * belongs to it by position, not by reference, the way openings belong to walls.
 */

/** The families of standard sheets: ISO 216 (A4, A3…), and the ARCH and ANSI sizes of plans and prints in the United States. */
export const PAPER_SERIES = ['ISO', 'ARCH', 'ANSI'] as const
export type PaperSeries = (typeof PAPER_SERIES)[number]

/** An inch, in millimetres: the US sheets are whole inches, or half ones. */
const INCH = 25.4

/** Standard sheet sizes in millimetres of real paper, one series after the other, smallest first in each. */
export const PAPER_FORMATS = [
  { name: 'A5', series: 'ISO', short: 148, long: 210 },
  { name: 'A4', series: 'ISO', short: 210, long: 297 },
  { name: 'A3', series: 'ISO', short: 297, long: 420 },
  { name: 'A2', series: 'ISO', short: 420, long: 594 },
  { name: 'A1', series: 'ISO', short: 594, long: 841 },
  { name: 'A0', series: 'ISO', short: 841, long: 1189 },
  // The sizes US plan sets are printed on, 9 × 12 to 36 × 48 inches; E1, 30 × 42, comes between D and E.
  { name: 'ARCH A', series: 'ARCH', short: 9 * INCH, long: 12 * INCH },
  { name: 'ARCH B', series: 'ARCH', short: 12 * INCH, long: 18 * INCH },
  { name: 'ARCH C', series: 'ARCH', short: 18 * INCH, long: 24 * INCH },
  { name: 'ARCH D', series: 'ARCH', short: 24 * INCH, long: 36 * INCH },
  { name: 'ARCH E1', series: 'ARCH', short: 30 * INCH, long: 42 * INCH },
  { name: 'ARCH E', series: 'ARCH', short: 36 * INCH, long: 48 * INCH },
  // The engineering sizes of ASME Y14.1: A is US Letter, B is Tabloid (11 × 17), each next one twice the one before.
  { name: 'ANSI A', series: 'ANSI', short: 8.5 * INCH, long: 11 * INCH },
  { name: 'ANSI B', series: 'ANSI', short: 11 * INCH, long: 17 * INCH },
  { name: 'ANSI C', series: 'ANSI', short: 17 * INCH, long: 22 * INCH },
  { name: 'ANSI D', series: 'ANSI', short: 22 * INCH, long: 34 * INCH },
  { name: 'ANSI E', series: 'ANSI', short: 34 * INCH, long: 44 * INCH },
] as const satisfies readonly { name: string; series: PaperSeries; short: number; long: number }[]

/** The scale a paper has when it does not say: 1:100, usual for a floor plan. */
export const DEFAULT_PAPER_SCALE = 100

/** Size in the drawing of a standard sheet at a scale of 1:`scale`. */
export function paperSize(format: string, landscape: boolean, scale: number): { width: number; height: number } | null {
  const sheet = PAPER_FORMATS.find((f) => f.name === format)
  if (!sheet) return null
  return landscape ? { width: sheet.long * scale, height: sheet.short * scale } : { width: sheet.short * scale, height: sheet.long * scale }
}

/** The standard sheet a paper is, at its scale, or null when its size is a custom one. */
export function paperFormat(paper: { width: number; height: number; scale?: number }): { name: string; landscape: boolean } | null {
  const scale = paper.scale ?? DEFAULT_PAPER_SCALE
  const landscape = paper.width > paper.height
  const [short, long] = [Math.min(paper.width, paper.height) / scale, Math.max(paper.width, paper.height) / scale]
  const sheet = PAPER_FORMATS.find((f) => Math.abs(f.short - short) < 0.5 && Math.abs(f.long - long) < 0.5)
  return sheet ? { name: sheet.name, landscape } : null
}

/**
 * The scales of US plans: the architect's, an inch or part of one to the foot (1/4" = 1'-0" is
 * 1:48, 1/8" is 1:96), and the engineer's, an inch to so many feet (1" = 10' is 1:120).
 */
export const US_SCALES = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 120, 128, 192, 240, 360, 384, 480, 600, 720, 1200, 2400] as const

/**
 * The scale nearest to `scale` among those a plan is drawn at: whole numbers up to 1:10, then
 * steps of 5, of 25 and of 100; or, for a US sheet (`us`), the nearest of `US_SCALES`, which the
 * steps would turn into others (1:48 into 1:50), up to where they end.
 */
export function roundPaperScale(scale: number, us = false): number {
  const last = US_SCALES[US_SCALES.length - 1]
  if (us && scale < last * 1.5) {
    const off = (candidate: number) => Math.abs(Math.log(candidate / Math.max(scale, 1e-9)))
    return US_SCALES.reduce((best, candidate) => (off(candidate) < off(best) ? candidate : best))
  }
  const step = scale < 10 ? 1 : scale < 100 ? 5 : scale < 500 ? 25 : 100
  return Math.max(1, Math.round(scale / step) * step)
}

/** Whether a paper is a US one, whose scale is rounded among `US_SCALES`: an ARCH or ANSI sheet, or one at a US scale that is not also a round one (1:48, not 1:100). */
function usSheet(paper: { width: number; height: number; scale?: number }): boolean {
  const format = paperFormat(paper)
  if (format && PAPER_FORMATS.find((f) => f.name === format.name)?.series !== 'ISO') return true
  const scale = paper.scale ?? DEFAULT_PAPER_SCALE
  return (US_SCALES as readonly number[]).includes(scale) && roundPaperScale(scale) !== scale
}

/**
 * What a paper becomes when its corner `index` (clockwise from the top left) is pulled to `p`: the
 * same sheet at another scale. The opposite corner stays put and the pulled one keeps to the
 * diagonal through both, so the sheet keeps its proportions; the scale is a round one.
 */
export function paperScaleTo(paper: { x: number; y: number; width: number; height: number; scale?: number }, index: number, p: Vec2): { x: number; y: number; width: number; height: number; scale: number } {
  const corners = [
    { x: paper.x, y: paper.y },
    { x: paper.x + paper.width, y: paper.y },
    { x: paper.x + paper.width, y: paper.y + paper.height },
    { x: paper.x, y: paper.y + paper.height },
  ]
  const fixed = corners[(index + 2) % 4]
  const d = { x: corners[index].x - fixed.x, y: corners[index].y - fixed.y }
  const was = paper.scale ?? DEFAULT_PAPER_SCALE
  const along = ((p.x - fixed.x) * d.x + (p.y - fixed.y) * d.y) / (d.x * d.x + d.y * d.y || 1)
  const scale = roundPaperScale(was * Math.max(along, 0), usSheet(paper))
  const k = scale / was
  return { x: Math.min(fixed.x, fixed.x + d.x * k), y: Math.min(fixed.y, fixed.y + d.y * k), width: paper.width * k, height: paper.height * k, scale }
}

/**
 * A paper at another scale: the same sheet covering more or less of the drawing, as when a corner
 * is pulled, its middle staying where it is. A sheet of any size, standard or not, grows with it.
 */
export function paperRescaled(paper: { x: number; y: number; width: number; height: number; scale?: number }, scale: number): { x: number; y: number; width: number; height: number; scale: number } {
  const k = scale / (paper.scale ?? DEFAULT_PAPER_SCALE)
  const [width, height] = [paper.width * k, paper.height * k]
  return { x: paper.x + (paper.width - width) / 2, y: paper.y + (paper.height - height) / 2, width, height, scale }
}

/** What a paper says of itself to the fields of what is drawn on every sheet: its name, its scale, and its format or its size in millimetres. */
export function paperSheet(paper: { name?: string; width: number; height: number; scale?: number }): { name: string; scale: number; format: string } {
  const scale = paper.scale ?? DEFAULT_PAPER_SCALE
  return { name: paper.name ?? '', scale, format: paperFormat(paper)?.name ?? `${Math.round(paper.width / scale)} × ${Math.round(paper.height / scale)}` }
}

/**
 * The drawing scale of the sheet a point of a page is drawn on, as the N of 1:N: of the paper of
 * that page under it, the one on top when they overlap; on none,
 * `DEFAULT_PAPER_SCALE`. What a view's scale in Properties is read against: a view twice as large
 * as the plan on a sheet at 1:100 is at 1:50.
 */
export function sheetScaleAt(doc: Document, parent: string | null, at: Vec2): number {
  const page = rootOf(doc, parent)?.id
  let found: { scale?: number; order: string } | undefined
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'paper' || at.x < node.x || at.x > node.x + node.width || at.y < node.y || at.y > node.y + node.height) continue
    if (rootOf(doc, node.parent)?.id !== page) continue
    if (!found || node.order > found.order) found = node
  }
  return found?.scale ?? DEFAULT_PAPER_SCALE
}

/** Ids of everything lying entirely on a paper: what moves, and is copied, with it. */
export function paperContents(scene: SceneItem[], paperId: string): string[] {
  const paper = scene.find((item) => item.id === paperId)?.node
  if (paper?.type !== 'paper') return []
  const sheet = { minX: paper.x, minY: paper.y, maxX: paper.x + paper.width, maxY: paper.y + paper.height }
  return scene.filter((item) => item.id !== paperId && item.bounds && boundsContain(sheet, item.bounds)).map((item) => item.id)
}
