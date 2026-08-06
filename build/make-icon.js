'use strict';
/**
 * Generator ikony aplikacji -> build/icon.ico (+ build/icon.png do podgladu).
 *
 *   node build/make-icon.js
 *
 * Ikona jest KODEM, nie wrzucona binarka: zrodlem jest siatka 16x16 nizej, wiec da sie
 * ja poprawic w edytorze tekstu i przegenerowac, bez Photoshopa i bez pytania "czym to
 * w ogole zrobiono". Skrypt uzywa wylacznie modulow wbudowanych Node (zlib do PNG) -
 * ta sama zasada, co reszta projektu: zero zaleznosci runtime, ma sie zbudowac za piec lat.
 *
 * Skalowanie jest metoda najblizszego sasiada i TYLKO o calkowita krotnosc (1,2,3,4,8,16x),
 * inaczej piksele wyszlyby nierownej szerokosci i caly zamysl by sie rozjechal.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --------------------------------------------------------------------- tekstura

// Blok lapis lazuli: ciemny granat z jasniejszymi i ciemniejszymi cetkami.
// Cyfra = indeks w palecie. Od najciemniejszego do najjasniejszego.
const PALETTE = ['#0f2361', '#183a8c', '#20489f', '#3266c8', '#5a8ee6'];

// Cetki chodza SKUPISKAMI 2x2, nie pojedynczymi pikselami: rozsypka czyta sie jak szum
// telewizora i po zmniejszeniu do 16 px robi z bloku rownomierna plame. Skupiska trzeba
// tez rozstawiac nieregularnie - rowne odstepy natychmiast widac jako kratke, a ustawione
// po skosie zbieraja sie w smuge, ktorej w kamieniu nie ma.
const ART = [
  '2232211222332222',
  '2332211200322112',
  '2222222200222112',
  '1123322222232222',
  '1123322002233222',
  '2222220022112200',
  '2002222211122200',
  '2002342222233322',
  '2222332112233322',
  '3322222112002221',
  '3321122220022221',
  '2221122332222322',
  '2002223322112342',
  '2002222222112222',
  '2223321122223322',
  '2123321122002331',
];

const SIZE = 16;

/** Rozjasnienie/przyciemnienie o ulamek drogi do bieli/czerni. */
const mix = (c, to, amount) => c.map(v => Math.round(v + (to - v) * amount));

const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

/** Tekstura bazowa 16x16 jako RGBA. Nieprzezroczysta - to pelny kwadrat, nie ikonka z tlem. */
function texture() {
  if (ART.length !== SIZE) throw new Error(`ART ma ${ART.length} wierszy, ma miec ${SIZE}`);
  const rgb = PALETTE.map(hexToRgb);
  const out = Buffer.alloc(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++) {
    if (ART[y].length !== SIZE) throw new Error(`ART wiersz ${y} ma ${ART[y].length} znakow, ma miec ${SIZE}`);
    for (let x = 0; x < SIZE; x++) {
      const idx = ART[y].charCodeAt(x) - 48;
      if (!rgb[idx]) throw new Error(`ART wiersz ${y}, znak ${x}: "${ART[y][x]}" nie ma koloru`);
      let c = rgb[idx];
      // Faza: gorna i lewa krawedz jasniejsza, dolna i prawa ciemniejsza. Robiona na
      // teksturze 16x16, wiec skaluje sie RAZEM z pikselami - przy 256 px jest to ramka
      // szerokosci jednego "klocka", a nie cienka kreska obca reszcie rysunku.
      if (x === 0 || y === 0) c = mix(c, 255, 0.22);
      if (x === SIZE - 1 || y === SIZE - 1) c = mix(c, 0, 0.28);
      const o = (y * SIZE + x) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
  }
  return out;
}

/** Powiekszenie calkowita krotnoscia, bez rozmycia. */
function scale(src, size, factor) {
  const n = size * factor;
  const out = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = (Math.floor(y / factor) * size + Math.floor(x / factor)) * 4;
      src.copy(out, (y * n + x) * 4, s, s + 4);
    }
  }
  return out;
}

// -------------------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // 8 bitow na kanal
  ihdr[9] = 6;   // RGBA
  // reszta (kompresja, filtr, przeplot) zerami - jedyne dozwolone wartosci

  // Kazdy wiersz poprzedzony bajtem filtru 0 (brak) - obraz jest plaski, filtry nic tu nie daja.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// -------------------------------------------------------------------------- ICO

/**
 * Klatka w postaci DIB (BITMAPINFOHEADER + BGRA od dolu + maska AND).
 * Male rozmiary trzymamy w DIB, a nie w PNG: PNG w ICO rozumie dopiero Vista i nowsze
 * narzedzia, DIB rozumie wszystko. Maska AND jest wyzerowana - ikona jest w calosci
 * nieprzezroczysta, ale naglowek i tak musi ja miec, inaczej wysokosc sie nie zgadza.
 */
function dib(rgba, size) {
  const maskRow = Math.ceil(size / 8 / 4) * 4;   // wiersze maski wyrownane do 4 bajtow
  const mask = Buffer.alloc(maskRow * size);
  const px = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;       // DIB idzie od dolu do gory
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = (y * size + x) * 4;
      px[d] = rgba[s + 2]; px[d + 1] = rgba[s + 1]; px[d + 2] = rgba[s]; px[d + 3] = rgba[s + 3];
    }
  }

  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(size, 4);
  head.writeInt32LE(size * 2, 8);                // wysokosc = obraz + maska
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  head.writeUInt32LE(px.length + mask.length, 20);
  return Buffer.concat([head, px, mask]);
}

function ico(frames) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(frames.length, 4);

  const entries = [];
  let offset = 6 + frames.length * 16;
  for (const f of frames) {
    const e = Buffer.alloc(16);
    e[0] = f.size === 256 ? 0 : f.size;          // 256 zapisuje sie jako 0
    e[1] = f.size === 256 ? 0 : f.size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(f.data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += f.data.length;
  }
  return Buffer.concat([dir, ...entries, ...frames.map(f => f.data)]);
}

// ------------------------------------------------------------------------- main

const base = texture();
// Same krotnosci 16: 24 czy 40 px wymagalyby polowek pikseli.
const frames = [1, 2, 3, 4, 8, 16].map(factor => {
  const size = SIZE * factor;
  const rgba = factor === 1 ? base : scale(base, SIZE, factor);
  // Powyzej 48 px DIB waha juz swoje - tam PNG, i tak czytany przez wszystko wspolczesne.
  return { size, rgba, data: size > 48 ? png(rgba, size) : dib(rgba, size) };
});

const out = path.join(__dirname, 'icon.ico');
const preview = path.join(__dirname, 'icon.png');
fs.writeFileSync(out, ico(frames));
fs.writeFileSync(preview, png(frames[frames.length - 1].rgba, 256));

console.log(`${out}  (${frames.map(f => f.size).join(', ')} px, ${fs.statSync(out).size} B)`);
console.log(`${preview}  (podglad 256 px)`);
