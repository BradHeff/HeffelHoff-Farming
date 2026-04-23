#!/usr/bin/env node
// Generates Android app icons from an inline SVG design.
// Writes PNGs into android/app/src/main/res/mipmap-* and the adaptive icon
// resources for modern Android launchers. Re-runnable.

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const RES_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

// -- Icon SVG: cute farmer chibi with straw hat on a bright green field ---
//
// Rendered at a master size of 512x512. sharp downsamples per mipmap bucket.
// The design is intentionally centered with a safe 104px margin so adaptive
// icons crop nicely (108dp foreground / 66dp safe area).
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="sky" cx="50%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#cfecff"/>
      <stop offset="100%" stop-color="#7fd1ff"/>
    </radialGradient>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#7be053"/>
      <stop offset="100%" stop-color="#4aa33a"/>
    </linearGradient>
    <linearGradient id="hat" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffd970"/>
      <stop offset="100%" stop-color="#d8a332"/>
    </linearGradient>
    <radialGradient id="sun" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff9c4"/>
      <stop offset="100%" stop-color="#ffcf3f"/>
    </radialGradient>
  </defs>

  <!-- Background (for legacy/round icons) -->
  <rect width="512" height="512" fill="url(#sky)"/>

  <!-- Sun -->
  <circle cx="410" cy="110" r="56" fill="url(#sun)"/>

  <!-- Foreground hill -->
  <ellipse cx="256" cy="432" rx="340" ry="160" fill="url(#ground)"/>

  <!-- Small fluffy clouds -->
  <g fill="#ffffff" opacity="0.9">
    <ellipse cx="110" cy="120" rx="38" ry="14"/>
    <ellipse cx="138" cy="110" rx="28" ry="14"/>
    <ellipse cx="330" cy="200" rx="34" ry="12"/>
  </g>

  <!-- Decorative grass tufts -->
  <g fill="#55b832">
    <polygon points="40,400 54,370 68,400"/>
    <polygon points="70,410 82,380 94,410"/>
    <polygon points="440,400 454,372 468,400"/>
    <polygon points="410,412 422,384 434,412"/>
  </g>

  <!-- Character: straw hat farmer -->
  <!-- Body shadow -->
  <ellipse cx="256" cy="430" rx="100" ry="16" fill="#000" opacity="0.18"/>

  <!-- Legs -->
  <rect x="222" y="340" width="30" height="72" rx="12" fill="#3a4063"/>
  <rect x="260" y="340" width="30" height="72" rx="12" fill="#3a4063"/>
  <!-- Boots -->
  <ellipse cx="237" cy="418" rx="22" ry="14" fill="#1f1a14"/>
  <ellipse cx="275" cy="418" rx="22" ry="14" fill="#1f1a14"/>

  <!-- Torso (shirt) -->
  <rect x="196" y="240" width="120" height="120" rx="30" fill="#4292e8"/>
  <!-- Belt -->
  <rect x="196" y="342" width="120" height="16" rx="6" fill="#2a3a5a"/>
  <rect x="248" y="342" width="16" height="16" fill="#e0b847"/>

  <!-- Arms -->
  <rect x="160" y="250" width="38" height="100" rx="18" fill="#4292e8"/>
  <rect x="314" y="250" width="38" height="100" rx="18" fill="#4292e8"/>
  <!-- Hand (left, holding scythe) -->
  <circle cx="180" cy="360" r="20" fill="#ffcf87"/>
  <circle cx="332" cy="360" r="20" fill="#ffcf87"/>

  <!-- Scythe (in right hand) -->
  <g transform="rotate(10 332 360)">
    <rect x="328" y="190" width="10" height="200" fill="#8a5a2b"/>
    <path d="M 336 195 Q 400 190 408 240 L 380 215 Q 372 205 336 210 Z" fill="#dde3e8" stroke="#a0a8b0" stroke-width="3"/>
  </g>

  <!-- Head -->
  <circle cx="256" cy="200" r="64" fill="#ffcf87"/>
  <!-- Cheeks -->
  <circle cx="226" cy="216" r="10" fill="#ff9aa8" opacity="0.85"/>
  <circle cx="286" cy="216" r="10" fill="#ff9aa8" opacity="0.85"/>
  <!-- Eyes -->
  <circle cx="230" cy="196" r="8" fill="#1a1a1a"/>
  <circle cx="282" cy="196" r="8" fill="#1a1a1a"/>
  <!-- Eye shine -->
  <circle cx="232" cy="193" r="3" fill="#ffffff"/>
  <circle cx="284" cy="193" r="3" fill="#ffffff"/>
  <!-- Smile -->
  <path d="M 240 224 Q 256 238 272 224" stroke="#4a3020" stroke-width="4" fill="none" stroke-linecap="round"/>

  <!-- Straw Hat -->
  <ellipse cx="256" cy="148" rx="118" ry="28" fill="url(#hat)"/>
  <ellipse cx="256" cy="118" rx="60" ry="30" fill="url(#hat)"/>
  <ellipse cx="256" cy="105" rx="55" ry="20" fill="#f0be52"/>
  <rect x="198" y="142" width="116" height="8" fill="#8a4a2a" opacity="0.8"/>

  <!-- Wheat stalks tucked in belt -->
  <g stroke="#d8a332" stroke-width="3" fill="#ffcf3f">
    <line x1="302" y1="350" x2="315" y2="320" />
    <ellipse cx="315" cy="320" rx="6" ry="10" />
  </g>
