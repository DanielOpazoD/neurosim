# Limitaciones (N1)

Alcance del bloque N1 — maqueta normal de alta fidelidad. Nada de lo
siguiente existe todavía por diseño del plan:

- **LIM-01 · Patología**: sin casos con PIC elevada, vasoespasmo, ni parada
  circulatoria. La señal ausente NO acredita cese circulatorio (ni en el
  simulador ni en la clínica).
- **LIM-02 · Lindegaard**: no hay ACI extracraneal todavía (bloque post-N1).
- **LIM-03 · DVNO y PIC**: sin mapeo DVNO→PIC ni PI→PIC; la PIC es un
  parámetro latente del paciente, nunca derivado de la imagen.
- **LIM-04 · Realismo acústico parcial**: el renderer B-mode es CPU con PSF
  separable aproximada; sin reverb de multicamino, sin shadowing complejo
  detrás del cristalino más allá de una sombra angular simple.
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
- **LIM-10 · PSF heurística**: la anchura lateral renderizada en foco (≈1,3 mm
  para una placa de 0,8 mm a 7,5 MHz) excede la predicción caja⊗gaussiana del
  propio modelo; se sustituye por un modelo de haz (PR 12).
- **LIM-11 · Advección en cuerda**: la sangre cruza el volumen muestral en
  línea recta con dirección congelada al clasificar; el re-anclaje periódico
  al eje del vaso limita la deriva pero puede teletransportar un dispersor
  ≈1 mm (micro-transitorio espectral, aceptable a 5500 Hz de PRF).
- **LIM-12 · Densidad de sangre sembrada**: hasta 32 dispersores por vaso por
  resiembra; en vasos muy tangentes la puerta puede leer fracción baja.

Decisiones pendientes del plan §19: equivalencia TS/GLSL solo si se porta
a WebGL2 en bloques posteriores.
