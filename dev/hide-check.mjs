/*
 * DEV-ONLY. Drives the real Orders page through the whole hide flow in headless
 * Chrome over CDP and prints what the screen says at each step: select → delete
 * → confirm → Hidden view → restore. Proves the row is flagged and recoverable
 * rather than erased.
 *
 * Usage: node dev/hide-check.mjs [origin]
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const origin = process.argv[2] ?? 'http://localhost:5199'
const PORT = 9334
const profile = `${process.cwd()}\\_qa\\chrome-profile-hide`

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
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
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}
const send = (method, params = {}, sessionId) => {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}

const targets = await send('Target.getTargets')
const page = targets.result.targetInfos.find((t) => t.type === 'page')
const sid = (await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).result.sessionId
await send('Page.enable', {}, sid)
await send('Runtime.enable', {}, sid)
await send('Page.navigate', { url: `${origin}/orders` }, sid)

async function evaluate(expression) {  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid)
  if (r.result?.exceptionDetails) {
    return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text }
  }
  return { value: r.result?.result?.value }
}

async function waitFor(expr, label, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const r = await evaluate(expr)
    if (r.error) console.log('probe error:', r.error)
    if (r.value) return true
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** Read the numbers the merchant actually sees. */
const SNAPSHOT = `JSON.stringify({
  loaded: ((document.body?.innerText ?? '').match(/Orders loaded\\n([\\d,]+)/) || [])[1] ?? null,
  showing: ((document.body?.innerText ?? '').match(/Showing ([\\d,]+) of ([\\d,]+) loaded/) || []).slice(1),
  hiddenButton: [...document.querySelectorAll('button')].map(b => b.innerText.trim())
    .find(t => /^Hidden|^Back to orders|^Restore/.test(t)) ?? null,
  selectedBar: ((document.body?.innerText ?? '').match(/(\\d+) selected/) || [])[1] ?? null,
  dialog: document.querySelector('[role="dialog"]')?.innerText.slice(0, 220) ?? null,
  dialogButtons: [...document.querySelectorAll('[role="dialog"] button')].map(b => b.innerText.trim()),
  banner: (document.body?.innerText ?? '').includes('Hidden, not deleted.'),
  rows: document.querySelectorAll('[aria-label^="Select order"]').length,
  restoreButtons: [...document.querySelectorAll('button')].filter(b => b.innerText.trim() === 'Restore').length,
  toast: (document.body?.innerText ?? '').match(/(\\d+) orders? hidden|(\\d+) orders? restored/)?.[0] ?? null,
})`

async function shoot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' }, sid)
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync('_qa', { recursive: true })
  writeFileSync(`_qa/hide-${name}.png`, Buffer.from(r.result.data, 'base64'))
}

await waitFor(`(document.body?.innerText ?? '').includes('Orders loaded')`, 'the orders list', 80)
const first = await evaluate(SNAPSHOT)
if (first.error) {
  console.log('snapshot error:', first.error)
  console.log('url:', (await evaluate('location.href')).value)
}
const before = first.value ? JSON.parse(first.value) : {}
console.log('1. before      ', JSON.stringify(before))

// Enter the mode first: the tick boxes do not exist until it is on.
await evaluate(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Delete orders').click()`)
await sleep(500)
await shoot('1-mode')

// Tick the first row.
await evaluate(`document.querySelector('[aria-label^="Select order"]').click()`)
await sleep(400)
const selected = JSON.parse((await evaluate(SNAPSHOT)).value)
console.log('2. selected    ', JSON.stringify({ selectedBar: selected.selectedBar }))
await shoot('2-selected')

// Delete → confirm dialog.
await evaluate(
  `[...document.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('Delete')).click()`,
)
await sleep(500)
const dialog = JSON.parse((await evaluate(SNAPSHOT)).value)
console.log('3. dialog      ', JSON.stringify({ dialog: dialog.dialog }))
await shoot('3-dialog')

await evaluate(
  `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.innerText.trim().startsWith('Delete')).click()`,
)
await sleep(1500)
const afterHide = JSON.parse((await evaluate(SNAPSHOT)).value)
console.log('4. after hide  ', JSON.stringify(afterHide))

// The Hidden view: the row must be there, with a Restore button.
await evaluate(
  `[...document.querySelectorAll('button')].find(b => /^(Hidden|Hidden \\(|Back to orders)/.test(b.innerText.trim())).click()`,
)
await sleep(1200)
const hiddenView = JSON.parse((await evaluate(SNAPSHOT)).value)
console.log('5. hidden view ', JSON.stringify(hiddenView))
await shoot('5-hidden')

await evaluate(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Restore').click()`)
await sleep(1500)
const restored = JSON.parse((await evaluate(SNAPSHOT)).value)
console.log('6. restored    ', JSON.stringify(restored))

ws.close()
chrome.kill()
