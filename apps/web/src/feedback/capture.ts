import { LIMITS, type Recording, type RecordingType } from './report'

/**
 * Pictures and short recordings of part of the app, for a report. Both come from a stream of the
 * app's page asked for with `getDisplayMedia`: in a browser the person agrees to share the tab
 * (or picks a window); in the desktop app the main process answers with the window's own page,
 * without asking (`setDisplayMediaRequestHandler` in apps/desktop/src/main/index.ts). One frame
 * of it is frozen for the person to choose the area on, so the area is right whatever was shared;
 * a recording then follows that area of the live stream.
 */

/** An area of a frame, in the frame's pixels. */
export interface Area {
  x: number
  y: number
  width: number
  height: number
}

export interface Source {
  stream: MediaStream
  video: HTMLVideoElement
  /** The frame the person chooses the area on, taken as the stream started. */
  frame: HTMLCanvasElement
  /** Whether the frame is the page edge to edge, so that an area of it is the same area of the window. */
  isPage: boolean
  stop(): void
}

export const canCapture = (): boolean => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'

const FORMATS: [mime: string, type: RecordingType][] = [
  ['video/webm;codecs=vp9', 'video/webm'],
  ['video/webm;codecs=vp8', 'video/webm'],
  ['video/webm', 'video/webm'],
  ['video/mp4', 'video/mp4'],
]

/** The first kind of video this browser can record that a report may carry. */
function format(): [mime: string, type: RecordingType] | null {
  if (typeof MediaRecorder === 'undefined') return null
  return FORMATS.find(([mime]) => MediaRecorder.isTypeSupported(mime)) ?? null
}

export const canRecord = (): boolean => canCapture() && format() !== null

const frames = (count: number) =>
  new Promise<void>((resolve) => {
    let left = count
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step))
    requestAnimationFrame(step)
  })
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Part of an image, scaled down to at most `maxWidth` × `maxHeight`. */
function crop(image: CanvasImageSource, area: Area, maxWidth: number, maxHeight = maxWidth): HTMLCanvasElement {
  const scale = Math.min(1, maxWidth / area.width, maxHeight / area.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(area.width * scale))
  canvas.height = Math.max(1, Math.round(area.height * scale))
  canvas.getContext('2d')?.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Starts a stream of the app and freezes its first frame. Call it with every window of the app
 * over the drawing already gone: what is on the screen is what is taken.
 */
export async function openSource(): Promise<Source> {
  await frames(2)
  const options = { video: { frameRate: 30 }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' }
  const stream = await navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions)
  const stop = () => stream.getTracks().forEach((track) => track.stop())
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    // The first frames, and the bar a browser puts above a shared tab, settle.
    await wait(300)
    const frame = crop(video, { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight }, Infinity)
    const surface = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface
    const isPage = surface !== 'monitor' && surface !== 'window' && Math.abs(frame.width / frame.height - innerWidth / innerHeight) < 0.03
    return { stream, video, frame, isPage, stop }
  } catch (error) {
    stop()
    throw error
  }
}

/** A picture of an area of the frame, as a report carries it: a PNG in base64, as large as fits the limit. */
export function pictureOf(frame: HTMLCanvasElement, area: Area): string | null {
  for (const width of [1600, 1200, 800]) {
    const base64 = crop(frame, area, width).toDataURL('image/png').split(',')[1] ?? ''
    if (base64 && base64.length <= LIMITS.picture) return base64
  }
  return null
}

const base64Of = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

export interface Recorded {
  recording: Recording
  /** Its first frame, small, as a data address. */
  thumbnail: string
  /** An address to play it back in the window. */
  url: string
}

export interface Recorder {
  /** Seconds recorded so far. */
  elapsed(): number
  stop(): void
  /** What was recorded once it stops (by `stop`, at `LIMITS.seconds`, or when the sharing ends), or null when it is too large to send. */
  done: Promise<Recorded | null>
}

/**
 * Records an area of the source until stopped, at most `LIMITS.seconds`; the source is stopped
 * with it. It starts once what covered the app while the area was chosen has left the screen,
 * and the stream has caught up.
 */
export async function record(source: Source, area: Area): Promise<Recorder> {
  await frames(2)
  await wait(250)
  const [mime, type] = format()!
  // Even sizes: some encoders refuse odd ones.
  const scale = Math.min(1, 1280 / area.width, 960 / area.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round((area.width * scale) / 2) * 2)
  canvas.height = Math.max(2, Math.round((area.height * scale) / 2) * 2)
  const context = canvas.getContext('2d')!
  const draw = () => context.drawImage(source.video, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height)
  draw()
  const thumbnail = crop(canvas, { x: 0, y: 0, width: canvas.width, height: canvas.height }, 240, 160).toDataURL('image/png')

  let running = true
  let loop = 0
  const paint = () => {
    if (!running) return
    draw()
    loop = requestAnimationFrame(paint)
  }
  loop = requestAnimationFrame(paint)

  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 1_200_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
  const started = performance.now()
  const elapsed = () => Math.min(LIMITS.seconds, (performance.now() - started) / 1000)
  let seconds = 0

  const stop = () => {
    if (!running) return
    running = false
    seconds = elapsed()
    cancelAnimationFrame(loop)
    clearTimeout(limit)
    if (recorder.state !== 'inactive') recorder.stop()
    source.stop()
  }
  const limit = setTimeout(stop, LIMITS.seconds * 1000)
  source.stream.getVideoTracks()[0]?.addEventListener('ended', stop)

  const done = new Promise<Recorded | null>((resolve, reject) => {
    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type })
        const content = await base64Of(blob)
        if (!content || content.length > LIMITS.recording) return resolve(null)
        resolve({ recording: { type, content, seconds: Math.round(seconds * 10) / 10 }, thumbnail, url: URL.createObjectURL(blob) })
      } catch (error) {
        reject(error)
      }
    }
  })
  recorder.start(1000)
  return { elapsed: () => (running ? elapsed() : seconds), stop, done }
}
