#!/usr/bin/env python3
"""
Banco acústico offline (R09): PSF de referencia con PyMUST.

Simula un dispersor puntual con PyMUST (port Python de MUST, LGPL-3.0) para
las dos sondas del simulador —lineal ocular y sectorial temporal— con la misma
apertura activa, frecuencia y foco que `probeBeamSpec`, y mide:

  * anchura lateral y axial a −6 dB de la PSF de ida y vuelta (TX foco fijo,
    RX delay-and-sum con apertura completa, sin apodización);
  * anchura a −6 dB del campo de presión de ida (`pfield`) en cada profundidad.

Salida: JSON compacto con versiones fijadas, parámetros y tablas por
profundidad. El runtime y los tests solo leen ese JSON; PyMUST no entra en el
bundle. Un motor externo no es verdad clínica: es una segunda implementación
de la física lineal con la que contrastar el modelo gaussiano de `beam.ts`.

Uso:
  python3 scripts/acoustic/pymust_psf.py data/acoustic/pymust-psf.json
"""
from __future__ import annotations

import json
import platform
import sys
from importlib.metadata import version

import numpy as np
import pymust

C_MS = 1540.0
N_ELEMENTS = 64
BANDWIDTH_PCT = 70
GRID_N = 241

# Presets del simulador (src/ultrasound/params.ts + src/domain/settings.ts).
PRESETS = [
    {
        'id': 'ocular-lineal',
        'transducer': 'linear',
        'frequencyMhz': 10.0,
        'apertureMm': 12.0,
        'focusMm': 22.0,
        'depthsMm': [10, 15, 20, 22, 25, 30, 35, 40],
        'steerDeg': [0.0],
    },
    {
        'id': 'temporal-sectorial',
        'transducer': 'sector',
        'frequencyMhz': 2.0,
        'apertureMm': 15.0,
        'focusMm': 50.0,
        'depthsMm': [30, 40, 50, 55, 60, 70, 80],
        'steerDeg': [0.0, 30.0],
    },
]


def make_param(fc_hz: float, aperture_mm: float):
    p = pymust.utils.Param()
    p.fc = fc_hz
    p.Nelements = N_ELEMENTS
    p.pitch = aperture_mm * 1e-3 / N_ELEMENTS
    p.kerf = 0.1 * p.pitch
    p.width = p.pitch - p.kerf
    p.bandwidth = BANDWIDTH_PCT
    p.c = C_MS
    p.fs = 4 * fc_hz
    p.fnumber = 0  # RX con toda la apertura (como el modelo rx de beam.ts)
    return p


def width_6db(line: np.ndarray, axis_m: np.ndarray) -> float:
    env = np.abs(line)
    env = env / env.max()
    db = 20 * np.log10(env + 1e-12)
    idx = np.where(db >= -6)[0]
    return float((axis_m[idx[-1]] - axis_m[idx[0]]) * 1e3)


def pfield_oneway(x: np.ndarray, z: np.ndarray, delays, p) -> np.ndarray:
    try:
        P = pymust.pfield(x, z, delays, p)
    except TypeError:
        P = pymust.pfield(x, np.zeros_like(x), z, delays, p)
    if isinstance(P, tuple):
        P = P[0]
    return np.abs(np.asarray(P)).reshape(x.shape)


