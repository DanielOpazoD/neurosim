# Convenciones

## Unidades y marcos

- Distancias y geometría: **mm**.
- Tiempo: **s**.
- Intensidad y ganancia: **dB**.
- Velocidad Doppler: **cm/s** en la presentación; el motor puede usar mm/s
  internamente y convierte explícitamente.
- El marco del paciente es levógiro: **+x = izquierda del paciente**, +y
  superior y +z anterior.
- Las poses guardan vectores unitarios; no se usan nombres de vista como
  sustituto de una pose.

## Determinismo

- `SimulationClock` en `src/core/clock.ts` es el reloj único de simulación.
- Toda variabilidad usa `SeededRandom`; las ramas independientes se derivan
  con `rng.fork('etiqueta')`.
- Un caso se identifica por semilla y versión del manifiesto. Los goldens
  verifican que dos adquisiciones con la misma semilla sean iguales.

## Código y flujo de trabajo

- Comentarios, documentación y mensajes de commit se escriben en español.
- Los commits siguen Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`,
  `chore:`, `refactor:`).
- Las ramas usan los mismos prefijos: `feat/`, `fix/`, `test/`, `docs/`,
  `chore/` y `refactor/`.
- Antes de entregar una rama es obligatorio ejecutar `npm run check`.
- `npm run docs:index` regenera el índice; `npm run provenance:check` valida
  las cabeceras de procedencia.

## Dónde documentar una decisión

- **DECISIONS**: decisiones de diseño estables, con id `DEC-nn`.
- **LIMITATIONS**: límites conocidos del modelo, con id `LIM-nn`.
- **APPROXIMATIONS**: valores `estimado` o `extrapolacion`, su motivo y plan
  de calibración.
- **PROVENANCE**: origen, SHA y licencia de cada módulo portado.
- **REFERENCES**: claves bibliográficas usadas por los parámetros.

## Parámetros frente a constantes

Si un número representa anatomía, fisiología, física o una prescripción
clínica del modelo, se declara en el conjunto de dominio correspondiente con
`defineParameters`, evidencia y fuente. Tamaños de canvas, FFT, kernels,
umbrales de visualización y otros valores de implementación o tuning no son
parámetros; permanecen como constantes nombradas cuando corresponde. Esta es
la decisión `DEC-13`.

Con `noUncheckedIndexedAccess` activo, `!` solo se permite en bucles indexados
acotados y tablas constantes, donde el límite garantiza que el índice existe
(`DEC-17`).
