# Aproximaciones registradas

Los valores siguientes son del fixture educativo N1 o de heurísticas del
render. Cada entrada conserva el id del parámetro, el motivo y el plan de
calibración.

- **anatomia-ojo.globeRadiusJitterMm** — ±0,15 mm de asimetría determinista; calibrar con una distribución bilateral de globos adultos.
- **anatomia-ojo.dvnoIntDerMm**, **anatomia-ojo.dvnoIntIzqMm** — DVNO internos del fixture; calibrar con mediciones bilaterales de referencia.
- **anatomia-ojo.eyelidAnteriorMm**, **anatomia-ojo.eyelidAirGapMm**, **anatomia-ojo.eyelidLayerMm**, **anatomia-ojo.eyelidHalfHeightMm**, **anatomia-ojo.corneaLayerMm**, **anatomia-ojo.lensCenterOffsetMm**, **anatomia-ojo.anteriorChamberDepthMm**, **anatomia-ojo.irisPlaneOffsetMm**, **anatomia-ojo.irisPlaneHalfMm**, **anatomia-ojo.globeWallMm** — espesores y límites geométricos del ojo; calibrar con biometría e imágenes orbitales.
- **anatomia-ojo.lensAxialMm** — semieje axial del cristalino del fixture; calibrar con biometría ocular adulta.
- **anatomia-ojo.lensRadialMm** — semieje radial del cristalino del fixture; calibrar con biometría ocular adulta.
- **anatomia-ojo.irisApertureMm** — abertura pupilar representada; calibrar contra imágenes orbitales de referencia.
- **anatomia-ojo.nerveRadiusMm** — radio ONND del fixture; calibrar contra mediciones ecográficas/3D.
- **anatomia-ojo.duraMm** — grosor dural representado; calibrar contra anatomía publicada.
- **anatomia-ojo.sheathEcc** — excentricidad de la vaina; calibrar con reconstrucciones 3D.
- **anatomia-ojo.sheathEccJitter** — variación bilateral del fixture; calibrar con cohortes bilaterales.
- **anatomia-ojo.sheathTaper** — taper hacia el ápex; calibrar con reconstrucciones longitudinales.
- **anatomia-ojo.nerveTaper** — taper del nervio; calibrar con reconstrucciones longitudinales.
- **anatomia-ojo.sheathBulbFrac**, **anatomia-ojo.sheathBulbCenterMm**, **anatomia-ojo.sheathBulbSigmaMm** — perfil de ampolla retrobulbar; calibrar con ecografía longitudinal y reconstrucciones de la vaina.
- **anatomia-ojo.papillaRadiusMm**, **anatomia-ojo.laminaThicknessMm**, **anatomia-ojo.papillaCupMm** — disco y excavación de la papila; calibrar con OCT y anatomía histológica de la lámina cribosa.
- **anatomia-ojo.tortuosityAmpMm**, **anatomia-ojo.tortuosityPeriodMm**, **anatomia-ojo.nerveNasalBendMm** — tortuosidad y curvatura del nervio; calibrar con reconstrucciones 3D longitudinales.
- **anatomia-ojo.gazeAngleRad** — mirada neutra del fixture N1; calibrar con casos que incluyan desviación ocular.
- **anatomia-ojo.centerAbsXmm**, **anatomia-ojo.centerYmm**, **anatomia-ojo.centerZmm** — centros orbitales del fixture; calibrar con coordenadas anatómicas de referencia.
- **anatomia-cabeza.skullCenterXmm**, **anatomia-cabeza.skullCenterYmm**, **anatomia-cabeza.skullCenterZmm** — centro craneal del fixture; calibrar con geometría adulta.
- **anatomia-cabeza.skullRadiusXmm**, **anatomia-cabeza.skullRadiusYmm**, **anatomia-cabeza.skullRadiusZmm** — semiejes craneales; calibrar con geometría adulta.
- **anatomia-cabeza.skullThicknessMm** — espesor craneal fuera de ventana; calibrar con CT o literatura anatómica.
- **anatomia-cabeza.windowThicknessMm** — espesor efectivo de la ventana; calibrar con mediciones transtemporales.
- **anatomia-cabeza.windowQuality** — calidad de ventana estable del fixture; calibrar con distribución de atenuación.
- **anatomia-cabeza.windowRadiusMm** — radio útil de ventana; calibrar con mapas de accesibilidad.
- **anatomia-cabeza.midbrainCenterXmm**, **anatomia-cabeza.midbrainCenterYmm**, **anatomia-cabeza.midbrainCenterZmm** — centro del mesencéfalo; calibrar con atlas anatómico.
- **anatomia-cabeza.midbrainRadiusXmm**, **anatomia-cabeza.midbrainRadiusYmm**, **anatomia-cabeza.midbrainRadiusZmm** — semiejes del mesencéfalo; calibrar con atlas anatómico.
- **anatomia-cabeza.peduncleOffsetXmm**, **anatomia-cabeza.peduncleRadiusXmm**, **anatomia-cabeza.peduncleRadiusYmm**, **anatomia-cabeza.peduncleRadiusZmm**, **anatomia-cabeza.tegmentumRadiusXmm**, **anatomia-cabeza.tegmentumRadiusYmm**, **anatomia-cabeza.tegmentumRadiusZmm** — mariposa mesencefálica aproximada mediante elipsoides unidos y una muesca interpeduncular; calibrar con atlas TCS.
- **anatomia-cabeza.snAreaCm2**, **anatomia-cabeza.snHalfWidthMm**, **anatomia-cabeza.snHalfDepthMm**, **anatomia-cabeza.snCenterYmm**, **anatomia-cabeza.snCenterZOffsetMm**, **anatomia-cabeza.redNucleusRadiusMm** — sustancia negra y núcleos rojos representados como elipsoides; no modelan variabilidad clínica ni casos patológicos.
- **anatomia-cabeza.thirdVentricleWidthMm**, **anatomia-cabeza.thirdVentricleHeightMm**, **anatomia-cabeza.thirdVentricleDepthMm**, **anatomia-cabeza.ependimoThicknessMm**, **anatomia-cabeza.thalamusRadiusXmm**, **anatomia-cabeza.thalamusRadiusYmm**, **anatomia-cabeza.thalamusRadiusZmm**, **anatomia-cabeza.thalamusCenterXmm**, **anatomia-cabeza.pinealRadiusMm**, **anatomia-cabeza.frontalHornCenterXmm**, **anatomia-cabeza.frontalHornCenterZmm**, **anatomia-cabeza.frontalHornRadiusXmm**, **anatomia-cabeza.frontalHornRadiusYmm**, **anatomia-cabeza.frontalHornRadiusZmm** — III ventrículo, paredes ependimarias, tálamos, pineal, cuernos frontales y peñasco como regiones geométricas implícitas; calibrar contra atlas y TCS.
- **clasificacion-anatomica-transtemporal** — la clasificación por regiones implícitas prioriza vasos y estructuras superpuestas, pero no reemplaza una segmentación clínica ni representa límites histológicos finos.
- **anatomia-cabeza.m1RadiusMm**, **anatomia-cabeza.a1RadiusMm**, **anatomia-cabeza.p1RadiusMm**, **anatomia-cabeza.p2RadiusMm**, **anatomia-cabeza.basilarRadiusMm** — radios tubulares; calibrar con angiografía de referencia.
- **anatomia-cabeza.icaRadiusMm**, **anatomia-cabeza.acoaRadiusMm**, **anatomia-cabeza.a2RadiusMm**, **anatomia-cabeza.pcoaRadiusMm**, **anatomia-cabeza.vertebralRadiusMm** — radios de los segmentos añadidos del polígono de Willis; las frecuencias de variantes y la morfología se aproximan con Krabbe-Hartkamp 1998, Walter 2007 y AIUM.
- La comprobación de Murray da `1,73³ = 5,178` frente a
  `1,50³ + 1,20³ = 5,103` en ACI→M1+A1 (≈1,4 % de error), pero
  `1,60³ = 4,096` frente a `2·1,10³ = 2,662` en
  basilar→P1+P1 (≈35,0 %). Los radios basilar/P1 se conservan como
  evidencia de referencia y no se ajustan para forzar la tolerancia.
