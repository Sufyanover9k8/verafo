// DEV-ONLY: serves the real app with src/lib/supabase.ts swapped for a mock
// (dev/mock/supabase.ts) so the signed-in screens can be previewed without a
// login, plus a stand-in `verafo-ai` endpoint so every state of Ask Verafo —
// streaming, cut short, hard failure, expired session — can be rendered.
// Not used by `npm run build` or by Vercel.
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, mergeConfig, type Plugin, type Connect } from 'vite'
import base from './vite.config'

const mockPath = fileURLToPath(new URL('./dev/mock/supabase.ts', import.meta.url))

const mockSupabase = (): Plugin => ({
  name: 'verafo-mock-supabase',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!/(^|\/)supabase(\.ts)?$/.test(source)) return null
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
    if (resolved && /src[\\/]lib[\\/]supabase\.ts$/.test(resolved.id)) return mockPath
    return null
  },
})

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

const ANSWER =
  'Karachi carries most of the refusal risk.\n\n' +
  '- Karachi - 9 refusals across 29 orders (31%)\n' +
  '- Lahore - 4 refusals across 22 orders (18%)\n' +
  '- Multan - 3 refusals across 11 orders (27%)\n\n' +
  'Footwear is your most-refused category, so the two effects stack. Consider a ' +
  'confirmation call before dispatch on Karachi footwear orders above 3,500 PKR.'

/**
 * A stand-in for the deployed function. `?ai=` picks the behaviour:
 *   ok      stream a normal answer
 *   mid     stream half an answer, then an error frame
 *   boom    500 with a JSON error
 *   boom1   the same, but only for the first request — retry then succeeds
 *   auth    401, as an expired session produces
 *   empty   200 with a stream that ends without an answer
 */
const fakeAi = (): Plugin => ({
  name: 'verafo-fake-ai',
  configureServer(server) {
    let failedOnce = false
    const handler: Connect.NextHandleFunction = async (req, res, next) => {
      if (!req.url?.includes('/verafo-ai')) return next()
      let body = ''
      for await (const chunk of req) body += chunk
      let payload: { action?: string } = {}
      try {
        payload = JSON.parse(body)
      } catch {
        /* ignore */
      }
      const mode = (() => {
        try {
          return new URL(req.headers.referer ?? '').searchParams.get('ai') ?? 'ok'
        } catch {
          return 'ok'
        }
      })()
      /*
       * `boom1` fails only the first chat request of the session, so the retry
       * path can be shown actually recovering rather than failing again.
       */
      const failing = mode === 'boom' || (mode === 'boom1' && !failedOnce && payload.action === 'chat')
      if (failing && payload.action === 'chat') failedOnce = true

      if (failing) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'model provider returned 502' }))
        return
      }
      if (mode === 'auth') {
        res.statusCode = 401
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'JWT expired' }))
        return
      }
      if (payload.action !== 'chat') {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, suggestions: ['Which cities refuse most?', 'Top buyers by spend'] }))
        return
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

      res.write(frame('phase', { phase: 'understanding', label: 'Understanding your question' }))
      await wait(350)
      res.write(frame('phase', { phase: 'researching', label: 'Researching your data' }))
      res.write(frame('tool_call', { name: 'city_refusals', args: 'city=Karachi', label: 'Checking buyers in Karachi' }))
      await wait(500)
      res.write(frame('tool_result', { name: 'city_refusals', summary: '29 orders' }))
      res.write(frame('phase', { phase: 'writing', label: 'Writing your answer' }))
      await wait(300)

      const text = mode === 'mid' ? ANSWER.slice(0, 120) : mode === 'empty' ? '' : ANSWER
      for (const piece of text.match(/[\s\S]{1,18}/g) ?? []) {
        res.write(frame('delta', { content: piece }))
        await wait(45)
      }
      if (mode === 'mid') {
        res.write(frame('error', { message: 'connection to the model provider was lost' }))
        res.end()
        return
      }
      /*
       * No `message_id`: the preview has no server-side store, so omitting it
       * makes the client save the streamed answer itself — which is also the
       * fallback path worth seeing, and the only way the answer survives the
       * reload that follows a turn here.
       */
      res.write(frame('done', {}))
      res.end()
    }
    server.middlewares.use(handler)
  },
})

export default mergeConfig(
  base,
  defineConfig({
    plugins: [mockSupabase(), fakeAi()],
    define: { 'import.meta.env.VITE_ADMIN_EMAILS': JSON.stringify('demo@verafo.dev') },
  }),
)
