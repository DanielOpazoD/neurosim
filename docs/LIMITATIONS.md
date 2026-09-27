# Limitaciones (N1)

Alcance del bloque N1 — maqueta normal de alta fidelidad. Nada de lo
siguiente existe todavía por diseño del plan:

- **LIM-01 · Patología**: sin casos con PIC elevada, vasoespasmo, ni parada
  circulatoria. La señal ausente NO acredita cese circulatorio (ni en el
  simulador ni en la clínica).
- **LIM-02 · Lindegaard**: no hay ACI extracraneal todavía (bloque post-N1).
- **LIM-03 · DVNO y PIC**: sin mapeo DVNO→PIC ni PI→PIC; la PIC es un
  parámetro latente del paciente, nunca derivado de la imagen.
- **LIM-04 · Realismo acústico parcial**: el renderer B-mode es CPU con haz
  gaussiano por apertura, lóbulos laterales y refracción del cristalino; aún
  no modela reverb de multicamino ni shadowing complejo fuera de esa interfaz.
- **LIM-05 · Normal de interfaz**: se estima contando cambios de material por
  eje (±0,3 mm); es no signada y cuantizada, suficiente para el peso
  especular.
- **LIM-06 · Tejido estático**: la anatomía no se deforma con el pulso ni con
  la presión de la sonda (contactPressure aún no deforma tejido).
- **LIM-07 · Audio**: separación estéreo por signo de frecuencia en bloques de
  256 muestras; sin modelo de sistema auditivo ni ruido de fondo de sala.
- **LIM-08 · Medición DVNO**: manual con calipers; el offset de 3 mm es guía
  visual, el medidor decide.
- **LIM-09 · Sesgo diastólico**: sobre una onda sintética conocida, EDV se
  sobreestima ≈+18 % (PSV +2 %, TAMax +3 %) por la resolución FFT (PRF/128)
  y la envolvente por percentil; pendiente de estimador mejorado.
- **LIM-10 · PSF analítica (resuelta/redirigida)**: la anchura lateral ya no
  usa el coeficiente heurístico anterior; se valida contra el modelo de haz
  caja⊗gaussiana de `src/ultrasound/beam.ts`. Las limitaciones acústicas
  residuales quedan en LIM-04.
- **LIM-11 · Advección en cuerda**: la sangre cruza el volumen muestral en
  línea recta con dirección congelada al clasificar; el re-anclaje periódico
  al eje del vaso limita la deriva pero puede teletransportar un dispersor
  ≈1 mm (micro-transitorio espectral, aceptable a 5500 Hz de PRF).
- **LIM-12 · Densidad de sangre sembrada**: hasta 32 dispersores por vaso por
  resiembra; en vasos muy tangentes la puerta puede leer fracción baja.
- **LIM-13 · PW en hilo principal**: el procesamiento PW, el audio y las
  mediciones espectrales todavía corren en el hilo principal; solo B-mode y
  Doppler color se renderizan en Worker.
- **LIM-14 · Artefactos 1D**: espejo y cola de cometa se aproximan copiando
  muestras sobre una línea de adquisición; no modelan propagación 2D/3D,
  aperturas múltiples ni trayectorias reverberantes completas.

Decisiones pendientes del plan §19: equivalencia TS/GLSL solo si se porta
a WebGL2 en bloques posteriores.
