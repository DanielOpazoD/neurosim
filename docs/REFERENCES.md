# Referencias

- **doppler-prf-alcance** — Física de Doppler pulsado: Nyquist ±PRF/2,
  PRF máxima ideal `c/(2·d)` y compromiso profundidad–velocidad.
  [Revisión técnica DRPS](https://www.diagnosticradphys.com/physicspulse/diagnostic-medical-physics/doppler-ultrasound-physics-aliasing-nyquist/).
- **gill-ambiguedad-rango-1989** — Gill RW et al. _New class of pulsed Doppler
  US ambiguity at short ranges_. Radiology 1989;173(1):272–275.
  [DOI:10.1148/radiology.173.1.2675187](https://pubmed.ncbi.nlm.nih.gov/2675187/).
  PRF alta y puertas fantasma fuera de la puerta deseada: comprobar el alcance
  nominal no prueba ausencia de señales ambiguas desde regiones más profundas.

Claves usadas por los registros de `src/*/params.ts` (evidencia) y los módulos
del motor.

- **qcc-consenso-onsd-2024** — Consenso de expertos (Quality Critical Care /
  grupo de neurosonología 2024): sonda lineal ≥7,5 MHz, DVNO a 3 mm
  retroglobo, corte ~5,1–5,8 mm para PIC > 20 mmHg; sin umbral universal.
- **montorfano-onsd-2018** — Montorfano et al.: técnica de medición ONSD a
  3 mm retroglobo, bidimensional, reproducibilidad.
- **vaiman-2014** — Vaiman M et al.: medición ecográfica conjunta del diámetro
  de la vaina del nervio óptico y del diámetro transverso del globo (ETD).
- **du-2020** — Du J et al.: meta-análisis de DVNO y diámetro ocular
  transverso para la evaluación ecográfica del nervio óptico.
- **aium-seguridad-ocular-2019** — AIUM/NEMA: límites de exposición en
  oftalmología (MI ≤ 0,23, TI ≤ 1,0) y prescripción ALARA.
- **aium-tcd-guia** — AIUM Practice Parameter: TCD/TCCD, ventanas
  temporales, profundidades y dirección de flujo por vaso.
- **siemens-tcd-job-aid** — Siemens TCD job aid: tabla de profundidades
  M1 40–65 mm (hacia la sonda), A1 60–85 mm (alejándose), bifurcación ACI
  ~55–65 mm bidireccional, P1/P2 60–70 mm, OA ventana orbital 40–60 mm.
- **gosling-pi-referencia** — Índice de pulsatilidad de Gosling:
  PI = (PSV − EDV)/MFV, rango normal 0,5–1,19 en adulto.
- **lindegaard-indice-1989** — Lindegaard et al.: razón MFV
  ACM/ACI-extracraneal ipsilateral; el cociente debe interpretarse junto con
  velocidad ACM, calidad de adquisición y contexto, no como diagnóstico.
- **samagh-tcd-vasospasm-2019** — Samagh N et al. Monitoring cerebral
  vasospasm: How much can we rely on transcranial Doppler. J Anaesthesiol
  Clin Pharmacol. 2019. [Texto y tabla de criterios](https://pmc.ncbi.nlm.nih.gov/articles/PMC6495622/).
  Revisión: velocidad media ACM 120–199 cm/s con Lindegaard 3–6; rango
  grave >200 cm/s con cociente >6. DEC-70 explicita las fronteras docentes
  y la ausencia de validación de estos umbrales sobre la TAMax simulada.
- **silverman-3d-onsd-2026** — Silverman RH et al. Reconstrucción 3D por
  ultrasonido de la vaina del nervio óptico en 18 voluntarios sanos. _Transl
  Vis Sci Technol_ 2026; https://tvst.arvojournals.org/article.aspx?articleid=2818030.
  Comunica excentricidad geométrica e = 0,51 ± 0,098 de la sección de la
  vaina (razón de ejes b/a = √(1 − e²) ≈ 0,86, es decir a/b ≈ 1,16; no ≈ 2
  como se citó antes) y DVNO 5,32 ± 0,79 mm en B-scan frente a 5,57 ± 0,61 mm
  en 3D. No demuestra una regla general de sobrestimación axial ni valida una
  relación PIC–DVNO; distinto del estudio freehand de Riemer (12 sujetos).
- **hansen-helmke-1997** — Hansen HC, Helmke K. The subarachnoid space
  surrounding the optic nerves. An ultrasound study of the optic nerve sheath.
  Surg Radiol Anat 1996;18:323-8.
- **vaiman-2014** — Vaiman M et al. Ultrasonographic measurement of the
  optic nerve sheath diameter and transverse eyeball diameter; relación DVNO/ETD
  como control de tamaño del globo.
- **du-2020** — Du J et al. Meta-análisis de DVNO y diámetro ocular
  transversal para la evaluación ecográfica del nervio óptico.
- **killer-2003** — Killer HE et al. Architecture of arachnoid trabeculae,
  pillars, and septa in the subarachnoid space of the human optic nerve.
  Br J Ophthalmol 2003;87:777-81.
- **jonas-lamina-2003** — Jonas JB et al. Lamina cribrosa thickness and
  spatial relationships. Invest Ophthalmol Vis Sci 2004;45:2660-5.
- **plan-simulador-2026** — Plan del simulador de neurosonografía
  (documento de trabajo del usuario): fixture N1, decisiones de alcance.
- **topcow-2024** — Yang K et al. Benchmarking the CoW with the TopCoW
  Challenge: Topology-Aware Anatomical Segmentation of the Circle of Willis for
  CTA and MRA. Datos: Zenodo 10.5281/zenodo.15692630 (TopCoW Data Usage
  License). Derivados en `data/atlas/` (DEC-77): envolventes de radios,
  distancia entre terminales de ACI, punta basilar y extremos de A2/P2/M1.
- **szabo-diagnostic-ultrasound-2014** — Szabo TL. _Diagnostic Ultrasound
  Imaging: Inside Out_. 2nd ed. Academic Press; 2014: capítulos 4 y 6–7,
  atenuación, propagación, apertura y resolución del haz.
- **jensen-fieldii-1996** — Jensen JA. Field: A Program for Simulating
  Ultrasound Systems. Med Biol Eng Comput. 1996;34 Suppl 1:351-353.
- **garcia-simus-2022** — Garcia D. SIMUS: an open-source simulator for
  medical ultrasound imaging. Part I: theory & examples. _Comput Methods
  Programs Biomed_ 2022;218:106726. Implementación PyMUST (LGPL-3.0),
  https://github.com/creatis-ULTIM/PyMUST. Motor externo del banco acústico
  (`data/acoustic/`, DEC-79): PSF de dispersor puntual frente a `beam.ts`.
- **hedrick-hykes-ultrasound** — Hedrick WR, Hykes DL, Starchman DE.
  _Ultrasound Physics and Instrumentation_. 4th ed. Mosby; 2005.
- **tablas-acusticas-estandar** — Tablas estándar de propiedades acústicas de
  tejidos y materiales para simulación educativa; valores aproximados del
  modelo, no una calibración clínica.
- **duck-tissue-1990** — Duck FA. _Physical Properties of Tissue: A
  Comprehensive Reference Book_. Academic Press; 1990.
- **kremkau-artifacts** — Kremkau FW, Taylor KJ. Artifacts in ultrasound
  imaging. J Ultrasound Med. 1986;5:227-37.
- **feldman-artifacts-2009** — Feldman MK et al. US artifacts. Radiographics.
  2009;29:1179-89.
- **walter-tccs-2007** — Walter U. Transcranial sonography in brain
  disorders. Ultraschall Med. 2007.
- **lieb-orbital-doppler** — Lieb WE et al. Colour Doppler imaging of the
  eye and orbit. Arch Ophthalmol 1991; calibres y velocidades orbitarias
  (ACR ~10/3, AO ~35/8 cm/s, venas centrales ~6–8 cm/s).
- **berg-midbrain-2008** — Berg D, Godau J, Walter U. Transcranial
  sonography in movement disorders. Lancet Neurol. 2008;7:1044-55.
- **seidel-tcs-1995** — Seidel G, Kaps M, Gerriets T. Potential and
  limitations of transcranial color-coded sonography. Stroke. 1995;26:2061-6.
- **krabbe-hartkamp-1998** — Krabbe-Hartkamp MJ et al. Circle of Willis:
  morphologic variation on 3D TOF MR angiograms. Radiology. 1998.
- **murray-minimum-work-1926** — Murray CD. The physiological principle of
  minimum work. Proc Natl Acad Sci USA. 1926.
- **kasai-autocorrelation-1985** — Kasai C et al. Real-time two-dimensional
  blood flow imaging using an autocorrelation technique. IEEE Trans Sonics
  Ultrason. 1985.
- **evans-mcdicken-doppler-2000** — Evans DH, McDicken WN. _Doppler
  Ultrasound: Physics, Instrumentation, and Clinical Applications_. 2nd ed.
  Wiley; 2000.
- **westerhof-windkessel-2009** — Westerhof N, Lankhaaer JW, Westerhof BE.
  The arterial Windkessel. Med Biol Eng Comput. 2009.
- **aaslid-1989** — Aaslid R, Lindegaard KF, Sorteberg W, Nornes H. Cerebral
  autoregulation dynamics in humans. _Stroke_ 1989;20:45-52. Respuesta de la
  velocidad en ACM a la caída brusca de presión (manguitos): recuperación en
  segundos; base de `autoregTauS`.
- **tiecks-1995** — Tiecks FP, Lam AM, Aaslid R, Newell DW. Comparison of
  static and dynamic cerebral autoregulation measurements. _Stroke_
  1995;26:1014-1019. Modelo de segundo orden del índice ARI (T, D, K) usado
  como referencia del orden de magnitud de `autoregTauS`.
- **poulin-1996** — Poulin MJ, Liang PJ, Robbins PA. Dynamics of the cerebral
  blood flow response to step changes in end-tidal PCO₂ and PO₂ in humans.
  _J Appl Physiol_ 1996;81:1084-1095. Retardo y constante de tiempo de la
  velocidad en ACM ante escalones de CO₂; base de `co2TauS` y `co2DelayS`.
- **marmarou-1978** — Marmarou A, Shulman K, Rosende RM. A nonlinear analysis
  of the cerebrospinal fluid system and intracranial pressure dynamics.
  _J Neurosurg_ 1978;48:332-344. Curva presión–volumen exponencial e índice
  PVI; base de `pviMl`.
- **davson-1970** — Davson H, Hollingsworth G, Segal MB. The mechanism of
  drainage of the cerebrospinal fluid. _Brain_ 1970;93:665-678. Ecuación de
  Davson PIC = P_ss + I_f·R_out; base de `csfFormationMlMin` y
  `csfOutflowResistanceMmHgMinMl`.
- **czosnyka-2004-icp** — Czosnyka M, Pickard JD. Monitoring and
  interpretation of intracranial pressure. _J Neurol Neurosurg Psychiatry_
  2004;75:813-821. Revisión de PVI, R_out, compliance y reserva
  compensatoria; base de `csfDisplaceableMl` e `icpCapMmHg`.
- **czosnyka-varsos-crcp-2013** — Czosnyka M, Varsos GV. Critical closing
  pressure and cerebral perfusion pressure: CrCP as ICP plus effective vessel
  wall tension. Neurocritical care reference, 2013.
- **willie-2014** — Willie CK et al. Regional brain blood flow in response to
  changes in arterial CO₂; cerebrovascular reactivity reference, 2014.
- **lassen-1959** — Lassen NA. Cerebral blood flow and oxygen consumption in
  man. Physiological Reviews. 1959;39:183–238.
- **aium-nema-output-display-standard** — AIUM/NEMA. Standard for real-time
  display of thermal and mechanical acoustic output indices (ODS), MI y TI.
- **fda-diagnostic-ultrasound-2023** — FDA. Marketing Clearance of Diagnostic
  Ultrasound Systems and Transducers, guidance 2023; límites de salida
  acústica y prescripción ALARA.
- **iec-62359** — IEC 62359. Ultrasonics — Field characterization —
  Test methods for the determination of thermal and mechanical indices.
