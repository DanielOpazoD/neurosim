/* global document, HTMLCanvasElement, MouseEvent, fetch, setTimeout */

import { chromium } from '@playwright/test';
import { createServer } from 'node:net';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const evidenceDir = resolve(root, 'docs/evidence');
const seed = 'reference-n1';

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePromise(port));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`servidor no disponible: ${url}`);
}

async function waitForPaint(page, selector = '#bmode') {
  await page.waitForFunction(
    (target) => {
      const canvas = document.querySelector(target);
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      const context = canvas.getContext('2d');
      if (!context) return false;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
      return sum > 0;
    },
    selector,
    { timeout: 15_000 },
  );
}

function readNumber(text, label) {
  const match = text.match(new RegExp(`${label}\\s*\\n(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : Number.NaN;
}

function readInlineNumber(text, label) {
  const match = text.match(new RegExp(`${label}\\s*[·:]?\\s*(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : Number.NaN;
}

async function clickGuide(page, mode) {
  const box = await page.locator('#bmode').boundingBox();
  if (!box) throw new Error('canvas B-mode sin bounding box');
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('#bmode');
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      const context = canvas.getContext('2d');
      if (!context) return false;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 130 && pixels[i + 1] > 100 && pixels[i + 2] > 150) count++;
      }
      return count > 10;
    },
    null,
    { timeout: 5_000 },
  );
  const guide = await page.evaluate(() => {
    const canvas = document.querySelector('#bmode');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    let bestY = Math.round(height * 0.5);
    let bestCount = 0;
    for (let y = 0; y < height; y++) {
      let count = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (pixels[i] < 130 && pixels[i + 1] > 100 && pixels[i + 2] > 150) count++;
      }
      if (count > bestCount) {
        bestY = y;
        bestCount = count;
      }
    }
    return { y: bestY / height, count: bestCount };
  });
  if (!guide || guide.count < 10) throw new Error(`guía de caliper no visible (${mode})`);
  const halfWidth = mode === 'dvno' ? 52 : 264;
  const center = box.width / 2;
  const y = box.y + guide.y * box.height;
  await page.mouse.click(box.x + center - halfWidth, y);
  await page.mouse.click(box.x + center + halfWidth, y);
}

async function saveDownload(page, locator, path) {
  const downloadPromise = page.waitForEvent('download');
  await locator.click();
  const download = await downloadPromise;
  await download.saveAs(path);
  return JSON.parse(await readFile(path, 'utf8'));
}

