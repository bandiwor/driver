# Kuzov

Браузерная песочница вождения с мягкой физикой кузова (node–beam), процедурными
машинами и процедурным звуком. Preact + signals, three.js, Vite 8 (Rolldown +
Oxc), Lightning CSS, TypeScript 7 strict, Vitest, Playwright.

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + oxlint + unit/component tests
npm run build      # релизная сборка (Oxc minify + Lightning CSS)
npm run e2e        # e2e-прогон UI в headless Chromium
                   #   --preview  --physics=inline  --no-isolation
npm run snap       # PNG машины из всех проекций → snapshots/
npm run perf       # бюджет производительности физики
```

Коробка: **автомат** или **механика** (выбор в меню и в паузе).

Управление: **W/S** газ/тормоз (в автомате удержание **S** на месте — задний ход), **A/D** руль, **Space** ручник, **Shift**
сцепление (отпускается плавно), **Q/E** передачи (механика), **I** стартер (удерживать, если заглох),
**C** камера (сзади / салон / сверху / свободная; мышь — вращение, колесо — зум),
**R** сброс, **T** тюнинг, **Esc** пауза, **F3** отладка и каркас балок.

Тюнинг двигателя: смесь (λ), топливо на сбросе, угол зажигания, турбина
(наддув, размер, блоу-офф, антилаг) — от смеси зависят мощность, температура,
дым и отстрелы. Дым из-под шин в заносе, пламя из выхлопа.

Физика по умолчанию работает в Web Worker (`?physics=inline` — на главном
потоке). Для SharedArrayBuffer хостинг должен отдавать COOP/COEP-заголовки
(см. `vite.config.ts`), иначе используется фолбэк через transferable.

Документация: [архитектура](docs/ARCHITECTURE.md) · [план](docs/PLAN.md) · [стиль](docs/STYLE.md).
