'use strict';
// Budowa planu i jego wykonanie. Wspolne dla UI i dla CLI.

const { Journal } = require('./journal');
const patches = require('./patches');

const PROFILES = {
  standard: { id: 'standard', renderDistance: 8,  xmx: 6144, label: 'Standard',
              description: 'nasz standard: renderDistance 8, Xmx 6 GB' },
  high:     { id: 'high',     renderDistance: 24, xmx: 8192, label: 'High',
              description: 'mocne GPU i zapas RAM: renderDistance 24, Xmx 8 GB' },
  server:   { id: 'server',   renderDistance: 0,  xmx: 6144, label: 'Serwer',
              description: 'serwer dedykowany: tylko zmiany serwerowe' },
};

function defaults(profileId = 'standard') {
  const profile = PROFILES[profileId] || PROFILES.standard;
  return {
    profile: profile.id,
    renderDistance: profile.renderDistance || 8,
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
 * @returns {{id,title,doc,why,side,state,skipReason,statuses,details}[]}
 */
function plan(inst, opts) {
  return patches.all().map(patch => {
    const item = {
      id: patch.id, title: patch.title, doc: patch.doc, why: patch.why, side: patch.side,
      group: patch.group || 'optimizations',
      skipReason: null, statuses: [], details: patch.changes.map(c => c.describe(opts)),
    };
    if (!appliesTo(patch.side, inst.side)) {
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

  for (const patch of patches.all()) {
    if (!ids.includes(patch.id)) continue;
    if (!appliesTo(patch.side, inst.side)) { skipped++; continue; }

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

module.exports = { PROFILES, defaults, plan, apply };