- **anatomia-cabeza.vesselM1PointXmm**, **anatomia-cabeza.vesselM1PointYmm**, **anatomia-cabeza.vesselM1PointZmm** — punto M1 de la puerta N1; calibrar con geometría vascular.
- **anatomia-cabeza.windowAzimuthTurns**, **anatomia-cabeza.windowElevationRad**, **anatomia-cabeza.windowAnteriorFactor**, **anatomia-cabeza.m1OriginXmm**, **anatomia-cabeza.m1OriginYmm**, **anatomia-cabeza.m1OriginZmm**, **anatomia-cabeza.m1Point1Xmm**, **anatomia-cabeza.m1Point1Ymm**, **anatomia-cabeza.m1Point1Zmm**, **anatomia-cabeza.m1Point3Xmm**, **anatomia-cabeza.m1Point3Ymm**, **anatomia-cabeza.m1Point3Zmm**, **anatomia-cabeza.m1Point4Xmm**, **anatomia-cabeza.m1Point4Ymm**, **anatomia-cabeza.m1Point4Zmm** — orientación y puntos del segmento M1; calibrar con atlas/angiografía de referencia.
- **fisica-ultrasonido.axialPulseMmMhz**, **fisica-ultrasonido.interfaceEpsMm** — aproximaciones de resolución axial y normal; calibrar contra secuencias y fantomas.
- **fisica-ultrasonido.beamDivergenceGamma**, **fisica-ultrasonido.elevationDivergenceGamma**, **fisica-ultrasonido.linearApertureActiveMm**, **fisica-ultrasonido.linearElevationApertureMm**, **fisica-ultrasonido.linearElevationFocusMm**, **fisica-ultrasonido.sectorApertureActiveMm**, **fisica-ultrasonido.sectorElevationApertureMm**, **fisica-ultrasonido.sectorElevationFocusMm** — parámetros geométricos estimados del haz; la lateral combina transmisión desenfocada con recepción de foco dinámico y la elevacional conserva foco fijo; calibrar con la respuesta de cada transductor y fantomas de resolución.
- **materiales.attenuationDbCmMhz**, **materiales.attenuationExponent** — ley de
  potencia α(f)=α₀·fⁿ, con α₀ por material y exponentes entre 1 y 2,2;
  tejidos y líquidos siguen Duck 1990 y Szabo 2014 cap. 4, con ajustes
  explícitos para conservar referencias del modelo lineal anterior.
