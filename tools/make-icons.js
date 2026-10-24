// Draws the app icon (a slice of the amber tuning dial with its red needle) and writes it as SVG
// and as the PNG sizes browsers and home screens ask for. No dependencies: shapes are
// rasterised here with 4×4 supersampling and encoded with node:zlib.
// Usage: node tools/make-icons.js   (writes public/icons/*)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.join('public', 'icons');
const DIAL = [0xF4, 0xC8, 0x6E], DEEP = [0xD0, 0x8D, 0x29], INK = [0x3B, 0x2A, 0x10], NEEDLE = [0xC4, 0x2F, 0x1A];
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

// The design lives in a 512 × 512 frame. `scale` shrinks the ticks towards the centre so a
// maskable icon keeps them inside the safe zone; `round` is the corner radius (0 = full bleed).
function design({ scale = 1, round = 0 } = {}) {
  const ticks = [];
  const top = 256 - 256 * scale;
  for (let i = -8; i <= 8; i++) {
    const m = ((i % 4) + 4) % 4;
    const len = (m === 2 ? 0.36 : m === 0 ? 0.24 : 0.13) * 512 * scale;
    const w = (m === 2 ? 9 : 6) * scale;
    const x = 256 + i * 32 * scale;
    ticks.push({ x: x - w / 2, y: top, w, h: len, a: m === 2 ? 0.95 : 0.6 });
  }
  const nw = 14 * scale, tri = 34 * scale;
  return { round, ticks, needle: { x: 256 - nw / 2, w: nw }, tri: { top, half: tri, depth: tri * 1.3 } };
}

function svg(d) {
  const clip = d.round ? ` clip-path="url(#c)"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>
<linearGradient id="bg" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${hex(DEEP)}"/><stop offset="0.5" stop-color="${hex(DIAL)}"/><stop offset="1" stop-color="${hex(DEEP)}"/></linearGradient>
<linearGradient id="gl" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.26"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.12"/></linearGradient>
${d.round ? `<clipPath id="c"><rect width="512" height="512" rx="${d.round}"/></clipPath>` : ''}
</defs>
<g${clip}>
<rect width="512" height="512" fill="url(#bg)"/>
${d.ticks.map((t) => `<rect x="${t.x.toFixed(2)}" y="${t.y.toFixed(2)}" width="${t.w.toFixed(2)}" height="${t.h.toFixed(2)}" fill="${hex(INK)}" fill-opacity="${t.a}"/>`).join('\n')}
<rect width="512" height="512" fill="url(#gl)"/>
<rect x="${d.needle.x.toFixed(2)}" y="0" width="${d.needle.w.toFixed(2)}" height="512" fill="${hex(NEEDLE)}"/>
<path d="M${(256 - d.tri.half).toFixed(2)} ${d.tri.top.toFixed(2)}H${(256 + d.tri.half).toFixed(2)}L256 ${(d.tri.top + d.tri.depth).toFixed(2)}Z" fill="${hex(NEEDLE)}"/>
</g>
</svg>
`;
}

// Colour of one point of the design, as [r, g, b, a] with a in 0–1.
function shade(d, x, y) {
  if (d.round) {
    const r = d.round, cx = Math.min(Math.max(x, r), 512 - r), cy = Math.min(Math.max(y, r), 512 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return [0, 0, 0, 0];
  }
  const t = Math.abs(x / 512 - 0.5) * 2;
  let c = DIAL.map((v, i) => v + (DEEP[i] - v) * t);
  const over = (col, a) => { c = c.map((v, i) => v + (col[i] - v) * a); };
  for (const k of d.ticks) if (x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h) over(INK, k.a);
  const g = y / 512;
  if (g < 0.45) over([255, 255, 255], 0.26 * (1 - g / 0.45));
  else over([0, 0, 0], 0.12 * (g - 0.45) / 0.55);
  const inTri = y >= d.tri.top && y <= d.tri.top + d.tri.depth && Math.abs(x - 256) <= d.tri.half * (1 - (y - d.tri.top) / d.tri.depth);
  if ((x >= d.needle.x && x < d.needle.x + d.needle.w) || inTri) c = NEEDLE.slice();
  return [...c, 1];
}

function raster(d, size) {
  const S = 4, k = 512 / size, px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let qx = 0; qx < size; qx++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const s = shade(d, (qx + (sx + 0.5) / S) * k, (py + (sy + 0.5) / S) * k);
      r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
    }
    const o = (py * size + qx) * 4;
    px[o] = a ? Math.round(r / a) : 0; px[o + 1] = a ? Math.round(g / a) : 0; px[o + 2] = a ? Math.round(b / a) : 0;
    px[o + 3] = Math.round((a / (S * S)) * 255);
  }
  return png(size, px);
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  // filter type 2 ("Up"): each byte minus the one above it, which suits the smooth gradients
  const row = size * 4, raw = Buffer.alloc(size * (row + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (row + 1)] = 2;
    for (let i = 0; i < row; i++) raw[y * (row + 1) + 1 + i] = (rgba[y * row + i] - (y ? rgba[(y - 1) * row + i] : 0)) & 0xFF;
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const any = design({ round: 112 });
const full = design();
const maskable = design({ scale: 0.78 });
fs.mkdirSync(OUT, { recursive: true });
const files = {
  'icon.svg': svg(any),
  'icon-192.png': raster(any, 192),
  'icon-512.png': raster(any, 512),
  'maskable-512.png': raster(maskable, 512),
  'apple-touch-icon.png': raster(full, 180)   // iOS rounds the corners itself and wants no transparency
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`Wrote ${path.join(OUT, name)} (${(data.length / 1024).toFixed(1)} KB)`);
}
