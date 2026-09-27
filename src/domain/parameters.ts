/**
 * Registro agregado de parámetros con evidencia, separado por dominio.
 * Cada conjunto se valida al importarse mediante `defineParameters`.
 */
import { ANATOMIA_CABEZA, ANATOMIA_OJO } from '../anatomy/params';
import { DOPPLER } from '../doppler/params';
import { FISIOLOGIA } from '../physiology/params';
import { FISICA_US } from '../ultrasound/params';

export const PARAMETER_SETS = [ANATOMIA_OJO, ANATOMIA_CABEZA, FISICA_US, DOPPLER, FISIOLOGIA] as const;
