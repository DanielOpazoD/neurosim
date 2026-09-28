# Índice documental

Índice generado por `npm run docs:index`; no editar manualmente.

## Documentos rectores

| Documento                | Primera línea                |
| ------------------------ | ---------------------------- |
| `docs/ARCHITECTURE.md`   | # Arquitectura               |
| `docs/CONVENTIONS.md`    | # Convenciones               |
| `docs/INDEX.md`          | # Índice documental          |
| `docs/DECISIONS.md`      | # Decisiones de diseño       |
| `docs/LIMITATIONS.md`    | # Limitaciones (N1)          |
| `docs/APPROXIMATIONS.md` | # Aproximaciones registradas |
| `docs/PROVENANCE.md`     | # Procedencia del código     |
| `docs/REFERENCES.md`     | # Referencias                |
| `docs/TESTING.md`        | # Pruebas                    |

## IDs de limitaciones

| ID     | Título                                       | Citas en `src/` y `tests/`                                                   |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------- |
| LIM-16 | Color Kasai reducido                         | `src/doppler/color.ts`                                                       |
| LIM-17 | Movimiento tisular reducido                  | —                                                                            |
| LIM-18 | Windkessel reducido                          | —                                                                            |
| LIM-19 | Hemodinámica estática                        | —                                                                            |
| LIM-20 | ALARA acústico reducido                      | —                                                                            |
| LIM-21 | Protocolo DVNO reducido                      | —                                                                            |
| LIM-01 | Patología                                    | —                                                                            |
| LIM-02 | Lindegaard                                   | `src/domain/cases.ts`, `src/doppler/measureMca.ts`                           |
| LIM-03 | DVNO y PIC                                   | —                                                                            |
| LIM-04 | Realismo acústico parcial                    | —                                                                            |
| LIM-05 | Normal de interfaz                           | `src/ultrasound/bmode.ts`                                                    |
| LIM-06 | Tejido estático                              | —                                                                            |
| LIM-07 | Audio                                        | —                                                                            |
| LIM-08 | Medición DVNO                                | —                                                                            |
| LIM-09 | Sesgo diastólico (reducido)                  | `src/doppler/measureMca.ts`                                                  |
| LIM-10 | PSF analítica (resuelta/redirigida)          | —                                                                            |
| LIM-11 | Advección en cuerda                          | `src/doppler/sampleVolume.ts`, `tests/validation/persistenciaSangre.test.ts` |
| LIM-12 | Densidad de sangre sembrada                  | `src/doppler/sampleVolume.ts`                                                |
| LIM-13 | PW en hilo principal                         | —                                                                            |
| LIM-14 | Artefactos 1D                                | —                                                                            |
| LIM-15 | Flujo vascular simplificado                  | —                                                                            |
| LIM-22 | Debriefing por reglas                        | —                                                                            |
| LIM-23 | Audio de equipo                              | —                                                                            |
| LIM-24 | Paridad WebGL2                               | —                                                                            |
| LIM-25 | Estenosis focal idealizada                   | `src/domain/cases.ts`                                                        |
| LIM-26 | Vasos oculares estilizados                   | `src/anatomy/ocularVessels.ts`, `src/app/renderRequest.ts`                   |
| LIM-27 | Navegación de sonda 2-D                      | —                                                                            |
| LIM-28 | Desplazamiento de línea media supratentorial | —                                                                            |

## IDs de decisiones

