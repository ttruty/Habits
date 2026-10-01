// Fails if dist/embed.js is over the gzipped budget (CLAUDE.md: under 25 KB).
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const LIMIT = 25 * 1024;
const file = 'dist/embed.js';
const size = gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1);

console.log(`${file}: ${kb(size)} KB gzipped (limit ${kb(LIMIT)} KB)`);
if (size > LIMIT) {
  console.error('Embed bundle is over budget.');
  process.exit(1);
}
