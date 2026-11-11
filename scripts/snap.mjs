#!/usr/bin/env node
/**
 * Visual snapshots: renders any vehicle from any projection into PNGs.
 *   npm run snap                                  # all views of the default car
 *   npm run snap -- --views=iso,top,cockpit --t=2 --beams --w=1600 --h=900
 *   npm run snap -- --vehicle=k1-sedan --kick=0,0,-8,0   # deform, then shoot
 *   npm run snap -- --drive=throttle:1,steer:0.6 --drive-t=2   # drive a scenario, then shoot
 *   npm run snap -- --url=http://localhost:5173   # use an already running server
 * Output: snapshots/<vehicle>-<view>[-beams].png
 */
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const ALL = ['front', 'back', 'left', 'right', 'top', 'iso', 'iso-rear', 'cockpit', 'chase']
const { values: a } = parseArgs({
  options: {
    vehicle: { type: 'string', default: 'k1-sedan' },
    views: { type: 'string', default: ALL.join(',') },
    t: { type: 'string', default: '1.5' },
    w: { type: 'string', default: '1280' },
    h: { type: 'string', default: '720' },
    beams: { type: 'boolean', default: false },
    kick: { type: 'string', multiple: true, default: [] },
    after: { type: 'string', default: '1' },
    drive: { type: 'string' },
    'drive-t': { type: 'string', default: '2' },
    tag: { type: 'string', default: '' },
    out: { type: 'string', default: 'snapshots' },
    url: { type: 'string' },
  },
})

const outDir = resolve(a.out)
await mkdir(outDir, { recursive: true })

let server
let base = a.url
if (!base) {
  const { createServer } = await import('vite')
  server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
  await server.listen()
  base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5173/'
}

// Headless WebGL via SwiftShader (works in CI without a GPU).
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH) ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: Number(a.w), height: Number(a.h) }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.error('[page]', e.message))
page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()))

const q = new URLSearchParams({ snap: '', vehicle: a.vehicle, view: 'iso', t: a.t, w: a.w, h: a.h, beams: a.beams ? '1' : '0' })
await page.goto(new URL(`?${q}`, base).toString())
await page.waitForFunction(() => document.documentElement.dataset.snap === 'ready', null, { timeout: 60_000 })

for (const k of a.kick) {
  const [node, vx, vy, vz] = k.split(',').map(Number)
  await page.evaluate(([n, x, y, z]) => window.__kuzov.kick(n, x, y, z), [node, vx, vy, vz])
}
if (a.kick.length) await page.evaluate((s) => window.__kuzov.simulate(s), Number(a.after))
if (a.drive) {
  const controls = Object.fromEntries(a.drive.split(',').map((kv) => kv.split(':')).map(([k, v]) => [k, Number(v)]))
  await page.evaluate(([c, s]) => window.__kuzov.drive(c, s), [controls, Number(a['drive-t'])])
}

const files = []
for (const view of a.views.split(',').map((s) => s.trim()).filter(Boolean)) {
  if (!ALL.includes(view)) throw new Error(`Unknown view ${view}`)
  await page.evaluate((v) => window.__kuzov.setView(v), view)
  const file = resolve(outDir, `${a.vehicle}-${view}${a.beams ? '-beams' : ''}${a.tag ? `-${a.tag}` : ''}.png`)
  await page.locator('#viewport').screenshot({ path: file })
  files.push(file)
}
const info = await page.evaluate(() => window.__kuzov.info())
console.info(JSON.stringify({ info, files }, null, 2))

await browser.close()
await server?.close()
