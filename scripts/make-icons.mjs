// Draws Flame's icon (a solid flame with a candlestick cut out of it) and
// writes every size the app ships: public/icon.svg and the four PNGs.
// No dependencies: a small supersampling rasteriser and Node's zlib.
//
//   node scripts/make-icons.mjs
//
// The geometry lives here and in src/shell/Mark.tsx; keep the two in step.

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const TILE = [0x13, 0x12, 0x10];
const AMBER = [0xdd, 0x74, 0x18];
const BOX = 32;

// The flame, as cubic segments in a 32-unit box. Each row: c1x c1y c2x c2y x y.
const START = [18.5, 2];
const CURVES = [
  [19.5, 8.5, 27, 11.5, 27, 19.5],
  [27, 25.5, 22.1, 30, 16, 30],
  [9.9, 30, 5, 25.5, 5, 19.5],
  [5, 15.6, 7, 12.6, 9.6, 10.2],
  [9.8, 12.6, 10.8, 14.4, 12.6, 15.2],
  [12, 9.8, 14, 4.8, 18.5, 2],
];
// The candlestick cut out of it: a body and one wick running through it.
const BODY = { x: 13, y: 16, w: 6.4, h: 8.4, r: 1.2 };
const WICK = { x: 15.1, y: 11.1, w: 2.2, h: 17, r: 1.1 };

export const FLAME_PATH = `M${START.join(' ')}${CURVES.map((c) => `C${c.join(' ')}`).join('')}Z`;
export const CANDLE_PATH =
  'M13 17.2a1.2 1.2 0 0 1 1.2-1.2h.9v-3.8a1.1 1.1 0 0 1 2.2 0V16h.9a1.2 1.2 0 0 1 1.2 1.2v6a1.2 1.2 0 0 1-1.2 1.2h-.9V27a1.1 1.1 0 0 1-2.2 0v-2.6h-.9a1.2 1.2 0 0 1-1.2-1.2z';

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

function flamePolygon() {
  const pts = [START];
  let [x0, y0] = START;
  for (const [ax, ay, bx, by, x, y] of CURVES) {
    for (let i = 1; i <= 32; i++) {
      const t = i / 32;
      const u = 1 - t;
      pts.push([u * u * u * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x, u * u * u * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y]);
    }
    [x0, y0] = [x, y];
  }
  return pts;
}

const POLY = flamePolygon();

function inPolygon(px, py) {
  let inside = false;
  for (let i = 0, j = POLY.length - 1; i < POLY.length; j = i++) {
    const [xi, yi] = POLY[i];
    const [xj, yj] = POLY[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRound({ x, y, w, h, r }, px, py) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/**
 * @param size   pixels per side
 * @param radius tile corner radius in box units; 0 for a full-bleed square
 * @param scale  size of the flame about the centre (1 = as drawn)
 */
function render(size, radius, scale) {
  const SS = 4;
  const tile = { x: 0, y: 0, w: BOX, h: BOX, r: radius };
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * BOX;
          const y = ((py + (sy + 0.5) / SS) / size) * BOX;
          if (radius > 0 && !inRound(tile, x, y)) continue;
          // The flame is drawn scaled about the centre, so sample it un-scaled.
          const fx = (x - BOX / 2) / scale + BOX / 2;
          const fy = (y - BOX / 2) / scale + BOX / 2;
          const lit = inPolygon(fx, fy) && !inRound(BODY, fx, fy) && !inRound(WICK, fx, fy);
          const c = lit ? AMBER : TILE;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const n = SS * SS;
      const o = (py * size + px) * 4;
      // Straight alpha: colour is the mean over the covered samples.
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="${hex(TILE)}"/>
  <path fill="${hex(AMBER)}" fill-rule="evenodd" d="${FLAME_PATH}${CANDLE_PATH}"/>
</svg>
`;

// A maskable icon may be cropped to a circle 80% of its width. The flame's
// farthest point is 14.2 units from the centre of a 32-unit box, so at 0.8 it
// reaches 11.4, inside the 12.8-unit safe radius.
const MASKABLE_SCALE = 0.8;

const root = new URL('../public/', import.meta.url);
writeFileSync(new URL('icon.svg', root), svg);
writeFileSync(new URL('icon-192.png', root), png(192, render(192, 7, 1)));
writeFileSync(new URL('icon-512.png', root), png(512, render(512, 7, 1)));
writeFileSync(new URL('icon-maskable-512.png', root), png(512, render(512, 0, MASKABLE_SCALE)));
// iOS rounds the corners itself and does not want transparency.
writeFileSync(new URL('apple-touch-icon.png', root), png(180, render(180, 0, 0.9)));

const far = Math.max(...POLY.map(([x, y]) => Math.hypot(x - BOX / 2, y - BOX / 2)));
console.log(`icons written; flame reaches ${(far * MASKABLE_SCALE).toFixed(1)} of a ${(BOX * 0.4).toFixed(1)}-unit maskable safe radius`);
