# B08 · Ruido receptor Doppler color

Defecto: transmisión multiplicaba señal y ruido y después se dividía potencia
por transmisión al cuadrado. La atenuación no deterioraba SNR ni estimación de
velocidad. Mecanismo: generar ruido electrónico después de transmisión, con
amplitud receptora fija compartida con PW (ruidoElectronico=0,0004). La pérdida sigue afectando al eco y no al receptor.

Invariantes: geometría, PRF, semilla, ganancia, señal sin pérdida, umbrales existentes. Refutación: ante 120 dB de pérdida, varianza y error de
velocidad no pueden seguir idénticos. La prueba falla antes y pasa después.
La intensidad del ruido es estimada, sin calibración clínica. El umbral Kasai
existente permite falsos colores por ruido; no se afirma desaparición de todos
los píxeles en ventanas imposibles ni sensibilidad diagnóstica validada.

La escala relativa anterior no se reutiliza como absoluta: rompía las pruebas
de velocidad M1 y signo venoso ocular. Se comparte la escala receptora PW ya
existente, sin modificar sus valores ni tolerancias. Se elimina el parámetro
colorNoiseRel obsoleto. Es consistencia interna, no calibración clínica.

La regresión adicional de caché compara potencia, velocidad y varianza con un
oráculo que recalcula todos los trayectos de pérdida variable por fila. La
mutación a la clave antigua debe fallar también en la salida, no solo llamadas.

La regresión de referencia sin caché usa un vaso fantoma que cubre toda la
caja y pérdida variable por profundidad. Las dos pruebas fallan al restaurar
la clave antigua y pasan con la clave corregida. Se conserva igualdad exacta
de los mapas de potencia, velocidad y varianza frente al cálculo sin caché.

Verificación final: `npm run check` completo (331 pruebas), signo ACR/VCR,
velocidad M1 y flujo docente E2E aprobados. Cambian solo los tres dorados color.
Captura final real: temporal derecha, 2 MHz, 90 mm, color activado, semilla
20261012, t=0,4 fijo; nivel receptor compartido con PW.

![Ruido receptor corregido](evidence/b08-ruido/b08-despues.png)