- **fisica-ultrasonido.reverbRcThreshold**, **fisica-ultrasonido.reverbGain**,
  **fisica-ultrasonido.mirrorGain**, **fisica-ultrasonido.cometStepMm** —
  reglas de reverberación, espejo y cola de cometa basadas en Kremkau 1986 y
  Feldman 2009; espejo y cometa son aproximaciones unidimensionales.
- **adquisicion.lineDensity** — número de líneas por cuadro (128, 176 o 256);
  la densidad media conserva el fixture y el coste de render emerge del
  Worker.
- **fisica-ultrasonido.defaultEyeDepthMm**, **fisica-ultrasonido.defaultEyeFocusMm**, **fisica-ultrasonido.defaultEyeGainDb**, **fisica-ultrasonido.defaultEyeDynamicRangeDb**, **fisica-ultrasonido.defaultEyePersistence**, **fisica-ultrasonido.defaultEyePrfHz**, **fisica-ultrasonido.defaultEyeGateMm**, **fisica-ultrasonido.defaultEyeWallFilterHz** — prescripción de fábrica del fixture; calibrar contra protocolos docentes.
- **fisica-ultrasonido.defaultTgcDb** — TGC inicial plano; calibrar contra la curva de ganancia del equipo.
- **doppler.ruidoElectronico**, **doppler.amplitudSangre**, **doppler.scatterersTotal**, **doppler.scatterersVesselMax** — señal y población virtual; calibrar contra SNR y estabilidad de persistencia.
- **doppler.gateLateralSigmaMinMm**, **doppler.gateElevationSigmaMinMm**, **doppler.gatePulseSigmaMinMm** — mínimos de puerta; calibrar contra el haz del transductor.
- **doppler.apertureAngleSigmaRad**, **doppler.partialWallMm**, **doppler.bloodSeedRadiusFraction**, **doppler.bloodReseedRadiusFraction**, **doppler.bloodReanchorRadiusFraction** — dispersión angular y reglas de persistencia vascular; calibrar contra SNR y fracción sanguínea observada.
- **doppler.defaultTemporalGainDb**, **doppler.defaultTemporalDynamicRangeDb**, **doppler.defaultTemporalPersistence** — prescripción temporal de fábrica; calibrar contra protocolos docentes.
- **doppler.colorEnsemble**, **doppler.colorScatterers**, **doppler.colorNoiseRel**,
  **doppler.colorPowerThreshold**, **doppler.colorVarianceMax** — ensemble IQ
  sintético y umbrales del estimador Kasai; la potencia se expresa como fracción
  de la referencia de una celda completamente sanguínea y atenuada; se aproximan
  con AIUM TCD y Evans & McDicken, sin calibración frente a datos IQ clínicos.
