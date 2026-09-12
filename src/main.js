'use strict';
// Proces glowny Electrona: okno bez ramki (wlasny pasek tytulu) + IPC do silnika.

const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const fs = require('fs');
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

  // Ikone USTAWIAMY W OKNIE, a nie zostawiamy plikowi wykonywalnemu: rcedit, ktory
  // stemplowalby exe, jest wylaczony przez signAndEditExecutable=false (patrz
  // docs/PATCHER.md - inaczej electron-builder wywala sie na archiwum winCodeSign).
  // Bez tego pasek zadan i Alt+Tab pokazywalyby domyslne logo Electrona.
  // Sciezki jak przy sources.json: w paczce resources, w repo build/.
  const icon = [
    process.resourcesPath ? path.join(process.resourcesPath, 'icon.ico') : null,
    path.join(__dirname, '..', 'build', 'icon.ico'),
  ].filter(Boolean).find(p => fs.existsSync(p));

  win = new BrowserWindow({
    width,
    height,
    ...(icon ? { icon } : {}),
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
    // TFG_UI_PROFILE=<id>: przelacza profil przed zrzutem (widok "wycofaj" w High).
    // TFG_UI_SCROLL=<id pozycji>: rozwija wszystko i przewija plan do tej pozycji.
    const profile = process.env.TFG_UI_PROFILE;
    if (profile) {
      setTimeout(() => w.webContents.executeJavaScript(
        `document.querySelector('.seg[data-profile=${JSON.stringify(profile)}]')?.click()`), 1200);
    }
    if (process.env.TFG_UI_SCROLL) {
      setTimeout(() => w.webContents.executeJavaScript(`(() => {
        document.querySelector('#expandBtn')?.click();
        document.querySelector('.item[data-id=${JSON.stringify(process.env.TFG_UI_SCROLL)}]')?.scrollIntoView();
      })()`), 2000);
    }
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
          // karta z gifem MUSI byc kwadratem - prostokat znaczy, ze uklad ja sciska
          ringBox: (r => r ? [Math.round(r.width), Math.round(r.height)] : null)
            (document.querySelector('.card.ring')?.getBoundingClientRect()),
          // separatory: zerowa dlugosc = linia jest w DOM, ale niewidoczna
          dividers: [...document.querySelectorAll('.divider')].map(el => {
            const r = el.getBoundingClientRect();
            return { sel: el.className, box: [Math.round(r.width), Math.round(r.height)],
                     at: [Math.round(r.x), Math.round(r.y)] };
          }),
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
  profiles: runner.profiles(),
  groups: patches.groups(),
  usingPreset: patches.usingPreset(),
  sourcesFile: catalog.sourcesFile(),
}));

/**
 * Sprawdzenie repozytoriow z sources.json. Kazde jest pytane o jedno i drugie:
 * mody (po tagach wydan) i configi (manifest preset-*.json). Grupy i profile moga
 * sie po tym ZMIENIC - preset je przynosi - wiec odsylamy je razem z wynikiem.
 */
ipcMain.handle('catalog:refresh', async () => {
  try {
    // TFG_OFFLINE=1: bez sieci - okno pracuje na tym, co lezy w cache (testy presetu
    // przed wydaniem, praca bez internetu).
    if (process.env.TFG_OFFLINE) {
      send('log', 'TFG_OFFLINE: bez sprawdzania zrodel, plan z cache.');
      return { ok: true, mods: catalog.resolved(), presets: catalog.presets().length,
               groups: patches.groups(), profiles: runner.profiles(),
               usingPreset: patches.usingPreset() };
    }
    const res = await catalog.refresh(msg => send('log', msg));
    return { ok: true, mods: res.mods, presets: res.presets.length,
             groups: patches.groups(), profiles: runner.profiles(),
             usingPreset: patches.usingPreset() };
  } catch (e2) {
    return { ok: false, error: e2.message, mods: catalog.resolved(),
             groups: patches.groups(), profiles: runner.profiles(),
             usingPreset: patches.usingPreset() };
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

/**
 * Podsumowanie idzie TYM SAMYM kanalem, co reszta logu, a nie odpowiedzia na invoke.
 * Zmierzone: odpowiedz na `invoke` wyprzedza w oknie wszystkie `webContents.send`
 * wyslane z wnetrza tej samej obslugi, wiec okno pisalo "Gotowe: ..." przed ostatnimi
 * liniami operacji (np. przed komunikatem o przerwanym wylaczaniu modow).
 */
ipcMain.handle('plan:apply', (e, { dir, options, ids }) => {
  const log = msg => send('log', msg);
  try {
    const inst = instanceLib.detect(dir);
    const opts = { ...runner.defaults(options.profile), ...options };
    const result = runner.apply(inst, opts, ids, log);
    log('');
    log(`Gotowe: zalatanych ${result.applied}, bledow ${result.failed}, pominietych ${result.skipped}.`);
    if (result.journal) log('Kopie zapasowe: ' + result.journal);
    return { ok: true, ...result };
  } catch (e2) {
    log('BLAD: ' + e2.message);
    return { ok: false, error: e2.message };
  }
});

ipcMain.handle('plan:revert', (e, { dir }) => {
  const log = msg => send('log', msg);
  try {
    const inst = instanceLib.detect(dir);
    const res = journal.revert(inst.root, log);
    log(res.count < 0 ? 'Nic nie cofnieto.' : 'Cofnieto operacji: ' + res.count);
    return { ok: true, ...res };
  } catch (e2) {
    log('BLAD: ' + e2.message);
    return { ok: false, error: e2.message };
  }
});

ipcMain.handle('shell:open', (e, target) => shell.openPath(target));
