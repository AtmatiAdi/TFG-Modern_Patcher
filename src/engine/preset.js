'use strict';
// Manifest presetu (configi) - wczytanie i WALIDACJA.
//
// Manifest przychodzi z sieci, wiec jest sprawdzany zanim cokolwiek z niego wyniknie.
// Preset, ktory nie przechodzi, jest odrzucany W CALOSCI: lepiej pokazac "preset
// uszkodzony" niz wykonac polowe planu. Blad jest lokalny - pozostale zrodla dzialaja.
//
// Format i slownik operacji: docs/PRESET-FORMAT.md (kopia w repozytorium configow).

const fs = require('fs');

const FORMAT = 1;
const OPS = ['setKey', 'setJson', 'installAsset', 'installRelease', 'removePath', 'disableMods', 'enableMods'];
const STYLES = ['toml', 'properties', 'options', 'ini'];
const SIDES = ['client', 'server', 'both'];
const BUILTIN_VARS = ['instanceDir', 'gameDir', 'toolsDir', 'profile'];
const PATH_PREFIXES = ['@instance/', '@tools/'];

/** Wszystkie {nazwy} w napisie; "{{" to klamra literalna. */
function varsIn(text) {
  const out = [];
  const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  let m;
  while ((m = re.exec(String(text).replace(/\{\{/g, ''))) !== null) out.push(m[1]);
  return out;
}

/** Rekurencyjnie kazdy napis w strukturze, z pominieciem komentarzy "_". */
function strings(node, where, hit) {
  if (typeof node === 'string') return hit(node, where);
  if (Array.isArray(node)) return node.forEach((v, i) => strings(v, `${where}[${i}]`, hit));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '_' || k.startsWith('_')) continue;
      strings(v, `${where}.${k}`, hit);
    }
  }
}

/**
 * Sciezka MUSI zostac wewnatrz instancji. Sprawdzane tutaj i ponownie przy wykonaniu -
 * to jest granica zaufania miedzy cudzym plikiem z internetu a dyskiem uzytkownika.
 */
function badPath(value) {
  let p = String(value);
  for (const prefix of PATH_PREFIXES) {
    if (p.startsWith(prefix)) { p = p.slice(prefix.length); break; }
  }
  if (p.startsWith('@')) return `nieznany przedrostek sciezki w "${value}"`;
  if (/^[a-zA-Z]:/.test(p) || p.startsWith('/') || p.startsWith('\\')) {
    return `sciezka bezwzgledna jest zabroniona: "${value}"`;
  }
  if (p.split(/[\\/]/).includes('..')) {
    return `wyjscie poza katalog instancji jest zabronione: "${value}"`;
  }
  return null;
}

/** Lista operacji - ta sama dla "changes" i "undo". */
function validateOps(list, where, err) {
  for (const [j, c] of list.entries()) {
    const cw = `${where}[${j}]`;
    if (!c || !OPS.includes(c.op)) { err(cw, `nieznana operacja "${c && c.op}"`); continue; }

    if (c.op === 'setKey' || c.op === 'setJson') {
      if (!c.file) err(cw, 'brak "file"');
      else { const bad = badPath(c.file); if (bad) err(cw, bad); }
      if (!c.key) err(cw, 'brak "key"');
      if (typeof c.value !== 'string') err(cw, '"value" musi byc napisem');
      if (c.op === 'setKey' && !STYLES.includes(c.style)) err(cw, `zly "style" (${STYLES.join('/')})`);
    }
    if (c.op === 'installAsset' || c.op === 'installRelease') {
      if (!c.asset) err(cw, 'brak "asset"');
      if (!c.target) err(cw, 'brak "target"');
      else { const bad = badPath(c.target); if (bad) err(cw, bad); }
      if (c.op === 'installRelease' && !/^[\w.-]+\/[\w.-]+$/.test(c.repo || '')) {
        err(cw, '"repo" ma miec postac wlasciciel/repozytorium');
      }
      if (c.unpack !== undefined && c.unpack !== null && c.unpack !== 'zip') {
        err(cw, '"unpack" moze byc tylko "zip"');
      }
    }
    if (c.op === 'removePath') {
      if (!c.target) err(cw, 'brak "target"');
      else {
        const bad = badPath(c.target);
        if (bad) err(cw, bad);
        // Katalog glowny (instancji, gry, narzedzi) nie jest celem usuniecia.
        else if (/^(@instance\/?|@tools\/?|\.?\/?)$/.test(c.target)) err(cw, `"target" wskazuje katalog glowny: "${c.target}"`);
      }
    }
    if (c.op === 'disableMods' || c.op === 'enableMods') {
      if (!Array.isArray(c.prefixes) || !c.prefixes.length) err(cw, 'brak "prefixes"');
    }
    if (c.op === 'disableMods') {
      if (!c.scan || !Array.isArray(c.scan.tokens) || !c.scan.tokens.length) {
        err(cw, '"scan.tokens" jest OBOWIAZKOWY - mods.toml nie wystarcza');
      }
    }
  }
}

