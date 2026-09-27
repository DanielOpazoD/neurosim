# Procedencia del código

Todo módulo portado lleva cabecera con origen, SHA y licencia MIT.
Resumen (ver también `src/domain/manifest.ts`):

| Archivo                       | Origen                 | SHA          | Licencia | Adaptación                                                            |
| ----------------------------- | ---------------------- | ------------ | -------- | --------------------------------------------------------------------- |
| `src/core/clock.ts`           | DanielOpazoD/vexus-sim | 59fb7b18e9c1 | MIT      | verbatim                                                              |
| `src/core/random.ts`          | DanielOpazoD/vexus-sim | 59fb7b18e9c1 | MIT      | verbatim                                                              |
| `src/core/units.ts`           | DanielOpazoD/vexus-sim | 59fb7b18e9c1 | MIT      | verbatim                                                              |
| `src/core/vec3.ts`            | DanielOpazoD/vexus-sim | 59fb7b18e9c1 | MIT      | verbatim                                                              |
| `src/core/fft.ts`             | DanielOpazoD/vexus-sim | 59fb7b18e9c1 | MIT      | verbatim                                                              |
| `src/core/evidence.ts`        | DanielOpazoD/lus-sim   | 8ed8a6de918a | MIT      | verbatim                                                              |
| `src/doppler/wallFilter.ts`   | DanielOpazoD/vexus-sim | 59fb7b18e9c1 | MIT      | verbatim                                                              |
| `src/doppler/spectral.ts`     | DanielOpazoD/vexus-sim | 59fb7b18e9c1 | MIT      | verbatim                                                              |
| `src/doppler/sampleVolume.ts` | DanielOpazoD/vexus-sim | 59fb7b18e9c1 | MIT      | adaptado: flowBasis+cuerda de vexus; siembra y volumen parcial nuevos |
| `src/doppler/pwChain.ts`      | DanielOpazoD/vexus-sim | 59fb7b18e9c1 | MIT      | API adaptada                                                          |
| `src/doppler/measureMca.ts`   | DanielOpazoD/vexus-sim | 59fb7b18e9c1 | MIT      | traza/envolvente; medidas cerebrales nuevas                           |

Repos de referencia revisados sin portar código: `echotwin-tte` @e7321c6
(cm + dextrógiro; convenciones incompatibles) y `ECGdigitalizador`.
