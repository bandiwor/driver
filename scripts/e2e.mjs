#!/usr/bin/env node
/**
 * E2E smoke test of the real game UI (headless Chromium, SwiftShader WebGL).
 * Walks: menu → drive (throttle, camera cycle) → pause → tuning, screenshots
 * every screen into snapshots/ui-*.png and fails on any page error.
 *   npm run e2e               # dev server
 *   npm run e2e -- --preview  # against the production build (run `npm run build` first)
 */
import { mkdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { values: a } = parseArgs({ options: { preview: { type: 'boolean', default: false }, out: { type: 'string', default: 'snapshots' } } })
await mkdir(a.out, { recursive: true })

const vite = await import('vite')
const server = a.preview
  ? await vite.preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
  : await (await vite.createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })).listen()
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
  await page.goto(base)
  await page.getByRole('button', { name: 'Поехали' }).waitFor()
  await shot('menu')
})
await step('start driving', async () => {
  await page.getByRole('button', { name: 'Поехали' }).click()
  await page.locator('.k-hud').waitFor()
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1200)
  const rpm = Number(await page.locator('svg[role=meter]').getAttribute('aria-valuenow'))
  await page.keyboard.up('KeyW')
  if (!(rpm > 2500)) throw new Error(`engine did not rev: ${rpm} rpm`)
  await shot('hud-chase')
})
await step('camera modes', async () => {
  for (const name of ['cockpit', 'top', 'orbit']) {
    await page.keyboard.press('KeyC')
    await page.waitForTimeout(300)
    await shot(`hud-${name}`)
  }
  await page.keyboard.press('KeyC')
})
await step('debug overlay', async () => {
  await page.keyboard.press('F3')
  await page.locator('.k-debug').waitFor()
})
await step('tuning panel', async () => {
  await page.keyboard.press('KeyT')
  await page.locator('.k-tuning').waitFor()
  await page.getByRole('tab', { name: 'Двигатель' }).click()
  await shot('tuning')
  await page.keyboard.press('KeyT')
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
