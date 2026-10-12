# B03 · Kernels acotados antes de reservar

Defecto: el radio final de 64 no impide construir dos gaussianas completas,
con millones de coeficientes cerca del ápice sectorial. Puede bloquear adquisición.
Mecanismo: generar solo los coeficientes retenidos; conservar la normalización del
kernel completo mediante suma discreta acotada o cuadratura para sigma enorme.
Predicción: ninguna reserva de kernel supera 129 floats al pedir radio 64, incluso
con sigma 10 millones. Invariantes: normalización, mezcla de lóbulos, PSF y paridad.
Refutación: reserva mayor, coeficientes no finitos o desviación del kernel de
referencia >1e-6. No aumenta fidelidad clínica; elimina un límite de adquisición.

Verificado: la guardia de reservas falla en la base y pasa corregida. Comparación
con normalización discreta anterior independiente para sigma 1, 20, 100 y 2000,
error absoluto <1e-6. Suma discreta hasta radio 4096; por encima, Simpson de 128
segmentos y corrección de punto medio. No se trunca cada lóbulo y renormaliza por
separado: eso alteraría su mezcla relativa. Goldens sin cambios; `npm run check`
y paridad CPU/GPU ocular/temporal aprobados.

Medición Chromium local, nueve construcciones de sigma=200000/radio=64:
mediana 17,4 ms antes; después por debajo de resolución 0,1 ms (máximo 0,3 ms).
Es coste del kernel aislado, no FPS globales. La prueba de sigma=10 millones
intercepta la reserva original de 50.000.001 floats antes de asignarla; el parche
solo reserva arrays de 129 floats para cada lóbulo y resultado.
