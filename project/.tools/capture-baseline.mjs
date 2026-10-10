import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { resolveChromeExecutable } from './browser-path.mjs';

const output = path.resolve(process.env.KINO_BASELINE_DIR || 'artifacts/baseline');
fs.mkdirSync(output, { recursive: true });
const report = { capturedAt: new Date().toISOString(), node: process.version, url: process.env.KINO_URL || 'http://127.0.0.1:5173/', console: [], pageErrors: [], failedRequests: [], httpErrors: [], fpsSamples: [] };
const browser = await chromium.launch({ executablePath: resolveChromeExecutable(), headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
report.browser = browser.version();
report.executable = resolveChromeExecutable();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('console', message => report.console.push({ type: message.type(), text: message.text() }));
page.on('pageerror', error => report.pageErrors.push(String(error)));
page.on('requestfailed', request => report.failedRequests.push({ url: request.url(), error: request.failure() }));
page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ status: response.status(), url: response.url() }); });
async function inspect() {
  return page.evaluate(() => ({ title: document.title, loading: document.getElementById('load-label')?.textContent, menuStatus: document.getElementById('menu-status')?.textContent, state: globalThis.kino?.debug.getState() ?? null }));
}
try {
  const started = Date.now();
  await page.goto(report.url, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.kino?.debug.getState().ready || document.getElementById('load-label')?.textContent.startsWith('Unable to start:'), null, { timeout: 120000 });
  report.loadMilliseconds = Date.now() - started;
  report.menu = await inspect();
  await page.screenshot({ path: path.join(output, '01-menu.png') });
  if (!report.menu.state?.ready) throw new Error(report.menu.loading || 'Game did not become ready');
  await page.click('#start');
  await page.waitForFunction(() => globalThis.kino?.debug.getState().active, null, { timeout: 15000 });
  await page.waitForTimeout(5000);
  for (let sample = 0; sample < 8; sample++) {
    report.fpsSamples.push(await page.evaluate(() => kino.debug.getState().performance));
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: path.join(output, '02-gameplay.png') });
  report.gameplay = await inspect();
  const before = report.gameplay.state.player.feet;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyD');
  const after = (await inspect()).state.player.feet;
  report.movement = { before, after, distance: Math.hypot(after[0] - before[0], after[2] - before[2]) };
  report.success = true;
} catch (error) {
  report.success = false;
  report.failure = { message: String(error), stack: error.stack };
  report.failureState = await inspect().catch(() => null);
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, loadMilliseconds: report.loadMilliseconds, failure: report.failure?.message, fps: report.fpsSamples, pageErrors: report.pageErrors, httpErrors: report.httpErrors, failedRequests: report.failedRequests, output }, null, 2));
  await context.close();
  await browser.close();
}
