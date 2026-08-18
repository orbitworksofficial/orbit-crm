#!/usr/bin/env node
/**
 * Generates every logo derivative from `public/logo.png`.
 *
 *   npm run logo:build
 *
 * Produces:
 *   public/logo-full-light.png   lockup, wordmark in light-theme ink
 *   public/logo-full-dark.png    lockup, wordmark in dark-theme ink
 *   public/logo-mark.png         orbital symbol alone
 *   src/app/icon.png             favicon
 *   src/app/apple-icon.png       iOS home-screen icon
 *
 * Bounds are measured from the pixels rather than hardcoded, so a
 * differently-cropped source file still works. See docs/BRANDING.md.
 */

import sharp from 'sharp';
import { existsSync } from 'node:fs';

const SOURCE = 'public/logo.png';

/** Wordmark ink per theme — matches --text-primary in globals.css. */
const LIGHT_INK = [15, 23, 42];   // #0f172a
const DARK_INK = [241, 245, 249]; // #f1f5f9

/** Brand navy, used only as the iOS icon's ground. */
const NAVY = { r: 11, g: 17, b: 32 };

if (!existsSync(SOURCE)) {
  console.error(`Missing ${SOURCE}.`);
  process.exit(1);
}

/** True for the brand pink, which is never recoloured. */
function isPink(r, g, b) {
  return r > 150 && g < 110 && b < 140 && r - g > 60;
}

const { data, info } = await sharp(SOURCE).ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

const alphaAt = (x, y) => data[(y * width + x) * channels + 3];

// --- Measure the artwork's bounds -------------------------------------------
let minX = width, minY = height, maxX = 0, maxY = 0;
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    if (alphaAt(x, y) > 10) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

// --- Find the gap separating the symbol from the wordmark -------------------
// The symbol is the first block of ink; the first wide empty column run after
// it marks where the wordmark begins.
let symbolEnd = maxX;
let gapStart = null;
for (let x = minX; x <= maxX; x += 1) {
  let filled = false;
  for (let y = minY; y <= maxY; y += 1) {
    if (alphaAt(x, y) > 10) { filled = true; break; }
  }
  if (!filled) {
    if (gapStart === null) gapStart = x;
  } else {
    if (gapStart !== null && x - gapStart > 15) { symbolEnd = gapStart; break; }
    gapStart = null;
  }
}

const PAD = 10;
const lockup = {
  left: Math.max(0, minX - PAD),
  top: Math.max(0, minY - PAD),
  width: Math.min(width, maxX + PAD) - Math.max(0, minX - PAD),
  height: Math.min(height, maxY + PAD) - Math.max(0, minY - PAD),
};

console.log(`Source ${width}×${height}; artwork ${lockup.width}×${lockup.height}; symbol ends at x=${symbolEnd}`);

/** Repaints every non-pink visible pixel in `ink`, preserving antialiasing. */
async function recolour(ink, outPath, { fadeByLuminance }) {
  const out = Buffer.from(data);
  for (let p = 0; p < width * height; p += 1) {
    const i = p * channels;
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 10 || isPink(r, g, b)) continue;

    [out[i], out[i + 1], out[i + 2]] = ink;

    if (fadeByLuminance) {
      // Going white -> dark, a soft grey edge pixel should become a *fainter*
      // dark pixel, not a solid one. Scaling alpha by the source luminance
      // keeps the edges smooth instead of chunky.
      const luminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      out[i + 3] = Math.round(a * Math.min(1, luminance + 0.15));
    }
  }

  await sharp(out, { raw: { width, height, channels } })
    .extract(lockup)
    .resize({ width: 1000, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  console.log(`  ${outPath}`);
}

await recolour(LIGHT_INK, 'public/logo-full-light.png', { fadeByLuminance: true });
await recolour(DARK_INK, 'public/logo-full-dark.png', { fadeByLuminance: false });

// --- Orbital symbol ---------------------------------------------------------
const mark = {
  left: Math.max(0, minX - PAD),
  top: Math.max(0, minY - PAD),
  width: symbolEnd - Math.max(0, minX - PAD) + PAD,
  height: Math.min(height, maxY + PAD) - Math.max(0, minY - PAD),
};

await sharp(SOURCE)
  .extract(mark)
  .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile('public/logo-mark.png');
console.log('  public/logo-mark.png');

// --- Favicons ---------------------------------------------------------------
await sharp('public/logo-mark.png')
  .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile('src/app/icon.png');
console.log('  src/app/icon.png');

// iOS composites over white, so this one gets an explicit navy ground.
await sharp('public/logo-mark.png')
  .resize(160, 160, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({ top: 20, bottom: 20, left: 20, right: 20, background: { ...NAVY, alpha: 1 } })
  .flatten({ background: NAVY })
  .png({ compressionLevel: 9 })
  .toFile('src/app/apple-icon.png');
console.log('  src/app/apple-icon.png');

console.log('Done.');
