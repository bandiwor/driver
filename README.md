# Kuzov

Браузерная песочница вождения с мягкой физикой кузова (node–beam), процедурными
машинами и процедурным звуком. Preact + signals, three.js, Vite 8 (Rolldown +
Oxc), Lightning CSS, TypeScript 7 strict, Vitest, Playwright.

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + oxlint + unit/component tests
npm run build      # релизная сборка (Oxc minify + Lightning CSS)
npm run e2e        # e2e-прогон UI в headless Chromium (--preview для prod-сборки)
npm run snap       # PNG машины из всех проекций → snapshots/
npm run perf       # бюджет производительности физики
```

Управление: **W/S** газ/тормоз, **A/D** руль, **Space** ручник, **Shift**
сцепление, **Q/E** передачи, **C** камера (сзади / салон / сверху / орбита),
**R** сброс, **T** тюнинг, **Esc** пауза, **F3** отладка и каркас балок.

Документация: [архитектура](docs/ARCHITECTURE.md) · [план](docs/PLAN.md) · [стиль](docs/STYLE.md).
