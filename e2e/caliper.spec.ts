import { expect, test } from '@playwright/test';

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

/** Píxeles claramente azulados (referencia DVNO, rgba(77,163,255)). */
async function blueishPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#bmode') as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      if (b - r > 40 && b - g > 20) n++;
    }
    return n;
  });
}

/** Píxeles amarillos del calibre (#ffd24a): trazos, lupa y rótulos. */
async function caliperPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#bmode') as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      if (r > 200 && g > 160 && g < 240 && b < 120) n++;
    }
    return n;
  });
}

async function canvasBox(page: import('@playwright/test').Page) {
  await page.locator('#bmode').scrollIntoViewIfNeeded();
  const box = await page.locator('#bmode').boundingBox();
  if (!box) throw new Error('#bmode sin bounding box');
  return box;
}

const at = (box: { x: number; y: number; width: number; height: number }, fx: number, fy: number) => [
  box.x + box.width * fx,
  box.y + box.height * fy,
];

async function dragOnBMode(
  page: import('@playwright/test').Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

test('calibre: arrastre mide, la lista enumera y Supr/× borran', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/?clock=fixed&t=0.4');
  await expect.poll(() => nonEmptyBModePixels(page), { timeout: 15_000 }).toBeGreaterThan(100_000);

  await page.locator('#caliper').click();
  await expect(page.locator('#caliper')).toHaveClass(/on/);
  const box = await canvasBox(page);

  // Arrastre horizontal de 128 px: 128/640 · 38 mm de apertura = 7,6 mm.
  await dragOnBMode(page, at(box, 0.4, 0.6), at(box, 0.6, 0.6));
  await expect(page.locator('#measureList')).toContainText('1 · Distancia');
  await expect(page.locator('#measureList')).toContainText('7.6 mm');
  // Medición confirmada sobre la imagen: trazo amarillo presente.
  await expect.poll(() => caliperPixels(page), { timeout: 5_000 }).toBeGreaterThan(40);

  // Segunda medición (otro arrastre).
  await dragOnBMode(page, at(box, 0.4, 0.75), at(box, 0.5, 0.75));
  await expect(page.locator('#measureList')).toContainText('2 · Distancia');

  // Clic en la fila selecciona la entrada sobre la imagen.
  await page.locator('.mrow').first().click();
  await expect(page.locator('.mrow').first()).toHaveClass(/sel/);

  // Supr borra la seleccionada; la lista conserva la otra.
  await page.keyboard.press('Delete');
  await expect(page.locator('#measureList')).not.toContainText('1 · Distancia');
  await expect(page.locator('#measureList')).toContainText('2 · Distancia');

  // El botón × borra la restante.
  await page.locator('.mdel').first().click();
  await expect(page.locator('#measureList')).toBeEmpty();
  expect(pageErrors).toEqual([]);
});

test('DVNO: referencia a 3 mm visible y medición con etiqueta de protocolo', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/?clock=fixed&t=0.4');
  await expect.poll(() => nonEmptyBModePixels(page), { timeout: 15_000 }).toBeGreaterThan(100_000);

  await page.locator('#dvno').click();
  await expect(page.locator('#dvno')).toHaveClass(/on/);
  const box = await canvasBox(page);
  // Línea discontinua azul «3 mm retroglobo» sobre el B-mode.
  await expect.poll(() => blueishPixels(page), { timeout: 5_000 }).toBeGreaterThan(60);

  // El cursor sobre el canvas enciende la lupa (píxeles amarillos extra).
  const base = await caliperPixels(page);
  const [mx, my] = at(box, 0.5, 0.5);
  await page.mouse.move(mx, my, { steps: 3 });
  await expect.poll(() => caliperPixels(page), { timeout: 5_000 }).toBeGreaterThan(base + 200);

  // Arrastre cerca de la referencia (vaina a ~0,66 de alto): confirma DVNO.
  await dragOnBMode(page, at(box, 0.42, 0.66), at(box, 0.55, 0.66));
  await expect(page.locator('#measureList')).toContainText('1 · DVNO D transversal');
  await expect(page.locator('#measureList')).toContainText(/\d+\.\d\d mm/);
  expect(pageErrors).toEqual([]);
});
