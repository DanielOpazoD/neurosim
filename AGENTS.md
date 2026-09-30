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
  El Doppler color es un modo explícito apagado por defecto (DEC-54): pulsar
  `#color` (o la tecla F) antes de buscar píxeles rojos/azules o de colocar
  la puerta PW sobre el color.
- Capas: `src/anatomy` no puede importar `src/ultrasound` (`tests/layers.test.ts`);
  los hooks de escena (`eyeScene`, `headScene`) viven en `src/app/renderRequest.ts`.
- Pruebas e2e deterministas: `?clock=fixed&t=0.4` pausa el `SimulationClock` en
  `t` (no hay micro-movimiento de mano desde DEC-59); úsalo en goto cuando se
  comparen píxeles.
- Vistas 3D (DEC-59): cámaras enlazadas por `ViewLink` (`src/ui/viewLink.ts`);
  los presets por estación viven solo en `viewPreset`. `#headView` expone
  `data-head-model` (`escaneo` cuando carga la cabeza de `public/models/head`,
  CC BY 3.0; `?headmodel=0` fuerza la estilizada), `data-contact-mm` y
  `data-render-ms` (`?perf3d` añade `gl.finish()` para medir CPU + GPU). Todo
  recurso binario nuevo en `public/models` necesita fila con SHA-256 y archivo
  de licencia en `docs/PROVENANCE.md` (lo exige `provenance:check`).
- «Ventana óptima» (DEC-60): solver puro en `src/app/optimalWindow.ts`, botón
  `#optimal` / tecla O; en e2e la solución del caso normal es determinista
  (Ojo D barrido −2,3 mm; Temporal D inclinación −5°, desplazamiento 6 mm).
