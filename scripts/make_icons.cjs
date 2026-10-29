#!/usr/bin/env node
/**
 * Renders branding/icon.svg and icon-maskable.svg to the PNGs the web app,
 * the desktop app (src-tauri/icons, via `tauri icon`) and the Android app use.
 *   node scripts/make_icons.cjs
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const svg = (f) => fs.readFileSync(path.join(ROOT, 'branding', f), 'utf8');
const jobs = [
  ['icon.svg', 512, 'public/icons/icon-512.png'],
  ['icon.svg', 192, 'public/icons/icon-192.png'],
  ['icon.svg', 32, 'public/icons/favicon-32.png'],
  ['icon-maskable.svg', 512, 'public/icons/maskable-512.png'],
  ['icon-maskable.svg', 180, 'public/icons/apple-touch-180.png'],
  ['icon.svg', 1024, 'branding/icon-1024.png'],
  ['icon-maskable.svg', 1024, 'branding/icon-maskable-1024.png'],
];
// Android launcher icons: legacy square and round (48dp) and the adaptive foreground (108dp).
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  const res = `android/app/src/main/res/mipmap-${d}`;
  jobs.push(['icon.svg', 48 * k, `${res}/ic_launcher.png`]);
  jobs.push(['icon-round.svg', 48 * k, `${res}/ic_launcher_round.png`]);
  jobs.push(['android-foreground.svg', 108 * k, `${res}/ic_launcher_foreground.png`]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [src, size, out] of jobs) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(src).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    fs.mkdirSync(path.dirname(path.join(ROOT, out)), { recursive: true });
    await page.locator('svg').screenshot({ path: path.join(ROOT, out), omitBackground: true });
    console.log(out);
  }
  await browser.close();
})();
