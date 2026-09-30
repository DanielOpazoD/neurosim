# Decisiones de diseño

1. **DEC-01** — Repo independiente `neurosono-sim` con porte selectivo de
   vexus-sim/lus-sim (plan §6.2). Sin submódulos: los archivos portados
   llevan cabecera de procedencia.
2. **DEC-02** — mm + marco levógiro (+x = izquierda del paciente) en todo el motor,
   igual que vexus-sim. Los datos se convierten solo en la presentación.
3. **DEC-03** — "Nada se pinta: emerge" — B-mode raymarch con materiales, speckle
   coherente sembrado, ecos de interfaz por ΔZ; Doppler por dispersores
   virtuales advectados con el campo de velocidades real.
4. **DEC-04** — Separación paciente/adquisición/señal/medición por contratos
   (`src/domain/contracts.ts`); la medición se liga al cuadro adquirido
   (freeze/cine no recalculan).
5. **DEC-05** — DVNO interno vs externo son dos convenciones distintas
   (`OnsdConvention`); el interno excluye duramadre y es el por defecto.
6. **DEC-06** — TAMax = integral de la envolvente verdadera del espectro por
   latido; la fórmula (PSV+2·EDV)/3 no se usa internamente.
7. **DEC-07** — Sonda lineal ocular explícita (vexus solo tenía convexa/fasada);
   **sectorial** para la ventana transtemporal.
8. **DEC-08** — CPU primero, GPU después — el plan permite modelo reducido; la
   paridad TS/GLSL se decide si se porta a WebGL2 (LIMITATIONS).
9. **DEC-09** — Dispersores de sangre con `flowBasis` congelado (portado de vexus-sim):
   cada dispersor mantiene dirección y perfil laminar del momento de
   clasificación y advecta en cuerda recta; vBlood = flowBasis·u(φ). Reentra
   por la misma cuerda al salir de la caja. La reclasificación re-ancla al eje
   del vaso (máx. 0,9·R) en vez de convertir a tejido — la sangre no abandona
   el vaso. Sin esto la población de la puerta se agotaba en ~10 s.
10. **DEC-10** — Siembra dirigida en vasos (`seedVessels`, máx. 32): al mover la puerta
    se siembran dispersores sobre el tramo del vaso dentro de la caja — la
    sangre llena el tubo; sin ella un tubo de 3 mm en una caja de ~3 cm³
    apenas captaba dispersores.
11. **DEC-11** — Volumen parcial en la pared del tubo (±0,6 mm): el voxel borde mezcla
    sangre y tejido; se clasifica sangre con la velocidad de la línea central.
    La amplitud de sangre (6) sigue 5× por debajo del tejido pero supera el
    umbral de detección de la envolvente (12 dB sobre ruido).
12. **DEC-12** — El fixture DVNO se deriva del manifiesto (interno + 2·dura), nunca se
    codifica dos veces.
13. **DEC-13** — Registro por dominio — anatomía, física US, Doppler y fisiología se
    declaran con evidencia en sus propios `params.ts`; tamaños de canvas,
    umbrales de dibujo y constantes de implementación siguen siendo constantes
    nombradas, no parámetros del modelo.
14. **DEC-14** — Los errores en tiempo de ejecución se registran y se exportan;
    el bucle nunca muere en silencio.
15. **DEC-15** — El render B-mode/color corre en Worker; el hilo principal solo
    dibuja, mide y reproduce audio; el resultado es bit-idéntico al camino
    síncrono.
16. **DEC-16** — Las pruebas E2E cubren el flujo docente completo pero no
    gatean `check` local; gatean CI.
17. **DEC-17** — `noUncheckedIndexedAccess` está activo; `!` se permite solo
    en bucles indexados acotados y tablas constantes.
18. **DEC-18** — La ampolla retrobulbar se parametriza y se ancla al valor
    medido a 3 mm, para conservar la convención DVNO del fixture mientras se
    representa la variación longitudinal de la vaina.
19. **DEC-19** — El haz B-mode usa FWHM gaussiano `λF/D`, lóbulos laterales
    parametrizados, pitch real dependiente de la profundidad y una PSF
    bidireccional como producto de gaussianas de transmisión y recepción con
    foco dinámico en recepción; el cristalino aplica refracción de Snell y
    velocidad acústica material para que la compresión axial emerja de la
    adquisición.
20. **DEC-20** — La reverberación, el espejo y la cola de cometa emergen de
    interfaces acústicas y atenuación acumulada mediante reglas 1D
    parametrizadas; sus ganancias se registran como parámetros de consenso.
21. **DEC-21** — Los hitos transtemporales emergen de regiones anatómicas 3D
    paramétricas y se adquieren con presets de plano mesencefálico y
    diencefálico; no se dibujan como overlays independientes de la señal. La
    eliminación de la envolvente mesencefálica legacy cambia la proporción de
    cisterna/tejido que ve la caja PW, por lo que su golden puede cambiar; la
    precedencia de `vesselDistance` mantiene M1 como `vaso`.
22. **DEC-22** — El polígono de Willis se representa como un grafo de
    segmentos continuos: los flujos terminales se propagan aguas arriba,
    `flowSign` orienta la dirección anatómica de la polilínea y la ley de
    Murray se usa como verificación, no como generador de radios. Las
    comunicantes normales tienen flujo cero; las variantes de aplasia A1 y
    ACP fetal redistribuyen el caudal de forma explícita.
23. **DEC-23** — El color Doppler sintetiza ensembles IQ deterministas por
    celda, elimina el componente estacionario con un filtro de pared de orden
    cero y estima velocidad y varianza con la autocorrelación de Kasai. La
    potencia se normaliza respecto de la referencia de una celda completamente
    sanguínea y atenuada, y la potencia y la varianza se umbralizan antes de
    pintar; el aliasing emerge exclusivamente de `atan2` de `R(1)`, sin plegado
    analítico adicional.
24. **DEC-24** — El clutter Doppler emerge del movimiento material: la pared
    arterial tiene una pulsación radial atenuada con la distancia y el cerebro
    una pulsación anterior uniforme; el temblor determinista de la mano entra
    como velocidad relativa de la sonda. El filtro de pared es un compromiso
    observable: un corte alto elimina más movimiento lento, pero también puede
    borrar flujo diastólico.
25. **DEC-25** — La docencia distingue ángulo real tridimensional, ángulo
    proyectado en el plano de imagen y ángulo introducido por el operador. La
    corrección de velocidad se compara con el factor
    `cos(θ_real)/cos(θ_user)` sin cambiar la medición adquirida ni ocultar la
    geometría elevacional.
26. **DEC-26** — La onda arterial se genera con un Windkessel de dos elementos
    integrado hasta estado estable; el reflujo breve y su rebote producen la
    incisura dicrota sin dibujar una envolvente independiente. `tauS = 0,18 s`
    se trata como una constante efectiva estimada de la onda de velocidad ACM
    normalizada, no como la RC sistémica de Westerhof: el modelo omite
    reflexiones e impedancia característica. El rebote positivo
    `+3 × backflowFraction` es una aproximación explícita para crear la segunda
    joroba y hacer visible la incisura, no un flujo fisiológico medido.
27. **DEC-27** — La agenda cardíaca conserva intervalos RR deterministas con
    HRV y arritmia sinusal respiratoria; la respiración modula el flujo y añade
    desplazamiento cerebral a la señal material.
28. **DEC-28** — La presión crítica de cierre se acopla al Windkessel y a la
    presión intracraneal antes de sintetizar IQ: la pulsatilidad y el PI emergen
    de `PP/(PAM−CrCP)`, no de una tabla de medición independiente.
29. **DEC-29** — La autorregulación de Lassen y la reactividad al CO₂ actúan
    como factores latentes del flujo medio. La PIC modifica CrCP, la forma de
    onda y el DVNO, mientras la cadena Doppler conserva la misma adquisición.
30. **DEC-30** — MI y TI se calculan por adquisición a partir de presión pico
    derated y potencia temporal media: la salida acústica modifica IQ/B-mode
    antes del ruido y los índices se presentan como rótulo de equipo. Los p0,
    W0 y el modelo térmico son estimados; los límites oftálmicos siguen la
    prescripción FDA/AIUM-NEMA y el principio ALARA.
31. **DEC-31** — El protocolo DVNO registra cuatro planos (transversal y
    sagital por cada lado) y un DTE transversal por ojo. El informe normaliza
    la media DVNO por el tamaño del globo mediante DVNO/ETD y solo informa
    umbrales educativos; no diagnostica PIC ni sustituye la decisión clínica.
32. **DEC-32** — El navegador 3D es una vista derivada de la misma pose,
    `ScanGeometry` y anatomía que alimentan la adquisición. No dibuja
    estructuras que no existan en el modelo; la proyección ortográfica solo
    cambia la representación.
33. **DEC-33** — El debriefing docente se construye con evidencia numérica del
    estado, eventos y mediciones. Sus umbrales viven en registros de parámetros
    con evidencia y sus verdades del modelo no entran en la exportación clínica.
34. **DEC-34** — El espectrograma de equipo se presenta recorriendo cada fila de
    píxel, interpolando `powerDb` entre bins y agregando columnas temporales sin
    `max`. El piso adaptativo, gamma y paleta solo cambian la presentación:
    las mediciones continúan usando `powerDb` adquirido sin modificar. La
    ganancia espectral y el margen sobre el piso son controles independientes
    de la ganancia B-mode.
