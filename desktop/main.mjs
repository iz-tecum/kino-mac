import { app, BrowserWindow, Menu, dialog, session, protocol, screen, powerMonitor } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialWindowSize } from './scripts/window-size.mjs';
import { startGameServer } from './scripts/server.mjs';
import { fetchLocalAsset, closeLocalAssetRequests } from './scripts/local-fetch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--game-root');
const gameRoot = rootFlag >= 0 && process.argv[rootFlag + 1]
  ? path.resolve(process.argv[rootFlag + 1]) : path.join(here, 'game');
let gameServer, gameSession, window, closing = false, reportedError = false;
app.setName('Kino der Toten');
// Development acceptance can use an isolated profile while an older build
// remains paused. Ordinary launches retain the existing settings and records.
const verificationFlag = process.argv.indexOf('--verification-profile');
if (verificationFlag >= 0) {
  const profilePath = process.argv[verificationFlag + 1];
  if (!profilePath || !path.isAbsolute(profilePath)) throw new Error('Verification profile must be an absolute path');
  app.setPath('userData', profilePath);
}
app.enableSandbox();
// A stable standard origin gives settings and best scores the same storage
// identity on every launch while the private HTTP service uses a random port.
protocol.registerSchemesAsPrivileged([{ scheme: 'kino', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

function fail(message) {
  if (reportedError || closing) return;
  reportedError = true;
  dialog.showErrorBox('Kino der Toten', message);
  app.quit();
}

function sameGameOrigin(url) {
  try {
    if (url.startsWith('blob:')) return sameGameOrigin(url.slice(5));
    const parsed = new URL(url);
    return parsed.protocol === 'kino:' && parsed.hostname === 'game' &&
      !parsed.port && !parsed.username && !parsed.password;
  } catch { return false; }
}

async function openGame() {
  gameSession = session.fromPartition('persist:kino-desktop');
  gameSession.protocol.handle('kino', async request => {
    if (!sameGameOrigin(request.url) ||
        (request.initiatorOrigin && !sameGameOrigin(request.initiatorOrigin))) {
      return new Response('', { status: 403 });
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 405 });
    const url = new URL(request.url);
    const headers = new Headers();
    for (const name of ['range', 'accept', 'if-range']) {
      const value = request.headers.get(name); if (value) headers.set(name, value);
    }
    // Node's fetch stays in the main process; the renderer can only address the
    // registered game origin, never arbitrary local services or file paths.
    const response = await fetchLocalAsset(`${gameServer.origin}${url.pathname}${url.search}`, {
      method: request.method, headers, redirect: 'error', signal: request.signal,
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  });
  gameSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === window?.webContents &&
      ['pointerLock', 'fullscreen'].includes(permission) &&
      sameGameOrigin(details.requestingUrl || contents.getURL()));
  });
  gameSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    contents === window?.webContents && ['pointerLock', 'fullscreen'].includes(permission) &&
    sameGameOrigin(requestingOrigin));
  gameSession.setDevicePermissionHandler(() => false);
  gameSession.webRequest.onBeforeRequest((details, callback) => {
    const localResource = sameGameOrigin(details.url) || details.url.startsWith('data:') ||
      (details.url.startsWith('blob:') && sameGameOrigin(details.url));
    callback({ cancel: !localResource });
  });
  gameSession.on('will-download', event => event.preventDefault());
  window = new BrowserWindow({
    title: 'Kino der Toten', ...initialWindowSize(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workAreaSize),
    minWidth: 720, minHeight: 480,
    backgroundColor: '#08090b', show: false, fullscreenable: true,
    webPreferences: {
      session: gameSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      navigateOnDragDrop: false, spellcheck: false,
      devTools: process.argv.includes('--game-devtools'),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!sameGameOrigin(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!sameGameOrigin(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') fail('The game stopped unexpectedly. Please reopen Kino der Toten.');
  });
  window.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) fail('The game could not open its local files. Please restore the complete app and try again.');
  });
  window.once('ready-to-show', () => { window.show(); window.focus(); });
  window.on('closed', () => { window = null; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Kino der Toten', submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'hide' },
      { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { label: 'Quit Kino der Toten', accelerator: 'Command+Q', click: () => app.quit() },
    ] },
    { label: 'View', submenu: [
      { role: 'togglefullscreen', label: 'Fullscreen', accelerator: 'Control+Command+F' },
    ] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
  ]));
  app.setAboutPanelOptions({ applicationName: 'Kino der Toten', applicationVersion: app.getVersion(),
    copyright: 'Unofficial fan reconstruction. See the included credits and asset notices.' });
  // Lid close / screen lock must freeze solo play even when the web view
  // has not yet received a visibility change. Resume never resumes combat.
  const notifyPower = name => {
    if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed())
      window.webContents.executeJavaScript(`window.dispatchEvent(new Event('${name}'))`).catch(()=>{});
  };
  const pauseSystem = () => notifyPower('kino-system-pause');
  const resumeSystem = () => notifyPower('kino-system-resume');
  powerMonitor.on('suspend',pauseSystem);powerMonitor.on('lock-screen',pauseSystem);
  powerMonitor.on('resume',resumeSystem);powerMonitor.on('unlock-screen',resumeSystem);
  window.on('closed',()=>{powerMonitor.removeListener('suspend',pauseSystem);powerMonitor.removeListener('lock-screen',pauseSystem);powerMonitor.removeListener('resume',resumeSystem);powerMonitor.removeListener('unlock-screen',resumeSystem);});
  await window.loadURL('kino://game/');
  if (process.argv.includes('--game-devtools')) window.webContents.openDevTools({ mode: 'detach' });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    gameServer = await startGameServer(gameRoot);
    await openGame();
  }).catch(() => fail('Kino der Toten could not start. Please keep the entire app together and reopen it.'));
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (gameServer && !closing) {
    event.preventDefault();
    closing = true;
    gameSession?.flushStorageData();
    closeLocalAssetRequests();
    gameServer.close().finally(() => app.quit());
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.quit());
