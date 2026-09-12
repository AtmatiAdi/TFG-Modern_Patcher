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
//     integracje w pakietach compat/integration/mixins - te klasy laduja sie tylko,
//     gdy drugi mod jest obecny. Potwierdzone empirycznie: nasza instancja chodzi z
//     wylaczonym Xaero od 2026-07-24 razem z create, gtceu i alltheleaks.
//
// Wniosek trzeci (2026-09-12, modpack 0.13.10, seasonhud): sama SCIEZKA klasy tez nie
// wystarcza. seasonhud trzyma obsluge kazdej minimapy w `forge/platform/ForgeMinimapHelper`
// - nazwa pakietu nie mowi "compat", wiec stara regula uznala to za twarda zaleznosc i
// zablokowala `xaero-off`, chociaz klasa dziala poprawnie bez Xaero.
//
// Rozstrzyga to, CZEGO JVM potrzebuje, zeby klase ZALADOWAC:
//   - nadklasa i interfejsy sa rozwiazywane przy ladowaniu klasy. Ich brak to
//     natychmiastowy NoClassDefFoundError - czyli zaleznosc TWARDA;
//   - odwolania w cialach metod (nasza `hideXaero`) rozwiazuje sie LENIWIE, przy
//     pierwszym wykonaniu instrukcji. Mod, ktory pyta `ModList.isLoaded(...)` zanim
//     tam wejdzie, nigdy tej klasy nie dotknie - zaleznosc MIEKKA.
//
// Dlatego TWARDE = klasa dziedziczy/implementuje typ wylaczanego moda ORAZ nie siedzi
// w pakiecie integracyjnym. Sam warunek strukturalny nie wystarczy: gtceu ma 14 klas
// dziedziczacych po typach Xaero i mimo to chodzi z wylaczonym Xaero od 2026-07-24,
// bo wszystkie leza w `integration/map/xaeros/` i `core/mixins/xaerominimap/`, ktore
// mod laduje warunkowo.

const fs = require('fs');
const path = require('path');
const zip = require('./zip');

/** Sciezki klas, ktore znacza "opcjonalna integracja, nie twarda zaleznosc". */
const SOFT_PATH = /(^|\/)(compat|compats|compatibility|integration|integrations|mixin|mixins|plugin|plugins|addon|addons|modules)(\/|s\/)/i;

function isSoftClass(className, tokens) {
  if (SOFT_PATH.test(className)) return true;
  // klasa siedzaca w pakiecie nazwanym od skanowanego moda (np. .../mods/xaerominimap/X.class)
  const base = tokens[0].split('/')[0].toLowerCase();
  return className.toLowerCase().includes('/' + base);
}

/**
 * Naglowek .class: nadklasa i interfejsy. Tylko tyle, ile trzeba - reszta pliku
 * (pola, metody, atrybuty) nie ma wplywu na ladowanie klasy.
 * @returns {{superName:string|null, interfaces:string[]}|null} null = nie dalo sie odczytac
 */
function classHeader(buf) {
  try {
    if (buf.length < 10 || buf.readUInt32BE(0) !== 0xcafebabe) return null;
    const count = buf.readUInt16BE(8);
    const cp = new Array(count);
    let p = 10;
    for (let i = 1; i < count; i++) {
      const tag = buf[p]; p++;
      switch (tag) {
        case 1: { // Utf8
          const len = buf.readUInt16BE(p); p += 2;
          cp[i] = { tag, text: buf.toString('utf8', p, p + len) }; p += len; break;
        }
        case 7: case 8: case 16: case 19: case 20: // Class/String/MethodType/Module/Package
          cp[i] = { tag, ref: buf.readUInt16BE(p) }; p += 2; break;
        case 15: cp[i] = { tag }; p += 3; break;        // MethodHandle
        case 3: case 4: cp[i] = { tag }; p += 4; break; // Integer/Float
        case 5: case 6: cp[i] = { tag }; p += 8; i++; break; // Long/Double zajmuja dwa wpisy
        default: cp[i] = { tag }; p += 4;               // Fieldref/Methodref/NameAndType/Dynamic...
      }
      if (p > buf.length) return null;
    }
    const className = (idx) => {
      const e = cp[idx];
      if (!e || e.tag !== 7) return null;
      const name = cp[e.ref];
      return name && name.tag === 1 ? name.text : null;
    };
    p += 2;                                             // access_flags
    p += 2;                                             // this_class
    const superName = className(buf.readUInt16BE(p)); p += 2;
    const n = buf.readUInt16BE(p); p += 2;
    const interfaces = [];
    for (let i = 0; i < n; i++) { interfaces.push(className(buf.readUInt16BE(p))); p += 2; }
    return { superName, interfaces: interfaces.filter(Boolean) };
  } catch {
    return null;
  }
}

/** Czy typ pochodzi z wylaczanego moda. */
function fromDisabled(typeName, tokens) {
  return Boolean(typeName) && tokens.some(t => typeName.startsWith(t));
}

/**
 * Powod uznania trafienia za TWARDE albo null, gdy jest miekkie.
 * Nieczytelny naglowek (null) cofa nas do starej reguly po samej sciezce - gorzej
 * zgadywac, niz przepuscic nierozpoznana klase.
 */
function hardReason(className, header, tokens) {
  if (isSoftClass(className, tokens)) return null;
  if (!header) return 'nie dalo sie odczytac naglowka klasy';
  if (fromDisabled(header.superName, tokens)) return 'dziedziczy po ' + header.superName;
  const iface = header.interfaces.find(i => fromDisabled(i, tokens));
  return iface ? 'implementuje ' + iface : null;
}

/**
 * @param {string} modsDir
 * @param {string[]} ignoreNames pliki, ktore wlasnie wylaczamy
 * @param {{tokens:string[]}} spec waskie prefiksy pakietow, np. ["xaero/common/"]
 * @param {(msg:string, done:number, total:number)=>void} onProgress
 * @returns {{jar:string, classes:string[], hard:{name:string,reason:string}[], soft:boolean}[]}
 */
function findReferencing(modsDir, ignoreNames, spec, onProgress = () => {}) {
  const jars = fs.readdirSync(modsDir)
    .filter(n => n.endsWith('.jar') && !ignoreNames.includes(n))
    .sort();
  const needles = spec.tokens.map(t => Buffer.from(t, 'ascii'));
  const hits = [];

  jars.forEach((name, i) => {
    const found = scanJar(path.join(modsDir, name), needles, spec.tokens);
    if (found.length) {
      const hard = found.filter(c => c.reason).map(c => ({ name: c.name, reason: c.reason }));
      hits.push({ jar: name, classes: found.map(c => c.name), hard, soft: hard.length === 0 });
    }
    onProgress(name, i + 1, jars.length);
  });
  return hits;
}

function scanJar(file, needles, tokens) {
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
    if (!needles.some(n => data.includes(n))) continue;
    const name = entry.name.replace(/\.class$/, '');
    out.push({ name, reason: hardReason(name, classHeader(data), tokens) });
  }
  return out;
}

module.exports = { findReferencing, isSoftClass, classHeader, hardReason };
