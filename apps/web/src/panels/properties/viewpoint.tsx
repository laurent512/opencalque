import { useMemo, useRef } from 'react'
import { ClipboardCopy, Lock, LockOpen } from 'lucide-react'
import { cameraPrompt, eyeHeightOf, focalOf, fovOf, fovOfFocal, pitchOf, type Camera, type Op } from '@opencalque/core'
import { msg, t } from '../../i18n'
import { platform } from '../../platform'
import { usePrefs, setPrefs, type Prefs } from '../../prefs'
import { Select } from '../../Select'
import { apply, useStore } from '../../store'
import { Field, YesNo } from '../../ui'
import { toast } from '../../windows'
import { framesOf, useSeen, type Look } from '../../perspective/seen'
import { viewPicture } from '../../perspective/keep'
import { LIGHTS, lightWords, STYLES, styleWords } from '../../perspective/wishes'

/*
 * What a viewpoint is set to, in its Properties (ARCHITECTURE §10, "Views"): how its view is drawn
 * and its shape, with the picture to save or copy; its camera; and the description to give an image
 * model with the picture. The view itself is on the plan, in a frame of its own (`ViewFrames`).
 */

/** Shaded first, and the default (`prefs.ts`): what a viewpoint is set up to show at first glance; lines next. */
const LOOKS: { value: Look; label: string }[] = [
  { value: 'clay', label: msg('Shaded') },
  { value: 'lines', label: msg('Lines') },
  { value: 'depth', label: msg('Depth') },
]
/** The long side of a picture saved or copied, in pixels; drawn twice as large, then made smaller, for smooth lines. */
const LONG_SIDE = 1920

const setPerspective = (patch: Partial<Prefs['perspective']>) => setPrefs({ perspective: { ...usePrefs.getState().perspective, ...patch } })
const report = (error: unknown) => toast(error instanceof Error ? error.message : String(error))

/** How its view is drawn and its shape, and the picture of it to save or copy. */
export function ViewPicture({ camera }: { camera: Camera }) {
  const prefs = usePrefs((s) => s.perspective)
  const made = () => {
    const doc = useStore.getState().doc
    const frame = framesOf(doc, [camera]).get(camera.id)!
    return viewPicture(doc, camera, prefs.look, frame.width / frame.height, LONG_SIDE).then((made) => made.blob)
  }
  const savePicture = () =>
    made()
      .then(async (blob) => platform.save(new Uint8Array(await blob.arrayBuffer()), `${camera.name || t('Viewpoint')}.png`))
      .catch(report)
  const copyPicture = () =>
    made()
      .then((blob) => navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]))
      .then(() => toast(t('The picture is copied.')))
      .catch(report)
  return (
    <>
      {/* Under its name, as every choice of Properties: "Style" is the image model's, under Description. */}
      <div className="field">
        <span>{t('Rendering')}</span>
        <Select aria-label={t('Rendering')} value={prefs.look} options={LOOKS.map((o) => ({ value: o.value, label: t(o.label) }))} onChange={(look) => setPerspective({ look: look as Look })} />
      </div>
      <button className="text-button" onClick={copyPicture}>
        {t('Copy the picture')}
      </button>
      <button className="text-button" onClick={savePicture}>
        {t('Save the picture as PNG')}
      </button>
    </>
  )
}

/**
 * The viewpoint's camera: its lens (its angle across beside it), the height of its eye and its tilt,
 * each typed or scrubbed (Alt and drag) in its box. Where it stands and looks is set in the view
 * itself, by dragging it and turning the wheel over it, and on the plan.
 */
