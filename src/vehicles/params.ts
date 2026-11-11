/**
 * Standard tuning parameters, generated from a vehicle definition: every car
 * exposes the same knobs, but defaults are *its own* factory setup and the
 * ranges are scaled around them (a 2 t pickup and a 1 t hatch both get sane
 * spring ranges). Engine-module params (`fuel.*`, `turbo.*`, …) are emitted
 * only for modules the car actually has.
 */
import type { ParamDef } from '../core/params.ts'
import type { EngineModuleDef } from '../physics/vehicle/powerplant.ts'
import type { VehicleDef } from './types.ts'

const DEG = 180 / Math.PI
const round = (v: number, step: number): number => Math.round(v / step) * step
/** Range [lo·d, hi·d] snapped to `step`, always containing the default. */
const around = (d: number, lo: number, hi: number, step: number): { min: number; max: number } => ({
  min: Math.min(d, round(d * lo, step)),
  max: Math.max(d, round(d * hi, step)),
})
const fix = (v: number, digits = 2): number => Number(v.toFixed(digits))

export type VehicleBase = Omit<VehicleDef, 'params'>

const moduleOf = <K extends EngineModuleDef['kind']>(b: VehicleBase, kind: K): Extract<EngineModuleDef, { kind: K }> | undefined =>
  b.powerplant.find((m): m is Extract<EngineModuleDef, { kind: K }> => m.kind === kind)

