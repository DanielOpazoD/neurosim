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

async function placeM1Gate(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('#bmode') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: rect.left + rect.width * 0.584,
        clientY: rect.top + rect.height * 0.781,
      }),
    );
  });
}

function readoutValue(text: string, label: string): number {
  const match = text.match(new RegExp(`${label}\\s*\\n(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : Number.NaN;
}

test('flujo docente completo sin errores', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  const headView = page.locator('#headView');
  await expect(headView).toBeVisible();
  const hvBox = await headView.boundingBox();
  expect(hvBox && hvBox.width > 40 && hvBox.height > 40).toBe(true);
  await expect.poll(() => nonEmptyBModePixels(page), { timeout: 15_000 }).toBeGreaterThan(100_000);
  await expect(page.locator('#errores')).toBeHidden();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.locator('#onsdProtocol').click();
  await expect(page.locator('#hint')).toContainText('der · transversal');
  await expect(page.locator('#onsdProtocol')).toHaveClass(/on/);
  await page.locator('#teaching').click();
  await page.locator('#debrief').click();
  await expect(page.locator('#debriefPanel')).toHaveAttribute('open', '');
  await expect(page.locator('#debriefReport')).toContainText('station');

  await page.locator('[data-station="temporal"][data-side="der"]').click();
  await expect.poll(() => nonEmptyBModePixels(page), { timeout: 15_000 }).toBeGreaterThan(100_000);
  await page.locator('#pw').click();
  await placeM1Gate(page);
  await expect
    .poll(async () => readoutValue(await page.locator('#readouts').innerText(), 'PSV'), { timeout: 15_000 })
    .toBeGreaterThan(0);

  await page.keyboard.press('Space');
  await expect(page.locator('#freeze')).toHaveText('Reanudar');

  const downloads: import('@playwright/test').Download[] = [];
  page.on('download', (download) => downloads.push(download));
  await page.locator('#export').click();
  await expect.poll(() => downloads.length, { timeout: 5_000 }).toBe(2);
  const jsonDownload = downloads.find((download) => download.suggestedFilename().endsWith('.json'));
  expect(jsonDownload).toBeDefined();
  const jsonPath = await jsonDownload!.path();
  expect(jsonPath).not.toBeNull();
  const payload = JSON.parse(await readFile(jsonPath!, 'utf8')) as {
    frame: unknown;
    measurements: unknown[];
    settings: { lineDensity: string };
    errores: unknown[];
  };
  expect(payload.frame).not.toBeNull();
  expect(payload.measurements).toEqual(expect.any(Array));
  expect(payload.settings.lineDensity).toBe('media');
  expect(payload.errores).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
