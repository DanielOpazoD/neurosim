# Notas para agentes

- Verificación: `npm run check` (format + lint + typecheck + test + build +
  provenance). La suite vitest tarda ~45 s; `persistenciaSangre` es la ruta
  crítica (~40 s).
- Dorados: `npm run golden:update` solo ante un cambio de imagen justificado;
  anotar el motivo en `docs/DECISIONS.md` y regenerar `docs/INDEX.md` con
  `npm run docs:index` (el test `docsIndex` falla si está desactualizado).
- Capturas con Playwright contra `npm run dev` (puerto 6620): tras
  `page.click('#pw')` la página se desplaza y el canvas `#bmode` queda fuera de
  la ventana; llamar a `locator('#bmode').scrollIntoViewIfNeeded()` antes de
  usar `page.mouse.click` sobre el B-mode, si no los clics no llegan.
- Capas: `src/anatomy` no puede importar `src/ultrasound` (`tests/layers.test.ts`);
  los hooks de escena (`eyeScene`, `headScene`) viven en `src/app/renderRequest.ts`.
