import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const packaging = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.dirname(packaging);
const dependencyCandidates = ['reference/kino/node_modules/playwright-core/index.mjs',
  'project/node_modules/playwright-core/index.mjs'].map(relative => path.join(work, relative));
let dependencyPath;
for (const candidate of dependencyCandidates) {
  if (await fs.access(candidate).then(() => true).catch(() => false)) { dependencyPath = candidate; break; }
}
assert(dependencyPath, 'Install the project dependencies before running native verification');
const { _electron } = await import(pathToFileURL(dependencyPath));
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const appPath = option('--app') ? await fs.realpath(path.resolve(option('--app'))) : undefined;
const gameRoot = appPath ? path.join(appPath, 'Contents/Resources/app/game') :
  path.resolve(process.argv[2] || path.join(work, 'reference/kino/export/web'));
const output = path.resolve(option('--output') || (appPath ? path.join(work, 'packaged-check') :
  process.argv[3] || path.join(work, 'desktop-check')));
const bundledExecutable = appPath ? execFileSync('/usr/libexec/PlistBuddy',
  ['-c', 'Print :CFBundleExecutable', path.join(appPath, 'Contents/Info.plist')], { encoding: 'utf8' }).trim() : undefined;
const executablePath = appPath ? path.join(appPath, 'Contents/MacOS', bundledExecutable) :
  process.argv[4] || path.join(work, 'desktop-runtime/extracted-44.7.0/Electron.app/Contents/MacOS/Electron');
const packaged = Boolean(appPath || process.argv[4]);
const performanceRequested = process.argv.includes('--performance');
const testedQuality=option('--quality')||'balanced';
const expectedArch=option('--expected-arch')||'arm64';
const verificationProfile = option('--profile');
if (verificationProfile) await fs.mkdir(path.resolve(verificationProfile), { recursive: true });
await fs.mkdir(output, { recursive: true });
const report = { gameRoot, executablePath, appPath, errors: [], failedRequests: [], consoleErrors: [],
  httpErrors: [], externalRequests: [], requests: 0, launches: [], deliberateOfflineProbeEvents: [] };
report.verificationProfile=verificationProfile??'default user profile';
let electronApp, page, originalSensitivity, changedSensitivity, originalQuality, originalStorage;
const offlineProbeUrl = 'https://example.com/__kino_offline_probe';

async function samplePerformance(label, seconds) {
  const result = await page.evaluate(({ label, seconds }) => new Promise(resolve => {
    const start = performance.now(), first = kino.debug.memoryState(), intervals = [], samples = [];
    let previous, lastSample = -Infinity, raf, finished = false;
    function frame(now) {
      if (finished) return;
      if (previous !== undefined) intervals.push(now - previous);
      previous = now;
      if (now - lastSample >= 1000) {
        lastSample = now;
        const state = kino.debug.getState();
        samples.push({ timeMs: now - start, ...state.performance, feet: state.player.feet, rotation: state.player.rotation, active: state.active,
          round: state.round, enemies: state.enemies.length, health: state.health });
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    setTimeout(() => {
      finished = true; cancelAnimationFrame(raf);
      const elapsedMs = performance.now() - start, last = kino.debug.memoryState();
      const sorted = [...intervals].sort((a, b) => a - b);
      const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
      const canvas = document.querySelector('canvas');
      resolve({ label, elapsedMs, rafFrames: intervals.length, rafFps: intervals.length * 1000 / elapsedMs,
        frameIntervalMs: { p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) },
        renderedFrames: last.renderedFrames - first.renderedFrames,
        renderedFps: (last.renderedFrames - first.renderedFrames) * 1000 / elapsedMs,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio,
          canvasWidth: canvas.width, canvasHeight: canvas.height,
          actualRenderScale: canvas.width / innerWidth, hidden: document.hidden },
        settings: { quality: document.querySelector('[data-setting="quality"]').value },
        samples, rawIntervalsMs: intervals, memory: last, state: kino.debug.getState() });
    }, seconds * 1000);
  }), { label, seconds });
  assert(result.rafFrames > 0, `${label}: no animation frames`);
  assert(result.samples.every(sample => sample.active), `${label}: game lost focus or paused during measurement`);
  report.performancePhases.push(result);
  console.log(JSON.stringify({ phase: label, fps: result.renderedFps, frameIntervalMs: result.frameIntervalMs,
    enemies: result.state.enemies.length, viewport: result.viewport }));
  return result;
}

