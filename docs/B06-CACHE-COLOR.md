# B06 · Atenuación de cada celda color

Defecto: 96 columnas forman 24 grupos de cuatro, pero la clave reservaba solo
16 grupos por fila. Ocho grupos colisionaban con la fila siguiente, reutilizando
pérdida de otro trayecto. Se calcula el paso de clave desde la malla real.

Invariantes: agrupación lateral de cuatro, determinismo, PRF y flujo. Refutación:
un fantoma que llena la caja debe consultar una vez cada fila/grupo; la prueba
falla antes (2056 consultas) y exige 3072 después. No se presenta el cambio de
caché como validación clínica. La aproximación de cuatro celdas permanece.

`npm run check`: 326 pruebas aprobadas. Solo cambia el hash color ACI; los otros
seis dorados se conservan. La refutación usa un vaso fantoma con radio y caja
ampliados coherentemente para llenar la adquisición, sin tocar parámetros reales.
Esta rama depende de B05 (ganancia color) para mantener una secuencia auditable
de correcciones en la misma normalización color.