async function canvasDiff(pageA, pageB) {
  const pixels = async (page) =>
    page.evaluate(() => {
      const canvas = document.querySelector('#bmode');
      if (!(canvas instanceof HTMLCanvasElement)) return [];
      return [...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data];
    });
  const [a, b] = await Promise.all([pixels(pageA), pixels(pageB)]);
  const deltas = [];
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    deltas.push(Math.abs(a[i] - b[i]));
  }
  deltas.sort((x, y) => x - y);
  const mean = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
  return {
    mean,
    p99: deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.99))] ?? 0,
    over8: deltas.filter((value) => value > 8).length / Math.max(1, deltas.length),
  };
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  for (const entry of [
    'n1-eye-der-dvno.png',
    'n1-onsd-report.json',
    'n1-temporal-color.png',
    'n1-temporal-pw.png',
    'n1-debrief.json',
    'n1-navigator.png',
    'N1.md',
  ]) {
    await rm(resolve(evidenceDir, entry), { force: true });
  }
  await run('npm', ['run', 'build']);
  const port = await freePort();
  const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    stdio: 'inherit',
  });
  await waitForServer(`http://127.0.0.1:${port}/`);
  const browser = await chromium.launch({
    args: [
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const url = `http://127.0.0.1:${port}/?seed=${seed}`;
  try {
    await page.goto(url);
    await waitForPaint(page);
    await page.locator('[data-station="ojo"][data-side="der"]').click();
    await page.locator('#onsdProtocol').click();
    await page.locator('#teaching').click();
    for (let i = 0; i < 4; i++) await clickGuide(page, 'dvno');
    for (let i = 0; i < 2; i++) await clickGuide(page, 'dte');
    await page.locator('#debrief').click();
    const ocularAcoustic = await page.locator('#acousticLabel').innerText();
    await page.locator('#navigator').screenshot({ path: resolve(evidenceDir, 'n1-navigator.png') });
    await page.locator('#bmode').screenshot({ path: resolve(evidenceDir, 'n1-eye-der-dvno.png') });
    const onsdReport = await saveDownload(
      page,
      page.locator('#exportOnsd'),
      resolve(evidenceDir, 'n1-onsd-report.json'),
    );
    const debrief = await saveDownload(
      page,
      page.locator('#exportDebrief'),
      resolve(evidenceDir, 'n1-debrief.json'),
    );
    await page.locator('[data-station="temporal"][data-side="der"]').click();
    await waitForPaint(page);
    await page.locator('#bmode').screenshot({ path: resolve(evidenceDir, 'n1-temporal-color.png') });
    await page.locator('#pw').click();
    await page.evaluate(() => {
      const canvas = document.querySelector('#bmode');
      if (!(canvas instanceof HTMLCanvasElement)) return;
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: rect.left + rect.width * 0.584,
          clientY: rect.top + rect.height * 0.781,
        }),
      );
    });
    await page.waitForFunction(
      () => document.querySelector('#readouts')?.textContent?.includes('PSV'),
      null,
      {
        timeout: 20_000,
      },
    );
    await page.waitForTimeout(5_000);
    await page.keyboard.press('Space');
    await page.locator('#bmode').screenshot({ path: resolve(evidenceDir, 'n1-temporal-pw.png') });
    const pwText = await page.locator('#readouts').innerText();
    const modelReadout = await page.locator('#readouts').innerText();
    const expectedPi = readInlineNumber(modelReadout, 'PI esp\\.');
    const pw = {
      psvCms: readNumber(pwText, 'PSV'),
      edvCms: readNumber(pwText, 'EDV'),
      taMaxCms: readNumber(pwText, 'TAMax'),
      pi: readNumber(pwText, 'PI \\(Gosling\\)'),
      acoustic: await page.locator('#acousticLabel').innerText(),
    };
    const report = onsdReport.onsdReport;
    const parityPages = await Promise.all([context.newPage(), context.newPage()]);
    const [cpuPage, gpuPage] = parityPages;
    await Promise.all([cpuPage.goto(`${url}&renderer=cpu`), gpuPage.goto(`${url}&renderer=gpu`)]);
    await Promise.all([waitForPaint(cpuPage), waitForPaint(gpuPage)]);
    const parity = await canvasDiff(cpuPage, gpuPage);
    await Promise.all(parityPages.map((parityPage) => parityPage.close()));
    const n1 = [
      '# Evidencia N1',
      '',
      `Semilla de ejecución: \`${seed}\` (URL reproducible).`,
      '',
      '| Medición | Observado en ejecución | Esperado/verdad del modelo |',
      '| --- | ---: | ---: |',
      `| DVNO der medio | ${report.perSide.der.dvnoMeanMm?.toFixed(2) ?? '—'} mm | 4,60 mm |`,
      `| DVNO izq medio | ${report.perSide.izq.dvnoMeanMm?.toFixed(2) ?? '—'} mm | 4,70 mm |`,
      `| DVNO bilateral | ${report.bilateralMeanMm?.toFixed(2) ?? '—'} mm | 4,65 mm |`,
      `| Ratio DVNO/DTE der | ${report.perSide.der.ratio?.toFixed(2) ?? '—'} | 0,20–0,25 |`,
      `| PSV M1 der | ${pw.psvCms.toFixed(0)} cm/s | 74–79 cm/s (puerta golden/E2E) |`,
      `| EDV M1 der | ${pw.edvCms.toFixed(0)} cm/s | modelo N1 |`,
      `| TAMax M1 der | ${pw.taMaxCms.toFixed(0)} cm/s | modelo N1 |`,
      `| PI M1 der | ${pw.pi.toFixed(2)} | ${Number.isFinite(expectedPi) ? expectedPi.toFixed(2) : '—'} (hemodinámica) |`,
      `| MI/TI ocular | ${ocularAcoustic} | MI ≤ 0,23; TIS ≤ 1,0 |`,
      `| MI/TIC temporal | ${pw.acoustic} | modelo acústico temporal |`,
      `| Paridad CPU/GPU | media ${parity.mean.toFixed(6)} niveles, P99 ${parity.p99}, >8 ${(parity.over8 * 100).toFixed(3)} % | ≤1 / ≤4 / ≤0,5 % |`,
      '',
      '## Exportaciones',
      '',
      '- `n1-eye-der-dvno.png`',
      '- `n1-onsd-report.json`',
      '- `n1-temporal-color.png`',
      '- `n1-temporal-pw.png`',
      '- `n1-debrief.json`',
      '- `n1-navigator.png`',
      '',
      `Eventos docentes exportados: ${debrief.summary?.nEvents ?? '—'}.`,
      '| Goldens | `eyeDerBmode=c1bc9927`, `temporalDerBmode=501adb92`, `pwM1Point2=8d503a17`, `colorM1Der=36cb5bab` | hash vigente |',
      `Texto de lectura PW: ${modelReadout.replaceAll('\n', ' · ')}`,
    ].join('\n');
    await writeFile(resolve(evidenceDir, 'N1.md'), `${n1}\n`);
    await run('npx', [
      'prettier',
      '--write',
      resolve(evidenceDir, 'n1-onsd-report.json'),
      resolve(evidenceDir, 'n1-debrief.json'),
      resolve(evidenceDir, 'N1.md'),
    ]);
  } finally {
    await browser.close();
    server.kill();
  }
}

await main();
