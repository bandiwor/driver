/** Composition root: builds the kernel from plugins and owns the loop. */
import { Kernel, type Plugin } from '../core/kernel.ts'
import { FixedStepLoop, rafScheduler } from '../core/loop.ts'
import type { AudioService } from '../audio/audio.ts'
import { audioPlugin, inputPlugin, physicsPlugin, renderPlugin, telemetryPlugin, vehiclePlugin } from './plugins.ts'
import { T, type GameEvents } from './tokens.ts'

export interface GameOptions {
  canvas: HTMLCanvasElement
  vehicleId: string
  audio: AudioService
  /** Fixed game step rate; physics substeps on top of it. */
  stepHz?: number
  extraPlugins?: Plugin<GameEvents>[]
}

export interface Game {
  readonly kernel: Kernel<GameEvents>
  readonly loop: FixedStepLoop
  start(): void
  stop(): void
  dispose(): void
}

export async function createGame(o: GameOptions): Promise<Game> {
  const kernel = new Kernel<GameEvents>()
  const loop = new FixedStepLoop(
    { step: (dt) => kernel.fixedUpdate(dt), render: (a, fdt) => kernel.update(a, fdt) },
    { stepHz: o.stepHz ?? 120, maxStepsPerFrame: 8, scheduler: rafScheduler },
  )
  kernel.provide(T.loop, loop)
  await kernel.use(
    physicsPlugin(),
    vehiclePlugin(o.vehicleId),
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
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose() {
      loop.stop()
      removeEventListener('resize', onResize)
      kernel.dispose()
    },
  }
}
