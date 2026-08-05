'use strict';
// Tryb konsolowy tego samego silnika - dla serwerow (takze na Linuksie), gdzie
// okno nie ma sensu:  node src/cli.js --instance <sciezka> --apply

const instanceLib = require('./engine/instance');
const runner = require('./engine/runner');
const journal = require('./engine/journal');
const catalog = require('./engine/catalog');
const patches = require('./engine/patches');

function parse(argv) {
  const o = { dir: null, profile: 'standard', apply: false, revert: false, list: false,
              only: null, skip: [], force: false, scan: true, renderDistance: null, xmx: null,
              offline: false, refreshOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '-i' || a === '--instance') o.dir = next();
    else if (a === '-p' || a === '--profile') o.profile = next();
    else if (a === '--apply') o.apply = true;
    else if (a === '--revert') o.revert = true;
    else if (a === '--list') o.list = true;
    else if (a === '--only') o.only = next().split(/[,\s]+/).filter(Boolean);
    else if (a === '--skip') o.skip = next().split(/[,\s]+/).filter(Boolean);
    else if (a === '--force') o.force = true;
    else if (a === '--no-scan') o.scan = false;
    else if (a === '--offline') o.offline = true;
    else if (a === '--refresh') o.refreshOnly = true;
    else if (a === '--render-distance') o.renderDistance = Number(next());
    else if (a === '--xmx') o.xmx = Number(next());
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (!a.startsWith('-')) o.dir = a;
    else { console.log('Nieznana opcja: ' + a); usage(); process.exit(2); }
  }
  return o;
}

function usage() {
  console.log(`TFG Patcher (CLI) - przenosi nasze zmiany na instancje albo serwer.

  node src/cli.js --list
  node src/cli.js -i <sciezka> [-p standard|high|server] [--apply]
  node src/cli.js -i <sciezka> --revert

  node src/cli.js --refresh          (samo pobranie wydan do cache)

  --only id1,id2   --skip id1,id2   --force   --no-scan   --offline
  --render-distance <n>   --xmx <MB>

Bez --apply pokazuje tylko plan. Opis: docs/PATCHER.md`);
}

async function main() {
  const args = parse(process.argv.slice(2));

  // Siec tylko tutaj: dalej silnik pracuje juz na plikach z cache.
  catalog.loadCached();
  if (!args.offline) {
    await catalog.refresh(console.log);
    console.log('');
  }
  if (args.refreshOnly) return 0;

  if (args.list) {
    console.log('TFG Patcher - lista wprowadzanych zmian\n');
    for (const g of patches.GROUPS) {
      const inGroup = patches.all().filter(p => (p.group || 'optimizations') === g.id);
      if (!inGroup.length) continue;
      console.log(`== ${g.label.toUpperCase()} - ${g.description}`);
      for (const p of inGroup) {
        console.log(`${p.id.padEnd(20)} [${p.side}]  ${p.title}`);
        console.log(`  dok: ${p.doc}`);
        for (const c of p.changes) console.log('  - ' + c.describe(runner.defaults()));
      }
      console.log('');
    }
    return 0;
  }

  if (!args.dir) { console.log('Podaj katalog: -i <sciezka>'); usage(); return 2; }
  const inst = instanceLib.detect(args.dir);
  console.log(`Instancja: ${inst.root}  [${inst.kind}]`);

  if (args.revert) {
    const res = journal.revert(inst.root, console.log);
    console.log(res.count < 0 ? 'Nic nie cofnieto.' : 'Cofnieto operacji: ' + res.count);
    return res.count < 0 ? 1 : 0;
  }

  const warnings = instanceLib.warnings(inst);
  warnings.forEach(w => console.log('  UWAGA: ' + w));
  if (warnings.length && !args.force) { console.log('Przerwane. Dodaj --force, jesli wiesz co robisz.'); return 1; }

  const opts = runner.defaults(inst.side === 'server' ? 'server' : args.profile);
  opts.force = args.force;
  opts.scan = args.scan;
  if (args.renderDistance) opts.renderDistance = args.renderDistance;
  if (args.xmx) opts.xmx = args.xmx;
  console.log(`Profil: ${opts.profile} (renderDistance=${opts.renderDistance}, MaxMemAlloc=${opts.xmx})\n`);

  const items = runner.plan(inst, opts);
  const tag = { ok: '[ ZROBIONE]', todo: '[DO ZMIANY]', missing: '[BRAK CELU]', error: '[    BLAD ]', skipped: '[POMINIETE]' };
  const mark = { ok: 'ok  ', todo: '->  ', missing: '--  ', error: '!!  ' };
  let n = 0;
  for (const g of patches.GROUPS) {
    const inGroup = items.filter(i => i.group === g.id);
    if (!inGroup.length) continue;
    console.log(`\n== ${g.label.toUpperCase()}`);
    for (const it of inGroup) {
      n++;
      console.log(`${tag[it.state]} ${String(n).padStart(2)}. ${it.id.padEnd(20)} ${it.title}`);
      if (it.skipReason) console.log(`               (${it.skipReason})`);
      else it.statuses.forEach(s => console.log(`               ${mark[s.state]}${s.text}`));
    }
  }

  let ids = items.filter(i => i.state === 'todo').map(i => i.id);
  if (args.only) ids = ids.filter(id => args.only.includes(id));
  if (args.skip.length) ids = ids.filter(id => !args.skip.includes(id));

  if (!args.apply) { console.log('\n(plan - dodaj --apply, zeby zastosowac)'); return 0; }
  if (!ids.length) { console.log('\nNic do zrobienia.'); return 0; }

  console.log('\nStosuje zmiany:');
  const res = runner.apply(inst, opts, ids, console.log);
  console.log(`\nGotowe: zalatanych ${res.applied}, bledow ${res.failed}, pominietych ${res.skipped}.`);
  if (res.journal) console.log('Dziennik i kopie: ' + res.journal);
  return res.failed ? 1 : 0;
}

main().then(code => process.exit(code), e => {
  console.log('BLAD: ' + e.message);
  process.exit(2);
});