35. **DEC-35** — El audio direccional usa ventanas Hann con overlap-add del 50 %,
    un paso bajo relativo a PRF/2 y un AGC lento. El resampleo lineal conserva
    la relación PRF–AudioContext; volumen y paleta son controles de equipo.
36. **DEC-36** — La etapa post-IQ determinista puede ejecutarse en WebGL2:
    PSF, TGC, compresión logarítmica y scan conversion usan coeficientes
    calculados en TypeScript y compartidos con GLSL. El trazado de rayos,
    clasificación de materiales, artefactos y ruido permanecen en CPU/Worker.
    CPU es el renderizador por defecto hasta medir paridad en el dispositivo.
37. **DEC-37** — La envolvente PW estima su borde con interpolación sub-bin en
    dB entre bins contiguos de la banda detectada, en lugar de devolver siempre
    el centro del bin rasterizado. La interpolación corrige la cuantización de
    adquisición sin recalibrar el percentil EDV; la misma traza corregida
    alimenta PSV, EDV y TAMax. En la onda sintética N1 el EDV pasa de 37,90 a
    36,67 cm/s (+8,28 % a +4,78 % frente a 35), mientras PSV y TAMax siguen
    dentro de ±5 %. La resolución FFT, los dropouts y el P10 temporal siguen
    siendo limitaciones explícitas.
38. **DEC-38** — Los resúmenes PW excluyen latidos con cobertura inferior al 80 %
    del RR y recalculan PI/IR a partir de las medianas resumidas de PSV, EDV y
    TAMax, evitando mezclar índices de latidos distintos.
39. **DEC-39** — La geometría del movimiento tisular (vaso más cercano, normal
    radial, distancia a la pared) se cachea por dispersor y se recalcula solo al
    reclasificar (cada 96 pulsos, ≈16 ms a 6 kHz), no en cada paso lento (8
    pulsos). Un dispersor tisular se desplaza <0,1 mm entre reclasificaciones,
    muy por debajo del paso de la retícula de speckle, por lo que el cambio es
    físicamente indistinguible; el dorado `pwM1Point2` se regeneró por este
    motivo. Junto con la geometría vascular sin asignaciones, la prueba de
    persistencia pasa de 449 s a ≈38 s.
40. **DEC-40** — Los casos clínicos son conjuntos estáticos de parámetros
    (`src/domain/cases.ts`) seleccionados por URL (`?caso=`); cambiar de caso
    recarga la página y descarta los overrides de fisiología/variante, lo que
    mantiene la inicialización de estado simple y determinista. El espasmo y
    la estenosis se modelan como escalado del radio vascular antes de
    `velocityForFlow` (flujo constante → velocidad por continuidad) y la
    ventana pobre como espesor óseo + pérdida de transmisión relativa a la
    ventana de referencia, de modo que el caso `normal` reproduce los
    dorados de N1 sin cambios.
41. **DEC-41** — El B-mode aplica la PSF sobre el IQ complejo y detecta la
    envolvente después (`renderBMode`/`postIq`), no sobre la magnitud: el
    speckle emerge de la interferencia de dispersores sub-resolución. La PSF
    normaliza energía para no sesgar la amplitud y el test de Rayleigh (SNR
    de envolvente ≈ 1,91) valida las estadísticas de primer orden.
42. **DEC-42** — La convolución lateral de la PSF en CPU usa el mismo tope de
    radio que la ruta WebGL (`MAX_GPU_KERNEL_RADIUS` = 64): cerca del ápice
    del sector el paso lateral tiende a 0 y σ en píxeles divergía (r >
    800 000 taps por fila, ~83 % del fotograma). Los kernels por fila se
    calculan una vez y se comparten con `psfKernelsTexture`. El dorado
    `temporalDerBmode` cambia una vez y CPU/GPU quedan idénticos; el ojo
    (paso constante) es bit-idéntico.
43. **DEC-43** — `nerveSection` usa una tabla de la línea central por
    `EyeGeometry` (valores exactos cada 0,25 mm) y un rechazo por caja
    envolvente de la vaina: fuera de ella en > 1 para todo s, por lo que el
    resultado es idéntico. `skullRadiusXmm` 72 → 67 mm (~140 mm biparietal)
    encuadra el mesencéfalo (centro a ≈74 mm) dentro del campo de 90 mm;
    mueve los dorados temporales (`temporalDerBmode`, `colorM1Der`,
    `pwM1Point2`).
44. **DEC-44** — La corona de cisterna basal se adelgaza (butterflyLevel < 1,45
    → < 1,22, ~3 mm) y su amplitud baja a 0,55 con pico 1,25 en el borde
    (`scatterScale` 1,25 − 0,55·ss(1,0;1,25)); el ala esfenoidal pasa de losa
    (|y+2|<3, |x|<32) a cresta (|y+2|<1,5, 20<|x|<28). Objetivo: mariposa
    hipoecoica legible; la medición muestra que el llenado residual del
    núcleo procede del eco de interfaz smeada por la PSF, no del speckle
    propio (amp 0,15→0,10 mueve sólo ~1 dB). Mueven `temporalDerBmode` y
    `pwM1Point2` (clutter); `colorM1Der` y `eyeDerBmode` intactos.
45. **DEC-45** — Sustancia negra recalibrada a la referencia de Berg 2008
    (≤0,20 cm²/lado en el plano mesencefálico): `snHalfDepthMm` 5→2,2,
    `redNucleusRadiusMm` 2→1,5, amp 0,50→0,30 (en adulto normal es apenas
    ecogénica; la SN hiperecogénica es el signo de Parkinson para un caso
    futuro). Área medida: 0,19/0,16 cm² por lado. El piso electrónico del
    preset transcraneal baja 14 dB (`bmodeNoiseTemporalRelDb`, sólo sector):
    la sustancia blanca a ~70 mm estaba pegada al piso ocular y comprimía el
    contraste aparente de la mariposa.

46. **DEC-46** — Doppler ocular sobre la misma `VesselScene` que Willis: el
    grafo vascular retrobulbar (`src/anatomy/ocularVessels.ts`, 6 vasos/ojo
    en espacio paciente vía `fromEyeLocal`) expone `EyeGeometry.vessels` y la
    cadena Doppler (`renderColorDoppler`, `SampleVolumeIQ`,
    `insonationAngles`, `tissueMotionBasis`, `PwDopplerChain`) trabaja sobre
    `VesselScene { vessels, classify?, attenuationDb? }` en vez de
    `HeadGeometry`. La cabeza queda bit-idéntica (`colorM1Der`, `pwM1Point2`
    sin cambios); el ojo aporta `classifyEye` y atenuación por trayectoria
    (`pathAttenuationDb`, sin penalización de ventana). Vasos venosos marcados
    `venous` con velocidad plana `meanCms·modulation`. El tubo ACR cableado en
    `classifyEyeLocal` se sustituye por consulta al grafo (los AABB oculares
    se inflan 1,5 mm para que las celdas de color vean tubos submilimétricos).
    `eyeDerBmode` cambia por los nuevos vóxeles `vaso` intraneurales y
    retrobulbares; se añade el dorado `colorAcrDer`. Caso `parkinson`:
    `snEchogenicity` 2,4 (scatterScale) y `snAreaCm2Scale` 1,8 (geometría).

47. **DEC-47** — Persistencia B-mode (0–4) como promedio temporal de
    presentación: `bmodePersist` mezcla fotogramas en dB
    (`dbP = α·dbP + (1−α)·db`, α ∈ {0, 0,35, 0,55, 0,7, 0,8}) con clave
    (estación, lado, dimensiones, profundidad, densidad, renderizador); se
    reinicia al cambiar de estación, al descongelar y al cambiar el nivel. El
    cine guarda el `db` crudo. En la ruta GPU la persistencia se aproxima por
    composición alfa del canvas (globalAlpha = 1−α), ya que el pipeline
    produce píxeles y no dB — es presentación, no adquisición. En modo
    `?clock=fixed` (e2e) la persistencia se fuerza a 0: los fotogramas son
    idénticos (idempotente) y la aproximación alfa de GPU queda fuera de la
    comparación de paridad. Mapas de gris
    (`lineal`, `sigmoide`, `gamma 0,8`) comparten la misma curva en
    `scanConvert.ts` y `scanConvert.frag.glsl` vía el uniforme `uGrayMap`;
    el dorado hashea `db`, no píxeles, así que no se mueve.

48. **DEC-48** — Estenosis focal de M1 con turbulencia post-estenótica:
    `Vessel.stenosis { sMm, lengthMm, radiusScale }` define una garganta
    gaussiana sobre el arco (`vesselRadiusAt`); `vesselDistance` sólo cambia
    de camino cuando hay estenosis (vasos sanos bit-idénticos). La velocidad
    local escala por continuidad (R/r(s))² en `CerebralFlow.velocityAt` y en
    `SampleVolumeIQ.flowBasisOf` (jet ~4× con radiusScale 0,5). Corriente
    abajo (hasta 3·L) se añade turbulencia determinista de media cero
    (σ = 0,35·(vJet − v₀), `hash3` sobre la posición cuantizada a 0,5 mm) en
    el color (`velocityAt` de `cellScatterers`) y en el PW (`vMat`), lo que
    produce el ensanchamiento espectral. El caso `estenosisM1` usa
    `vesselStenosis` (s=12 mm, L=6 mm, scale 0,5) en lugar del escalado
    difuso, que se reserva al vasoespasmo.
