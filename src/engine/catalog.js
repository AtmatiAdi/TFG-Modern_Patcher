'use strict';
// Katalog: REPOZYTORIA -> konkretne pliki na dysku.
//
// Rozdzial obowiazkow, ktory trzyma cala reszte silnika prosta: SIEC dzieje sie
// TYLKO tutaj i tylko na zadanie (refresh). Plan i jego wykonanie pracuja juz
// wylacznie na plikach z cache, wiec pozostaja synchroniczne i dzialaja bez sieci.
//
// Aplikacja nie zna ANI JEDNEGO moda i ANI JEDNEJ optymalizacji na sztywno.
// Zna repozytoria (sources.json) i dwie konwencje wydan:
//   mody    - tag <mod>-<x.y.z>, zalacznik .jar
//   configi - zalacznik preset-*.json (manifest, docs/PRESET-FORMAT.md)

const fs = require('fs');
const path = require('path');
const release = require('./release');
const discover = require('./discover');
const preset = require('./preset');

let sourcesCache = null;
let resolvedMods = [];
let resolvedPresets = [];
let lastRefresh = null;

// ------------------------------------------------------------------- zrodla

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

/** Plik uzytkownika - wlasne repozytoria bez ruszania aplikacji. */
function userSourcesFile() {
  return path.join(path.dirname(release.cacheDir()), 'sources.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Zrodla wbudowane + dopisane przez uzytkownika. Powtorzone repozytorium liczy sie raz -
 * inaczej ten sam mod pojawilby sie w planie dwa razy.
 */
function sources() {
  if (sourcesCache) return sourcesCache;

  const builtin = readJson(sourcesFile());
  const user = fs.existsSync(userSourcesFile()) ? readJson(userSourcesFile()) : null;

  const out = { mods: [], configs: [], error: null, userFile: user ? userSourcesFile() : null };
  if (!builtin) out.error = 'nie da sie wczytac ' + sourcesFile();

  for (const part of [builtin, user]) {
    if (!part) continue;
    for (const kind of ['mods', 'configs']) {
      for (const src of Array.isArray(part[kind]) ? part[kind] : []) {
        if (!src || !src.repo) continue;
        if (out[kind].some(s => s.repo.toLowerCase() === String(src.repo).toLowerCase())) continue;
        out[kind].push(src);
      }
    }
  }
  sourcesCache = out;
  return sourcesCache;
}

// -------------------------------------------------------------------- cache

function statePath() {
  return path.join(release.cacheDir(), 'catalog.json');
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify({
      refreshed: new Date().toISOString(),
      mods: resolvedMods,
      presets: resolvedPresets.map(p => ({ repo: p.repo, tag: p.tag, file: p.file,
                                           assets: p.assets || [] })),
    }, null, 2));
  } catch { /* cache jest wygoda, nie warunkiem dzialania */ }
}

/**
 * Odtwarza katalog z dysku, bez ruchu w sieci. Wywolywane przy starcie, zeby plan
 * dalo sie pokazac natychmiast i zeby aplikacja dzialala offline.
 */
function loadCached() {
  const state = readJson(statePath()) || {};

  resolvedMods = (Array.isArray(state.mods) ? state.mods : [])
    .filter(m => (m.files || []).every(f => fs.existsSync(f)))
    .map(m => ({ ...m, from: 'cache' }));

  resolvedPresets = [];
  for (const entry of Array.isArray(state.presets) ? state.presets : []) {
    if (!entry.file || !fs.existsSync(entry.file)) continue;
    const parsed = preset.load(entry.file);
    if (parsed.ok) {
      resolvedPresets.push({
        ...entry,
        assets: (entry.assets || []).filter(f => fs.existsSync(f)),
        manifest: parsed.manifest,
        from: 'cache',
      });
    }
  }
  return { mods: resolvedMods, presets: resolvedPresets };
}

// ------------------------------------------------------------------ odswiezenie

/** Jedno zrodlo modow: lista wydan -> mody -> pliki w cache. */
async function refreshModRepo(src, log) {
  const releases = await release.listReleases(src.repo, log);
  const found = discover.mods(releases, {
    prerelease: Boolean(src.prerelease),
    only: src.only || null,
    except: src.except || null,
  });

  log(`  ${src.label || src.repo}: ${releases.length} wydan -> ${found.mods.length} modow`);
  for (const s of found.skipped.slice(0, 5)) log(`      pominieto ${s}`);
  if (found.skipped.length > 5) log(`      ...oraz ${found.skipped.length - 5} innych`);

  const out = [];
  for (const mod of found.mods) {
    const files = [];
    for (const asset of mod.assets) {
      files.push(await release.fetchAsset(src.repo, mod.tag, asset, log));
    }
    out.push({
      id: mod.id,
      name: (src.mods && src.mods[mod.id] && src.mods[mod.id].name) || mod.id,
      version: mod.version,
      tag: mod.tag,
      repo: src.repo,
      sourceLabel: src.label || src.repo,
      side: (src.mods && src.mods[mod.id] && src.mods[mod.id].side) || src.side || 'both',
      why: (src.mods && src.mods[mod.id] && src.mods[mod.id].why) || mod.notes || null,
      replaceGlob: mod.replaceGlob,
      files,
      names: mod.assets.map(a => a.name),
      from: 'release',
    });
    log(`      ${mod.id} ${mod.version} (${mod.assets.map(a => a.name).join(', ')})`);
  }
  return out;
}

