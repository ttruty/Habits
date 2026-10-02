// Renders the app icons (PNG) from the favicon's design. Run when the icon changes:
//   node scripts/make-icons.mjs
import { chromium } from '@playwright/test';

const dots = (fill) => `<g fill="${fill}">
  <circle cx="9" cy="11" r="3"/><circle cx="16" cy="11" r="3"/><circle cx="23" cy="11" r="3" opacity=".35"/>
  <circle cx="9" cy="21" r="3" opacity=".35"/><circle cx="16" cy="21" r="3"/><circle cx="23" cy="21" r="3"/></g>`;
// "any": rounded tile. "maskable": full-bleed, dots inside the 80% safe zone.
const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1f6f5c"/>${dots('#fff')}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1f6f5c"/><g transform="translate(16 16) scale(.7) translate(-16 -16)">${dots('#fff')}</g></svg>`;

const icons = [
  ['icons/icon-192.png', any, 192],
  ['icons/icon-512.png', any, 512],
  ['icons/maskable-512.png', maskable, 512],
  ['icons/apple-touch-icon.png', maskable, 180],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, svg, size] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: `public/${file}`, omitBackground: true });
  console.log(`public/${file}`);
}
await browser.close();