49. **DEC-49** — Navegación de sonda sobre la superficie craneal: la sonda
    añade `offsetVMm` (deslizamiento en el eje de elevación, −20…20 mm) y
    `tiltVDeg` (angulación del haz en el plano de elevación, −25…25°); con
    ambos a 0 la pose es bit-idéntica a la anterior. La elevación es
    cross(forward, lateral) antes del giro de marcador. Al deslizar, el
    origen temporal se proyecta sobre el cuero cabelludo
    (`surfacePoint(head, p, 7,7)`, nivel elipsoide 1 + scalp/R_dir) y el haz
    atraviesa hueso más grueso fuera de la ventana — la caída de imagen es
    emergente (≈13 dB a +18 mm superior, ~21 dB
    a −18 mm inferior), sin rama especial; `elev = cross(lateral, forward)`
    apunta a +y (superior), así que +offsetVMm sube por la ventana. La ventana útil se
    estrechó (`windowRadiusMm` 18 → 12 mm, ~24 mm efectivos) para que salirse
    de ella degrade de verdad; el dorado `temporalDerBmode` se regeneró
    (los rayos muy oblicuos ganan espesor óseo; ojo/color/PW sin cambios).
    Teclado: flechas deslizan 1 mm (←→ lateral, ↑↓ vertical),
    Mayús+flechas inclinan/angulan 1°, Q/E giran el marcador 5°, +/− la
    presión 10 %, R reinicia (0/0/0/0/0, 30 %); inactivo con un control
    editable enfocado; los deslizadores se sincronizan desde el estado cada
    frame y los cambios se registran como eventos `probe` (máx. 1/300 ms).50. **DEC-50** — Casos del plano diencefálico (línea media e hidrocefalia):
    `buildReferenceHead` acepta overrides de diencéfalo
    (`midlineShiftMm`, `thirdVentricleWidthMm`, `frontalHornScale`) y la
    geometría queda en `HeadGeometry` (`thirdVentricleWidthMm`,
    `frontalHornScale`, `midlineShiftMm`), de modo que `classifyHead`,
    `landmarkAt`, `diencephalonShapes` y la losa de la hoz siguen la verdad
    del caso. El desplazamiento +x mueve III ventrículo, tálamos, pineal,
    cuernos frontales y hoz pero NO el mesencéfalo (masa supratentorial,
    LIM-28). Las verdades se exponen en `sim.truths` y viajan en la sección
    `instructor` del export. El debrief valida la medida del III ventrículo
    (±1 mm) y el desplazamiento (der − izq)/2 (±1,5 mm) solo cuando la
    calibración `distancia` se tomó en estación temporal con tilt ≥ 8°
    (eventos `measurement` con `station`/`tiltDeg`/`valueMm`). Overlay
    docente: etiquetas anatómicas sobre el B-mode temporal cuando el centro
    está a ≤3 mm del plano en elevación.
50. **DEC-51** — Rediseño UX y vista de cabeza interactiva: la interfaz
    pasa a tres columnas (Exploración · imagen · Equipo) con revelación
    progresiva — TGC, Doppler extra, Avanzado e Instructor viven en
    `<details>`, y el grupo Doppler solo se muestra en estación temporal
    o con PW activo (`body[data-station]`/`[data-pw]`). El `#spectral`
    permanece en el DOM pero colapsa (`visibility`/`height:0`) cuando PW
    está apagado. `#caso` se mueve a la cabecera y las 4 pestañas de
    estación forman un control segmentado. El CSS vive en
    `src/ui/styles.css` importado desde `main.ts`. Nueva vista
    `#headView` (`src/ui/headView3d.ts`): cabeza estilizada construida
    desde la geometría del caso (cuero cabelludo = `skullRadii`+7 mm,
    ojos, nariz, orejas, hotspots de ventanas/globos) con la sonda
    compartida (`src/ui/probeMesh.ts`: `probeBasis`, `buildProbeGroup`,
    `updateProbePose`, reexportada desde `navigator3d.ts`). Mapa de
    interacción: arrastrar la sonda proyecta el raycast sobre elipsoide
    al plano tangente de la estación (`hitToOffsets` →
    `offsetMm`/`offsetVMm`); rueda = rotación de marcador ±5°;
    Mayús+arrastrar = `tiltVDeg`/`tiltDeg` (0,25°/px); Alt+rueda =
    presión ±5 %; arrastrar el fondo orbita; doble clic reinicia la
    cámara; los hotspots cambian de estación por el mismo camino que las
    pestañas (`onStationChange`). Los ajustes comparten los mismos
    `s.offsetMm/s.offsetVMm/s.tiltDeg/...` que los deslizadores, así que
    ambos permanecen sincronizados sin estado duplicado. La cámara enmarca
    la cabeza completa (objetivo = centro del cráneo, fov 32, ~4,8×radio
    máx., zoom 150–500 mm, azimut 55°/30° por estación); la sonda es un
    transductor realista (huella 50×12/26×18 mm, cuerpo capsular gris,
    muesca ámbar +lateral, cable). El deslizamiento descompone el delta del
    puntero sobre los ejes tangentes proyectados a pantalla y limita la
    fuga vertical a <25 % del cambio lateral en arrastres horizontales.
    En la estación ocular el navegador anatómico encuadra el globo
    examinado (`navigatorFrame` → `eye.center`).
51. **DEC-52** — Profundidad máxima transtemporal 160 mm: el deslizador
    `#depth` es compartido entre estaciones, así que `setStation` fija
    `min`/`max` por estación (ocular 30–60 mm, temporal 30–160 mm) y acota
    el valor actual (`DEPTH_RANGE_MM` en `src/ui/main.ts`); el paso sigue
    siendo 5 mm y el valor de fábrica temporal no cambia (90 mm). Motivo:
    el Doppler cerebral necesita ver la tabla ósea contralateral (~13–15 cm
    en el adulto) y el eje vertebrobasilar/ACP a 12–15 cm; con 110 mm el
    campo se cortaba antes de la línea media contralateral. Coste medido en
    Node (CPU, densidad media, color): 174 ms a 90 mm → 211 ms a 160 mm
    (+20 %; la imagen dB pasa de 176×78 a 176×139). La escala de
    profundidad (`drawScale`) marca cada 10 mm y a 160 mm dibuja 15 marcas
    en 480 px sin solaparse; `scanConvert` deriva la escala del sector de
    la profundidad y no tiene límites codificados.
52. **DEC-53** — Arquitectura de información por examen, dúplex y roles de
    botón. (a) La cabecera pasa de cuatro pestañas planas a **dos píldoras
    de examen** («Vaina del nervio óptico» y «Doppler transcraneal», con
    icono SVG inline) que contienen los botones de lado **D/I**; esos
    botones siguen siendo los `.tab[data-station][data-side]` que usan las
    pruebas e2e, y pulsar el cuerpo de la píldora cambia de examen
    conservando el lado. `body[data-station]` se fija en `setStation` (no
    solo en el bucle de frames) y decide qué herramientas se muestran:
    ocular → `#dvno #dte #onsdProtocol #exportOnsd`; temporal → `#pw
#audio` y chips de plano; `#caliper #freeze #cine #teaching #export`
    siempre. (b) **Dúplex**: con PW activo (`body[data-pw='true']`) la
    columna central se acota al alto de la ventana y se reparte entre
    B-mode (`--duplex`, 60 % por defecto) y espectrograma (resto, ancho
    completo); un separador `#splitter` arrastrable ajusta `--duplex` entre
    35 y 70 % (teclado ↑/↓, ARIA `separator`) y persiste en
    `localStorage['neurosono.duplex']`. El B-mode se encaja 4:3 dentro de su
    hueco por `ResizeObserver` (`fitBmode`) para no deformar ni recortar la
    imagen (los clics se mapean por `getBoundingClientRect`). El backing
    store de `#spectral` sube de 640×224 a 640×360 (`drawSpectrum` y
    `rasterizeSpectrogram` leen `ctx.canvas.height`, sin constantes). Con
    PW apagado el espectro colapsa a una tira de 28 px. (c) **Roles de
    botón**: `.btn-primary` (`#freeze`, acento; ámbar + «Reanudar» al
    congelar, con icono pausa/reproducir), `.btn-mode` (`#pw #audio
#teaching`, contorneado con punto de estado), `.btn-tool` (`#caliper
#dvno #dte #onsdProtocol`, superficie neutra con tinte al activar),
    `.btn-export` (`#export #exportOnsd #debrief #exportDebrief`, fantasma
    con icono), `.chip` (`#planoMesencefalico/#planoDiencefalico`, con
    `.on` sincronizado desde `s.tiltDeg` 0°/10°). Los botones de
    exportación se colocan al extremo derecho de la barra de estado bajo la
    imagen (no dentro de la barra flotante) para que la barra de
    herramientas quepa en una sola fila a 1440 px en el examen ocular. La
    etiqueta de `#freeze` vive en `#freezeLabel` y el atajo en `#freezeKey`
    (vaciado al congelar) para que `toHaveText('Reanudar')` siga siendo
    exacto. (d) Sistema visual: tokens en `:root` (`--bg #0b0e13`, `--panel
#12161d`, `--panel-2`, `--border`, `--text`, `--muted`, `--accent
#4da3ff`, `--accent-2`, `--ok`, `--warn`, `--danger`, radio 12 px,
    sombra), paneles como tarjetas con cabecera y chevron en `<details>`,
    deslizadores con pista de 4 px y pulgar de 14 px, y `#readouts` como
    mosaico de `.stat` (`.k` etiqueta / `.v` valor con `<small>` unidad;
    `.wide` a dos columnas para texto largo). `updateReadouts` mantiene
    etiqueta y valor en líneas distintas de `innerText`, que es lo que lee
    la prueba e2e (`PSV\n80`). Iconos: sprite `<svg class="sprite">` con
    `<symbol>` y `<use>`, sin fuentes ni CDN.
