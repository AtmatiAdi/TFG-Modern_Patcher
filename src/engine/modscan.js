'use strict';
// Skan ukrytych zaleznosci przed wylaczeniem moda.
//
// Zasada z docs/CONTEXT.md: mods.toml NIE wystarcza - mod moze
// odwolywac sie do klas innego moda bez deklarowania zaleznosci (sandworm_mod ->
// aaa_particles wywalil gre). Dlatego przegladamy bajtkod.
//
// Wnioski z pierwszej wersji skanu (2026-07-25), ktora falszywie alarmowala:
//  1. Token musi byc WASKI. "xaero/" lapalo tez `xaero/pac/` - to Open Parties and
//     Claims, INNY mod tego samego autora, nie minimapa. Stad lista konkretnych
//     pakietow + lista wykluczen.
//  2. Samo trafienie nie znaczy "twarda zaleznosc". Mody trzymaja opcjonalne
//     integracje w pakietach compat/integration/mixins - te klasy ladują sie tylko,
//     gdy drugi mod jest obecny. Potwierdzone empirycznie: nasza instancja chodzi z
//     wylaczonym Xaero od 2026-07-24 razem z create, gtceu i alltheleaks.
// Dlatego wynik dzielimy na MIEKKIE (informacja) i TWARDE (blokada).

const fs = require('fs');
const path = require('path');
const zip = require('./zip');

/** Sciezki klas, ktore znaczą "opcjonalna integracja, nie twarda zaleznosc". */
const SOFT_PATH = /(^|\/)(compat|compats|compatibility|integration|integrations|mixin|mixins|plugin|plugins|addon|addons|modules)(\/|s\/)/i;

function isSoftClass(className, tokens) {
  if (SOFT_PATH.test(className)) return true;
  // klasa siedzaca w pakiecie nazwanym od skanowanego moda (np. .../mods/xaerominimap/X.class)
  const base = tokens[0].split('/')[0].toLowerCase();
  return className.toLowerCase().includes('/' + base);
}

/**
 * @param {string} modsDir
 * @param {string[]} ignoreNames pliki, ktore wlasnie wylaczamy
 * @param {{tokens:string[]}} spec waskie prefiksy pakietow, np. ["xaero/common/"]
 * @param {(msg:string, done:number, total:number)=>void} onProgress
 * @returns {{jar:string, classes:string[], soft:boolean}[]}
 */
function findReferencing(modsDir, ignoreNames, spec, onProgress = () => {}) {
  const jars = fs.readdirSync(modsDir)
    .filter(n => n.endsWith('.jar') && !ignoreNames.includes(n))
    .sort();
  const needles = spec.tokens.map(t => Buffer.from(t, 'ascii'));
  const hits = [];

  jars.forEach((name, i) => {
    const classes = scanJar(path.join(modsDir, name), needles);
    if (classes.length) {
      hits.push({ jar: name, classes, soft: classes.every(c => isSoftClass(c, spec.tokens)) });
    }
    onProgress(name, i + 1, jars.length);
  });
  return hits;
}

function scanJar(file, needles) {
  const out = [];
  let archive;
  try {
    archive = zip.open(file);
  } catch {
    return out; // uszkodzony albo nietypowy jar - nie blokujemy z tego powodu
  }
  for (const entry of archive.entries) {
    if (!entry.name.endsWith('.class')) continue;
    let data;
    try {
      data = zip.read(archive.buf, entry);
    } catch {
      continue;
    }
    if (needles.some(n => data.includes(n))) out.push(entry.name.replace(/\.class$/, ''));
  }
  return out;
}

module.exports = { findReferencing, isSoftClass };
