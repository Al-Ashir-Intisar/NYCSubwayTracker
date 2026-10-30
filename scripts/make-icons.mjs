// Draws the web app icons (a white "T" on a green route bullet over the app's dark ink) into
// web/icons/. Run once with `node scripts/make-icons.mjs`; replace the PNGs to use real artwork.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const INK = [0x1b, 0x25, 0x24];
const GREEN = [0x00, 0x7a, 0x5e];
const WHITE = [0xff, 0xff, 0xff];
const SAMPLES = 4;

// Color at a point in unit coordinates (0..1); `scale` shrinks the artwork for maskable icons.
function colorAt(x, y, scale) {
  const u = (x - 0.5) / scale;
  const v = (y - 0.5) / scale;
  if (Math.hypot(u, v) > 0.36) return INK;
  const bar = Math.abs(u) <= 0.2 && v >= -0.2 && v <= -0.1;
  const stem = Math.abs(u) <= 0.05 && v >= -0.2 && v <= 0.22;
  return bar || stem ? WHITE : GREEN;
}

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, scale) {
  const rows = [];
  for (let py = 0; py < size; py += 1) {
    const row = Buffer.alloc(1 + size * 3);
    for (let px = 0; px < size; px += 1) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const color = colorAt((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size, scale);
          for (let channel = 0; channel < 3; channel += 1) sum[channel] += color[channel];
        }
      }
      for (let channel = 0; channel < 3; channel += 1) {
        row[1 + px * 3 + channel] = Math.round(sum[channel] / SAMPLES ** 2);
      }
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const outputDirectory = resolve(process.cwd(), 'web/icons');
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, 'icon-192.png'), png(192, 1));
writeFileSync(resolve(outputDirectory, 'icon-512.png'), png(512, 1));
writeFileSync(resolve(outputDirectory, 'apple-touch-icon.png'), png(180, 1));
writeFileSync(resolve(outputDirectory, 'icon-maskable-512.png'), png(512, 0.8));
