/** Composition root: builds the physics host + kernel from plugins and owns the loop. */
import { Kernel, type Plugin } from '../core/kernel.ts'
import { FixedStepLoop, rafScheduler } from '../core/loop.ts'
import type { AudioService } from '../audio/audio.ts'
import { InlineHost, WorkerHost, type PhysicsHost } from '../sim/host.ts'
import { defaultSimConfig, worldFor, type SimConfig } from '../sim/simulation.ts'
import type { Endpoint } from '../sim/protocol.ts'
import { audioPlugin, inputPlugin, renderPlugin, simPlugin, telemetryPlugin } from './plugins.ts'
import { T, type GameEvents } from './tokens.ts'

export type PhysicsMode = 'worker' | 'inline'

export interface GameOptions {
  canvas: HTMLCanvasElement
  vehicleId: string
  /** Map id and spawn point (default: proving ground, start). */
  map?: string
  spawn?: string
  audio: AudioService
  /** Default 'worker' (falls back to inline if the worker cannot start). */
  physics?: PhysicsMode
  extraPlugins?: Plugin<GameEvents>[]
}

export interface Game {
  readonly kernel: Kernel<GameEvents>
  readonly loop: FixedStepLoop
  readonly host: PhysicsHost
  start(): void
  stop(): void
  dispose(): void
}

const WORKER_START_TIMEOUT_MS = 5000

export async function createPhysicsHost(cfg: SimConfig, mode: PhysicsMode): Promise<PhysicsHost> {
  if (mode === 'inline' || typeof Worker === 'undefined') return new InlineHost(cfg)
  const worker = new Worker(new URL('../sim/physics.worker.ts', import.meta.url), { type: 'module', name: 'kuzov-physics' })
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('physics worker did not start in time')), WORKER_START_TIMEOUT_MS),
    )
    const failed = new Promise<never>((_, reject) => worker.addEventListener('error', (e) => reject(new Error(e.message))))
    return await Promise.race([
      WorkerHost.create(worker as Endpoint, cfg, { onDispose: () => worker.terminate() }),
      timeout,
      failed,
    ])
  } catch (e: unknown) {
    worker.terminate()
    console.warn('Physics worker unavailable, running inline:', e)
    return new InlineHost(cfg)
  }
}

export async function createGame(o: GameOptions): Promise<Game> {
  const cfg = defaultSimConfig(o.vehicleId, o.map ?? 'proving', o.spawn ?? 'start')
  const world = worldFor(cfg.map)
  const host = await createPhysicsHost(cfg, o.physics ?? 'worker')
  const kernel = new Kernel<GameEvents>()
  // Main loop: input smoothing + (inline) physics at the same fixed rate as the worker.
  const loop = new FixedStepLoop(
    { step: (dt) => kernel.fixedUpdate(dt), render: (a, fdt) => kernel.update(a, fdt) },
    { stepHz: cfg.stepHz, maxStepsPerFrame: 8, scheduler: rafScheduler },
  )
  kernel.provide(T.loop, loop)
  await kernel.use(
    simPlugin(host, world),
    inputPlugin(window),
    renderPlugin({ canvas: o.canvas }),
    audioPlugin(o.audio),
    telemetryPlugin(),
    ...(o.extraPlugins ?? []),
  )
  kernel.events.on('ui:pause', (p) => (loop.paused = p))
  const onResize = (): void => kernel.get(T.render).resize(innerWidth, innerHeight)
  addEventListener('resize', onResize)
  return {
    kernel,
    loop,
    host,
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose() {
      loop.stop()
      removeEventListener('resize', onResize)
      kernel.dispose()
    },
  }
}
