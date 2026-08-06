'use strict';
// Wykrywanie zawartosci repozytorium z jego WYDAN. Czysta logika, zero sieci -
// dostaje gotowa liste wydan z release.js i mowi, co w niej jest.
//
// Patcher NIE ZNA listy modow. Zna repozytoria. Mody rozpoznaje po tagach wydan:
//
//     <mod>-<x.y.z>          mapatlas-0.4.0   map-atlas-v1.2.3   ferrite-tweaks-1.2
//
// Grupuje po nazwie moda i bierze NAJWYZSZA wersje kazdego. Dzieki temu nowy mod
// w repozytorium pojawia sie w planie sam, bez zmiany czegokolwiek w aplikacji,
// a jedno wydanie moze dotyczyc jednego moda (nie trzeba dopinac cudzych jarow).

/** Nazwa moda to wszystko przed OSTATNIM "-<wersja>": "map-atlas-1.2.3" -> "map-atlas". */
const TAG_RE = /^(.+?)-v?(\d+(?:\.\d+)*)$/;

function parseTag(tag) {
  const m = TAG_RE.exec(String(tag || '').trim());
  if (!m) return null;
  return { mod: m[1].toLowerCase(), version: m[2] };
}

/**
 * Porownanie wersji ODCINKAMI, LICZBOWO.
 *
 * Porownanie napisow dawaloby "0.10.0" < "0.9.0" i cicho instalowalo starsza wersje -
 * blad najgorszego rodzaju, bo wyglada jak poprawne dzialanie.
 */
function cmpVersion(a, b) {
  const A = String(a).split('.').map(Number);
  const B = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || 0;
    const y = B[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Mody wyczytane z wydan repozytorium - po jednym wpisie na moda, zawsze najnowszy.
 *
 * @param {Array} releases wynik release.listReleases()
 * @param {{prerelease?:boolean, only?:string[], except?:string[], quietTags?:string[]}} opts
 * @returns {{mods:Array, skipped:string[]}}
 */
function mods(releases, opts = {}) {
  const { prerelease = false, only = null, except = null, quietTags = [] } = opts;
  const best = new Map();
  const skipped = [];

  // Wydania, ktore w tym repozytorium PELNIA INNA ROLE (np. niosa preset). Nie sa
  // modem i nie sa bledem, wiec zglaszanie ich jako "pominieto" tylko myli.
  const quiet = new Set(quietTags);
  const skip = (tag, why) => { if (!quiet.has(tag)) skipped.push(`${tag} (${why})`); };

  for (const rel of releases || []) {
    if (rel.draft) { skip(rel.tag, 'draft'); continue; }
    if (rel.prerelease && !prerelease) { skip(rel.tag, 'prerelease'); continue; }

    const parsed = parseTag(rel.tag);
    if (!parsed) { skip(rel.tag, 'tag nie pasuje do <mod>-<x.y.z>'); continue; }
    if (only && only.length && !only.includes(parsed.mod)) continue;
    if (except && except.includes(parsed.mod)) continue;

    // Zalaczniki moda: najpierw nazwane po nim, w ostatecznosci wszystkie jary wydania.
    const jars = (rel.assets || []).filter(a => a.name.toLowerCase().endsWith('.jar'));
    const own = jars.filter(a => a.name.toLowerCase().startsWith(parsed.mod));
    const assets = own.length ? own : jars;
    if (!assets.length) { skip(rel.tag, 'brak zalacznika .jar'); continue; }

    const prev = best.get(parsed.mod);
    if (prev && cmpVersion(prev.version, parsed.version) >= 0) continue;

    best.set(parsed.mod, {
      id: parsed.mod,
      version: parsed.version,
      tag: rel.tag,
      published: rel.published,
      // Pierwsza linia notatek wydania sluzy za opis w planie - autor moda nie musi
      // niczego dopisywac w innym repozytorium.
      notes: String(rel.body || '').trim().split(/\r?\n/)[0] || null,
      assets,
      // Ktore STARSZE pliki usunac przy wgraniu. Wyprowadzone z nazwy moda, wiec nikt
      // tego nie wpisuje i nie da sie zapomniec - dwie kopie moda w mods/ to crash.
      replaceGlob: parsed.mod + '-*.jar',
    });
  }

  return {
    mods: [...best.values()].sort((a, b) => a.id.localeCompare(b.id)),
    skipped,
  };
}

/**
 * Najnowsze wydanie zawierajace manifest presetu (configi). Preset jest jeden na
 * repozytorium - bierzemy najswiezszy, nie sumujemy.
 */
function presetRelease(releases, glob = /^preset-.*\.json$/i) {
  const usable = (releases || [])
    .filter(r => !r.draft && !r.prerelease)
    .filter(r => (r.assets || []).some(a => glob.test(a.name)))
    .sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  if (!usable.length) return null;
  const rel = usable[0];
  return { release: rel, asset: rel.assets.find(a => glob.test(a.name)) };
}

module.exports = { parseTag, cmpVersion, mods, presetRelease };