53. **DEC-54** — Doppler color como modo explícito, arterias ciliares
    posteriores pegadas a la vaina y rendimiento de extremo a extremo.
    (a) **Color = modo**: `AppState.colorOn` (falso al cargar y en cada
    `setStation`), botón `#color` (`.btn-mode`, icono `i-color`, atajo
    **F**, sin conflicto con Espacio/P/C/D/flechas/Q/E/R/±). Apagado:
    `RenderRequest.color = false` → el worker no llama a
    `renderColorDoppler`; sin superposición, sin caja (tampoco en el
    navegador 3D), sin arrastre de caja y con la persistencia de color
    descartada. PW no fuerza el color (dúplex PW sobre escala de grises es
    válido); la puerta PW se dibuja con o sin color. El modo acústico
    (MI/TI, exportación) sale de `imagingMode(s)`: PW > color > B-mode — el
    ojo sin color pasa a declarar `bmode`. El conmutador queda en el
    debriefing (`settings color=on/off`) y la exportación incluye
    `colorOn`. Las pruebas e2e que necesitan color pulsan `#color`
    (`AGENTS.md`). (b) **Línea de color espuria del ojo** — diagnóstico con
    la verdad del modelo (pose ojo D por defecto, caja 18–40 mm, corte
    lineal 176 líneas; semigrosor de corte en elevación 1,0 mm): la línea
    naranja vertical a la derecha era `acp-sup-der`, un tubo recto de dos
    puntos (local x = +3→+4 mm, y = −1→−1,5 mm, de s = 10 mm a la pared)
    que en imagen caía en u = +2…+4,9 mm, z = 26,2→38 mm, es decir
    5,5–7,5 mm a la derecha del eje del nervio y 1–1,5 mm fuera del plano;
    el temblor/deriva de la mano (±0,9 mm en elevación) lo metía en el
    grosor de corte en 21 de 40 fotogramas (barrido 0–20 s). El par
    azul+naranja «sobre la franja izquierda» era `acp-inf-der` (u = −1,9…
    −4,6 mm, z = 25,6→37 mm, cruzando en diagonal el lado izquierdo del
    nervio/LCR; 12/40 fotogramas) junto a la VCR azul. La ACR/VCR no
    estaban mal: dentro del parénquima (vecinos a ±0,5 mm = `nervioOptico`
    hasta s = 12 mm) y, en el B-mode renderizado a reloj fijo, centradas
    entre los dos mínimos de LCR a ±0,1 mm (z = 28/33/38 mm: punto medio
    de las franjas −1,81/−2,55/−3,92 mm frente a −1,9/−2,67/−3,9 mm del
    par), así que su desplazamiento no se tocó. La AO no aparece en la caja
    en ningún fotograma: cruza el nervio 6 mm por encima del plano a
    s ≈ 15 mm (≈42 mm de profundidad) y solo entra en el plano a 48–67 mm,
    fuera de la caja y de la profundidad por defecto; la VOS tampoco.
    Corrección (`ocularVessels.ts`): las ciliares pasan a `acp-lat-*`
    (supero-temporal) y `acp-med-*` (ínfero-nasal), nacen a s = 7 mm, van a
    `major(s) + 1,0 mm` del eje con el desplazamiento aplicado en el marco
    local de la sección del nervio (tangente, normal horizontal
    `t × ŷ`, `h × t`) — siguen la curva nasal y la tortuosidad — con una
    ondulación suave (±0,45 mm, 5 puntos de control Catmull-Rom) a 30° del
    meridiano horizontal, y perforan la pared a 2,3 mm del centro de la
    papila. En el corte transversal por defecto ya solo aparecen los
    últimos milímetros junto a la vaina (celdas de color siempre a
    ≤ 1,5 mm de la dura; prueba nueva en `ocularDoppler.test.ts`, que falla
    con la geometría anterior). Dorado `colorAcrDer` regenerado por este
    cambio (e22b4718 → 4b60e859); `eyeDerBmode` y los demás no cambian.
    (c) **Rendimiento** — medido en el navegador (Chromium sin cabeza con
    GPU Metal, 1440×900, 10 s por configuración). El perfil del hilo
    principal mostraba que ~75 % del tiempo sin PW era
    `getProgramInfoLog`/`getShaderInfoLog`: `Navigator3D.updatePlane`
    creaba y liberaba sus materiales en cada rAF y Three.js recompilaba el
    GLSL en cada fotograma. Cambios, por orden de ganancia: materiales
    persistentes en el navegador (solo se liberan geometrías), plano
    reconstruido solo cuando cambia su clave y pintado como mucho a 15 Hz
    salvo que la cámara se mueva (`renderIfNeeded`); la vista de cabeza
    reutiliza su material y libera las geometrías que antes se acumulaban.
    LUT de conversión de barrido (`scanLut`: vecinos/pesos bilineales y
    (z, u) por píxel, por tipo de sonda/ancho/profundidad/malla/canvas, sin
    `atan2`/`hypot` por píxel) compartida por el B-mode y la superposición
    de color, con el color compuesto sobre el mismo `ImageData` reutilizado
    antes de un único `putImageData` (ruta CPU; la GPU sigue releyendo el
    canvas). Paneles DOM a 4 Hz con `innerHTML` solo si cambia y sin
    recalcular `<details>` cerrados (cualquier tecla/clic/entrada fuerza
    el refresco). Espectrograma: percentil por selección en lugar de
    ordenar ~80 k valores por rAF, sumas y vecinos de bin por fila (salida
    bit a bit idéntica, comprobada contra la versión previa). Canalización
    de render (`RenderPool`): 2 workers (`?workers=1..4`), cada uno con una
    solicitud en vuelo, sin el tope fijo de 90 ms y como mucho a 30 fps;
    una respuesta más antigua que la ya dibujada se descarta. En el
    worker, solo cambios bit a bit idénticos: segmentos precalculados por
    vaso, prefiltro por d² antes de `Math.hypot` (margen 1e-12), descarte
    por esferas de bloques de 8 segmentos y cota inferior por vaso
    (`vesselLowerBound`) en el vaso primario de cada celda de color, en la
    base tisular del clutter y en `vesselAtBlood`; `vesselContains` con
    salida temprana para clasificar; memo de la última clasificación en
    `eyeScene` (como `headScene`); memo de la derivada de la forma arterial
    por fase; y `setPhysiology` solo si la fisiología cambió (antes
    reconstruía ambos ojos en cada solicitud). Todos los dorados salvo
    `colorAcrDer` (por (b)) se mantienen. Se descartó mover la conversión
    de barrido al worker: con la LUT cuesta 3–11 ms en el hilo principal y
    el worker es el cuello de botella de los fps, así que añadirle trabajo
    los bajaría; la persistencia de color sigue por celda en el hilo
    principal (comportamiento idéntico). Pendiente: la cadena PW (física
    del volumen de muestra a la PRF, `SampleVolume.generate`) sigue en el
    hilo principal y domina con PW activo (~40 % del perfil, 33–70 ms por
    rAF); moverla a un worker es el siguiente paso.
