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

| ID     | Título                      | Citas en `src/` y `tests/`                                 |
| ------ | --------------------------- | ---------------------------------------------------------- |
| LIM-01 | Patología                   | —                                                          |
| LIM-02 | Lindegaard                  | —                                                          |
| LIM-03 | DVNO y PIC                  | —                                                          |
| LIM-04 | Realismo acústico parcial   | —                                                          |
| LIM-05 | Normal de interfaz          | `src/ultrasound/bmode.ts`                                  |
| LIM-06 | Tejido estático             | —                                                          |
| LIM-07 | Audio                       | —                                                          |
| LIM-08 | Medición DVNO               | —                                                          |
| LIM-09 | Sesgo diastólico            | `src/doppler/measureMca.ts`, `tests/validation/pw.test.ts` |
| LIM-10 | PSF heurística              | `src/ultrasound/bmode.ts`, `tests/validation/psf.test.ts`  |
| LIM-11 | Advección en cuerda         | `src/doppler/sampleVolume.ts`                              |
| LIM-12 | Densidad de sangre sembrada | `src/doppler/sampleVolume.ts`                              |
| LIM-13 | PW en hilo principal        | —                                                          |

## IDs de decisiones

| ID     | Título                                                                  | Citas en `src/` y `tests/` |
| ------ | ----------------------------------------------------------------------- | -------------------------- |
| DEC-01 | Repo independiente `neurosono-sim` con porte selectivo de               | —                          |
| DEC-02 | mm + marco levógiro (+x = izquierda del paciente) en todo el motor,     | —                          |
| DEC-03 | "Nada se pinta: emerge" — B-mode raymarch con materiales, speckle       | —                          |
| DEC-04 | Separación paciente/adquisición/señal/medición por contratos            | —                          |
| DEC-05 | DVNO interno vs externo son dos convenciones distintas                  | —                          |
| DEC-06 | TAMax = integral de la envolvente verdadera del espectro por            | —                          |
| DEC-07 | Sonda lineal ocular explícita (vexus solo tenía convexa/fasada);        | —                          |
| DEC-08 | CPU primero, GPU después — el plan permite modelo reducido; la          | —                          |
| DEC-09 | Dispersores de sangre con `flowBasis` congelado (portado de vexus-sim): | —                          |
| DEC-10 | Siembra dirigida en vasos (`seedVessels`, máx. 32): al mover la puerta  | —                          |
| DEC-11 | Volumen parcial en la pared del tubo (±0,6 mm): el voxel borde mezcla   | —                          |
| DEC-12 | El fixture DVNO se deriva del manifiesto (interno + 2·dura), nunca se   | —                          |
| DEC-13 | Registro por dominio — anatomía, física US, Doppler y fisiología se     | —                          |
| DEC-14 | Los errores en tiempo de ejecución se registran y se exportan;          | —                          |
| DEC-15 | El render B-mode/color corre en Worker; el hilo principal solo          | —                          |
| DEC-16 | Las pruebas E2E cubren el flujo docente completo pero no                | —                          |
| DEC-17 | `noUncheckedIndexedAccess` está activo; `!` se permite solo             | —                          |

## Parámetros registrados

| Conjunto             | Parámetros |
| -------------------- | ---------: |
| `anatomia-ojo`       |         27 |
| `anatomia-cabeza`    |         40 |
| `doppler`            |         22 |
| `fisiologia`         |         18 |
| `fisica-ultrasonido` |         17 |
