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
- **anatomia-cabeza.m1RadiusMm**, **anatomia-cabeza.a1RadiusMm**, **anatomia-cabeza.p1RadiusMm**, **anatomia-cabeza.p2RadiusMm**, **anatomia-cabeza.basilarRadiusMm** — radios tubulares; calibrar con angiografía de referencia.
- **anatomia-cabeza.vesselM1PointXmm**, **anatomia-cabeza.vesselM1PointYmm**, **anatomia-cabeza.vesselM1PointZmm** — punto M1 de la puerta N1; calibrar con geometría vascular.
- **anatomia-cabeza.windowAzimuthTurns**, **anatomia-cabeza.windowElevationRad**, **anatomia-cabeza.windowAnteriorFactor**, **anatomia-cabeza.m1OriginXmm**, **anatomia-cabeza.m1OriginYmm**, **anatomia-cabeza.m1OriginZmm**, **anatomia-cabeza.m1Point1Xmm**, **anatomia-cabeza.m1Point1Ymm**, **anatomia-cabeza.m1Point1Zmm**, **anatomia-cabeza.m1Point3Xmm**, **anatomia-cabeza.m1Point3Ymm**, **anatomia-cabeza.m1Point3Zmm**, **anatomia-cabeza.m1Point4Xmm**, **anatomia-cabeza.m1Point4Ymm**, **anatomia-cabeza.m1Point4Zmm** — orientación y puntos del segmento M1; calibrar con atlas/angiografía de referencia.
- **fisica-ultrasonido.axialPulseMmMhz**, **fisica-ultrasonido.interfaceEpsMm** — aproximaciones de resolución axial y normal; calibrar contra secuencias y fantomas.
- **fisica-ultrasonido.beamDivergenceGamma**, **fisica-ultrasonido.linearApertureActiveMm**, **fisica-ultrasonido.linearElevationApertureMm**, **fisica-ultrasonido.linearElevationFocusMm**, **fisica-ultrasonido.sectorApertureActiveMm**, **fisica-ultrasonido.sectorElevationApertureMm**, **fisica-ultrasonido.sectorElevationFocusMm** — parámetros geométricos estimados del haz por apertura; calibrar con la respuesta de cada transductor y fantomas de resolución.
- **fisica-ultrasonido.defaultEyeDepthMm**, **fisica-ultrasonido.defaultEyeFocusMm**, **fisica-ultrasonido.defaultEyeGainDb**, **fisica-ultrasonido.defaultEyeDynamicRangeDb**, **fisica-ultrasonido.defaultEyePersistence**, **fisica-ultrasonido.defaultEyePrfHz**, **fisica-ultrasonido.defaultEyeGateMm**, **fisica-ultrasonido.defaultEyeWallFilterHz** — prescripción de fábrica del fixture; calibrar contra protocolos docentes.
- **fisica-ultrasonido.defaultTgcDb** — TGC inicial plano; calibrar contra la curva de ganancia del equipo.
- **doppler.ruidoElectronico**, **doppler.amplitudSangre**, **doppler.scatterersTotal**, **doppler.scatterersVesselMax** — señal y población virtual; calibrar contra SNR y estabilidad de persistencia.
- **doppler.gateLateralSigmaMinMm**, **doppler.gateElevationSigmaMinMm**, **doppler.gatePulseSigmaMinMm** — mínimos de puerta; calibrar contra el haz del transductor.
- **doppler.apertureAngleSigmaRad**, **doppler.partialWallMm**, **doppler.bloodSeedRadiusFraction**, **doppler.bloodReseedRadiusFraction**, **doppler.bloodReanchorRadiusFraction** — dispersión angular y reglas de persistencia vascular; calibrar contra SNR y fracción sanguínea observada.
- **doppler.defaultTemporalGainDb**, **doppler.defaultTemporalDynamicRangeDb**, **doppler.defaultTemporalPersistence** — prescripción temporal de fábrica; calibrar contra protocolos docentes.
- **fisiologia.heartRateBpm**, **fisiologia.mapMmHg**, **fisiologia.a1PsvCms**, **fisiologia.a1EdvCms**, **fisiologia.p1PsvCms**, **fisiologia.p1EdvCms**, **fisiologia.basilarPsvCms**, **fisiologia.basilarEdvCms**, **fisiologia.upstrokePhase**, **fisiologia.decayTau** — fisiología/onda vascular del fixture N1; calibrar contra trazas clínicas anonimizadas.
- **fisiologia.laminarProfile** — perfil parabólico de velocidad; calibrar contra perfiles Doppler intravasculares.
