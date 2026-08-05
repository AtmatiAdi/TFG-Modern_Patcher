'use strict';
// Katalog modow: sources.json -> konkretne pliki na dysku.
//
// Rozdzial obowiazkow, ktory trzyma cala reszte silnika prosta: SIEC dzieje sie
// TYLKO tutaj i tylko na zadanie (refresh). Plan i jego wykonanie pracuja juz
// wylacznie na plikach z cache, wiec pozostaja synchroniczne i dzialaja bez sieci.

const fs = require('fs');
const path = require('path');
const release = require('./release');

let sourcesCache = null;
let resolvedMods = [];
let lastRefresh = null;

/** sources.json lezy obok aplikacji; w wersji spakowanej w resources. */
function sourcesFile() {
  const candidates = [
    process.env.TFG_SOURCES_FILE,
    process.resourcesPath ? path.join(process.resourcesPath, 'sources.json') : null,
    path.join(__dirname, '..', '..', 'sources.json'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[candidates.length - 1];
}

function sources() {
  if (sourcesCache) return sourcesCache;
  try {
    sourcesCache = JSON.parse(fs.readFileSync(sourcesFile(), 'utf8'));
  } catch (e) {
    sourcesCache = { mods: [], error: e.message };
  }
  if (!Array.isArray(sourcesCache.mods)) sourcesCache.mods = [];
  return sourcesCache;
}

/** Zapamietany wynik ostatniego rozwiazania - lezy obok cache plikow. */
function statePath() {
  return path.join(release.cacheDir(), 'catalog.json');
}

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return Array.isArray(state.mods) ? state : { mods: [] };
  } catch {
    return { mods: [] };
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify({
      refreshed: new Date().toISOString(),
      mods: resolvedMods,
    }, null, 2));
  } catch { /* cache jest wygoda, nie warunkiem dzialania */ }
}

/**
 * Odtwarza katalog z dysku, bez ruchu w sieci. Wywolywane przy starcie, zeby plan
 * dalo sie pokazac natychmiast i zeby aplikacja dzialala offline.
 */
function loadCached() {
  const state = loadState();
  const known = new Map(state.mods.map(m => [m.id, m]));
  resolvedMods = sources().mods.map(src => {
    const prev = known.get(src.id);
    if (prev && prev.file && fs.existsSync(prev.file)) {
      return { ...src, ...prev, from: 'cache' };
    }
    const cached = release.newestCached(src.repo, src.asset);
    if (cached) {
      return { ...src, tag: cached.tag, assetName: cached.name, file: cached.file, from: 'cache' };
    }
    return { ...src, file: null, from: 'brak', error: 'nie pobrano jeszcze zadnego wydania' };
  });
  return resolvedMods;
}

/**
 * Odpytuje kazde zrodlo o najnowsze wydanie i dociaga brakujace pliki.
 * Bledy sa lokalne: zrodlo, ktore nie odpowiedzialo, zostaje przy wersji z cache,
 * a reszta katalogu dziala normalnie.
 */
async function refresh(log = () => {}) {
  const list = sources().mods;
  if (sources().error) {
    log('BLAD sources.json: ' + sources().error);
  }
  if (!list.length) {
    log('sources.json nie wymienia zadnych modow.');
    resolvedMods = [];
    return resolvedMods;
  }
  log(`Sprawdzam wydania (${list.length} zrodel)${release.token() ? ' [token]' : ''}...`);

  const out = [];
  for (const src of list) {
    try {
      const rel = await release.findRelease(src.repo, src.asset);
      const asset = release.pickAsset(rel, src.asset);
      const file = await release.fetchAsset(src.repo, rel.tag, asset, log);
      out.push({ ...src, tag: rel.tag, assetName: asset.name, file, size: asset.size, from: 'release' });
      log(`  ${src.name}: ${rel.tag} (${asset.name})`);
    } catch (e) {
      const cached = release.newestCached(src.repo, src.asset);
      if (cached) {
        out.push({ ...src, tag: cached.tag, assetName: cached.name, file: cached.file,
                   from: 'cache', error: e.message });
        log(`  ${src.name}: ${e.message} - zostaje wersja z cache (${cached.tag})`);
      } else {
        out.push({ ...src, file: null, from: 'brak', error: e.message });
        log(`  ${src.name}: ${e.message} - BRAK pliku`);
      }
    }
  }
  resolvedMods = out;
  lastRefresh = new Date();
  saveState();
  return resolvedMods;
}

function resolved() {
  return resolvedMods;
}

function refreshedAt() {
  return lastRefresh;
}

module.exports = { sources, sourcesFile, loadCached, refresh, resolved, refreshedAt };
