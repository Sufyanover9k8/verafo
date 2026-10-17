/* DEV-ONLY: reports computed styles for a selector, to check a suspected rule. */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const origin = process.argv[2]
const route = process.argv[3]
const selector = process.argv[4]
const PORT = 9334
mkdirSync('_qa/chrome2', { recursive: true })
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.cwd()}\\_qa\\chrome2`, '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore' },
)
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
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
const r = await send(
  'Runtime.evaluate',
  {
    expression: `(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})].slice(0, 3)
      return JSON.stringify(els.map((el) => {
        const cs = getComputedStyle(el)
        return { cls: String(el.className).slice(0, 120), border: cs.border, borderColor: cs.borderColor, borderWidth: cs.borderWidth, bg: cs.backgroundColor, outline: cs.outline }
      }), null, 2)
    })()`,
    returnByValue: true,
  },
  sid,
)
console.log(r.result?.result?.value ?? JSON.stringify(r.result))
ws.close()
chrome.kill()
