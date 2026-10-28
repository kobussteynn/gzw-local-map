const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv.includes('--smoke-test') ? 4175 : 4174;
const origin = `http://localhost:${PORT}`;
let backend, window, quitting = false, backendReady = false;
const smokeTest = process.argv.includes('--smoke-test');
const smokeOutput = process.env.GZW_SMOKE_OUTPUT;
const profile = process.env.GZW_DESKTOP_TEST_PROFILE;
if (profile) {
  app.setPath('userData', profile);
  const sessionPath=path.join(profile, 'session');
  fs.mkdirSync(sessionPath, { recursive: true });
  app.setPath('sessionData', sessionPath);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(start).catch(fail);
}

function isMapUrl(url) {
  try { return new URL(url).origin === origin; } catch { return false; }
}
function openExternal(url) {
  try { if (['https:', 'http:'].includes(new URL(url).protocol)) shell.openExternal(url).catch(() => {}); } catch {}
}
async function fail(error) {
  if (quitting) return;
  if (smokeTest) {
    let page = '';
    if (window && !window.isDestroyed()) {
      page = await window.webContents.executeJavaScript('document.body.innerText').catch(() => '');
      if (smokeOutput) await window.webContents.capturePage().then(img => fs.writeFileSync(smokeOutput + '.png', img.toPNG())).catch(() => {});
    }
    if (smokeOutput) fs.writeFileSync(smokeOutput, JSON.stringify({ ok: false, error: String(error), url: window?.webContents.getURL(), page }));
    app.exitCode = 1;
  } else dialog.showErrorBox('GZW Tac Map could not start', `${error.message || error}\n\nClose any other GZW desktop instance and try again. Logs are in ${app.getPath('userData')}.`);
  app.quit();
}
async function start() {
  const resourceRoot = app.isPackaged ? path.join(process.resourcesPath, 'map') : path.join(__dirname, '..');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const log = fs.createWriteStream(path.join(app.getPath('userData'), 'desktop-server.log'), { flags: 'a' });
  log.write(`UI resources: ${resourceRoot}\n`);
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'backend', 'gzw-map-server.exe') : (process.env.GZW_PYTHON || 'python');
  const args = app.isPackaged ? [] : [path.join(resourceRoot, 'server.py')];
  backend = spawn(executable, [...args, '--port', String(PORT)], {
    windowsHide: true,
    env: { ...process.env, GZW_RESOURCE_ROOT: resourceRoot, GZW_CACHE_DIR: path.join(app.getPath('userData'), 'cache'), PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stderr.on('data', chunk => log.write(chunk));
  backend.stdout.on('data', chunk => log.write(chunk));
  backend.on('error', fail);
  backend.on('exit', code => { log.end(); if (!quitting && backendReady) fail(new Error(`The map service stopped (exit ${code}).`)); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The local map service did not start within 30 seconds.')), 30000);
    let output = '';
    const ready = chunk => {
      output += chunk.toString();
      if (output.includes('GZW_SERVER_READY ')) {
        clearTimeout(timeout); backendReady = true; backend.stdout.off('data', ready); resolve();
      }
    };
    backend.stdout.on('data', ready);
    backend.once('error', error => { clearTimeout(timeout); reject(error); });
    backend.once('exit', code => { if (!backendReady) { clearTimeout(timeout); reject(new Error(`The map service could not start (exit ${code}). Port ${PORT} may already be in use.`)); } });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  window = new BrowserWindow({
    title: 'GZW Tac Map', width: 1500, height: 950, minWidth: 900, minHeight: 650,
    backgroundColor: '#090909', show: false,
    icon: path.join(resourceRoot, 'artifacts', 'desktop-icon.ico'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false, backgroundThrottling: !smokeTest },
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => log.write(`Load failed ${code}: ${description} ${url}\n`));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isMapUrl(url)) window.loadURL(url).catch(fail);
    else openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (!isMapUrl(url)) { event.preventDefault(); openExternal(url); } });
  window.webContents.on('will-redirect', (event, url) => { if (!isMapUrl(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Map', submenu: [
      { label: 'Home', click: () => window.loadURL(origin + '/maps/lamang') },
      { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  await window.loadURL(origin + '/maps/lamang');
  if (smokeTest) {
    const waitForMap = `new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { clearInterval(poll); reject(new Error('Map tiles did not finish loading')); }, 60000);
      const poll = setInterval(() => {
        const canvas = document.querySelector('.ol-viewport canvas');
        const tileLoaded = performance.getEntriesByType('resource').some(entry => entry.name.includes('/__upstream/cdn/') && entry.responseEnd > 0);
        if (document.querySelector('#runs-toolbar') && canvas && tileLoaded) { clearTimeout(timeout); clearInterval(poll); resolve(true); }
      }, 250);
    })`;
    // This check runs only in the maintainer's packaged-app test, never on normal launches.
    const result = await window.webContents.executeJavaScript(`(async () => {
      // A fresh profile shows the upstream map's non-binding gameplay notice.
      // Acknowledge it only in this explicit maintainer smoke test.
      await new Promise((resolve, reject) => {
        const check = () => {
          const notice = [...document.querySelectorAll('button')].find(button => /I understand.*Continue/i.test(button.textContent) && button.getClientRects().length);
          if (notice) notice.click();
          if (document.querySelector('#runs-toolbar')) { clearTimeout(timeout); clearInterval(poll); resolve(); }
        };
        const timeout = setTimeout(() => { clearInterval(poll); reject(new Error('Map controls did not load')); }, 45000);
        const poll = setInterval(check, 100);
        check();
      });
      const status = await fetch('/__mirror/status').then(r => r.json());
      const references = await fetch('/__mirror/planner-data?map=lamang').then(r => r.json());
      const markers = Object.values(references.markers).reduce((count, group) => count + (group.markersArray?.length || 0), 0);
      const script = await fetch('/__mirror/local/location-filter.js').then(r => r.ok);
      localStorage.setItem('gzw.desktop.smoke', 'persisted');
      return { title: document.title, status, script, markers, nodeDisabled: typeof require === 'undefined' };
    })()`);
    await window.webContents.executeJavaScript(waitForMap);
    await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.webContents.reload(); });
    await window.webContents.executeJavaScript(waitForMap);
    const persisted = await window.webContents.executeJavaScript(`localStorage.getItem('gzw.desktop.smoke') === 'persisted'`);
    const missions = process.argv.includes('--mission-smoke-test') ? await require('./mission-smoke.cjs')(window) : null;
    if (smokeOutput) {
      await window.webContents.capturePage().then(img => fs.writeFileSync(smokeOutput + '.png', img.toPNG()));
      fs.writeFileSync(smokeOutput, JSON.stringify({ ok: result.script && result.nodeDisabled && persisted && result.markers > 1000, persisted, ...result, missions }, null, 2));
    }
    app.quit();
  }
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; if (backend && !backend.killed) backend.kill(); });
