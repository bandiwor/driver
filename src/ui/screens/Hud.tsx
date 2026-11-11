import type { JSX } from 'preact'
import { Gauge, Kbd } from '../kit/kit.tsx'
import { Icon, type IconName } from '../icons/Icon.tsx'
import { cameraMode, damagePct, debugOverlay, tel } from '../store.ts'
import type { CameraMode } from '../../render/cameraRig.ts'

export const CAMERA_LABELS: Readonly<Record<CameraMode, { icon: IconName; label: string }>> = {
  chase: { icon: 'car', label: 'Сзади' },
  cockpit: { icon: 'eye', label: 'Салон' },
  top: { icon: 'top', label: 'Сверху' },
  free: { icon: 'camera', label: 'Свободная' },
}

/** Vertical clutch engagement meter (manual): full = engaged, empty = pedal down. */
function ClutchMeter({ engagement }: { engagement: number }): JSX.Element {
  return (
    <span class="k-chip" title="Сцепление: заполнено — сцеплено, пусто — выжато">
      <Icon name="pedal" size={16} />
      <span class="k-meter" role="meter" aria-label="Сцепление" aria-valuenow={Math.round(engagement * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span class="k-meter__fill" style={{ transform: `scaleX(${engagement})` }} />
      </span>
      <Kbd>Shift</Kbd>
    </span>
  )
}

/** Turbo boost (bar gauge) as a horizontal meter up to 2 bar. */
function BoostMeter({ boost }: { boost: number }): JSX.Element {
  return (
    <span class="k-chip" title="Наддув турбины">
      <Icon name="turbo" size={16} />
      <span class="k-meter" role="meter" aria-label="Наддув" aria-valuenow={boost} aria-valuemin={0} aria-valuemax={2}>
        <span class="k-meter__fill" style={{ transform: `scaleX(${Math.min(1, boost / 2)})` }} />
      </span>
      +{boost.toFixed(1)} бар
    </span>
  )
}

export function Hud({ redline, maxRpm }: { redline: number; maxRpm: number }): JSX.Element {
  const cam = CAMERA_LABELS[cameraMode.value]
  const dmg = damagePct.value
  const manual = !tel.automatic.value
  return (
    <div class="k-hud">
      {(!tel.running.value || tel.grind.value || tel.engineHealth.value < 0.12) && (
        <div class="k-alerts" role="status">
          {!tel.running.value && tel.engineHealth.value >= 0.12 && (
            <span class="k-alert k-alert--danger">
              <Icon name="key" size={18} />
              Двигатель заглох — удерживайте <Kbd>I</Kbd>
            </span>
          )}
          {tel.engineHealth.value < 0.12 && (
            <span class="k-alert k-alert--danger">
              <Icon name="engine" size={18} />
              Двигатель разбит — ремонт <Kbd>R</Kbd>
            </span>
          )}
          {tel.grind.value && (
            <span class="k-alert k-alert--warn">
              <Icon name="warning" size={18} />
              Скрежет: выжмите сцепление <Kbd>Shift</Kbd>
            </span>
          )}
        </div>
      )}
      <div class="k-hud__cluster">
        <Gauge
          value={tel.rpm.value}
          max={maxRpm}
          redline={redline}
          label="Обороты"
          center={tel.gear.value}
          sub={`${manual ? 'МКПП' : 'АКПП'} · ${tel.rpm.value}`}
          size={170}
        />
        <div class="k-hud__speed">
          <span class="k-hud__speed-value">{tel.speed.value}</span>
          <span class="k-hud__speed-unit">км/ч</span>
        </div>
      </div>
      <div class="k-hud__chips">
        <span class="k-chip">
          <Icon name={cam.icon} size={16} />
          {cam.label}
          <Kbd>C</Kbd>
        </span>
        {manual && <ClutchMeter engagement={tel.clutch.value} />}
        {tel.turbo.value && <BoostMeter boost={tel.boost.value} />}
        <span class={`k-chip ${dmg > 30 ? 'k-chip--danger' : dmg > 5 ? 'k-chip--warn' : ''}`} title="Повреждение кузова">
          <Icon name="body" size={16} />
          {dmg.toFixed(0)}%
        </span>
        {tel.engineHealth.value < 0.98 && (
          <span class={`k-chip ${tel.engineHealth.value < 0.4 ? 'k-chip--danger' : 'k-chip--warn'}`} title="Состояние двигателя">
            <Icon name="engine" size={16} />
            {Math.round(tel.engineHealth.value * 100)}%
          </span>
        )}
        {tel.wheelsOff.value > 0 && (
          <span class="k-chip k-chip--danger" title="Оторвано колёс">
            <Icon name="wheel" size={16} />−{tel.wheelsOff.value}
          </span>
        )}
      </div>
      {debugOverlay.value && (
        <pre class="k-debug">
          {[
            `FPS     ${tel.fps.value}`,
            `physics ${tel.physicsMode.value}`,
            `step    ${tel.physicsMs.value} ms · ${tel.stepsPerSec.value}/s`,
            `latency ${tel.latencyMs.value} ms`,
            `draws   ${tel.drawCalls.value}`,
            `tris    ${tel.triangles.value}`,
            `fx      ${tel.particles.value} particles`,
            `λ ${tel.lambda.value.toFixed(2)} · EGT ${tel.egt.value}°C${tel.turbo.value ? ` · +${tel.boost.value.toFixed(2)} bar` : ''}`,
          ].join('\n')}
        </pre>
      )}
    </div>
  )
}
