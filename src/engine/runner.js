'use strict';
// Budowa planu i jego wykonanie. Wspolne dla UI i dla CLI.

const { Journal } = require('./journal');
const patches = require('./patches');

/**
 * Profile sa DANYMI presetu: aplikacja zna tylko POJECIE profilu (selektor w oknie,
 * wykrycie serwera, reczne nadpisanie galek), a nazwy i wartosci przychodza
 * z presetu.
 *
 * To jest jedyny profil wbudowany i celowo nie niesie zadnej wartosci optymalizacyjnej -
 * istnieje po to, zeby okno mialo co pokazac, zanim jakikolwiek preset zostanie pobrany.
 */
const FALLBACK_PROFILES = {
  standard: { id: 'standard', label: 'Standard', default: true,
              description: 'bez presetu - same mody z repozytoriow' },
};

function profiles() {
  return patches.profiles() || FALLBACK_PROFILES;
}

function defaultProfileId() {
  const all = profiles();
  const marked = Object.values(all).find(p => p.default);
  return (marked || Object.values(all)[0]).id;
}

function defaults(profileId) {
  const all = profiles();
  const profile = all[profileId] || all[defaultProfileId()];
  // renderDistance i xmx to zmienne PROFILU z presetu - bez presetu nie mamy ich skad
  // wziac i nie zmyslamy. Pola liczbowe w oknie zostaja wtedy przy tym, co pokazuja.
  return {
    profile: profile.id,
    renderDistance: profile.renderDistance,
    xmx: profile.xmx,
    scan: true,
    force: false,
  };
}

function appliesTo(side, target) { return side === 'both' || side === target; }

/** Zbiorczy stan pozycji na podstawie stanow jej operacji. */
function overall(statuses) {
  if (statuses.some(s => s.state === 'error')) return 'error';
  if (statuses.some(s => s.state === 'todo')) return 'todo';
  if (statuses.some(s => s.state === 'ok')) return 'ok';
  return 'missing';
}

/**
 * Kazda pozycja ma DWA stany: "on" (changes) i - gdy preset go opisal - "off" (undo).
 * Plan liczy oba, bo okno pokazuje ten, ktory uzytkownik wybral, a przelaczenie
 * trybu nie moze wymagac ponownego liczenia planu.
 *
 * @returns {{id,title,doc,why,side,state,mode,canUndo,selected,skipReason,statuses,details,
 *            undoState,undoStatuses,undoDetails}[]}
 */
function plan(inst, opts) {
  return patches.all(opts, inst).map(patch => {
    const item = {
      id: patch.id, title: patch.title, doc: patch.doc, why: patch.why, side: patch.side,
      group: patch.group || 'optimizations',
      // Tryb domyslny z presetu: on / off / skip (compile.defaultMode). "selected"
      // zostaje dla zgodnosci - to samo, co mode === 'on'.
      mode: patch.mode || (patch.selected !== false ? 'on' : 'skip'),
      canUndo: Boolean(patch.undo),
      selected: patch.selected !== false,
      skipReason: null, statuses: [], details: patch.changes.map(c => c.describe(opts)),
      undoState: null, undoStatuses: [], undoDetails: (patch.undo || []).map(c => c.describe(opts)),
    };
    if (patch.broken) {
      item.statuses = [{ state: 'error', text: patch.broken }];
    } else if (!appliesTo(patch.side, inst.side)) {
      item.skipReason = 'dotyczy tylko strony: ' + patch.side;
    } else {
      item.statuses = patch.changes.map(c => c.check(inst, opts));
      if (patch.undo) item.undoStatuses = patch.undo.map(c => c.check(inst, opts));
    }
    item.state = item.skipReason ? 'skipped' : overall(item.statuses);
    if (patch.undo) item.undoState = item.skipReason ? 'skipped' : overall(item.undoStatuses);
    return item;
  });
}

/** Wybor do wykonania: lista id (wszystko "on") albo {on:[...], off:[...]}. */
function selection(ids) {
  if (Array.isArray(ids)) return { on: ids, off: [] };
  return { on: (ids && ids.on) || [], off: (ids && ids.off) || [] };
}

/**
 * Wykonuje wybrane pozycje (po id). Stan kazdej operacji sprawdzamy PONOWNIE tuz
 * przed wykonaniem, bo wczesniejsze latki moga utworzyc pliki, ktorych w chwili
 * budowania planu jeszcze nie bylo (shaderpack -> plik ustawien shaderow).
 *
 * @param {string[]|{on:string[], off:string[]}} ids "off" = wykonanie "undo" pozycji
 */
function apply(inst, opts, ids, log = () => {}) {
  const journal = new Journal(inst.root);
  const pick = selection(ids);
  let applied = 0, failed = 0, skipped = 0;

  for (const patch of patches.all(opts, inst)) {
    const off = pick.off.includes(patch.id);
    if (!off && !pick.on.includes(patch.id)) continue;
    if (!appliesTo(patch.side, inst.side)) { skipped++; continue; }
    if (patch.broken) { log(`* ${patch.id} - POMINIETE: ${patch.broken}`); failed++; continue; }
    if (off && !patch.undo) { log(`* ${patch.id} - POMINIETE: preset nie opisuje, jak te pozycje wycofac`); failed++; continue; }

    const changes = off ? patch.undo : patch.changes;
    const fresh = changes.map(c => c.check(inst, opts));
    if (!fresh.some(s => s.state === 'todo')) { skipped++; continue; }

    log(`* ${patch.id} - ${patch.title}${off ? ' [WYCOFANIE]' : ''}`);
    let any = false;
    changes.forEach((change, i) => {
      if (fresh[i].state !== 'todo') {
        if (fresh[i].state !== 'ok') log('    pomijam: ' + fresh[i].text);
        return;
      }
      try {
        change.apply(inst, opts, journal, log);
        any = true;
      } catch (e) {
        log('    BLAD: ' + e.message);
        failed++;
      }
    });
    if (any) applied++;
  }

  const journalFile = journal.flush();
  return { applied, failed, skipped, journal: journalFile };
}

module.exports = { profiles, defaults, defaultProfileId, plan, apply, FALLBACK_PROFILES };