54. **DEC-55** — Cadena PW en un worker dedicado y deriva de mano sin
    despegar la sonda. (a) **Arquitectura**: `src/ui/pwWorker.ts` es dueño
    de la `PwDopplerChain` (volumen de muestra → filtro de pared → espectro)
    y obtiene el `ReferenceCase` con la misma caché `renderCase(seed,
variante, caso)` que el worker de render. El protocolo vive en
    `src/app/pwProtocol.ts` (tipos puros + `handlePwMessage`, sin DOM ni
    Worker): `configure` (semilla, variante, caso, estación, lado,
    fisiología; crea la cadena si cambia estación-lado), `setGate`
    (`GateGeometry` + equipo: PRF, f0, ganancia dB, filtro de pared,
    amplitud de emisión; `begin(…, tSync)` solo si el equipo cambió o se
    pide `resync`), `step` (tStart, dt, micro-movimiento de mano →
    `handMotionVelocityMmS(t, seed)`, ¿audio?) y `reset`. Cada `step`
    responde con las columnas nuevas empaquetadas (`times`/`prfHz`
    Float64Array + `power` Float32Array `count × fftSize`, transferidos),
    el IQ filtrado del lote para el audio (transferido) y la composición de
    la puerta (`bloodFraction`, vaso dominante). El orden de llamadas a la
    cadena es el del antiguo `PwController.step` (begin → setGate → step →
    flush): para una secuencia dada de (tStart, dt) la salida es idéntica
    bit a bit a la de una `PwDopplerChain` directa (prueba nueva
    `tests/pwProtocol.test.ts`, 3 s con pasos irregulares y mano activa:
    columnas, IQ de audio y composición). Dorados y pruebas de validación
    siguen llamando a la cadena directamente y no cambian. (b) **Proxy**:
    `PwController` conserva su API (`step`, `latestMcaMeasure`,
    `composition`, `insonation`, `gateGeometry`, `hemodynamics`,
    `setVolume`, `setAudioEnabled`, `chainSceneKey`) y añade `columns`,
    `fftSize`, `revision`, `gateCenter` (el navegador 3D ya no calcula la
    atenuación por trayectoria en cada rAF) y `prewarm` (el worker
    construye su caso al cargar). Agrupa el dt de los rAF y envía un `step`
    como mucho cada 50 ms de tiempo real, con ≤2 en vuelo; la puerta se
    calcula con la pose (y el temblor) del final del lote, como antes por
    fotograma. Con el worker saturado el lote se acota a 0,5 s: el atraso
    más antiguo se descarta (hueco en el espectro, no segundos de retraso)
    y el siguiente `setGate` pide `resync`. Las columnas recibidas van a un
    búfer por tiempo (7 s ≥ barrido máximo 6 s; tope 4096) y las medidas se
    calculan ahí en el hilo principal (4 Hz). El audio sigue en el hilo
    principal (el `AudioContext` lo exige): el IQ recibido alimenta
    `DopplerAudio` sin cambios. `tSync` pasa a ser el `tStart` del lote
    (antes `begin` tomaba `clock.t`, el final del fotograma, y las
    columnas quedaban rotuladas un fotograma tarde; ahora coinciden con la
    semántica de `pw.test.ts`). (c) **Guarda de respuestas obsoletas**:
    `configVersion` monótono en todos los mensajes; sube al cambiar
    estación/lado, equipo, posición o longitud de la puerta, o con `reset`
    — no con el temblor de la mano. Un bloque con versión anterior (o de
    otra estación) se descarta; el lote pendiente al cambiar la
    configuración se adquiere con la anterior (sin huecos en el tiempo de
    la cadena) y su respuesta se descarta. (d) **Fallback**: sin `Worker`,
    con `?pwworker=0` o si el worker falla (`onerror`), `SyncPwTransport`
    ejecuta el mismo `handlePwMessage` en el hilo principal (como
    `SyncRenderClient`); las pruebas usan esta ruta. (e) **Espectrograma**:
    `drawSpectral` solo rasteriza si llegaron columnas (`revision`) o
    cambió algo del dibujo (barrido, mapa de color, ganancia espectral,
    rango dinámico, línea de base, inversión, f0, corrección angular,
    filtro de pared para la traza docente, tamaño del canvas) y como mucho a
    30 Hz. (f) **Búfer IQ de la cadena**: `PwDopplerChain.step` solo
    duplicaba el búfer una vez; un lote de >8192 muestras (p. ej. 1,6 s a
    6 kHz con el worker saturado) escribía fuera del `Float32Array` y el
    filtro de pared propagaba NaN para siempre (espectro vacío, PSV 0).
    Ahora crece hasta que quepa; sin efecto para pasos ≤ 0,2 s (dorados
    iguales). (g) **Deriva de mano**: `currentPose` descompone el
    desplazamiento de la mano (`handMotionDisplacementMm`) sobre `forward`
    y acota la componente que aleja la sonda del tejido a
    `HAND_MAX_RETREAT_MM` = 0,05 mm (acoplamiento con gel); la deriva
    lateral, elevacional, hacia el tejido y el jitter de inclinación se
    conservan. Medido antes (Node, ojo D y temporal D, 200 muestras en
    t ∈ [0, 60] s): el ojo retrocedía hasta 0,94 mm (t = 10,25 s) y la media
    en dB del fotograma caía de −46,0 a −57,0 dB; el temporal también
    oscurecía — 0,83 mm de retroceso (t ≈ 19 s, −37,7 → −42,7 dB) e incluso
    en t = 0 la mano bajaba el fotograma −29,8 → −37,7 dB por 0,41 mm de
    aire. Con la cota: ojo −46,0 dB en ambos instantes y temporal −30,4 /
    −29,7 dB (frente a −29,8 sin mano). En el navegador (ojo D, 20 s) el
    gris medio del B-mode bajaba a 11,5 (de 55) entre los 8 y 13 s y ahora
    queda en 54,4–55,6. La velocidad de sonda del PW
    (`handMotionVelocityMmS`) no se acota (aproximación: el Doppler del
    micro-movimiento conserva su componente axial). Prueba nueva en
    `motion.test.ts`. (h) **Medidas** (Chromium sin cabeza con GPU Metal,
    1440×900, vista previa de producción, 10 s por configuración, A = main
    y B = esta rama alternadas ABBA, carga 13–22; medias de 2 pasadas):
    ojo D color: B-mode 7,1 → 7,8 fps, espectro 49 → 19 redibujos/s,
    tareas largas 39 → 0 ms/s; ojo D sin color: 9,5 → 12,0 fps, 46 → 19/s,
    52 → 0 ms/s; TCD D color: 5,6 → 6,4 fps, 24 → 18/s, 362 → 78 ms/s; TCD D
    sin color: 6,3 → 11,1 fps, 20 → 15/s, 481 → 121 ms/s. PSV en
    `#readouts` en < 1,1 s tras colocar la puerta en todos los casos. El
    audio sigue funcionando (`AudioContext` «running», todos los bloques
    con muestras); con la cadena en el hilo principal solo se programaban
    24 de ~40 bloques de 0,2 s en 8 s, ahora 37. Pendiente: las medidas
    (`latestMcaMeasure` → `observedTrace`, suavizado + suelo por columna
    sobre 2,5 s) cuestan ~27 ms (ojo) a ~60 ms (TCD) por llamada en Node con
    la máquina cargada y siguen en el hilo principal a 4 Hz; son el
    siguiente candidato para el worker. Observado sin cambiar:
    `frameLoop` evalúa `clock.requestSteps(elapsed)` en la condición del
    `for`, así que el reloj de simulación avanza ~1,2× el tiempo real a
    60 fps (anterior a este cambio).
55. **DEC-56** — Modo de examen guiado, medida PW cacheada y Three.js
    diferido. (a) **Guías puras**: `src/domain/guides.ts` define `Guide`
    (`vaina`, `dtc`) como listas de `GuideStep` con título, instrucción de
    1–2 frases, `check(ctx)`, pista opcional, selector del control a
    resaltar y `capture` opcional (PSV/EDV/IP/TAMax de cada M1). Las
    comprobaciones leen solo una instantánea plana (`GuideContext`) que
    `src/app/guideContext.ts` construye en la UI cada 250 ms: estación,
    lado, inclinación, rotación, desplazamientos, profundidad, ganancia,
    color/PW/congelado, puerta con `dominantVesselId` y `bloodFraction`,
    ángulo real de insonación, última medida PW, mediciones (con la
    rotación del marcador al medir y la distancia retroglobo medida por
    `nerveSection`), huecos del protocolo DVNO y la posición lateral en la
    imagen del centro del nervio a 3 mm (`patientToImage` sobre
    `fromEyeLocal(nerveCenterline(ojo, 3))`, pose sin temblor). (b)
    **Reductor**: `advance(estado, ctx, ahoraMs)` completa el paso solo si
    la comprobación se mantiene 600 ms seguidos; «Anterior» reabre un paso
    sin auto-avance hasta que la comprobación falle una vez; «Siguiente»
    manual queda marcado como omitido si no se cumplía; la guía del otro
    examen se pausa (el tiempo en pausa no cuenta) y cada guía conserva su
    progreso; la pista aparece tras 20 s activos en el paso. (c) **Pasos
    vaina**: Ojo D → profundidad 38–52 mm → |barrido| ≤ 3 mm y nervio a
    ≤ 4 mm del centro → congelar → DVNO der a 3 ± 0,5 mm retroglobo
    (distancia medida; si falta, la declarada) → DVNO der con |rotación| ≥ 80°
    → ambos planos del Ojo I (rotación < 45° transversal, ≥ 80° sagital; 45–80°
    no cuenta). Resumen: media por ojo y bilateral frente a la verdad del
    modelo por plano (transversal = `trueOnsdMm` interno; sagital = eje
    menor, excentricidad × transversal, la misma frontera interna que
    `classifyEyeLocal`), «precisa» si el error ≤ 0,3 mm, y
    > 5,8 mm → «compatible con PIC elevada», nunca diagnóstico; si la medida
    > cambia la conclusión respecto a la vaina del caso se señala. **Pasos
    > DTC**: Temporal D → |inclinación| ≤ 3° → color → PW con vaso dominante
    > `m1-*` y ≥ 20 % de sangre → ángulo real ≤ 30° → medida con ≥ 2 latidos
    > (captura) → Temporal I con M1 medida (captura). Resumen: asimetría PSV
    > (> 30 % señalada), IP (0,6–1,1 normal; > 1,2 elevado) y Lindegaard con
    > la ACI del caso. (d) **UI**: botón «Guía» (G) en la cabecera y cajón
    > lateral de 320 px, primer hijo pegajoso de la columna derecha (que se
    > ensancha a 320 px con la guía abierta): progreso, paso, pista, lista de
    > pasos con tiempos, Anterior/Siguiente/Reiniciar y, en el resumen,
    > «Exportar informe» (`exportGuideReport`: guía, tiempos, capturas,
    > resumen, informe DVNO y `exportPayload`). El control del paso recibe
    > `.guide-target` (anillo pulsante; los deslizadores, su `label.ctl`),
    > se abren sus `<details>` y solo si no se ve entero se desplaza lo
    > mínimo. Debriefing: eventos `guide` (paso, tiempo, omitido; `reset` al
    > reiniciar) y sección «Guía» (`guideSections`, último intento por paso).
    > (e) **Medida PW**: `latestMcaMeasure` se cachea por `revision` del
    > búfer de columnas y por los ajustes de medida (f0, corrección angular,
    > inversión, filtro de pared, FFT); con columnas nuevas recalcula como
    > mucho cada 500 ms (la lectura puede ir ~0,5 s por detrás), y un cambio
    > de ajuste recalcula en el acto. Node, TCD D en M1, 6 s de PW síncrono:
    > antes 46,6 ms por llamada aun sin columnas nuevas y 52,5 ms de media
    > (máx. 69) en el patrón real de 4 llamadas/s (~210 ms/s de hilo
    > principal); ahora 0,001 ms por llamada repetida y 27,5 ms de media a
    > 4 Hz (máx. 62; ~2 recálculos/s, ~110 ms/s). (f) **Three.js diferido**:
    > `Navigator3D` y `HeadView3D` se importan con `import()` tras el primer
    > B-mode pintado; los canvas existen desde el principio con un esqueleto
    > animado (`canvas.loading3d`) y `manualChunks` separa `three`. Chunk
    > `index` 789,00 kB (gzip 213,87) → 212,93 kB (70,95) + `three` 572,48 kB
    > (142,56) + `navigator3d` 11,68 kB + `headView3d` 10,22 kB + `probeMesh`
    > 2,18 kB. (g) **Corrección**: el clic en el B-mode volvía a registrar la
    > última medición en el debriefing aunque no se midiera nada; ahora solo
    > se registra una medición nueva, con la rotación previa al clic (el
    > protocolo DVNO gira el marcador al rellenar un hueco). Observado sin
    > cambiar: en el Ojo I el nervio está inclinado ~18° en el plano de imagen
    > a 3 mm (tortuosidad) y la frontera elíptica de `classifyEyeLocal` usa el
    > desplazamiento x/y local, así que el diámetro perpendicular visible es
    > ~4,96 mm frente a 4,70 mm de `trueOnsdMm` (Ojo D: 4,61 frente a 4,60).
    > **Corregido en DEC-57** (marco de la sección perpendicular): ahora
    > 4,68 frente a 4,70 (Ojo I) y 4,58 frente a 4,60 (Ojo D).
