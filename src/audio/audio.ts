/**
 * Audio service. Web Audio graph:
 *   engine worklet ─┐
 *   tyre/impact ────┼─> bus ─> compressor ─> master ─> destination
 *   wind ───────────┘
 * AudioContext is created lazily on first user gesture (autoplay policy).
 * `NullAudio` is used in tests/snapshots.
 */
import workletUrl from './engine.worklet.ts?worker&url'
import { renderBlowOff, renderFlutter, renderPop } from './dsp/oneshots.ts'
import type { EngineVoiceSpec } from './dsp/engineSynth.ts'

export interface EngineSoundInput {
  rpm: number
  load: number
  throttle: number
}

export interface AudioService {
  readonly ready: boolean
  init(): Promise<void>
  setEngine(i: EngineSoundInput): void
  /** Turbo whine: shaft speed 0..1 (0 = silent / not fitted), boost bar. */
  setTurbo(spin: number, boost: number): void
  /** Tyre squeal intensity 0..1 (strongest wheel). */
  setTyres(intensity: number): void
  afterfire(strength: number): void
  /** Throttle lift with boost: vented (blow-off valve) or compressor flutter. */
  blowOff(vented: boolean): void
  setMasterVolume(v: number): void
  impact(strength: number): void
  suspend(): void
  resume(): void
  /** Release the audio graph (switching vehicles creates a new service). */
  dispose(): void
}

export class NullAudio implements AudioService {
  readonly ready = false
  async init(): Promise<void> {}
  setEngine(): void {}
  setTurbo(): void {}
  setTyres(): void {}
  afterfire(): void {}
  blowOff(): void {}
  setMasterVolume(): void {}
  impact(): void {}
  suspend(): void {}
  resume(): void {}
  dispose(): void {}
}

export class WebAudio implements AudioService {
  #ctx: AudioContext | null = null
  #engine: AudioWorkletNode | null = null
  #master: GainNode | null = null
  #bus: GainNode | null = null
  #noise: AudioBuffer | null = null
  #pops: AudioBuffer[] = []
  #bov: AudioBuffer | null = null
  #flutter: AudioBuffer | null = null
  #turboOsc: OscillatorNode | null = null
  #turboGain: GainNode | null = null
  #tyreFilter: BiquadFilterNode | null = null
  #tyreGain: GainNode | null = null
  #volume = 0.7

  constructor(readonly voice: EngineVoiceSpec) {}

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
      processorOptions: { voice: this.voice },
    })
    engine.connect(bus)
    this.#engine = engine
    this.#master = master
    this.#bus = bus
    this.#noise = makeNoise(ctx, 1)
    const toBuffer = (data: Float32Array<ArrayBuffer>): AudioBuffer => {
      const b = ctx.createBuffer(1, data.length, ctx.sampleRate)
      b.copyToChannel(data, 0)
      return b
    }
    this.#pops = [1, 2, 3, 4].map((seed) => toBuffer(renderPop(ctx.sampleRate, seed)))
    this.#bov = toBuffer(renderBlowOff(ctx.sampleRate))
    this.#flutter = toBuffer(renderFlutter(ctx.sampleRate))
    // Turbo whine: a sine + its 2nd harmonic, gain/pitch follow shaft speed.
    const tg = new GainNode(ctx, { gain: 0 })
    const osc = new OscillatorNode(ctx, { type: 'triangle', frequency: 800 })
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 3000, Q: 0.7 })
    osc.connect(bp).connect(tg).connect(bus)
    osc.start()
    this.#turboOsc = osc
    this.#turboGain = tg
    // Tyre squeal: looped noise through a resonant band-pass.
    const tyreSrc = new AudioBufferSourceNode(ctx, { buffer: this.#noise, loop: true })
    const tf = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1050, Q: 7 })
    const tyg = new GainNode(ctx, { gain: 0 })
    tyreSrc.connect(tf).connect(tyg).connect(bus)
    tyreSrc.start()
    this.#tyreFilter = tf
    this.#tyreGain = tyg
  }

  setTurbo(spin: number, boost: number): void {
    const ctx = this.#ctx
    if (!ctx || !this.#turboOsc || !this.#turboGain) return
    const t = ctx.currentTime
    this.#turboOsc.frequency.setTargetAtTime(700 + 7800 * spin, t, 0.03)
    this.#turboGain.gain.setTargetAtTime(spin * spin * (0.05 + 0.08 * Math.min(1, boost)), t, 0.05)
  }

  setTyres(intensity: number): void {
    const ctx = this.#ctx
    if (!ctx || !this.#tyreGain || !this.#tyreFilter) return
    const t = ctx.currentTime
    const k = Math.min(1, Math.max(0, intensity))
    this.#tyreGain.gain.setTargetAtTime(k * k * 0.5, t, 0.04)
    this.#tyreFilter.frequency.setTargetAtTime(900 + 500 * k, t, 0.08)
  }

  afterfire(strength: number): void {
    const ctx = this.#ctx
    const bus = this.#bus
    const buf = this.#pops[Math.floor(Math.random() * this.#pops.length)]
    if (!ctx || !bus || !buf) return
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: 0.8 + Math.random() * 0.45 })
    const g = new GainNode(ctx, { gain: 0.35 + 0.65 * Math.min(1, strength) })
    src.connect(g).connect(bus)
    src.start()
  }

  blowOff(vented: boolean): void {
    const ctx = this.#ctx
    const bus = this.#bus
    const buf = vented ? this.#bov : this.#flutter
    if (!ctx || !bus || !buf) return
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: 0.9 + Math.random() * 0.2 })
    const g = new GainNode(ctx, { gain: vented ? 0.5 : 0.45 })
    src.connect(g).connect(bus)
    src.start()
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

  dispose(): void {
    void this.#ctx?.close()
    this.#ctx = null
    this.#engine = null
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