function validate(m) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);

  if (!m || typeof m !== 'object') return ['preset: to nie jest obiekt JSON'];
  if (m.formatVersion !== FORMAT) {
    return [`preset: formatVersion ${JSON.stringify(m.formatVersion)}, obslugiwany ${FORMAT}`
      + (Number(m.formatVersion) > FORMAT ? ' - zaktualizuj Patcher' : '')];
  }
  for (const f of ['id', 'name', 'version']) {
    if (!m[f] || typeof m[f] !== 'string') err('preset', `brak pola "${f}"`);
  }

  const groupIds = new Set();
  for (const [i, g] of (Array.isArray(m.groups) ? m.groups : []).entries()) {
    if (!g.id || !g.label) err(`groups[${i}]`, 'brak "id" albo "label"');
    if (groupIds.has(g.id)) err(`groups[${i}]`, `powtorzone id grupy "${g.id}"`);
    groupIds.add(g.id);
  }
  if (!groupIds.size) err('preset', 'brak grup');

  const profileIds = new Set();
  const profileVars = new Set();
  let defaults = 0;
  for (const [i, p] of (Array.isArray(m.profiles) ? m.profiles : []).entries()) {
    if (!p.id || !p.label) err(`profiles[${i}]`, 'brak "id" albo "label"');
    if (profileIds.has(p.id)) err(`profiles[${i}]`, `powtorzone id profilu "${p.id}"`);
    profileIds.add(p.id);
    if (p.default === true) defaults++;
    if (p.side && !SIDES.includes(p.side)) err(`profiles[${i}]`, 'zle "side"');
    for (const k of Object.keys(p.vars || {})) profileVars.add(k);
  }
  // Profile sa OPCJONALNE i celowo: preset dokladajacy same pliki (kubejs, configi
  // jednego autora) nie ma czego profilowac, a profile i tak sa wspolne dla calego
  // planu - narzuca je preset, ktory je przynosi.
  if (profileIds.size && defaults !== 1) {
    err('profiles', `dokladnie jeden profil ma miec "default": true (jest ${defaults})`);
  }

  const known = new Set([
    ...Object.keys(m.vars || {}).filter(k => !k.startsWith('_')),
    ...profileVars,
    ...BUILTIN_VARS,
  ]);

  const itemIds = new Set();
  for (const [i, item] of (Array.isArray(m.items) ? m.items : []).entries()) {
    const w = `items[${i}]${item.id ? ` (${item.id})` : ''}`;
    for (const f of ['id', 'group', 'side', 'title']) {
      if (!item[f] || typeof item[f] !== 'string') err(w, `brak pola "${f}"`);
    }
    if (itemIds.has(item.id)) err(w, `powtorzone id pozycji "${item.id}"`);
    itemIds.add(item.id);
    if (item.group && !groupIds.has(item.group)) err(w, `nieznana grupa "${item.group}"`);
    if (item.side && !SIDES.includes(item.side)) err(w, 'zle "side"');

    if (item.selected !== undefined && typeof item.selected !== 'boolean') {
      if (!item.selected || typeof item.selected !== 'object' || Array.isArray(item.selected)) {
        err(w, '"selected" musi byc true/false albo obiektem {profil: bool}');
      } else {
        for (const [key, value] of Object.entries(item.selected)) {
          // Nazwy profili sprawdzamy tylko wtedy, gdy TEN preset je definiuje.
          // Preset bez profili moze sie odwolac do cudzych (np. "server": false).
          if (profileIds.size && key !== '*' && !profileIds.has(key)) {
            err(w, `"selected" wskazuje nieznany profil "${key}"`);
          }
          if (typeof value !== 'boolean') err(w, `"selected.${key}" musi byc true albo false`);
        }
      }
    }

    if (!Array.isArray(item.changes) || !item.changes.length) { err(w, 'brak "changes"'); continue; }
    validateOps(item.changes, `${w}.changes`, err);
    // "undo" jest opcjonalne: opis stanu "wylaczony" pozycji (PRESET-FORMAT.md par. 6).
    if (item.undo !== undefined) {
      if (!Array.isArray(item.undo) || !item.undo.length) err(w, '"undo" ma byc niepusta lista operacji');
      else validateOps(item.undo, `${w}.undo`, err);
    }
  }
  if (!itemIds.size) err('preset', 'brak "items"');

  strings(m.items || [], 'items', (text, where) => {
    for (const name of varsIn(text)) if (!known.has(name)) err(where, `nieznana zmienna {${name}}`);
  });

  return errors;
}

/** @returns {{ok:boolean, manifest?:object, errors:string[]}} */
function load(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, errors: ['nie da sie wczytac manifestu: ' + e.message] };
  }
  const errors = validate(raw);
  return errors.length ? { ok: false, errors } : { ok: true, manifest: raw, errors: [] };
}

module.exports = { load, validate, varsIn, badPath, FORMAT };
