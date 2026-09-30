import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function nonEmptyBModePixels(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#bmode') as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonEmpty = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] || pixels[i + 1] || pixels[i + 2]) nonEmpty++;
    }
    return nonEmpty;
  });
}

test('ergonomía de sonda: el debriefing reporta camino angular/lateral', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/?clock=fixed&t=0.4');
  await expect.poll(() => nonEmptyBModePixels(page), { timeout: 15_000 }).toBeGreaterThan(100_000);

  // Mueve la sonda por teclado: 6 mm laterales + 4° de tiltV.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');

  await page.locator('#teaching').click();
  await page.locator('#debrief').click();
  await expect(page.locator('#debriefPanel')).toHaveAttribute('open', '');
  // La fila de ergonomía resume camino angular (°), lateral (mm) y movimiento (s).
  await expect(page.locator('#debriefReport')).toContainText(/Sonda: \d+° girados · \d+ mm deslizados/);
  expect(pageErrors).toEqual([]);
});

test('el export de sesión incluye la trayectoria acumulada', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/?clock=fixed&t=0.4');
  await expect.poll(() => nonEmptyBModePixels(page), { timeout: 15_000 }).toBeGreaterThan(100_000);

  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  // Deja pasar un par de muestreos del bucle de paneles (~4 Hz).
  await page.waitForTimeout(600);

  const downloads: import('@playwright/test').Download[] = [];
  page.on('download', (download) => downloads.push(download));
  await page.locator('#export').click();
  await expect.poll(() => downloads.length, { timeout: 5_000 }).toBe(2);
  const jsonDownload = downloads.find((download) => download.suggestedFilename().endsWith('.json'));
  const payload = JSON.parse(await readFile(await jsonDownload!.path()!, 'utf8')) as {
    probe: { trayectoria?: { angularDeg: number; lateralMm: number; movingS: number } };
  };
  expect(payload.probe.trayectoria).toBeDefined();
  expect(payload.probe.trayectoria!.lateralMm).toBeGreaterThanOrEqual(5);
  expect(pageErrors).toEqual([]);
});
