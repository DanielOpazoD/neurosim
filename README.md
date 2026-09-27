# neurosim

[![check](https://github.com/DanielOpazoD/neurosim/actions/workflows/check.yml/badge.svg)](https://github.com/DanielOpazoD/neurosim/actions/workflows/check.yml)

Simulador educativo de neurosonología en el navegador: medición del diámetro
de la vaina del nervio óptico (DVNO/ONSD) y Doppler transcraneal de la
arteria cerebral media (TCCD/TCCS). Imagen, color y espectro emergen de un
modelo físico y fisiológico — nada se pinta a mano.

**Uso docente. No es un dispositivo médico.** La DVNO y el PI no dan una PIC
exacta; una señal ausente no acredita cese circulatorio.

## Alcance actual — N1 (maqueta normal)

- Caso adulto de referencia reproducible (semilla fija).
- Ojo bilateral: sonda lineal 10 MHz, anatomía orbital completa, DVNO
  medible a 3 mm retroglobo (convención interna por defecto).
- Ventana transtemporal bilateral: cráneo, mesencéfalo, polígono de Willis;
  B-mode + Doppler color + PW con audio y medidas PSV/EDV/TAMax/PI/IR.
- Calipers, freeze, cine, exportación PNG/JSON.
- Protocolo DVNO 2×2 (transversal/sagital por ojo), DTE, ratio DVNO/ETD e
  informe educativo exportable.
- Rótulo acústico MI/TI por modo y alerta ALARA oftálmica en modo docente.
- Navegador 3D ortográfico de la sonda, con cámara arrastrable derivada de la
  pose y de la anatomía adquirida.
- Debriefing docente determinista con línea de tiempo, hallazgos cuantitativos
  y exportación separada de verdades del modelo.
- Sin patología, sin Lindegaard (ACI extracraneal), sin dinámica de PIC:
  bloques posteriores (ver `docs/LIMITATIONS.md`).

## Desarrollo

Los hooks se instalan con `npm install`.

```bash
npm install
npm run dev      # http://localhost:6620
npm run check    # format + lint + typecheck + test + build
```

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
