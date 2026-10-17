/*
 * DEV-ONLY: navigates, optionally types and sends a message, then evaluates an
 * arbitrary expression against the page and prints the result.
 * Usage: node dev/eval.mjs <origin> <route> <expression-file>
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const [origin, route, exprFile] = process.argv.slice(2)
const PORT = 9335
mkdirSync('_qa/chrome3', { recursive: true })
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.cwd()}\\_qa\\chrome3`, '--no-first-run', '--disable-gpu', '--window-size=1440,1000', 'about:blank'],
  { stdio: 'ignore' },
)
async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('no socket')
}
const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)))
let id = 1
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id))
}
const send = (method, params = {}, sessionId) =>
  new Promise((r) => (pending.set(id, r), ws.send(JSON.stringify({ id: id++, method, params, ...(sessionId ? { sessionId } : {}) }))))

const t = await send('Target.getTargets')
const page = t.result.targetInfos.find((x) => x.type === 'page')
const sid = (await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).result.sessionId
await send('Page.enable', {}, sid)
await send('Runtime.enable', {}, sid)
await send('Page.navigate', { url: origin + route }, sid)
await sleep(7000)

if (process.env.SEND_TEXT) {
  await send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const ta = document.querySelector('textarea[aria-label="Message Verafo"]')
        if (!ta) return 'no textarea'
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, ${JSON.stringify(process.env.SEND_TEXT)})
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        return 'typed'
      })()`,
      returnByValue: true,
    },
    sid,
  )
  await sleep(400)
  await send(
    'Runtime.evaluate',
    { expression: `document.querySelector('button[aria-label="Send message"]')?.click()`, returnByValue: true },
    sid,
  )
  await sleep(Number(process.env.SETTLE_MS ?? 6000))
}

const out = await send(
  'Runtime.evaluate',
  { expression: readFileSync(exprFile, 'utf8'), returnByValue: true, awaitPromise: true },
  sid,
)
console.log(typeof out.result?.result?.value === 'string' ? out.result.result.value : JSON.stringify(out.result, null, 2))
ws.close()
chrome.kill()
