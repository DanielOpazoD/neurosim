# Limitaciones (N1)

Alcance del bloque N1 — maqueta normal de alta fidelidad. Nada de lo
siguiente existe todavía por diseño del plan:

- **LIM-16 · Color Kasai reducido**: el ensemble color solo sintetiza
  dispersores dentro de celdas cuyo corte alcanza un vaso; el clutter espacial
  fuera de esas celdas sigue sin sintetizarse y no se hace submuestreo espacial
  dentro de cada celda. El filtro color usa un criterio de velocidad
  equivalente al corte configurado.

- **LIM-17 · Movimiento tisular reducido**: el tejido combina pulsación radial
  de pared, pulsación cerebral anterior uniforme y desplazamiento respiratorio;
  no hay reflexiones de onda ni acoplamiento PIC. No hay temblor de mano: el
  micro-movimiento de la sonda se eliminó (DEC-59) y la pose es siempre la de
  los controles.

- **LIM-18 · Windkessel reducido**: la onda usa dos elementos y no modela
  reflexiones de onda, reservorios venosos ni autorregulación; el índice de
  pulsatilidad se conserva aproximadamente uniforme entre territorios.
- **LIM-19 · Hemodinámica estática**: la autorregulación, la reactividad al
  CO₂ y la PIC no evolucionan dinámicamente; no hay compliance craneal ni
  dinámica de Monro–Kellie. El DVNO es una geometría estática condicionada por
  la PIC del escenario docente.

- **LIM-20 · ALARA acústico reducido**: MI/TI usan fórmulas ODS sobre presión
  derated y potencia estimadas; no hay campo de presión no lineal, hidrófono,
  perfusión térmica, calentamiento del transductor ni solución térmica
  espacio-temporal.
- **LIM-21 · Protocolo DVNO reducido**: el protocolo 2×2 no simula variabilidad
  interobservador ni una curva ROC; usa un único umbral educativo y el informe
  no diagnostica hipertensión intracraneal.

- **LIM-01 · Patología**: existen escenarios patológicos estáticos (HIC,
  vasoespasmo, estenosis M1, ventana pobre, parada circulatoria, hiper- e
  hipocapnia) como conjuntos de parámetros; no hay evolución dinámica de la
  enfermedad. La señal ausente NO acredita cese circulatorio (ni en el
  simulador ni en la clínica).
- **LIM-02 · Lindegaard**: el denominador es la TAMax de la ACI
  extracraneal distal MEDIDA con PW en la ventana submandibular del mismo
  lado (DEC-58); solo si aún no se midió se usa la TAMax de referencia del
  caso (`icaExtracranialTamaxCms`), rotulada «ACI de referencia». La ACM del
  numerador es la última medida en M1. No se corrige el ángulo por defecto
  (práctica TCD): la ACI casi alineada con el haz (~7°) se subestima < 1 %.
  La ACE y la yugular interna son simplificadas (LIM-29) y solo sirven para
  distinguir la ACI; el índice no tiene historial temporal ni promedia
  varias medidas.
- **LIM-03 · DVNO y PIC**: sin mapeo DVNO→PIC ni PI→PIC; la PIC es un
  parámetro latente del paciente, nunca derivado de la imagen. La DVNO sigue
  `onsdForIcpMm` (lineal, saturada en `onsdMaxMm`).
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
- **LIM-09 · Sesgo diastólico (reducido)**: la envolvente interpola en dB el
  cruce sub-bin de su umbral, reduciendo el sesgo EDV de +8,28 % a +4,78 %
  en la onda sintética (PSV y TAMax permanecen dentro de ±5 %). El estimador
  sigue limitado por la resolución FFT y por dropouts que requieren un P10
  robusto.
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
- **LIM-13 · PW en hilo principal (resuelta/redirigida)**: la cadena PW
  (volumen de muestra, filtro de pared, espectro) corre en su propio Worker
  desde DEC-55 (`src/ui/pwWorker.ts`, protocolo en `src/app/pwProtocol.ts`).
  En el hilo principal quedan, por diseño, el audio (Web Audio exige el hilo
  del `AudioContext`: separación direccional y remuestreo), las medidas sobre
  las columnas recibidas (a 4 Hz) y el rasterizado del espectrograma (solo
  con columnas nuevas o cambios de presentación, ≤30 Hz). Sin Worker o con
  `?pwworker=0` la cadena vuelve al hilo principal con el mismo manejador.
- **LIM-14 · Artefactos 1D**: espejo y cola de cometa se aproximan copiando
  muestras sobre una línea de adquisición; no modelan propagación 2D/3D,
  aperturas múltiples ni trayectorias reverberantes completas.