| ID     | Título                                                                  | Citas en `src/` y `tests/`     |
| ------ | ----------------------------------------------------------------------- | ------------------------------ |
| DEC-01 | Repo independiente `neurosono-sim` con porte selectivo de               | —                              |
| DEC-02 | mm + marco levógiro (+x = izquierda del paciente) en todo el motor,     | —                              |
| DEC-03 | "Nada se pinta: emerge" — B-mode raymarch con materiales, speckle       | —                              |
| DEC-04 | Separación paciente/adquisición/señal/medición por contratos            | —                              |
| DEC-05 | DVNO interno vs externo son dos convenciones distintas                  | —                              |
| DEC-06 | TAMax = integral de la envolvente verdadera del espectro por            | —                              |
| DEC-07 | Sonda lineal ocular explícita (vexus solo tenía convexa/fasada);        | —                              |
| DEC-08 | CPU primero, GPU después — el plan permite modelo reducido; la          | —                              |
| DEC-09 | Dispersores de sangre con `flowBasis` congelado (portado de vexus-sim): | —                              |
| DEC-10 | Siembra dirigida en vasos (`seedVessels`, máx. 32): al mover la puerta  | —                              |
| DEC-11 | Volumen parcial en la pared del tubo (±0,6 mm): el voxel borde mezcla   | —                              |
| DEC-12 | El fixture DVNO se deriva del manifiesto (interno + 2·dura), nunca se   | —                              |
| DEC-13 | Registro por dominio — anatomía, física US, Doppler y fisiología se     | —                              |
| DEC-14 | Los errores en tiempo de ejecución se registran y se exportan;          | —                              |
| DEC-15 | El render B-mode/color corre en Worker; el hilo principal solo          | —                              |
| DEC-16 | Las pruebas E2E cubren el flujo docente completo pero no                | —                              |
| DEC-17 | `noUncheckedIndexedAccess` está activo; `!` se permite solo             | —                              |
| DEC-18 | La ampolla retrobulbar se parametriza y se ancla al valor               | —                              |
| DEC-19 | El haz B-mode usa FWHM gaussiano `λF/D`, lóbulos laterales              | `src/ultrasound/bmode.ts`      |
| DEC-20 | La reverberación, el espejo y la cola de cometa emergen de              | —                              |
| DEC-21 | Los hitos transtemporales emergen de regiones anatómicas 3D             | —                              |
| DEC-22 | El polígono de Willis se representa como un grafo de                    | —                              |
| DEC-23 | El color Doppler sintetiza ensembles IQ deterministas por               | —                              |
| DEC-24 | El clutter Doppler emerge del movimiento material: la pared             | —                              |
| DEC-25 | La docencia distingue ángulo real tridimensional, ángulo                | —                              |
| DEC-26 | La onda arterial se genera con un Windkessel de dos elementos           | —                              |
| DEC-27 | La agenda cardíaca conserva intervalos RR deterministas con             | —                              |
| DEC-28 | La presión crítica de cierre se acopla al Windkessel y a la             | —                              |
| DEC-29 | La autorregulación de Lassen y la reactividad al CO₂ actúan             | —                              |
| DEC-30 | MI y TI se calculan por adquisición a partir de presión pico            | —                              |
| DEC-31 | El protocolo DVNO registra cuatro planos (transversal y                 | —                              |
| DEC-32 | El navegador 3D es una vista derivada de la misma pose,                 | —                              |
| DEC-33 | El debriefing docente se construye con evidencia numérica del           | —                              |
| DEC-34 | El espectrograma de equipo se presenta recorriendo cada fila de         | —                              |
| DEC-35 | El audio direccional usa ventanas Hann con overlap-add del 50 %,        | —                              |
| DEC-36 | La etapa post-IQ determinista puede ejecutarse en WebGL2:               | —                              |
| DEC-37 | La envolvente PW estima su borde con interpolación sub-bin en           | —                              |
| DEC-38 | Los resúmenes PW excluyen latidos con cobertura inferior al 80 %        | —                              |
| DEC-39 | La geometría del movimiento tisular (vaso más cercano, normal           | —                              |
| DEC-40 | Los casos clínicos son conjuntos estáticos de parámetros                | —                              |
| DEC-41 | El B-mode aplica la PSF sobre el IQ complejo y detecta la               | —                              |
| DEC-42 | La convolución lateral de la PSF en CPU usa el mismo tope de            | —                              |
| DEC-43 | `nerveSection` usa una tabla de la línea central por                    | —                              |
| DEC-44 | La corona de cisterna basal se adelgaza (butterflyLevel < 1,45          | —                              |
| DEC-45 | Sustancia negra recalibrada a la referencia de Berg 2008                | —                              |
| DEC-46 | Doppler ocular sobre la misma `VesselScene` que Willis: el              | `src/anatomy/ocularVessels.ts` |
| DEC-47 | Persistencia B-mode (0–4) como promedio temporal de                     | —                              |
| DEC-48 | Estenosis focal de M1 con turbulencia post-estenótica:                  | —                              |
| DEC-49 | Navegación de sonda sobre la superficie craneal: la sonda               | —                              |
| DEC-50 | Casos del plano diencefálico (línea media e hidrocefalia):              | —                              |

## Parámetros registrados

| Conjunto             | Parámetros |
| -------------------- | ---------: |
| `anatomia-ojo`       |         40 |
| `anatomia-cabeza`    |         73 |
| `doppler`            |         51 |
| `fisiologia`         |         36 |
| `fisica-ultrasonido` |         39 |
