import { describe, expect, it } from 'vitest'
import { compatibleProvider, type Http } from './compatible'
import { PICTURE_GONE, shorten } from './types'

/** A service that answers every request with the same words and records what it was sent. */
function fakeService() {
  const bodies: any[] = []
  const http: Http = async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return { status: 200, body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }) }
  }
  return { http, bodies }
}

const signal = new AbortController().signal
const config = { apiKey: '', model: 'alpha', baseUrl: 'http://localhost/v1' }

describe('conversation history', () => {
  it('leaves old copies of the drawing and very long texts out of what is stored', () => {
    const stored = shorten(`<drawing_state>\n${'x'.repeat(50_000)}\n</drawing_state>\n\nadd a wall`)
    expect(stored).toContain('add a wall')
    expect(stored.length).toBeLessThan(200)
    expect(shorten('y'.repeat(10_000)).length).toBeLessThan(4100)
  })

  it('sends attached pictures to the model but does not keep them', async () => {
    const { http, bodies } = fakeService()
    const session = compatibleProvider(config, http).createSession({ system: 'S', tools: [] })
    await session.send({ text: 'what is this', images: [{ mime: 'image/jpeg', data: 'QUJD' }] }, () => {}, signal)
    expect(JSON.stringify(bodies[0].messages)).toContain('data:image/jpeg;base64,QUJD')
    const kept = JSON.stringify(session.snapshot())
    expect(kept).not.toContain('QUJD')
    expect(kept).toContain(PICTURE_GONE)
    expect(kept).toContain('what is this')
  })

  it('carries a conversation on from a snapshot, with another model too', async () => {
    const first = fakeService()
    const session = compatibleProvider(config, first.http).createSession({ system: 'S', tools: [] })
    await session.send({ text: 'draw a room' }, () => {}, signal)
    // Through JSON, as it is when kept between two runs of the app.
    const history = JSON.parse(JSON.stringify(session.snapshot()))

    const second = fakeService()
    const resumed = compatibleProvider({ ...config, model: 'beta' }, second.http).createSession({ system: 'S2', tools: [], history })
    await resumed.send({ text: 'make it bigger' }, () => {}, signal)
    const [{ model, messages }] = second.bodies
    expect(model).toBe('beta')
    expect(messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(messages[0].content).toBe('S2')
    expect(messages[1].content).toBe('draw a room')
    expect(messages[3].content).toBe('make it bigger')
  })
})