</svg>`;

// -- Foreground-only SVG for adaptive icons (no background) --------------
const FOREGROUND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="hatf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffd970"/>
      <stop offset="100%" stop-color="#d8a332"/>
    </linearGradient>
  </defs>
  <!-- Safe zone outline NOT drawn; character centered within 108dp circle safe -->
  <!-- Body shadow -->
  <ellipse cx="256" cy="410" rx="100" ry="14" fill="#000" opacity="0.15"/>
  <!-- Legs -->
  <rect x="222" y="320" width="30" height="72" rx="12" fill="#3a4063"/>
  <rect x="260" y="320" width="30" height="72" rx="12" fill="#3a4063"/>
  <ellipse cx="237" cy="398" rx="22" ry="14" fill="#1f1a14"/>
  <ellipse cx="275" cy="398" rx="22" ry="14" fill="#1f1a14"/>
  <!-- Torso -->
  <rect x="196" y="220" width="120" height="120" rx="30" fill="#4292e8"/>
  <rect x="196" y="322" width="120" height="16" rx="6" fill="#2a3a5a"/>
  <rect x="248" y="322" width="16" height="16" fill="#e0b847"/>
  <!-- Arms -->
  <rect x="160" y="230" width="38" height="100" rx="18" fill="#4292e8"/>
  <rect x="314" y="230" width="38" height="100" rx="18" fill="#4292e8"/>
  <circle cx="180" cy="340" r="20" fill="#ffcf87"/>
  <circle cx="332" cy="340" r="20" fill="#ffcf87"/>
  <!-- Head -->
  <circle cx="256" cy="180" r="64" fill="#ffcf87"/>
  <circle cx="226" cy="196" r="10" fill="#ff9aa8" opacity="0.85"/>
  <circle cx="286" cy="196" r="10" fill="#ff9aa8" opacity="0.85"/>
  <circle cx="230" cy="176" r="8" fill="#1a1a1a"/>
  <circle cx="282" cy="176" r="8" fill="#1a1a1a"/>
  <circle cx="232" cy="173" r="3" fill="#ffffff"/>
  <circle cx="284" cy="173" r="3" fill="#ffffff"/>
  <path d="M 240 204 Q 256 218 272 204" stroke="#4a3020" stroke-width="4" fill="none" stroke-linecap="round"/>
  <!-- Hat -->
  <ellipse cx="256" cy="128" rx="118" ry="28" fill="url(#hatf)"/>
  <ellipse cx="256" cy="98" rx="60" ry="30" fill="url(#hatf)"/>
  <ellipse cx="256" cy="85" rx="55" ry="20" fill="#f0be52"/>
  <rect x="198" y="122" width="116" height="8" fill="#8a4a2a" opacity="0.8"/>
</svg>`;

// -- Android mipmap density buckets --------------------------------------
const BUCKETS = [
  { name: 'mipmap-mdpi',    size: 48,  fgSize: 108 },
  { name: 'mipmap-hdpi',    size: 72,  fgSize: 162 },
  { name: 'mipmap-xhdpi',   size: 96,  fgSize: 216 },
  { name: 'mipmap-xxhdpi',  size: 144, fgSize: 324 },
  { name: 'mipmap-xxxhdpi', size: 192, fgSize: 432 },
];

async function renderSquare(svg, outPath, size) {
  const buf = Buffer.from(svg);
  await sharp(buf, { density: 384 }).resize(size, size).png().toFile(outPath);
}

async function renderRound(svg, outPath, size) {
  const buf = Buffer.from(svg);
  // Circle mask via SVG
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`
  );
  await sharp(buf, { density: 384 })
    .resize(size, size)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toFile(outPath);
}

async function writeAdaptiveXml() {
  // mipmap-anydpi-v26/ic_launcher.xml (and _round) reference foreground / background
  const anyDir = path.join(RES_DIR, 'mipmap-anydpi-v26');
  await mkdir(anyDir, { recursive: true });
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  await writeFile(path.join(anyDir, 'ic_launcher.xml'), xml);
  await writeFile(path.join(anyDir, 'ic_launcher_round.xml'), xml);

  // values/ic_launcher_background.xml
  const valuesDir = path.join(RES_DIR, 'values');
  await mkdir(valuesDir, { recursive: true });
  const colors = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#7fd1ff</color>
</resources>
`;
  await writeFile(path.join(valuesDir, 'ic_launcher_background.xml'), colors);
}

async function main() {
  console.log('Generating Android app icons into:', RES_DIR);
  for (const b of BUCKETS) {
    const outDir = path.join(RES_DIR, b.name);
    await mkdir(outDir, { recursive: true });
    // Legacy square + round icons
    await renderSquare(ICON_SVG, path.join(outDir, 'ic_launcher.png'), b.size);
    await renderRound (ICON_SVG, path.join(outDir, 'ic_launcher_round.png'), b.size);
    // Adaptive icon foreground
    await renderSquare(FOREGROUND_SVG, path.join(outDir, 'ic_launcher_foreground.png'), b.fgSize);
    console.log(`  ${b.name.padEnd(18)} → ${b.size}px + fg ${b.fgSize}px`);
  }
  await writeAdaptiveXml();
  console.log('Adaptive icon XML + background color written.');

  // Also output a 512x512 master for Play Store
  const master = path.join(RES_DIR, '..', '..', '..', '..', 'app-icon-512.png');
  await renderSquare(ICON_SVG, master, 512);
  console.log('Play Store master icon: android/app-icon-512.png');
}

main().catch((e) => { console.error(e); process.exit(1); });
