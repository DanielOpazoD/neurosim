# B09 · Continuidad de adquisición espectral

Defecto: `sync` conserva una ventana parcialmente llena al saltar el reloj con
la misma PRF. Así combina ecos de intervalos separados y les asigna un único
instante, introduciendo espectro sin adquisición contigua. Mecanismo: vaciar
la ventana pendiente si el próximo tiempo difiere más de media muestra del
esperado. Se conserva el historial y se tolera redondeo flotante.

Refutación: emitir una columna con dos medias ventanas separadas por una pausa,
o perder una columna con bloques contiguos. Dos regresiones fallan antes;
la de continuidad pasa tanto antes como después. No cambia FFT, umbrales,
calibración de velocidad ni presentación. Sin validación clínica externa.

`npm run check`: 327 pruebas aprobadas; los siete dorados se conservan. La
corrección actúa solo al reiniciar adquisición en un tiempo discontinuo; no
requiere una nueva apariencia ni añade interpolación visual de pausas.