async function performancePhases() {
  report.performancePhases = [];
  report.performanceMethod = 'Controlled visible native window; 1440 by 900 content pixels; selected graphics preset (recorded per phase). Incidental movement/fire/look input blocked only during performance phases; Escape still pauses. Invulnerability prevents benchmark deaths. Lobby keeps normal spawns; stage and round-25 stress use explicit debug setup. These are controlled performance measurements, not survival achievements.';
  await page.evaluate(() => {
    // Isolate controlled frame measurements from incidental desktop input.
    // Escape still pauses; the check fails rather than concealing focus loss.
    const block = event => {
      if (event.code === 'Escape' || event.code === 'KeyF') return;
      event.stopImmediatePropagation(); event.preventDefault();
    };
    const types = ['keydown','keyup','mousedown','mouseup','mousemove','pointerdown','pointerup','pointermove','wheel'];
    for (const type of types) window.addEventListener(type, block, { capture:true, passive:false });
    window.__releaseBenchmarkInput = () => { for (const type of types) window.removeEventListener(type, block, true); };
    kino.debug.setActive(true); kino.debug.setInvulnerable(true);
  });
  await page.waitForTimeout(15000);
  await electronApp.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
  if (!(await page.evaluate(() => kino.debug.getState().active))) await page.locator('#start').click({ force: true });
  await page.waitForFunction(() => kino.debug.getState().active && document.pointerLockElement);
  await samplePerformance('lobby-after-15-second-warmup', 15);
  await page.screenshot({ path: path.join(output, '03-performance-lobby.png') });
  await page.evaluate(() => {
    kino.debug.setAutoSpawn(false); kino.debug.clearEnemies();
    const power = kino.debug.getEntities().find(entity => entity.targetname === 'use_elec_switch');
    kino.debug.teleportPlayer([power.position[0], power.position[1] - 55, power.position[2]]);
    kino.debug.step(.2);
  });
  report.powerSetupProbe = await page.evaluate(() => {
    const power = kino.debug.getEntities().find(entity => entity.targetname === 'use_elec_switch');
    return { id: power.id, ...kino.debug.interactionProbe(power.id) };
  });
  assert.equal(report.powerSetupProbe.promptId, report.powerSetupProbe.id, 'Power switch must be in range and visible');
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => kino.debug.getState().power);
  await page.evaluate(() => { kino.debug.teleportPlayer([0, -60, -400]); kino.debug.lookAt([0, 120, -1650]); });
  assert((await page.evaluate(() => kino.debug.getState())).power, 'Power-on stage setup failed');
  await page.waitForTimeout(3000);
  await samplePerformance('power-on-stage', 10);
  await page.screenshot({ path: path.join(output, '04-performance-stage.png') });
  await page.evaluate(() => {
    kino.debug.setRound(25); kino.debug.setAutoSpawn(false); kino.debug.setInvulnerable(true);
    const feet = kino.debug.getState().player.feet;
    for (let i = 0; i < 24; i++) {
      // Put the whole crowd in front of the camera, across the stage approach.
      const requested = [feet[0] + (i % 6 - 2.5) * 55, feet[1], feet[2] - 350 - Math.floor(i/6)*65];
      const path = kino.debug.navigationPath(feet, requested);
      if (!path.length) throw new Error(`Crowd benchmark point ${i} has no valid navigation path`);
      const position = path.at(-1);
      kino.debug.spawnEnemy(position, 'zombie');
    }
  });
  assert.equal((await page.evaluate(() => kino.debug.getState())).enemies.length, 24);
  await page.waitForTimeout(3000);
  const stress = await samplePerformance('controlled-round-25-with-24-active-zombies', 15);
  assert(stress.samples.every(sample => sample.round === 25 && sample.enemies === 24));
  await page.screenshot({ path: path.join(output, '05-performance-stress.png') });
  await page.evaluate(() => window.__releaseBenchmarkInput());
}

