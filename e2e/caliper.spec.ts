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

test('calibre: arrastrar un extremo edita el valor; Escape revierte', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/?clock=fixed&t=0.4');
  await expect.poll(() => nonEmptyBModePixels(page), { timeout: 15_000 }).toBeGreaterThan(100_000);

  await page.locator('#caliper').click();
  const box = await canvasBox(page);
  await dragOnBMode(page, at(box, 0.4, 0.6), at(box, 0.6, 0.6));
  await expect(page.locator('#measureList')).toContainText('7.6 mm');

  // Edición del extremo B: 160 px → 9,5 mm (una sola medición, no duplicada).
  const [bx, by] = at(box, 0.6, 0.6);
  const [bx2] = at(box, 0.65, 0.6);
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(bx2, by, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#measureList')).toContainText('9.5 mm');
  await expect(page.locator('.mrow')).toHaveCount(1);

  // Segundo intento de edición cancelado con Escape: vuelve a 9,5 mm.
  const [bx3] = at(box, 0.65, 0.6);
  const [bx4, by4] = at(box, 0.8, 0.8);
  await page.mouse.move(bx3, by);
  await page.mouse.down();
  await page.mouse.move(bx4, by4, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('#measureList')).toContainText('9.5 mm');
  expect(pageErrors).toEqual([]);
});

test('DVNO: referencia a 3 mm visible y medición con etiqueta de protocolo', async ({ page }, testInfo) => {
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

  // Captura a medio gesto: banda elástica + etiqueta flotante + lupa + referencia.
  const [ax, ay] = at(box, 0.42, 0.66);
  const [mx2, my2] = at(box, 0.5, 0.66);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(mx2, my2, { steps: 4 });
  await page
    .screenshot()
    .then((png) => testInfo.attach('calibre-dvno-medio-gesto', { body: png, contentType: 'image/png' }));
  await page.mouse.up();

  // Segundo arrastre en zona libre del primer segmento: confirma otra DVNO.
  await dragOnBMode(page, at(box, 0.3, 0.45), at(box, 0.45, 0.45));
  await expect(page.locator('#measureList')).toContainText('2 · DVNO D transversal');
  await expect(page.locator('#measureList')).toContainText(/\d+\.\d\d mm/);
  expect(pageErrors).toEqual([]);
});
