#!/usr/bin/env node
// Renders public/logo-color-v1.1.svg → public/logo-maskable-{192,512}.png
// with a 20% safe-zone padding on each side, on a white background.
// Android 13+ adaptive icons crop to circle/squircle; the safe zone keeps
// the logo visible after the crop.
//
// Usage: npm run icons

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(here, '..', 'public', 'logo-color-v1.1.svg');
const svg = await readFile(svgPath);

const SAFE_ZONE = 0.6; // logo occupies 60% of canvas (20% padding per side)
// Opaque white reads cleanly behind the multi-color logo; some launchers render
// their own background behind the squircle, so a transparent BG would risk a
// default-grey fill. White also matches the manifest's background_color.
const BG = { r: 255, g: 255, b: 255, alpha: 1 };

async function renderMaskable(size) {
  const inner = Math.round(size * SAFE_ZONE);
  // density: 384 dpi rasterizes the SVG at ~5× the default 72 dpi so the
  // resize down to `inner` stays crisp. Load-bearing — sharp defaults to 72.
  const logo = await sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: 'inside' })
    .png()
    .toBuffer();
  const out = await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  const path = resolve(here, '..', 'public', `logo-maskable-${size}.png`);
  await writeFile(path, out);
  console.log(`logo-maskable-${size}.png written (${out.byteLength} bytes)`);
}

await renderMaskable(192);
await renderMaskable(512);