try {
  if (appPath) {
    assert(appPath.endsWith('.app'));
    await fs.access(path.join(appPath, 'Contents/Resources/app/main.mjs'));
    await fs.access(path.join(gameRoot, 'index.html'));
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
    report.signatureVerified = true;
  }
  for (let iteration = 0; iteration < 2; iteration++) {
    electronApp = await _electron.launch({ executablePath:option('--launch-executable')||executablePath,
      args: [...(packaged ? [] : [packaging, '--game-root', gameRoot]), ...(verificationProfile ? ['--verification-profile',path.resolve(verificationProfile)] : [])], timeout: 90000 });
    page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    page.on('pageerror', error => report.errors.push(String(error)));
    page.on('requestfailed', request => (request.url() === offlineProbeUrl ? report.deliberateOfflineProbeEvents : report.failedRequests)
      .push({ url: request.url(), error: request.failure() }));
    page.on('request', request => {
      report.requests += 1;
      if (!request.url().startsWith('kino://game/') && !request.url().startsWith('blob:kino://game/') &&
          !request.url().startsWith('data:')) {
        (request.url() === offlineProbeUrl ? report.deliberateOfflineProbeEvents : report.externalRequests).push(request.url());
      }
    });
    page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ status: response.status(), url: response.url() }); });
    page.on('console', message => { if (message.type() === 'error') {
      (message.text().includes(offlineProbeUrl) ? report.deliberateOfflineProbeEvents : report.consoleErrors).push(message.text());
    } });
    await page.waitForFunction(() => globalThis.kino?.debug.getState().ready, null, { timeout: 120000 });
    const settings = await electronApp.evaluate(({ app, BrowserWindow }) => {
      const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { userData: app.getPath('userData'), appPath: app.getAppPath(), executable: process.execPath,
        isPackaged: app.isPackaged, sandbox: preferences.sandbox,
        contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration,
        version: process.versions.electron, applicationVersion: app.getVersion(), arch: process.arch };
    });
    const environment = await page.evaluate(() => ({ url: location.href, origin: location.origin,
      secure: isSecureContext, require: typeof require, process: typeof process,
      probe: localStorage.getItem('kino-wrapper-storage-probe'), ready: kino.debug.getState().ready }));
    report.launches.push({ settings, environment });
    const listening = execFileSync('/usr/sbin/lsof', ['-n', '-P', '-a', '-p', String(electronApp.process().pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' });
    const ports = [...listening.matchAll(/^n127\.0\.0\.1:(\d+)$/gm)].map(match => Number(match[1]));
    let localServer;
    for (const port of ports) {
      const candidate = `http://127.0.0.1:${port}`;
      const health = await fetch(`${candidate}/__health`).then(response => response.json()).catch(() => null);
      if (health?.app === 'kino-desktop') localServer = candidate;
    }
    assert(localServer); report.launches.at(-1).server = localServer;
    assert.equal(environment.url, 'kino://game/'); assert.equal(environment.secure, true);
    assert.equal(environment.require, 'undefined'); assert.equal(environment.process, 'undefined');
    assert.equal(settings.sandbox, true); assert.equal(settings.contextIsolation, true);
    assert.equal(settings.nodeIntegration, false); assert.equal(settings.arch, expectedArch);
    if (appPath) {
      assert.equal(settings.appPath, path.join(appPath, 'Contents/Resources/app'));
      assert.equal(settings.executable, executablePath);
      assert.equal(settings.isPackaged, true);
      assert.equal(settings.applicationVersion, '1.8.0');
      report.actualBundledExecutableVerified = true;
    }
    if (iteration === 0) {
      originalStorage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
      report.offlineProof = {
        rendererFetch: await page.evaluate(async url => {
          try { const response = await fetch(url); return { rejected: false, status: response.status }; }
          catch (error) { return { rejected: true, error: String(error) }; }
        }, offlineProbeUrl),
        sessionNetworkFetch: await electronApp.evaluate(async ({ session }, url) => {
          try { const response = await session.fromPartition('persist:kino-desktop').fetch(url); return { rejected: false, status: response.status }; }
          catch (error) { return { rejected: true, error: String(error) }; }
        }, offlineProbeUrl),
        method: 'Renderer CSP and the packaged session network policy reject a deliberate external probe. The computer network remains connected. Local assets are reloaded with the same blocking policy still active.',
      };
      assert(report.offlineProof.rendererFetch.rejected);
      assert(report.offlineProof.sessionNetworkFetch.rejected);
      await page.reload();
      await page.waitForFunction(() => globalThis.kino?.debug.getState().ready, null, { timeout: 120000 });
      report.offlineProof.localReloadReady = true;
      await page.evaluate(() => localStorage.setItem('kino-wrapper-storage-probe', 'persists'));
      originalQuality = await page.locator('[data-setting="quality"]').inputValue();
      if (performanceRequested && originalQuality !== testedQuality) {
        await page.locator('#settings-open').click();
        await page.locator('[data-setting="quality"]').selectOption(testedQuality);
        await page.locator('#settings-done').click();
      }
      await page.screenshot({ path: path.join(output, '01-desktop-menu.png') });
      await electronApp.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
      if (!(await page.evaluate(() => kino.debug.getState().active))) {
        await page.locator('#start').click({ force: true }).catch(async error => {
          if (!(await page.evaluate(() => kino.debug.getState().active && document.pointerLockElement))) throw error;
        });
      }
      await page.waitForFunction(() => kino.debug.getState().active && document.pointerLockElement, null, { timeout: 15000 });
      const before = await page.evaluate(() => kino.debug.getState().player.feet);
      await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
      const after = await page.evaluate(() => kino.debug.getState().player.feet);
      report.movement = Math.hypot(after[0] - before[0], after[2] - before[2]);
      assert(report.movement > 1);
      const aimWeapon = await page.evaluate(() => kino.debug.getState().weapon.id);
      const hipFov = await page.evaluate(() => kino.debug.getState().cameraFov);
      await page.keyboard.press('KeyQ');
      await page.waitForFunction(() => kino.debug.getState().input.ads);
      await page.waitForFunction(fov => kino.debug.getState().cameraFov < fov - 5, hipFov);
      await page.waitForTimeout(500);
      const aimMagazine = await page.evaluate(() => kino.debug.getState().weapon.mag);
      await page.mouse.click(720,450);
      await page.waitForFunction(mag => kino.debug.getState().weapon.mag === mag - 1, aimMagazine);
      assert(await page.evaluate(() => kino.debug.getState().input.ads));
      assert.equal(await page.evaluate(() => kino.debug.getState().weapon.id), aimWeapon);
      await page.screenshot({ path: path.join(output, '02-keyboard-aim.png') });
      await page.keyboard.press('KeyQ');
      await page.waitForFunction(() => !kino.debug.getState().input.ads);
      await page.waitForFunction(fov => kino.debug.getState().cameraFov > fov - .5, hipFov);
      report.keyboardAimPassed = true;
      report.machinePresentation = await page.evaluate(() => ({machines:kino.debug.machineState(),locator:kino.debug.boxLocatorState()}));
      assert.equal(report.machinePresentation.machines.nativeHands,3);assert.equal(report.machinePresentation.locator.lamps,81);
      report.keyboardAimMethod = 'Actual packaged keyboard Q toggle plus left mouse fire; Q release retains aim and second press exits. Automated input on this Mac, not physical Magic Mouse hardware testing.';
      const beforeZ = await page.evaluate(() => kino.debug.getState().weapon.mag);
      await page.keyboard.press('KeyZ');
      await page.waitForFunction(m=>kino.debug.getState().weapon.mag===m-1,beforeZ);
      report.keyboardFirePassed=true;
      // Exercise the main-process powerMonitor handlers without putting the
      // user's computer to sleep or locking their screen.
      await page.keyboard.down('KeyW');await page.keyboard.down('KeyZ');
      await electronApp.evaluate(({powerMonitor})=>powerMonitor.emit('suspend'));
      await page.waitForFunction(()=>!kino.debug.getState().active&&!document.pointerLockElement);
      const asleep=await page.evaluate(()=>kino.debug.getState());
      await page.keyboard.up('KeyW');await page.keyboard.up('KeyZ');
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(()=>kino.debug.getState().time),asleep.time);
      assert(!asleep.input.primary&&!asleep.input.ads&&!asleep.input.laptop.fire);
      await electronApp.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(()=>kino.debug.getState().time),asleep.time);
      assert.equal(await page.evaluate(()=>kino.debug.getState().active),false);
      await page.locator('#start').click();await page.waitForFunction(()=>kino.debug.getState().active&&document.pointerLockElement);
      assert.equal(await page.evaluate(()=>kino.debug.getState().weapon.mag),asleep.weapon.mag);
      report.systemSleepWakePassed=true;
      report.systemSleepWakeMethod='Main-process powerMonitor suspend/resume events emitted deliberately; verifies wrapper-to-renderer freeze/clear/manual-resume. No physical lid close or sleep.';
      report.performance = await page.evaluate(() => kino.debug.getState().performance);
      await page.screenshot({ path: path.join(output, '02-desktop-gameplay.png') });
      if (performanceRequested) await performancePhases();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !kino.debug.getState().active && !document.pointerLockElement, null, { timeout: 10000 });
      report.pausePassed = true;
      // Change a real setting through its slider, then verify it after relaunch.
      await page.locator('#settings-open').click();
      await page.screenshot({ path: path.join(output, '06-settings.png') });
      const sensitivity = page.locator('[data-setting="sensitivity"]');
      originalSensitivity = await sensitivity.inputValue();
      await sensitivity.press(Number(originalSensitivity) < 2.5 ? 'ArrowRight' : 'ArrowLeft');
      changedSensitivity = await sensitivity.inputValue();
      assert.notEqual(changedSensitivity, originalSensitivity);
      await page.locator('#settings-done').click();
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
      await page.waitForTimeout(1000);
      assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()), true);
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false));
    } else {
      assert.equal(environment.probe, 'persists');
      await page.evaluate(() => localStorage.removeItem('kino-wrapper-storage-probe'));
      await page.locator('#settings-open').click();
      const sensitivity = page.locator('[data-setting="sensitivity"]');
      assert.equal(await sensitivity.inputValue(), changedSensitivity);
      report.settingsPersisted = true;
      await sensitivity.press(Number(originalSensitivity) < Number(changedSensitivity) ? 'ArrowLeft' : 'ArrowRight');
      assert.equal(await sensitivity.inputValue(), originalSensitivity);
      if (performanceRequested) await page.locator('[data-setting="quality"]').selectOption(originalQuality);
      await page.locator('#settings-done').click();
      const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
      assert.equal(storage['kino.best'], originalStorage['kino.best'], 'Controlled run must not alter the best score');
      assert.equal(storage['kino-wrapper-storage-probe'], undefined);
      // Restore exact storage bytes, including an initially absent settings
      // key; UI values were already verified restored above.
      await page.evaluate(original => {
        for (const key of ['kino.desktop.settings.v1', 'kino-wrapper-storage-probe']) {
          if (Object.hasOwn(original, key)) localStorage.setItem(key, original[key]);
          else localStorage.removeItem(key);
        }
      }, originalStorage);
      assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))), originalStorage);
      report.originalStorageRestored = true;
      report.controlledRunNotPersisted = true;
    }
    await electronApp.close(); electronApp = null;
    await assert.rejects(fetch(`${localServer}/__health`));
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.httpErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.serverShutdownPassed = true;
  report.success = true;
} catch (error) {
  report.success = false; report.failure = String(error); report.stack = error.stack;
  report.failureState = await page?.evaluate(() => ({ active: globalThis.kino?.debug.getState().active,
    pointerLock: Boolean(document.pointerLockElement), startDisplay: getComputedStyle(document.getElementById('start')).display,
    menuDisplay: getComputedStyle(document.getElementById('menu')).display, status: document.getElementById('menu-status')?.textContent })).catch(() => null);
  process.exitCode = 1;
} finally {
  if (electronApp && originalStorage) {
    await page?.evaluate(original => {
      for (const key of ['kino.desktop.settings.v1', 'kino-wrapper-storage-probe']) {
        if (Object.hasOwn(original, key)) localStorage.setItem(key, original[key]);
        else localStorage.removeItem(key);
      }
    }, originalStorage).catch(() => {});
  }
  if (electronApp) await electronApp.close().catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, failure: report.failure,
    report: path.join(output, 'report.json'), requests: report.requests,
    launches: report.launches.length, unexpectedErrors: report.errors.length + report.failedRequests.length +
      report.consoleErrors.length + report.httpErrors.length + report.externalRequests.length,
    offlineProof: report.offlineProof, settingsPersisted: report.settingsPersisted,
    originalStorageRestored: report.originalStorageRestored,
    controlledRunNotPersisted: report.controlledRunNotPersisted,
    serverShutdownPassed: report.serverShutdownPassed }, null, 2));
}
