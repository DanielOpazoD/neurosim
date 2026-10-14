import { describe, expect, it } from 'vitest';
import {
  IDENTITY_AFFINE,
  PATIENT_FRAME,
  applyAffine,
  buildVascularGraph,
  invertAffine,
  toSourceCoordinates,
  vesselProblems,
  type Affine4,
  type VascularGraphSource,
} from '../src/anatomy/vascularGraph';
import { buildWillisVessels } from '../src/anatomy/willis';
import { buildReferenceCase } from '../src/domain/referenceCase';
import type { WillisVariant } from '../src/domain/contracts';
import type { Vec3 } from '../src/core/vec3';

/** Topología matemática de prueba; no representa una bifurcación anatómica medida. */
function bifurcation(): VascularGraphSource {
  return {
    schemaVersion: 1,
    units: 'mm',
    sourceFrame: 'fixture-local',
    patientFrame: PATIENT_FRAME,
    affine: IDENTITY_AFFINE,
    provenance: {
      id: 'fixture-bifurcacion',
      revision: '1',
      license: 'MIT',
      kind: 'synthetic',
      derivation: 'Coordenadas arbitrarias para probar el contrato; sin pacientes ni atlas.',
      validation: { status: 'unvalidated', note: 'Solo verificación de software, no validación anatómica.' },
    },
    nodes: [
      { id: 'entrada', position: [-8, 0, 0] },
      { id: 'union', position: [-8, 10, 0] },
      { id: 'rama-a', position: [-14, 20, 0] },
      { id: 'rama-b', position: [-2, 20, 0] },
    ],
    segments: [
      { id: 'tronco', label: 'Entrada', side: 'der', from: 'entrada', to: 'union', radiusMm: 2 },
      {
        id: 'a',
        label: 'Rama A',
        side: 'der',
        from: 'union',
        to: 'rama-a',
        via: [[-12, 15, 0]],
        radiusMm: [1.5, 1.4, 1.3],
      },
      { id: 'b', label: 'Rama B', side: 'der', from: 'union', to: 'rama-b', radiusMm: 1 },
    ],
  };
}

function anastomosis(): VascularGraphSource {
  const b = bifurcation();
  return {
    ...b,
    provenance: { ...b.provenance, id: 'fixture-anastomosis' },
    segments: [
      ...b.segments,
      {
        id: 'puente',
        label: 'Conexión sintética',
        side: 'der',
        from: 'rama-a',
        to: 'rama-b',
        via: [[-8, 25, 0]],
        radiusMm: 0.7,
      },
    ],
  };
}

