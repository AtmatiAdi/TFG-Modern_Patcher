'use strict';
// Elementarne operacje na instancji. Kazda umie powiedziec, czy jest juz zrobiona
// (check) i wykonac sie z zapisem do dziennika (apply).
//
// Stany: ok (nic do roboty) | todo (do wykonania) | missing (brak celu) | error

const fs = require('fs');
const path = require('path');
const tc = require('./textconfig');
const modscan = require('./modscan');
const zip = require('./zip');

const ok      = text => ({ state: 'ok', text });
const todo    = text => ({ state: 'todo', text });
const missing = text => ({ state: 'missing', text });
const error   = text => ({ state: 'error', text });

const val = (v, opts) => (typeof v === 'function' ? v(opts) : v);

// ------------------------------------------------------------------ klucz w pliku

function setKey({ target, label, section = null, key, style, value, addIfMissing = true }) {
  return {
    describe: opts => `${label} -> ${section ? `[${section}] ` : ''}${key} = ${tc.norm(val(value, opts))}`,
    check(inst, opts) {
      const file = target(inst);
      if (!fs.existsSync(file)) return missing('brak pliku ' + label);
      try {
        const want = val(value, opts);
        const cur = tc.get(file, section, key, style);
        if (cur === null) {
          return addIfMissing ? todo(`${key}: brak wpisu -> dopisze ${tc.norm(want)}`)
                              : missing(`${key}: brak wpisu w ${label}`);
        }
        if (tc.norm(cur) === tc.norm(want)) return ok(`${key} = ${tc.norm(cur)}`);
        return todo(`${key}: ${tc.norm(cur)} -> ${tc.norm(want)}`);
      } catch (e) {
        return error(`${label}: ${e.message}`);
      }
    },
    apply(inst, opts, journal, log) {
      const file = target(inst);
      journal.backup(file);
      const before = tc.get(file, section, key, style);
      const want = val(value, opts);
      if (tc.set(file, section, key, style, want, addIfMissing)) {
        log(`    ${label}: ${key} ${before === null ? '(dopisane)' : tc.norm(before) + ' ->'} ${tc.norm(want)}`);
      }
    },
  };
}

// ------------------------------------------------------------------ klucz w JSON

function setJson({ target, label, key, value }) {
  return {
    describe: () => `${label} -> ${key} = ${value}`,
    check(inst) {
      const file = target(inst);
      if (!fs.existsSync(file)) return missing('brak pliku ' + label);
      try {
        const cur = tc.getJson(file, key);
        if (cur === null) return missing(`${key}: brak wpisu w ${label}`);
        return cur === value ? ok(`${key} = ${cur}`) : todo(`${key}: ${cur} -> ${value}`);
      } catch (e) {
        return error(`${label}: ${e.message}`);
      }
    },
    apply(inst, opts, journal, log) {
      const file = target(inst);
      journal.backup(file);
      if (tc.setJson(file, key, value)) log(`    ${label}: ${key} -> ${value}`);
    },
  };
}

// ----------------------------------------------------------------- wgranie pliku

