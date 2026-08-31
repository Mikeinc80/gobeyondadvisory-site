#!/usr/bin/env node
/**
 * Generates the PWA icons for /academy from a single vector-ish description.
 *
 * There is no image toolchain in this repository and no reason to add one for
 * four flat-colour icons, so this writes the PNGs directly: the format is a
 * signature, an IHDR chunk, one zlib-compressed IDAT of filter-0 scanlines and
 * an IEND chunk. Node's zlib does the only hard part.
 *
 * The mark is three stacked bars in the site's gold, on the site's ink — a
 * layered-infrastructure glyph that stays legible at 16px in a browser tab.
 *
 *   node scripts/build-academy-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const INK = [0x1a, 0x17, 0x14];
const BARS = [
  { w: 0.34, y: 0.255, rgb: [0xc9, 0xa8, 0x4c] }, // gold-lt
  { w: 0.46, y: 0.435, rgb: [0x9a, 0x7a, 0x32] }, // gold
  { w: 0.58, y: 0.615, rgb: [0x7a, 0x5e, 0x24] }, // gold-dk
];
const BAR_H = 0.13;
const SS = 4; // supersampling factor, for antialiased edges

/** CRC32 over a buffer, per the PNG specification. */
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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
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

/** Encode an RGB pixel buffer (size*size*3) as a PNG. */
function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type 2 = truecolour RGB
  // 10..12 default to 0: deflate, adaptive filtering, no interlace.

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** True if (x, y) — in 0..1 space — is inside a centred rounded bar. */
function inBar(x, y, bar, inset) {
  const scale = 1 - inset * 2;
  const bw = bar.w * scale;
  const bh = BAR_H * scale;
  const cx = 0.5;
  const cy = inset + (bar.y + BAR_H / 2) * scale;
  const r = bh / 2;

  const dx = Math.abs(x - cx) - (bw / 2 - r);
  const dy = Math.abs(y - cy) - (bh / 2 - r);
  if (dx <= 0 && dy <= 0) return true;
  const qx = Math.max(dx, 0);
  const qy = Math.max(dy, 0);
  return qx * qx + qy * qy <= r * r;
}

/**
 * @param inset padding as a fraction of the canvas. Maskable icons need the
 *              artwork inside the safe zone, since the platform may crop.
 */
function renderIcon(size, inset) {
  const buf = Buffer.alloc(size * size * 3);
  const big = size * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x * SS + sx + 0.5) / big;
          const fy = (y * SS + sy + 0.5) / big;
          let c = INK;
          for (const bar of BARS) if (inBar(fx, fy, bar, inset)) { c = bar.rgb; break; }
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 3;
      buf[i] = Math.round(acc[0] / n);
      buf[i + 1] = Math.round(acc[1] / n);
      buf[i + 2] = Math.round(acc[2] / n);
    }
  }
  return png(size, buf);
}

mkdirSync('academy/icons', { recursive: true });
const outputs = [
  ['academy/icons/icon-192.png', 192, 0.14],
  ['academy/icons/icon-512.png', 512, 0.14],
  ['academy/icons/maskable-512.png', 512, 0.22],
  ['academy/icons/apple-touch-icon.png', 180, 0.14],
];
for (const [path, size, inset] of outputs) {
  const data = renderIcon(size, inset);
  writeFileSync(path, data);
  console.log(`Wrote ${path} (${size}x${size}, ${data.length} bytes)`);
}
