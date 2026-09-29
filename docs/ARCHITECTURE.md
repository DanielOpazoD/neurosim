# Arquitectura

## Capas y dependencias

La matriz de dependencias permitida es:

```text
core       → (nada)
anatomy    → core, domain (solo tipos)
physiology → core, anatomy, domain
ultrasound → core, anatomy, domain
doppler    → core, anatomy, physiology, ultrasound, domain
domain     → core, anatomy, physiology, ultrasound, doppler
app        → core, anatomy, physiology, ultrasound, doppler, domain
ui         → core, anatomy, physiology, ultrasound, doppler, domain, app
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
TypeScript de `src/` y verifica esta matriz. Las excepciones explícitas
`anatomy/head.ts` y `anatomy/willis.ts` → `physiology/params.ts` permiten a la
anatomía consumir datos fisiológicos registrados sin importar lógica de
fisiología. La prueba falla ante cualquier arista nueva que no esté en la
matriz o en estas excepciones explícitas.

## Cadena causal

```text
fisiología                  anatomía                    adquisición
CardiacCycle/CerebralFlow → EyeGeometry/HeadGeometry → ProbePose + settings
        │                         │                         │
        └────────────── paciente virtual (referenceCase.ts) ─┘
                                      │
                                      ▼
                          señal B-mode / IQ / color
              renderWorker.ts → renderRequest.ts → bmode.ts · color.ts
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
- `src/ui/renderWorker.ts` recibe solicitudes, `src/app/renderRequest.ts`
  ejecuta el render sin DOM y `src/app/renderClient.ts` aplica latest-wins o
  fallback síncrono. La cadena PW corre en `src/ui/pwWorker.ts` con el
  protocolo puro de `src/app/pwProtocol.ts` (fallback síncrono con el mismo
  manejador); `src/app/pwController.ts` queda como proxy en el hilo
  principal: puerta, búfer de columnas, medidas y audio Web Audio (DEC-55).
- `src/domain/measure.ts` convierte puntos de imagen a paciente y registra
  mediciones; `src/doppler/measureMca.ts` mide la traza espectral.
- El modo guiado (DEC-56) son guías puras con reductor en
  `src/domain/guides.ts`; `src/app/guideContext.ts` construye la instantánea
  del estado que leen sus comprobaciones y `src/ui/guidePanel.ts` pinta el
  cajón y el resaltado del control.

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
