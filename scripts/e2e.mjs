#!/usr/bin/env node
/**
 * E2E smoke test of the real game UI (headless Chromium, SwiftShader WebGL).
 * Walks: menu → drive (throttle, camera cycle) → pause → tuning, screenshots
 * every screen into snapshots/ui-*.png and fails on any page error.
 *   npm run e2e               # dev server
 *   npm run e2e -- --preview  # against the production build (run `npm run build` first)
 *   npm run e2e -- --physics=inline   # main-thread physics instead of the worker
 *   npm run e2e -- --no-isolation     # serve without COOP/COEP → worker uses the transfer fallback
 */
import { mkdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { values: a } = parseArgs({
  options: {
    preview: { type: 'boolean', default: false },
    physics: { type: 'string', default: 'worker' },
    'no-isolation': { type: 'boolean', default: false },
    out: { type: 'string', default: 'snapshots' },
  },
})
const expectMode = a.physics === 'inline' ? 'inline · direct' : a['no-isolation'] ? 'worker · transfer' : 'worker · shared'
await mkdir(a.out, { recursive: true })

const vite = await import('vite')
// Overriding with unsafe-none disables cross-origin isolation (no SharedArrayBuffer).
const headers = a['no-isolation'] ? { 'Cross-Origin-Opener-Policy': 'unsafe-none', 'Cross-Origin-Embedder-Policy': 'unsafe-none' } : undefined
const net = { port: 0, host: '127.0.0.1', ...(headers ? { headers } : {}) }
const server = a.preview
  ? await vite.preview({ preview: net, logLevel: 'error' })
  : await (await vite.createServer({ server: net, logLevel: 'error' })).listen()
const base = server.resolvedUrls?.local[0]
if (!base) throw new Error('server did not start')

const errors = []
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

const shot = (name) => page.screenshot({ path: `${a.out}/ui-${name}.png` })
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `)
  await fn()
  console.info('ok')
}

await step('main menu', async () => {
  await page.goto(a.physics === 'inline' ? `${base}?physics=inline` : base)
  await page.getByRole('button', { name: 'Поехали' }).waitFor()
  await shot('menu')
})
await step('start driving', async () => {
  await page.getByRole('button', { name: 'Поехали' }).click()
  await page.locator('.k-hud').waitFor()
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(2500)
  const rpm = Number(await page.locator('svg[role=meter]').getAttribute('aria-valuenow'))
  const kmh = Number(await page.locator('.k-hud__speed-value').textContent())
  if (!(rpm > 2000)) throw new Error(`engine did not rev: ${rpm} rpm`)
  if (!(kmh > 15)) throw new Error(`car did not accelerate: ${kmh} km/h`)
  await page.keyboard.down('KeyD')
  await page.waitForTimeout(600)
  await page.keyboard.up('KeyD')
  await page.keyboard.up('KeyW')
  await shot('hud-chase')
  // Brake to a stop.
  await page.keyboard.down('KeyS')
  await page.waitForFunction(() => Number(document.querySelector('.k-hud__speed-value')?.textContent) < 3, null, { timeout: 15_000 })
  await page.keyboard.up('KeyS')
})
await step('camera modes', async () => {
  for (const name of ['cockpit', 'top', 'orbit']) {
    await page.keyboard.press('KeyC')
    await page.waitForTimeout(300)
    await shot(`hud-${name}`)
  }
  await page.keyboard.press('KeyC')
})
await step(`debug overlay shows physics "${expectMode}"`, async () => {
  await page.keyboard.press('F3')
  const dbg = page.locator('.k-debug')
  await dbg.waitFor()
  await page.waitForTimeout(1200) // let steps/s window fill
  const text = await dbg.textContent()
  if (!text?.includes(expectMode)) throw new Error(`expected physics "${expectMode}", overlay:\n${text}`)
  const sps = Number(/· (\d+)\/s/.exec(text)?.[1] ?? 0)
  if (sps < 60) throw new Error(`physics too slow / not running: ${sps} steps/s\n${text}`)
  await shot('debug')
})
await step('reset via R restores the car', async () => {
  await page.keyboard.press('KeyR')
  await page.waitForTimeout(200)
})
await step('tuning panel', async () => {
  await page.keyboard.press('KeyT')
  await page.locator('.k-tuning').waitFor()
  await page.getByRole('tab', { name: 'Двигатель' }).click()
  await shot('tuning')
  await page.keyboard.press('KeyT')
  await page.locator('.k-tuning').waitFor({ state: 'detached' })
})
await step('drive keys work after touching a tuning slider (focus regression)', async () => {
  await page.keyboard.press('KeyT')
  await page.locator('.k-tuning').waitFor()
  await page.locator('.k-tuning .k-slider__input').first().click()
  await page.keyboard.press('KeyT') // must close the panel even with the slider focused
  await page.locator('.k-tuning').waitFor({ state: 'detached' })
  await page.keyboard.press('KeyR')
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(2000)
  const kmh = Number(await page.locator('.k-hud__speed-value').textContent())
  await page.keyboard.up('KeyW')
  if (!(kmh > 10)) throw new Error(`car does not drive after using a slider: ${kmh} km/h`)
})
await step('pause menu', async () => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Продолжить/ }).waitFor()
  await shot('pause')
  await page.getByRole('button', { name: /Продолжить/ }).click()
  await page.locator('.k-scrim').waitFor({ state: 'detached' })
})

await browser.close()
await (server.close?.() ?? server.httpServer?.close())
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'))
  process.exit(1)
}
console.info('e2e: all steps passed')