export function standardParams(b: VehicleBase): ParamDef[] {
  const sf = b.suspensionFront
  const sr = b.suspensionRear
  const p: ParamDef[] = []
  const susp = (axle: 'front' | 'rear', s: typeof sf, label: string): void => {
    p.push(
      { id: `susp.${axle}.spring`, label: `Пружина ${label}`, group: 'Подвеска', step: 500, default: s.spring, unit: 'Н/м', ...around(s.spring, 0.3, 3, 500) },
      { id: `susp.${axle}.bump`, label: `Сжатие ${label}`, group: 'Подвеска', step: 100, default: s.damperBump, unit: 'Н·с/м', ...around(s.damperBump, 0.2, 3, 100) },
      { id: `susp.${axle}.rebound`, label: `Отбой ${label}`, group: 'Подвеска', step: 100, default: s.damperRebound, unit: 'Н·с/м', ...around(s.damperRebound, 0.2, 3, 100) },
    )
  }
  susp('front', sf, 'перед')
  susp('rear', sr, 'зад')
  p.push(
    { id: 'susp.front.arb', label: 'Стабилизатор перед', group: 'Подвеска', min: 0, max: Math.max(20000, round(sf.antiRoll * 3, 500)), step: 500, default: sf.antiRoll, unit: 'Н/м' },
    { id: 'susp.rear.arb', label: 'Стабилизатор зад', group: 'Подвеска', min: 0, max: Math.max(20000, round(sr.antiRoll * 3, 500)), step: 500, default: sr.antiRoll, unit: 'Н/м' },
    // Геометрия
    { id: 'align.front.camber', label: 'Развал перед', group: 'Геометрия', min: -5, max: 2, step: 0.1, default: fix(sf.camber * DEG, 1), unit: '°' },
    { id: 'align.rear.camber', label: 'Развал зад', group: 'Геометрия', min: -5, max: 2, step: 0.1, default: fix(sr.camber * DEG, 1), unit: '°' },
    { id: 'align.front.toe', label: 'Схождение перед', group: 'Геометрия', min: -1, max: 1, step: 0.05, default: fix(sf.toe * DEG), unit: '°', hint: '+ = внутрь' },
    { id: 'align.rear.toe', label: 'Схождение зад', group: 'Геометрия', min: -1, max: 1, step: 0.05, default: fix(sr.toe * DEG), unit: '°', hint: '+ = внутрь' },
    { id: 'steer.lock', label: 'Угол руля', group: 'Геометрия', min: 15, max: 55, step: 1, default: Math.round(b.maxSteer * DEG), unit: '°' },
    { id: 'steer.ackermann', label: 'Аккерман', group: 'Геометрия', min: 0, max: 1, step: 0.05, default: b.ackermann },
    // Трансмиссия
    { id: 'gear.auto', label: 'Автомат', group: 'Трансмиссия', min: 0, max: 1, step: 1, default: b.drivetrain.automatic ? 1 : 0, kind: 'toggle' },
    { id: 'gear.final', label: 'Главная пара', group: 'Трансмиссия', step: 0.01, default: b.gearbox.finalDrive, ...around(b.gearbox.finalDrive, 0.6, 1.6, 0.01) },
    { id: 'gear.shiftTime', label: 'Время переключения', group: 'Трансмиссия', min: 0.05, max: 0.8, step: 0.01, default: b.gearbox.shiftTime, unit: 'с' },
    { id: 'drive.split', label: 'Момент на перед', group: 'Трансмиссия', min: 0, max: 1, step: 0.05, default: b.drivetrain.frontSplit, hint: '0 задний, 1 передний, между — полный' },
    { id: 'diff.lock', label: 'Блокировка дифф.', group: 'Трансмиссия', min: 0, max: 1, step: 0.05, default: b.drivetrain.diffLock, hint: '0 открытый, 1 заблокирован' },
    // Двигатель
    { id: 'engine.torqueScale', label: 'Множитель момента', group: 'Двигатель', min: 0.5, max: 2.5, step: 0.05, default: 1 },
    {
      id: 'engine.limiter',
      label: 'Отсечка',
      group: 'Двигатель',
      step: 50,
      default: b.engine.limiterRpm,
      unit: 'об/мин',
      ...around(b.engine.limiterRpm, 0.75, 1.3, 50),
    },
  )
  const fuel = moduleOf(b, 'fuel')
  if (fuel) {
    p.push(
      { id: 'fuel.lambda', label: 'Смесь (λ)', group: 'Двигатель', min: 0.65, max: 1.25, step: 0.01, default: fuel.lambda, hint: '< 1 богаче: мощнее до 0.88, дальше дым и отстрелы; > 1 беднее: горячо и слабо' },
      { id: 'fuel.overrun', label: 'Топливо на сбросе', group: 'Двигатель', min: 0, max: 1, step: 0.05, default: fuel.overrun, hint: 'подача при закрытом газе → хлопки в выхлопе' },
    )
  }
  const ign = moduleOf(b, 'ignition')
  if (ign) {
    p.push({ id: 'ignition.timing', label: 'Угол зажигания', group: 'Двигатель', min: -20, max: 10, step: 0.5, default: ign.timing, unit: '°', hint: '− позднее: меньше момента, горячее выхлоп' })
  }
  const ex = moduleOf(b, 'exhaust')
  if (ex) {
    p.push({ id: 'exhaust.pops', label: 'Чувствительность выхлопа', group: 'Двигатель', min: 0, max: 3, step: 0.1, default: ex.popSensitivity, hint: 'насколько легко воспламеняется топливо в трубе' })
  }
  const turbo = moduleOf(b, 'turbo')
  if (turbo) {
    p.push(
      { id: 'turbo.enabled', label: 'Турбина', group: 'Турбина', min: 0, max: 1, step: 1, default: turbo.enabled ? 1 : 0, kind: 'toggle' },
      { id: 'turbo.boost', label: 'Давление наддува', group: 'Турбина', min: 0.2, max: 2.5, step: 0.05, default: turbo.boost, unit: 'бар' },
      { id: 'turbo.size', label: 'Размер турбины', group: 'Турбина', min: 0.5, max: 2.5, step: 0.05, default: turbo.size, hint: 'больше — выше потенциал наддува и больше яма' },
      { id: 'turbo.blowOff', label: 'Блоу-офф', group: 'Турбина', min: 0, max: 1, step: 1, default: turbo.blowOff ? 1 : 0, kind: 'toggle' },
      { id: 'turbo.antiLag', label: 'Антилаг', group: 'Турбина', min: 0, max: 1, step: 1, default: turbo.antiLag ? 1 : 0, kind: 'toggle' },
    )
  }
  const pr = b.tyre.pressure
  p.push(
    { id: 'tyre.grip', label: 'Сцепление шин', group: 'Шины', min: 0.5, max: 1.6, step: 0.01, default: b.tyre.D, unit: 'μ' },
    { id: 'tyre.front.pressure', label: 'Давление перед', group: 'Шины', step: 5, default: pr, unit: 'кПа', ...around(pr, 0.5, 1.5, 5) },
    { id: 'tyre.rear.pressure', label: 'Давление зад', group: 'Шины', step: 5, default: pr, unit: 'кПа', ...around(pr, 0.5, 1.5, 5) },
    { id: 'brake.force', label: 'Сила тормозов', group: 'Тормоза', min: 0.3, max: 1.5, step: 0.05, default: 1 },
    { id: 'brake.bias', label: 'Баланс тормозов', group: 'Тормоза', min: 0.4, max: 0.8, step: 0.01, default: 0.62, hint: 'доля на переднюю ось' },
    { id: 'body.stiffness', label: 'Жёсткость кузова', group: 'Кузов', min: 0.2, max: 3, step: 0.05, default: 1 },
  )
  return p
}

/** Builds a complete VehicleDef (adds the generated tuning params). */
export const defineVehicle = (b: VehicleBase): VehicleDef => ({ ...b, params: standardParams(b) })
