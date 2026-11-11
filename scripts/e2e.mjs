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
  await page.getByRole('radio', { name: 'Механика' }).click()
  await page.getByText('заглохнешь').waitFor()
  await page.getByRole('radio', { name: 'Автомат' }).click()
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
  for (const name of ['cockpit', 'top', 'free']) {
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
await step('free camera: mouse drag rotates, wheel zooms', async () => {
  const canvas = page.locator('#viewport')
  const box = await canvas.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 250, cy - 120, { steps: 8 })
  await page.mouse.up()
  await page.locator('.k-chip', { hasText: 'Свободная' }).waitFor()
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(400)
  await shot('camera-free')
  await page.mouse.wheel(0, -900)
  await page.waitForTimeout(400)
  await shot('camera-free-zoom')
  while (!(await page.locator('.k-chip', { hasText: 'Сзади' }).count())) {
    await page.keyboard.press('KeyC')
    await page.waitForTimeout(250)
  }
})
await step('manual gearbox: choose in pause, pull away in 4th → stall, starter, proper launch', async () => {
  await page.keyboard.press('Escape')
  await page.getByRole('radio', { name: 'Механика' }).click()
  await page.getByRole('button', { name: /Продолжить/ }).click()
  await page.locator('.k-scrim').waitFor({ state: 'detached' })
  await page.keyboard.press('KeyR') // manual → neutral after reset
  await page.waitForFunction(() => document.querySelector('svg[role=meter] .k-gauge__center')?.textContent === 'N', null, {
    timeout: 5000,
  })
  // Gear without clutch → grind warning.
  await page.keyboard.press('KeyE')
  await page.locator('.k-alert--warn').waitFor()
  // Clutch down, straight into 4th, let the clutch out with no throttle → stall.
  // (The keyboard clutch releases over ~0.9 s, like a careful foot, so 1st at
  // idle may pull away — a high gear cannot.)
  await page.keyboard.down('ShiftLeft')
  await page.waitForTimeout(400)
  for (let g = 0; g < 4; g++) {
    await page.keyboard.press('KeyE')
    await page.waitForTimeout(250)
  }
  await page.keyboard.up('ShiftLeft')
  await page.locator('.k-alert--danger').waitFor({ timeout: 10_000 })
  await shot('manual-stalled')
  // Clutch down, back to neutral, crank with I until it runs.
  await page.keyboard.down('ShiftLeft')
  await page.waitForTimeout(300)
  for (let g = 0; g < 4; g++) {
    await page.keyboard.press('KeyQ')
    await page.waitForTimeout(150)
  }
  await page.keyboard.down('KeyI')
  await page.locator('.k-alert--danger').waitFor({ state: 'detached', timeout: 10_000 })
  await page.keyboard.up('KeyI')
  // Proper launch: 1st, throttle, let the clutch pedal travel up slowly.
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(300)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(300)
  await page.keyboard.up('ShiftLeft')
  await page.waitForTimeout(3000)
  const kmh = Number(await page.locator('.k-hud__speed-value').textContent())
  const stalled = await page.locator('.k-alert--danger').count()
  await page.keyboard.up('KeyW')
  if (stalled || !(kmh > 8)) throw new Error(`manual launch failed: ${kmh} km/h, stalled=${stalled}`)
  await shot('manual-driving')
  // Back to automatic for the remaining steps.
  await page.keyboard.press('Escape')
  await page.getByRole('radio', { name: 'Автомат' }).click()
  await page.getByRole('button', { name: /Продолжить/ }).click()
  await page.locator('.k-scrim').waitFor({ state: 'detached' })
})
await step('turbo via tuning, boost meter, drift smoke + particles', async () => {
  await page.keyboard.press('KeyR')
  await page.keyboard.press('KeyT')
  await page.locator('.k-tuning').waitFor()
  await page.getByRole('tab', { name: 'Турбина' }).click()
  await page.locator('.k-tuning .k-toggle', { hasText: 'Турбина' }).click()
  await page.keyboard.press('KeyT')
  await page.locator('.k-tuning').waitFor({ state: 'detached' })
  await page.keyboard.down('KeyW')
  await page.locator('.k-chip', { hasText: 'бар' }).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(2500)
  await page.keyboard.down('KeyD')
  await page.keyboard.down('Space')
  await page.waitForTimeout(900)
  const dbg = (await page.locator('.k-debug').textContent()) ?? ''
  await shot('drift-turbo')
  await page.keyboard.up('Space')
  await page.keyboard.up('KeyD')
  await page.keyboard.up('KeyW')
  const particles = Number(/fx\s+(\d+)/.exec(dbg)?.[1] ?? 0)
  if (!(particles > 20)) throw new Error(`expected tyre smoke particles, overlay:\n${dbg}`)
  if (!/\+\d\.\d+ bar/.test(dbg)) throw new Error(`expected boost in overlay:\n${dbg}`)
})
await step('pause menu', async () => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Продолжить/ }).waitFor()
  await shot('pause')
  await page.getByRole('button', { name: /Продолжить/ }).click()
  await page.locator('.k-scrim').waitFor({ state: 'detached' })
})

await step('map points: teleport to the crash zone and hit the wall (damage in HUD)', async () => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Краш-зона' }).click()
  await page.locator('.k-scrim').waitFor({ state: 'detached' })
  await page.waitForTimeout(500)
  await page.keyboard.down('KeyW')
  await page.locator('.k-chip[title="Повреждение кузова"]', { hasNotText: /^0%$/ }).first().waitFor()
  // Keep pushing until the body shows damage (wall is ~20 m ahead).
  await page.waitForFunction(
    () => Number(document.querySelector('.k-chip[title="Повреждение кузова"]')?.textContent?.replace('%', '') ?? 0) > 0,
    null,
    { timeout: 20_000 },
  )
  await page.keyboard.up('KeyW')
  await shot('crash-zone')
})
await step('garage: switch to another car (pickup) and drive it', async () => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'В меню' }).click()
  await page.getByRole('radio', { name: /Burlak/ }).click()
  await page.getByText('Пикап · полный привод · V8').waitFor()
  await shot('garage')
  await page.getByRole('button', { name: 'Поехали' }).click()
  await page.locator('.k-hud').waitFor()
  await page.waitForTimeout(500)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(2500)
  const kmh = Number(await page.locator('.k-hud__speed-value').textContent())
  await page.keyboard.up('KeyW')
  if (!(kmh > 10)) throw new Error(`pickup did not drive: ${kmh} km/h`)
  await shot('pickup-driving')
})

await browser.close()
await (server.close?.() ?? server.httpServer?.close())
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'))
  process.exit(1)
}
console.info('e2e: all steps passed')
