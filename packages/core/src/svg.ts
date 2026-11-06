import { parseColor } from './colors'
import type { Bounds } from './geometry'
import { buildScene, paintOrder, sceneBounds, type PaintStep } from './scene'
import type { Registry } from './registry'
import type { Document } from './schema'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n: number) => String(Math.round(n * 1000) / 1000)

/** A colour attribute, with its opacity written apart when it has one: not every SVG reader knows colours of eight hex digits. */
function colour(name: 'fill' | 'stroke', value: string): string {
  const parsed = parseColor(value)
  if (!parsed || parsed.a >= 1) return ` ${name}="${esc(value)}"`
  const hex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0')
  return ` ${name}="#${hex(parsed.r)}${hex(parsed.g)}${hex(parsed.b)}" ${name}-opacity="${num(parsed.a)}"`
}

function stepToSvg({ prim, stroke, fill, widthScale, widthExtra, seam }: PaintStep): string {
  if (prim.kind === 'text') {
    const turn = prim.rotation ? ` transform="rotate(${num(prim.rotation)} ${num(prim.x)} ${num(prim.y)})"` : ''
    const anchor = (prim.align === 'center' ? ' text-anchor="middle"' : prim.align === 'right' ? ' text-anchor="end"' : '') + (prim.font ? ` font-family="${esc(prim.font)}"` : '') + (prim.bold ? ' font-weight="bold"' : '')
    return `<text x="${num(prim.x)}" y="${num(prim.y)}" font-size="${num(prim.size)}"${colour('fill', prim.stroke ?? 'black')}${anchor}${turn}>${esc(prim.text)}</text>`
  }
  if (prim.kind === 'image') {
    const turn = prim.rotation ? ` transform="rotate(${num(prim.rotation)} ${num(prim.x)} ${num(prim.y)})"` : ''
    const opacity = prim.opacity === undefined ? '' : ` opacity="${num(prim.opacity)}"`
    return `<image x="${num(prim.x)}" y="${num(prim.y)}" width="${num(prim.width)}" height="${num(prim.height)}" preserveAspectRatio="none" href="${esc(prim.href)}"${opacity}${turn}/>`
  }
  const filled = fill && prim.fill && prim.fill !== 'none'
  const paint =
    (filled ? colour('fill', prim.fill!) : ' fill="none"') +
    (stroke && prim.stroke !== 'none'
      ? `${colour('stroke', prim.stroke ?? 'black')} stroke-width="${num((prim.strokeWidth ?? 1) * widthScale + widthExtra)}"` +
        (prim.dash ? ` stroke-dasharray="${prim.dash.join(' ')}"` : '') +
        (widthExtra > 0 ? ' stroke-linejoin="round"' : '') +
        ' vector-effect="non-scaling-stroke"'
      : filled && seam > 0
        ? `${colour('stroke', prim.fill!)} stroke-width="${num(seam)}" vector-effect="non-scaling-stroke"`
        : '')
  if (prim.kind === 'ellipse') {
    const turn = prim.rotation ? ` transform="rotate(${num(prim.rotation)} ${num(prim.cx)} ${num(prim.cy)})"` : ''
    return `<ellipse cx="${num(prim.cx)}" cy="${num(prim.cy)}" rx="${num(prim.rx)}" ry="${num(prim.ry)}"${paint}${turn}/>`
  }
  const d = prim.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${num(p.x)} ${num(p.y)}`).join(' ') + (prim.closed ? ' Z' : '')
  return `<path d="${d}"${paint}/>`
}

/** The part of the drawing an SVG made by `toSVG` shows, in millimetres. */
export function svgBox(svg: string): Bounds {
  const [x, y, width, height] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 1 1').split(' ').map(Number)
  return { minX: x, minY: y, maxX: x + width, maxY: y + height }
}

/** Renders a page or component to a standalone SVG, in millimetres: all of it with a margin, or just `area`. */
export function toSVG(doc: Document, containerId: string, registry: Registry, options: { area?: Bounds } = {}): string {
  const scene = buildScene(doc, containerId, registry)
  const b = options.area ?? sceneBounds(scene) ?? { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  const margin = options.area ? 0 : Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.05 + 1
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
