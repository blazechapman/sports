// Makes the app icons (app/public/*.png) from app/icon.svg:  node scripts/make-icons.mjs
// Uses Playwright's Chromium (installed globally); only needed when the icon changes.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(execSync("npm root -g").toString().trim() + "/playwright");
const dir = new URL("../app/", import.meta.url).pathname;
const svg = readFileSync(dir + "icon.svg", "utf8");
// Maskable icons get cropped to a circle or squircle: keep the mark inside the middle 80%.
const maskable = svg.replace('<g id="mark">', '<g id="mark" transform="translate(51.2 51.2) scale(0.8)">');

const browser = await chromium.launch();
async function shot(src, size, file) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${src.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: dir + "public/" + file, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await shot(svg, 192, "icon-192.png");
await shot(svg, 512, "icon-512.png");
await shot(svg, 180, "apple-touch-icon.png");
await shot(maskable, 512, "icon-512-maskable.png");
await browser.close();
console.log("Wrote app/public/icon-192.png, icon-512.png, apple-touch-icon.png, icon-512-maskable.png");
