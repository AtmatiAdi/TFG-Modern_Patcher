'use strict';
// Lista pozycji planu. Aplikacja NIE ZNA ani jednej optymalizacji i ani jednego moda -
// jedno i drugie czyta z wydan repozytoriow wymienionych w sources.json:
//
//  1. PRESET z repozytorium configow - optymalizacje, profile, shaderpack, narzedzia.
//     Manifest jest DANYMI (docs/PRESET-FORMAT.md), zamienia go na operacje compile.js.
//  2. MODY wykryte w repozytoriach po tagach wydan (discover.js).
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
    preset: mask => {
      for (const p of catalog.presets()) {
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

/** Profile: z presetow. null = zadne repozytorium configow nie dostarczylo profili. */
function profiles() {
  const fromPresets = compile.profilesFrom(manifests());
  return Object.keys(fromPresets).length ? fromPresets : null;
}

function usingPreset() {
  return manifests().length > 0;
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
  const fromPresets = manifests().flatMap(m => compile.compile(m, opts, inst));
  return [...fromPresets, ...modItems(modGroup)];
}

module.exports = { all, groups, profiles, usingPreset, FALLBACK_GROUPS };
