import { eyeHeightOf, focalOf, fovOf, pitchOf, type Camera } from './camera'
import { roomAt } from './rooms'
import type { Document } from './schema'

/*
 * What to tell an image model given the picture of a view, in English, which models follow best,
 * and which the person can change before sending it; the core stays in no language. Laid out as
 * prompts that work are: what to make and from what, what to keep, the scene in the person's own
 * words, the interior's style, the light, and the photograph (its lens, its height, its finish).
 * Nothing of what is in view: the picture shows it (the owner's choice; a list of every object, its
 * place and its size, was tried and found to be noise beside it).
 */

const metres = (mm: number) => `${(mm / 1000).toFixed(2)} m`
/** A sentence of the person's words: ended with a full stop unless they end it themselves. */
const sentence = (words: string) => (/[.!?…]$/.test(words) ? words : `${words}.`)

/** What the person wishes the photograph to look like, in words for the model. */
export interface PromptWishes {
  /** The interior's style. */
  style?: string
  /** What the scene holds besides, in their own words: materials, objects, small touches. */
  details?: string
  /** Its light: the time of day, lamps on or off. Left out, daylight through the windows. */
  light?: string
}

/**
 * What to tell an image model with the picture of a view, to make a photograph of it that keeps
 * its geometry: what to make, that its layout is to be kept, the scene, its style and light as the
 * person wishes, then how the photograph is taken, as the viewpoint is set (its lens, its eye
 * height, level or tilted).
 */
export function cameraPrompt(doc: Document, camera: Camera, wishes: PromptWishes = {}): string {
  const inside = !!roomAt(doc, camera.parent, camera.a)
  const pitch = Math.round(pitchOf(camera))
  const fov = fovOf(camera)
  const details = wishes.details?.trim()
  const style = wishes.style?.trim()
  const light = wishes.light?.trim() || 'natural daylight through the windows'
  const lines = [
    `Photorealistic architectural ${inside ? 'interior ' : ''}render, based on the attached view of a 3D model.`,
    'Preserve the exact layout, camera angle, proportions and placement of everything in it: the walls, the doors and windows, and the place, size and height of every piece of furniture. Only make it look real: materials, light and the details of each object.',
  ]
  if (details) lines.push(sentence(details))
  if (style) lines.push(`Interior style: ${sentence(style)}`)
  lines.push(`Lighting: ${light}, realistic global illumination and soft bounce light.`)
  lines.push(
    `Photography: high-end interior design magazine photography, shot from eye level ${metres(eyeHeightOf(camera))} above the floor with a ${Math.round(focalOf(fov))} mm lens (${Math.round(fov)}° horizontal field of view), f/5.6, ${pitch === 0 ? 'the camera level so that vertical lines stay vertical' : `the camera tilted ${Math.abs(pitch)}° ${pitch > 0 ? 'up' : 'down'}`}, ultra-detailed, photorealistic.`,
  )
  return lines.join('\n') + '\n'
}
