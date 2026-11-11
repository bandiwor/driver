/**
 * Implicit driveline solver: engine flywheel ↔ clutch ↔ gearbox ↔ generalised
 * differential ↔ wheels, one call per physics substep.
 *
 * Wheels use a linearised tyre torque  R·Fx(ω') ≈ R·Fx0 + k·(ω' − ω)
 * so  ω'_i = a_i + b_i·s_i·T_c  with  a_i = ω_i − h·R·Fx0_i/(I_i + h·k_i),
 * b_i = h/(I_i + h·k_i)  (unconditionally stable for any tyre stiffness).
 *
 * Differential: fixed torque split s_i (Σ s_i = 1) with the matching
 * kinematics ω_carrier = Σ s_i·ω_i. This single model covers open axle diffs
 * and RWD / FWD / AWD with a centre split.
 *
 * Clutch: first solve as LOCKED (engine and carrier rigidly coupled through
 * gear ratio G). If the required clutch torque exceeds capacity → SLIPPING,
 * transmit ±capacity (Coulomb). Stable at any gear ratio, no chatter.
 *
 * Limited slip: viscous coupling c between the two wheels of an axle, solved
 * implicitly (c = ∞ → locked).
 */
export interface DrivelineWheel {
  omega: number
  inertia: number
  /** Linearised tyre torque stiffness (Nm per rad/s), ≥ 0. */
  k: number
  /** Tyre longitudinal force at current ω, N. */
  fx: number
  radius: number
  /** Drive torque share, Σ = 1 over driven wheels; 0 = undriven. */
  share: number
  /** Brake + handbrake torque magnitude, Nm. */
  brake: number
  // scratch (written by the solver)
  a: number
  b: number
}

export interface DrivelineState {
  engineOmega: number
  /** Last transmitted clutch torque (engine side), Nm. */
  clutchTorque: number
  locked: boolean
}

export interface DrivelineInput {
  h: number
  engineTorque: number
  engineInertia: number
  /** Overall ratio engine:carrier including final drive; 0 = neutral. */
  ratio: number
  /** Clutch capacity, Nm (engagement × max torque). */
  clutchCapacity: number
}

export function solveDriveline(
  inp: DrivelineInput,
  wheels: readonly DrivelineWheel[],
  axles: readonly (readonly [number, number, number])[], // [left, right, coupling c]
  st: DrivelineState,
): void {
  const { h, engineTorque, engineInertia: Ie, ratio: G } = inp
  let A = 0
  let B = 0
  for (const w of wheels) {
    const den = w.inertia + h * w.k
    w.b = h / den
    w.a = w.omega - (h * w.radius * w.fx) / den
    A += w.share * w.a
    B += w.share * w.share * w.b
  }

  let tcl = 0
  st.locked = false
  if (G !== 0 && inp.clutchCapacity > 0 && B > 0) {
    // Locked: ω_e + h(Te − Tcl)/Ie = G·(A + B·G·Tcl)
    const need = (st.engineOmega + (h * engineTorque) / Ie - G * A) / (h / Ie + G * G * B)
    if (Math.abs(need) <= inp.clutchCapacity) {
      tcl = need
      st.locked = true
    } else {
      tcl = Math.sign(need) * inp.clutchCapacity
    }
  }
  st.clutchTorque = tcl
  st.engineOmega += (h * (engineTorque - tcl)) / Ie
  if (st.engineOmega < 0) st.engineOmega = 0

  const tc = G * tcl
  for (const w of wheels) w.omega = w.a + w.b * w.share * tc
  if (st.locked && G !== 0) {
    // Remove round-off drift between engine and carrier while locked.
    let wc = 0
    for (const w of wheels) wc += w.share * w.omega
    st.engineOmega = Math.max(0, G * wc)
  }

  // Limited-slip coupling per axle (implicit viscous).
  for (const [l, r, c] of axles) {
    if (c <= 0) continue
    const wl = wheels[l]!
    const wr = wheels[r]!
    const d = wl.omega - wr.omega
    const bsum = wl.b + wr.b
    if (bsum <= 0) continue
    const dNew = Number.isFinite(c) ? d / (1 + (c * bsum) / h) : 0
    const j = (d - dNew) / bsum // coupling impulse (torque·h / h)
    wl.omega -= j * wl.b
    wr.omega += j * wr.b
  }

  // Brakes: Coulomb friction toward zero, cannot reverse rotation.
  for (const w of wheels) {
    if (w.brake <= 0) continue
    const dw = w.brake * w.b
    w.omega = w.omega > dw ? w.omega - dw : w.omega < -dw ? w.omega + dw : 0
  }
}

export const newDrivelineState = (engineOmega: number): DrivelineState => ({ engineOmega, clutchTorque: 0, locked: false })
