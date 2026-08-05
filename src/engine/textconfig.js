'use strict';
// Chirurgiczny edytor plikow klucz-wartosc: .toml, .properties, options.txt,
// instance.cfg, ustawienia shaderow. Zmieniamy TYLKO wskazany klucz - komentarze,
// kolejnosc linii, wciecia i cudze ustawienia zostaja nietkniete.

const fs = require('fs');

const STYLES = {
  toml:       { sep: '=', sections: true,  indent: '\t', spaced: true },
  properties: { sep: '=', sections: false, indent: '',   spaced: false },
  options:    { sep: ':', sections: false, indent: '',   spaced: false },
  ini:        { sep: '=', sections: true,  indent: '',   spaced: false },
};

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
  return m ? m[2] : null;
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
  if (i >= 0) {
    const m = doc.lines[i].match(keyPattern(key, style));
    if (!m || m[2] === value) return false;
    doc.lines[i] = m[1] + value + m[3];
  } else {
    if (!addIfMissing) return false;
    const sep = style.spaced ? ` ${style.sep} ` : style.sep;
    doc.lines.splice(insertPoint(doc, section, style), 0, style.indent + key + sep + value);
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

module.exports = { STYLES, get, set, getJson, setJson, norm };