56. **DEC-57** — Marco de la sección perpendicular del nervio óptico.
    `nerveSection` expresaba el desplazamiento al centro más cercano en x/y
    locales del ojo e ignoraba que la línea central está curvada e inclinada
    (curva nasal + tortuosidad + mirada); donde el nervio es oblicuo la
    elipse clasificada era más ancha que la sección perpendicular real
    (factor 1/cos θ: Ojo I, θ ≈ 18° en la imagen a 3 mm, 4,96 frente a
    4,70 mm). (a) **Marco compartido** `nerveFrame(g, s)` en
    `src/anatomy/eye.ts`: tangente analítica `nerveTangent` (derivada
    exacta de `nerveCenterline`; coincide con la diferencia central de
    h = 0,05 mm a < 1e-4), u = normaliza(eₓ − (eₓ·t)t) (eje mayor ≈
    temporal) y v = u × t (eje menor ≈ superior; con t posterior, t × u
    daría −y, así que se usa u × t). `nerveSection` devuelve
    `inPlane` = (off·u, off·v, off·t) y `classifyEyeLocal` evalúa la elipse
    en (u, v) y el radio del nervio con √(u² + v²). Un paso de
    Gauss-Newton tras el pulido parabólico reduce el residuo axial off·t de
    ~0,25 mm a < 0,05 mm (y fija s = 0 en el extremo del globo en vez de
    0,05). (b) **Tolerancia axial**: la vaina exige −5 mm ≤ off·t ≤ 1 mm;
    en el interior off·t ≈ 0 y en s = 0 la cuña entre el globo y el plano
    de la sección inclinado llega a −1,5 mm (N1) y −2,8 mm (parada
    circulatoria, vaina máxima), así que no recorta la unión vaina–esclera;
    en s = 40 el nervio termina 1 mm tras el ápex (hueso) en vez de
    prolongarse sin fin. (c) **Rechazo exacto**: la caja x/y de
    `nerveCurve` acumula por muestra la función soporte de la elipse
    rotada, √(a²uₓ² + b²vₓ²) + 5·|tₓ| (ídem en y), más 0,5 mm por el
    muestreo de 0,25 mm; un test recorre la frontera de la vaina a paso
    0,05 mm con τ ∈ {−5, 0, 1} en todos los casos y exige ≥ 0,2 mm de
    holgura. (d) **Mismo marco en todo**: vasos retinianos centrales
    (desplazamiento fijo en (u, v), antes en x/y locales) y ciliares
    posteriores (`nerveFrame` sustituye a `nerveSectionFrame`, que usaba
    t × ŷ y diferencias de 0,25 mm) en `ocularVessels.ts`; en el navegador
    3D la vaina es un tubo elíptico con el marco por muestra y radios
    `sheathRadiiAt(s)` (antes circular con el radio mayor a 3 mm) y el
    anillo DVNO a 3 mm es la dura elíptica orientada con t y u en
    coordenadas del paciente (antes la tangente local se copiaba sin rotar:
    en el Ojo I, temporal = −x, quedaba especular). (e) **Verdad**:
    `trueOnsdMm` conserva su semántica (eje mayor, sección perpendicular) y
    se añade `trueOnsdMinorMm` (externa 2·menor; interna = frontera LCR/dura
    escalada = excentricidad × interna mayor), que usa `guideTruth` para el
    plano sagital. Medido (marcha a 0,01 mm por `classifyEye` desde el
    centro a 3 mm, externa U/V · interna U/V): antes Ojo D 5,36/4,27 ·
    4,65/3,71 y Ojo I 5,66/4,33 · 4,93/3,77; ahora 5,30/4,27 · 4,60/3,71 y
    5,40/4,33 · 4,70/3,77 (verdad 5,30/4,27 · 4,60/3,71 y 5,40/4,34 ·
    4,70/3,77). En el plano B-mode de la guía (⟂ a la dirección del nervio
    en la imagen, interna): Ojo D transversal 4,61 → 4,58, Ojo I 4,96 →
    4,68; sagital sin cambio (3,68 y 3,76; cuerda de un plano que no pasa
    exactamente por el centro). Guía completa en la vista previa de
    producción (clics de Playwright): 4,58 / 3,66 / 4,68 / 3,76 mm, error
    frente al modelo 0,06 → 0,02 mm. **Dorados**: `eyeDerBmode`
    (b5b8d69c → 671488e4; frontera de la vaina en el marco perpendicular) y
    `colorAcrDer` (4b60e859 → 96f86b1b; ACR/VCR desplazadas en (u, v) y
    ciliares con el marco nuevo) cambian; `temporalDerBmode`, `pwM1Point2`
    y `colorM1Der` no.
57. **DEC-58** — Ventana submandibular y Lindegaard medido.
    El índice de Lindegaard dividía la TAMax de la ACM por una constante del
    caso (LIM-02). (a) **Anatomía** `src/anatomy/neck.ts` (pura): marco local por
    lado anclado en el punto cutáneo submandibular (x = ±36, y = −74,
    z = 12 mm, marco de la cabeza) con haz por defecto craneal ~30° desde la
    vertical hacia la base del cráneo; piel 1,5 mm + subcutáneo hasta 4 mm,
    glándula submandibular (elipsoide homogéneo, algo ecogénico), digástrico
    y milohioideo (hipoecoicos), rama mandibular (hueso, sombra lateral),
    ACI distal (radio 2,2 mm, cruza el haz central a ~45 mm, ángulo de
    insonación ~7°, continúa hasta ≤ 6 mm del sifón `ica-*`), ACE medial y
    anterior con ramas facial y lingual, y yugular interna lateral
    (radio 4,5 mm, venosa, hacia la sonda). Materiales nuevos:
    `grasaSubcutanea`, `glandulaSubmandibular`, `musculoCervical`,
    `tejidoCervical`. (b) **Caudal**: `neckIcaFlowMlMin` = M1 + A1 + AComP
    ipsilaterales (= sifón de `buildWillisVessels`) con la misma relación
    Q = v̄·πr²·0,6; la hemodinámica del caso (`flowFactor`, onda) modula la
    ACI igual que la ACM, así que la hiperemia sube ambas y el vasoespasmo
    (radio de M1 reducido, caudal igual) solo la ACM. Radio 2,2 mm en vez de
    2,6: con el caudal de Willis (≈ 326 ml/min) 2,6 mm daría TAMax ≈ 26 cm/s
    y un Lindegaard normal > 2; 2,2 mm da TAMax 35,7, PSV/EDV 58/22 cm/s.
    (c) **Onda de alta resistencia**: `Vessel.waveform?: 'baja' | 'alta'`;
    `'alta'` usa `highResistanceShape` (pico φ≈0,12, incisura φ≈0,24,
    rebote φ≈0,34, cola baja; media 0,157) entre EDV y PSV, sin
    hemodinámica cerebral. (d) **Estación** `Station` += `'submandibular'`
    (mismo examen DTC, sonda sectorial 2 MHz): `submandibularPose` (mismos
    controles; derecha de la imagen = lateral), ajustes de fábrica 70 mm,
    foco 45, ganancia −2 dB (sin cráneo el eco llega ~16 dB más fuerte),
    caja color 25–60 mm y puerta a 45 mm; `neckScene`/`neckDopplerScene` y
    `dopplerSceneFor` en `renderRequest.ts` alimentan B-mode, color, PW e
    insonación como la escena ocular. TIS (no TIC) en el rótulo acústico.
    (e) **Resiembra PW**: en vasos largos casi paralelos al haz la caja de
    la puerta cubre < 10 % de la línea central y los 40 intentos de
    reentrada fallaban (~5 %), convirtiendo la sangre en tejido: la puerta
    en la ACI se vaciaba en ~1 s. `pointOnVesselInBoxFallback` elige, sin
    consumir el RNG, un segmento cuyo punto medio cae en la caja; los vasos
    cortos casi nunca llegan ahí y los dorados existentes no cambian.
    (f) **Lindegaard**: `PwController` guarda en `AppState.icaMeasured` la
    última TAMax por lado con puerta en `aci-*` (≥ 20 % de sangre, ≥ 2
    latidos) y su tiempo; en temporal con puerta en M1, `lindegaard()` usa
    la ACI medida del MISMO lado («ACI medida») o la de referencia del caso
    («ACI de referencia»), con interpretación < 3 hiperemia/normal, 3–6
    vasoespasmo leve-moderado, > 6 grave. El debrief de vasoespasmo usa los
    índices medidos si existen; la exportación incluye el índice, el medido,
    el de referencia y las ACI medidas. La guía DTC añade dos pasos
    opcionales (ACI submandibular con ángulo ≤ 30°; Lindegaard con ACI
    medida) y el resumen rotula el origen del denominador. (g) **UI**:
    sub-conmutador «Ventana: Temporal | Submandibular» (`.win`) dentro de la
    píldora DTC; D/I de la ventana activa (`.tab[data-station=…]`, los
    selectores temporales no cambian), hotspot bajo el ángulo mandibular y
    mandíbula estilizada en la vista de cabeza, vasos cervicales en el
    navegador. Medido (lado izq, PW 3 s con la puerta de fábrica de cada
    ventana; M1 con PRF 16 kHz; TAMax ACM / ACI → índice): normal
    48,9 / 33,3 → 1,47; vasoespasmo 119,5 / 31,9 → 3,75 (con la ACI de
    referencia del caso, 45 cm/s, sería 2,66 < 3); hipercapnia 88,4 / 58,4 →
    1,51. Modelo (TAMax verdadera): 55,0 / 35,7 → 1,54; 147,2 / 34,4 → 4,28;
    100,3 / 65,2 → 1,54. **Dorados**: se añaden `submandibularDerBmode` y
    `colorAciDer`; los existentes no cambian.
