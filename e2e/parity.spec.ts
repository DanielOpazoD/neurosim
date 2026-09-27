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

async function waitForPaint(
  page: import('@playwright/test').Page,
  reference?: Uint8ClampedArray,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const data = await pixels(page);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += data[i]!;
        if (!reference) return sum;
        let changed = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] !== reference[i]) changed++;
        }
        return sum > 0 && changed;
      },
      { timeout: 5000, intervals: [100, 250, 500] },
    )
    .toBeGreaterThan(0);
}

for (const station of ['ojo', 'temporal']) {
  test(`paridad CPU/WebGL2 ${station}`, async ({ browser, baseURL }) => {
    const cpu = await browser.newPage();
    await cpu.goto(`${baseURL}/?renderer=cpu`);
    await expect(cpu.locator('body')).toHaveAttribute('data-renderer', 'cpu');
    if (!(await webglAvailable(cpu))) {
      test.skip(true, 'WebGL2 + EXT_color_buffer_float no disponible en Chromium headless');
      return;
    }
    const cpuBefore = await pixels(cpu);
    if (station === 'temporal') await cpu.locator('[data-station="temporal"][data-side="der"]').click();
    await waitForPaint(cpu, station === 'temporal' ? cpuBefore : undefined);
    await cpu.locator('#freeze').click();
    await waitForPaint(cpu);
    const cpuPixels = await pixels(cpu);

    const gpu = await browser.newPage();
    await gpu.goto(`${baseURL}/?renderer=gpu`);
    await expect(gpu.locator('body')).toHaveAttribute('data-renderer', 'gpu');
    const gpuBefore = await pixels(gpu);
    if (station === 'temporal') await gpu.locator('[data-station="temporal"][data-side="der"]').click();
    await waitForPaint(gpu, station === 'temporal' ? gpuBefore : undefined);
    await gpu.locator('#freeze').click();
    await waitForPaint(gpu);
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
