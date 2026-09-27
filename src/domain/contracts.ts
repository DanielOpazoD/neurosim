/**
 * Contratos mínimos del simulador (plan §12.1). Separan la verdad del paciente,
 * la adquisición y la medición: un caso, versión de activos y semilla se
 * reproducen; freeze/cine no se recalculan con el estado presente.
 */
import type { Vec3 } from '../core/vec3';

/** Lado anatómico del paciente (marco levógiro: +x = izquierda del paciente). */
export type Side = 'izq' | 'der';

/** Variante anatómica del polígono de Willis para docencia. */
export type WillisVariant = 'normal' | 'aplasiaA1Der' | 'aplasiaA1Izq' | 'pcaFetalDer' | 'pcaFetalIzq';

/** Región de exploración: órbita ocular o ventana transtemporal. */
export type Station = 'ojo' | 'temporal';

/** Identificador del paciente virtual: semilla + versión de activos. */
export interface PatientState {
  /** Semilla de generación; fija toda la variabilidad individual. */
  readonly seed: number;
  /** Versión del manifiesto anatómico/material usado para derivar el paciente. */
  readonly manifestVersion: string;
  /** Etiqueta humana del caso (p. ej. «Adulto de referencia N1»). */
  readonly label: string;
  /** Parámetros fisiológicos basales (latente, solo para motor y debriefing). */
  physiology: BasalPhysiology;
}

/** Fisiología basal documentada del adulto de referencia (plan §2.4). */
export interface BasalPhysiology {
  /** Frecuencia cardíaca, latidos por minuto. */
  readonly heartRateBpm: number;
  /** Presión arterial media de referencia, mmHg. */
  readonly mapMmHg: number;
  /** PaCO2 basal, mmHg. */
  readonly paco2MmHg: number;
  /** PIC latente basal, mmHg (no se muestra ni se deriva de la imagen). */
  readonly icpMmHg: number;
}

/** Tipo físico de transductor. */
export type TransducerKind = 'linear' | 'sector';
export type LineDensity = 'baja' | 'media' | 'alta';

/** Pose completa de la sonda: nunca un nombre de vista. */
export interface ProbePose {
  /** Punto de contacto sobre la piel/párpado en coordenadas del paciente (mm). */
  readonly origin: Vec3;
  /** Dirección del haz central, unitaria, del transductor hacia el paciente. */
  readonly forward: Vec3;
  /** Dirección lateral derecha del plano de imagen en el paciente (unitaria). */
  readonly lateral: Vec3;
  /**
   * Ángulo del marcador de orientación respecto a `lateral` (rad).
   * 0 = marcador hacia `lateral`.
   */
  readonly markerAngleRad: number;
  /** Presión de contacto relativa [0,1]; didáctica, no fuerza medida. */
  readonly contactPressure: number;
}

/** Ajustes del equipo con efecto observable definido. Unidades explícitas. */
export interface AcquisitionSettings {
  readonly transducer: TransducerKind;
  /** Densidad lateral de líneas adquiridas. */
  readonly lineDensity: LineDensity;
  /** Frecuencia central de emisión, MHz. */
  readonly frequencyMhz: number;
  /** Profundidad mostrada, mm. */
  readonly depthMm: number;
  /** Foco (profundidad del foco elevacional/lateral), mm. */
  readonly focusMm: number;
  /** Ganancia global de recepción, dB. */
  readonly gainDb: number;
  /** Compensación por bandas de profundidad (8 valores, dB). */
  readonly tgcDb: readonly number[];
  /** Rango dinámico de compresión, dB. */
  readonly dynamicRangeDb: number;
  /** Persistencia temporal [0,1]. */
  readonly persistence: number;
  /** PRF del Doppler pulsado, Hz. */
  readonly prfHz: number;
  /** Tamaño axial del gate PW, mm. */
  readonly gateMm: number;
  /** Filtro de pared, Hz (frecuencia eliminada alrededor de cero). */
  readonly wallFilterHz: number;
  /** Ángulo de corrección Doppler introducido por el usuario, grados. */
  readonly angleCorrectionDeg: number;
  /** Posición de la línea base del espectro [0,1] (0=arriba). */
  readonly baseline: number;
  /** Ganancia específica del Doppler espectral, dB. */
  readonly dopplerGainDb: number;
  /** Inversión de la paleta de color. */
  readonly invertColor: boolean;
}

/** Geometría de imagen de un cuadro (basta para reconstruir la escala). */
export interface ImageGeometry {
  readonly kind: TransducerKind;
  /**
   * Vértice del barrido: para `sector` es la cara de la sonda; para `linear`,
   * el centro de la abertura (las coordenadas u son relativas a él).
   */
  readonly apex: Vec3;
  /** Origen lateral de la línea izquierda en coordenadas del paciente. */
  readonly scanOrigin: Vec3;
  /** Dirección lateral del barrido (unitaria). */
  readonly lateralDir: Vec3;
  /** Dirección axial (hacia profundidad, unitaria). */
  readonly axialDir: Vec3;
  /** Ancho lateral del barrido, mm (lineal) o apertura, rad (sector). */
  readonly widthMmOrRad: number;
  /** Profundidad mostrada, mm. */
  readonly depthMm: number;
}

/** Cuadro adquirido: inmutable, con su contexto completo. */
export interface AcquiredFrame {
  /** Tiempo fisiológico del cuadro, s. */
  readonly tSeconds: number;
  readonly geometry: ImageGeometry;
  /** Copia de los ajustes vigentes al adquirir. */
  readonly settings: AcquisitionSettings;
  /** Lado y estación explorados. */
  readonly side: Side;
  readonly station: Station;
  /** Imagen B-mode en escala de grises [0,255], filas = profundidad. */
  readonly bmode?: {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly pixels: Uint8ClampedArray;
  };
  readonly caseId: string;
  readonly seed: number;
}

/** Convención de bordes para DVNO. */
export type OnsdConvention = 'interno' | 'externo';

/** Medición trazada sobre lo adquirido; permanece ligada a su cuadro. */
export interface Measurement {
  readonly kind: 'distancia' | 'dvno' | 'trazado-espectral';
  readonly frameTSeconds: number;
  readonly side: Side;
  /** Coordenadas físicas de los puntos del caliper, mm. */
  readonly pointsMm: readonly Vec3[];
  /** Valor medido en su unidad (`unit`). */
  readonly value: number;
  readonly unit: 'mm' | 'cm/s' | '';
  /** Convención DVNO declarada, si aplica. */
  readonly convention?: OnsdConvention;
  /** Distancia retroglobo de referencia usada para DVNO, mm (típ. 3). */
  readonly referenceOffsetMm?: number;
}
