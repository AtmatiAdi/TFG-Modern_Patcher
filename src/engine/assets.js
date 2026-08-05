'use strict';
// Pliki dolaczone do samej aplikacji - w tym repozytorium leza w assets/,
// w wersji spakowanej w resources/assets.
//
// Trafia tu tylko to, czego nie da sie sensownie wydac jako release: shaderpack
// (cudzy, wersjonowany osobno) i jego ustawienia. Mody ida przez katalog wydan.

const fs = require('fs');
const path = require('path');

function dir() {
  const candidates = [
    process.env.TFG_ASSETS_DIR,
    process.resourcesPath ? path.join(process.resourcesPath, 'assets') : null,
    path.join(__dirname, '..', '..', 'assets'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[candidates.length - 1];
}

function file(rel) { return path.join(dir(), rel); }
function exists(rel) { return fs.existsSync(file(rel)); }
function size(rel) { return fs.statSync(file(rel)).size; }
function read(rel) { return fs.readFileSync(file(rel)); }

/**
 * Nazwa dolaczonego shaderpacka. Czytana z katalogu, nie z metadanych - dzieki
 * temu podmiana pakietu na nowsza wersje to podmiana pliku i nic wiecej.
 */
let packName = null;
function shaderpack() {
  if (packName !== null) return packName;
  try {
    packName = fs.readdirSync(file('shaderpacks')).filter(n => n.endsWith('.zip')).sort().pop() || null;
  } catch {
    packName = null;
  }
  return packName;
}

module.exports = { dir, file, exists, size, read, shaderpack };
