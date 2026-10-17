/*
 * DEV-ONLY visual check. Drives the real app in headless Chrome over CDP:
 * loads a route at a viewport, waits for paint, then reports console errors,
 * failed requests, page overflow and any elements that stick out sideways.
 *
 * Usage: node dev/shoot.mjs <origin> <routes...>
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const origin = process.argv[2] ?? 'http://localhost:5199'
const routes = process.argv.slice(3)
if (routes.length === 0) routes.push('/chat')

const PORT = 9333
const profile = `${process.cwd()}\\_qa\\chrome-profile`
mkdirSync(profile, { recursive: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      const j = await r.json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('Chrome did not expose a debugging socket')
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let nextId = 1
const pending = new Map()
const events = []
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  } else if (msg.method) {
    events.push(msg)
  }
}
function send(method, params = {}, sessionId) {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}

const targets = await send('Target.getTargets')
const page = targets.result.targetInfos.find((t) => t.type === 'page')
const attach = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
const sid = attach.result.sessionId

await send('Page.enable', {}, sid)
await send('Runtime.enable', {}, sid)
await send('Log.enable', {}, sid)
await send('Network.enable', {}, sid)

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'narrow', width: 900, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]

const PROBE = `(() => {
  const de = document.documentElement
  const overflow = de.scrollWidth - de.clientWidth
  const wide = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > de.clientWidth + 2 || r.left < -2) {
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed') continue
      wide.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 70) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']')
    }
  }
  const text = document.body.innerText
  return JSON.stringify({
    overflow,
    wide: wide.slice(0, 8),
    bytes: text.length,
    hasStarter: /What you can ask|Ask Verafo about your own orders/.test(text),
    hasRail: /Conversations/.test(text),
    hasFailureCard: /Not answered|Try again|Answer stopped|cut short/.test(text),
    headings: [...document.querySelectorAll('h1,h2')].map((h) => h.innerText.trim()).slice(0, 6),
    excerpt: text.slice(0, 700),
    tail: text.slice(-500),
    // Raw, layout-independent text of the last answer bubble. Comparing it with
    // innerText separates DOM duplication from a paint/layout problem.
    answerRaw: (() => {
      const hit = [...document.querySelectorAll('div,p,span')]
        .filter((el) => el.textContent && el.textContent.includes('Karachi carries'))
        .sort((a, b) => a.textContent.length - b.textContent.length)[0]
      return hit ? hit.textContent.slice(0, 400) : null
    })(),
  })
})()`

const report = []
// Warm-up navigation: the first load in a fresh profile pays for the whole
// module graph, and without this the first measurement lands on a blank page.
await send('Page.navigate', { url: origin + routes[0] }, sid)
await sleep(7000)
for (const vp of VIEWPORTS) {
  for (const route of routes) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.name === 'phone' }, sid)
    events.length = 0
    await send('Page.navigate', { url: origin + route }, sid)
    // Wait for the lazy route chunk to actually paint something, rather than
    // guessing at a fixed delay.
    for (let i = 0; i < 40; i++) {
      await sleep(250)
      const ready = await send(
        'Runtime.evaluate',
        {
          expression:
            "document.body.innerText.includes('Toggle Sidebar') && document.body.innerText.trim().length > 300 ? 1 : 0",
          returnByValue: true,
        },
        sid,
      )
      if ((ready.result?.result?.value ?? 0) === 1) break
    }
    await sleep(900)
    if (process.env.SEND_TEXT) {
      // Type into the composer the way React expects, then press Send.
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
      const clicked = await send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const b = document.querySelector('button[aria-label="Send message"]')
            if (!b) return 'no send button'
            b.click()
            return 'sent'
          })()`,
          returnByValue: true,
        },
        sid,
      )
      console.log('send:', clicked.result?.result?.value)
      await sleep(4500)
    }
    if (process.env.CLICK_SELECTOR) {
      await send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(process.env.CLICK_SELECTOR)})
            if (el) {
              // Radix opens menus on pointerdown, not click.
              el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }))
              el.click()
            }
            return Boolean(el)
          })()`,
          returnByValue: true,
        },
        sid,
      )
      await sleep(900)
    }
    if (process.env.CLICK_TEXT) {
      await send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const want = ${JSON.stringify(process.env.CLICK_TEXT)}
            const el = [...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith(want))
            if (el) el.click()
            return Boolean(el)
          })()`,
          returnByValue: true,
        },
        sid,
      )
      await sleep(900)
    }
    const res = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true }, sid)
    const value = res.result?.result?.value
    const consoleErrors = events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .map((e) => e.params.args.map((a) => a.value ?? a.description).join(' '))
    const pageErrors = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text)
    const failed = events.filter((e) => e.method === 'Network.loadingFailed').map((e) => `${e.params.type} ${e.params.errorText}`)
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sid)
    mkdirSync('_qa', { recursive: true })
    const file = `_qa/chat-${vp.name}-${route.replace(/\W+/g, '_')}.png`
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
    report.push({ vp: vp.name, route, file, parsed: JSON.parse(value), consoleErrors, pageErrors, failed })
  }
}

console.log(JSON.stringify(report, null, 2))
ws.close()
chrome.kill()
