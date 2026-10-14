#!/usr/bin/env python3
"""
Extrae métricas de centerline, radio y topología de las máscaras multiclase
del polígono de Willis publicadas por TopCoW (Zenodo 10.5281/zenodo.15692630).

Uso:
  python3 scripts/atlas/topcow_extract.py <dir_subconjunto> <salida.json> \
      --zip <archivo.zip> --subset <nombre>

Pipeline offline (no forma parte de `npm run check`): requiere numpy, scipy,
nibabel y scikit-image. El resultado es un JSON liviano con métricas por caso
y segmento; nunca copia los volúmenes NIfTI al repositorio.

Marco de salida (DEC-77): TopCoW almacena los vóxeles en orden LPS+, pero la
matriz afín NIfTI devuelve, por definición del formato, coordenadas físicas
RAS (+x derecha, +y anterior, +z superior). El simulador usa +x izquierda,
+y superior, +z anterior, así que
  sim = [-R, S, A]
Se comprueba con hitos (ACI derecha en x<0, ACA hacia anterior, basilar
ascendente) que el resultado es anatómicamente coherente, y el origen de cada caso se traslada al punto medio entre los dos terminales
de la ACI (extremo de cada etiqueta ICA más próximo a la ACM homolateral).
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import sys

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from skimage.morphology import skeletonize

LABELS = {
    1: 'BA', 2: 'R-PCA', 3: 'L-PCA', 4: 'R-ICA', 5: 'R-MCA', 6: 'L-ICA',
    7: 'L-MCA', 8: 'R-Pcom', 9: 'L-Pcom', 10: 'Acom', 11: 'R-ACA',
    12: 'L-ACA', 13: 'R-A2', 14: 'L-A2', 15: '3rd-A2',
}
# Etiqueta que define el extremo proximal de cada segmento (None: el extremo
# más inferior, es decir, menor S).
PROXIMAL_REF = {
    'BA': None, 'R-ICA': None, 'L-ICA': None,
    'R-PCA': 'BA', 'L-PCA': 'BA',
    'R-MCA': 'R-ICA', 'L-MCA': 'L-ICA',
    'R-ACA': 'R-ICA', 'L-ACA': 'L-ICA',
    'R-Pcom': 'R-ICA', 'L-Pcom': 'L-ICA',
    'Acom': 'R-ACA', '3rd-A2': 'Acom', 'R-A2': 'R-ACA', 'L-A2': 'L-ACA',
}

OFFSETS = np.array(
    [[i, j, k] for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if (i, j, k) != (0, 0, 0)]
)


def ras_to_sim(p_ras: np.ndarray) -> np.ndarray:
    """[R, A, S] (afín NIfTI) → [-R, S, A] (simulador)."""
    p = np.asarray(p_ras, float)
    return np.stack([-p[..., 0], p[..., 2], p[..., 1]], axis=-1)


def voxel_to_phys(affine: np.ndarray, ijk: np.ndarray) -> np.ndarray:
    h = np.concatenate([ijk, np.ones((len(ijk), 1))], axis=1)
    return (affine @ h.T).T[:, :3]


def skeleton_graph(sk: np.ndarray, spacing: np.ndarray):
    """Grafo 26-conexo del esqueleto con pesos en mm."""
    idx = np.argwhere(sk)
    if len(idx) == 0:
        return idx, None
    lut = -np.ones(sk.shape, dtype=np.int64)
    lut[tuple(idx.T)] = np.arange(len(idx))
    rows, cols, w = [], [], []
    for off in OFFSETS:
        nb = idx + off
        ok = np.all((nb >= 0) & (nb < np.array(sk.shape)), axis=1)
        j = lut[tuple(nb[ok].T)]
        valid = j >= 0
        i = np.arange(len(idx))[ok][valid]
        j = j[valid]
        rows.append(i)
        cols.append(j)
        w.append(np.full(len(i), float(np.linalg.norm(off * spacing))))
    rows = np.concatenate(rows)
    cols = np.concatenate(cols)
    w = np.concatenate(w)
    g = coo_matrix((w, (rows, cols)), shape=(len(idx), len(idx))).tocsr()
    return idx, g


def longest_path(idx: np.ndarray, g) -> tuple[np.ndarray, float, int]:
    """Camino más largo (diámetro aproximado) del componente mayor."""
    ncomp, lab = connected_components(g, directed=False)
    main = np.bincount(lab).argmax()
    sel = np.where(lab == main)[0]
    sub = g[sel][:, sel]
    d0 = dijkstra(sub, directed=False, indices=0)
    a = int(np.argmax(np.where(np.isfinite(d0), d0, -1)))
    da, pred = dijkstra(sub, directed=False, indices=a, return_predecessors=True)
    b = int(np.argmax(np.where(np.isfinite(da), da, -1)))
    path = [b]
    while path[-1] != a:
        path.append(int(pred[path[-1]]))
    path = sel[np.array(path[::-1])]
    return idx[path], float(da[b]), int(ncomp)


def nearest_distance(points_phys: np.ndarray, ref_phys: np.ndarray) -> np.ndarray:
    """Distancia de cada punto al punto más cercano de `ref_phys`."""
    out = np.empty(len(points_phys))
    step = 2048
    for s in range(0, len(points_phys), step):
        blk = points_phys[s : s + step]
        d = np.linalg.norm(blk[:, None, :] - ref_phys[None, :, :], axis=2)
        out[s : s + step] = d.min(axis=1)
    return out


def extract_case(mask_path: str, edges_path: str | None):
    img = nib.load(mask_path)
    affine = img.affine
    data = np.asarray(img.dataobj).astype(np.int16)
    spacing = np.array(img.header.get_zooms()[:3], float)
    axcodes = ''.join(nib.aff2axcodes(affine))
    if axcodes != 'LPS':
        raise SystemExit(f'{mask_path}: orientación {axcodes}, se esperaba LPS')
    edt = ndi.distance_transform_edt(data > 0, sampling=spacing)
    present = sorted(int(v) for v in np.unique(data) if v != 0)
    seg = {}
    label_phys = {}
    for lab in present:
        name = LABELS.get(lab, f'label{lab}')
        m = data == lab
        vox = np.argwhere(m)
        label_phys[name] = voxel_to_phys(affine, vox[:: max(1, len(vox) // 4000)])
    for lab in present:
        name = LABELS.get(lab, f'label{lab}')
        m = data == lab
        sk = skeletonize(m)
        idx, g = skeleton_graph(sk, spacing)
        if g is None or len(idx) < 2:
            # Segmento diminuto (p. ej. Acom de 1–2 vóxeles): sin camino; se
            # conserva como presente con longitud ≈ un vóxel.
            idx = np.argwhere(m)
            path_ijk, length, ncomp = idx[[0, -1]], float(spacing.mean()), 1
        else:
            path_ijk, length, ncomp = longest_path(idx, g)
        path_phys = voxel_to_phys(affine, path_ijk)
        radii = edt[tuple(path_ijk.T)]
        ref = PROXIMAL_REF.get(name)
        if ref is not None and ref in label_phys:
            d_ref = nearest_distance(path_phys[[0, -1]], label_phys[ref])
            if d_ref[1] < d_ref[0]:
                path_phys = path_phys[::-1]
                radii = radii[::-1]
        elif path_phys[-1, 2] < path_phys[0, 2]:  # proximal = más inferior (menor S)
            path_phys = path_phys[::-1]
            radii = radii[::-1]
        seg[name] = {
            'voxels': int(m.sum()),
            'volumeMm3': float(m.sum() * spacing.prod()),
            'skeletonVoxels': int(len(idx)),
            'skeletonComponents': ncomp,
            'lengthMm': round(length, 2),
            'radiusMedianMm': round(float(np.median(radii)), 3),
            'radiusP10Mm': round(float(np.percentile(radii, 10)), 3),
            'radiusP90Mm': round(float(np.percentile(radii, 90)), 3),
            'volumeEquivalentRadiusMm': round(float(np.sqrt(m.sum() * spacing.prod() / max(length, 1e-6) / np.pi)), 3),
            '_startRas': path_phys[0],
            '_endRas': path_phys[-1],
            '_pathRas': path_phys,
        }
    # Origen: punto medio entre terminales de ACI (extremo distal de cada ICA).
    termini = [seg[k]['_endRas'] for k in ('R-ICA', 'L-ICA') if k in seg]
    if len(termini) == 2:
        origin = (termini[0] + termini[1]) / 2
        inter_ica = float(np.linalg.norm(termini[0] - termini[1]))
    else:
        origin = np.zeros(3)
        inter_ica = None
    out_seg = {}
    for name, s in seg.items():
        start = ras_to_sim(s.pop('_startRas') - origin)
        end = ras_to_sim(s.pop('_endRas') - origin)
        path = ras_to_sim(s.pop('_pathRas') - origin)
        n = len(path)
        keep = np.unique(np.round(np.linspace(0, n - 1, min(n, 9))).astype(int))
        s['startMm'] = [round(float(v), 2) for v in start]
        s['endMm'] = [round(float(v), 2) for v in end]
        s['polylineMm'] = [[round(float(v), 2) for v in path[i]] for i in keep]
        out_seg[name] = s
    warnings = check_landmarks(case_id_of(mask_path), out_seg)
    edges = None
    if edges_path and os.path.exists(edges_path):
        edges = {}
        for line in open(edges_path, encoding='utf-8'):
            m = re.match(r'\s+([\w-]+):\s+([01])', line)
            if m:
                edges[m.group(1)] = int(m.group(2))
    return {
        'id': case_id_of(mask_path),
        'shape': [int(v) for v in data.shape],
        'spacingMm': [round(float(v), 4) for v in spacing],
        'orientation': axcodes,
        'originRasMm': [round(float(v), 2) for v in origin],
        'interIcaTerminusMm': None if inter_ica is None else round(inter_ica, 2),
        'edges': edges,
        'labelsPresent': [LABELS.get(v, f'label{v}') for v in present],
        'landmarkWarnings': warnings,
        'segments': out_seg,
    }


def case_id_of(mask_path: str) -> str:
    return re.sub(r'_full_LPS_Mask\.nii\.gz$|\.nii\.gz$', '', os.path.basename(mask_path))


def check_landmarks(case_id: str, seg: dict) -> list[str]:
    """Hitos de lado y orientación: los de lateralidad/eje abortan; el resto
    (recorrido de ACM/PCA, que depende del recorte del ROI y de aneurismas)
    se devuelve como aviso por caso."""
    problems = []
    warnings = []
    if 'R-ICA' in seg and seg['R-ICA']['endMm'][0] >= 0:
        problems.append('R-ICA no está en x<0')
    if 'L-ICA' in seg and seg['L-ICA']['endMm'][0] <= 0:
        problems.append('L-ICA no está en x>0')
    for k in ('R-ACA', 'L-ACA'):
        if k in seg and seg[k]['endMm'][2] <= seg[k]['startMm'][2]:
            problems.append(f'{k} no avanza hacia anterior')
    for k in ('R-PCA', 'L-PCA'):
        if k in seg and seg[k]['endMm'][2] >= seg[k]['startMm'][2]:
            warnings.append(f'{k} no avanza hacia posterior')
    if 'BA' in seg and seg['BA']['endMm'][1] <= seg['BA']['startMm'][1]:
        problems.append('BA no asciende')
    for k in ('R-MCA', 'L-MCA'):
        if k in seg and abs(seg[k]['endMm'][0]) <= abs(seg[k]['startMm'][0]):
            warnings.append(f'{k} no se aleja de la línea media')
    if problems:
        raise SystemExit(f'{case_id}: hitos incoherentes: ' + '; '.join(problems))
    return warnings


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for blk in iter(lambda: f.read(1 << 20), b''):
            h.update(blk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('subset_dir')
    ap.add_argument('output')
    ap.add_argument('--zip', default=None)
    ap.add_argument('--subset', default=None)
    ap.add_argument('--modality', default='CTA')
    ap.add_argument('--population', default='')
    args = ap.parse_args()
    masks = sorted(glob.glob(os.path.join(args.subset_dir, 'cow_seg_labelsTr', '*.nii.gz')))
    if not masks:
        raise SystemExit('sin máscaras en cow_seg_labelsTr')
    cases = []
    for mp in masks:
        base = os.path.basename(mp).replace('.nii.gz', '')
        ep = os.path.join(args.subset_dir, 'antpos_edges_labelsTr', base + '.yml')
        cases.append(extract_case(mp, ep))
        print(f'{cases[-1]["id"]}: {len(cases[-1]["segments"])} segmentos', file=sys.stderr)
    doc = {
        'schemaVersion': 1,
        'source': {
            'dataset': 'TopCoW Training Data and External Testsets',
            'doi': '10.5281/zenodo.15692630',
            'url': 'https://zenodo.org/records/15692630',
            'subset': args.subset or os.path.basename(os.path.normpath(args.subset_dir)),
            'zip': os.path.basename(args.zip) if args.zip else None,
            'zipSha256': sha256(args.zip) if args.zip else None,
            'modality': args.modality,
            'population': args.population,
            'licence': 'TopCoW Data Usage License (uso abierto con cita; uso comercial requiere permiso)',
            'attribution': 'Yang K. et al., TopCoW challenge (Zenodo 10.5281/zenodo.15692630)',
        },
        'frame': {
            'input': 'afín NIfTI → RAS mm (vóxeles almacenados en orden LPS+)',
            'output': 'simulador: +x izquierda, +y superior, +z anterior; sim = [-R, S, A]',
            'landmarks': 'ACI derecha en x<0, ACA anterior, PCA posterior, BA ascendente, ACM lateral',
            'origin': 'punto medio entre los extremos distales de R-ICA y L-ICA',
        },
        'method': {
            'centerline': 'skimage.skeletonize 3D + camino más largo (Dijkstra) del componente mayor',
            'radius': 'EDT de la máscara completa (todas las etiquetas) muestreada sobre el camino',
            'proximal': PROXIMAL_REF,
        },
        'labels': LABELS,
        'cases': cases,
    }
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f'{len(cases)} casos → {args.output}', file=sys.stderr)


if __name__ == '__main__':
    main()
