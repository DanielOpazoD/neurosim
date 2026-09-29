# neurosim

[![check](https://github.com/DanielOpazoD/neurosim/actions/workflows/check.yml/badge.svg)](https://github.com/DanielOpazoD/neurosim/actions/workflows/check.yml)

Simulador educativo de neurosonología en el navegador: medición del diámetro
de la vaina del nervio óptico (DVNO/ONSD) y Doppler transcraneal de la
arteria cerebral media (TCCD/TCCS). Imagen, color y espectro emergen de un
modelo físico y fisiológico — nada se pinta a mano.

**Uso docente. No es un dispositivo médico.** La DVNO y el PI no dan una PIC
exacta; una señal ausente no acredita cese circulatorio.

## Alcance actual — N2

- Biblioteca de casos clínicos (`?caso=` o panel del instructor): normal,
  hipertensión intracraneal, vasoespasmo, estenosis M1, ventana pobre,
  parada circulatoria, hipercapnia, hipocapnia y Parkinson (sustancia nigra
  hiperecogénica ≥0,25 cm²/lado en el plano mesencefálico).
- Ojo bilateral: sonda lineal 10 MHz, anatomía orbital completa, DVNO
  medible a 3 mm retroglobo (convención interna por defecto). Doppler color
  y PW sobre el grafo vascular retrobulbar (ACR 10/3, VCR venosa, AO 35/8,
  VOS venosa, ciliares posteriores), misma cadena `VesselScene` que Willis.
- Ventana transtemporal bilateral: cráneo, mesencéfalo, polígono de Willis;
  B-mode + Doppler color + PW con audio y medidas PSV/EDV/TAMax/PI/IR y
  índice de Lindegaard.
- B-mode dinámico: pulso cerebral, respiración, temblor de mano y deformación
  por presión de la sonda sobre el globo (speckle coherente complejo y PSF
  sobre IQ).
- Navegador 3D (Three.js) con cráneo, polígono de Willis, órbitas, sonda y
  plano de imagen en tiempo real; órbita interactiva con OrbitControls.
- Interfaz de tres columnas con revelación progresiva (TGC, Doppler extra,
  Avanzado e Instructor en `<details>`) y una vista de cabeza interactiva
  (`#headView`): la sonda se arrastra sobre el cuero cabelludo, la rueda
  gira el marcador, Mayús+arrastrar inclina y Alt+rueda regula la presión;
  los hotspots cambian de estación.
- Navegador 3D (Three.js) con cráneo, polígono de Willis, órbitas, sonda y
  plano de imagen en tiempo real; órbita interactiva con OrbitControls.

- Calipers, freeze, cine, exportación PNG/JSON.
- Protocolo DVNO 2×2 (transversal/sagital por ojo), DTE, ratio DVNO/ETD e
  informe educativo exportable.
- Rótulo acústico MI/TI por modo y alerta ALARA oftálmica en modo docente.
- Espectro PW rasterizado por interpolación de filas, con barrido seleccionable
  de 2/3/4/6 s, eje de velocidad en cm/s y aliasing desplazado por la línea
  base. La ganancia espectral (−20…+20 dB) se activa con PW y es independiente
  de la ganancia B-mode.
- Audio PW direccional con control de volumen 0–100 %, separación overlap-add,
  AGC lento y paso bajo de equipo.
- Renderizador B-mode CPU por defecto; `?renderer=gpu` activa WebGL2 cuando
  está disponible y el selector Renderizador aparece en Equipo.
- Navegador 3D ortográfico de la sonda, con cámara arrastrable derivada de la
  pose y de la anatomía adquirida.
- Navegación de sonda realista: deslizamiento lateral y superior/inferior
  (mm), inclinación y angulación en el plano de elevación (°), rotación de
  marcador y presión; el origen sigue el cuero cabelludo, así que salirse de
  la ventana temporal oscurece la imagen por hueso. Atajos: flechas (+Mayús
  para inclinar/angulación), Q/E rotación, +/− presión, R reiniciar.
- Debriefing docente determinista con línea de tiempo, hallazgos cuantitativos
  y exportación separada de verdades del modelo.
- Casos del plano diencefálico: desplazamiento de línea media (III
  ventrículo +6 mm hacia la izquierda) e hidrocefalia (III ventrículo 12 mm,
  cuernos ×1,6), con etiquetas docentes anatómicas sobre el B-mode temporal
  y reglas de debrief que validan las medidas.
- Interfaz por examen (DEC-53): dos pestañas —vaina del nervio óptico y
  Doppler transcraneal— con lado D/I, herramientas filtradas por examen,
  disposición dúplex B-mode/espectro con separador arrastrable cuando PW está
  activo, profundidad transtemporal hasta 160 mm (DEC-52) y sistema visual de
  tarjetas con botones por rol.
- Examen guiado (DEC-56): botón «Guía» (G) con pasos para la vaina del nervio
  óptico y el Doppler transcraneal que avanzan solos al cumplirse (estado
  real del simulador), resaltan el control a usar, dan pistas a los 20 s y
  cierran con un resumen interpretado (DVNO frente al modelo; asimetría, IP
  y Lindegaard) exportable; los tiempos por paso pasan al debriefing.
- Sin patología, sin Lindegaard (ACI extracraneal), sin dinámica de PIC:
  bloques posteriores (ver `docs/LIMITATIONS.md`).

## Evidencia N1

La ejecución reproducible de referencia, con capturas, exportaciones y valores
medidos, está en [docs/evidence/N1.md](docs/evidence/N1.md). Se puede regenerar
con `npm run evidence`; el script fija una semilla y usa las exportaciones de
la aplicación para evitar números escritos a mano.

## Desarrollo

Los hooks se instalan con `npm install`.

```bash
npm install
npm run dev      # http://localhost:6620
npm run check    # format + lint + typecheck + test + build
```

`?clock=fixed&t=0.4` fija el reloj de simulación (reloj pausado en `t`
segundos y micro-movimiento de mano desactivado); lo usan las pruebas e2e.

Consulta la [suite de validación](docs/TESTING.md) para los criterios del plan.

## Documentos

- [Arquitectura](docs/ARCHITECTURE.md)
- [Convenciones](docs/CONVENTIONS.md)
- [Índice documental](docs/INDEX.md)
- [Decisiones](docs/DECISIONS.md)
- [Limitaciones](docs/LIMITATIONS.md)
- [Aproximaciones](docs/APPROXIMATIONS.md)
- [Procedencia](docs/PROVENANCE.md)
- [Referencias](docs/REFERENCES.md)
- [Testing](docs/TESTING.md)

## Arquitectura

Cadena causal: `paciente (anatomía + fisiología) → sonda → adquisición →
señal (B-mode / color / PW) → medición`. Contratos en `src/domain/contracts.ts`;
convenciones (mm, marco levógiro, DVNO interno/externo) en `docs/DECISIONS.md`;
procedencia del código portado en `docs/PROVENANCE.md`; parámetros con
evidencia en `src/*/params.ts`, `docs/REFERENCES.md` y
`docs/APPROXIMATIONS.md`.

Porta módulos de `DanielOpazoD/vexus-sim` y `DanielOpazoD/lus-sim` (MIT).
