import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { resolveChromeExecutable } from './browser-path.mjs';

const output = path.resolve('artifacts/environment-materials'); fs.mkdirSync(output, { recursive: true });
const integratedWorld = fs.readFileSync(new URL('../export/web/world.js', import.meta.url), 'utf8');
const alreadyIntegrated = integratedWorld.includes('const materials=await enhanceEnvironmentMaterials(');
const world = alreadyIntegrated ? integratedWorld
  .replace('await enhanceEnvironmentMaterials(gltf.scene,{manager:assetManager})', '({materials:0,textures:0})')
  .replace('await applyEnvironmentOcclusion(gltf.scene)', '({meshes:0,vertices:0})') : integratedWorld;
const enhanced = alreadyIntegrated ? integratedWorld.replace('this.environment={materials,occlusion};',
  'this.environment={materials,occlusion};globalThis.environmentAudit=this.environment;') : `import {enhanceEnvironmentMaterials} from './environment-materials.js';
import {applyEnvironmentOcclusion} from './environment-occlusion.js';\n` + world.replace(
  'this.optimization=optimizeStaticScene',
  `globalThis.environmentAudit={materials:await enhanceEnvironmentMaterials(gltf.scene,{manager:assetManager}),
    occlusion:await applyEnvironmentOcclusion(gltf.scene)};
    this.optimization=optimizeStaticScene`);
const browser = await chromium.launch({ executablePath: resolveChromeExecutable(), headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const report = { method: 'Same local code and cameras; material/occlusion hooks injected into world.js only in test responses. Controlled visual sampling, not traversal or native FPS proof.', variants: [] };
try {
  for (const [label, source] of (process.argv.includes('--enhanced-only') ? [['enhanced', enhanced]] : [['baseline', world], ['enhanced', enhanced]])) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage(), result = { label, errors: [], failedRequests: [], views: [] }; report.variants.push(result);
    page.on('pageerror', error => result.errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
    page.on('requestfailed', request => result.failedRequests.push(request.url()));
    page.on('response', response => { if (response.status() >= 400) result.errors.push(`${response.status()} ${response.url()}`); });
    await page.route('**/world.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForFunction(() => globalThis.kino?.debug.getState().ready, null, { timeout: 180000 });
    await page.click('#start');
    await page.waitForFunction(() => kino.debug.getState().active);
    await page.evaluate(() => { kino.debug.setAutoSpawn(false); kino.debug.setInvulnerable(true); kino.debug.clearEnemies(); });
    if (label === 'enhanced') {
      result.hooks = await page.evaluate(() => environmentAudit);
      assert(result.hooks.materials.materials > 100); assert(result.hooks.occlusion.meshes > 100);
    }
    for (const [name, feet, target] of [
      ['lobby', [-101, 108, 1256], [0, 240, 650]],
      ['upper-hall', [1020, 325, 970], [1550, 365, 575]],
      ['theater', [0, -60, -650], [0, 160, -1650]],
      ['stage', [50, 0, -1720], [0, 190, -250]],
    ]) {
      if (name === 'upper-hall') await page.evaluate(() => {
        const power = kino.debug.getEntities().find(e => e.targetname === 'use_elec_switch');
        kino.debug.teleportPlayer(power.position); kino.debug.step(.3); kino.debug.interact(power);
      });
      await page.evaluate(({ feet, target }) => { kino.debug.teleportPlayer(feet); kino.debug.step(.3); kino.debug.lookAt(target); }, { feet, target });
      await page.waitForTimeout(4000);
      const samples = await page.evaluate(() => new Promise(resolve => {
        const frames = [], start = performance.now(); let last;
        function frame(now) { if (last !== undefined) frames.push(now - last); last = now;
          if (now - start < 5000) requestAnimationFrame(frame);
          else { const sorted = [...frames].sort((a, b) => a - b); resolve({ fps: frames.length * 1000 / (now - start), p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], performance: kino.debug.getState().performance, renderScale: kino.debug.getState().renderScale }); }
        } requestAnimationFrame(frame);
      }));
      await page.screenshot({ path: path.join(output, `${label}-${name}.png`) });
      result.views.push({ name, ...samples }); console.log(JSON.stringify({ label, name, ...samples }));
    }
    result.memory = await page.evaluate(() => kino.debug.memoryState());
    assert.deepEqual(result.errors, []); assert.deepEqual(result.failedRequests, []);
    await context.close();
  }
  report.success = true;
} catch (error) { report.success = false; report.failure = String(error); process.exitCode = 1; }
finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ success: report.success, failure: report.failure, output })); }
