'use strict';
// Lista pozycji planu. Aplikacja NIE ZNA ani jednej optymalizacji i ani jednego moda -
// jedno i drugie czyta z wydan repozytoriow wymienionych w sources.json:
//
//  1. PRESETY - optymalizacje, pliki gry (configi, kubejs), shaderpack, narzedzia.
//     Manifest jest DANYMI (docs/PRESET-FORMAT.md), zamienia go na operacje compile.js.
//  2. MODY wykryte w repozytoriach po tagach wydan (discover.js).
//
// Presetow moze byc kilka - po jednym z kazdego repozytorium, ktore go wydalo.
// Sklada sie je w jeden plan, wiec kolizja id pozycji musi byc rozstrzygnieta tutaj.
//
// Brak presetu nie jest bledem: plan pokazuje wtedy same mody i mowi, czego brakuje.

const path = require('path');
const { installFile, fileResource } = require('./changes');
const catalog = require('./catalog');
const compile = require('./compile');
const release = require('./release');

/**
 * Grupy uzywane, gdy zaden preset ich nie dostarcza - potrzebne, zeby dalo sie pokazac
 * same mody. To uklad okna, nie wiedza o paczce.
 */
const FALLBACK_GROUPS = [
  { id: 'mods', label: 'Mody i zasoby', description: 'Wydania wykryte w repozytoriach' },
];

function globToRe(glob) {
  return new RegExp('^' + String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

/**
 * Skad compile.js bierze pliki dla installAsset / installRelease. Trzymamy to tutaj,
 * bo tylko ta warstwa wie jednoczesnie o katalogu i o presetach.
 */
function wireAssets() {
  compile.setAssetLookup({
    // Szukamy w zalacznikach TEGO presetu. Bez repo (stara sciezka wywolania)
    // przegladamy wszystkie - inaczej plan zamilklby bez powodu.
    preset: (mask, repo) => {
      const scope = repo ? catalog.presets().filter(p => p.repo === repo) : catalog.presets();
      for (const p of scope) {
        const hit = (p.assets || []).find(a => globToRe(mask).test(path.basename(a)));
        if (hit) return hit;
      }
      return null;
    },
    release: (repo, mask) => {
      const cached = release.newestCached(repo, mask);
      return cached ? cached.file : null;
    },
  });
}

/**
 * Pozycje dla modow znalezionych w repozytoriach. Nie ma tu ANI JEDNEJ nazwy moda -
 * wszystko pochodzi z tagow wydan (discover.js).
 */
function modItems(group) {
  return catalog.resolved().map(mod => {
    const changes = (mod.files || []).map((file, i) => installFile({
      resource: fileResource(file, mod.error ? `nie pobrano (${mod.error})` : 'nie pobrano pliku'),
      target: inst => path.join(inst.mods, mod.names[i] || path.basename(file)),
      label: 'mods/' + (mod.names[i] || path.basename(file)),
      replaceGlob: mod.replaceGlob || null,
    }));
    return {
      id: 'mod-' + mod.id,
      group,
      source: mod.repo,
      side: mod.side || 'both',
      title: `${mod.name || mod.id} ${mod.version || ''}`.trim(),
      doc: mod.repo,
      why: (mod.why ? mod.why + ' ' : '') + `Zrodlo: ${mod.repo} (${mod.tag || 'brak wydania'}).`,
      selected: true,
      changes: changes.length ? changes : [installFile({
        resource: fileResource(null, mod.error || 'nie pobrano zadnego pliku'),
        target: inst => path.join(inst.mods, mod.id + '.jar'),
        label: 'mods/' + mod.id + '.jar',
      })],
    };
  });
}

// ----------------------------------------------------------------------- API

function manifests() {
  return catalog.presets().map(p => p.manifest);
}

/** Grupy: z presetow, a gdy ich nie ma - tyle, ile trzeba na pokazanie modow. */
function groups() {
  const fromPresets = compile.groupsFrom(manifests());
  return fromPresets.length ? fromPresets : FALLBACK_GROUPS;
}

/** Profile: z presetow. null = zaden preset nie dostarczyl profili. */
function profiles() {
  const fromPresets = compile.profilesFrom(manifests());
  return Object.keys(fromPresets).length ? fromPresets : null;
}

function usingPreset() {
  return manifests().length > 0;
}

/**
 * Id pozycji jest kluczem: po nim idzie zaznaczenie w oknie, --only i --skip.
 * Dwa presety moga niezaleznie nazwac pozycje tak samo, wiec drugiemu dopisujemy
 * autora repozytorium. Wyrzucenie kolizji byloby gorsze - pozycja zniknelaby
 * z planu bez sladu, a to wyglada jak poprawne dzialanie.
 */
function uniqueIds(items) {
  const seen = new Set();
  for (const it of items) {
    if (!seen.has(it.id)) { seen.add(it.id); continue; }
    const owner = String(it.source || '').split('/')[0].toLowerCase();
    let id = owner ? `${it.id}@${owner}` : it.id + '-2';
    for (let n = 2; seen.has(id); n++) id = `${it.id}@${owner || 'x'}-${n}`;
    it.why = (it.why ? it.why + ' ' : '') + `(id zmienione z "${it.id}" - kolizja z innym presetem)`;
    it.id = id;
    seen.add(id);
  }
  return items;
}

/**
 * PELNA lista pozycji planu.
 * @param {object} opts wynik runner.defaults()
 * @param {object} inst instancja albo null (--list)
 */
function all(opts = { profile: 'standard' }, inst = null) {
  wireAssets();
  const gs = groups();
  const modGroup = (gs.find(g => g.id === 'mods') || gs[0]).id;
  const fromPresets = catalog.presets().flatMap(p =>
    compile.compile(p.manifest, opts, inst, { repo: p.repo })
      .map(item => ({ ...item, source: p.repo })));
  return uniqueIds([...fromPresets, ...modItems(modGroup)]);
}

module.exports = { all, groups, profiles, usingPreset, FALLBACK_GROUPS };
