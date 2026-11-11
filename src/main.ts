/**
 * Entry: `?snap` → deterministic snapshot mode, otherwise the game UI.
 * `?physics=inline` forces main-thread physics (default: Web Worker).
 */
import './ui/styles/base.css'

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')
const uiRoot = document.querySelector<HTMLDivElement>('#ui')
if (!canvas || !uiRoot) throw new Error('index.html is missing #viewport / #ui')
canvas.tabIndex = 0

const q = new URLSearchParams(location.search)
if (q.has('snap')) {
  const { parseSnapshotParams, runSnapshot } = await import('./devtools/snapshot.ts')
  await runSnapshot(canvas, parseSnapshotParams(q))
} else {
  const [{ render, h }, { App }] = await Promise.all([import('preact'), import('./ui/App.tsx')])
  render(h(App, { canvas, vehicleId: q.get('vehicle') ?? 'k1-sedan', physics: q.get('physics') === 'inline' ? 'inline' : 'worker' }), uiRoot)
}