- **LIM-15 · Flujo vascular simplificado**: el índice de pulsatilidad es
  uniforme por segmento, no hay autorregulación territorial ni resistencia
  distal explícita; las comunicantes normales se modelan como tubos con
  flujo casi estático.

Decisiones pendientes del plan §19: equivalencia TS/GLSL solo si se porta
a WebGL2 en bloques posteriores.

- **LIM-22 · Debriefing por reglas**: no se registra una trayectoria continua
  de la sonda ni métricas de ergonomía. Los hallazgos son reglas educativas
  basadas en el estado y no un modelo experto de desempeño.
- **LIM-23 · Audio de equipo**: no se modelan altavoz, sala, psicoacústica ni
  respuesta auditiva individual. El simulador tampoco infiere una auto-traza
  de equipos comerciales; la separación, AGC y filtrado son una presentación
  determinista de la señal IQ.
- **LIM-24 · Paridad WebGL2**: el trazado y la adquisición siguen en CPU; la
  ruta GPU solo cubre post-IQ y usa coma flotante `highp`. No se promete
  igualdad bit a bit entre CPU y GPU: la equivalencia se evalúa con tolerancias
  de intensidad y puede depender de la implementación de WebGL2 del navegador.
  En sectores, la textura lateral GPU limita el radio a 64 taps para mantener
  un tamaño finito cerca del ápice; la ruta CPU conserva el kernel de referencia.
- **LIM-25 · Estenosis focal idealizada**: el caso `estenosisM1` modela una
  garganta gaussiana sobre la línea central (`vesselRadiusAt`) con aceleración
  por continuidad (R/r(s))² y una turbulencia post-estenótica determinista de
  media cero (σ = 0,35·(vJet − v₀), hasta 3·L corriente abajo, hash por
  posición). No hay remodelado de la pared, jet excéntrico, ni dependencia de
  la turbulencia con la fase; el vasoespasmo sigue siendo un escalado difuso
  de todo el segmento. Los demás casos son parámetros fijos sin progresión
  temporal ni respuesta a maniobras más allá de la fisiología basal.

- **LIM-26 · Vasos oculares estilizados**: el grafo retrobulbar (ACR, VCR, AO,
  VOS y ciliares posteriores) son tubos de radio constante y fijo — sin
  variación de calibre a lo largo del trayecto ni anastomosis. El flujo venoso
  (VCR, VOS) es estacionario, sin modulación respiratoria ni pulsatilidad de la
  ACR/VCR por latido; el trayecto de la arteria oftálmica es esquemático
  (cruce sobre el nervio a ~15 mm retroglobo) y no reproduce sus ramas ni su
  variabilidad anatómica.

- **LIM-27 · Navegación de sonda 2-D**: `offsetVMm`/`tiltVDeg` añaden
  deslizamiento vertical y angulación en el plano de elevación, pero no hay
  deslizamiento anterior-posterior sobre la cabeza ni compresión adelante/
  atrás distinta del parámetro `press`; la estación ocular no proyecta sobre
  la superficie del párpado (solo la temporal sigue el elipsoide craneal).

- **LIM-28 · Desplazamiento de línea media supratentorial**: el caso
  `desplazamientoLineaMedia` mueve solo estructuras supratentoriales (III
  ventrículo, tálamos, pineal, cuernos, hoz) y es estático — no modela
  compresión mesencefálica progresiva, herniación ni respuesta dinámica de la
  PIC; la forma del III ventrículo sigue siendo un prisma idealizado.

- **LIM-29 · Escena submandibular simplificada**: el cuello es un marco
  local plano bajo el ángulo mandibular (piel/subcutáneo de 4 mm como un
  plano ⟂ al haz por defecto, sin curvatura ni compresión con `press`); la
  glándula es un elipsoide homogéneo, el digástrico una cápsula y el
  milohioideo una lámina; la rama mandibular es una lámina ósea de 8 mm sin
  cóndilo ni cuerpo. La ACI, la ACE (con ramas facial y lingual) y la
  yugular interna son tubos de radio constante: la ACI toma el caudal de
  Willis ipsilateral (M1 + A1 + AComP) con radio 2,2 mm; la ACE usa una onda
  de alta resistencia fija (PSV 75 / EDV 8 cm/s, incisura dicrota) sin
  reactividad al CO₂; la yugular es venosa estacionaria (~20 cm/s) sin
  modulación respiratoria, colapso ni compresibilidad. No hay bifurcación
  carotídea, bulbo ni seno, ni placas o estenosis cervicales, ni el tramo
  petroso intraóseo (el tubo continúa en tejido hasta el sifón).
