import type { JSX } from 'preact'
import { Gauge, Kbd } from '../kit/kit.tsx'
import { Icon, type IconName } from '../icons/Icon.tsx'
import { cameraMode, damagePct, debugOverlay, tel } from '../store.ts'
import type { CameraMode } from '../../render/cameraRig.ts'

const CAM: Readonly<Record<CameraMode, { icon: IconName; label: string }>> = {
  chase: { icon: 'car', label: 'Сзади' },
  cockpit: { icon: 'eye', label: 'Салон' },
  top: { icon: 'top', label: 'Сверху' },
  orbit: { icon: 'camera', label: 'Орбита' },
}

export function Hud({ redline, maxRpm }: { redline: number; maxRpm: number }): JSX.Element {
  const cam = CAM[cameraMode.value]
  const dmg = damagePct.value
  return (
    <div class="k-hud">
      <div class="k-hud__cluster">
        <Gauge
          value={tel.rpm.value}
          max={maxRpm}
          redline={redline}
          label="Обороты"
          center={tel.gear.value}
          sub={`${tel.rpm.value} RPM`}
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
        <span class={`k-chip ${dmg > 30 ? 'k-chip--danger' : dmg > 5 ? 'k-chip--warn' : ''}`}>
          <Icon name="body" size={16} />
          {dmg.toFixed(0)}%
        </span>
      </div>
      {debugOverlay.value && (
        <pre class="k-debug">
          {`FPS     ${tel.fps.value}\nphysics ${tel.physicsMs.value} ms\ndraws   ${tel.drawCalls.value}\ntris    ${tel.triangles.value}`}
        </pre>
      )}
    </div>
  )
}
