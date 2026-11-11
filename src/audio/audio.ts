/**
 * Audio service. Web Audio graph:
 *   engine worklet ─┐
 *   tyre/impact ────┼─> bus ─> compressor ─> master ─> destination
 *   wind ───────────┘
 * AudioContext is created lazily on first user gesture (autoplay policy).
 * `NullAudio` is used in tests/snapshots.
 */
import workletUrl from './engine.worklet.ts?worker&url'

export interface EngineSoundInput {
  rpm: number
  load: number
  throttle: number
}

export interface AudioService {
  readonly ready: boolean
  init(): Promise<void>
  setEngine(i: EngineSoundInput): void
  setMasterVolume(v: number): void
  impact(strength: number): void
  suspend(): void
  resume(): void
}

export class NullAudio implements AudioService {
  readonly ready = false
  async init(): Promise<void> {}
  setEngine(): void {}
  setMasterVolume(): void {}
  impact(): void {}
  suspend(): void {}
  resume(): void {}
}

export class WebAudio implements AudioService {
  #ctx: AudioContext | null = null
  #engine: AudioWorkletNode | null = null
  #master: GainNode | null = null
  #bus: GainNode | null = null
  #noise: AudioBuffer | null = null
  #volume = 0.7

  constructor(readonly cylinders: number) {}

  get ready(): boolean {
    return this.#engine !== null
  }

  async init(): Promise<void> {
    if (this.#ctx) return
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.#ctx = ctx
    await ctx.audioWorklet.addModule(workletUrl)
    const master = new GainNode(ctx, { gain: this.#volume })
    const comp = new DynamicsCompressorNode(ctx, { threshold: -14, ratio: 4, attack: 0.003, release: 0.15 })
    const bus = new GainNode(ctx, { gain: 1 })
    bus.connect(comp).connect(master).connect(ctx.destination)
    const engine = new AudioWorkletNode(ctx, 'kuzov-engine', {
      outputChannelCount: [2],
      processorOptions: { cylinders: this.cylinders },
    })
    engine.connect(bus)
    this.#engine = engine
    this.#master = master
    this.#bus = bus
    this.#noise = makeNoise(ctx, 1)
  }

  setEngine(i: EngineSoundInput): void {
    const e = this.#engine
    const ctx = this.#ctx
    if (!e || !ctx) return
    const t = ctx.currentTime
    e.parameters.get('rpm')?.setTargetAtTime(i.rpm, t, 0.01)
    e.parameters.get('load')?.setTargetAtTime(i.load, t, 0.02)
    e.parameters.get('throttle')?.setTargetAtTime(i.throttle, t, 0.02)
  }

  setMasterVolume(v: number): void {
    this.#volume = v
    if (this.#master && this.#ctx) this.#master.gain.setTargetAtTime(v, this.#ctx.currentTime, 0.05)
  }

  /** Crunch: filtered noise burst + low thump. Strength 0..1. */
  impact(strength: number): void {
    const ctx = this.#ctx
    const bus = this.#bus
    if (!ctx || !bus || !this.#noise || strength < 0.02) return
    const t = ctx.currentTime
    const src = new AudioBufferSourceNode(ctx, { buffer: this.#noise, playbackRate: 0.6 + Math.random() * 0.5 })
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 600 + 1800 * strength, Q: 0.8 })
    const g = new GainNode(ctx, { gain: 0 })
    g.gain.setValueAtTime(Math.min(1, strength) * 0.9, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + 0.35 * strength)
    src.connect(bp).connect(g).connect(bus)
    src.start(t)
    src.stop(t + 0.6)
  }

  suspend(): void {
    void this.#ctx?.suspend()
  }
  resume(): void {
    void this.#ctx?.resume()
  }
}

const makeNoise = (ctx: BaseAudioContext, seconds: number): AudioBuffer => {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate)
  const d = buf.getChannelData(0)
  let s = 1
  for (let i = 0; i < d.length; i++) {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    d[i] = (s >>> 0) / 2147483648 - 1
  }
  return buf
}
