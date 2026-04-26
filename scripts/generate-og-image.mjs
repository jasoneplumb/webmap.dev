#!/usr/bin/env node
// Renders public/og-image.svg → public/og-image.png at 1200×630.
// Run when the SVG source changes; the resulting PNG is committed.
//
// Usage: npm run og

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(here, '..', 'public', 'og-image.svg');
const pngPath = resolve(here, '..', 'public', 'og-image.png');

const svg = await readFile(svgPath);
const png = await sharp(svg, { density: 192 })
  .resize(1200, 630)
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(pngPath, png);

console.log(`og-image.png written (${png.byteLength} bytes)`);
