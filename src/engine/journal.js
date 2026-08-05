'use strict';
// Kopie zapasowe + dziennik operacji => kazda aplikacja latki jest odwracalna.
// Wszystko trafia do .tfg-patcher/ w katalogu instancji.
//
// Format (TAB, sciezki wzgledem katalogu instancji):
//   BACKUP  config/foo.toml   backup-2026-07-25_1200/config/foo.toml
//   DELETE  mods/stary.jar    backup-.../mods/stary.jar
//   RENAME  mods/x.jar        mods/x.jar.disabled
//   ADD     mods/mapatlas-0.1.0.jar

const fs = require('fs');
const path = require('path');

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

class Journal {
  constructor(root) {
    this.root = root;
    const s = stamp();
    this.dir = path.join(root, '.tfg-patcher');
    this.backupDir = path.join(this.dir, 'backup-' + s);
    this.file = path.join(this.dir, `journal-${s}.txt`);
    this.entries = [];
    this.backedUp = new Set();
  }

  rel(p) {
    const r = path.relative(this.root, path.resolve(p));
    return (r.startsWith('..') ? path.resolve(p) : r).split(path.sep).join('/');
  }

  copyToBackup(target) {
    const copy = path.join(this.backupDir, this.rel(target));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(target, copy);
    return copy;
  }

  /** Kopia zapasowa pliku przed modyfikacja (raz na plik). */
  backup(target) {
    const key = path.resolve(target);
    if (!fs.existsSync(target) || this.backedUp.has(key)) return;
    this.backedUp.add(key);
    this.entries.push(`BACKUP\t${this.rel(target)}\t${this.rel(this.copyToBackup(target))}`);
  }

  /** Kopia zapasowa + usuniecie (np. starsza wersja naszego moda). */
  deleteWithBackup(target) {
    const copy = this.copyToBackup(target);
    fs.unlinkSync(target);
    this.entries.push(`DELETE\t${this.rel(target)}\t${this.rel(copy)}`);
  }

  recordRename(from, to) { this.entries.push(`RENAME\t${this.rel(from)}\t${this.rel(to)}`); }
  recordAdd(added)       { this.entries.push(`ADD\t${this.rel(added)}`); }

  get isEmpty() { return this.entries.length === 0; }

  flush() {
    if (this.isEmpty) return null;
    fs.mkdirSync(this.dir, { recursive: true });
    const head = `# tfg-patcher, ${new Date().toISOString()}, instancja: ${this.root}`;
    fs.writeFileSync(this.file, [head, ...this.entries].join('\n') + '\n', 'utf8');
    return this.file;
  }
}

/**
 * Cofa najnowsza aplikacje latki - wpisy przetwarzane od konca.
 * @returns {{count:number, journal:string|null}}
 */
function revert(root, log = () => {}) {
  const dir = path.join(root, '.tfg-patcher');
  if (!fs.existsSync(dir)) {
    log('Brak katalogu .tfg-patcher - nic nie zastosowano w tej instancji.');
    return { count: -1, journal: null };
  }
  const journals = fs.readdirSync(dir)
    .filter(n => n.startsWith('journal-') && n.endsWith('.txt'))
    .sort();
  const newest = journals[journals.length - 1];
  if (!newest) { log('Brak dziennika do cofniecia.'); return { count: -1, journal: null }; }
  log('Cofam wg dziennika: ' + newest);

  const lines = fs.readFileSync(path.join(dir, newest), 'utf8').split(/\r?\n/);
  let done = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim() || line.startsWith('#')) continue;
    const f = line.split('\t');
    try {
      if (f[0] === 'ADD') {
        const p = path.join(root, f[1]);
        if (fs.existsSync(p)) { fs.unlinkSync(p); log('  usunieto  ' + f[1]); done++; }
      } else if (f[0] === 'RENAME') {
        const from = path.join(root, f[1]), to = path.join(root, f[2]);
        if (fs.existsSync(to)) { fs.renameSync(to, from); log('  przywrocono nazwe ' + f[1]); done++; }
      } else if (f[0] === 'BACKUP' || f[0] === 'DELETE') {
        const target = path.join(root, f[1]), copy = path.join(root, f[2]);
        if (fs.existsSync(copy)) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(copy, target);
          log('  odtworzono ' + f[1]);
          done++;
        } else {
          log('  UWAGA brak kopii ' + f[2] + ' - pomijam ' + f[1]);
        }
      }
    } catch (e) {
      log(`  BLAD przy "${line}": ${e.message}`);
    }
  }
  fs.renameSync(path.join(dir, newest), path.join(dir, newest.replace('.txt', '-cofnieto.txt')));
  return { count: done, journal: newest };
}

module.exports = { Journal, revert };
