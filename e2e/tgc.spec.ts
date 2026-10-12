import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('TGC CPU/WebGL2: perfil físico no uniforme de tres bandas', async ({ page }) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      import { GlBmodePipeline } from './src/render/gl/glPipeline';
      import { applyPsfAndCompression } from './src/ultrasound/postIq';
      import { probeBeamSpec } from './src/ultrasound/beam';
      import { buildScan } from './src/ultrasound/probe';
      import { defaultEyeSettings } from './src/domain/settings';
      import { scanConvert } from './src/ui/scanConvert';
      const scan=buildScan({origin:[0,0,0],forward:[0,0,1],lateral:[1,0,0],markerAngleRad:0,contactPressure:0},'linear',5);
      const settings={...defaultEyeSettings(),depthMm:10,gainDb:0,tgcDb:[-15,12,-3]};
      const iq=new Float32Array(50).fill(.015), beam=probeBeamSpec('linear',settings);
      const db=applyPsfAndCompression(iq,5,5,2,scan,settings,beam).db;
      const gpu=document.createElement('canvas');gpu.width=400;gpu.height=400;
      const pipeline=GlBmodePipeline.create(gpu);if(!pipeline)throw Error('WebGL2 requerido');
      pipeline.render(iq,5,5,{dz:2,scan,settings,beam});
      const expected=scanConvert({width:5,height:5,db,iq,dzMm:2,depthMm:10,scan},{dynamicRangeDb:60},400,400);
      const copy=document.createElement('canvas');copy.width=400;copy.height=400;
      copy.getContext('2d').drawImage(gpu,0,0);
      const actual=copy.getContext('2d').getImageData(0,0,400,400).data;
      const diffs=[];for(let i=0;i<actual.length;i+=4)diffs.push(Math.abs(actual[i]-expected[i]));
      diffs.sort((a,b)=>a-b);
      document.body.textContent=JSON.stringify({mean:diffs.reduce((a,b)=>a+b,0)/diffs.length,p99:diffs[Math.floor(diffs.length*.99)],over8:diffs.filter(x=>x>8).length/diffs.length});
      pipeline.dispose();
    `,
    },
    loader: { '.glsl': 'text' },
    bundle: true,
    write: false,
    format: 'iife',
  });
  await page.setContent('<body></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const result = JSON.parse(await page.locator('body').innerText()) as {
    mean: number;
    p99: number;
    over8: number;
  };
  expect(result.mean).toBeLessThanOrEqual(1);
  expect(result.p99).toBeLessThanOrEqual(4);
  expect(result.over8).toBeLessThanOrEqual(0.005);
});
