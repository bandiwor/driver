#!/usr/bin/env node
/**
 * Visual snapshots: renders any vehicle from any projection into PNGs.
 *   npm run snap                                  # all views of the default car
 *   npm run snap -- --views=iso,top,cockpit --t=2 --beams --w=1600 --h=900
 *   npm run snap -- --vehicle=k1-sedan --kick=0,0,-8,0   # deform, then shoot
 *   npm run snap -- --drive=throttle:1,steer:0.6 --drive-t=2   # drive a scenario, then shoot
 *   npm run snap -- --param=turbo.enabled:1,fuel.lambda:0.72 \
 *        --drive=throttle:1@3 --drive=throttle:0@0.25           # chained steps "controls@seconds"
 *   npm run snap -- --map=proving --spawn=crash --views=map,iso   # any map / spawn point
 *   npm run snap -- --map=proving --spawn=crash --launch=70 --drive=brake:0@1.5 --beams  # crash test
 *   npm run snap -- --url=http://localhost:5173   # use an already running server
 * Output: snapshots/<vehicle>-<view>[-beams].png
 */
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const ALL = ['front', 'back', 'left', 'right', 'top', 'iso', 'iso-rear', 'cockpit', 'chase', 'map']
const { values: a } = parseArgs({
  options: {
    vehicle: { type: 'string', default: 'k1-sedan' },
    map: { type: 'string', default: 'flat' },
    spawn: { type: 'string', default: 'start' },
    views: { type: 'string', default: ALL.join(',') },
    t: { type: 'string', default: '1.5' },
    w: { type: 'string', default: '1280' },
    h: { type: 'string', default: '720' },
    beams: { type: 'boolean', default: false },
    kick: { type: 'string', multiple: true, default: [] },
    after: { type: 'string', default: '1' },
    drive: { type: 'string', multiple: true, default: [] },
    param: { type: 'string' },
    launch: { type: 'string' },
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

const q = new URLSearchParams({ snap: '', vehicle: a.vehicle, map: a.map, spawn: a.spawn, view: 'iso', t: a.t, w: a.w, h: a.h, beams: a.beams ? '1' : '0' })
await page.goto(new URL(`?${q}`, base).toString())
await page.waitForFunction(() => document.documentElement.dataset.snap === 'ready', null, { timeout: 60_000 })

for (const k of a.kick) {
  const [node, vx, vy, vz] = k.split(',').map(Number)
  await page.evaluate(([n, x, y, z]) => window.__kuzov.kick(n, x, y, z), [node, vx, vy, vz])
}
if (a.kick.length) await page.evaluate((s) => window.__kuzov.simulate(s), Number(a.after))
const kv = (s) => Object.fromEntries(s.split(',').filter(Boolean).map((p) => p.split(':')).map(([k, v]) => [k, Number(v)]))
if (a.param) {
  for (const [id, v] of Object.entries(kv(a.param))) await page.evaluate(([i, x]) => window.__kuzov.setParam(i, x), [id, v])
}
if (a.launch) await page.evaluate((k) => window.__kuzov.launch(k), Number(a.launch))
for (const step of a.drive) {
  const [controls, secs] = step.split('@')
  await page.evaluate(([c, s]) => window.__kuzov.drive(c, s), [kv(controls), Number(secs ?? a['drive-t'])])
}

const files = []
for (const view of a.views.split(',').map((s) => s.trim()).filter(Boolean)) {
  if (!ALL.includes(view)) throw new Error(`Unknown view ${view}`)
  await page.evaluate((v) => window.__kuzov.setView(v), view)
  const prefix = a.map === 'flat' ? a.vehicle : `${a.map}-${a.spawn}-${a.vehicle}`
  const file = resolve(outDir, `${prefix}-${view}${a.beams ? '-beams' : ''}${a.tag ? `-${a.tag}` : ''}.png`)
  await page.locator('#viewport').screenshot({ path: file })
  files.push(file)
}
const info = await page.evaluate(() => window.__kuzov.info())
console.info(JSON.stringify({ info, files }, null, 2))

await browser.close()
await server?.close()
