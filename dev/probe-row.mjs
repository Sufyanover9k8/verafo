/*
 * DEV-ONLY. Prints the real box model of the first two Outcomes rows so a
 * layout that "looks wrong" can be diagnosed from numbers instead of guesses.
 * Usage: node dev/probe-row.mjs [origin]
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const origin = process.argv[2] ?? 'http://localhost:5199'
const PORT = 9336

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.cwd()}\\_qa\\chrome-probe-row`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1440,900',
    'about:blank',
  ],
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
  throw new Error('no debug socket')
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})
let id = 1
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
const send = (method, params = {}, sid) => {
  const n = id++
  return new Promise((r) => {
    pending.set(n, r)
    ws.send(JSON.stringify({ id: n, method, params, ...(sid ? { sessionId: sid } : {}) }))
  })
}
const targets = await send('Target.getTargets')
const page = targets.result.targetInfos.find((t) => t.type === 'page')
const sid = (await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).result.sessionId
await send('Page.enable', {}, sid)
await send('Runtime.enable', {}, sid)
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid)
await send('Page.navigate', { url: `${origin}/orders/pending` }, sid)

for (let i = 0; i < 60; i++) {
  const r = await send(
    'Runtime.evaluate',
    { expression: `document.body?.innerText.includes('Accept') ?? false`, returnByValue: true },
    sid,
  )
  if (r.result?.result?.value) break
  await sleep(250)
}
await sleep(800)

const out = await send(
  'Runtime.evaluate',
  {
    returnByValue: true,
    expression: `(() => {
      const rows = [...document.querySelectorAll('ul > li')].filter(li => li.innerText.includes('Accept')).slice(0, 4)
      return JSON.stringify(rows.map(li => {
        const btns = [...li.querySelectorAll('button')]
        const accept = btns.find(b => b.innerText.trim().startsWith('Accept'))
        const refuse = btns.find(b => b.innerText.trim().startsWith('Refuse'))
        const wrap = li.children[0]
        const kids = [...wrap.children].map(k => Math.round(k.getBoundingClientRect().width))
        return {
          liRight: Math.round(li.getBoundingClientRect().right),
          wrapChildrenWidths: kids,
          acceptLeft: accept ? Math.round(accept.getBoundingClientRect().left) : null,
          refuseRight: refuse ? Math.round(refuse.getBoundingClientRect().right) : null,
          btnTop: accept ? Math.round(accept.getBoundingClientRect().top) : null,
        }
      }))
    })()`,
  },
  sid,
)
console.log(out.result?.result?.value ?? JSON.stringify(out))
ws.close()
chrome.kill()