- **doppler.wallExcursionMm** — `0,05 mm`, excursión sistólica reducida de la
  pared arterial; se usa como aproximación de clutter, no como medición
  individual.
- **doppler.wallMotionDecayMm** — `1,5 mm`, longitud de decaimiento radial de
  la velocidad de pared.
- **doppler.brainPulsationMm** — `0,15 mm`, pulsación cerebral anterior uniforme;
  aproximación educativa sin una fuente específica verificada en este bloque.
- **doppler.handTremorMmS** — `0,8 mm/s` por componente, dos senos deterministas
  entre 8 y 12 Hz; no representa una trayectoria clínica individual.
- **fisiologia.heartRateBpm**, **fisiologia.mapMmHg**, **fisiologia.a1PsvCms**, **fisiologia.a1EdvCms**, **fisiologia.p1PsvCms**, **fisiologia.p1EdvCms**, **fisiologia.basilarPsvCms**, **fisiologia.basilarEdvCms** — fisiología vascular del fixture N1; calibrar contra trazas clínicas anonimizadas.
- **fisiologia.ejectionFraction**, **fisiologia.windkesselTauS**, **fisiologia.backflowFraction**, **fisiologia.backflowDurationFraction** — parámetros del Windkessel de dos elementos; `windkesselTauS = 0,18 s` es el valor final ajustado para mantener media de onda entre 0,34 y 0,39.
- **fisiologia.respiratoryRatePerMin**, **fisiologia.respFlowModulation**, **fisiologia.respBrainShiftMm**, **fisiologia.hrvSd**, **fisiologia.rsaAmplitude** — respiración, modulación hemodinámica y variabilidad RR deterministas; son aproximaciones educativas sin autorregulación ni acoplamiento PIC.
- **fisiologia.laminarProfile** — perfil parabólico de velocidad; calibrar contra perfiles Doppler intravasculares.
- **fisiologia.qM1MlMin**, **fisiologia.qA2MlMin**, **fisiologia.qP2MlMin** — caudales terminales derivados de la media numérica de `arterialShape`; la continuidad de Murray se comprueba, no se impone. Las variantes representan aplasia/hipoplasia A1 (~10 %) y ACP fetal (~15–20 %) como escenarios docentes, no como prevalencia individual.
