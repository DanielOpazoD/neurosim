import { expect, test } from '@playwright/test';

function readoutValue(text: string, label: string): number {
  const match = text.match(new RegExp(`${label}\\s*\\n(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : Number.NaN;
}

test('cabeza escaneada, sin micro-movimiento y «Ventana óptima» lista para medir', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/?clock=fixed&t=0.4');
  // DEC-59: el interruptor de micro-movimiento ya no existe.
  await expect(page.locator('#handMotion')).toHaveCount(0);
  // La cabeza escaneada (CC BY 3.0) carga tras el primer B-mode; créditos en el pie.
  await expect(page.locator('#headView')).toHaveAttribute('data-head-model', 'escaneo', { timeout: 60_000 });
  await expect(page.locator('#credits')).toContainText('Lee Perry-Smith');

  // Ojo D: la ventana óptima centra el nervio (barrido lateral −2,3 mm).
  await page.keyboard.press('o');
  await expect(page.locator('#shiftV')).toHaveText('-2.3 mm', { timeout: 10_000 });
  await expect(page.locator('#hint')).toContainText('Ventana óptima (transversal)');

  // Temporal D: color encendido, puerta sobre M1; P mide sin más clics.
  await page.locator('[data-station="temporal"][data-side="der"]').click();
  await page.locator('#optimal').click();
  await expect(page.locator('body')).toHaveAttribute('data-color', 'true');
  await expect(page.locator('#hint')).toContainText('M1');
  await expect(page.locator('#tiltV')).toHaveText('-5°', { timeout: 10_000 });
  await page.keyboard.press('p');
  await expect
    .poll(async () => readoutValue(await page.locator('#readouts').innerText(), 'PSV'), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect(page.locator('#readouts')).toContainText('m1-der');
  expect(pageErrors).toEqual([]);
});
