'use strict';
// Wykrywanie celu latki: instancja Prisma, samodzielny katalog gry albo serwer,
// oraz lista instancji Prisma do wyboru w interfejsie.

const fs = require('fs');
const path = require('path');

const KIND = {
  PRISM: 'instancja Prism Launcher',
  GAME: 'katalog gry (klient, bez Prisma)',
  SERVER: 'serwer',
};

function isDir(p)  { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

/**
 * @param {string} dir
 * @returns {{root:string, gameDir:string, kind:string, prismCfg:string|null, side:'client'|'server'}}
 */
function detect(dir) {
  const root = path.resolve(dir);
  if (!isDir(root)) throw new Error('Nie ma takiego katalogu: ' + root);

  const cfg = path.join(root, 'instance.cfg');
  let game = null;
  for (const name of ['minecraft', '.minecraft']) {
    if (isDir(path.join(root, name))) { game = path.join(root, name); break; }
  }
  if (isFile(cfg) && game) return mk(root, game, KIND.PRISM, cfg, 'client');
  if (game) return mk(root, game, KIND.GAME, null, 'client');

  if (isDir(path.join(root, 'mods'))) {
    const client = isFile(path.join(root, 'options.txt')) || isDir(path.join(root, 'shaderpacks'))
      || isDir(path.join(root, 'resourcepacks'));
    const server = isFile(path.join(root, 'server.properties')) || isFile(path.join(root, 'user_jvm_args.txt'))
      || isFile(path.join(root, 'run.sh')) || isFile(path.join(root, 'run.bat'));
    if (server && !client) return mk(root, root, KIND.SERVER, null, 'server');
    return mk(root, root, KIND.GAME, null, 'client');
  }
  throw new Error('To nie wyglada na instancje Minecrafta (brak instance.cfg, minecraft/ ani mods/)');
}

function mk(root, gameDir, kind, prismCfg, side) {
  return {
    root, gameDir, kind, prismCfg, side,
    mods:        path.join(gameDir, 'mods'),
    config:      path.join(gameDir, 'config'),
    shaderpacks: path.join(gameDir, 'shaderpacks'),
    options:     path.join(gameDir, 'options.txt'),
  };
}

/** Ostrzezenia walidacyjne - nie blokuja, ale uzytkownik ma je zobaczyc. */
function warnings(inst) {
  const out = [];
  if (!isDir(inst.mods)) {
    out.push('brak katalogu mods/ - nie da sie wgrac ani wylaczyc modow');
  } else if (!findMod(inst, 'TerraFirmaGreg-Core') && !findMod(inst, 'TerraFirmaCraft')) {
    out.push('nie widze modow TerraFirmaGreg/TerraFirmaCraft - czy to na pewno ta paczka?');
  }
  const pack = path.join(inst.root, 'mmc-pack.json');
  if (isFile(pack)) {
    const json = fs.readFileSync(pack, 'utf8');
    if (!json.includes('"1.20.1"')) out.push('mmc-pack.json nie wspomina o Minecraft 1.20.1');
    if (json.includes('net.minecraftforge') && !json.includes('47.4.13')) {
      out.push('Forge w instancji to nie 47.4.13 (latka byla robiona na tej wersji)');
    }
  }
  return out;
}

/** Pierwszy mod o danym prefiksie (.jar albo .jar.disabled). */
function findMod(inst, prefix) {
  if (!isDir(inst.mods)) return null;
  const hit = fs.readdirSync(inst.mods).find(n =>
    n.startsWith(prefix) && (n.endsWith('.jar') || n.endsWith('.jar.disabled')));
  return hit ? path.join(inst.mods, hit) : null;
}

// ----------------------------------------------------------- instancje Prisma

function prismRoots() {
  const roots = [];
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'PrismLauncher'));
  const home = require('os').homedir();
  roots.push(path.join(home, '.local', 'share', 'PrismLauncher'));
  roots.push(path.join(home, 'Library', 'Application Support', 'PrismLauncher'));
  roots.push(path.join(home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher'));
  return roots;
}

/**
 * Wszystkie instancje Prisma na tej maszynie - do listy wyboru w UI.
 * @returns {{path:string, name:string, pack:string|null, mods:number, likelyTfg:boolean}[]}
 */
function listPrismInstances() {
  const out = [];
  for (const base of prismRoots()) {
    const dir = path.join(base, 'instances');
    if (!isDir(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (!isFile(path.join(p, 'instance.cfg'))) continue;
      let name = entry, pack = null;
      try {
        for (const line of fs.readFileSync(path.join(p, 'instance.cfg'), 'utf8').split(/\r?\n/)) {
          const [k, ...rest] = line.split('=');
          const v = rest.join('=').trim();
          if (k.trim() === 'name' && v) name = v;
          if (k.trim() === 'ManagedPackName' && v) pack = v;
        }
      } catch { /* nieczytelny cfg - zostaje nazwa katalogu */ }
      let mods = 0, likelyTfg = false;
      const modsDir = path.join(p, 'minecraft', 'mods');
      if (isDir(modsDir)) {
        const files = fs.readdirSync(modsDir);
        mods = files.filter(f => f.endsWith('.jar')).length;
        likelyTfg = files.some(f => f.startsWith('TerraFirmaGreg-Core') || f.startsWith('TerraFirmaCraft'));
      }
      out.push({ path: p, name, pack, mods, likelyTfg });
    }
  }
  // najpierw te, ktore wygladaja na nasza paczke
  out.sort((a, b) => (b.likelyTfg - a.likelyTfg) || a.name.localeCompare(b.name));
  return out;
}

module.exports = { detect, warnings, findMod, listPrismInstances, KIND, isDir, isFile };