58. **DEC-59** — Vistas 3D coordinadas, sin micro-movimiento de mano y cabeza
    escaneada. Petición clínica: «Exploración» y «Anatomía» no parecían tener
    las mismas posiciones; quitar los micromovimientos; cara mucho más realista.
    (a) **Cámaras enlazadas** (`src/ui/viewLink.ts`, puro): un único preset por
    estación y lado, `viewPreset(station, side)` → dirección objetivo→cámara +
    «arriba», usado por las dos vistas (antes el navegador miraba el globo desde
    abajo y medial — yaw −25°, pitch −18° — y la cabeza desde delante-derecha).
    Presets (azimut desde +z hacia el lado explorado / elevación): ojo 48°/22°
    (frontal-lateral-superior: la sonda sobre el párpado y el globo/nervio se
    leen igual), temporal 45°/55° (3/4 desde arriba; la M1 corre hacia la sonda
    y en una vista lateral pura se ve de punta; el plano mesencefálico es
    axial), submandibular 58°/−14°. En temporal el objetivo del navegador se
    desplaza un 40 % desde el centro del polígono hacia la ventana explorada y
    la distancia pasa de 2,2 a 2,9 radios, para que la sonda y la M1 ipsilateral
    entren en el encuadre. `ViewLink` es un bus bidireccional: la vista de
    cabeza (maestra) publica su dirección en cada `change` de OrbitControls y al
    reiniciar; el navegador coloca su cámara en la misma dirección desde SU
    objetivo y a SU distancia (encuadre propio), con el mismo «arriba»; orbitar
    el navegador arrastra la cabeza igual. Guardas contra bucles: no se
    republica durante el despacho ni una orientación a ≤ 1e-7 de la vigente (el
    eco de la vista que la aplicó). Prueba: con cualquier dirección de la
    cabeza, la del navegador coincide a 1e-9; el yaw/pitch del navegador sale
    del mismo preset (1e-12). (b) **Misma pose**: ambas vistas reciben en cada
    fotograma el mismo objeto `ProbePose` de `currentPose` en main.ts. Pista de
    orientación idéntica: muesca del marcador opaca y del mismo color
    (`MARKER_COLOR`, antes 85 % de opacidad en el navegador) y gizmo de ejes
    L/R/S/I (+A) en la esquina superior izquierda de las dos vistas
    (`src/ui/axisGizmo.ts`, segunda escena ortográfica con el cuaternión de la
    cámara principal). La vista de cabeza solo pinta si hay cambios
    (`renderIfNeeded`: pose, cámara enlazada, asset cargado); antes una pose
    cambiada dentro de la ventana de 150 ms podía quedarse sin pintar. (c)
    **Micro-movimiento eliminado**: fuera `#handMotion` (y `.switchRow`),
    `AppState.handMotion`, `RenderRequest.handMotion`,
    `PwStepMessage.handMotion`, `handMotionDisplacementMm`,
    `handMotionVelocityMmS`, `HAND_MAX_RETREAT_MM`, `handTremorVelocityMmS` y
    los parámetros `doppler.handTremorMmS`/`handDriftFastMm`/`handDriftSlowMm`
    (y sus pruebas; deja sin objeto la deriva de mano de DEC-55). `currentPose`
    es `stationPose`: la sonda solo se mueve si la mueve el usuario; la cadena
    PW recibe velocidad de sonda nula. Los dorados se generaron sin
    micro-movimiento y no cambian. (d) **Cabeza escaneada**: «Infinite, 3D Head
    Scan» de Lee Perry-Smith (Infinite-Realities), distribuida con los ejemplos
    de three.js (`examples/models/gltf/LeePerrySmith/`, no incluida en el
    paquete npm; descargada de la etiqueta `r186`, la versión instalada).
    Licencia verificada en `LeePerrySmith_License.txt` del mismo directorio: «…
    is licensed under a Creative Commons Attribution 3.0 Unported License» → se
    usa la opción (a) del plan, no la cabeza procedural. Archivos sin modificar
    en `public/models/head/` (malla 405 KB, color 148 KB, normales 147 KB +
    licencia); atribución en `docs/PROVENANCE.md` y en el pie («Acerca de /
    créditos»); `provenance:check` verifica SHA-256, archivo de licencia y que
    no haya recursos sin fila. Carga diferida con `GLTFLoader` (import dinámico
    desde la vista de cabeza); `MeshStandardMaterial` con mapa de color sRGB,
    normales (×0,8), rugosidad 0,6 y un emisivo cálido mínimo; hemisferio
    cálido, luz clave, contraluz frío y relleno. La malla es una cabeza completa
    cerrada (cortada en los hombros) con los ojos cerrados, así que no hace
    falta completar la nuca con el elipsoide: la cabeza estilizada (incluidos
    los globos, que atravesarían los párpados) se oculta al cargar y queda como
    respaldo (`?headmodel=0` la fuerza). **Ajuste** (`src/ui/headFit.ts`, tabla
    con comentario): centros de las hendiduras palpebrales medidos a mano sobre
    renders con textura y confirmados por raycast (Ojo D x = −0,71, Ojo I x =
    +0,50, y = 1,66, z = 1,946, en unidades del asset; +y arriba, +z anterior,
    −x derecha: el marco del caso); semejanza de escala uniforme 66/1,21 = 54,5
    mm/unidad y traslación que lleva los centros oculares del asset (párpado −
    radio medio − 3,2 mm) a `sim.eyes.*.center` (exacto; el párpado queda a ≤
    0,09 mm del contacto de la sonda por la diferencia de radios D/I).
    Desviación: la anchura del cráneo escaneado al nivel de `skullCenter`
    resulta 170 mm frente a los 148 mm de `skullRadii.x·2 + 14` (+15 %): la
    razón distancia interpupilar/anchura del elipsoide (0,45) es mayor que la
    del escaneo (0,39) y ninguna anisotropía ≤ 10 % reconcilia ambas sin mover
    los ojos, que mandan (la sonda debe apoyar en el párpado). **Contacto
    visual**: solo en esta vista, la sonda y su plano se desplazan a lo largo
    del haz hasta la piel escaneada (rayo desde 120 mm fuera; corrección ≤ 45
    mm, si no se deja la pose física): en el ojo cae sobre el párpado cerrado
    (−0,1 mm en el ojo D por defecto); la pose física no cambia. Los anillos de
    ventana se recolocan sobre la piel por raycast. Coste medido (SwiftShader,
    230×230 px CSS, DPR 1, `?perf3d` = `gl.finish()` tras pintar, 12 órbitas):
    escaneo mediana 0,6 ms (máx. 0,8), estilizada 0,5 ms (máx. 2,8); la vista
    sigue pintando solo con cambios. GLTFLoader va en su chunk `three-gltf` (44
    kB, import dinámico al cargar el escaneo); el chunk `three` pasa de ~575 a
    620 kB por las clases del núcleo que usa el cargador (límite de aviso 600 →
    650 kB). **Dorados**: sin cambios.
