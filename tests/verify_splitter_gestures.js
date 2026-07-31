const fs = require('fs');
const { chromium } = require('playwright');

function createWav(path) {
  const rate = 44100;
  const seconds = 5;
  const frames = rate * seconds;
  const size = frames * 2;
  const b = Buffer.alloc(44 + size);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + size, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(size, 40);
  for (let i = 0; i < frames; i += 1) {
    b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2);
  }
  fs.writeFileSync(path, b);
}

async function main() {
  createWav('sample.wav');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => console.log('BROWSER:', message.type(), message.text()));

  await page.goto('http://127.0.0.1:4173/?verification=native15', { waitUntil: 'networkidle' });
  await page.waitForSelector('#fileCut', { state: 'attached', timeout: 30000 });
  await page.setInputFiles('#fileCut', 'sample.wav');
  await page.waitForSelector('#editor:not([hidden])', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#roEnd')?.textContent !== '0:00.0');

  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  if (!viewport.includes('maximum-scale=1') || !viewport.includes('user-scalable=no')) {
    throw new Error('La página permite zoom global');
  }
  if (await page.locator('footer').count()) throw new Error('El texto eliminado reapareció');
  if ((await page.locator('#editCut').count()) !== 1) throw new Error('Falta el botón de tijeras');

  const frame = page.locator('#selFrame');
  let selection = await frame.boundingBox();
  if (!selection) throw new Error('No existe selección de onda');
  await page.mouse.click(selection.x + selection.width * 0.35, selection.y + selection.height * 0.5);
  const cutBefore = `${await page.locator('#roStart').textContent()}|${await page.locator('#roEnd').textContent()}`;
  await page.locator('#editCut').click();
  const cutAfter = `${await page.locator('#roStart').textContent()}|${await page.locator('#roEnd').textContent()}`;
  if (cutAfter === cutBefore) throw new Error('Las tijeras no recortaron en el cursor vertical');

  const wave = page.locator('#waveBox');
  let waveBox = await wave.boundingBox();
  selection = await frame.boundingBox();
  const wheelLeft = Math.max(waveBox.x + 25, selection.x + 25);
  const wheelRight = Math.min(waveBox.x + waveBox.width - 25, selection.x + selection.width - 25);
  if (wheelRight <= wheelLeft) throw new Error('No hay selección visible para la rueda');
  await page.mouse.move((wheelLeft + wheelRight) / 2, waveBox.y + waveBox.height * 0.5);
  await page.mouse.wheel(0, -520);
  await page.waitForTimeout(450);
  const wheelState = await wave.evaluate((element) => `${element.dataset.viewA}|${element.dataset.viewB}`);
  if (!/^\d+\.\d{6}\|\d+\.\d{6}$/.test(wheelState)) {
    throw new Error(`La rueda no actualizó el intervalo exacto: ${wheelState}`);
  }

  waveBox = await wave.boundingBox();
  selection = await frame.boundingBox();
  const visibleLeft = Math.max(waveBox.x + 30, selection.x + 30);
  const visibleRight = Math.min(waveBox.x + waveBox.width - 30, selection.x + selection.width - 30);
  if (visibleRight - visibleLeft < 90) throw new Error('No hay suficiente selección visible para pellizcar');
  const x1 = visibleLeft + (visibleRight - visibleLeft) * 0.38;
  const x2 = visibleLeft + (visibleRight - visibleLeft) * 0.62;
  const y = waveBox.y + waveBox.height * 0.5;
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }, { x: x2, y }] });
  for (const distance of [20, 45, 70]) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x1 - distance, y }, { x: x2 + distance, y }],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);

  const pinchState = await wave.evaluate((element) => `${element.dataset.viewA}|${element.dataset.viewB}`);
  const pinchMoves = Number((await wave.getAttribute('data-pinch-moves')) || 0);
  if (pinchMoves < 1) throw new Error('El pellizco no ejecutó movimientos');
  if (pinchState === wheelState) throw new Error('El pellizco no cambió el intervalo exacto');
  if (pageErrors.length) throw new Error(`Errores de página: ${pageErrors.join(' | ')}`);

  console.log('VERIFIED', JSON.stringify({ cutBefore, cutAfter, wheelState, pinchState, pinchMoves }));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
