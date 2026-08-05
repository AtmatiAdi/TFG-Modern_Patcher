'use strict';
// Minimalny czytnik ZIP-a (tylko odczyt wpisow store/deflate). Wlasny, zeby silnik
// nie ciagnal zaleznosci - dziala tak samo w Electronie i w czystym node.

const fs = require('fs');
const zlib = require('zlib');

const EOCD = 0x06054b50;
const CEN  = 0x02014b50;

/**
 * Lista wpisow archiwum.
 * @returns {{name:string, method:number, csize:number, size:number, offset:number}[]}
 */
function entries(buf) {
  // End of Central Directory szukamy od konca (moze byc komentarz na koncu pliku)
  let eocd = -1;
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('to nie jest archiwum ZIP');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== CEN) break;
    const method = buf.readUInt16LE(p + 10);
    const csize  = buf.readUInt32LE(p + 20);
    const size   = buf.readUInt32LE(p + 24);
    const nlen   = buf.readUInt16LE(p + 28);
    const elen   = buf.readUInt16LE(p + 30);
    const clen   = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nlen), method, csize, size, offset });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

/** Rozpakowana zawartosc wpisu. */
function read(buf, entry) {
  const p = entry.offset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error('uszkodzony naglowek wpisu ' + entry.name);
  const nlen = buf.readUInt16LE(p + 26);
  const elen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nlen + elen;
  const data = buf.subarray(start, start + entry.csize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error('nieobslugiwana kompresja ' + entry.method + ' we wpisie ' + entry.name);
}

function open(file) {
  const buf = fs.readFileSync(file);
  return { buf, entries: entries(buf) };
}

module.exports = { open, entries, read };
