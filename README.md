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
- Sin patología, sin Lindegaard (ACI extracraneal), sin dinámica de PIC:
  bloques posteriores (ver `docs/LIMITATIONS.md`).

## Desarrollo

Los hooks se instalan con `npm install`.

```bash
npm install
npm run dev      # http://localhost:6620
npm run check    # format + lint + typecheck + test + build
```

## Arquitectura

Cadena causal: `paciente (anatomía + fisiología) → sonda → adquisición →
señal (B-mode / color / PW) → medición`. Contratos en `src/domain/contracts.ts`;
convenciones (mm, marco levógiro, DVNO interno/externo) en `docs/DECISIONS.md`;
procedencia del código portado en `docs/PROVENANCE.md`; parámetros con
evidencia en `src/domain/parameters.ts` + `docs/REFERENCES.md`.

Porta módulos de `DanielOpazoD/vexus-sim` y `DanielOpazoD/lus-sim` (MIT).