export function ViewCamera({ camera }: { camera: Camera }) {
  const fov = fovOf(camera)
  const patch = (values: Partial<Camera>): Op[] => [{ op: 'update_node', id: camera.id, patch: values }]
  return (
    <>
      <Field
        label={t('Lens')}
        numeric
        suffix={`mm · ${Math.round(fov)}°`}
        decimals={0}
        min={1}
        value={Math.round(focalOf(fov))}
        note={t('The focal length of a full-frame camera: smaller sees wider. Ctrl and the wheel over the view change it too.')}
        onCommit={(mm: number) => mm > 0 && apply(patch({ fov: Math.round(fovOfFocal(mm) * 10) / 10 }))}
      />
      <Field label={t('Eye height')} numeric length min={0} value={eyeHeightOf(camera)} onCommit={(mm: number) => mm >= 0 && apply(patch({ eyeHeight: mm }))} />
      <Field
        label={t('Tilt')}
        numeric
        suffix="°"
        decimals={0}
        value={pitchOf(camera)}
        note={t('Up when positive, down when negative; level, vertical lines stay vertical')}
        onCommit={(deg: number) => apply(patch({ pitch: Math.max(-60, Math.min(60, Math.round(deg))) || undefined }))}
      />
      {/* Apart from Status, above, which locks the view where it is on the plan. */}
      <div className="field">
        <span>{t('Fixed in place')}</span>
        <YesNo
          label={t('Fixed in place')}
          value={camera.fixed !== true}
          onChange={(free) => apply([{ op: 'update_node', id: camera.id, patch: { fixed: free ? null : true } }])}
          words={[<LockOpen key="free" size={13} />, <Lock key="fixed" size={13} />]}
          titles={[t('Free: dragged in its view, or with the wheel over it, it looks around and walks'), t('Fixed: it keeps where it stands and the way it looks, and the wheel over its view zooms the plan')]}
        />
      </div>
      <p className="hint">{t('Fixed, the camera keeps where it stands and the way it looks: dragging in its view and the wheel over it no longer move it, nor dragging its eye on the plan. Status, above, locks the view where it is on the plan.')}</p>
    </>
  )
}

/** The description to give an image model with the picture: a style, a light, the person's own words, and the text, to copy. */
export function ViewDescription({ camera }: { camera: Camera }) {
  const prefs = usePrefs((s) => s.perspective)
  const editing = useStore((s) => s.base !== null)
  const seen = useSeen(camera, true)
  // Said again once a drag is let go rather than at each of its steps.
  const said = useRef('')
  const prompt = useMemo(() => {
    if (editing && said.current) return said.current
    said.current = seen ? cameraPrompt(seen.doc, camera, { style: styleWords(prefs.preset), details: prefs.style, light: lightWords(prefs.light) }) : ''
    return said.current
  }, [seen, camera, prefs.style, prefs.preset, prefs.light, editing])
  const copyPrompt = () =>
    navigator.clipboard
      .writeText(prompt)
      .then(() => toast(t('The description is copied.')))
      .catch(report)
  return (
    <>
      <div className="field">
        <span>{t('Style')}</span>
        <Select aria-label={t('Style')} value={prefs.preset} options={[{ value: '', label: t('None chosen') }, ...STYLES.map((s) => ({ value: s.id, label: t(s.label) }))]} onChange={(preset) => setPerspective({ preset })} />
      </div>
      <div className="field">
        <span>{t('Lighting')}</span>
        <Select aria-label={t('Lighting')} value={prefs.light} options={[{ value: '', label: t('None chosen') }, ...LIGHTS.map((l) => ({ value: l.id, label: t(l.label) }))]} onChange={(light) => setPerspective({ light })} />
      </div>
      <Field label={t('Details')} value={prefs.style} placeholder={t('e.g. {example}', { example: t('herringbone oak floor, a bowl of fruit on the island') })} onCommit={(style: string) => setPerspective({ style })} />
      <div className="perspective-prompt">
        <textarea readOnly aria-label={t('Description for an image model')} value={prompt} rows={7} />
        <button className="perspective-copy" title={t('Copy the description')} onClick={copyPrompt}>
          <ClipboardCopy size={13} />
          {t('Copy')}
        </button>
      </div>
    </>
  )
}
