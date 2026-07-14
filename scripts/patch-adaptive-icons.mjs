// Correct the Android adaptive-icon output that @capacitor/assets emits.
//
// Custom mode has two defects we fix here, both verified against the tool's
// source (dist/platforms/android/index.js) and its output:
//
//  1. XML: it wraps BOTH the foreground and background in a 16.7% <inset>.
//     Insetting the background shrinks the cream plate into the central ~67% of
//     the layer, so any launcher mask shows cream floating with the wallpaper
//     bleeding through the corners. Correct shape: full-bleed background, only
//     the foreground inset into the adaptive safe zone.
//
//  2. Resolution: the custom-mode foreground/background handler filters for the
//     legacy "icon" templates (<=192px), not the "adaptive-icon" templates
//     (<=432px), so an adaptive layer is authored at ~48dp and Android upscales
//     it ~2.25x on xxxhdpi - the mark's fine ring/carving strokes blur. We
//     re-rasterize both adaptive layers from the 1024 SVG inputs at the real
//     108dp sizes.
//
// Idempotent; run after `capacitor-assets generate`.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(REPO, 'resources');
const MIPMAP_ROOT = join(REPO, 'android/app/src/main/res');

// Adaptive-icon layer is 108dp; these are its px sizes per density bucket.
const ADAPTIVE_PX = { ldpi: 81, mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />
    </foreground>
</adaptive-icon>
`;

// 1. Rewrite the adaptive XML.
const anydpi = join(MIPMAP_ROOT, 'mipmap-anydpi-v26');
const xmls = readdirSync(anydpi).filter((f) => /^ic_launcher.*\.xml$/.test(f));
if (xmls.length === 0) {
  throw new Error(`no adaptive icon XML in ${anydpi} - did generation run?`);
}
for (const file of xmls) {
  writeFileSync(join(anydpi, file), XML);
  console.log(`patched ${file} (full-bleed background, foreground inset 16.7%)`);
}

// 2. Re-rasterize the two adaptive layers at real 108dp sizes.
const fgSvg = readFileSync(join(RES, 'icon-foreground.svg'));
const bgSvg = readFileSync(join(RES, 'icon-background.svg'));
for (const [density, px] of Object.entries(ADAPTIVE_PX)) {
  const dir = join(MIPMAP_ROOT, `mipmap-${density}`);
  const fg = join(dir, 'ic_launcher_foreground.png');
  if (!existsSync(fg)) continue; // only densities the tool created
  await sharp(fgSvg).resize(px, px).png().toFile(fg);
  await sharp(bgSvg).resize(px, px).png().toFile(join(dir, 'ic_launcher_background.png'));
  console.log(`resized mipmap-${density} adaptive layers to ${px}px`);
}
