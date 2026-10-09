import type { Attachment } from './chat'

/** Longest side, in pixels, of a picture sent to a model; larger ones are scaled down, which models do anyway. */
const SENT = 1568
/** Longest side of the preview kept in the conversation. */
const PREVIEW = 200

function scaled(image: ImageBitmap, longest: number, quality: number): string {
  const scale = Math.min(1, longest / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')!
  // JPEG has no transparency; without this a transparent drawing would come out black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

/** Turns a picture file (dropped, pasted or chosen) into what a message carries. Rejects when it is not a picture the browser can read. */
export async function attachmentFrom(file: Blob): Promise<Attachment> {
  const image = await createImageBitmap(file)
  try {
    return { picture: { mime: 'image/jpeg', data: scaled(image, SENT, 0.85).split(',')[1] }, preview: scaled(image, PREVIEW, 0.7) }
  } finally {
    image.close()
  }
}

/** The picture files among what was pasted or dropped. */
export function pictureFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((file) => file.type.startsWith('image/'))
}
