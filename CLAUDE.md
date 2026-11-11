# Kuzov — notes for agents

Read docs/ARCHITECTURE.md (layers, frame order, data layout), docs/PLAN.md
(current step), docs/STYLE.md (UI tokens + code rules) before changing code.

- Layer rule: core → physics → world → vehicles → sim → render/audio/input → app/devtools → ui.
- Maps are data (src/world/maps): new terrain = feature in the registry; check with `npm run snap -- --map=<id> --views=map`.
- Physics runs in a worker: main thread talks only to `PhysicsHost` (src/sim/host.ts);
  new sim features = Simulation method + SimCommand + protocol, tested over MessageChannel.
  `three` only in src/render, `preact` only in src/ui. No cycles.
- No allocations in fixed-step/frame hot paths. Typed arrays for physics.
- Strict TS: no `any`, no ts-ignore. `!` allowed only for guaranteed indices in hot loops.
- Every change: `npm run check && npm run build && npm run e2e`.
- Visual changes: `npm run snap -- --views=...` and look at snapshots/*.png.
- Body-local axes: +x left, +y up, +z forward.
