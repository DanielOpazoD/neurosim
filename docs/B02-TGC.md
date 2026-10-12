# B02 · TGC por profundidad física

Defecto: GPU interpola ocho bandas hasta la última fila, aunque esa fila no
coincide necesariamente con la profundidad nominal; CPU pierde el último valor
cuando ambos índices coinciden y devuelve cero para una sola banda.
Mecanismo: construir un perfil TGC por fila a partir de z=i·dz, compartido por CPU
y GPU. Predicción: igual ganancia dB a igual profundidad, extremos constantes y
una banda constante. Invariantes: IQ, PSF, geometría y fisiología; TGC no cambia SNR.
Refutación: una señal uniforme cambia distinto según backend o pierde ganancia en
el extremo. Tolerancias numéricas Float32, sin recalibración ni validación clínica.

Verificación: las 3 regresiones CPU fallan en main y pasan corregidas;
`npm run check` aprobado y 2 E2E de paridad CPU/WebGL2 aprobados.
Phantom uniforme 5×5, dz=2 mm, profundidad nominal 10 mm y TGC escalón
−15/+15 dB: error CPU/GPU máximo 63 niveles, media 12,75 antes; cero después.
Capturas reales de ambos renderizadores: [antes](evidence/b02-tgc/b02-antes.png),
[después](evidence/b02-tgc/b02-despues.png). Goldens sin cambios.
