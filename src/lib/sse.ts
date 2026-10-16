/**
 * Helpers for reading the `verafo-ai` event stream.
 *
 * Both are pure functions of their arguments on purpose. The answer buffer used
 * to be accumulated inside a React state updater, which React is allowed to
 * invoke more than once — twice under StrictMode, and again whenever a
 * concurrent render is discarded. Every delta was therefore appended several
 * times and the saved answer came out with its chunks interleaved and
 * duplicated. Keeping the arithmetic here means it can be tested directly.
 */

/** The largest answer the client will hold, matching the old `slice(-200_000)`. */
export const ANSWER_LIMIT = 200_000

/** Add one streamed delta. Call once per `delta` frame, never from an updater. */
export function appendDelta(buffer: string, delta: string): string {
  if (!delta) return buffer
  return `${buffer}${delta}`.slice(-ANSWER_LIMIT)
}

export interface SseFrame {
  event: string
  data: string
}

/**
 * Pull every complete `\n\n`-terminated frame off the front of `buffer`.
 *
 * Returns the frames plus whatever is left over: a chunk boundary can land in
 * the middle of a frame, so the tail has to survive to the next read.
 */
export function splitSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = []
  let rest = buffer
  for (;;) {
    const sep = rest.indexOf('\n\n')
    if (sep < 0) break
    const block = rest.slice(0, sep)
    rest = rest.slice(sep + 2)
    const frame = parseSseFrame(block)
    if (frame) frames.push(frame)
  }
  return { frames, rest }
}

/** Parse one frame block. Returns null when it carries no data. */
export function parseSseFrame(block: string): SseFrame | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}
