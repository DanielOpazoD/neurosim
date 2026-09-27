# Decisiones de diseño

1. **Repo independiente `neurosono-sim`** con porte selectivo de
   vexus-sim/lus-sim (plan §6.2). Sin submódulos: los archivos portados
   llevan cabecera de procedencia.
2. **mm + marco levógiro (+x = izquierda del paciente)** en todo el motor,
   igual que vexus-sim. Los datos se convierten solo en la presentación.
3. **"Nada se pinta: emerge"** — B-mode raymarch con materiales, speckle
   coherente sembrado, ecos de interfaz por ΔZ; Doppler por dispersores
   virtuales advectados con el campo de velocidades real.
4. **Separación paciente/adquisición/señal/medición** por contratos
   (`src/domain/contracts.ts`); la medición se liga al cuadro adquirido
   (freeze/cine no recalculan).
5. **DVNO interno vs externo** son dos convenciones distintas
   (`OnsdConvention`); el interno excluye duramadre y es el por defecto.
6. **TAMax = integral de la envolvente verdadera** del espectro por
   latido; la fórmula (PSV+2·EDV)/3 no se usa internamente.
7. **Sonda lineal ocular** explícita (vexus solo tenía convexa/fasada);
   **sectorial** para la ventana transtemporal.
8. **CPU primero, GPU después** — el plan permite modelo reducido; la
   paridad TS/GLSL se decide si se porta a WebGL2 (LIMITATIONS).
9. **Dispersores de sangre con `flowBasis` congelado** (portado de vexus-sim):
   cada dispersor mantiene dirección y perfil laminar del momento de
   clasificación y advecta en cuerda recta; vBlood = flowBasis·u(φ). Reentra
   por la misma cuerda al salir de la caja. La reclasificación re-ancla al eje
   del vaso (máx. 0,9·R) en vez de convertir a tejido — la sangre no abandona
   el vaso. Sin esto la población de la puerta se agotaba en ~10 s.
10. **Siembra dirigida en vasos** (`seedVessels`, máx. 32): al mover la puerta
    se siembran dispersores sobre el tramo del vaso dentro de la caja — la
    sangre llena el tubo; sin ella un tubo de 3 mm en una caja de ~3 cm³
    apenas captaba dispersores.
11. **Volumen parcial en la pared del tubo** (±0,6 mm): el voxel borde mezcla
    sangre y tejido; se clasifica sangre con la velocidad de la línea central.
    La amplitud de sangre (6) sigue 5× por debajo del tejido pero supera el
    umbral de detección de la envolvente (12 dB sobre ruido).
12. **El fixture DVNO se deriva del manifiesto** (interno + 2·dura), nunca se
    codifica dos veces.
