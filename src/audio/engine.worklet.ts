import { EngineVoice, defaultVoiceSpec } from './dsp/engineSynth.ts'

export interface EngineWorkletOptions {
  cylinders: number
}

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'rpm', defaultValue: 850, minValue: 0, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }
  readonly #voice: EngineVoice
  readonly #p = { rpm: 850, load: 0, throttle: 0 }

  constructor(options?: AudioWorkletNodeOptions) {
    super()
    const o = options?.processorOptions as EngineWorkletOptions | undefined
    this.#voice = new EngineVoice(sampleRate, defaultVoiceSpec(o?.cylinders ?? 4))
  }

  process(_in: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean {
    const ch = outputs[0]?.[0]
    if (!ch) return true
    this.#p.rpm = params['rpm']?.[0] ?? this.#p.rpm
    this.#p.load = params['load']?.[0] ?? this.#p.load
    this.#p.throttle = params['throttle']?.[0] ?? this.#p.throttle
    this.#voice.process(ch, this.#p)
    for (let c = 1; c < (outputs[0]?.length ?? 0); c++) outputs[0]?.[c]?.set(ch)
    return true
  }
}

registerProcessor('kuzov-engine', EngineProcessor)
