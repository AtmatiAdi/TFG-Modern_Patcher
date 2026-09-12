'use strict';
// Chirurgiczny edytor plikow klucz-wartosc: .toml, .properties, options.txt,
// instance.cfg, ustawienia shaderow. Zmieniamy TYLKO wskazany klucz - komentarze,
// kolejnosc linii, wciecia i cudze ustawienia zostaja nietkniete.

const fs = require('fs');

const STYLES = {
  toml:       { sep: '=', sections: true,  indent: '\t', spaced: true },
  properties: { sep: '=', sections: false, indent: '',   spaced: false },
  options:    { sep: ':', sections: false, indent: '',   spaced: false },
  // instance.cfg Prisma to QSettings IniFormat: backslash jest znakiem ucieczki,
  // wiec sciezki Windows musza isc do pliku jako `\\` - patrz iniEncode/iniDecode.
  ini:        { sep: '=', sections: true,  indent: '',   spaced: false, encode: iniEncode, decode: iniDecode },
};

// --- kodowanie wartosci QSettings (Prism, ConfigVersion 1.3) ---------------------
// Prism czyta instance.cfg przez QSettings::IniFormat (launcher/settings/INIFile.cpp).
// Tam `\` otwiera sekwencje ucieczki: `\\`, `\"`, `\n`, `\t`, `\r`, `\xHH;`, a NIEZNANA
// sekwencja jest po cichu wyrzucana razem z backslashem. Gola sciezka Windows
// `C:\Users\...\tools\ram-keeper.cmd` wraca z tego jako `C:sers...<TAB>ools...` i Prism
// przy pierwszym zapisie pliku (start gry) utrwala te wersje. Dlatego preset podaje
// wartosc LOGICZNA, a tu robimy z niej postac na dysk i z powrotem.

const INI_ESCAPES = { '\\': '\\', '"': '"', n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '?': '?', "'": "'" };

/** Z linii pliku do wartosci logicznej: zdjete cudzyslowy, rozwiniete ucieczki. */
function iniDecode(raw) {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    if (n === undefined) break;
    if (n in INI_ESCAPES) { out += INI_ESCAPES[n]; continue; }
    if (n === 'x') {                                   // \xHH; (srednik opcjonalny)
      const m = /^[0-9a-fA-F]{1,4}/.exec(s.slice(i + 1));
      if (m) { out += String.fromCharCode(parseInt(m[0], 16)); i += m[0].length; if (s[i + 1] === ';') i++; }
      continue;
    }
    // nieznana sekwencja: QSettings wyrzuca ja razem z backslashem - robimy to samo,
    // zeby porownanie widzialo to, co widzi Prism
  }
  return out;
}

/** Z wartosci logicznej (albo juz ujetej w cudzyslowy) do postaci QSettings. */
function iniEncode(value) {
  let s = String(value).trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  const body = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
  // QSettings sam cytuje przy `;` `,` `=` i skrajnych spacjach; cytujemy tez sciezki
  // i cokolwiek ze spacja, bo tak trzyma to Prism (JvmArgs) i tak pisza presety.
  // Pusta wartosc zostaje pusta (`Klucz=`) - tak zapisuje ja sam Prism.
  const quote = /[\s;,="\\#]/.test(body);
  return quote ? '"' + body + '"' : body;
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keyPattern(key, style) {
  return new RegExp('^(\\s*' + esc(key) + '\\s*' + esc(style.sep) + '\\s*)(.*?)(\\s*)$');
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith('#') || t.startsWith('//') || t.startsWith(';');
}

function load(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const trailing = raw.endsWith('\n');
  const lines = raw.split(/\r\n|\n/);
  if (trailing) lines.pop();
  return { file, lines, eol, trailing };
}

function save(doc) {
  fs.writeFileSync(doc.file, doc.lines.join(doc.eol) + (doc.trailing ? doc.eol : ''), 'utf8');
}

/** Indeks linii z kluczem w danej sekcji albo -1. */
function indexOf(doc, section, key, style) {
  const re = keyPattern(key, style);
  let current = null;
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i];
    if (style.sections) {
      const t = line.trim();
      if (t.startsWith('[') && t.endsWith(']')) { current = t.slice(1, -1).trim(); continue; }
    }
    if (isComment(line)) continue;
    if (section !== null && section !== undefined && current !== section) continue;
    if (re.test(line)) return i;
  }
  return -1;
}

function get(file, section, key, style) {
  const doc = load(file);
  const i = indexOf(doc, section, key, style);
  if (i < 0) return null;
  const m = doc.lines[i].match(keyPattern(key, style));
  if (!m) return null;
  return style.decode ? style.decode(m[2]) : m[2];
}

/** Miejsce wstawienia brakujacego klucza: koniec wskazanej sekcji albo koniec pliku. */
function insertPoint(doc, section, style) {
  if (!section || !style.sections) return doc.lines.length;
  let start = -1;
  for (let i = 0; i < doc.lines.length; i++) {
    const t = doc.lines[i].trim();
    if (t.startsWith('[') && t.endsWith(']')) {
      if (start >= 0) return i;
      if (t.slice(1, -1).trim() === section) start = i;
    }
  }
  return doc.lines.length;
}

/** @returns {boolean} czy plik faktycznie zmieniono */
function set(file, section, key, style, value, addIfMissing = true) {
  const doc = load(file);
  const i = indexOf(doc, section, key, style);
  const disk = style.encode ? style.encode(value) : value;
  if (i >= 0) {
    const m = doc.lines[i].match(keyPattern(key, style));
    if (!m || m[2] === disk) return false;
    doc.lines[i] = m[1] + disk + m[3];
  } else {
    if (!addIfMissing) return false;
    const sep = style.spaced ? ` ${style.sep} ` : style.sep;
    doc.lines.splice(insertPoint(doc, section, style), 0, style.indent + key + sep + disk);
  }
  save(doc);
  return true;
}

// --- prosty JSON: podmiana pojedynczej wartosci skalarnej bez reformatowania pliku ---

function jsonPattern(key) {
  return new RegExp('("' + esc(key) + '"\\s*:\\s*)(true|false|-?\\d+(?:\\.\\d+)?|"[^"]*")');
}

function getJson(file, key) {
  const m = fs.readFileSync(file, 'utf8').match(jsonPattern(key));
  return m ? m[2] : null;
}

function setJson(file, key, value) {
  const raw = fs.readFileSync(file, 'utf8');
  const re = jsonPattern(key);
  const m = raw.match(re);
  if (!m || m[2] === value) return false;
  fs.writeFileSync(file, raw.replace(re, `$1${value}`), 'utf8');
  return true;
}

/** trim + zdjecie cudzyslowow (Prism trzyma JvmArgs w cudzyslowach). */
function norm(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1).trim();
  return t;
}

module.exports = { STYLES, get, set, getJson, setJson, norm, iniEncode, iniDecode };
