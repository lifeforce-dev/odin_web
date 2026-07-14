// Generate the launcher-icon raster inputs from the single brand mark.
//
// resources/odin-mark.svg is the one geometry source of truth (mark only,
// colors parameterized as --logo-ink / --logo-slate / --logo-field). This
// script derives the three @capacitor/assets custom-mode inputs from it:
//
//   resources/icon-only.svg        cream plate + mark   (iOS / legacy / PWA)
//   resources/icon-foreground.svg  mark on transparent  (Android adaptive fg)
//   resources/icon-background.svg  solid cream          (Android adaptive bg)
//
// The cream plate (#E9E2D0) exists ONLY in these generated inputs, never in the
// mark. Colors are baked to literals here because sharp/librsvg (the rasterizer
// @capacitor/assets uses) does NOT resolve CSS var() fallbacks - a var() paint
// renders black. Browsers resolve var(), so the mark keeps it for in-app use.
//
// Run via `npm run icons:generate`, which runs this and then the generator.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(REPO, 'resources');

const CANVAS = 1024; // @capacitor/assets custom inputs must be >= 1024x1024.
const CREAM = '#E9E2D0';

// Fraction of the canvas the mark's 512 viewBox spans (mark art fills ~94% of
// that box, so painted coverage is ~0.94x these). icon-only leaves a cream
// margin for the iOS squircle; the Android foreground is pulled further in by
// the tool's own 16.7% adaptive inset, so it can sit larger here.
const ICON_ONLY_BOX = 0.86;
const FOREGROUND_BOX = 0.92;

// Extract the mark's drawing elements (drop the <svg> wrapper + title/desc) and
// bake the parameterized colors to their launcher literals.
function markInner() {
  let svg = readFileSync(join(RES, 'odin-mark.svg'), 'utf8');
  svg = svg
    .replace(/var\(--logo-ink,\s*#1F2125\)/g, '#1F2125')
    .replace(/var\(--logo-slate,\s*#35455F\)/g, '#35455F')
    .replace(/var\(--logo-field,\s*transparent\)/g, CREAM);
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>\s*/g, '')
    .replace(/<desc>[\s\S]*?<\/desc>\s*/g, '')
    .trim();
  if (/var\(|#E9E2D0/i.test(inner.replace(new RegExp(CREAM, 'gi'), ''))) {
    throw new Error('unresolved var() remains in baked mark');
  }
  return inner;
}

// Place the mark's 512-space content into a centered box of `box`*CANVAS.
function placed(inner, box) {
  const size = box * CANVAS;
  const off = (CANVAS - size) / 2;
  const scale = size / 512;
  return `<g transform="translate(${off.toFixed(3)},${off.toFixed(3)}) scale(${scale.toFixed(6)})">\n${inner}\n</g>`;
}

const BANNER =
  '<!-- GENERATED from resources/odin-mark.svg by scripts/build-icon-inputs.mjs. Do not edit by hand; run npm run icons:generate. -->';

function doc(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">\n${BANNER}\n${body}\n</svg>\n`;
}

const inner = markInner();
const plate = `<rect width="${CANVAS}" height="${CANVAS}" fill="${CREAM}"/>`;

const outputs = {
  'icon-only.svg': doc(`${plate}\n${placed(inner, ICON_ONLY_BOX)}`),
  'icon-foreground.svg': doc(placed(inner, FOREGROUND_BOX)),
  'icon-background.svg': doc(plate),
};

for (const [name, content] of Object.entries(outputs)) {
  writeFileSync(join(RES, name), content);
  console.log(`wrote resources/${name} (${(Buffer.byteLength(content) / 1024).toFixed(2)} KB)`);
}
