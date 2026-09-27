# Pruebas

Ejecuta `npm run check` para formato, lint, tipos, pruebas y build. Para medir
cobertura usa `npm run test:coverage`.

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
