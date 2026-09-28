import { describe, expect, it } from 'vitest';
import { buildReferenceCase, REFERENCE_SEED } from '../src/domain/referenceCase';
import { defaultEyeSettings, defaultTemporalSettings } from '../src/domain/settings';
import { RenderClient, type RenderWorkerLike } from '../src/app/renderClient';
import { eyeScene, headScene, renderRequest } from '../src/app/renderRequest';
import { eyePose, temporalPose } from './validation/helpers';
import { hashBMode } from './validation/hash';
import { buildScan } from '../src/ultrasound/probe';
import { renderBMode } from '../src/ultrasound/bmode';

function requestFor(
  station: 'ojo' | 'temporal',
  settings: ReturnType<typeof defaultEyeSettings> | ReturnType<typeof defaultTemporalSettings>,
) {
  return {
    id: 1,
    seed: REFERENCE_SEED,
    side: 'der' as const,
    station,
    settings,
    tiltDeg: 0,
    offsetMm: 0,
    rotDeg: 0,
    press: 0.3,
    t: 0,
    cardiacPhase: 0,
    respiratoryPhase: 0,
    flowModulation: 1,
    color: station === 'temporal',
  };
}

describe('renderRequest', () => {
  it.each([
    ['ojo', defaultEyeSettings()],
    ['temporal', defaultTemporalSettings()],
  ] as const)('conserva el hash B-mode del camino síncrono para %s', (station, settings) => {
    const sim = buildReferenceCase(REFERENCE_SEED);
    const request = requestFor(station, settings);
    const response = renderRequest(request, sim);
    const pose = station === 'ojo' ? eyePose(sim, 'der') : temporalPose(sim, 'der');
    const scan = buildScan(pose, settings.transducer, 176);
    const scene =
      station === 'ojo'
        ? eyeScene(sim.eyes.der, `seed-${sim.patient.seed}-der`, {
            press: request.press,
            cardiacPhase: request.cardiacPhase,
          })
        : headScene(sim.head, `seed-${sim.patient.seed}-der`, {
            cardiacPhase: request.cardiacPhase,
            respiratoryPhase: request.respiratoryPhase,
          });
    const expected = renderBMode(scene, scan, settings, `seed-${sim.patient.seed}-der`);
    expect(hashBMode(response.bmode)).toBe(hashBMode(expected));
  });
});

describe('RenderClient', () => {
  it('conserva solo la solicitud más reciente mientras hay una en vuelo', async () => {
    const posted: number[] = [];
    const worker: RenderWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: (request) => posted.push(request.id),
    };
    const client = new RenderClient(worker);
    const first = client.request(requestFor('ojo', defaultEyeSettings()));
    const secondRequest = { ...requestFor('ojo', defaultEyeSettings()), id: 2 };
    const second = client.request(secondRequest);
    expect(posted).toEqual([1]);
    await expect(first).rejects.toThrow('reemplazado');
    const firstResponse = renderRequest(
      requestFor('ojo', defaultEyeSettings()),
      buildReferenceCase(REFERENCE_SEED),
    );
    worker.onmessage?.({ data: firstResponse } as MessageEvent<typeof firstResponse>);
    const response = renderRequest(secondRequest, buildReferenceCase(REFERENCE_SEED));
    worker.onmessage?.({ data: response } as MessageEvent<typeof response>);
    expect(await second).toMatchObject({ id: 2 });
    expect(posted).toEqual([1, 2]);
  });
});
