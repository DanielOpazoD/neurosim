# Revisión integrada N1

Esta revisión puntúa lo implementado en la rama N1, no el trabajo planificado.
La evaluación inicial era: global 3,4; CI/DX 2; tests 3; arquitectura,
prácticas y documentación 4; Doppler y ojo 4; B-mode, temporal, fisiología y
clínica 3.

## Revisión de los 25 PR

|  PR | Título corto             | Aporte a la fidelidad                                          | LIM/DEC asociados      |
| --: | ------------------------ | -------------------------------------------------------------- | ---------------------- |
|   1 | Base y CI                | Repo reproducible, hooks y comprobaciones iniciales            | DEC-01                 |
|   2 | Contratos y estado       | Separa paciente, adquisición, señal y medición                 | DEC-04                 |
|   3 | Validación analítica     | Introduce fixtures, tests y goldens                            | DEC-06                 |
|   4 | Extracción de aplicación | Hace explícitos poses, adquisición, PW y exportación           | DEC-04                 |
|   5 | Parámetros               | Centraliza constantes con procedencia                          | DEC-13                 |
|   6 | Documentación gobernante | Índice, límites, decisiones y provenance verificables          | —                      |
|   7 | Velocidad acústica       | El sonido se comparte entre dominios                           | DEC-02                 |
|   8 | Render Worker            | Aísla el render asíncrono del hilo de UI                       | DEC-15                 |
|   9 | Playwright               | Añade smoke y determinismo del flujo de usuario                | DEC-16                 |
|  10 | Tipos estrictos          | Activa `noUncheckedIndexedAccess` y reduce errores silenciosos | DEC-17                 |
|  11 | Ojo realista             | Ampolla, lámina cribosa, tortuosidad y mirada                  | DEC-18, LIM-04         |
|  12 | Haz y anatomía           | Haz, refracción y PSF analítica conectados a la adquisición    | DEC-19, LIM-10         |
|  13 | Artefactos acústicos     | Atenuación, reverberación, espejo y cola de cometa             | DEC-20, LIM-14         |
|  14 | Temporal                 | Hitos, materiales y poses transtemporales explícitos           | DEC-21                 |
|  15 | Willis                   | Grafo vascular continuo, variantes y flujo                     | DEC-22, LIM-15         |
|  16 | Color Doppler            | IQ determinista, Kasai, umbral y golden de color               | DEC-23, LIM-16         |
|  17 | Clutter y ángulo         | Movimiento tisular, filtro de pared y docencia angular         | DEC-24, DEC-25, LIM-17 |
|  18 | Fisiología               | Windkessel, HRV, respiración y forma de onda                   | DEC-26, DEC-27, LIM-18 |
|  19 | Hemodinámica             | CrCP, autorregulación, escenarios y acoplamiento vascular      | DEC-28, DEC-29, LIM-19 |
|  20 | Salida acústica          | MI/TI, potencia y límites ALARA derivados de adquisición       | DEC-30, LIM-20         |
|  21 | Protocolo DVNO           | 2×2, DTE, ratios, flags e informe exportable                   | DEC-31, LIM-21         |
|  22 | Navegador y debrief      | Vista 3D derivada y debriefing cuantitativo                    | DEC-32, DEC-33, LIM-22 |
|  23 | Espectro y audio         | Rasterización de equipo, eje de velocidad, AGC y filtrado      | DEC-34, DEC-35, LIM-23 |
|  24 | WebGL2 post-IQ           | Ruta GPU determinista con paridad medida y fallback CPU        | DEC-36, LIM-24         |
|  25 | Evidencia N1             | Interpolación PW, artefactos reproducibles y esta revisión     | DEC-37, LIM-09         |

## Limitaciones abiertas

Siguen abiertas LIM-01/02/03 (patología, Lindegaard y relación clínica),
LIM-04/05/06 (realismo acústico residual, normal cuantizada y tejido sin
deformación), LIM-07/08 (psicoacústica y medición DVNO manual), LIM-11/12/13
(advección, densidad y PW en hilo principal), LIM-14/15 (artefactos y flujo
vascular simplificados), LIM-16/17/18/19 (color, clutter y fisiología
reducidos), LIM-20/21/22 (ALARA, protocolo y debriefing educativos), y
LIM-23/24 (audio de equipo y diferencias entre implementaciones WebGL2).
LIM-09 queda reducida, no eliminada: la interpolación sub-bin baja el sesgo
EDV sintético a aproximadamente +3,1 %, pero FFT, dropouts y P10 siguen
limitando la medición.

## Puntuación 1–7

| Dimensión     | Inicial |  N1 | Justificación                                                                                             |
| ------------- | ------: | --: | --------------------------------------------------------------------------------------------------------- |
| Arquitectura  |       4 |   6 | La cadena causal y los límites CPU/Worker/GPU están en módulos y contratos explícitos.                    |
| Prácticas     |       4 |   6 | CI, hooks, provenance, ramas reproducibles y checks integrados; persiste deuda de integración histórica.  |
| Documentación |       4 |   6 | Decisiones, limitaciones, aproximaciones, referencias, índice y evidencia ejecutable cubren el sistema.   |
| Tests         |       3 |   6 | Unitarios analíticos, validación, goldens, E2E y paridad; la evidencia visual aún requiere Chromium.      |
| Anatomía      |       4 |   6 | Ojo, cráneo, mesencéfalo y Willis tienen geometría/materiales y tests de continuidad.                     |
| B-mode        |       3 |   5 | Raymarch, haz, PSF, TGC, artefactos y ruta GPU son causales, aunque hay aproximaciones 1D y PSF reducida. |
| Doppler       |       4 |   6 | Color, PW, clutter, ángulo, espectro, audio y envolvente comparten adquisición determinista.              |
| Fisiología    |       3 |   5 | Windkessel, HRV, respiración, CrCP y autorregulación acoplan la señal; no hay dinámica completa de PIC.   |
| Clínica       |       3 |   4 | DVNO 2×2, DTE, PI, ALARA y debriefing enseñan protocolo, pero no diagnostican ni modelan patología.       |

La media de estas dimensiones es **5,56/7**; no debe interpretarse como una
validación clínica.
