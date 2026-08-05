'use strict';
// Budowa planu i jego wykonanie. Wspolne dla UI i dla CLI.

const { Journal } = require('./journal');
const patches = require('./patches');

/**
 * Profile sa DANYMI presetu: aplikacja zna tylko POJECIE profilu (selektor w oknie,
 * wykrycie serwera, reczne nadpisanie galek), a nazwy i wartosci przychodza
 * z repozytorium configow.
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
 * @returns {{id,title,doc,why,side,state,selected,skipReason,statuses,details}[]}
 */
function plan(inst, opts) {
  return patches.all(opts, inst).map(patch => {
    const item = {
      id: patch.id, title: patch.title, doc: patch.doc, why: patch.why, side: patch.side,
      group: patch.group || 'optimizations',
      // Preset moze powiedziec, ze pozycja ma byc widoczna, ale NIEzaznaczona
      // (np. narzedzie RAM w profilu "high"). Domyslnie: zaznaczona.
      selected: patch.selected !== false,
      skipReason: null, statuses: [], details: patch.changes.map(c => c.describe(opts)),
    };
    if (patch.broken) {
      item.statuses = [{ state: 'error', text: patch.broken }];
    } else if (!appliesTo(patch.side, inst.side)) {
      item.skipReason = 'dotyczy tylko strony: ' + patch.side;
    } else {
      item.statuses = patch.changes.map(c => c.check(inst, opts));
    }
    item.state = item.skipReason ? 'skipped' : overall(item.statuses);
    return item;
  });
}

/**
 * Wykonuje wybrane pozycje (po id). Stan kazdej operacji sprawdzamy PONOWNIE tuz
 * przed wykonaniem, bo wczesniejsze latki moga utworzyc pliki, ktorych w chwili
 * budowania planu jeszcze nie bylo (shaderpack -> plik ustawien shaderow).
 */
function apply(inst, opts, ids, log = () => {}) {
  const journal = new Journal(inst.root);
  let applied = 0, failed = 0, skipped = 0;

  for (const patch of patches.all(opts, inst)) {
    if (!ids.includes(patch.id)) continue;
    if (!appliesTo(patch.side, inst.side)) { skipped++; continue; }
    if (patch.broken) { log(`* ${patch.id} - POMINIETE: ${patch.broken}`); failed++; continue; }

    const fresh = patch.changes.map(c => c.check(inst, opts));
    if (!fresh.some(s => s.state === 'todo')) { skipped++; continue; }

    log(`* ${patch.id} - ${patch.title}`);
    let any = false;
    patch.changes.forEach((change, i) => {
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
