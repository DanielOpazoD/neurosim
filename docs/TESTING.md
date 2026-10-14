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

`tests/vascularGraph.test.ts` comprueba el contrato vascular (DEC-74):
round-trip afín/unidades, radios por punto, bifurcación, ciclo de anastomosis,
componentes, rechazo de JSON inválido y lateralidad explícita. Sus coordenadas
son arbitrarias, no un atlas. También comprueba invariantes geométricas de
Willis, ojos y cuello existentes, sin atribuirles conectividad ni validación
anatómica externa.

## E2E

Las pruebas E2E de Playwright cubren el flujo docente completo en Chromium:
carga sin errores, B-mode ocular, Doppler temporal/PW, congelación y
exportación. Ejecuta `npm run test:e2e`; si falta el navegador, instala Chromium
con `npm run test:e2e:install`. No forman parte de `npm run check` local por su
coste, pero se ejecutan en un job separado de CI.

## Caudal, perfil y balances (DEC-75)

`tests/validation/flowConservation.test.ts` integra numéricamente el campo real
`CerebralFlow.velocityAt` sobre secciones (cuadratura polar uniforme en área) y
comprueba que recupera el caudal nominal con error < 1 % en tubos sintéticos
(arterial, venoso, alta resistencia, signo invertido, estado hemodinámico basal),
que la garganta de una estenosis conserva el caudal instantáneo de una sección
proximal, que el perfil normalizado tiene media 1 para cualquier peso admisible y
que todas las escenas construidas (Willis, ojos, cuello) relacionan `flowMlMin`
con `meanSpatialCms`, no con la envolvente. `tests/flowBalance.test.ts` prueba
la contabilidad firmada de nodos en una bifurcación y una anastomosis sintéticas
(fugas locales, terminales sin contorno, inversión total, cero explícito frente a
dato ausente, no finitos, desbordamiento) y recorre las cinco variantes de Willis
en cuatro fases y tres PIC exigiendo residuo nodal < 1e−9 ml/min. Son pruebas de
software y aritmética: no validan caudales cerebrales reales ni perfiles medidos.

## Coherencia regional (DEC-76)

`tests/validation/regionalCoherence.test.ts` recorre las cinco variantes de
Willis, el cuello y los ojos: extremos cercanos coinciden exactamente o están
declarados libres, tubos sin nodo común no se interpenetran, las ramas de la ACE
nacen sobre el tronco, la ACI cervical y el sifón comparten nodo, el eje temporal
de cada ojo apunta hacia afuera y el nervio se acerca al plano medio, y los dos
ojos son especulares. Invariantes geométricas del fixture; no validan anatomía.
