# Pruebas

Ejecuta `npm run check` para formato, lint, tipos, pruebas y build. Para medir
cobertura usa `npm run test:coverage`.
El índice de documentos se valida con `tests/docsIndex.test.ts`; regénéralo con
`npm run docs:index`. La procedencia se valida automáticamente al final de
`npm run check` con `npm run provenance:check`.

La suite en `tests/validation/` protege:

- `caliper.test.ts`: calipers ≤0,05 mm y referencia retroglobo de 3 mm ≤0,1 mm.
- `psf.test.ts`: anchos lateral y axial del PSF dentro de ±10 % y ±15 %.
- `atenuacion.test.ts`: atenuación homogénea y transmisión por ventana.
- `pw.test.ts`: cadena espectral sintética con PSV y TAMax ≤5 %; el EDV tiene
  una expectativa estricta marcada con `it.fails` mientras dure el sesgo conocido,
  además de un guard de ±20 %.
- `persistenciaSangre.test.ts`: persistencia de sangre en tres posiciones de M1.
- `golden.test.ts`: determinismo de B-mode y del espectro PW.

Actualiza los dorados con `npm run golden:update` solo ante un cambio de imagen
justificado; documenta el motivo en el PR.

`it.fails` marca una desviación conocida: el test debe pasar mientras la
desviación exista y quedará rojo automáticamente cuando el estimador se corrija.

`tests/parameters.test.ts` comprueba que cada conjunto de parámetros carga,
que sus fuentes están en `docs/REFERENCES.md`, que cada aproximación aparece
en `docs/APPROXIMATIONS.md` y que no hay ids duplicados.

## E2E

Las pruebas E2E de Playwright cubren el flujo docente completo en Chromium:
carga sin errores, B-mode ocular, Doppler temporal/PW, congelación y
exportación. Ejecuta `npm run test:e2e`; si falta el navegador, instala Chromium
con `npm run test:e2e:install`. No forman parte de `npm run check` local por su
coste, pero se ejecutan en un job separado de CI.