function globToRe(glob) {
  return new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

/**
 * Zrodlo bajtow do wgrania. Zawsze plik lezacy w cache - pobrany z wydania modu
 * albo z wydania presetu. Aplikacja nie nosi w sobie zadnych zasobow.
 */
function fileResource(absPath, missingText) {
  return {
    describe: () => (absPath ? path.basename(absPath) : '?'),
    exists: () => Boolean(absPath) && fs.existsSync(absPath),
    size: () => fs.statSync(absPath).size,
    read: () => fs.readFileSync(absPath),
    missingText: () => missingText || 'plik nie zostal pobrany',
  };
}

function toResource(resource) {
  return resource;
}

function installFile({ resource, target, label, replaceGlob = null, onlyIfMissing = false }) {
  const src = toResource(resource);
  const stale = (dest) => {
    if (!replaceGlob || !fs.existsSync(path.dirname(dest))) return [];
    const re = globToRe(replaceGlob);
    return fs.readdirSync(path.dirname(dest))
      .filter(n => re.test(n) && path.join(path.dirname(dest), n) !== dest)
      .map(n => path.join(path.dirname(dest), n));
  };

  return {
    describe: () => `wgranie ${label}${onlyIfMissing ? ' (tylko gdy brak)' : ''}`
      + (replaceGlob ? `, usuniecie starszych ${replaceGlob}` : ''),
    check(inst) {
      const dest = target(inst);
      if (!src.exists()) return missing(src.missingText());
      try {
        if (fs.existsSync(dest)) {
          if (onlyIfMissing) return ok(`${label}: juz jest, nie ruszam`);
          if (fs.statSync(dest).size === src.size()
              && fs.readFileSync(dest).equals(src.read())) return ok(`${label}: aktualny`);
          return todo(`${label}: nadpisze`);
        }
        const old = stale(dest);
        return todo(`${label}: wgra` + (old.length ? `, usunie ${old.map(p => path.basename(p)).join(', ')}` : ''));
      } catch (e) {
        return error(`${label}: ${e.message}`);
      }
    },
    apply(inst, opts, journal, log) {
      const dest = target(inst);
      if (fs.existsSync(dest) && onlyIfMissing) return;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      for (const old of stale(dest)) {
        journal.deleteWithBackup(old);
        log('    usunieto starsza wersje: ' + path.basename(old));
      }
      const existed = fs.existsSync(dest);
      if (existed) journal.backup(dest);
      fs.writeFileSync(dest, src.read());
      if (!existed) journal.recordAdd(dest);
      log(`    wgrano ${path.basename(dest)} (${src.size()} B)${existed ? ' [nadpisano]' : ''}`);
    },
  };
}

// ------------------------------------------------------ rozpakowanie archiwum

/**
 * Rozpakowanie ZIP-a do katalogu (narzedzia z grupy "tools").
 *
 * Kazdy wypakowany plik trafia do dziennika osobno, wiec "Cofnij ostatnie" sprzata
 * po narzedziu tak samo dokladnie, jak po pojedynczym pliku.
 */
function installArchive({ resource, target, label, onlyIfMissing = false }) {
  const src = toResource(resource);

  const files = () => zip.entries(src.read())
    .filter(e => !e.name.endsWith('/') && !e.name.includes('..'));

  return {
    describe: () => `rozpakowanie ${label}${onlyIfMissing ? ' (tylko gdy brak)' : ''}`,
    check(inst) {
      const dir = target(inst);
      if (!src.exists()) return missing(src.missingText());
      try {
        const entries = files();
        if (fs.existsSync(dir) && onlyIfMissing) return ok(`${label}: juz jest, nie ruszam`);
        const stale = entries.filter(e => {
          const dest = path.join(dir, e.name);
          return !fs.existsSync(dest) || fs.statSync(dest).size !== e.size;
        });
        if (!stale.length) return ok(`${label}: ${entries.length} plikow, aktualne`);
        return todo(`${label}: rozpakuje ${stale.length} z ${entries.length} plikow`);
      } catch (e) {
        return error(`${label}: ${e.message}`);
      }
    },
    apply(inst, opts, journal, log) {
      const dir = target(inst);
      if (fs.existsSync(dir) && onlyIfMissing) return;
      const buf = src.read();
      let n = 0;
      for (const entry of files()) {
        const dest = path.join(dir, entry.name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const existed = fs.existsSync(dest);
        if (existed) journal.backup(dest);
        fs.writeFileSync(dest, zip.read(buf, entry));
        if (!existed) journal.recordAdd(dest);
        n++;
      }
      log(`    rozpakowano ${n} plikow do ${path.basename(dir)}`);
    },
  };
}

// --------------------------------------------------------------- wylaczanie modow

/**
 * Rename .jar -> .jar.disabled ze skanem bajtkodu pozostalych modow.
 * Skan dzieli trafienia na miekkie (opcjonalne integracje - tylko informacja)
 * i twarde (blokada, chyba ze wymuszenie).
 */
function disableMods({ prefixes, scan }) {
  const active = inst => {
    if (!fs.existsSync(inst.mods)) return [];
    return fs.readdirSync(inst.mods)
      .filter(n => n.endsWith('.jar') && prefixes.some(p => n.startsWith(p)))
      .sort()
      .map(n => path.join(inst.mods, n));
  };

  return {
    describe: () => `wylaczenie modow (${prefixes.join(', ')}) przez .jar -> .jar.disabled`
      + (scan ? `, ze skanem zaleznosci (${scan.tokens.join(', ')})` : ''),
    check(inst) {
      if (!fs.existsSync(inst.mods)) return missing('brak katalogu mods/');
      const toDisable = active(inst);
      if (toDisable.length) return todo('wylaczy: ' + toDisable.map(p => path.basename(p)).join(', '));
      const off = fs.readdirSync(inst.mods).filter(n => n.endsWith('.jar.disabled')
        && prefixes.some(p => n.startsWith(p)));
      if (off.length) return ok(`${off.length} z ${prefixes.length} modow jest juz wylaczonych`);
      return missing(`zadnego z modow (${prefixes.join(', ')}) nie ma w tej instancji`);
    },
    apply(inst, opts, journal, log) {
      const toDisable = active(inst);
      if (!toDisable.length) return;

      if (scan && opts.scan !== false) {
        const ignore = toDisable.map(p => path.basename(p));
        log(`    skan bajtkodu modow pod katem: ${scan.tokens.join(', ')}`);
        const hits = modscan.findReferencing(inst.mods, ignore, scan, (name, done, total) => {
          if (done % 50 === 0 || done === total) log(`      ${done}/${total}`);
        });
        const hard = hits.filter(h => !h.soft);
        const soft = hits.filter(h => h.soft);
        if (soft.length) {
          log('    opcjonalne integracje (bezpieczne, ladują sie tylko gdy mod obecny):');
          for (const h of soft) log(`      ${h.jar} - ${h.classes.length} klas, np. ${h.classes[0]}`);
        }
        if (hard.length) {
          const list = hard.map(h => `${h.jar} (${h.classes[0]})`).join(', ');
          if (!opts.force) {
            throw new Error(`TWARDE zaleznosci od wylaczanych modow: ${list}. `
              + 'Wylaczenie moze wywalic gre - przerwane. Wymus tylko swiadomie.');
          }
          log('    UWAGA (wymuszone): twarde zaleznosci mimo to zignorowane: ' + list);
        } else {
          log('    skan czysty: brak twardych zaleznosci');
        }
      }

      for (const jar of toDisable) {
        const off = jar + '.disabled';
        fs.renameSync(jar, off);
        journal.recordRename(jar, off);
        log('    wylaczono ' + path.basename(jar));
      }
    },
  };
}

module.exports = { setKey, setJson, installFile, installArchive, disableMods, fileResource };
