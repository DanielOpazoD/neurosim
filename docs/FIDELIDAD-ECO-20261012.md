# Fidelidad ecográfica: contrato y evidencia (12-10-2026)

Base: `be12db8`, copia aislada de main. Rama local `codex/fidelidad-ecografica-20261012`.
Sin código, pesos ni ejecución de los repositorios externos. Sin cambio de dependencias.

## Diagnóstico y contrato previo a implementación

Cadena inspeccionada: anatomía (`classifyEye`/`classifyHead`, materiales), adquisición
(`probe`, raymarch de `bmode`), señal (IQ, interfaces, artefactos, ruido), presentación
(PSF compartida CPU/WebGL2, envoltura, TGC, compresión, scan conversion).

1. **Defecto/aprendizaje:** normales sin signo y peso especular invertido favorecen
   incidencia oblicua y rompen simetrías. El cociente de velocidades de Snell está
   invertido al atravesar el cristalino. Paredes laterales/reverberaciones/cometas
   eluden la potencia de emisión y el espejo copia ruido electrónico: bajar potencia
   puede conservar ecos artificialmente y compensar con ganancia altera sus proporciones.
2. **Mecanismo/dominio:** corregir orientación y escala de la señal B-mode lineal,
   en las tres estaciones existentes. Sin modificar geometría ni fisiología.
   Modelo reducido de rayos y PSF; no solver de ondas ni validación diagnóstica.
3. **Predicción:** interfaz lisa con mayor retorno a incidencia normal; planos
   reflejados con igual respuesta; Snell `sin θt / ct = sin θi / ci`.
   A −20 dB, todo IQ acústico sin ruido pasa a 0,1 de su amplitud, conservando
   estructura; el ruido electrónico no depende de emisión. Ganancia/TGC actúan
   después y no recuperan SNR. Tolerancia relativa IQ 2e−6 por Float32.
4. **Invariantes/confusores:** semilla, anatomía, posiciones, tiempos, PSF,
   Doppler y controles permanecen. Ruido, saturación, cuantización de normales,
   interfaces laterales aproximadas y persistencia impiden exigir proporcionalidad
   exacta a píxeles de pantalla: se comprueba en IQ y se inspecciona la imagen.
5. **Refutación:** orientaciones reflejadas difieren, oblicuidad aumenta eco,
   parte del IQ no escala, cambia ruido con potencia, o la compensación de ganancia
   altera estructura sin ruido. Ejecutar regresiones contra la base antes del parche.
6. **Aceptación:** regresiones focalizadas, check y cobertura del proyecto,
   paridad CPU/GPU y capturas reales con reloj fijo, controles de potencia,
   frecuencia/profundidad. Revisión clínica externa pendiente.

## Referencias evaluadas (solo lectura)

