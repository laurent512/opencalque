import { createContext, type ReactNode } from 'react'
import { Camera, Play, Video, X } from 'lucide-react'
import { t } from '../i18n'
import { canCapture, canRecord, type Recorded } from './capture'
import { LIMITS } from './report'

/** A picture of part of the app, taken for a report or a reply: a PNG in base64. */
export type Picture = { id: number; base64: string }
/** A recording of part of the app, taken for a report or a reply. */
export type Clip = Recorded & { id: number }
/** What is attached to what is being written. */
export type Media = { pictures: Picture[]; clips: Clip[] }
export const NO_MEDIA: Media = { pictures: [], clips: [] }

let ids = 0
export const nextId = () => ++ids

/** A picture or a recording shown over the window, from memory (`data:` or `blob:`). */
export type Shown = { url: string; video: boolean }
/** Shows a picture or a recording over the Feedback window. */
export const ShowContext = createContext<(shown: Shown) => void>(() => {})

/** The pictures and recordings attached, each a tile that shows it, with a cross to take it out; `children` are more tiles. */
export function MediaTiles({ media, onChange, onShow, children }: { media: Media; onChange: (media: Media) => void; onShow: (shown: Shown) => void; children?: ReactNode }) {
  const { pictures, clips } = media
  if (pictures.length === 0 && clips.length === 0 && !children) return null
  const removeClip = (clip: Clip) => {
    URL.revokeObjectURL(clip.url)
    onChange({ ...media, clips: clips.filter((c) => c.id !== clip.id) })
  }
  return (
    <ul className="feedback-tiles">
      {pictures.map((picture, i) => (
        <li key={picture.id} className="feedback-tile">
          <button className="feedback-thumb" title={t('Show')} onClick={() => onShow({ url: `data:image/png;base64,${picture.base64}`, video: false })}>
            <img alt={t('Picture {n}', { n: i + 1 })} src={`data:image/png;base64,${picture.base64}`} />
          </button>
          <button className="feedback-remove" title={t('Take out')} aria-label={t('Take out')} onClick={() => onChange({ ...media, pictures: pictures.filter((p) => p.id !== picture.id) })}>
            <X size={12} />
          </button>
        </li>
      ))}
      {clips.map((clip, i) => (
        <li key={clip.id} className="feedback-tile">
          <button className="feedback-thumb" title={t('Play')} onClick={() => onShow({ url: clip.url, video: true })}>
            <img alt={t('Recording {n}', { n: i + 1 })} src={clip.thumbnail} />
            <span className="feedback-play">
              <Play size={12} /> {Math.round(clip.recording.seconds)} s
            </span>
          </button>
          <button className="feedback-remove" title={t('Take out')} aria-label={t('Take out')} onClick={() => removeClip(clip)}>
            <X size={12} />
          </button>
        </li>
      ))}
      {children}
    </ul>
  )
}

/** The buttons that take a picture or a recording of part of the app, where the browser can. */
export function CaptureButtons({ media, onCapture }: { media: Media; onCapture: (recording: boolean) => void }) {
  return (
    <>
      {canCapture() && (
        <button className="pill" disabled={media.pictures.length >= LIMITS.pictures} onClick={() => onCapture(false)} title={t('Drag over a part of the app to take a picture of it')}>
          <Camera size={14} /> {t('Capture an area')}
        </button>
      )}
      {canRecord() && (
        <button className="pill" disabled={media.clips.length >= LIMITS.recordings} onClick={() => onCapture(true)} title={t('Drag over a part of the app, then use it: what happens there is recorded, {seconds} seconds at most', { seconds: LIMITS.seconds })}>
          <Video size={14} /> {t('Record an area')}
        </button>
      )}
    </>
  )
}
