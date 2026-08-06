'use strict';
// Manifest presetu -> pozycje planu.
//
// Tu konczy sie "dane z internetu", a zaczyna dokladnie ten sam mechanizm, co dawniej:
// operacje z changes.js (setKey, setJson, installFile, disableMods). Zmienia sie
// ZRODLO listy, nie sposob jej wykonywania - dlatego plan wyglada tak samo.

const path = require('path');
const { STYLES } = require('./textconfig');
const { setKey, setJson, installFile, installArchive, disableMods, fileResource } = require('./changes');
const preset = require('./preset');

/** Katalog narzedzi w instancji - tam laduje wszystko z grupy "tools". */
function toolsDir(inst) {
  return path.join(inst.root, '.tfg-patcher', 'tools');
}

/**
 * Sciezka z manifestu -> sciezka na dysku. Przedrostki:
 *   @instance/...  katalog instancji (instance.cfg)
 *   @tools/...     .tfg-patcher/tools
 *   reszta         katalog gry (minecraft/)
 */
function resolveTarget(inst, rel) {
  const clean = String(rel).split('/').join(path.sep);
  let base = inst.gameDir;
  let tail = clean;
  if (clean.startsWith('@instance' + path.sep)) {
    base = inst.root; tail = clean.slice(('@instance' + path.sep).length);
  } else if (clean.startsWith('@tools' + path.sep)) {
    base = toolsDir(inst); tail = clean.slice(('@tools' + path.sep).length);
  }
  const full = path.resolve(base, tail);

  // Granica zaufania, tym razem po rozwinieciu sciezki: manifest przyszedl z sieci,
  // wiec nie wierzymy, ze walidacja napisu wystarczy.
  const root = path.resolve(inst.root);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('sciezka wychodzi poza instancje: ' + rel);
  }
  return full;
}

/**
 * Sciezka z manifestu -> to, co widac w planie. Katalog glowny da sie zapisac na
 * kilka sposobow (".", "@instance/", ""), a kazdy z nich po obcieciu przedrostka
 * zostawialby pusta etykiete albo samotna kropke - czyli linie planu bez informacji.
 */
function pathLabel(rel) {
  const raw = String(rel);
  const clean = raw.replace(/^@(instance|tools)\/?/, '').replace(/^\.\/?/, '');
  if (clean) return clean;
  return raw.startsWith('@instance') ? 'w katalogu instancji'
    : raw.startsWith('@tools') ? 'w katalogu narzedzi'
      : 'w katalogu gry';
}

/** Wartosc zmiennej: lista skleja sie spacjami (dlugie listy flag czyta sie w diffie). */
function varValue(v) {
  return Array.isArray(v) ? v.join(' ') : String(v);
}

function makeVars(manifest, profile, inst, opts) {
  const vars = {};
  for (const [k, v] of Object.entries(manifest.vars || {})) {
    if (!k.startsWith('_')) vars[k] = varValue(v);
  }
  for (const [k, v] of Object.entries((profile && profile.vars) || {})) vars[k] = varValue(v);

  // Reczne nadpisanie galek z okna / CLI (--render-distance, --xmx). Nadpisujemy tylko
  // zmienne, ktore preset FAKTYCZNIE ma - inaczej opcje aplikacji wciekalyby do manifestu.
  for (const k of Object.keys(vars)) {
    const v = opts ? opts[k] : undefined;
    if (v !== undefined && v !== null && v !== '') vars[k] = varValue(v);
  }

  if (inst) {
    vars.instanceDir = inst.root;
    vars.gameDir = inst.gameDir;
    vars.toolsDir = toolsDir(inst);
  }
  vars.profile = (profile && profile.id) || 'standard';
  return vars;
}