/** Jedno zrodlo configow: najnowsze wydanie z preset-*.json -> zwalidowany manifest. */
async function refreshConfigRepo(src, log) {
  const releases = await release.listReleases(src.repo, log);
  const hit = discover.presetRelease(releases);
  if (!hit) {
    // Repozytorium bez wydan to normalny stan swiezego repo, nie awaria.
    log(`  ${src.label || src.repo}: brak wydania z zalacznikiem preset-*.json`);
    return null;
  }

  const file = await release.fetchAsset(src.repo, hit.release.tag, hit.asset, log);
  const parsed = preset.load(file);
  if (!parsed.ok) {
    // Uszkodzony preset odrzucamy W CALOSCI - lepiej pokazac blad, niz wykonac polowe.
    log(`  ${src.label || src.repo}: preset ${hit.release.tag} ODRZUCONY`);
    for (const e of parsed.errors.slice(0, 6)) log(`      ${e}`);
    return null;
  }
  log(`  ${src.label || src.repo}: preset ${parsed.manifest.name} ${parsed.manifest.version}`
    + ` (${(parsed.manifest.items || []).length} pozycji)`);

  const assets = await fetchPresetAssets(src.repo, hit.release, parsed.manifest, log);
  return { repo: src.repo, tag: hit.release.tag, file, assets,
           manifest: parsed.manifest, from: 'release' };
}

function globToRe(glob) {
  return new RegExp('^' + String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

/** Podstawienie samych zmiennych presetu - nazwy zalacznikow ich uzywaja ({shaderpack}). */
function substVars(text, manifest) {
  return String(text).replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (whole, name) => {
    const v = (manifest.vars || {})[name];
    if (v === undefined) return whole;
    return Array.isArray(v) ? v.join(' ') : String(v);
  });
}

/**
 * Pliki, na ktore wskazuje manifest: zalaczniki TEGO wydania (installAsset) oraz
 * wydania cudzych repozytoriow (installRelease). Sciagamy tylko to, czego preset
 * naprawde uzywa - nie cale wydanie.
 */
async function fetchPresetAssets(repo, rel, manifest, log) {
  const files = [];
  const ops = (manifest.items || []).flatMap(i => i.changes || []);

  for (const op of ops.filter(o => o.op === 'installAsset')) {
    const mask = substVars(op.asset, manifest);
    const asset = (rel.assets || []).find(a => globToRe(mask).test(a.name));
    if (!asset) { log(`      brak zalacznika "${mask}" w wydaniu ${rel.tag}`); continue; }
    try {
      files.push(await release.fetchAsset(repo, rel.tag, asset, log));
    } catch (e) {
      log(`      ${asset.name}: ${e.message}`);
    }
  }

  for (const op of ops.filter(o => o.op === 'installRelease')) {
    const mask = substVars(op.asset, manifest);
    try {
      const other = await release.findRelease(op.repo, mask);
      const asset = release.pickAsset(other, mask);
      files.push(await release.fetchAsset(op.repo, other.tag, asset, log));
    } catch (e) {
      log(`      ${op.repo} (${mask}): ${e.message}`);
    }
  }
  return files;
}

/**
 * Odpytuje kazde zrodlo i dociaga brakujace pliki.
 * Bledy sa lokalne: zrodlo, ktore nie odpowiedzialo, zostaje przy wersji z cache,
 * a reszta katalogu dziala normalnie.
 */
async function refresh(log = () => {}) {
  const src = sources();
  if (src.error) log('BLAD sources.json: ' + src.error);
  if (src.userFile) log('Zrodla uzytkownika: ' + src.userFile);

  const before = { mods: resolvedMods, presets: resolvedPresets };
  if (!src.mods.length && !src.configs.length) {
    log('sources.json nie wymienia zadnych repozytoriow.');
    resolvedMods = [];
    resolvedPresets = [];
    return { mods: resolvedMods, presets: resolvedPresets };
  }

  log(`Sprawdzam repozytoria (${src.mods.length} z modami, ${src.configs.length} z configami)`
    + `${release.token() ? ' [token]' : ''}...`);

  const mods = [];
  for (const s of src.mods) {
    try {
      mods.push(...await refreshModRepo(s, log));
    } catch (e) {
      const kept = before.mods.filter(m => m.repo === s.repo);
      mods.push(...kept.map(m => ({ ...m, from: 'cache', error: e.message })));
      log(`  ${s.label || s.repo}: ${e.message}`
        + (kept.length ? ` - zostaje ${kept.length} z cache` : ' - BRAK modow'));
    }
  }

  const presets = [];
  for (const s of src.configs) {
    try {
      const hit = await refreshConfigRepo(s, log);
      if (hit) presets.push(hit);
      else {
        const kept = before.presets.find(p => p.repo === s.repo);
        if (kept) presets.push(kept);
      }
    } catch (e) {
      const kept = before.presets.find(p => p.repo === s.repo);
      if (kept) presets.push({ ...kept, from: 'cache', error: e.message });
      log(`  ${s.label || s.repo}: ${e.message}`
        + (kept ? ' - zostaje preset z cache' : ' - BRAK presetu'));
    }
  }

  resolvedMods = mods;
  resolvedPresets = presets;
  lastRefresh = new Date();
  saveState();

  if (!presets.length) {
    log('Nie ma zadnego presetu - plan pokaze same mody.');
  }
  return { mods: resolvedMods, presets: resolvedPresets };
}

function resolved()   { return resolvedMods; }
function presets()    { return resolvedPresets; }
function refreshedAt() { return lastRefresh; }

module.exports = { sources, sourcesFile, userSourcesFile, loadCached, refresh,
                   resolved, presets, refreshedAt };