| Referencia                                                      | Pertinencia y licencia observada                                                              | Decisión                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [PRESTUS](https://github.com/Donders-Institute/PRESTUS)         | MATLAB/k-Wave, preparación de estimulación transcraneal acústica/térmica; GPL-3.0             | No es renderer B-mode web. No integrar.                                                          |
| [ultrasoundsim](https://github.com/glebkuznetsov/ultrasoundsim) | Experimentos MATLAB/FOCUS de campos; sin licencia raíz visible                                | No autorización de reutilización verificada. No copiar.                                          |
| [MimickNet](https://github.com/Ouwen/MimickNet)                 | Posprocesado aprendido; código Apache-2.0, pesos preentrenados CC BY-NC 4.0 según README      | No usar pesos ni ML. Evidencia cardíaca/hepática/phantoms no valida neurosonología.              |
| [HOS](https://github.com/jpaasen/hos)                           | Campos de fuentes, CPU/CUDA; README declara GPL sin versión raíz verificada; enlaza hos-webgl | Conceptualmente útil para haces, no anatomía/B-mode completo. No integrar.                       |
| [FastSIMUS](https://github.com/charlesbmi/FastSIMUS)            | SIMUS/MUST, LGPL-3.0, NumPy/JAX, CuPy y MLX/Metal                                             | Candidato futuro para banco de referencia offline en Apple Silicon; no ejecutado ni incorporado. |

Fuentes físicas independientes del código: [University of Southampton, refracción](https://resource.isvr.soton.ac.uk/spcg/tutorial/tutorial/Tutorial_files/Web-inter-refrac.htm)
y [Vogt, Opretzka y Ermert, IUS 2008, §III.A](https://engineering.purdue.edu/oxidemems/conferences/ultrasonics2008/files/IUS2008-000548.pdf).
El estudio de Vogt usa un phantom y piel a 20 MHz, no neurosonología.
Estas fuentes sustentan dirección de Snell y máximo retorno normal, no calibran los exponentes,
la fracción difusa ni las amplitudes de artefactos del simulador.

## Verificación realizada

- **Refutación en base:** 11/15 regresiones fallan en `be12db8`; las 15 pasan
  después. Para ejecutar sobre la base se adaptaron solamente las dos llamadas
  directas de Snell a su antigua API de cociente (`ci/ct`); el phantom de cuña
  ejecuta el raymarch sin adaptador y también detecta el sentido incorrecto.
- **PSF:** corregido el medidor FWHM (faltaba `b-a` al interpolar el flanco
  derecho recorrido en orden inverso). Se añaden perfiles analíticos con ancho
  conocido. La placa sin speckle se compara con dos gaussianas de superficie,
  no con una caja llena; FWHM axial observado 0,929 mm. Se conservan ±10 %
  axial y ±15 % lateral. Desenfoque probado sobre una segunda placa real.
- **Matriz causal:** 7,5 MHz/30 mm y 15 MHz/60 mm lineales; 2 MHz/80 mm y
  4 MHz/120 mm sectoriales. Potencia −20 dB y ganancia +20 dB conservan señal
  resoluble sin ruido; no se exige proporcionalidad en el suelo logarítmico.
- **Suite:** 55 archivos / 340 pruebas; cobertura de líneas `src/ultrasound`
  100 %, ramas 97,16 %. Umbrales de cobertura intactos. Build, tipos, lint,
  formato, índice documental y procedencia verificados con `npm run check`.
- **Navegador:** 11 E2E aprobados, sin reintentos; incluye paridad CPU/WebGL2
  ocular y temporal con límites originales (media ≤1, P99 ≤4, fracción >8
  ≤0,5 %), determinismo, calipers y flujo docente.
- **Dorados:** solo cambian B-mode ocular, temporal y submandibular. Los
  cuatro hashes Doppler/PW permanecen exactamente iguales.

## Capturas reales y rendimiento

Artefactos acompañantes fuera del repositorio: `evidence-neurosim-20261012/`
(con `capturas.mjs`, PNG, JSON de controles/tiempos y logs). Browser plugin no
está disponible como skill en esta sesión; se usó Playwright del repositorio,
Chromium instalado, SwiftShader, Mac arm64 y Node 22.22.0.

Flujo probado: cargar reloj fijo → bajar emisión ocular → compensar ganancia
→ cambiar a temporal → bajar emisión → cambiar profundidad → viewport móvil.
URLs locales aisladas: `127.0.0.1:6631` (base) y `:6632` (corregido), con
`?renderer=cpu&clock=fixed&t=0.4&seed=20261012`. Viewports 1440×1000 y 390×844.
Sin errores de consola/página ni overlay Vite; imagen con contenido y controles
con respuesta observable. No hay control de frecuencia en esta UI: se prueban
los presets reales (ojo 10 MHz, temporal 2 MHz) y la matriz numérica anterior.

| Captura (prefijos antes/despues) | Adquisición                                                            |
| -------------------------------- | ---------------------------------------------------------------------- |
| `ojo-default.png`                | Ojo D, 10 MHz, 45 mm, foco 22 mm, potencia −3 dB, ganancia 6 dB        |
| `ojo-low.png`                    | Igual, potencia −20 dB                                                 |
| `ojo-compensado.png`             | Igual, potencia −20 dB y ganancia 23 dB (compensa los 17 dB reducidos) |
| `temporal-default.png`           | Temporal D, 2 MHz, 90 mm, preset de fábrica                            |
| `temporal-low.png`               | Igual, potencia −20 dB                                                 |
| `temporal-100mm.png`             | Igual, profundidad 100 mm                                              |
| `desktop.png`, `mobile.png`      | Contexto de la aplicación y adaptación a pantalla                      |

Inspección visual: el contorno ocular/vaina deja de resaltarse artificialmente
al compensar emisión con ganancia; el ruido del vítreo aumenta como corresponde
al menor SNR. El aspecto sigue siendo una aproximación anatómica. El sector
conserva saturación superficial y grano grueso preexistentes; no se afirma haber
resuelto toda su apariencia. En móvil persiste recorte de cabecera/controles
horizontales, fuera del bloque de adquisición corregido.

Tiempos de `renderRequest` B-mode CPU (sin color), tres calentamientos y 15
adquisiciones por estación, medidos con `performance.now()`. Excluyen dibujo,
transferencia Worker y latencia interactiva: no son FPS globales.

| Ronda / estación          | Mediana antes → después (ms) | P95 antes → después (ms) |
| ------------------------- | ---------------------------- | ------------------------ |
| Inicial / ojo             | 51,7 → 52,4                  | 53,5 → 53,5              |
| Inicial / temporal        | 25,9 → 26,2                  | 26,6 → 27,2              |
| Registro final / ojo      | 51,8 → 50,7                  | 57,9 → 51,0              |
| Registro final / temporal | 25,8 → 25,4                  | 26,5 → 26,4              |

La variación entre rondas no permite atribuir una aceleración al parche.
No se observa una regresión relevante en estas condiciones; no es un benchmark
multidispositivo. Los JSON conservan las 15 muestras de la ronda final.

## Límites y siguiente revisión

Implementado y verificado técnicamente; **sin validación clínica externa**.
Anatomía/fisiología conservadas, no reevaluadas contra sujetos ni expertos.
La evidencia independiente sustenta dirección física, no exactitud de DVNO ni
valor diagnóstico. Persisten normales cuantizadas, rayos sin espesor elevacional,
interfaces laterales de apertura aproximada y artefactos 1D con amplitudes
heurísticas (incluida pérdida incompleta del trayecto múltiple).

Se dejan fuera del bloque los candidatos de TGC en el extremo y asignaciones
intermedias de kernels grandes cerca del ápice. La documentación aclara que CPU
y GPU comparten el límite de radio; eso no implica que todas las asignaciones
previas estén acotadas. Requieren su propia refutación antes de corregirlos.
Ninguna dependencia externa, peso o dataset clínico fue incorporado.
