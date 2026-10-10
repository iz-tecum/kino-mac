import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Resolve a locally installed browser without depending on a Playwright download. */
export function resolveChromeExecutable() {
  const override = process.env.KINO_CHROME || process.env.BROWSER_PATH;
  if (override) {
    if (existsSync(override)) return override;
    throw new Error(`Browser override does not exist: ${override}. Set KINO_CHROME to the Chrome executable.`);
  }
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error('No local Chrome, Chromium, or Edge found. Set KINO_CHROME to its executable.');
  return found;
}
