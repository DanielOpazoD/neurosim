# Arquitectura

## Capas y dependencias

La dependencia lógica permitida es:

```text
core → anatomy / physiology → ultrasound / doppler → domain → app → ui
```

`src/domain/contracts.ts` es la frontera de tipos compartidos: anatomy,
physiology y los módulos de adquisición pueden importar sus contratos sin
introducir una dependencia de ejecución hacia la composición de la aplicación.
La UI es el único lugar que conoce el DOM y el canvas.

- **core**: reloj, RNG, unidades, vectores, FFT y validación de evidencia.
- **anatomy**: materiales, ojo y cabeza; produce geometría y clasificación.
- **physiology**: ciclo cardíaco y velocidades vasculares.
- **ultrasound**: geometría de sonda, B-mode y atenuación.
- **doppler**: volumen de muestra, cadena PW, filtro, espectro, color y medidas
  MCA.
- **domain**: contratos, manifiesto, caso reproducible, settings y medidas.
- **app**: adquisición, poses, control PW, cine, mediciones y exportación.
- **ui**: composición, eventos, canvas, overlays y readouts.

`tests/layers.test.ts` extrae las importaciones relativas de todos los
TypeScript de `src/` y verifica esta matriz. Hay tres aristas observadas que
se conservan explícitamente como deuda técnica, no como permisos generales:

- `core → ultrasound`: `core/units.ts` consume la velocidad acústica registrada.
  **TODO PR 8**: separar la conversión de unidades del registro físico.
- `domain → ultrasound`: settings y conversión de puntos usan geometría y
  parámetros acústicos. **TODO PR 8**: extraer esa frontera.
- `domain → doppler`: el registro de parámetros incluye el conjunto Doppler.
  **TODO PR 8**: mover el agregador fuera de domain.
- `anatomy → physiology`: `head.ts` usa velocidades vasculares registradas para
  construir los vasos. **TODO PR 8**: separar la geometría de la fisiología.

La prueba falla ante cualquier arista nueva que no esté en la matriz o en esta
lista explícita.

## Cadena causal

```text
fisiología                  anatomía                    adquisición
CardiacCycle/CerebralFlow → EyeGeometry/HeadGeometry → ProbePose + settings
        │                         │                         │
        └────────────── paciente virtual (referenceCase.ts) ─┘
                                      │
                                      ▼
                           señal B-mode / IQ / color
                    bmode.ts · sampleVolume.ts · color.ts
                                      │
                                      ▼
                         imagen / espectro adquiridos
                    AcquiredFrame · SpectralColumn
                                      │
                                      ▼
                              mediciones
          domain/measure.ts · app/measurements.ts · measureMca.ts
```

Responsables concretos:

- La fisiología vive en `src/physiology/flow.ts`; el caso la conecta con
  `src/domain/referenceCase.ts`.
- La anatomía se construye en `src/anatomy/eye.ts` y `src/anatomy/head.ts`;
  `src/anatomy/materials.ts` aporta las propiedades de material.
- La pose y el barrido se calculan en `src/app/poses.ts` y
  `src/ultrasound/probe.ts`.
- B-mode y atenuación son `src/ultrasound/bmode.ts` y
  `src/ultrasound/attenuation.ts`.
- IQ/PW, color y espectro son `src/doppler/sampleVolume.ts`,
  `src/doppler/pwChain.ts`, `src/doppler/color.ts` y
  `src/doppler/spectral.ts`.
- La adquisición empaqueta el resultado en `src/app/acquisition.ts`.
- `src/domain/measure.ts` convierte puntos de imagen a paciente y registra
  mediciones; `src/doppler/measureMca.ts` mide la traza espectral.

## Contratos centrales

`PatientState` contiene `seed`, `manifestVersion`, `label` y `physiology`.
`ProbePose` contiene `origin`, `forward`, `lateral`, `markerAngleRad` y
`contactPressure`. `AcquisitionSettings` contiene el transductor, frecuencia,
profundidad, foco, ganancia, TGC, rango dinámico, persistencia, PRF, gate,
filtro de pared, corrección angular, baseline, ganancia Doppler e inversión de
color.

`AcquiredFrame` contiene `tSeconds`, `geometry`, una copia de `settings`,
`side`, `station`, la imagen B-mode opcional, `caseId` y `seed`.
`Measurement` contiene `kind`, `frameTSeconds`, `side`, puntos en mm, `value`,
`unit` y, cuando aplica, la convención y el offset DVNO.

Toda medición se liga al frame adquirido mediante `frameTSeconds`. Freeze y
cine conservan ese contexto; no recalculan una medición con el estado actual.
