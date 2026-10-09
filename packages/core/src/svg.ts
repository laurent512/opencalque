import { buildScene, paintOrder, sceneBounds, type PaintStep } from './scene'
import type { Registry } from './registry'
import type { Document } from './schema'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n: number) => String(Math.round(n * 1000) / 1000)

function stepToSvg({ prim, stroke, fill, widthScale, widthExtra, seam }: PaintStep): string {
  if (prim.kind === 'text') {
    const turn = prim.rotation ? ` transform="rotate(${num(prim.rotation)} ${num(prim.x)} ${num(prim.y)})"` : ''
    const anchor = (prim.align === 'center' ? ' text-anchor="middle"' : prim.align === 'right' ? ' text-anchor="end"' : '') + (prim.font ? ` font-family="${esc(prim.font)}"` : '')
    return `<text x="${num(prim.x)}" y="${num(prim.y)}" font-size="${num(prim.size)}" fill="${esc(prim.stroke ?? 'black')}"${anchor}${turn}>${esc(prim.text)}</text>`
  }
  if (prim.kind === 'image') {
    const turn = prim.rotation ? ` transform="rotate(${num(prim.rotation)} ${num(prim.x)} ${num(prim.y)})"` : ''
    const opacity = prim.opacity === undefined ? '' : ` opacity="${num(prim.opacity)}"`
    return `<image x="${num(prim.x)}" y="${num(prim.y)}" width="${num(prim.width)}" height="${num(prim.height)}" preserveAspectRatio="none" href="${esc(prim.href)}"${opacity}${turn}/>`
  }
  const filled = fill && prim.fill && prim.fill !== 'none'
  const paint =
    ` fill="${filled ? esc(prim.fill!) : 'none'}"` +
    (stroke && prim.stroke !== 'none'
      ? ` stroke="${esc(prim.stroke ?? 'black')}" stroke-width="${num((prim.strokeWidth ?? 1) * widthScale + widthExtra)}"` +
        (prim.dash ? ` stroke-dasharray="${prim.dash.join(' ')}"` : '') +
        (widthExtra > 0 ? ' stroke-linejoin="round"' : '') +
        ' vector-effect="non-scaling-stroke"'
      : filled && seam > 0
        ? ` stroke="${esc(prim.fill!)}" stroke-width="${num(seam)}" vector-effect="non-scaling-stroke"`
        : '')
  if (prim.kind === 'ellipse') {
    const turn = prim.rotation ? ` transform="rotate(${num(prim.rotation)} ${num(prim.cx)} ${num(prim.cy)})"` : ''
    return `<ellipse cx="${num(prim.cx)}" cy="${num(prim.cy)}" rx="${num(prim.rx)}" ry="${num(prim.ry)}"${paint}${turn}/>`
  }
  const d = prim.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${num(p.x)} ${num(p.y)}`).join(' ') + (prim.closed ? ' Z' : '')
  return `<path d="${d}"${paint}/>`
}

/** Renders a page or component to a standalone SVG, in millimetres. */
export function toSVG(doc: Document, containerId: string, registry: Registry): string {
  const scene = buildScene(doc, containerId, registry)
  const b = sceneBounds(scene) ?? { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  const margin = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.05 + 1
  const box = [b.minX - margin, b.minY - margin, b.maxX - b.minX + 2 * margin, b.maxY - b.minY + 2 * margin]
  // Clip outlines become clip paths, each defined once; a primitive inside several is nested in them all.
  const clips = new Map<string, string>()
  const clipped = (step: PaintStep): string => {
    let drawn = stepToSvg(step)
    for (const outline of step.prim.clip ?? []) {
      const points = outline.map((p) => `${num(p.x)},${num(p.y)}`).join(' ')
      if (!clips.has(points)) clips.set(points, `clip${clips.size + 1}`)
      drawn = `<g clip-path="url(#${clips.get(points)})">${drawn}</g>`
    }
    return drawn
  }
  const body = paintOrder(scene.flatMap((item) => item.prims)).map(clipped)
  const defs = clips.size > 0 ? [`<defs>${[...clips].map(([points, id]) => `<clipPath id="${id}"><polygon points="${points}"/></clipPath>`).join('')}</defs>`] : []
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.map(num).join(' ')}" font-family="sans-serif">`,
    ...defs,
    `<rect x="${num(box[0])}" y="${num(box[1])}" width="${num(box[2])}" height="${num(box[3])}" fill="white"/>`,
    ...body,
    '</svg>',
    '',
  ].join('\n')
}
