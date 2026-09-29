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

## Recursos binarios (DEC-59)

Cabeza escaneada de la vista «Exploración». Copiada sin modificar de
`mrdoob/three.js` en la etiqueta `r186` (misma versión que la dependencia
`three`), carpeta `examples/models/gltf/LeePerrySmith/`. `npm run
provenance:check` verifica el SHA-256 de cada archivo, que el archivo de
licencia exista y nombre la licencia, y que no haya recursos en
`public/models` sin fila aquí.

| Archivo                                                     | Origen               | SHA-256                                                          | Licencia  | Archivo de licencia                            | Uso                       |
| ----------------------------------------------------------- | -------------------- | ---------------------------------------------------------------- | --------- | ---------------------------------------------- | ------------------------- |
| `public/models/head/LeePerrySmith.glb`                      | mrdoob/three.js@r186 | 402b8a8ac9f03232e6d64b5962929703a069daf99d3c49ac8eb0e48bedc9c576 | CC BY 3.0 | `public/models/head/LeePerrySmith_License.txt` | malla (9 279 vértices)    |
| `public/models/head/Map-COL.jpg`                            | mrdoob/three.js@r186 | e976d73b31407f8d0967412bf468019ed26a5d5a32cf5811aabff7e816458a65 | CC BY 3.0 | `public/models/head/LeePerrySmith_License.txt` | mapa de color (sRGB)      |
| `public/models/head/Infinite-Level_02_Tangent_SmoothUV.jpg` | mrdoob/three.js@r186 | 36925e51ad9b324b94e8faf4692da1b4132809f2762bb8d5bd549ffd215d4ca6 | CC BY 3.0 | `public/models/head/LeePerrySmith_License.txt` | mapa de normales tangente |

Texto de `LeePerrySmith_License.txt` (copiado del repositorio, SHA-256
`7cf4da43a6ae6d32f7f7d063fe129a19468af6f4fe7c53b937f83959709fcb50`):

> Creative Commons Licence
> Infinite, 3D Head Scan by Lee Perry-Smith is licensed under a Creative
> Commons Attribution 3.0 Unported License.
> Based on a work at www.triplegangers.com.
> Permissions beyond the scope of this license may be available at
> http://www.ir-ltd.net/
> Please remember: Do what you want with the files, but always mention where
> you got them from...

**Atribución** (CC BY 3.0): «Infinite, 3D Head Scan» por Lee Perry-Smith
(Infinite-Realities, www.ir-ltd.net), basado en un trabajo de
www.triplegangers.com, bajo licencia
[Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
Distribuido con los ejemplos de three.js (MIT el código; el modelo conserva su
licencia CC BY 3.0). Cambios: ninguno en los archivos; en tiempo de ejecución
se escala y traslada la malla (semejanza, `src/ui/headFit.ts`) y se le aplica
un material propio. La atribución también figura en el pie de la interfaz.