def psf_point(p, focus_mm: float, z_mm: float, steer_deg: float) -> dict:
    th = np.deg2rad(steer_deg)
    xf, zf = focus_mm * 1e-3 * np.sin(th), focus_mm * 1e-3 * np.cos(th)
    delays = pymust.txdelay(np.array([xf]), np.array([zf]), p)
    xs, zs = z_mm * 1e-3 * np.sin(th), z_mm * 1e-3 * np.cos(th)
    rf, _t0 = pymust.simus(np.array([xs]), np.array([zs]), np.array([1.0]), delays, p)
    iq = pymust.rf2iq(rf, p)
    lam = p.c / p.fc
    half = max(8 * lam, 3e-3)
    u = np.linspace(-half, half, GRID_N)
    v = np.linspace(-half, half, GRID_N)
    uu, vv = np.meshgrid(u, v)
    xi = xs + uu * np.cos(th) + vv * np.sin(th)
    zi = zs - uu * np.sin(th) + vv * np.cos(th)
    m = pymust.dasmtx(iq, xi, zi, delays, p)
    bf = np.asarray(m @ iq.flatten(order='F')).reshape(xi.shape, order='F')
    env = np.abs(bf)
    i, j = np.unravel_index(env.argmax(), env.shape)
    lat = env[i, :]
    db = 20 * np.log10(lat / lat.max() + 1e-12)
    # nivel de lóbulos laterales: máximo fuera de ±2·FWHM
    fw = width_6db(lat, u)
    mask = np.abs(u) > 2 * fw * 1e-3
    sidelobe_db = float(db[mask].max()) if mask.any() else None
    # Campo de ida sobre una línea lateral más ancha (±15 mm) para no recortar
    # el haz desenfocado lejos del foco.
    u1 = np.linspace(-15e-3, 15e-3, 601)
    x1 = xs + u1 * np.cos(th) + (v[i]) * np.sin(th)
    z1 = zs - u1 * np.sin(th) + (v[i]) * np.cos(th)
    one_way = pfield_oneway(x1, z1, delays, p)
    tx_fw = width_6db(one_way, u1)
    return {
        'depthMm': z_mm,
        'steerDeg': steer_deg,
        'lateralFwhmMm': round(fw, 3),
        'axialFwhmMm': round(width_6db(env[:, j], v), 3),
        'txOneWayFwhmMm': None if tx_fw >= 29.9 else round(tx_fw, 3),
        'sidelobeDb': None if sidelobe_db is None else round(sidelobe_db, 1),
        'peakOffsetMm': [round(float(u[j] * 1e3), 3), round(float(v[i] * 1e3), 3)],
    }


def main(out_path: str) -> None:
    results = []
    for preset in PRESETS:
        p = make_param(preset['frequencyMhz'] * 1e6, preset['apertureMm'])
        rows = [
            psf_point(p, preset['focusMm'], z, s)
            for s in preset['steerDeg']
            for z in preset['depthsMm']
        ]
        results.append({**preset, 'elements': N_ELEMENTS, 'pitchMm': round(p.pitch * 1e3, 4), 'points': rows})
        print(preset['id'], [(r['depthMm'], r['steerDeg'], r['lateralFwhmMm'], r['txOneWayFwhmMm']) for r in rows], file=sys.stderr)
    doc = {
        'schemaVersion': 1,
        'engine': {
            'name': 'PyMUST',
            'version': version('pymust'),
            'license': 'LGPL-3.0',
            'url': 'https://github.com/creatis-ULTIM/PyMUST',
            'reference': 'Garcia D. SIMUS: an open-source simulator for medical ultrasound imaging. Part I: theory & examples. Comput Methods Programs Biomed 2022;218:106726.',
            'numpy': np.__version__,
            'python': platform.python_version(),
        },
        'method': {
            'scatterer': 'puntual, RC = 1, 2-D (sin foco en elevación)',
            'tx': 'foco fijo en focusMm (txdelay), 64 elementos, sin apodización',
            'rx': 'delay-and-sum (dasmtx) con apertura completa, fnumber = 0',
            'bandwidthPct': BANDWIDTH_PCT,
            'soundSpeedMs': C_MS,
            'metric': 'anchura total a −6 dB de la envolvente (ida y vuelta) y del campo de presión de ida (pfield)',
            'gridStepMm': 'PSF: ventana ±max(8λ, 3 mm) con 241 muestras por eje; pfield: línea lateral ±15 mm con 601 muestras',
        },
        'presets': results,
    }
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
        fh.write('\n')


if __name__ == '__main__':
    main(sys.argv[1])
