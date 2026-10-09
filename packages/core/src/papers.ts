import { boundsContain } from './geometry'
import type { SceneItem } from './scene'

/**
 * A paper is a sheet laid on the drawing: a rectangle in world millimetres that stands for a real
 * sheet at a drawing scale, so an A3 at 1:100 is 42 × 29.7 m of the drawing. What lies on a paper
 * belongs to it by position, not by reference, the way openings belong to walls.
 */

/** Standard sheet sizes in millimetres of real paper, smallest first. */
export const PAPER_FORMATS = [
  { name: 'A5', short: 148, long: 210 },
  { name: 'A4', short: 210, long: 297 },
  { name: 'A3', short: 297, long: 420 },
  { name: 'A2', short: 420, long: 594 },
  { name: 'A1', short: 594, long: 841 },
  { name: 'A0', short: 841, long: 1189 },
] as const

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

/** Ids of everything lying entirely on a paper: what moves, and is copied, with it. */
export function paperContents(scene: SceneItem[], paperId: string): string[] {
  const paper = scene.find((item) => item.id === paperId)?.node
  if (paper?.type !== 'paper') return []
  const sheet = { minX: paper.x, minY: paper.y, maxX: paper.x + paper.width, maxY: paper.y + paper.height }
  return scene.filter((item) => item.id !== paperId && item.bounds && boundsContain(sheet, item.bounds)).map((item) => item.id)
}
