import { test, expect } from '@playwright/test';

async function webglAvailable(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    return Boolean(gl && gl.getExtension('EXT_color_buffer_float'));
  });
}

async function pixels(page: import('@playwright/test').Page): Promise<Uint8ClampedArray> {
  return page.locator('#bmode').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  });
}

for (const station of ['ojo', 'temporal']) {
  test(`paridad CPU/WebGL2 ${station}`, async ({ browser, baseURL }) => {
    const cpu = await browser.newPage();
    await cpu.goto(`${baseURL}/?renderer=cpu`);
    if (!(await webglAvailable(cpu))) {
      test.skip(true, 'WebGL2 + EXT_color_buffer_float no disponible en Chromium headless');
      return;
    }
    await cpu.waitForTimeout(1200);
    if (station === 'temporal') await cpu.locator('[data-station="temporal"][data-side="der"]').click();
    await cpu.waitForTimeout(1200);
    await cpu.locator('#freeze').click();
    const cpuPixels = await pixels(cpu);

    const gpu = await browser.newPage();
    await gpu.goto(`${baseURL}/?renderer=gpu`);
    if (station === 'temporal') await gpu.locator('[data-station="temporal"][data-side="der"]').click();
    await gpu.waitForTimeout(1200);
    await gpu.locator('#freeze').click();
    const gpuPixels = await pixels(gpu);
    expect(gpuPixels.length).toBe(cpuPixels.length);
    const diffs = [];
    for (let i = 0; i < cpuPixels.length; i += 4) {
      if (
        cpuPixels[i] !== cpuPixels[i + 1] ||
        cpuPixels[i + 1] !== cpuPixels[i + 2] ||
        gpuPixels[i] !== gpuPixels[i + 1] ||
        gpuPixels[i + 1] !== gpuPixels[i + 2]
      ) {
        continue;
      }
      diffs.push(Math.abs(gpuPixels[i]! - cpuPixels[i]!));
    }
    diffs.sort((a, b) => a - b);
    const mean = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
    const p99 = diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * 0.99))]!;
    const over8 = diffs.filter((value) => value > 8).length / diffs.length;
    expect(mean).toBeLessThanOrEqual(1);
    expect(p99).toBeLessThanOrEqual(4);
    expect(over8).toBeLessThanOrEqual(0.005);
    await cpu.close();
    await gpu.close();
  });
}