/** Podstawienie {nazwa}; "{{" zostaje pojedyncza klamra. */
function subst(text, vars) {
  return String(text).replace(/\{\{|\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (whole, name) => {
    if (whole === '{{') return '{';
    if (vars[name] === undefined) throw new Error(`nieznana zmienna {${name}}`);
    return vars[name];
  });
}

/** Domyslne zaznaczenie pozycji dla danego profilu (patrz PRESET-FORMAT.md par. 6). */
function defaultSelected(item, profileId) {
  const s = item.selected;
  if (s === undefined || s === null) return true;
  if (typeof s === 'boolean') return s;
  if (Object.prototype.hasOwnProperty.call(s, profileId)) return Boolean(s[profileId]);
  if (Object.prototype.hasOwnProperty.call(s, '*')) return Boolean(s['*']);
  return true;
}

function change(op, vars, inst, source) {
  const file = () => i => resolveTarget(i, subst(op.file, vars));
  const label = String(op.file || op.target || '').replace(/^@\w+\//, '');

  if (op.op === 'setKey') {
    return setKey({
      target: file(), label,
      section: op.section || null,
      key: subst(op.key, vars),
      style: STYLES[op.style],
      value: subst(op.value, vars),
      addIfMissing: op.addIfMissing !== false,
    });
  }
  if (op.op === 'setJson') {
    return setJson({ target: file(), label, key: subst(op.key, vars), value: subst(op.value, vars) });
  }
  if (op.op === 'installAsset' || op.op === 'installRelease') {
    const wanted = subst(op.asset, vars);
    const found = op.op === 'installAsset'
      ? presetAssets(wanted, source)
      : releaseAssets(op, wanted);
    const targetRel = subst(op.target, vars);
    const name = found ? path.basename(found) : path.basename(targetRel);

    if (op.unpack === 'zip') {
      return installArchive({
        resource: fileResource(found, found ? null : `nie pobrano zalacznika "${wanted}"`),
        target: i => resolveTarget(i, targetRel),
        label: pathLabel(targetRel),
        onlyIfMissing: Boolean(op.onlyIfMissing),
      });
    }
    return installFile({
      resource: fileResource(found, found ? null : `nie pobrano zalacznika "${wanted}"`),
      target: i => {
        const dest = resolveTarget(i, targetRel);
        return targetRel.endsWith('/') ? path.join(dest, name) : dest;
      },
      label: pathLabel(targetRel),
      replaceGlob: op.replaceGlob ? subst(op.replaceGlob, vars) : null,
      onlyIfMissing: Boolean(op.onlyIfMissing),
    });
  }
  if (op.op === 'disableMods') {
    return disableMods({ prefixes: op.prefixes, scan: op.scan });
  }
  throw new Error('nieznana operacja ' + op.op);
}

// Zalaczniki wydania presetu i cudzych wydan podstawia catalog - tu tylko odczyt.
// "installAsset" pyta o zalacznik WLASNEGO wydania, wiec szuka sie go w repozytorium
// tego presetu, a nie gdziekolwiek - inaczej maska "kubejs.zip" u jednego autora
// trafialaby w plik drugiego.
let assetLookup = { preset: () => null, release: () => null };
function setAssetLookup(lookup) { assetLookup = { ...assetLookup, ...lookup }; }
function presetAssets(wanted, source) { return assetLookup.preset(wanted, source && source.repo); }
function releaseAssets(op, wanted) { return assetLookup.release(op.repo, wanted); }

/**
 * @param {object} manifest zwalidowany manifest
 * @param {object} opts     wynik runner.defaults() - potrzebny profil
 * @param {object} inst     instancja (do rozwiniecia sciezek); moze byc null przy --list
 * @param {object} source   skad ten preset przyszedl ({repo}) - do szukania zalacznikow
 * @returns {Array} pozycje planu w formacie patches.js
 */
function compile(manifest, opts, inst, source = null) {
  const profile = (manifest.profiles || []).find(p => p.id === opts.profile)
    || (manifest.profiles || []).find(p => p.default)
    || (manifest.profiles || [])[0];
  const vars = makeVars(manifest, profile, inst, opts);

  const out = [];
  for (const item of manifest.items || []) {
    try {
      out.push({
        id: item.id,
        group: item.group,
        side: item.side,
        title: subst(item.title, vars),
        doc: item.doc || manifest.docs || manifest.id,
        why: item.why ? subst(item.why, vars) : '',
        selected: defaultSelected(item, (profile && profile.id) || opts.profile),
        changes: item.changes.map(op => change(op, vars, inst, source)),
      });
    } catch (e) {
      // Jedna zla pozycja nie moze wywalic calego planu - pokazujemy ja jako blad.
      out.push({
        id: item.id, group: item.group || 'optimizations', side: item.side || 'both',
        title: item.title || item.id, doc: item.doc || '', why: 'Pozycja odrzucona: ' + e.message,
        selected: false, changes: [], broken: e.message,
      });
    }
  }
  return out;
}

/** Grupy z presetow; przy kilku zrodlach pierwsze wygrywa etykiete. */
function groupsFrom(manifests) {
  const out = [];
  for (const m of manifests) {
    for (const g of m.groups || []) {
      if (!out.some(x => x.id === g.id)) out.push({ ...g });
    }
  }
  return out;
}

/** Profile z presetow: suma po id, pierwsze zrodlo wygrywa etykiete i wartosci. */
function profilesFrom(manifests) {
  const out = {};
  for (const m of manifests) {
    for (const p of m.profiles || []) {
      if (out[p.id]) continue;
      out[p.id] = {
        id: p.id,
        label: p.label,
        description: p.description || '',
        default: Boolean(p.default),
        side: p.side || 'both',
        ...Object.fromEntries(Object.entries(p.vars || {}).map(([k, v]) => [k, v])),
      };
    }
  }
  return out;
}

module.exports = { compile, groupsFrom, profilesFrom, setAssetLookup, resolveTarget, subst };