describe('contrato del grafo vascular (DEC-74)', () => {
  it('conserva identidad, radios por punto, etiquetas, lateralidad y procedencia', () => {
    const src = bifurcation();
    const g = buildVascularGraph(JSON.parse(JSON.stringify(src)));
    expect(g.schemaVersion).toBe(1);
    expect(g.patientFrame).toBe(PATIENT_FRAME);
    expect(g.sourceFrame).toBe(src.sourceFrame);
    expect(g.sourceUnits).toBe('mm');
    expect(g.provenance).toEqual(src.provenance);
    expect(g.segments[0]!.radiiMm).toEqual([2, 2]);
    expect(g.segments[0]!.lengthMm).toBe(10);
    expect(g.segments[1]).toMatchObject({ label: 'Rama A', side: 'der', radiiMm: [1.5, 1.4, 1.3] });
    expect(g.segments[1]!.points).toEqual([
      [-8, 10, 0],
      [-12, 15, 0],
      [-14, 20, 0],
    ]);
    expect(g.segments[1]!.lengthMm).toBeCloseTo(Math.hypot(4, 5) + Math.hypot(2, 5), 10);
  });

  it('describe bifurcación, ciclo de anastomosis y componentes desconectados', () => {
    const b = buildVascularGraph(bifurcation());
    expect(b.degree.get('union')).toBe(3);
    expect([b.components, b.cycles]).toEqual([1, 0]);
    const a = buildVascularGraph(anastomosis());
    expect([a.components, a.cycles]).toEqual([1, 1]);
    expect(a.degree.get('rama-a')).toBe(2);
    const src = anastomosis();
    const disconnected = buildVascularGraph({
      ...src,
      nodes: [...src.nodes, { id: 'aislado', position: [0, 0, 0] }],
    });
    expect([disconnected.components, disconnected.cycles, disconnected.degree.get('aislado')]).toEqual([
      2, 1, 0,
    ]);
  });

  it.each(['mm', 'cm', 'voxel'] as const)(
    'normaliza %s con escala, giro, reflexión, cizalla y traslación reversibles',
    (units) => {
      const src: VascularGraphSource = {
        ...bifurcation(),
        units,
        affine: [
          [0, -2, 0.2, -5],
          [3, 0.1, 0, 2],
          [0, 0, -4, 7],
          [0, 0, 0, 1],
        ],
      };
      const g = buildVascularGraph(src);
      for (const n of src.nodes) {
        const p = g.nodes.get(n.id)!;
        const factor = units === 'cm' ? 10 : 1;
        expect(p).toEqual(applyAffine(src.affine, n.position.map((v) => v * factor) as Vec3));
        const back = toSourceCoordinates(g, p);
        back.forEach((v, i) => expect(v).toBeCloseTo(n.position[i]!, 9));
      }
      const via = toSourceCoordinates(g, g.segments[1]!.points[1]!);
      via.forEach((v, i) => expect(v).toBeCloseTo(src.segments[1]!.via![0]![i]!, 9));
      // Los radios ya son mm del paciente; no se deforman por una afín anisótropa.
      expect(g.segments[1]!.radiiMm).toEqual([1.5, 1.4, 1.3]);
    },
  );

  it('no reescribe la fuente ni deduce el lado por x', () => {
    const src = structuredClone(bifurcation());
    const g = buildVascularGraph({ ...src, segments: [{ ...src.segments[0]!, side: 'media' }] });
    expect(g.segments[0]!.side).toBe('media');
    src.nodes[0]!.position[0] = 100;
    expect(g.nodes.get('entrada')).toEqual([-8, 0, 0]);
    expect(g.provenance).not.toBe(src.provenance);
    expect(g.affine).not.toBe(src.affine);
  });

  const badSegments: Array<[string, Record<string, unknown>]> = [
    ['radio cero', { radiusMm: 0 }],
    ['radio negativo', { radiusMm: -1 }],
    ['radio infinito', { radiusMm: Infinity }],
    ['radio NaN', { radiusMm: NaN }],
    ['radio ausente', { radiusMm: undefined }],
    ['radios vacíos', { radiusMm: [] }],
    ['un radio en arreglo no es escalar', { radiusMm: [1] }],
    ['radios desparejados', { radiusMm: [1, 1, 1] }],
    ['radio por punto inválido', { radiusMm: [1, 0] }],
    ['referencia rota', { to: 'fantasma' }],
    ['autobucle', { to: 'entrada' }],
    ['etiqueta ausente', { label: undefined }],
    ['etiqueta no textual', { label: 3 }],
    ['lado ausente', { side: undefined }],
    ['lado incoherente', { side: 'izq' }],
    ['lado desconocido', { side: 'left' }],
    ['punto intermedio no finito', { via: [[-8, NaN, 0]] }],
    ['punto intermedio repetido', { via: [[-8, 0, 0]] }],
    ['punto intermedio mal formado', { via: [[-8, 4]] }],
    ['polilínea mal formada', { via: {} }],
    ['polilínea nula', { via: null }],
  ];
  it.each(badSegments)('rechaza %s', (_label, patch) => {
    const src = bifurcation();
    expect(() => buildVascularGraph({ ...src, segments: [{ ...src.segments[0], ...patch }] })).toThrow(
      /no utilizable/,
    );
  });

  const malformed: Array<[string, unknown]> = [
    ['null', null],
    ['objeto vacío', {}],
    ['array', []],
    ['versión desconocida', { ...bifurcation(), schemaVersion: 2 }],
    ['unidades desconocidas', { ...bifurcation(), units: 'in' }],
    ['unidades heredadas', { ...bifurcation(), units: 'toString' }],
    ['marco de origen ausente', { ...bifurcation(), sourceFrame: '' }],
    ['marco del paciente desconocido', { ...bifurcation(), patientFrame: 'RAS' }],
    ['procedencia ausente', { ...bifurcation(), provenance: null }],
    ['afín ausente', { ...bifurcation(), affine: undefined }],
    ['nodos ausentes', { ...bifurcation(), nodes: undefined }],
    ['nodos vacíos', { ...bifurcation(), nodes: [] }],
    ['nodo nulo', { ...bifurcation(), nodes: [null] }],
    ['segmentos ausentes', { ...bifurcation(), segments: undefined }],
    ['segmentos vacíos', { ...bifurcation(), segments: [] }],
    ['segmento nulo', { ...bifurcation(), segments: [null] }],
  ];
  it.each(malformed)('rechaza entrada mal formada: %s', (_label, input) => {
    expect(() => buildVascularGraph(input)).toThrow(/Grafo vascular no utilizable/);
  });

  it.each(['id', 'revision', 'license', 'derivation', 'kind', 'validation'])(
    'exige procedencia.%s',
    (key) => {
      const src = bifurcation();
      expect(() =>
        buildVascularGraph({ ...src, provenance: { ...src.provenance, [key]: undefined } }),
      ).toThrow(/no utilizable/);
    },
  );

  it.each([
    { validation: { status: 'clinically-validated', note: 'No comprobado' } },
    { validation: { status: 'unvalidated', note: '' } },
    { sha256: 'abc' },
    { url: 'file://local' },
  ])('rechaza metadatos mal formados %j', (patch) => {
    const src = bifurcation();
    expect(() => buildVascularGraph({ ...src, provenance: { ...src.provenance, ...patch } })).toThrow(
      /no utilizable/,
    );
  });

  it.each([
    ['nodos duplicados', (s: VascularGraphSource) => ({ ...s, nodes: [...s.nodes, s.nodes[0]] })],
    [
      'segmentos duplicados',
      (s: VascularGraphSource) => ({ ...s, segments: [...s.segments, s.segments[0]] }),
    ],
    [
      'puntos coincidentes',
      (s: VascularGraphSource) => ({ ...s, nodes: s.nodes.map((n) => ({ ...n, position: [-8, 0, 0] })) }),
    ],
    [
      'coordenada no finita',
      (s: VascularGraphSource) => ({ ...s, nodes: s.nodes.map((n) => ({ ...n, position: [NaN, 0, 0] })) }),
    ],
    [
      'desbordamiento al convertir',
      (s: VascularGraphSource) => ({
        ...s,
        units: 'cm',
        nodes: s.nodes.map((n) => ({ ...n, position: [-Number.MAX_VALUE, 0, 0] })),
      }),
    ],
    [
      'desbordamiento de longitud',
      (s: VascularGraphSource) => ({
        ...s,
        nodes: [
          { id: 'x', position: [0, -Number.MAX_VALUE, 0] },
          { id: 'y', position: [0, Number.MAX_VALUE, 0] },
        ],
        segments: [{ ...s.segments[0], from: 'x', to: 'y', side: 'media' }],
      }),
    ],
  ])('rechaza %s', (_label, mutate) => {
    expect(() => buildVascularGraph(mutate(bifurcation()))).toThrow(/no utilizable/);
  });

  it('detecta un espejo que contradice la lateralidad declarada', () => {
    expect(() =>
      buildVascularGraph({
        ...bifurcation(),
        affine: [
          [-1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ],
      }),
    ).toThrow(/lateralidad/);
  });

  it.each(
    [
      null,
      [],
      [
        [1, 0, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1],
        [0, 0, 0, 1],
      ],
      [
        [1, 0, 0, 0],
        [1, 0, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0.1, 1],
      ],
      [
        [NaN, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      [
        [1e-15, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      [
        [1e-10, 0, 0, Number.MAX_VALUE],
        [0, 1e-10, 0, 0],
        [0, 0, 1e-10, 0],
        [0, 0, 0, 1],
      ],
    ].map((affine) => ({ affine })),
  )('no invierte una afín inutilizable %#', ({ affine }) => {
    expect(invertAffine(affine)).toBeNull();
    expect(() => buildVascularGraph({ ...bifurcation(), affine })).toThrow(/afín/);
  });

  it('invierte identidad y escala pequeña sin confundirla con singularidad', () => {
    expect(
      invertAffine(IDENTITY_AFFINE)!
        .flat()
        .map((v) => v + 0),
    ).toEqual(IDENTITY_AFFINE.flat());
    const m: Affine4 = [
      [1e-9, 0, 0, 1],
      [0, 1e-9, 0, -1],
      [0, 0, 1e-9, 0],
      [0, 0, 0, 1],
    ];
    const p: Vec3 = [1, 2, 3];
    applyAffine(invertAffine(m)!, applyAffine(m, p)).forEach((v, i) => expect(v).toBeCloseTo(p[i]!, 5));
  });

  it('los tubos actuales cumplen las invariantes geométricas sin inventar conexiones', () => {
    const variants: WillisVariant[] = [
      'normal',
      'aplasiaA1Der',
      'aplasiaA1Izq',
      'pcaFetalDer',
      'pcaFetalIzq',
    ];
    for (const variant of variants) expect(vesselProblems(buildWillisVessels(variant))).toEqual([]);
    const sim = buildReferenceCase();
    for (const scene of [sim.head, sim.eyes.der, sim.eyes.izq, sim.neck.der, sim.neck.izq])
      expect(vesselProblems(scene.vessels)).toEqual([]);
  });

  it('el chequeo legado detecta degeneración, radio, lateralidad, IDs y AABB inválidos', () => {
    const v = buildWillisVessels('normal')[0]!;
    expect(vesselProblems([v, v])).toContainEqual(expect.stringMatching(/duplicado/));
    expect(vesselProblems([{ ...v, radiusMm: -1 }])).toContainEqual(expect.stringMatching(/radio/));
    expect(vesselProblems([{ ...v, points: [v.points[0]!, v.points[0]!] }])).toContainEqual(
      expect.stringMatching(/línea central/),
    );
    expect(vesselProblems([{ ...v, aabb: { min: [NaN, 0, 0], max: [0, 0, 0] } }])).toContainEqual(
      expect.stringMatching(/caja/),
    );
    expect(vesselProblems([{ ...v, side: v.side === 'der' ? 'izq' : 'der' }])).toContainEqual(
      expect.stringMatching(/lateralidad/),
    );
  });
});