59. **DEC-60** — «Ventana óptima». Petición clínica: un botón que muestre en
    todas las ventanas la ventana perfecta para medir. Botón `#optimal`
    (`.btn-tool`, icono de diana, atajo O, visible en todas las estaciones; a ≤
    1520 px la fila de herramientas se compacta y en el ojo el botón queda solo
    con icono para que los 11 botones quepan a 1440 px). Solver puro
    `src/app/optimalWindow.ts` con caché por (geometría, caso, estación, lado,
    plano). **Ojo**: rot 0 (o 90 si el protocolo DVNO espera el sagital de ese
    lado, o la guía está en «Plano sagital»), inclinación y angulación 0; Newton
    2×2 con jacobiano numérico (≤ 5 pasos) sobre (barrido, desplazamiento
    vertical) para que el centro del nervio a 3 mm
    (`fromEyeLocal(nerveCenterline(eye, 3))`) caiga en u = 0 (`patientToImage`)
    y en el plano; décimas de mm; profundidad 45 mm, foco a la profundidad del
    nervio, ganancia de fábrica. Resultado: |u| ≤ 0,05 mm en ambos ojos, normal
    e HIC, transversal y sagital (Ojo D −2,3/−0,1 mm, Ojo I +2,5/−0,1 mm).
    **Temporal**: rejilla gruesa (inclinación ±10° cada 2,5°, desplazamientos ±6
    mm cada 3 mm) + ascenso local en los pasos de los deslizadores (1°, 0,5 mm)
    maximizando la longitud de M1 ipsilateral a ≤ 1 mm del plano y dentro del
    sector (90 mm); profundidad 90, color encendido con la caja sobre las
    muestras de M1 (+5°, +8 mm) y puerta PW en el punto de M1 (a ≥ 3 mm de los
    extremos) con menor ángulo real, comprobado con `insonationAngles` (vaso
    dominante = M1); el PW no se enciende: pulsar P mide al instante. Resultado
    (caso normal, ambos lados): inclinación −5°, desplazamiento vertical 6 mm,
    M1 en el plano 25,2 mm (toda la M1), ángulo 16,4°. **Submandibular**: misma
    búsqueda (inclinación ±12° cada 4°, desplazamientos ±6 mm cada 3 mm; sin
    angulación, que gira el haz dentro del plano sin girar el lateral de la pose
    y descoloca la puerta en coordenadas de imagen) minimizando el ángulo a la
    ACI con ≥ 10 mm de ACI en el plano: 51,5 mm, 0,2°; con P, PSV/EDV 55/28 cm/s
    y la ACI medida para el Lindegaard. Tiempos del solver sin caché (vitest,
    mejor–peor de 3 en frío, máquina cargada): ojo ≤ 1 ms, temporal 3–16 ms (230
    poses), submandibular 4–11 ms (≈ 190 poses); presupuesto 150 ms (la prueba
    lo exige al mejor de 3). Con la rejilla anterior (cada 2 mm, ≈ 450 poses) la
    suite completa en paralelo llegó a 173 ms en frío; la rejilla más gruesa da
    la misma solución. La sonda se anima 400 ms (interpolación ease-in-out de
    los controles, las vistas 3D la ven deslizarse; la vista de cabeza pinta a
    30 fps durante la animación); el usuario la interrumpe con el teclado o
    cambiando de estación. Debriefing: evento `optimal-window` con la solución,
    métricas y tiempo. **Guía**: los pasos de «encontrar la ventana»
    (`findsWindow`: ojo «Profundidad y ganancia» y «Centrar el nervio»; DTC
    «Plano mesencefálico» y «Color y M1») quedan como ASISTIDOS (⚑,
    `GuideStepRecord.assisted`) con `assistWindow`, no como completados; un paso
    previo (elegir lado) solo se completa si ya se cumple. El cajón, el
    debriefing y el informe exportado distinguen ⚑. **Dorados**: sin cambios.
60. **DEC-61** — Herramienta de calibre interactiva y correcciones de la fase
    N15b (UX 3D). **Calibre** (`src/app/measurements.ts` geometría pura,
    `src/ui/caliperTool.ts` máquina de gestos sin DOM, `src/ui/overlays.ts`
    `drawCaliperOverlay`, `src/ui/main.ts` cableado): medición por arrastre
    con banda elástica y distancia en vivo, compatible con el clic a clic
    anterior (primer clic ancla A, el segundo confirma); edición de extremos
    arrastrándolos (≤ 10 px) con recálculo sobre SU cuadro y revancha de
    Escape que restaura los puntos originales; selección por clic en la línea
    (≤ 8 px) o en la lista nueva del panel Medidas (`#measureList`, filas
    `n · rótulo · valor` con borrado ×, selección sincronizada con la imagen)
    y borrado con Supr/Retroceso; cursor de precisión con cruz y lupa circular
    ×3 copiada del propio canvas (válida en las rutas CPU y GPU, que componen
    sobre `bmodeCv`). Referencia DVNO (DEC-61, `dvnoReference`): línea
    discontinua perpendicular al eje del nervio a 3 mm retroglobo proyectada
    con `patientToImage`; el punto A tiene imán (≤ 8 px) y el extremo libre se
    restringe perpendicular al nervio en mm del plano (isótropo, no en px del
    lineal anisótropo) antes de aplicar el mismo imán — medir sobre la
    referencia reproduce la DVNO interna del modelo. Prioridad de puntero:
    calibre > caja de color > puerta PW solo en gestos reales; todo gesto
    consumido por el calibre (medición, selección, edición o cancelado con
    Escape) suprime su `click` de cierre (`consumeClick` marcado en el `down`,
    drenado en `pointercancel`), así que la puerta sigue respondiendo al clic
    directo como antes (los e2e la ponen con un `click` sintético sin
    pointerdown). Los modos DVNO/DTE se reinician a «none» al salir de la
    estación ocular y el `#hint` explica los gestos del modo activo. Cada medición confirmada es una
    `CaliperEntry` (número, puntos de imagen, cuadro, `poseKey`, rótulo y
    hueco de protocolo): en vivo solo se dibuja con la misma pose/equipo y
    congelada solo sobre su cuadro; editarla sustituye la `Measurement` en la
    lista y en el hueco DVNO/DTE, y los ganchos `onCommit/onEdit/onDelete`
    mantienen la meta de guía y el debriefing. **Crestas óseas** (N15b,
    `src/anatomy/head.ts`, `src/anatomy/materials.ts`): el ala esfenoidal y la
    cresta del peñasco pasan de losas alineadas con los ejes (3–8 mm de alto,
    que contenían casi horizontalmente el plano mesencefálico y se veían como
    masas saturadas, y la interfaz hueso/sangre de la M1 saturaba a lo largo
    del vaso) a tubos de 2,4 mm a lo largo de la cresta (`BONE_RIDGES`, radio
    1,2 mm) con material `crestaOsea` de volumen parcial (Z 2,3 MRayl, α 8
    dB/cm a 2 MHz — ~10 dB bajo la tabla craneal): cualquier plano las corta
    como una línea o un punto brillante, como en el TCD real. **Navegador
    ocular** (N15b, `src/ui/navigator3d.ts`): la escena estática muestra solo
    la órbita explorada (la del otro ojo se salía del encuadre), rectos muy
    translúcidos (α 0,25) y `eyeNavigatorFrame` encuadra sonda (huella 50 mm),
    globo y anillo DVNO — objetivo a medio camino entre la cara de la sonda y
    el centro del globo, radio < 32 mm. **Dorados**: regenerados
    `temporalDerBmode`, `pwM1Point2` y `colorM1Der` por el material
    `crestaOsea` (las crestas cambian la ecogenicidad puntual del plano DTC);
    el resto sin cambios.

61. **DEC-62** — Calibre de velocidad sobre la traza espectral (N15b). El modo
    «Caliper» (`caliperMode === 'dist'`) cubre ahora ambos canvas, como en un
    ecógrafo real: distancia en el B-mode y velocidad en el espectro.
    **`src/ui/spectralCaliper.ts`** (máquina de gestos sin DOM, activa solo con
    PW encendido y columnas recibidas): clic coloca una marca puntual (t, v) —
    un arrastre coloca y afina en el mismo gesto; bajar sobre una marca
    (≤ 8 px) la reedita en vivo; clic en la marca o en la lista selecciona;
    Supr/Retroceso borra; Escape cancela y revierte la edición al punto
    original. La marca se ancla a **tiempo absoluto de columna y velocidad
    física con signo** (`SpectralMark.tSeconds`/`velocityCms` en
    `src/app/state.ts`): barre con la traza al hacer scroll y conserva la
    medida si cambian `invert`, `baseline` o PRF — solo se reposiciona en el
    canvas o sale del barrido. **Mapeo** (`src/ui/spectrogramRaster.ts`):
    `spectralGeometry` (t1 de la última columna, barrido, baseline, invert y
    Nyquist con la corrección de ángulo) y `spectralPixelToPoint` /
    `spectralPointToPixel` comparten la geometría exacta de `drawSpectrum`, y
    `rowFrequencyFraction` queda exportada como inversa de
    `frequencyFractionToY`. **Registro** (`src/app/measurements.ts`): cada
    marca empuja un `Measurement` `trazado-espectral`/`cm/s` a la lista común
    (la edición la sustituye por `replaceMeasurement`, el borrado la retira) y
    comparte la numeración visible `caliperSeq`; el panel Medidas mezcla
    calibres y marcas por id y los readouts muestran la unidad real del valor.
    **Dibujo** (`drawSpectralMarks` en `src/ui/overlays.ts`, dentro del key de
    caché de `drawSpectral`): cruz + punto + etiqueta `±NN cm/s` con el amarillo
    del calibre, resaltada al pasar el cursor o al estar seleccionada/editada.
    Selección mutuamente excluyente entre ambas herramientas y `reset()` en
    cambio de modo, estación y al apagar PW. Debriefing: `measurement` con
    `valueCms`/`tSeconds` al confirmar, editar y borrar.
