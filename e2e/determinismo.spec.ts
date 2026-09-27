import { expect, test } from '@playwright/test';

async function freezeAndHash(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const canvas = document.querySelector('#bmode') as HTMLCanvasElement;
          const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
          let nonEmpty = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] || pixels[i + 1] || pixels[i + 2]) nonEmpty++;
          }
          return nonEmpty;
        }),
      { timeout: 8_000 },
    )
    .toBeGreaterThan(100_000);
  await page.keyboard.press('Space');
  await expect(page.locator('#freeze')).toHaveText('Reanudar');
  return page.evaluate(() => {
    const canvas = document.querySelector('#bmode') as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const pixel of pixels) hash = Math.imul(hash ^ pixel, 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  });
}

test('dos cargas congeladas conservan el hash B-mode del ojo', async ({ browser }) => {
  // No existe un parámetro ?t= en la aplicación: esta prueba congela tras el
  // primer frame disponible y comprueba la reproducibilidad del seed fijo.
  const firstPage = await browser.newPage();
  const secondPage = await browser.newPage();
  const firstHash = await freezeAndHash(firstPage);
  const secondHash = await freezeAndHash(secondPage);
  expect(secondHash).toBe(firstHash);
  await firstPage.close();
  await secondPage.close();
});
