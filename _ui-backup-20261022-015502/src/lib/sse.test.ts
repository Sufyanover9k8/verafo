import { describe, expect, it } from 'vitest'
import { ANSWER_LIMIT, appendDelta, parseSseFrame, splitSseFrames } from './sse'

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

describe('appendDelta', () => {
  it('joins deltas in the order they arrived', () => {
    const deltas = ['Karachi ', 'carries ', 'most ', 'of the risk.']
    expect(deltas.reduce(appendDelta, '')).toBe('Karachi carries most of the risk.')
  })

  it('is a pure function of its arguments', () => {
    // The regression this guards: the buffer used to be accumulated inside a
    // React state updater, which React may invoke more than once. Each delta
    // then landed in the buffer several times and the saved answer came out
    // with its chunks interleaved and duplicated. Calling it once per frame,
    // with the buffer threaded through the return value, cannot do that.
    const buffer = appendDelta('', 'abc')
    const again = appendDelta('', 'abc')
    expect(buffer).toBe('abc')
    expect(again).toBe('abc')
    expect(appendDelta(buffer, 'def')).toBe('abcdef')
  })

  it('ignores an empty delta', () => {
    expect(appendDelta('kept', '')).toBe('kept')
  })

  it('keeps only the most recent ANSWER_LIMIT characters', () => {
    const long = 'x'.repeat(ANSWER_LIMIT + 500)
    const out = appendDelta(long, 'tail')
    expect(out.length).toBe(ANSWER_LIMIT)
    expect(out.endsWith('tail')).toBe(true)
  })
})

describe('parseSseFrame', () => {
  it('reads the event name and the data payload', () => {
    expect(parseSseFrame('event: delta\ndata: {"content":"hi"}')).toEqual({
      event: 'delta',
      data: '{"content":"hi"}',
    })
  })

  it('defaults to `message` when no event line is present', () => {
    expect(parseSseFrame('data: {"a":1}')?.event).toBe('message')
  })

  it('joins multi-line data with newlines', () => {
    expect(parseSseFrame('event: x\ndata: one\ndata: two')?.data).toBe('one\ntwo')
  })

  it('returns null for a keep-alive or blank block', () => {
    expect(parseSseFrame('')).toBeNull()
    expect(parseSseFrame(': ping')).toBeNull()
  })

  it('tolerates a space after the colon and none before the value', () => {
    expect(parseSseFrame('event:delta\ndata:{"content":"hi"}')).toEqual({
      event: 'delta',
      data: '{"content":"hi"}',
    })
  })
})

describe('splitSseFrames', () => {
  it('returns every complete frame and nothing left over', () => {
    const buf = frame('phase', { phase: 'writing' }) + frame('delta', { content: 'hi' })
    const { frames, rest } = splitSseFrames(buf)
    expect(frames).toHaveLength(2)
    expect(frames[0].event).toBe('phase')
    expect(frames[1].event).toBe('delta')
    expect(rest).toBe('')
  })

  it('keeps a half-arrived frame for the next read', () => {
    // A chunk boundary can land mid-frame; dropping the tail would lose the
    // event entirely.
    const buf = frame('delta', { content: 'one' }) + 'event: delta\ndata: {"content":"tw'
    const { frames, rest } = splitSseFrames(buf)
    expect(frames).toHaveLength(1)
    expect(rest).toBe('event: delta\ndata: {"content":"tw')
  })

  it('reassembles the tail once the rest of the frame arrives', () => {
    const first = splitSseFrames(frame('delta', { content: 'one' }) + 'event: delta\ndata: {"content":"tw')
    const second = splitSseFrames(first.rest + 'o"}\n\n')
    expect(second.frames).toHaveLength(1)
    expect(second.frames[0].data).toBe('{"content":"two"}')
    expect(second.rest).toBe('')
  })

  it('skips blocks that carry no data', () => {
    const { frames } = splitSseFrames('event: ping\n\n' + frame('delta', { content: 'x' }))
    expect(frames).toHaveLength(1)
  })

  it('does not mutate or rescan the buffer', () => {
    const buf = frame('a', { n: 1 }) + frame('b', { n: 2 }) + 'partial'
    const { frames, rest } = splitSseFrames(buf)
    expect(frames.map((f) => f.event)).toEqual(['a', 'b'])
    expect(rest).toBe('partial')
  })
})
