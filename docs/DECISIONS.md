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
