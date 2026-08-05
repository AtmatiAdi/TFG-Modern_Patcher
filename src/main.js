'use strict';
// Proces glowny Electrona: okno bez ramki (wlasny pasek tytulu) + IPC do silnika.

const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const instanceLib = require('./engine/instance');
const runner = require('./engine/runner');
const journal = require('./engine/journal');
const catalog = require('./engine/catalog');
const patches = require('./engine/patches');

let win = null;

function createWindow() {
  // Rozmiar liczony z obszaru roboczego ekranu: na monitorach ze skalowaniem DPI
  // sztywne 1180x780 potrafi wyjsc wezsze niz uklad interfejsu.
  const work = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1420, Math.max(900, Math.round(work.width * 0.86)));
  const height = Math.min(920, Math.max(600, Math.round(work.height * 0.88)));

  win = new BrowserWindow({
    width,
    height,
    minWidth: 720,
    minHeight: 560,
    frame: false,
    backgroundColor: '#0b1020',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  // Katalog z dysku od razu (plan widoczny natychmiast, dziala bez sieci),
  // odswiezenie z GitHuba zaraz po pokazaniu okna.
  catalog.loadCached();
  win.once('ready-to-show', () => win.show());
  if (process.env.TFG_UI_DUMP) dumpLayout(win, process.env.TFG_UI_DUMP);
}

/**
 * Diagnostyka ukladu (TFG_UI_DUMP=<plik>): po zaladowaniu zapisuje wymiary okna i
 * elementow, ktore wystaja poza viewport, po czym zamyka aplikacje. Zrzut ekranu
 * nie wystarcza - przy skalowaniu DPI latwo zle ocenic, co sie dzieje.
 */
function dumpLayout(w, file) {
  w.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      w.webContents.executeJavaScript(`(() => {
        const vw = document.documentElement.clientWidth;
        const over = [...document.querySelectorAll('body *')]
          .map(el => ({ sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : ''),
                        right: Math.round(el.getBoundingClientRect().right) }))
          .filter(x => x.right > vw + 1).slice(0, 12);
        return JSON.stringify({
          viewport: [vw, document.documentElement.clientHeight],
          dpr: window.devicePixelRatio,
          bodyScrollWidth: document.body.scrollWidth,
          planWidth: Math.round((document.querySelector('.plan')?.getBoundingClientRect().width) || 0),
          itemWidth: Math.round((document.querySelector('.item')?.getBoundingClientRect().width) || 0),
          overflowing: over,
        }, null, 2);
      })()`).then(async json => {
        require('fs').writeFileSync(file, json, 'utf8');
        // zrzut robimy od srodka - zewnetrzny PrintWindow kadruje okno przy skalowaniu DPI
        if (process.env.TFG_UI_SHOT) {
          const img = await w.webContents.capturePage();
          require('fs').writeFileSync(process.env.TFG_UI_SHOT, img.toPNG());
        }
        app.quit();
      }).catch(err => { require('fs').writeFileSync(file, 'BLAD: ' + err.message, 'utf8'); app.quit(); });
    }, 2500);
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ------------------------------------------------------------------------- IPC

const send = (channel, payloadObj) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payloadObj); };

ipcMain.handle('window:action', (e, action) => {
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  profiles: runner.PROFILES,
  groups: patches.GROUPS,
  sourcesFile: catalog.sourcesFile(),
}));

/** Pobranie wydan z repozytoriow wymienionych w sources.json. */
ipcMain.handle('catalog:refresh', async () => {
  try {
    const mods = await catalog.refresh(msg => send('log', msg));
    return { ok: true, mods };
  } catch (e2) {
    return { ok: false, error: e2.message, mods: catalog.resolved() };
  }
});

ipcMain.handle('catalog:list', () => ({ ok: true, mods: catalog.resolved() }));

ipcMain.handle('instances:list', () => {
  try {
    return { ok: true, instances: instanceLib.listPrismInstances() };
  } catch (e) {
    return { ok: false, error: e.message, instances: [] };
  }
});

ipcMain.handle('instance:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Wskaz katalog instancji, gry albo serwera',
    properties: ['openDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

/** Plan jest liczony na kazda zmiane sciezki/profilu - bez zadnego przycisku. */
ipcMain.handle('plan:build', (e, { dir, options }) => {
  try {
    const inst = instanceLib.detect(dir);
    const opts = { ...runner.defaults(options.profile), ...options };
    if (inst.side === 'server' && opts.profile !== 'server') opts.profile = 'server';
    return {
      ok: true,
      instance: {
        root: inst.root, gameDir: inst.gameDir, kind: inst.kind, side: inst.side,
        isPrism: Boolean(inst.prismCfg),
      },
      warnings: instanceLib.warnings(inst),
      profile: opts.profile,
      items: runner.plan(inst, opts),
    };
  } catch (e2) {
    return { ok: false, error: e2.message };
  }
});

ipcMain.handle('plan:apply', (e, { dir, options, ids }) => {
  try {
    const inst = instanceLib.detect(dir);
    const opts = { ...runner.defaults(options.profile), ...options };
    const result = runner.apply(inst, opts, ids, msg => send('log', msg));
    return { ok: true, ...result };
  } catch (e2) {
    return { ok: false, error: e2.message };
  }
});

ipcMain.handle('plan:revert', (e, { dir }) => {
  try {
    const inst = instanceLib.detect(dir);
    const res = journal.revert(inst.root, msg => send('log', msg));
    return { ok: true, ...res };
  } catch (e2) {
    return { ok: false, error: e2.message };
  }
});

ipcMain.handle('shell:open', (e, target) => shell.openPath(target));
